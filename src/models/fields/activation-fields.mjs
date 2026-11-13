import { tagQueryField } from './tag-fields.mjs';
import { cooldownField } from './timing-fields.mjs';

/**
 * A buff's activation window (D3): while `enabled`, the buff's rows apply only inside a window that Use opens. `cooldown`
 * is a normal cooldown (`{ value: 1, unit: 'day' }` = once per 30-hour day); `window.unit` is one of
 * `ACTIVATION_WINDOW_UNITS` (no `choices`: the normaliser validates). `open`, `closesAt`, `combatId` and `usesLeft` are
 * engine state, written by Use, End and the closing paths, never authored.
 * @param {object} fields foundry.data.fields
 */
export function activationField(fields) {
  return new fields.SchemaField({
    enabled: new fields.BooleanField({ initial: false }),
    cooldown: cooldownField(fields),
    window: new fields.SchemaField({
      unit: new fields.StringField({ initial: 'use' }),
      value: new fields.NumberField({ min: 0, initial: 1 }),
      query: tagQueryField(fields, { nullable: true, initial: null })
    }),
    open: new fields.BooleanField({ initial: false }),
    closesAt: new fields.NumberField({ nullable: true, initial: null }),
    combatId: new fields.StringField({ initial: '', blank: true }),
    usesLeft: new fields.NumberField({ integer: true, min: 0, initial: 0 })
  });
}
