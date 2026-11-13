/**
 * src/utils/skill/skill-specialty-options.mjs
 * Display side of a skill's specialty (3.15 G4a): the label of the stored tag and the grouped options the skill sheet
 * offers. The stored value is one tag id; a label is never read by a mechanic.
 */
import { COG_TAGS } from '../../data/tag-catalog.mjs';
import { getCustomTags, getTagDefinition } from '../../data/tag-definitions.mjs';
import { identityTag } from '../../data/tag-vocabulary.mjs';
import { ITEM_STATE_TAGS } from '../tag/tag-mechanics.mjs';
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { sanitizeSpecialty } from './skill-specialty.mjs';
import { INVENTORY_ITEM_TYPES } from '../document-types.mjs';

const STATE_TAGS = new Set(Object.values(ITEM_STATE_TAGS));
const GEAR_TYPES = new Set(INVENTORY_ITEM_TYPES);

/** Identity tag -> item name of every world and catalog gear or loot item. */
function itemNames() {
  const out = new Map();
  const add = (doc) => {
    const tag = identityTag(doc.type, doc?.system?.identifier);
    if (tag && doc?.name && !out.has(tag)) out.set(tag, doc.name);
  };
  for (const doc of globalThis.game?.items ?? []) if (GEAR_TYPES.has(doc?.type)) add(doc);
  for (const doc of catalogEntries('items')) if (GEAR_TYPES.has(doc?.type)) add(doc);
  return out;
}

/** What to show for a stored specialty: the item's name for an `id.*` tag, else the tag catalog label, else the raw tag. */
export function specialtyLabel(raw) {
  const tag = sanitizeSpecialty(raw);
  if (!tag) return '';
  if (tag.startsWith('id.')) {
    const name = itemNames().get(tag);
    if (name) return name;
  }
  return getTagDefinition(tag)?.label || tag;
}

/**
 * The picker groups. Each holds `{ value, label, selected }` options: "Item types" (the registered `item.*` tags except
 * the broken/destroyed states) and "Items" (identity tags of world and catalog gear and loot). Empty groups are dropped.
 * @param {string} current the stored specialty
 * @param {{ itemTypes: string, items: string }} labels group headings
 */
export function buildSpecialtyOptions(current, labels) {
  const value = sanitizeSpecialty(current);
  const seen = new Set();
  const types = [...COG_TAGS, ...getCustomTags()]
    .filter((t) => typeof t?.id === 'string' && t.id.startsWith('item.') && !STATE_TAGS.has(t.id) && !seen.has(t.id) && seen.add(t.id))
    .map((t) => ({ value: t.id, label: t.label || t.id, selected: t.id === value }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const items = [...itemNames()]
    .map(([tag, label]) => ({ value: tag, label, selected: tag === value }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [
    { label: labels.itemTypes, options: types },
    { label: labels.items, options: items }
  ].filter((g) => g.options.length);
}
