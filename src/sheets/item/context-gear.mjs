/** Gear-only context: list display strings, outcome table and disclosure flags. */
import { buildOutcomesContext, executionModeOptions } from './context-outcomes.mjs';
import { gearGrantRows } from './gear-grants.mjs';
import { buildAsTriggerContext } from './context-as-triggers.mjs';
import { buildOnHitContext } from './context-on-hit.mjs';
import { buildEnchantmentLedgerContext } from './context-blueprint.mjs';
import { brokenStateOf } from '../../documents/item/enchantments.mjs';
import { normalizeBaseDamage } from '../../utils/damage/base-damage.mjs';
import { buildBaseDamageContext } from './context-common.mjs';
import { isWeaponFlagShown } from '../../utils/gear/wield-mode.mjs';
import { gearSlotOptions } from '../../utils/gear/gear-slots.mjs';
import { buildPickList, identifierEntries } from './context-pick-list.mjs';
import { buildWeaponContext } from './context-weapon.mjs';

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
  context.executionModeOptions = executionModeOptions(sys.executionMode);
  buildOutcomesContext(context);
  buildBaseDamageContext(context, { ownStatLabel: "Skill's stat" });
  buildAsTriggerContext(context);
  buildOnHitContext(context);
  buildEnchantmentLedgerContext(context, context.item);

  context.hasGearGrantsConfigured = context.gearGrantRows.length > 0;
  context.hasBaseDamageConfigured = Object.values(normalizeBaseDamage(sys.baseDamage)).some(Boolean);
  context.hasAuraConfigured = Boolean(sys.area?.hasArea);
  context.hasActivatedAbilityConfigured = Boolean(sys.hasActivatedAbility || sys.outcomes?.length > 0);
  if (context.isWeaponChecked) buildWeaponContext(context, item);
}
