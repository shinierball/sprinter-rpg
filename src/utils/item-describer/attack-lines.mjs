/**
 * `describeAttackMechanics` as summary lines: each of its `parts` is one line with a badge. The sentences come from
 * `attack-mechanics.mjs` unchanged; this file only attaches a kind and a source path to each.
 */
import { describeAttackMechanics } from '../attack/attack-mechanics.mjs';
import { isAreaAttack } from '../area/area-attack.mjs';
import { conditionLabel } from '../../documents/actor/condition-data.mjs';
import { itemLine, t } from './shared.mjs';

/** The cooldown part reads with the spell wording, "Cooldown: {text}" (`COG.ItemSummary.SpellSkill.Cooldown`). */
const COOLDOWN_KEY = 'COG.ItemSummary.SpellSkill.Cooldown';

/** Summary lines are joined with " • " and carry no final period, so one trailing period is dropped per part. */
const unperiod = (text) => String(text).replace(/\.$/, '');

/** Part key to line kind and the field the part reads. */
const PART_LINES = Object.freeze({
  toHit: { kind: 'attack', path: 'system.hitDifficulty' },
  range: { kind: 'attack', path: 'system.rangeFeet' },
  area: { kind: 'area', path: 'system.area' },
  cooldown: { kind: 'timing', path: 'system.cooldown' },
  save: { kind: 'save', path: 'system.contest' },
  onHit: { kind: 'on-hit', path: 'system.onHit' },
  evadeFail: { kind: 'on-hit', path: 'system.onHit.evadeFail' },
  slotLoss: { kind: 'on-hit', path: 'system.onHit.slotLoss' }
});

/**
 * @param {object} item an item (its `system` is read)
 * @returns {import('./shared.mjs').FeatureLine[]}
 */
export function describeAttackLines(item) {
  const sys = item?.system && typeof item.system === 'object' ? item.system : null;
  if (!sys) return [];
  // The area is described only when the attack roll treats the item as an area attack (the flag, or a sized area shape)
  const stand = sys.area && !isAreaAttack(item) ? { ...sys, area: null } : sys;
  const { parts } = describeAttackMechanics(stand, { labelOf: conditionLabel });
  return parts.filter((p) => PART_LINES[p.key]).map((p) => {
    const { kind, path } = PART_LINES[p.key];
    const text = p.key === 'cooldown' ? t(COOLDOWN_KEY, { text: unperiod(p.text) }) : unperiod(p.text);
    return itemLine(kind, text, path);
  });
}
