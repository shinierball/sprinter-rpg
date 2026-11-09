import { collectGearSkillBonuses, gearGrantKey } from '../../models/actors/actor-derivation.mjs';

/**
 * An actor's modified rank for a spell: the owned spell with that identifier, else the rank equipped gear grants it
 * (a `grants` spell row, or a spell outcome naming that identifier), else 0. Names are never matched.
 * @param {Actor} actor
 * @param {string|Item} ref a spell identifier, or a spell item (its identifier is used)
 * @returns {number}
 */
export function getSpellRank(actor, ref) {
  const identifier = typeof ref === 'string' ? ref.trim() : String(ref?.system?.identifier ?? '').trim();
  if (!identifier || !actor.items) return 0;
  const spell = actor.items.find(i => i.type === 'spell' && i.system?.identifier === identifier);
  if (spell) return Number(spell.system?.modifiedRank ?? spell.system?.rank) || 1;
  const equippedGear = actor.items.filter(i => i.type === 'gear' && i.system?.equipped);
  const granted = collectGearSkillBonuses(equippedGear).get(gearGrantKey('spell', identifier));
  if (granted) return granted.rank || 1;
  for (const item of equippedGear) {
    const rawOutcomes = item.system?.outcomes;
    const outcomes = Array.isArray(rawOutcomes) ? rawOutcomes : (rawOutcomes && typeof rawOutcomes === 'object' ? Object.values(rawOutcomes) : []);
    const out = outcomes.find(o => o?.type === 'spell' && o.spellIdentifier === identifier);
    if (out) return Number(out.rank) || 1;
  }
  return 0;
}
