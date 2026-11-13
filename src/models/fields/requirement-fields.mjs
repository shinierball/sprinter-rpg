import { tagQueryField } from './tag-fields.mjs';
import { requirementRowErrors } from '../items/requirement-validation.mjs';

/**
 * One requirement row of a race or class (`system.requirements[]`): a flat union of the kinds' fields, with a real
 * validator (a row that fails {@link requirementRowErrors} fails `validate`). `kind` is a registered requirements kind id,
 * an open set (no `choices`): a module may register kinds after the schema exists. `label` is display text, never resolved;
 * `text` is the note kind's human text, never read by a mechanic.
 * @param {object} fields foundry.data.fields
 */
function requirementField(fields) {
  const schema = {
    kind:       new fields.StringField({ initial: 'stat' }),
    stat:       new fields.StringField({ initial: '' }),
    value:      new fields.NumberField({ nullable: false, integer: true, min: 0, initial: 0 }),
    identifier: new fields.StringField({ initial: '' }),
    options:    new fields.ArrayField(new fields.StringField(), { nullable: true, initial: null }),
    query:      tagQueryField(fields, { nullable: true, initial: null }),
    text:       new fields.StringField({ initial: '' }),
    label:      new fields.StringField({ initial: '' })
  };
  class RequirementSchemaField extends fields.SchemaField {
    /** @override */
    _validateType(value, options) {
      const failure = super._validateType?.(value, options);
      if (failure instanceof Error || (failure && failure !== true)) return failure;
      const errors = requirementRowErrors(value);
      if (errors.length) throw new Error(`invalid requirement: ${errors.join('; ')}`);
      return failure;
    }
  }
  return new RequirementSchemaField(schema);
}

/**
 * `system.requirements[]` on races and classes: what a crawler needs before taking the race or class.
 * @param {object} fields foundry.data.fields
 */
export function requirementsField(fields) {
  return new fields.ArrayField(requirementField(fields), { initial: [] });
}
