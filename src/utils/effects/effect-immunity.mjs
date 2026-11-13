/**
 * Immunity to an effect: the defender's `effectImmunity` defence rows judged against an incoming effect's tags (a Debuff
 * about to land, a contested Skill or Spell). The row's `condition` here is the effect it blocks, not a roll's tags.
 */
import { buildRollContext } from '../roll/roll-context.mjs';
import { evaluateRows } from '../roll/damage-modifiers.mjs';
import { applyRowKind, getRowKind, kindOf } from '../row-kinds.mjs';

/** A line of `COG.Effects.Immune.<name>`; the English fallback when no language file is loaded. */
export function immuneText(name, data, fallback) {
  const key = `COG.Effects.Immune.${name}`;
  const i18n = globalThis.game?.i18n;
  return i18n?.has?.(key) && typeof i18n.format === 'function' ? i18n.format(key, data) : fallback;
}

/**
 * Does the actor have an `effectImmunity` row that matches these incoming tags?
 * @param {object} actor the defender
 * @param {Iterable<string>} tags the incoming effect's tags (`incomingEffectTags`)
 * @param {{ other?: object|null }} [options] `other` is the source actor, when known (`attacker.*` tags)
 * @returns {{ immune: boolean, sources: string[] }} `sources` names each matching row's label (its source's name)
 */
export function effectImmunityFor(actor, tags, { other = null } = {}) {
  const acc = [];
  if (!actor) return { immune: false, sources: acc };
  const context = buildRollContext({ actor, phase: 'defense', tags: [...(tags ?? [])], other, otherRole: 'attacker' });
  for (const { source, row } of evaluateRows(actor, 'defenseModifiers', context)) {
    const def = getRowKind('defenseModifiers', kindOf('defenseModifiers', row));
    if (!def?.apply?.effect) continue;
    applyRowKind('defenseModifiers', def, 'effect', acc, row, { actor, source, context, label: row.label || source.name || 'Immunity' });
  }
  return { immune: acc.length > 0, sources: [...new Set(acc.map(a => a.label))] };
}
