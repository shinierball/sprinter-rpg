/**
 * Amazing Success trigger editor context: the stored
 * `system.asTriggers` entries with precomputed type and debuff options, the read-only AS-conditioned damage rows,
 * and the one-per-weapon count with its badge. The count and the rows come from `src/utils/roll/amazing-success.mjs`.
 */
import { AS_TRIGGER_TYPES, asTriggerCount, asTriggerRowsOf } from '../../utils/roll/amazing-success.mjs';
import { identifierOptions } from '../../utils/ui/identifier-options.mjs';
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
  const { entries } = buildAsTriggerEntries(context.system?.asTriggers, context.availableDebuffs);
  const rows = asTriggerRowsOf(item).map((row) => ({ label: row.label || loc('COG.AmazingSuccess.Editor.DamageRow'), summary: rowSummary(row) }));
  const count = asTriggerCount(item);
  context.asTriggers = asTriggerView(entries, rows, count);
  return context.asTriggers;
}

/**
 * The editor entries for a list of stored triggers, with every input named under `system.asTriggers.<i>` (a template view
 * renames them with `renameRowPaths`).
 * @param {object[]} triggers the stored `asTriggers`
 * @param {object[]} availableDebuffs the debuff catalog
 */
function buildAsTriggerEntries(triggers, availableDebuffs) {
  const stored = toArray(triggers).filter((t) => t && typeof t === 'object');
  const entries = stored.map((trigger, index) => {
    const type = AS_TRIGGER_TYPES.includes(trigger.type) ? trigger.type : 'debuff';
    const identifier = text(trigger.identifier);
    return {
      index,
      typeName: `system.asTriggers.${index}.type`,
      identifierName: `system.asTriggers.${index}.identifier`,
      textName: `system.asTriggers.${index}.text`,
      labelName: `system.asTriggers.${index}.label`,
      type,
      isDebuff: type === 'debuff',
      isNarrative: type === 'narrative',
      typeOptions: AS_TRIGGER_TYPES.map((value) => ({
        value, label: loc(`COG.AmazingSuccess.Editor.Type.${value}`), selected: value === type
      })),
      identifier,
      debuffOptions: identifierOptions(availableDebuffs ?? [], identifier, { blankLabel: loc('COG.AmazingSuccess.Editor.ChooseDebuff') }),
      text: text(trigger.text),
      label: text(trigger.label),
      ruleBreak: trigger.ruleBreak === true,
      enchantment: text(trigger.enchantment)
    };
  });
  return { entries };
}

function asTriggerView(entries, rows, count) {
  const overLimit = count > 1;
  let badge = '[NONE]';
  if (overLimit) badge = `[RULE BREAK: ${count}]`;
  else if (count === 1) badge = '[1 TRIGGER]';
  return { entries, rows, count, overLimit, badge };
}

/**
 * The trigger editor view of one enchantment template: its `rows.asTriggers`, with input names under `system.asTriggers.<i>`
 * (the caller renames them to the template's path). A template has no AS-conditioned damage rows to list.
 * @param {object[]} triggers the template's stored `rows.asTriggers`
 * @param {object[]} availableDebuffs the debuff catalog
 */
export function buildTemplateAsTriggerView(triggers, availableDebuffs) {
  const { entries } = buildAsTriggerEntries(triggers, availableDebuffs);
  return asTriggerView(entries, [], entries.length);
}
