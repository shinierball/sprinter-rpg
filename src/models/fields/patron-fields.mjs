import {
  PATRONAGE_STATUSES, PATRONAGE_VIA, PATRONAGE_ENDINGS, PATRON_ATTITUDES, AUDITION_RESULTS, AUDITION_EVENTS
} from '../../utils/patron/patronage-state.mjs';

/**
 * The one patronage state (core rulebook pp. 315-316), stored twice: a `patron` item's `system.patronage` (initial
 * status `prospect`) and a deity item's `system.bond.patronage` (initial status `none`). Meaningful on an embedded item;
 * written by the patronage actions, never by hand.
 * @param {object} fields foundry.data.fields
 * @param {{ status: string }} options the initial status
 */
export function patronageField(fields, { status }) {
  return new fields.SchemaField({
    status: new fields.StringField({ initial: status, choices: [...PATRONAGE_STATUSES] }),
    via: new fields.StringField({ initial: '', blank: true, choices: [...PATRONAGE_VIA] }),
    since: new fields.NumberField({ nullable: true, initial: null }),
    attitude: new fields.StringField({ initial: 'willing', choices: [...PATRON_ATTITUDES] }),
    audition: new fields.SchemaField({
      dc: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }),
      steady: new fields.BooleanField({ initial: false }),
      result: new fields.StringField({ initial: '', blank: true, choices: [...AUDITION_RESULTS] }),
      checks: new fields.ArrayField(new fields.SchemaField({
        skill: new fields.StringField({ initial: '' }),
        outcome: new fields.StringField({ initial: '' }),
        from: new fields.StringField({ initial: '' }),
        to: new fields.StringField({ initial: '' }),
        event: new fields.StringField({ initial: '', blank: true, choices: [...AUDITION_EVENTS] }),
        messageId: new fields.StringField({ initial: '' }),
        at: new fields.NumberField({ nullable: true, initial: null })
      }), { initial: [] })
    }),
    earned: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    endedBy: new fields.StringField({ initial: '', blank: true, choices: [...PATRONAGE_ENDINGS] }),
    endedFloor: new fields.NumberField({ integer: true, nullable: true, initial: null })
  });
}
