/**
 * Amazing Success trigger editor context: the stored
 * `system.asTriggers` entries with precomputed type and debuff options, the read-only AS-conditioned damage rows,
 * and the one-per-weapon count with its badge. The count and the rows come from `src/utils/amazing-success.mjs`.
 */
import { AS_TRIGGER_TYPES, asTriggerCount, asTriggerRowsOf } from '../../utils/amazing-success.mjs';
import { identifierOptions } from './identifier-options.mjs';
import { toArray } from './util.mjs';

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const text = (v) => (typeof v === 'string' ? v : '');

/** One AS-conditioned damage row as a short read-only summary ("+1d6 Fire"). */
function rowSummary(row) {
  const amount = String(row.dice || '').trim() || (Number(row.value) ? String(Number(row.value)) : '');
  const parts = [row.mode === 'add' || !row.mode ? (amount ? `+${amount}` : '') : `${row.mode} ${amount}`.trim(), row.damageType].filter(Boolean);
  return parts.join(' ');
}

/**
 * Adds `context.asTriggers` for a gear or attack item.
 * @param {object} context the sheet context (`context.system` is the working copy, `context.item` the document)
 * @returns {object} the added block
 */
export function buildAsTriggerContext(context) {
  const item = context.item;
  const stored = toArray(context.system?.asTriggers).filter((t) => t && typeof t === 'object');
  const entries = stored.map((trigger, index) => {
    const type = AS_TRIGGER_TYPES.includes(trigger.type) ? trigger.type : 'debuff';
    const identifier = text(trigger.identifier);
    return {
      index,
      type,
      isDebuff: type === 'debuff',
      isNarrative: type === 'narrative',
      typeOptions: AS_TRIGGER_TYPES.map((value) => ({
        value, label: loc(`COG.AmazingSuccess.Editor.Type.${value}`), selected: value === type
      })),
      identifier,
      debuffOptions: identifierOptions(context.availableDebuffs ?? [], identifier, { blankLabel: loc('COG.AmazingSuccess.Editor.ChooseDebuff') }),
      text: text(trigger.text),
      label: text(trigger.label),
      ruleBreak: trigger.ruleBreak === true
    };
  });
  const rows = asTriggerRowsOf(item).map((row) => ({ label: row.label || loc('COG.AmazingSuccess.Editor.DamageRow'), summary: rowSummary(row) }));
  const count = asTriggerCount(item);
  const overLimit = count > 1;
  let badge = '[NONE]';
  if (overLimit) badge = `[RULE BREAK: ${count}]`;
  else if (count === 1) badge = '[1 TRIGGER]';
  context.asTriggers = { entries, rows, count, overLimit, badge };
  return context.asTriggers;
}
