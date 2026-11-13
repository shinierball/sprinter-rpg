import { buildAsTriggerContext } from './context-as-triggers.mjs';
import { conditionLabel } from '../../documents/actor/condition-data.mjs';
import { describeAttackMechanics } from '../../utils/attack/attack-mechanics.mjs';
import { buildOnHitContext } from './context-on-hit.mjs';
import { normalizeBaseDamage } from '../../utils/damage/base-damage.mjs';
import { buildWeaponContext } from './context-weapon.mjs';
import { buildBaseDamageContext } from './context-common.mjs';

/** Attack-only context: disclosure flags and the Amazing Success trigger editor. */
export function buildAttackContext(context, item) {
  const sys = context.system;
  buildWeaponContext(context, item);
  buildBaseDamageContext(context, { ownStatLabel: "Skill's stat" });
  context.hasBaseDamageConfigured = Object.values(normalizeBaseDamage(sys.baseDamage)).some(Boolean);
  context.attackMechanicsText = describeAttackMechanics(sys, { labelOf: conditionLabel }).text;
  context.hasAttackProfileConfigured = Boolean(context.attackMechanicsText);
  buildAsTriggerContext(context);
  buildOnHitContext(context);
}
