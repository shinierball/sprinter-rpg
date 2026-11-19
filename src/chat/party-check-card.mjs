/**
 * src/chat/party-check-card.mjs
 * The party check chat card (core pp. 59-60): the GM starts it, each participant rolls the Skill Check from it, and the
 * active GM writes every member's degree onto it (the ingest, party-check-ingest.mjs). The state lives on the message under
 * `flags.sprinter-rpg.partyCheck`; the HTML is rebuilt from it, so the card can always be re-rendered. A participant's skill card
 * carries `party: { messageId, participantId }` in its check record, where `messageId` is this card's own message id.
 * Only a GM-authored message counts as a party card (`readPartyCheck`).
 */
import { flagPath, readFlag, withFlags, forcedReplacement } from '../utils/flags.mjs';
import { isGmAuthored } from './chat-relay.mjs';
import { partyCheckTally, MAX_PARTY_PARTICIPANTS } from '../data/rules/party-check-rules.mjs';
import { COG_ROLL_OUTCOMES, COG_OUTCOME_CONFIG } from '../documents/session/roll-outcomes.mjs';
import { DIFFICULTY_MODES } from '../data/rules/difficulty-rules.mjs';
import { difficultyLineText, difficultyText } from '../utils/roll/check-difficulty.mjs';
import { ruleBreakBadgeHtml } from '../utils/rule-break-visibility.mjs';
import { escapeAttr } from '../utils/escape-attr.mjs';

const PARTY_CHECK_FLAG = 'partyCheck';
const PARTY_CHECK_ACTIONS = Object.freeze({ roll: 'crawlerPartyCheckRoll', remove: 'crawlerPartyCheckRemove', difficulty: 'crawlerPartyCheckDifficulty' });
const STATE_VERSION = 1;
const OUTCOME_IDS = Object.freeze(Object.values(COG_ROLL_OUTCOMES));

/** English fallbacks of the `COG.PartyCheck.*` keys in lang/en.json (the headless test world has no i18n). */
const TEXT = Object.freeze({
  Alias: 'Party Check',
  Title: 'Party Check: {skill}',
  DialogTitle: 'Start a Party Check',
  Skill: 'Skill',
  Participants: 'Participants',
  Difficulty: 'Difficulty',
  None: 'None',
  Unopposed: 'Unopposed',
  Opposed: 'Opposed against {foe}',
  Number: 'A number',
  Start: 'Start',
  Waiting: 'Waiting',
  Roll: 'Roll',
  Remove: 'Remove',
  Button: 'Party Check',
  ChangeDifficulty: 'Change Difficulty',
  OpposedMode: 'Opposed',
  NumberLabel: 'Difficulty number',
  Set: 'Set',
  Clear: 'Clear',
  RollAgainTitle: 'Roll Again',
  RollAgainConfirm: '{name} already rolled. Roll again as a Rule Break?',
  Tally: '{successes} of {size} succeed, {needed} needed',
  FlipUp: '{n} Amazing turns a Failure into a Success',
  FlipDown: '{n} Major Fail turns a Success into a Failure',
  Succeeds: 'PARTY SUCCEEDS',
  Fails: 'PARTY FAILS',
  GmOnly: 'Only the GM can start a party check.',
  GmOnlyControl: 'Only the GM can change a party check.',
  NotParticipant: 'You are not on this party check.'
});

/** `COG.PartyCheck.<key>` through `game.i18n` when it knows the key, else the English fallback. */
export function partyText(key, data = {}) {
  const full = `COG.PartyCheck.${key}`;
  const i18n = globalThis.game?.i18n;
  try {
    const s = Object.keys(data).length ? i18n?.format?.(full, data) : i18n?.localize?.(full);
    if (typeof s === 'string' && s && s !== full) return s;
  } catch {
    // fall through to the fallback
  }
  return Object.entries(data).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), TEXT[key] ?? full);
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (raw, max = 120) => {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  return typeof val === 'string' ? val.trim().slice(0, max) : '';
};
const whole = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

/** The Difficulty a card holds: the `difficulty` record of 9.2 (mode, value, floor, foe, stat, mod, shift) or null. */
function sanitizeDifficulty(raw) {
  if (!isPlain(raw) || !DIFFICULTY_MODES.includes(raw.mode) || raw.value === null || raw.value === '' || !Number.isFinite(Number(raw.value))) return null;
  return {
    mode: raw.mode, value: Math.max(0, whole(raw.value)), floor: Math.max(0, whole(raw.floor)),
    foeUuid: text(raw.foeUuid), foeName: text(raw.foeName), stat: text(raw.stat, 8), mod: whole(raw.mod), shift: whole(raw.shift)
  };
}

function sanitizeParticipant(raw, index) {
  if (!isPlain(raw)) return null;
  const actorUuid = text(raw.actorUuid, 200);
  if (!actorUuid) return null;
  const outcome = OUTCOME_IDS.includes(raw.outcome) ? raw.outcome : '';
  const total = typeof raw.total === 'number' && Number.isFinite(raw.total) ? raw.total : null;
  return {
    id: text(raw.id, 64) || `p${index + 1}`, actorUuid, name: text(raw.name) || actorUuid, removed: raw.removed === true,
    messageId: text(raw.messageId, 64), outcome, total, at: Math.max(0, whole(raw.at)), ruleBreak: raw.ruleBreak === true
  };
}

/**
 * A party check state, cleaned. Unknown shapes give an empty card (no skill, no participants).
 * @param {unknown} raw
 */
function sanitizePartyCheck(raw) {
  const src = isPlain(raw) ? raw : {};
  const seen = new Set();
  const participants = [];
  for (const [i, p] of (Array.isArray(src.participants) ? src.participants : []).entries()) {
    const clean = sanitizeParticipant(p, i);
    if (!clean || seen.has(clean.id) || participants.length >= MAX_PARTY_PARTICIPANTS) continue;
    seen.add(clean.id);
    participants.push(clean);
  }
  const skill = isPlain(src.skill) ? src.skill : {};
  const difficulty = sanitizeDifficulty(src.difficulty);
  return {
    v: STATE_VERSION,
    skill: { identifier: text(skill.identifier), name: text(skill.name) },
    difficulty,
    dc: difficulty ? difficulty.value : null,
    participants,
    createdAt: Math.max(0, whole(src.createdAt))
  };
}

/** The participants still on the card (a removed one is out of the count). */
const activeParticipants = (state) => state.participants.filter((p) => !p.removed);

/** The tally of a card's state (`partyCheckTally` over the participants still on it). */
function tallyOf(state) {
  return partyCheckTally(activeParticipants(state).map((p) => p.outcome || null));
}

/** The spec a member's roll is born with (`options.difficulty` of `rollSkill`): the card's Difficulty, or null. */
export function difficultySpecOf(state) {
  const d = state.difficulty;
  if (!d) return null;
  return { mode: d.mode, value: d.value, stat: d.stat, foe: { uuid: d.foeUuid, name: d.foeName, mod: d.mod, shift: d.shift } };
}

/** The sanitised party state on a chat message, or null when it is not a party card. Only a GM-authored message counts. */
export function readPartyCheck(message) {
  if (!message || !isGmAuthored(message)) return null;
  const raw = readFlag(message, PARTY_CHECK_FLAG);
  return isPlain(raw) ? sanitizePartyCheck(raw) : null;
}

/** The chat message with this id, or null. */
export function findPartyMessage(messageId) {
  if (typeof messageId !== 'string' || !messageId) return null;
  return globalThis.game?.messages?.get?.(messageId) ?? null;
}

function participantRow(p) {
  const cfg = COG_OUTCOME_CONFIG[p.outcome];
  const result = p.messageId
    ? `<strong class="cog-party-total">${escapeAttr(p.total ?? '')}</strong>${cfg ? ` <span class="cog-check-degree ${escapeAttr(cfg.class)}">${escapeAttr(cfg.label)}</span>` : ''}`
    : `<span class="cog-party-waiting">${escapeAttr(partyText('Waiting'))}</span>`;
  const badge = p.ruleBreak ? ` ${ruleBreakBadgeHtml()}` : '';
  const remove = `<button type="button" class="cog-party-remove" data-gm-only="true" data-action="${escapeAttr(PARTY_CHECK_ACTIONS.remove)}" data-participant-id="${escapeAttr(p.id)}" title="${escapeAttr(partyText('Remove'))}"><i class="fa-solid fa-xmark"></i></button>`;
  const roll = `<button type="button" class="cog-party-roll" data-action="${escapeAttr(PARTY_CHECK_ACTIONS.roll)}" data-participant-id="${escapeAttr(p.id)}" data-actor-uuid="${escapeAttr(p.actorUuid)}">${escapeAttr(partyText('Roll'))}</button>`;
  return `<tr class="cog-party-row" data-participant-id="${escapeAttr(p.id)}"><td>${escapeAttr(p.name)}</td><td>${result}${badge}</td><td>${roll}${remove}</td></tr>`;
}

/** The GM's Difficulty controls (the 9.2 modes on one card): Unopposed, Opposed, a number with Set, and Clear once one is set. */
function difficultyControlsHtml(state) {
  const act = escapeAttr(PARTY_CHECK_ACTIONS.difficulty);
  const btn = (mode, label) => `<button type="button" class="cog-assist-offer-btn" data-action="${act}" data-mode="${escapeAttr(mode)}">${escapeAttr(label)}</button>`;
  return `<details class="cog-party-difficulty-controls" data-gm-only="true"><summary>${escapeAttr(partyText('ChangeDifficulty'))}</summary>
      <div class="cog-party-difficulty-modes">${btn('unopposed', partyText('Unopposed'))}${btn('opposed', partyText('OpposedMode'))}</div>
      <div class="cog-party-difficulty-typed"><input type="number" min="0" step="1" aria-label="${escapeAttr(partyText('NumberLabel'))}">${btn('typed', partyText('Set'))}${state.difficulty ? btn('clear', partyText('Clear')) : ''}</div>
    </details>`;
}

/**
 * The card's HTML from a state (pure; every name is escaped).
 * @param {object} rawState
 * @returns {string}
 */
function partyCheckCardHtml(rawState) {
  const state = sanitizePartyCheck(rawState);
  const tally = tallyOf(state);
  const rows = activeParticipants(state).map(participantRow).join('');
  const line = state.difficulty ? difficultyLineText(state.difficulty) : difficultyText('NotSet');
  const flips = [
    tally.flippedUp ? partyText('FlipUp', { n: tally.flippedUp }) : '',
    tally.flippedDown ? partyText('FlipDown', { n: tally.flippedDown }) : ''
  ].filter(Boolean);
  const tallyLine = [partyText('Tally', { successes: tally.successes, size: tally.size, needed: tally.needed }), ...flips].join(' · ');
  const verdict = tally.verdict === 'success' || tally.verdict === 'failure'
    ? `<div class="cog-party-verdict cog-party-${escapeAttr(tally.verdict)}">${escapeAttr(partyText(tally.verdict === 'success' ? 'Succeeds' : 'Fails'))}</div>`
    : '';
  const anyBreak = state.participants.some((p) => p.ruleBreak);
  return `<div class="cog-chat-card cog-party-card" data-party-verdict="${escapeAttr(tally.verdict)}">
    <div class="cog-party-title"><i class="fa-solid fa-people-group"></i> ${escapeAttr(partyText('Title', { skill: state.skill.name || state.skill.identifier }))}${anyBreak ? ` ${ruleBreakBadgeHtml()}` : ''}</div>
    <div class="cog-party-difficulty">${escapeAttr(line)}</div>
    ${difficultyControlsHtml(state)}
    <table class="cog-party-table"><tbody>${rows}</tbody></table>
    <div class="cog-party-tally">${escapeAttr(tallyLine)}</div>
    ${verdict}
  </div>`;
}

/**
 * Post a new party check card (GM only).
 * @param {{ skill: { identifier: string, name: string }, difficulty?: object|null, participants: Array<{ actorUuid: string, name: string }> }} spec
 * @returns {Promise<object|null>} the message; null for a non-GM, or when the card could not be created
 */
export async function postPartyCheckCard(spec) {
  if (!globalThis.game?.user?.isGM) return null;
  const state = sanitizePartyCheck({ ...spec, createdAt: Date.now() });
  const message = await globalThis.ChatMessage?.create?.(withFlags({ speaker: { alias: partyText('Alias') }, content: partyCheckCardHtml(state) }, { [PARTY_CHECK_FLAG]: state }));
  return message ?? null;
}

const queues = new Map();

/**
 * Change a party card through a reducer, then write the state and the re-rendered card together (GM only). Calls for one
 * card run one after another; the state is re-read from the message inside the queue. The reducer gets a sanitised copy and
 * returns the new state, nothing (it changed the copy), or `false` to leave the card untouched.
 * @param {string} messageId
 * @param {(state: object) => (object|false|void|Promise<object|false|void>)} reducer
 * @returns {Promise<{ ok: boolean, reason?: string, state?: object }>}
 */
export function updatePartyCheck(messageId, reducer) {
  if (!globalThis.game?.user?.isGM) return Promise.resolve({ ok: false, reason: 'not-gm' });
  const run = (queues.get(messageId) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const message = findPartyMessage(messageId);
    const current = message ? readPartyCheck(message) : null;
    if (!current) return { ok: false, reason: 'no-party-check' };
    const draft = sanitizePartyCheck(JSON.parse(JSON.stringify(current)));
    const out = await reducer(draft);
    if (out === false) return { ok: false, reason: 'unchanged' };
    const next = sanitizePartyCheck(out ?? draft);
    await message.update({ content: partyCheckCardHtml(next), [flagPath(PARTY_CHECK_FLAG)]: forcedReplacement(next) });
    return { ok: true, state: next };
  });
  queues.set(messageId, run);
  run.finally(() => { if (queues.get(messageId) === run) queues.delete(messageId); }).catch(() => {});
  return run;
}
