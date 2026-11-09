import { tagQueryField } from './tag-fields.mjs';
import { damageModifiersField, asTriggersField, defenseModifiersField, rollModifiersField } from './modifier-fields.mjs';
import { grantsField } from './grant-fields.mjs';

/**
 * One prize row of a loot box (`system.box.contents[]`, 7.3a). `kind` is a `CONFIG.COG.rowKinds.boxContents` id (item, spell,
 * gold, table, magicItem, or a module's); a kind reads only the fields it lists, so the rest stay at their defaults.
 * `name` and `img` are display snapshots taken at drop time and never resolved. The tier is a `CONFIG.COG.lootBoxTiers`
 * id, sanitized on read, so there is no closed `choices` list.
 * @param {object} fields foundry.data.fields
 */
export function lootBoxRowField(fields) {
  return new fields.SchemaField({
    kind: new fields.StringField({ initial: 'item' }),
    uuid: new fields.StringField({ initial: '' }),
    identifier: new fields.StringField({ initial: '' }),
    itemType: new fields.StringField({ initial: '' }),
    name: new fields.StringField({ initial: '' }),
    img: new fields.StringField({ initial: '' }),
    quantity: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
    // gold: '25' or '2d6*10'; table: '' = the table's own formula
    formula: new fields.StringField({ initial: '' }),
    // table: flags.sprinter-rpg.tableKey, looked up before the uuid
    tableKey: new fields.StringField({ initial: '' }),
    // spell: the Rank taught (null = 1)
    rank: new fields.NumberField({ integer: true, min: 1, nullable: true, initial: null }),
    // magicItem: a CONFIG.COG.lootGenerators id ('' = the tier's)
    generator: new fields.StringField({ initial: '' }),
    // magicItem: a lootBoxTiers id ('' = the box's own tier)
    tier: new fields.StringField({ initial: '' }),
    // choice: the tag query the opener picks from (7.3i), as `startingItems[].query`
    query: tagQueryField(fields),
    // table: what each rolled row becomes ('' = its narrative and options | 'skillPotion' | 'item')
    as: new fields.StringField({ initial: '' }),
    // table: a dice formula for how many times to roll ('' = `quantity`)
    times: new fields.StringField({ initial: '' }),
    label: new fields.StringField({ initial: '' })
  });
}

/**
 * One material line of a blueprint or an enchantment step (3.15). `identifier` or `query` selects the loot; the loot's
 * own `material.unsalvageable` tag also makes a line unsalvageable.
 * @param {object} fields foundry.data.fields
 */
export function craftMaterialsField(fields) {
  return new fields.ArrayField(new fields.SchemaField({
    label: new fields.StringField({ initial: '' }),
    identifier: new fields.StringField({ initial: '' }),
    query: tagQueryField(fields, { nullable: true, initial: null }),
    quantity: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
    salvageable: new fields.BooleanField({ initial: true })
  }), { initial: [] });
}

/**
 * What one enchantment adds before it is applied: existing row shapes under `rows`. `category` is a
 * `CONFIG.COG.enchantmentCategories` id (no `choices`: a module may register more); `property` '' means derived from the rows.
 * @param {object} fields foundry.data.fields
 */
export function enchantmentTemplateField(fields) {
  return new fields.SchemaField({
    id: new fields.StringField({ initial: '' }),
    label: new fields.StringField({ initial: '' }),
    property: new fields.StringField({ initial: '' }),
    category: new fields.StringField({ initial: 'other', blank: false }),
    bonusLevel: new fields.NumberField({ integer: true, min: 0, initial: 1 }),
    skills: tagQueryField(fields, { nullable: true, initial: null }),
    tables: tagQueryField(fields, { nullable: true, initial: null }),
    materials: craftMaterialsField(fields),
    rows: new fields.SchemaField({
      grants: grantsField(fields),
      damageModifiers: damageModifiersField(fields),
      defenseModifiers: defenseModifiersField(fields),
      attackModifiers: rollModifiersField(fields),
      checkModifiers: rollModifiersField(fields),
      asTriggers: asTriggersField(fields)
    })
  });
}

/**
 * What a gear or loot item has been enchanted with. The rows each entry wrote carry `enchantment: <id>`. `method` is
 * descriptive (craft, outcome, floor-sim, loot-box, gm).
 * @param {object} fields foundry.data.fields
 */
export function enchantmentLedgerField(fields) {
  return new fields.ArrayField(new fields.SchemaField({
    id: new fields.StringField({ initial: '' }),
    label: new fields.StringField({ initial: '' }),
    property: new fields.StringField({ initial: '' }),
    category: new fields.StringField({ initial: 'other', blank: false }),
    bonusLevel: new fields.NumberField({ integer: true, min: 0, initial: 1 }),
    method: new fields.StringField({ initial: 'craft' }),
    ruleBreak: new fields.BooleanField({ initial: false }),
    tags: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    // 7.3 D15: a generated magic item's property the GM is still to finish (recorded with the table row's words, no rows)
    pending: new fields.BooleanField({ initial: false })
  }), { initial: [] });
}
