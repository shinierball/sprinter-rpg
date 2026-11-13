/**
 * src/data/item-setup/kinds/sponsor.mjs
 * The sponsor page: its name and what it gives. No mechanic reads a sponsor's fields; its tags are sheet work.
 */
import { registerSetupKind } from '../registry.mjs';
import { NAME_FIELD, nameSpec, text } from '../answers.mjs';

registerSetupKind({
  id: 'sponsor',
  icon: 'fa-sack-dollar',
  order: 130,
  createType: 'sponsor',
  fields: Object.freeze([NAME_FIELD, Object.freeze({ id: 'gifts', type: 'textarea' })]),
  start: () => ({ name: '', gifts: '' }),
  toSpec: (answers) => ({ ...nameSpec(answers), system: { gifts: text(answers?.gifts) } })
});
