import { patronageField } from './patron-fields.mjs';
import { BOND_STATUSES, BOND_KNOWN_VIA, SHUNNED_MAX } from '../../utils/deity/worship-state.mjs';

/**
 * `system.bond` of a deity item: the actor's relationship with that god. Meaningful on an embedded item; a catalog or
 * world deity keeps the initial values. Written by the worship actions and the offering and day-sweep code, never by hand.
 * @param {object} fields foundry.data.fields
 */
export function deityBondField(fields) {
  return new fields.SchemaField({
    status: new fields.StringField({ initial: 'known', choices: [...BOND_STATUSES] }),
    patronage: patronageField(fields, { status: 'none' }),
    knownVia: new fields.StringField({ initial: 'seen', choices: [...BOND_KNOWN_VIA] }),
    tier: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
    zealotSkill: new fields.StringField({ initial: '' }),
    since: new fields.NumberField({ nullable: true, initial: null }),
    lastOfferingDay: new fields.NumberField({ integer: true, nullable: true, initial: null }),
    missedDays: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    streak: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    offenses: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    shunned: new fields.NumberField({ integer: true, min: 0, max: SHUNNED_MAX, initial: 0 }),
    floorOfferings: new fields.SchemaField({
      floor: new fields.StringField({ initial: '' }),
      count: new fields.NumberField({ integer: true, min: 0, initial: 0 })
    })
  });
}
