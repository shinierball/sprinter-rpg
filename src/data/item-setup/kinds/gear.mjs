/**
 * src/data/item-setup/kinds/gear.mjs
 * The gear page: where it is worn and its Damage Resistance.
 */
import { registerSetupKind } from '../registry.mjs';
import { NAME_FIELD, nameSpec, text, wholeNumber } from '../answers.mjs';

/** Where a new piece of gear is worn when no answer is given. */
const DEFAULT_GEAR_SLOT = 'torso';

registerSetupKind({
  id: 'gear',
  icon: 'fa-shield-halved',
  order: 20,
  createType: 'gear',
  fields: Object.freeze([
    NAME_FIELD,
    Object.freeze({ id: 'slot', type: 'choice', source: 'slots' }),
    Object.freeze({ id: 'dr', type: 'number', min: 0 })
  ]),
  start: () => ({ name: '', slot: DEFAULT_GEAR_SLOT, dr: 0 }),
  toSpec(answers) {
    return { ...nameSpec(answers), system: { isWeapon: false, slot: text(answers?.slot) || DEFAULT_GEAR_SLOT, drBonus: wholeNumber(answers?.dr) } };
  }
});
