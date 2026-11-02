/**
 * src/chat/contest-service.mjs
 * GM-side operations on a contest card (3.45-4). The contest state lives on one chat message
 * (`flags.sprinter-rpg.contestState = { id, state }`, see contest-card.mjs); these functions read it, change it through
 * a reducer and write it back together with the re-rendered card. They are the API the Contest Tracker window
 * (3.45-5) calls, and the ingest and relay in contest-ingest.mjs use them too.
 *
 * Writes always go through `updateContest`: calls for one contest run one after another (a write and the hook it
 * triggers never overlap), and the state is re-read from the message inside the queue. Only a GM writes the card.
 * Nothing here blocks (CONTRIBUTING rule 2): callers ask the Rule Break where it matters.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';
import { sanitizeContest, contestMoveOf, moveRateMod, fixedResult, participantLegSkill } from '../utils/contest/contest-engine.mjs';
import { CONTEST_TAGS } from '../data/tag-vocabulary.mjs';
import { findCatalogEntry } from '../content/catalog-lookup.mjs';
import { buildRollContext } from '../utils/roll-context.mjs';
import { collectCheckModifiers } from '../utils/damage-modifiers.mjs';
import { mobDifficultyShift, MOB_QUALITIES } from '../documents/actor/combat-targeting.mjs';
import { CONTEST_FLAG, readContest, sanitizeContestWrapper, buildContestCardHtml } from './contest-card.mjs';

const flagPath = `flags.${SYSTEM_ID}.${CONTEST_FLAG}`;

/** A replace-not-merge value for a message update (Foundry v14 ForcedReplacement); the plain value outside Foundry. */
function replaceValue(value) {
  return globalThis.foundry?.data?.operators?.ForcedReplacement?.create?.(value) ?? value;
}

/** A new contest id. */
export function newContestId() {
  return globalThis.foundry?.utils?.randomID?.(16) ?? `contest-${Math.random().toString(36).slice(2, 12)}`;
}

function allMessages() {
  const store = globalThis.game?.messages;
  if (!store) return [];
  if (Array.isArray(store)) return store;
  return Array.from(store.contents ?? store.values?.() ?? []);
}

/** The chat message that holds contest `contestId` (a re-posted card has a new message id but the same contest id). */
export function findContestMessage(contestId) {
  if (typeof contestId !== 'string' || !contestId) return null;
  const list = allMessages();
  for (let i = list.length - 1; i >= 0; i--) {
    if (readContest(list[i])?.id === contestId) return list[i];
  }
  return null;
}

/** Every contest card in the chat log, newest first, as `{ id, state, message }` (one per contest id). */
export function listContests() {
  const out = [];
  const seen = new Set();
  const list = allMessages();
  for (let i = list.length - 1; i >= 0; i--) {
    const wrapper = readContest(list[i]);
    if (!wrapper || seen.has(wrapper.id)) continue;
    seen.add(wrapper.id);
    out.push({ ...wrapper, message: list[i] });
  }
  return out;
}

/** The `{ id, state }` of contest `contestId`, or null. */
export function getContest(contestId) {
  const message = findContestMessage(contestId);
  return message ? readContest(message) : null;
}

function cardData(wrapper) {
  return {
    content: buildContestCardHtml(wrapper, { resolve: resolveActorByUuid }),
    flags: { [SYSTEM_ID]: { [CONTEST_FLAG]: wrapper } }
  };
}

/**
 * Post a new contest card (GM). `id` is kept when given (re-post), else a new contest id is made.
 * @param {object} rawState anything; sanitised
 * @param {{ id?: string }} [opts]
 * @returns {Promise<{ message: object, id: string }|null>} null for a non-GM or when the card could not be created
 */
export async function postContestCard(rawState, { id } = {}) {
  if (!globalThis.game?.user?.isGM) return null;
  const wrapper = { id: (typeof id === 'string' && id.trim()) || newContestId(), state: sanitizeContest(rawState) };
  const message = await globalThis.ChatMessage?.create?.({
    speaker: { alias: 'Contest' },
    ...cardData(wrapper)
  });
  return message ? { message, id: wrapper.id } : null;
}

const queues = new Map();

/**
 * Change a contest through a reducer, then write the state and the re-rendered card. Calls for one contest are
 * serialised. The reducer gets a sanitised copy of the state and a context `{ resolve }`; it returns the new state (or
 * nothing, having changed the copy). It may return `false` to leave the card untouched.
 * @param {string} contestId
 * @param {(state: object, ctx: { resolve: Function }) => (object|false|void|Promise<object|false|void>)} reducer
 * @returns {Promise<{ ok: boolean, reason?: string, state?: object }>}
 */
export function updateContest(contestId, reducer) {
  if (!globalThis.game?.user?.isGM) return Promise.resolve({ ok: false, reason: 'not-gm' });
  const run = (queues.get(contestId) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const message = findContestMessage(contestId);
    if (!message) return { ok: false, reason: 'no-contest' };
    const wrapper = readContest(message);
    const draft = sanitizeContest(JSON.parse(JSON.stringify(wrapper.state)));
    const out = await reducer(draft, { resolve: resolveActorByUuid });
    if (out === false) return { ok: false, reason: 'unchanged' };
    const next = { id: wrapper.id, state: sanitizeContest(out ?? draft) };
    const data = cardData(next);
    await message.update({ content: data.content, [flagPath]: replaceValue(next) });
    return { ok: true, state: next.state };
  });
  queues.set(contestId, run);
  run.finally(() => { if (queues.get(contestId) === run) queues.delete(contestId); }).catch(() => {});
  return run;
}

/**
 * Re-post a deleted contest card from the last state a tracker read (D2a). The contest id is kept, so roll cards
 * stamped with it are ingested again. If a card for that id already exists it is updated, not duplicated.
 * @param {{ id: string, state: object }} wrapper
 * @returns {Promise<{ message: object, id: string }|null>}
 */
export async function repostContestCard(wrapper) {
  const w = sanitizeContestWrapper(wrapper);
  if (!w) return null;
  const existing = findContestMessage(w.id);
  if (existing) {
    await updateContest(w.id, () => w.state);
    return { message: existing, id: w.id };
  }
  return postContestCard(w.state, { id: w.id });
}

// ---------------------------------------------------------------------------------------------------------------
// Fixed results (D6)

const STATS = ['str', 'dex', 'con', 'int', 'cha'];

/**
 * The stat that governs a skill for a participant (D3): their owned skill's stat, else the catalog entry's, else Str.
 * The tracker uses it to fill a leg's `check.stat`.
 */
export function governingStat(actor, skillId) {
  const owned = typeof actor?.getSkillByIdentifier === 'function' ? actor.getSkillByIdentifier(skillId)?.system?.stat : null;
  const stat = owned || findCatalogEntry('skills', skillId)?.system?.stat;
  return STATS.includes(stat) ? stat : 'str';
}

/**
 * The fixed result a `fixed` participant takes on a leg: `10 + Stat Mod + Floor + Move Rate Modifier` plus the
 * Debuff shift and flat check rows (Q5 a). `parts` and `text` show every term.
 * @returns {{ total: number, parts: Array<{ key: string, value: number }>, text: string }|null} null when the actor does not resolve
 */
export function computeFixedResult(state, participant, leg, resolve = resolveActorByUuid) {
  const actor = resolve(participant.actorUuid);
  if (!actor) return null;
  const { skill, overridden } = participantLegSkill(participant, leg);
  const stat = overridden ? governingStat(actor, skill) : leg.check.stat;
  const statMod = Number(actor.system?.abilities?.[stat]?.mod) || 0;
  const move = contestMoveOf(participant, leg, resolve);
  const context = buildRollContext({
    actor, phase: 'check', check: skill ? 'skill' : 'stat', stat, tags: [CONTEST_TAGS[state.kind]]
  });
  const shift = mobDifficultyShift(actor, MOB_QUALITIES.check, { context, fixed: true }).shift;
  const flat = collectCheckModifiers(actor, context).flatBonus || 0;
  const result = fixedResult({ statMod, floor: state.floor, moveMod: moveRateMod(move.move), adjust: shift + flat });
  const labels = { base: 'base', stat: stat.toUpperCase(), floor: 'Floor', move: 'Move Rate', adjust: 'adjust' };
  const text = result.parts
    .filter((p) => p.key === 'base' || p.value !== 0)
    .map((p) => (p.key === 'base' ? `${p.value}` : `${p.value > 0 ? '+' : '-'} ${Math.abs(p.value)} ${labels[p.key]}`))
    .join(' ');
  return { ...result, text };
}

// ---------------------------------------------------------------------------------------------------------------
// Operations the tracker (3.45-5) and the card call. All are GM writes through `updateContest`.

/**
 * Open a leg: it becomes `open`, status `leg`, and every `fixed` participant who is still in gets a fixed result
 * (unless the GM already typed one). Any other open leg is left alone; the GM closes legs explicitly.
 */
export function openLeg(contestId, legId) {
  return updateContest(contestId, (state, { resolve }) => {
    const leg = state.legs.find((l) => l.id === legId);
    if (!leg) return false;
    leg.status = 'open';
    state.status = 'leg';
    const row = state.results[leg.id] ?? (state.results[leg.id] = {});
    for (const p of state.participants) {
      if (p.mode !== 'fixed' || p.out || row[p.id]?.source === 'gm') continue;
      const fixed = computeFixedResult(state, p, leg, resolve);
      if (fixed) row[p.id] = { total: fixed.total, d20: null, source: 'fixed', messageId: null, ruleBreak: false, note: fixed.text };
    }
  });
}

/** Close a leg; when it was the last one the contest is done. */
export function closeLeg(contestId, legId) {
  return updateContest(contestId, (state) => {
    const leg = state.legs.find((l) => l.id === legId);
    if (!leg) return false;
    leg.status = 'closed';
    if (state.legs.every((l) => l.status === 'closed')) state.status = 'done';
  });
}

/** The GM types a result (source `gm`); ingest never replaces it. A non-finite total is refused. */
export function setGmResult(contestId, legId, participantId, total, note = '') {
  const n = Number(total);
  if (total === null || total === '' || typeof total === 'boolean' || !Number.isFinite(n)) return Promise.resolve({ ok: false, reason: 'bad-total' });
  return updateContest(contestId, (state) => {
    const leg = state.legs.find((l) => l.id === legId);
    if (!leg || !state.participants.some((p) => p.id === participantId)) return false;
    const row = state.results[leg.id] ?? (state.results[leg.id] = {});
    row[participantId] = { total: n, d20: null, source: 'gm', messageId: null, ruleBreak: false, note: typeof note === 'string' ? note : '' };
  });
}

/** Mark a participant out (dropped, or a reason the GM names) from `legId`. */
export function markParticipantOut(contestId, participantId, legId = null, reason = 'dropped') {
  return updateContest(contestId, (state) => {
    const p = state.participants.find((x) => x.id === participantId);
    if (!p || p.out) return false;
    p.out = { leg: state.legs.some((l) => l.id === legId) ? legId : null, reason };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Skill overrides (D3): the GM sets or accepts a different skill for one participant on one leg.

const skillText = (raw) => {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  return typeof val === 'string' ? val.trim().slice(0, 120) : '';
};

/** The GM sets (or, with a blank skill, clears) the accepted override for a participant on a leg. A pending proposal for that leg is dropped. */
export function setSkillOverride(contestId, participantId, legId, skill) {
  const id = skillText(skill);
  return updateContest(contestId, (state) => {
    const p = state.participants.find((x) => x.id === participantId);
    if (!p || !state.legs.some((l) => l.id === legId)) return false;
    if (id) p.skillOverrides[legId] = id; else delete p.skillOverrides[legId];
    delete p.skillProposals[legId];
  });
}

/** The GM accepts the pending proposal for a participant on a leg: it becomes the override. */
export function acceptSkillProposal(contestId, participantId, legId) {
  return updateContest(contestId, (state) => {
    const p = state.participants.find((x) => x.id === participantId);
    const proposed = p?.skillProposals?.[legId];
    if (!proposed) return false;
    p.skillOverrides[legId] = proposed;
    delete p.skillProposals[legId];
  });
}

/** The GM rejects the pending proposal for a participant on a leg. */
export function dismissSkillProposal(contestId, participantId, legId) {
  return updateContest(contestId, (state) => {
    const p = state.participants.find((x) => x.id === participantId);
    if (!p?.skillProposals?.[legId]) return false;
    delete p.skillProposals[legId];
  });
}

/** Record a player's proposal (the relay calls this on the GM client); it never changes the override. */
export function recordSkillProposal(contestId, participantId, legId, skill) {
  const id = skillText(skill);
  if (!id) return Promise.resolve({ ok: false, reason: 'bad-skill' });
  return updateContest(contestId, (state) => {
    const p = state.participants.find((x) => x.id === participantId);
    if (!p || !state.legs.some((l) => l.id === legId)) return false;
    p.skillProposals[legId] = id;
  });
}

/** End the contest now: every leg that is not closed is closed, and the status is `done`. */
export function endContest(contestId) {
  return updateContest(contestId, (state) => {
    for (const leg of state.legs) if (leg.status !== 'closed') leg.status = 'closed';
    state.status = 'done';
  });
}
