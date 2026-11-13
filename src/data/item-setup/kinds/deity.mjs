/**
 * src/data/item-setup/kinds/deity.mjs
 * The deity page: its name, the "God of ..." line, the Stat a Zealot gains from it and what its offering costs.
 */
import { registerSetupKind } from '../registry.mjs';
import { NAME_FIELD, nameSpec, text, wholeNumber, checked } from '../answers.mjs';
import { STAT_TO_TAG } from '../../tag-vocabulary.mjs';

registerSetupKind({
  id: 'deity',
  icon: 'fa-hands-praying',
  order: 70,
  createType: 'deity',
  fields: Object.freeze([
    NAME_FIELD,
    Object.freeze({ id: 'title', type: 'text', placeholder: 'COG.ItemSetup.Kind.deity.title.Placeholder' }),
    Object.freeze({ id: 'signatureStat', type: 'choice', source: 'stats', blank: 'COG.ItemSetup.Field.None' }),
    Object.freeze({ id: 'offeringRequired', type: 'checkbox', rerender: true }),
    Object.freeze({ id: 'offeringGold', type: 'number', min: 0, when: Object.freeze({ field: 'offeringRequired', in: Object.freeze([true]) }) })
  ]),
  start: () => ({ name: '', title: '', signatureStat: '', offeringRequired: true, offeringGold: 0 }),
  toSpec(answers) {
    const required = checked(answers?.offeringRequired);
    const stat = text(answers?.signatureStat);
    return {
      ...nameSpec(answers),
      system: {
        title: text(answers?.title),
        signature: { stat: Object.hasOwn(STAT_TO_TAG, stat) ? stat : '' },
        offering: { required, gold: required ? wholeNumber(answers?.offeringGold) : 0 }
      }
    };
  }
});
