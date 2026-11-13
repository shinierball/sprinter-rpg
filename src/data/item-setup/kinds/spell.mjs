/**
 * src/data/item-setup/kinds/spell.mjs
 * The spell page. Its first question is what the spell does (attacks, restores Health Bars, something else, always on);
 * the answer sets `checkType` and decides whether Base Damage or the Health Bars restored is asked.
 */
import { normalizeBaseDamage } from '../../../utils/damage/base-damage.mjs';
import { registerSetupKind } from '../registry.mjs';
import { NAME_FIELD, nameSpec, text, wholeNumber } from '../answers.mjs';

const DEFAULT_ROLE = 'attack';
const DEFAULT_STAT = 'int';
/** The spell's `checkType` for each role. */
const CHECK_TYPE = Object.freeze({ attack: 'attack', heal: 'none', other: 'none', passive: 'passive' });
const DEFAULT_BARS = '1';

const whenRole = (...roles) => Object.freeze({ field: 'role', in: Object.freeze(roles) });

registerSetupKind({
  id: 'spell',
  icon: 'fa-wand-magic-sparkles',
  order: 30,
  createType: 'spell',
  fields: Object.freeze([
    NAME_FIELD,
    Object.freeze({ id: 'role', type: 'choice', options: Object.freeze(Object.keys(CHECK_TYPE)), rerender: true }),
    Object.freeze({ id: 'manaCost', type: 'number', min: 0 }),
    Object.freeze({ id: 'stat', type: 'choice', source: 'stats' }),
    Object.freeze({ id: 'baseDamage', type: 'baseDamage', when: whenRole('attack') }),
    Object.freeze({ id: 'healBars', type: 'text', placeholder: 'COG.ItemSetup.Kind.spell.healBars.Placeholder', when: whenRole('heal') })
  ]),
  /** @returns {object} the answers a new spell starts with */
  start: () => ({ name: '', role: DEFAULT_ROLE, manaCost: 0, stat: DEFAULT_STAT, baseDamage: { dice: '', stat: '', damageType: '' }, healBars: DEFAULT_BARS }),
  toSpec(answers) {
    const role = Object.hasOwn(CHECK_TYPE, text(answers?.role)) ? text(answers.role) : DEFAULT_ROLE;
    const system = { checkType: CHECK_TYPE[role], manaCost: wholeNumber(answers?.manaCost), stat: text(answers?.stat) || DEFAULT_STAT };
    if (role === 'attack') system.baseDamage = normalizeBaseDamage(answers?.baseDamage);
    if (role === 'heal') system.healing = { hasHealing: true, barsFormula: text(answers?.healBars) || DEFAULT_BARS };
    return { ...nameSpec(answers), system };
  }
});
