/** Gear-only context: list display strings, outcome table and disclosure flags. */
import { buildOutcomesContext } from './context-outcomes.mjs';
import { gearGrantRows } from './gear-grants.mjs';
import { buildAsTriggerContext } from './context-as-triggers.mjs';
import { buildOnHitContext } from './context-on-hit.mjs';
import { buildEnchantmentLedgerContext } from './context-blueprint.mjs';
import { brokenStateOf } from '../../documents/item/enchantments.mjs';
import { pickOptions, statOptions } from '../../utils/ui/field-options.mjs';
import { isWeaponFlagShown } from '../../utils/gear/wield-mode.mjs';
import { gearSlotOptions } from '../../utils/gear/gear-slots.mjs';
import { buildPickList, identifierEntries } from './context-pick-list.mjs';

/** Gear row arrays whose rows a cooldown can gate (a once-per-scene modifier). */
const COOLDOWN_ROW_FIELDS = Object.freeze([
  'damageModifiers', 'defenseModifiers', 'attackModifiers', 'checkModifiers', 'craftModifiers', 'vehicleModifiers',
  'manaCostModifiers', 'recoveryModifiers', 'statSubstitutions', 'popularityTriggers', 'asTriggers'
]);

const listString = (raw) => (Array.isArray(raw) ? raw.join(', ') : (raw || ''));

/**
 * The gear's persistent effects picker: the buffs and debuffs equipped gear keeps on its wielder, one list
 * over two fields. Buff chips write `persistentBuffs`, debuff chips `persistentDebuffs`; both store identifiers.
 * @param {object} sys the gear's `system`
 * @param {{availableBuffs?: object[], availableDebuffs?: object[]}} catalogs the sheet's buff/debuff catalogs
 */
function buildPersistentEffectsPicker(sys, { availableBuffs = [], availableDebuffs = [] } = {}) {
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

export function buildGearContext(context, item) {
  const sys = context.system;
  // A broken or destroyed gear item held by an actor can be repaired from its sheet (3.15 G1)
  Object.assign(context, brokenStateOf(item));
  context.canRepair = Boolean(context.brokenState) && item?.parent?.documentName === 'Actor';
  context.persistentEffectsPicker = buildPersistentEffectsPicker(sys, context);
  context.gearSlotOptions = gearSlotOptions(sys.slot);
  // The Weapon box shows the stored flag; a flag never set (null) falls back to the hands slot, as isWeaponGear does.
  context.isWeaponChecked = isWeaponFlagShown(sys);
  // Rows that can use a cooldown (once-per-scene upgrades) get the editor outside the Activated Ability block.
  const hasAbility = Boolean(sys.hasActivatedAbility || sys.outcomes?.length > 0);
  const hasRows = COOLDOWN_ROW_FIELDS.some((key) => Array.isArray(sys[key]) && sys[key].length > 0);
  context.showStandaloneCooldown = !hasAbility && (hasRows || Boolean(sys.cooldown?.unit));
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
  buildEnchantmentLedgerContext(context, context.item);

  context.hasArmorPiercingConfigured = Boolean(sys.ignoreDR);
  context.hasGearGrantsConfigured = context.gearGrantRows.length > 0;
  context.hasDamagePartsConfigured = sys.damageParts?.length > 0;
  context.hasAuraConfigured = Boolean(sys.area?.hasArea);
  context.hasActivatedAbilityConfigured = Boolean(sys.hasActivatedAbility || sys.outcomes?.length > 0);
  context.hasProficiencyConfigured = Boolean(sys.weaponCategory || sys.weaponType || context.associatedSkillsList.length > 0);
}
