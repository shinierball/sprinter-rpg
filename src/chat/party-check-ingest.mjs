/**
 * src/chat/party-check-ingest.mjs
 * How a participant's roll reaches a party check card (the contest pattern, contest-ingest.mjs). A participant rolls from
 * the card with `options.partyCheck`; the skill card then carries a check record whose `party` reference names the card and
 * the participant. The one active GM reads the degree and total from their own copy of that roll card
 * (`effectiveCheck(readCheckRecord(msg))`, never from a request) and writes them onto the party card in a
 * `createChatMessage` / `updateChatMessage` hook. A newer card for the same participant replaces the old one; an update of the
 * current one (an AI Favor reroll, an Intervene, a Difficulty set) refreshes it.
 *
 * Ingest refuses (and logs at debug level): a card with no reference, an unknown party card or participant (or one removed),
 * a roller who is not the participant, an author who is neither a GM nor an owner of the roller, and a card older than the
 * stored result.
 */
import { isMigrationWrite } from '../documents/migrations/world-migration.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';
import { isActiveGM } from '../utils/gm-relay.mjs';
import { readCheckRecord, effectiveCheck } from '../utils/roll/check-assists.mjs';
import { readPartyCheck, findPartyMessage, updatePartyCheck } from './party-check-card.mjs';
import { isTrustedAssist } from './actions/use-assist.mjs';

const queues = new Map();

/**
 * Take a participant's roll card into its party card (active GM only).
 * @param {object} rollMessage the skill card
 * @returns {Promise<{ ingested?: boolean, skipped?: string }>}
 */
function ingestPartyRoll(rollMessage) {
  const record = readCheckRecord(rollMessage);
  const ref = record?.party;
  if (!ref?.messageId) return Promise.resolve({ skipped: 'no-reference' });
  if (!isActiveGM()) return Promise.resolve({ skipped: 'not-active-gm' });
  const key = ref.messageId;
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => ingestNow(rollMessage, record));
  queues.set(key, run);
  run.finally(() => { if (queues.get(key) === run) queues.delete(key); }).catch(() => {});
  return run;
}

async function ingestNow(rollMessage, record) {
  const ref = record.party;
  const state0 = readPartyCheck(findPartyMessage(ref.messageId));
  if (!state0) {
    console.debug(`Sprinter RPG | Party roll ignored: no party check card for ${ref.messageId}.`);
    return { skipped: 'orphan' };
  }
  const p0 = state0.participants.find((p) => p.id === ref.participantId && !p.removed);
  if (!p0) return { skipped: 'unknown-target' };
  const actor = resolveActorByUuid(p0.actorUuid);
  if (!actor) return { skipped: 'no-actor' };
  if (record.rollerUuid !== p0.actorUuid) return { skipped: 'wrong-roller' };
  if (!isTrustedAssist(rollMessage, actor)) return { skipped: 'untrusted' };
  const eff = effectiveCheck(record);
  if (!eff) return { skipped: 'no-record' };

  let outcome = { skipped: 'unchanged' };
  const res = await updatePartyCheck(ref.messageId, (state) => {
    const p = state.participants.find((x) => x.id === ref.participantId && !x.removed);
    if (!p) { outcome = { skipped: 'unknown-target' }; return false; }
    const oldMessage = p.messageId && p.messageId !== rollMessage.id ? globalThis.game?.messages?.get?.(p.messageId) : null;
    if (oldMessage && Number(oldMessage.timestamp) > Number(rollMessage.timestamp)) { outcome = { skipped: 'stale' }; return false; }
    const next = { messageId: rollMessage.id ?? '', outcome: eff.outcome, total: eff.total, at: Number(rollMessage.timestamp) || 0 };
    if (p.messageId === next.messageId && p.outcome === next.outcome && p.total === next.total) return false;
    // A newer card replacing a different one is a second roll: it was asked as a Rule Break (D12) and the row says so.
    Object.assign(p, next, p.messageId && p.messageId !== next.messageId ? { ruleBreak: true } : {});
    outcome = { ingested: true };
  });
  if (!res.ok && res.reason === 'no-party-check') return { skipped: 'orphan' };
  return outcome;
}

let hooksRegistered = false;

/** Register the ingest hooks (once). Called from the ready hook. */
export function registerPartyCheckHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  // Returns the promise so a test can await it; Foundry ignores a hook's return value except `false`.
  const onMessage = (message) => ingestPartyRoll(message).catch((err) => console.warn('Sprinter RPG | Party check ingest failed', err));
  globalThis.Hooks?.on?.('createChatMessage', onMessage);
  // A migration write converts a card's stored data; it is not a new roll to ingest.
  globalThis.Hooks?.on?.('updateChatMessage', (message, _changes, options) => (isMigrationWrite(options) ? undefined : onMessage(message)));
}
