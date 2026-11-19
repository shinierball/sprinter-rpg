/**
 * Stored-data migration: a crawler's unopened loot boxes stop being embedded `loot` items (`lootType: 'box'`) and become
 * entries of its `system.lootBoxes[]`. The crawler reads its box items (`ctx.children`) and appends one entry per box it
 * does not hold yet, keeping the item's `_id` as the entry id, so a ceremony card posted before the move still names the
 * same box. Each box item is then removed, once its crawler holds an entry with its id; the runner removes it only after
 * the crawler was written. Registered at import (`loot-box-entries.mjs` imports this file, and reuses `entryFromBoxItem` for
 * a box item the GM drops onto a crawler).
 *
 * Left as items on purpose: a used or spent box (it already shows as plain loot), a box on any other actor type, and a box
 * in a token's actor delta (a delta has no type, and crawler tokens are linked).
 */
import { MIGRATION_REMOVE, registerMigration } from '../../utils/migrations/registry.mjs';
import { readFlag } from '../../utils/flags.mjs';
import { sanitizeLootBox, sanitizeLootBoxEntry } from '../../data/loot-box-rows.mjs';
import { boxItemUnits, isBoxTemplate } from './gm-only-items.mjs';

/** The flag a box item carried for the template it was made from; an entry keeps it in `template`. */
const BOX_TEMPLATE_FLAG = 'boxTemplate';
/** The flag a box item carried for the award that gave it; an entry keeps it in `awardedBy`. */
const AWARDED_BY_FLAG = 'awardedBy';

/** The actor type that holds loot boxes (the book gives boxes to crawlers). */
const CRAWLER_TYPE = 'crawler';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Pure: the entry for a box item as it was stored (a `loot` item whose `lootType` is `box`), keeping `id`. It carries the
 * name, image, identifier, units, prizes, description and the two flags a box item had (`boxTemplate` into `template`,
 * `awardedBy`); tags, notes, other flags and effects are not carried (Question 3 (a)). A missing quantity reads as one
 * unit. Also the GM's drop of a box item onto a crawler (`loot-box-entries.mjs`).
 * @param {object} source the item's plain data
 * @param {{ id: string }} options
 * @returns {object} a sanitized entry
 */
export function entryFromBoxItem(source, { id }) {
  const sys = source?.system ?? {};
  return sanitizeLootBoxEntry({
    id,
    name: source?.name,
    img: source?.img,
    identifier: sys.identifier,
    template: readFlag(source, BOX_TEMPLATE_FLAG) ?? '',
    ...sanitizeLootBox(sys.box),
    quantity: boxItemUnits(source),
    description: sys.description,
    awardedBy: readFlag(source, AWARDED_BY_FLAG) ?? ''
  });
}

/** The entry ids a crawler's stored `system.lootBoxes` holds. */
const entryIdsOf = (source) => new Set((Array.isArray(source?.system?.lootBoxes) ? source.system.lootBoxes : [])
  .map((entry) => (isRecord(entry) ? entry.id : null)).filter((id) => typeof id === 'string' && id));

/**
 * Actor: append an entry for each box item the strip showed (`isBoxTemplate`: a box, not used, a unit left) whose `_id` is
 * not an entry id yet; the entries already held come first, untouched.
 */
function moveBoxesIntoList(source, ctx) {
  if (source?.type !== CRAWLER_TYPE || ctx?.partial || !isRecord(source.system)) return source;
  const held = entryIdsOf(source);
  const added = (ctx.children?.Item ?? [])
    .filter((item) => isBoxTemplate(item) && typeof item._id === 'string' && item._id && !held.has(item._id))
    .map((item) => entryFromBoxItem(item, { id: item._id }));
  if (!added.length) return source;
  const list = Array.isArray(source.system.lootBoxes) ? source.system.lootBoxes : [];
  return { ...source, system: { ...source.system, lootBoxes: [...list, ...added] } };
}

/** Item: a box item whose crawler now holds an entry with its id goes. */
function removeMovedBox(source, ctx) {
  const parent = ctx?.parent;
  if (parent?.type !== CRAWLER_TYPE || !isBoxTemplate(source)) return source;
  return entryIdsOf(parent).has(source._id) ? MIGRATION_REMOVE : source;
}

registerMigration({
  id: 'loot-boxes-onto-crawler',
  release: '8.3.0',
  covers: ['flag:boxTemplate'],
  documents: { Actor: moveBoxesIntoList, Item: removeMovedBox }
});
