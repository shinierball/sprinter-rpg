/**
 * src/data/item-setup/kinds/attack.mjs
 * The attack page, opened by a crawler sheet's "Add Attack" link (an attack is an embedded item, never made in the world,
 * so it has no picker tile): its Skills in order, its hands, and different damage only when it has some. It has no type
 * chips: an attack carries no weapon type.
 */
import { normalizeBaseDamage } from '../../../utils/damage/base-damage.mjs';
import { registerSetupKind } from '../registry.mjs';
import { NAME_FIELD, idList, nameSpec, text } from '../answers.mjs';
import { HANDS_CHOICES } from './weapon.mjs';

registerSetupKind({
  id: 'attack',
  icon: 'fa-hand-fist',
  order: 15,
  picker: false,
  createType: 'attack',
  fields: Object.freeze([
    NAME_FIELD,
    Object.freeze({ id: 'skills', type: 'catalogList', catalog: 'attackSkills', showDamage: true }),
    Object.freeze({ id: 'hands', type: 'choice', source: 'hands' }),
    Object.freeze({ id: 'differentDamage', type: 'baseDamage', prefix: 'damage', inherit: true, collapsed: true })
  ]),
  /** @returns {object} the answers a new attack starts with */
  start: () => ({ name: '', skills: [], hands: HANDS_CHOICES[0], differentDamage: { dice: '', stat: '', damageType: '' } }),
  toSpec(answers) {
    const hands = HANDS_CHOICES.includes(text(answers?.hands)) ? text(answers.hands) : HANDS_CHOICES[0];
    const system = { wieldMode: hands, associatedSkills: idList(answers?.skills) };
    const damage = normalizeBaseDamage(answers?.differentDamage);
    if (damage.dice || damage.stat || damage.damageType) system.baseDamage = damage;
    return { ...nameSpec(answers), system };
  }
});
