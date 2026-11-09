/**
 * Tag query schema for conditional modifiers ({all: [], any: [], none: []}).
 * @param {object} fields foundry.data.fields
 * @param {object} [options] SchemaField options (`{ nullable: true, initial: null }` for an optional query)
 */
export function tagQueryField(fields, options = {}) {
  return new fields.SchemaField({
    all: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    any: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    none: new fields.ArrayField(new fields.StringField(), { initial: [] })
  }, options);
}

/**
 * "Per something" scaling for one modifier row. null = unscaled.
 * `source` is a CONFIG.COG.scalars id (no `choices`: a module may register scalars after schemas exist, and a world
 * whose module was removed must still load); `scope`, `where` and `stat` are read only by scalars that declare them.
 * The row's own number x (base + per x n), clamped to [min, max]; per defaults to 1, base to 0 (whole numbers) or 1 (multipliers).
 * @param {object} fields foundry.data.fields
 */
export function scaleByField(fields) {
  return new fields.SchemaField({
    source: new fields.StringField({ initial: '', blank: true }),
    scope: new fields.StringField({ initial: '', blank: true }),
    where: tagQueryField(fields),
    stat: new fields.StringField({ initial: '', blank: true, choices: ['', 'str', 'dex', 'con', 'int', 'cha'] }),
    per: new fields.NumberField({ nullable: true, initial: null }),
    base: new fields.NumberField({ nullable: true, initial: null }),
    min: new fields.NumberField({ nullable: true, initial: null }),
    max: new fields.NumberField({ nullable: true, initial: null })
  }, { nullable: true, initial: null });
}

/**
 * Where a row of a skill, spell or attack item applies (E8.7): `item` (the default) only when that item is the action,
 * `owner` to every roll of the owner. Read for damage, attack and check rows; gear (outside its own attack), buffs,
 * races, classes and other sources are always owner-wide and ignore it. A choice list, not an enum of content.
 * @param {object} fields foundry.data.fields
 */
export function rowScopeField(fields) {
  return new fields.StringField({ initial: 'item', blank: false, choices: ['item', 'owner'] });
}

/**
 * The ledger id of the enchantment a row came from; '' for a row authored on the item (3.15, crafting-system.md C1).
 * Added to the five row schemas an enchantment can write into.
 * @param {object} fields foundry.data.fields
 */
export const enchantmentRef = (fields) => new fields.StringField({ initial: '', blank: true });
