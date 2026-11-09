/**
 * Sprinter RPG - Scroll of Upgrade, the pure part
 *
 * One row of an upgrade table (a `TableSnapshot` row) becomes a list of choices: each Amazing Success trigger the row
 * offers, then always "Record only". A choice becomes an enchantment template, and the item's new name is built here.
 * No text is parsed: a row with no trigger option copies its own words into a display-only narrative trigger.
 * The Floor Simulator and the in-play Use path both call these.
 */
import { asTriggerFromOption } from '../roll/amazing-success.mjs';
import { craftText } from './craft-text.mjs';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const tagList = (v) => (Array.isArray(v) ? v : []).map(text).filter(Boolean);

const narrativeTrigger = (words) => ({ type: 'narrative', text: words, label: '' });

/**
 * The choices of one table row, in order; the last is always `{ kind: 'record' }`.
 * @param {{ narrative?: string, options?: object[] }|null} row
 * @returns {Array<{ kind: 'trigger', label: string, nameAddition: string, extraTags: string[], trigger: object }|{ kind: 'record', label: string, nameAddition: string }>}
 */
export function upgradeChoices(row) {
  const options = Array.isArray(row?.options) ? row.options.filter(isObj) : [];
  const choices = [];
  for (const option of options) {
    if (option.kind !== 'asTrigger') continue;
    const trigger = asTriggerFromOption(option);
    if (!trigger) continue;
    choices.push({
      kind: 'trigger', label: text(option.label) || text(option.nameAddition), nameAddition: text(option.nameAddition),
      extraTags: tagList(option.extraTags), trigger
    });
  }
  if (!choices.length) {
    const customs = options.filter((o) => o.kind === 'custom' && text(o.label));
    const words = customs.length ? customs.map((o) => text(o.label)) : (text(row?.narrative) ? [text(row.narrative)] : []);
    for (const w of words) {
      choices.push({ kind: 'trigger', label: w, nameAddition: '', extraTags: [], trigger: narrativeTrigger(w) });
    }
  }
  const addition = choices[0]?.nameAddition || craftText('COG.Upgrade.Record');
  choices.push({ kind: 'record', label: addition, nameAddition: addition });
  return choices;
}

/**
 * The enchantment template of one choice (for `buildEnchantmentWrite` / `applyEnchantment`).
 * @param {{ kind: string, label?: string, trigger?: object }} choice
 * @param {{ bonusLevel?: number }} [opts]
 */
export function upgradeTemplate(choice, { bonusLevel = 1 } = {}) {
  const isTrigger = choice?.kind === 'trigger' && isObj(choice.trigger);
  const label = text(choice?.label) || (isTrigger ? craftText('COG.Upgrade.TriggerLabel') : craftText('COG.Upgrade.Record'));
  return {
    label, property: '', category: 'other', bonusLevel,
    rows: isTrigger ? { asTriggers: [structuredClone(choice.trigger)] } : {}
  };
}

/**
 * The item's name with the upgrade's name addition in front. A blank addition leaves the name; a name that already
 * starts with the addition is not prefixed twice.
 * @param {string} name
 * @param {string} nameAddition
 */
export function upgradedName(name, nameAddition) {
  const base = typeof name === 'string' ? name : '';
  const prefix = text(nameAddition);
  if (!prefix) return base;
  return base.startsWith(`${prefix} `) ? base : `${prefix} ${base}`;
}
