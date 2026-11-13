/**
 * src/data/item-setup/kinds/patron.mjs
 * The patron page: its name, the Skills a Bard's performance is measured against and the Skills and spells it mentors.
 */
import { registerSetupKind } from '../registry.mjs';
import { NAME_FIELD, nameSpec, idList } from '../answers.mjs';

registerSetupKind({
  id: 'patron',
  icon: 'fa-handshake',
  order: 80,
  createType: 'patron',
  fields: Object.freeze([
    NAME_FIELD,
    Object.freeze({ id: 'performanceSkills', type: 'catalogList', catalog: 'skills' }),
    Object.freeze({ id: 'skills', type: 'catalogList', catalog: 'skills' })
  ]),
  start: () => ({ name: '', performanceSkills: [], skills: [] }),
  toSpec: (answers) => ({ ...nameSpec(answers), system: { performanceSkills: idList(answers?.performanceSkills), skills: idList(answers?.skills) } })
});
