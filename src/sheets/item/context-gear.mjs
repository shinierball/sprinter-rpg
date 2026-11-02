/** Gear-only context: list display strings, outcome table and disclosure flags. */
import { buildOutcomesContext } from './context-outcomes.mjs';
import { gearGrantRows } from './gear-grants.mjs';
import { buildAsTriggerContext } from './context-as-triggers.mjs';
import { buildOnHitContext } from './context-on-hit.mjs';
import { pickOptions, statOptions } from './options.mjs';
import { buildPickList, identifierEntries } from './context-pick-list.mjs';

const ABILITY_KEYS = ['str', 'int', 'con', 'dex', 'cha'];
const listString = (raw) => (Array.isArray(raw) ? raw.join(', ') : (raw || ''));

/**
 * The gear's persistent effects picker: the buffs and debuffs equipped gear keeps on its wielder, one list
 * over two fields. Buff chips write `persistentBuffs`, debuff chips `persistentDebuffs`; both store identifiers.
 * @param {object} sys the gear's `system`
 * @param {{availableBuffs?: object[], availableDebuffs?: object[]}} catalogs the sheet's buff/debuff catalogs
 */
export function buildPersistentEffectsPicker(sys, { availableBuffs = [], availableDebuffs = [] } = {}) {
  return buildPickList({
    label: 'Persistent Buffs & Debuffs (on the wielder while equipped)',
    icon: 'fa-shield-halved',
    emptyText: 'None. Pick a buff or debuff below, or type an identifier.',
    choose: '+ Add buff or debuff...',
    placeholder: 'Or an identifier, e.g. stage-fright',
    lists: [
      { list: 'persistentBuffs', badge: 'BUFF', stored: sys.persistentBuffs, entries: identifierEntries(availableBuffs), groupLabel: 'Buffs', customLabel: 'Buff' },
      { list: 'persistentDebuffs', badge: 'DEBUFF', stored: sys.persistentDebuffs, entries: identifierEntries(availableDebuffs), groupLabel: 'Debuffs', customLabel: 'Debuff' }
    ]
  });
}

export function buildGearContext(context) {
  const sys = context.system;
  context.persistentEffectsPicker = buildPersistentEffectsPicker(sys, context);
  context.cleanseDebuffsString = listString(sys.healing?.cleanseDebuffs);

  context.gearGrantRows = gearGrantRows(sys.grants, { skills: context.availableSkills, spells: context.availableSpells });
  buildOutcomesContext(context);
  context.toHitStatOptions = statOptions(sys.toHitStat, { blankLabel: 'Auto' });
  // Damage-part rows carry their own select options (render-only copy of the rows).
  for (const part of Array.isArray(sys.damageParts) ? sys.damageParts : []) {
    if (!part) continue;
    part.statOptions = statOptions(part.stat, { blankLabel: 'None' });
    part.typeOptions = pickOptions(context.damageTypes, part.type, { blankLabel: 'Physical' });
  }
  buildAsTriggerContext(context);
  buildOnHitContext(context);

  context.hasArmorPiercingConfigured = Boolean(sys.ignoreDR);
  context.hasAbilityModifiers = ABILITY_KEYS.some((k) => Number(sys.abilityModifiers?.[k]?.value));
  context.hasGearGrantsConfigured = context.gearGrantRows.length > 0;
  context.hasDamagePartsConfigured = sys.damageParts?.length > 0;
  context.hasAuraConfigured = Boolean(sys.area?.hasArea);
  context.hasActivatedAbilityConfigured = Boolean(sys.hasActivatedAbility || sys.outcomes?.length > 0);
  context.hasProficiencyConfigured = Boolean(sys.weaponCategory || sys.weaponType || context.associatedSkillsList.length > 0);
}
