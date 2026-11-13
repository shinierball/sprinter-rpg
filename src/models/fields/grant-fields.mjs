import { tagQueryField, enchantmentRef } from './tag-fields.mjs';
import { cooldownField } from './timing-fields.mjs';
import { GRANT_KINDS, GRANT_MODES, grantRowErrors, grantedEffectErrors } from '../items/grant-validation.mjs';
import { EFFECT_ITEM_TYPES } from '../../utils/document-types.mjs';

/**
 * Typed grant schema field for structural/identity grants. A real validator: a row that fails
 * {@link grantRowErrors} fails `validate`, so Foundry rejects it on create and update instead of
 * coercing it to a default.
 *
 * `skill` and `spell` rows reference their document by `uuid` or `system.identifier`. A gear
 * `skill` row adds `value` to the skill's rank while the gear is equipped; a race/class `skill`
 * row grants `rank`. `label` is display text only and is never resolved.
 * @param {object} fields foundry.data.fields
 */
export function grantField(fields) {
  const schema = {
    kind:       new fields.StringField({ initial: 'stat', choices: GRANT_KINDS }),
    stat:       new fields.StringField({ initial: '' }),
    uuid:       new fields.StringField({ initial: '' }),
    identifier: new fields.StringField({ initial: '' }),
    tag:        new fields.StringField({ initial: '' }),
    value:      new fields.NumberField({ nullable: false, initial: 0 }),
    // stat rows: a percent of the unenhanced score, and (fixed mode) the number it was worked out to on the owner.
    percent:    new fields.NumberField({ nullable: false, initial: 0 }),
    locked:     new fields.NumberField({ nullable: true, initial: null }),
    rank:       new fields.NumberField({ nullable: false, integer: true, min: 0, initial: 1 }),
    cooldown:   cooldownField(fields),
    label:      new fields.StringField({ initial: '' }),
    // Choice rows: pick `count` of the skills/spells matching `query`, `options` or `category`.
    mode:       new fields.StringField({ initial: 'fixed', choices: GRANT_MODES }),
    count:      new fields.NumberField({ nullable: false, integer: true, min: 0, initial: 1 }),
    distinct:   new fields.BooleanField({ initial: false }),
    options:    new fields.ArrayField(new fields.StringField(), { nullable: true, initial: null }),
    // Optional: null until a row names a query. A schema (not an object) so the tag-query editor can edit it.
    query:      tagQueryField(fields, { nullable: true, initial: null }),
    category:   new fields.StringField({ initial: '' }),
    // rank_bonus: never lower an owned skill below `floor`; skip skills the actor does not own.
    floor:      new fields.NumberField({ nullable: false, integer: true, min: 0, initial: 0 }),
    onlyIfOwned: new fields.BooleanField({ initial: false }),
    enchantment: enchantmentRef(fields)
  };
  class GrantSchemaField extends fields.SchemaField {
    /** @override */
    _validateType(value, options) {
      const failure = super._validateType?.(value, options);
      if (failure instanceof Error || (failure && failure !== true)) return failure;
      const errors = grantRowErrors(value);
      if (errors.length) throw new Error(`invalid grant: ${errors.join('; ')}`);
      return failure;
    }
  }
  return new GrantSchemaField(schema);
}

/**
 * Array of typed grant schema rows.
 * @param {object} fields foundry.data.fields
 */
export function grantsField(fields) {
  return new fields.ArrayField(grantField(fields), { initial: [] });
}

/**
 * `system.grantedEffects[]` on races and classes: a frozen copy of the full payload of each buff or debuff
 * the race or class grants. `system` is an ObjectField because it holds another item type's data; that data is validated
 * by `buildPayload` and by Foundry when the applier creates the item. A real validator, as {@link grantField} is.
 * @param {object} fields foundry.data.fields
 * @param {{ tier?: boolean }} [options] `tier: true` adds the worship tier (1-3) each entry belongs to (a deity's `tierEffects`)
 */
export function grantedEffectsField(fields, { tier = false } = {}) {
  class GrantedEffectField extends fields.SchemaField {
    /** @override */
    _validateType(value, options) {
      const failure = super._validateType?.(value, options);
      if (failure instanceof Error || (failure && failure !== true)) return failure;
      const errors = grantedEffectErrors(value);
      if (errors.length) throw new Error(`invalid granted effect: ${errors.join('; ')}`);
      return failure;
    }
  }
  return new fields.ArrayField(new GrantedEffectField({
    type:   new fields.StringField({ initial: 'buff', choices: EFFECT_ITEM_TYPES }),
    name:   new fields.StringField({ initial: '' }),
    img:    new fields.StringField({ initial: '' }),
    system: new fields.ObjectField(),
    ...(tier ? { tier: new fields.NumberField({ integer: true, min: 1, max: 3, initial: 1 }) } : {})
  }), { initial: [] });
}

/**
 * Items a race or class hands out once when it is applied (see `grantStartingItems`). A fixed entry
 * references its item by `uuid` or `identifier`; a choice entry names a tag `query` the player picks from.
 * `itemType` is the Item type, or `actor:pet` / `actor:mount` for companions (routed to companion creation).
 * @param {object} fields foundry.data.fields
 */
export function startingItemsField(fields) {
  return new fields.ArrayField(new fields.SchemaField({
    uuid: new fields.StringField({ initial: '' }),
    identifier: new fields.StringField({ initial: '' }),
    itemType: new fields.StringField({ initial: '' }),
    quantity: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
    mode: new fields.StringField({ initial: 'fixed', choices: ['fixed', 'choice'] }),
    query: tagQueryField(fields),
    label: new fields.StringField({ initial: '' })
  }), { initial: [] });
}
