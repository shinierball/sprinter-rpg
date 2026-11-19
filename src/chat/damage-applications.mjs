/**
 * Display-only index of the damage applications made from a chat card
 * Nothing reads authority from it: undo finds its real
 * records on the target actor, the Combat, the ledger and the kill trophy.
 *
 * Entries are written with dotted updates so two targets or two clicks never overwrite each other.
 * Only the GM or the message author can update a message, so with no GM connected a non-author's
 * application gets no row (the record on the actor still exists).
 */
import { isApplicationId } from '../utils/damage/damage-undo.mjs';
import { messageAuthorId } from './chat-relay.mjs';
import { flagPath, readFlag } from '../utils/flags.mjs';
import { sourceMessageIdOf } from '../utils/combat/card-flags.mjs';
import { messageList } from '../utils/card/recent-cards.mjs';
import { appliedBeforeEvade } from '../utils/attack/evade-link.mjs';
import { MAX_TARGET_LINES } from '../utils/damage/per-target-damage.mjs';

const DAMAGE_APPLICATIONS_FLAG = 'damageApplications';

/** The user may update this message: GM, or the author. */
export function canModifyMessage(message, user = globalThis.game?.user) {
  if (!message || !user) return false;
  if (user.isGM) return true;
  return Boolean(user.id) && messageAuthorId(message) === user.id;
}

function readIndex(message) {
  return readFlag(message, DAMAGE_APPLICATIONS_FLAG) ?? null;
}

const LINE_STAGES = new Set(['attacker', 'crit', 'defense', 'dr', 'heal', 'effect']);
const MAX_LINE_TEXT = 120;
/** An `effect` line is "Inflicted {name}: {rules}" (3.71 B6), longer than a breakdown line; it has its own room so a long breakdown cannot push it out. */
const MAX_EFFECT_TEXT = 400;
const MAX_EFFECT_LINES = 8;

/** Breakdown lines of an entry: at most MAX_TARGET_LINES `{ stage, text }` plus MAX_EFFECT_LINES `effect` lines; anything else is dropped. */
function sanitizeLines(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const effects = [];
  for (const l of raw) {
    if (!l || typeof l !== 'object' || !LINE_STAGES.has(l.stage) || typeof l.text !== 'string' || !l.text) continue;
    if (l.stage === 'effect') {
      if (effects.length < MAX_EFFECT_LINES) effects.push({ stage: 'effect', text: l.text.slice(0, MAX_EFFECT_TEXT) });
    } else if (out.length < MAX_TARGET_LINES) {
      out.push({ stage: l.stage, text: l.text.slice(0, MAX_LINE_TEXT) });
    }
  }
  return [...out, ...effects];
}

/** Sanitized index entries sorted by `at`. */
export function getDamageApplications(message) {
  const raw = readIndex(message);
  if (!raw || typeof raw !== 'object') return [];
  const out = [];
  for (const [id, e] of Object.entries(raw)) {
    if (!isApplicationId(id) || !e || typeof e !== 'object' || typeof e.targetUuid !== 'string' || !e.targetUuid) continue;
    out.push({
      applicationId: id,
      targetUuid: e.targetUuid,
      targetName: String(e.targetName ?? ''),
      actualDamage: Number(e.actualDamage) || 0,
      at: Number(e.at) || 0,
      undone: e.undone === true,
      lines: sanitizeLines(e.lines)
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Write one entry. No-op returning false without a message id, with a bad id, or without permission. */
export async function indexDamageApplication(message, { applicationId, targetUuid, targetName, actualDamage, lines = [] }) {
  if (!message?.id || !isApplicationId(applicationId) || !canModifyMessage(message)) return false;
  try {
    await message.update({
      [flagPath(`${DAMAGE_APPLICATIONS_FLAG}.${applicationId}`)]: {
        applicationId, targetUuid, targetName: String(targetName ?? ''),
        actualDamage: Number(actualDamage) || 0, at: Date.now(), undone: false, lines: sanitizeLines(lines)
      }
    });
    return true;
  } catch (err) {
    console.error('Sprinter RPG | Could not index the damage application:', err);
    return false;
  }
}

/** Mark an existing entry undone (same target uuid only). Never creates entries. */
export async function markDamageApplicationUndone(message, applicationId, targetUuid) {
  if (!message?.id || !isApplicationId(applicationId) || !canModifyMessage(message)) return false;
  const existing = readIndex(message)?.[applicationId];
  if (!existing || existing.targetUuid !== targetUuid) return false;
  try {
    await message.update({ [flagPath(`${DAMAGE_APPLICATIONS_FLAG}.${applicationId}.undone`)]: true });
    return true;
  } catch (err) {
    console.error('Sprinter RPG | Could not mark the damage application undone:', err);
    return false;
  }
}

/**
 * True when a damage card answering this check has an application that was not undone (an Evade card: the attack's damage
 * already applied to its roller).
 * @param {object} message the check card
 * @param {{ kind: string, rollerUuid: string }} record its check record
 */
export function damageAlreadyApplied(message, record) {
  const messages = messageList(globalThis.game?.messages);
  if (record.kind === 'evade') {
    return appliedBeforeEvade(messages, { attackMessageId: readFlag(message, 'attackMessageId'), evaderUuid: readFlag(message, 'evaderUuid') ?? record.rollerUuid, getApplications: getDamageApplications });
  }
  if (!message?.id) return false;
  return messages.some((m) => sourceMessageIdOf(m) === message.id && getDamageApplications(m).some((a) => !a.undone));
}

/** True when a damage card answers this check (made from it, applied or not): the Called Plays on it keep where they went. */
export function damageCardAnswers(message) {
  return Boolean(message?.id) && messageList(globalThis.game?.messages).some((m) => sourceMessageIdOf(m) === message.id);
}
