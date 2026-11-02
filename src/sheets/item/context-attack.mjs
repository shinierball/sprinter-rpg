import { buildAsTriggerContext } from './context-as-triggers.mjs';
import { conditionLabel } from '../../documents/actor/condition-data.mjs';
import { describeAttackMechanics } from '../../utils/attack-mechanics.mjs';
import { buildOnHitContext } from './context-on-hit.mjs';

/** Attack-only context: disclosure flags and the Amazing Success trigger editor. */
export function buildAttackContext(context) {
  const sys = context.system;
  context.hasArmorPiercingConfigured = Boolean(sys.ignoreDR);
  context.hasProficiencyConfigured = Boolean(
    sys.weaponCategory || sys.weaponType || context.associatedSkillsList.length > 0 || (sys.wieldMode && sys.wieldMode !== 'one_handed')
  );
  context.hasDamagePartsConfigured = sys.damageParts?.length > 0;
  context.attackMechanicsText = describeAttackMechanics(sys, { labelOf: conditionLabel }).text;
  context.hasAttackProfileConfigured = Boolean(context.attackMechanicsText);
  buildAsTriggerContext(context);
  buildOnHitContext(context);
}
