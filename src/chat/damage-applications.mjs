/**
 * Display-only index of the damage applications made from a chat card
 * Nothing reads authority from it: undo finds its real
 * records on the target actor, the Combat, the ledger and the kill trophy.
 *
 * Entries are written with dotted updates so two targets or two clicks never overwrite each other.
 * Only the GM or the message author can update a message, so with no GM connected a non-author's
 * application gets no row (the record on the actor still exists).
 */
import { SYSTEM_ID } from '../constants.mjs';
import { isApplicationId } from '../utils/damage/damage-undo.mjs';
import { messageAuthorId } from './chat-relay.mjs';
import { MAX_TARGET_LINES } from '../utils/damage/per-target-damage.mjs';

const DAMAGE_APPLICATIONS_FLAG = 'damageApplications';

/** The user may update this message: GM, or the author. */
export function canModifyMessage(message, user = globalThis.game?.user) {
  if (!message || !user) return false;
  if (user.isGM) return true;
  return Boolean(user.id) && messageAuthorId(message) === user.id;
}

function readIndex(message) {
  return message?.getFlag?.(SYSTEM_ID, DAMAGE_APPLICATIONS_FLAG) ?? message?.flags?.[SYSTEM_ID]?.[DAMAGE_APPLICATIONS_FLAG] ?? null;
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
      [`flags.${SYSTEM_ID}.${DAMAGE_APPLICATIONS_FLAG}.${applicationId}`]: {
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
    await message.update({ [`flags.${SYSTEM_ID}.${DAMAGE_APPLICATIONS_FLAG}.${applicationId}.undone`]: true });
    return true;
  } catch (err) {
    console.error('Sprinter RPG | Could not mark the damage application undone:', err);
    return false;
  }
}
