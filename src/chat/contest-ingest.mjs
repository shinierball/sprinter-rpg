/**
 * src/chat/contest-ingest.mjs
 * How a leg roll reaches a contest card.
 *
 * A player rolls a leg locally with `options.contest`; the skill card then carries a check record whose `contest`
 * reference names the contest, leg and participant. The one active GM ingests that card in a `createChatMessage` /
 * `updateChatMessage` hook. The contest card itself counts only when a GM wrote it (`readContest`). Nothing the player sends carries a total: the result is `effectiveCheck(readCheckRecord(msg))`
 * read from the GM's own copy of the roll card, so the GM never takes a total from the request (the check record is the roller's own roll card: the accepted own-roll trust), a reroll (a newer card) replaces the old
 * result, and an Intervene assist written later flows in through the update hook.
 *
 * Ingest refuses (and logs at debug level): a card with no contest reference, an unknown contest (an orphaned roll
 * card, D2a), leg or participant, a mob or fixed participant (they never roll), a roller who is not the participant, an
 * author who is neither a GM nor an owner of the roller, a card older than the stored result, and a GM-typed result
 * (pinned). A roll for a leg that is not open, or by a participant who is out, is recorded with `ruleBreak: true`.
 *
 * The `contestRequest` relay action carries player requests that are not rolls (`drop`, `propose`): the GM checks the requester
 * owns the participant's actor from socketlib's envelope, never from the payload.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';
import { isActiveGM, registerRelayAction, requestRelay } from '../utils/gm-relay.mjs';
import { readCheckRecord, effectiveCheck } from '../utils/check-assists.mjs';
import { confirmRuleBreak } from '../utils/rule-break.mjs';
import { findCatalogEntry } from '../content/catalog-lookup.mjs';
import { skillStandIn } from '../utils/skill-stand-in.mjs';
import { contestMoveOf, moveRateMod, participantLegSkill } from '../utils/contest/contest-engine.mjs';
import { readContest, participantIsOut } from './contest-card.mjs';
import { findContestMessage, updateContest, markParticipantOut, recordSkillProposal } from './contest-service.mjs';
import { isTrustedAssist } from './actions/use-assist.mjs';

/** Relay action for player requests on a contest that are not rolls. */
export const CONTEST_RELAY = 'contestRequest';
/** Chat-message flag a roll client sets when it confirmed a Rule Break the GM cannot derive (a different skill). */
export const CONTEST_RULE_BREAK_FLAG = 'contestRuleBreak';

const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 120) : '');

function flagOf(message, key) {
  return typeof message?.getFlag === 'function' ? message.getFlag(SYSTEM_ID, key) : message?.flags?.[SYSTEM_ID]?.[key];
}

// ---------------------------------------------------------------------------------------------------------------
// Ingest

const ingestQueues = new Map();

/**
 * Take a leg roll card into its contest (active GM only).
 * @param {object} rollMessage the skill card
 * @returns {Promise<{ ingested?: boolean, skipped?: string, ruleBreak?: boolean }>}
 */
export function ingestContestRoll(rollMessage) {
  const record = readCheckRecord(rollMessage);
  const ref = record?.contest;
  if (!ref?.messageId) return Promise.resolve({ skipped: 'no-reference' });
  if (!isActiveGM()) return Promise.resolve({ skipped: 'not-active-gm' });
  const key = ref.messageId;
  const run = (ingestQueues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => ingestNow(rollMessage, record));
  ingestQueues.set(key, run);
  run.finally(() => { if (ingestQueues.get(key) === run) ingestQueues.delete(key); }).catch(() => {});
  return run;
}

async function ingestNow(rollMessage, record) {
  const ref = record.contest;
  const cardMessage = findContestMessage(ref.messageId);
  if (!cardMessage) {
    console.debug(`Sprinter RPG | Contest roll ignored: no contest card for ${ref.messageId} (re-post the card to continue).`);
    return { skipped: 'orphan' };
  }
  const state0 = readContest(cardMessage).state;
  const leg0 = state0.legs.find((l) => l.id === ref.legId);
  const p0 = state0.participants.find((p) => p.id === ref.participantId);
  if (!leg0 || !p0) return { skipped: 'unknown-target' };
  const actor = resolveActorByUuid(p0.actorUuid);
  if (!actor || actor.type === 'mob' || p0.mode === 'fixed') return { skipped: 'fixed' };
  if (record.rollerUuid !== p0.actorUuid) return { skipped: 'wrong-roller' };
  if (!isTrustedAssist(rollMessage, actor)) return { skipped: 'untrusted' };
  const eff = effectiveCheck(record);
  if (!eff) return { skipped: 'no-record' };

  let outcome = { skipped: 'unchanged' };
  const res = await updateContest(ref.messageId, (state, { resolve }) => {
    const leg = state.legs.find((l) => l.id === ref.legId);
    const p = state.participants.find((x) => x.id === ref.participantId);
    if (!leg || !p) { outcome = { skipped: 'unknown-target' }; return false; }
    const row = state.results[leg.id] ?? (state.results[leg.id] = {});
    const old = row[p.id];
    if (old?.source === 'gm') { outcome = { skipped: 'pinned' }; return false; }
    const oldMessage = old?.messageId && old.messageId !== rollMessage.id ? globalThis.game?.messages?.get?.(old.messageId) : null;
    if (oldMessage && Number(oldMessage.timestamp) > Number(rollMessage.timestamp)) { outcome = { skipped: 'stale' }; return false; }
    const ruleBreak = leg.status !== 'open' || participantIsOut(state, p.id, resolve) || flagOf(rollMessage, CONTEST_RULE_BREAK_FLAG) === true;
    const next = { total: eff.total, d20: record.d20, source: 'roll', messageId: rollMessage.id ?? null, ruleBreak, note: '' };
    if (old && old.source === 'roll' && old.total === next.total && old.d20 === next.d20 && old.messageId === next.messageId && old.ruleBreak === next.ruleBreak) {
      outcome = { skipped: 'unchanged' };
      return false;
    }
    row[p.id] = next;
    outcome = { ingested: true, ruleBreak };
  });
  if (!res.ok && res.reason === 'no-contest') return { skipped: 'orphan' };
  return outcome;
}

// ---------------------------------------------------------------------------------------------------------------
// Deleting the card (D2a)

const pendingDeletes = new Set();

/**
 * `preDeleteChatMessage` handler. Foundry v14 calls this hook once per message, including for each message of a
 * "Clear Chat Log" (`deleteAll`), on the deleting client only. A contest card asks the deleting GM first (the hook
 * cannot wait for a dialog, so it cancels the delete, asks, and deletes again with `contestDeleteConfirmed`).
 * Any other message passes through.
 * @returns {false|undefined} false cancels the deletion
 */
export function guardContestDelete(message, options, userId) {
  if (!readContest(message)) return undefined;
  if (options?.contestDeleteConfirmed === true) return undefined;
  if (userId !== globalThis.game?.user?.id || !globalThis.game?.user?.isGM) return undefined;
  if (!pendingDeletes.has(message.id)) {
    pendingDeletes.add(message.id);
    askDeleteContest(message).finally(() => pendingDeletes.delete(message.id)).catch(() => {});
  }
  return false;
}

async function askDeleteContest(message) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.confirm !== 'function') return false;
  let yes;
  try {
    yes = await DialogV2.confirm({
      window: { title: 'Delete Contest Card' },
      content: '<p>This ends the contest. Delete anyway?</p>',
      modal: true
    });
  } catch {
    return false;
  }
  if (yes === true) await message.delete({ contestDeleteConfirmed: true });
  return yes === true;
}

// ---------------------------------------------------------------------------------------------------------------
// Rolling a leg (the Roll button, and the API the tracker calls)

/**
 * Roll one participant's check for a leg, asking the Rule Break where the book's limits are exceeded (never blocking).
 * The roll carries `options.contest`; the GM ingests the resulting card.
 * @param {object} p
 * @param {object} p.message the contest card
 * @param {string} p.legId
 * @param {string} p.participantId
 * @param {string} [p.skillId] a skill other than the leg's or the participant's accepted override (a Rule Break)
 * @returns {Promise<{ ok: boolean, reason?: string, message?: object, ruleBreak?: boolean }>}
 */
export async function rollContestLeg({ message, legId, participantId, skillId = null } = {}) {
  const wrapper = readContest(message);
  if (!wrapper) return { ok: false, reason: 'no-contest' };
  const { state } = wrapper;
  const leg = state.legs.find((l) => l.id === legId);
  const participant = state.participants.find((p) => p.id === participantId);
  if (!leg || !participant) return { ok: false, reason: 'unknown-target' };
  const actor = resolveActorByUuid(participant.actorUuid);
  if (!actor) return { ok: false, reason: 'no-actor' };
  if (participant.mode === 'fixed' || actor.type === 'mob') return { ok: false, reason: 'fixed' };
  if (!globalThis.game?.user?.isGM && !actor.isOwner) return { ok: false, reason: 'not-owner' };

  let ruleBreak = false;
  const ask = async (messageText) => {
    const res = await confirmRuleBreak({ title: 'Contest Rule Break', message: messageText });
    if (res.confirmed) ruleBreak = true;
    return res.confirmed;
  };
  if (leg.status !== 'open') {
    const word = leg.status === 'closed' ? 'closed' : 'not open yet';
    if (!(await ask(`${leg.label} is ${word}. Record this roll anyway as a Rule Break?`))) return { ok: false, reason: 'cancelled' };
  }
  if (participantIsOut(state, participant.id, resolveActorByUuid)) {
    if (!(await ask(`${participant.name} is out of this contest. Roll again anyway as a Rule Break?`))) return { ok: false, reason: 'cancelled' };
  }
  const wantSkill = str(skillId) || null;
  const assigned = participantLegSkill(participant, leg).skill; // the accepted override, else the leg's skill (D3)
  const differs = Boolean(wantSkill) && wantSkill !== assigned;
  if (differs && !(await ask(`${leg.label} calls for ${assigned ?? leg.check.stat.toUpperCase()}, not ${wantSkill}. Roll it anyway as a Rule Break?`))) {
    return { ok: false, reason: 'cancelled' };
  }

  const move = contestMoveOf(participant, leg, resolveActorByUuid);
  const contest = {
    kind: state.kind, messageId: wrapper.id, legId: leg.id, participantId: participant.id,
    moveMod: moveRateMod(move.move), moveNote: `Move ${move.move}`
  };
  const useSkill = wantSkill ?? assigned;
  const rolled = useSkill
    ? await actor.rollSkill(skillStandIn(actor, useSkill), { contest })
    : await actor.rollStat(leg.check.stat, { contest });
  if (rolled && differs && typeof rolled.update === 'function') {
    await rolled.update({ [`flags.${SYSTEM_ID}.${CONTEST_RULE_BREAK_FLAG}`]: true });
  }
  return { ok: Boolean(rolled), message: rolled ?? undefined, ruleBreak };
}

// ---------------------------------------------------------------------------------------------------------------
// The relay: player requests that are not rolls

const REQUEST_OPS = Object.freeze(['drop', 'propose']);

/** The leg a proposal is for: the named leg if it exists, else the open leg, else the first pending one. */
function proposalLeg(state, legId) {
  return state.legs.find((l) => l.id === legId)
    ?? state.legs.find((l) => l.status === 'open')
    ?? state.legs.find((l) => l.status === 'pending')
    ?? null;
}

function checkRequest(payload, user) {
  const op = str(payload?.op);
  const contestId = str(payload?.contestId);
  const participantId = str(payload?.participantId);
  if (!REQUEST_OPS.includes(op) || !contestId || !participantId) return { ok: false };
  const wrapper = readContest(findContestMessage(contestId));
  const participant = wrapper?.state.participants.find((p) => p.id === participantId);
  if (!participant) return { ok: false };
  const actor = resolveActorByUuid(participant.actorUuid);
  const base = { ok: true, op, contestId, participantId, wrapper };
  if (op === 'propose') {
    // A skill identifier only: it must be a catalog skill or one the participant's actor owns (never free text).
    const skill = str(payload?.skill);
    const known = Boolean(skill) && (Boolean(findCatalogEntry('skills', skill)) || Boolean(actor?.getSkillByIdentifier?.(skill)));
    const leg = proposalLeg(wrapper.state, str(payload?.legId));
    if (!known || !leg) return { ok: false };
    Object.assign(base, { skill, legId: leg.id });
  }
  if (user?.isGM) return base;
  // Only the actor's owner, and only for a participant who rolls (a fixed one is the GM's).
  if (!actor || participant.mode !== 'roll' || actor.type === 'mob' || !actor.testUserPermission?.(user, 'OWNER')) return { ok: false };
  return base;
}

registerRelayAction(CONTEST_RELAY, {
  authorize: (payload, user) => checkRequest(payload, user).ok,
  async apply(payload, user) {
    const req = checkRequest(payload, user);
    if (!req.ok) return { ok: false, reason: 'rejected' };
    if (req.op === 'propose') return recordSkillProposal(req.contestId, req.participantId, req.legId, req.skill);
    const open = req.wrapper.state.legs.find((l) => l.status === 'open') ?? null;
    return markParticipantOut(req.contestId, req.participantId, open?.id ?? null, 'dropped');
  }
});

function relayOutcome(res) {
  if (!res.ok) return { ok: false, reason: res.reason ?? 'error' };
  return res.result && typeof res.result === 'object' ? { ok: res.result.ok !== false, reason: res.result.reason } : { ok: true };
}

/**
 * Ask to drop a participant out of a contest: a GM writes directly, a player asks the GM through the relay.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function requestContestDrop(contestId, participantId) {
  return relayOutcome(await requestRelay(CONTEST_RELAY, { op: 'drop', contestId: str(contestId), participantId: str(participantId) }));
}

/**
 * Propose a different skill for a participant on a leg (D3). Only a skill identifier travels; the GM sees the
 * proposal in the tracker and accepts or dismisses it, so asking never changes the roll rules by itself.
 * @param {string} contestId
 * @param {string} participantId
 * @param {string} skillId catalog or owned skill `system.identifier`
 * @param {string} [legId] defaults to the open leg
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function requestContestSkill(contestId, participantId, skillId, legId = '') {
  return relayOutcome(await requestRelay(CONTEST_RELAY, {
    op: 'propose', contestId: str(contestId), participantId: str(participantId), skill: str(skillId), legId: str(legId)
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Hooks

let hooksRegistered = false;

/** Register the ingest and delete-guard hooks (once). Called from the ready hook. */
export function registerContestHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  // Returns the promise so a test can await it; Foundry ignores a hook's return value except `false`.
  const onMessage = (message) => ingestContestRoll(message).catch((err) => console.warn('Sprinter RPG | Contest ingest failed', err));
  globalThis.Hooks?.on?.('createChatMessage', onMessage);
  globalThis.Hooks?.on?.('updateChatMessage', onMessage);
  globalThis.Hooks?.on?.('preDeleteChatMessage', guardContestDelete);
}

/** Tests only. */
export function resetContestHooks() {
  hooksRegistered = false;
  pendingDeletes.clear();
}
