/**
 * Context for the identity row editors of a race or class: the rows the modifier editor does not cover.
 * Built like the item sheet's other editors, so a live sheet can adopt them later by calling this and including the
 * `identity-rows` partial. The Race and Class Creators use it through a `PerkRowsHost`. The grant rows, starting items, senses, movement, stat caps and `requires`.
 */
import { offeredEntries } from '../../utils/content-source.mjs';
import { tagPickerOptions } from './row-host.mjs';
import { GRANT_ROW_FIELDS, grantRowView } from './grant-row-fields.mjs';
import { buildQueryView } from './context-query.mjs';
import { pickOptions } from '../../utils/ui/field-options.mjs';
import { queryBucketsAt, toArray } from './util.mjs';
import { startingItemErrors } from '../../models/items/grant-validation.mjs';

/** The Add chips of the grant rows, one per kind and mode (`kind:mode`), with their label keys. */
export function grantAddBar() {
  return Object.keys(GRANT_ROW_FIELDS).map((kindKey) => ({ kindKey, labelKey: `COG.Rows.Grant.Add.${kindKey.replace(':', '_')}` }));
}

/** Item types a starting item can name: every builder item type except the lore types, plus the two companion actors. */
const STARTING_ITEM_TYPES = Object.freeze([
  'skill', 'spell', 'attack', 'gear', 'buff', 'debuff', 'loot', 'space_upgrade', 'actor:pet', 'actor:mount'
]);

/** The catalog kind an item type is offered from in the identifier suggestions (companions have none). */
const CATALOG_KIND = Object.freeze({ skill: 'skills', spell: 'spells', buff: 'buffs', debuff: 'debuffs' });

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

/** The identifiers the catalog knows for an item type, as datalist suggestions (the author may type any other). */
function identifierSuggestions(itemType) {
  if (itemType.startsWith('actor:')) return [];
  const kind = CATALOG_KIND[itemType] ?? 'items';
  const seen = new Set();
  const out = [];
  for (const def of offeredEntries(kind)) {
    if (kind === 'items' && def?.type !== itemType) continue;
    const value = def?.system?.identifier || def?._id || def?.id;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: def.name || value });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** The view of one starting item row (`rowPath` is `system.startingItems.<i>`). */
function startingItemView(row, rowPath, index, tagOptions, item) {
  const source = row && typeof row === 'object' ? row : {};
  const mode = source.mode === 'choice' ? 'choice' : 'fixed';
  const itemType = String(source.itemType ?? '');
  const types = pickOptions(STARTING_ITEM_TYPES.map((id) => ({ id, label: loc(`COG.Rows.StartingItem.Type.${id.replace(':', '_')}`) })), itemType);
  if (itemType && !types.some((option) => option.selected)) types.push({ value: itemType, label: itemType, selected: true });
  const errors = startingItemErrors(source);
  const queryPath = `${rowPath}.query`;
  return {
    path: rowPath,
    index,
    mode,
    isChoice: mode === 'choice',
    itemTypeName: `${rowPath}.itemType`,
    modeName: `${rowPath}.mode`,
    quantityName: `${rowPath}.quantity`,
    identifierName: `${rowPath}.identifier`,
    labelName: `${rowPath}.label`,
    listId: `${rowPath}.identifier.list`,
    itemTypeOptions: types,
    modeOptions: ['fixed', 'choice'].map((value) => ({ value, labelKey: `COG.Rows.StartingItem.Mode.${value}`, selected: value === mode })),
    quantity: Number.isFinite(Number(source.quantity)) && Number(source.quantity) >= 1 ? Number(source.quantity) : 1,
    identifier: String(source.identifier ?? ''),
    suggestions: identifierSuggestions(itemType),
    label: String(source.label ?? ''),
    query: buildQueryView(source.query, queryPath, (item && queryBucketsAt(item, queryPath)) || ['all', 'any', 'none']),
    tagOptions,
    incomplete: errors.length > 0,
    problem: errors.join('; ')
  };
}

const SCALAR_GROUPS = Object.freeze({
  senses: Object.freeze([
    Object.freeze({ key: 'darkvision', type: 'number', min: 0, step: 1 }),
    Object.freeze({ key: 'darkvisionUnlimited', type: 'checkbox' }),
    Object.freeze({ key: 'rangeMultiplier', type: 'number', min: 0, step: 'any' })
  ]),
  movement: Object.freeze(['walkDelta', 'climb', 'swim', 'fly', 'burrow'].map((key) => Object.freeze({ key, type: 'number', step: 1 }))),
  statCaps: Object.freeze(['str', 'dex', 'con', 'int', 'cha'].map((key) => Object.freeze({ key, type: 'number', min: 0, step: 1 })))
});
const SCALAR_INITIALS = Object.freeze({
  senses: { darkvision: null, darkvisionUnlimited: false, rangeMultiplier: 1 },
  movement: { walkDelta: 0, climb: 0, swim: 0, fly: 0, burrow: 0 },
  statCaps: { str: null, dex: null, con: null, int: null, cha: null }
});

/**
 * One group of scalar inputs (senses, movement, stat caps). A number at its initial value shows blank, so the author sees
 * only what is set: a blank input stores nothing.
 */
function scalarGroup(group, value) {
  const stored = value && typeof value === 'object' ? value : {};
  return {
    group,
    titleKey: `COG.Rows.Identity.${group}.Title`,
    hintKey: `COG.Rows.Identity.${group}.Hint`,
    fields: SCALAR_GROUPS[group].map((def) => {
      const current = stored[def.key];
      const isDefault = current === undefined || current === null || current === SCALAR_INITIALS[group][def.key];
      return {
        ...def,
        isCheckbox: def.type === 'checkbox',
        isNumber: def.type === 'number',
        hasMin: def.min !== undefined,
        name: `system.${group}.${def.key}`,
        labelKey: `COG.Rows.Identity.${group}.${def.key}`,
        checked: current === true,
        value: def.type === 'number' && !isDefault ? current : ''
      };
    })
  };
}

/**
 * Adds `identityRows` to a render context.
 * @param {object} context render context (mutated); `context.system` is the normalised copy of `item.system`
 * @param {object} item the row host or item (its schema gives the query editor its buckets)
 * @param {{ skills?: object[], spells?: object[], locked?: boolean }} [options] the skill and spell entries to offer
 *   (default: the registry catalogs); `locked` hides each row's kind and mode selects and the Add chips (the creators' stat pool and rank bonus lists)
 */
export function buildIdentityRowsContext(context, item, { skills, spells, locked = false } = {}) {
  const tagOptions = context.techniqueTagOptions ?? tagPickerOptions();
  const ctx = { item, tagOptions, skills, spells, locked };
  const rows = toArray(context.system?.grants ?? item?.system?.grants);
  context.identityRows = {
    grants: {
      rows: rows.map((row, index) => grantRowView(row ?? {}, `system.grants.${index}`, { ...ctx, index })),
      addBar: locked ? [] : grantAddBar()
    },
    startingItems: {
      rows: toArray(context.system?.startingItems ?? item?.system?.startingItems)
        .map((row, index) => startingItemView(row, `system.startingItems.${index}`, index, tagOptions, item)),
      addKey: 'startingItem'
    },
    scalars: ['senses', 'movement', 'statCaps'].map((group) => scalarGroup(group, context.system?.[group] ?? item?.system?.[group])),
    requires: {
      query: buildQueryView(context.system?.requires ?? item?.system?.requires, 'system.requires', (item && queryBucketsAt(item, 'system.requires')) || ['all', 'any', 'none']),
      tagOptions
    },
    tagOptions
  };
}
