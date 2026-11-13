/**
 * Perk rows in the Race and Class Creators.
 *
 * A custom benefit or detriment carries `rows: [{ path, row }]` (the shape `applyPerkRows` reads). The creator shows
 * them through the item sheet's own row editor by handing it a {@link PerkRowsHost}: an item-shaped adapter, in the
 * Tag Manager's pattern, whose `system` projects the perk's rows onto the real schema (an array per modifier array
 * and `tags`). `buildRowEditorContext`, `ROW_ACTIONS`, `TAG_ACTIONS` and `PICK_LIST_ACTIONS` then run against it
 * unchanged. `update()` turns `system` back into rows and hands them to `save`.
 *
 * Two pure functions do the projection both ways: {@link systemFromRows} and {@link rowsFromSystem}.
 */
import { damageModifiersField, defenseModifiersField, rollModifiersField, manaCostModifiersField, recoveryModifiersField, statSubstitutionsField, popularityTriggersField, sensesField, statCapsField } from '../models/fields/modifier-fields.mjs';
import { grantsField, startingItemsField } from '../models/fields/grant-fields.mjs';
import { requirementsField } from '../models/fields/requirement-fields.mjs';
import { buildRowEditorContext } from '../sheets/item/context-rows.mjs';
import { ROW_ACTIONS } from '../sheets/item/actions-rows.mjs';
import { TAG_ACTIONS } from '../sheets/item/actions-tags.mjs';
import { PICK_LIST_ACTIONS } from '../sheets/item/actions-lists.mjs';
import { renameRowPaths, retargetRow, tagPickerOptions } from '../sheets/item/row-host.mjs';
import { buildIdentityRowsContext } from '../sheets/item/context-identity-rows.mjs';
import { trimGrantRow } from '../sheets/item/grant-row-fields.mjs';
import { buildRequirementRowsContext, trimRequirementRow } from '../sheets/item/context-requirements.mjs';
import { buildTagPills } from '../sheets/base/tag-editor.mjs';
import { PERK_ROW_PATHS, applyPerkRows, fieldOf } from '../utils/character/perk-rows.mjs';

const clone = (value) => foundry.utils.deepClone(value);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The `system` keys of the row arrays the creator edits with the item sheet's modifier editor. */
const MODIFIER_KEYS = Object.freeze([
  'damageModifiers', 'defenseModifiers', 'attackModifiers', 'checkModifiers',
  'manaCostModifiers', 'recoveryModifiers', 'statSubstitutions', 'popularityTriggers'
]);

/** Every `system` key the host presents and the rows form may write. */
export const EDITABLE_KEYS = Object.freeze([...MODIFIER_KEYS, 'tags', 'grants', 'startingItems', 'senses', 'movement', 'statCaps', 'requirements']);

/** The perk-row paths that have an editor in the creators. */
export const EDITABLE_PATHS = Object.freeze(EDITABLE_KEYS.map((key) => `system.${key}`));

/** What a `merge` path holds when nothing is set; a row keeps only the keys that differ. */
export const MERGE_INITIALS = Object.freeze({
  statCaps: Object.freeze({ str: null, dex: null, con: null, int: null, cha: null }),
  senses: Object.freeze({ darkvision: null, darkvisionUnlimited: false, rangeMultiplier: 1 }),
  movement: Object.freeze({ walkDelta: 0, climb: 0, swim: 0, fly: 0, burrow: 0 })
});

/** The tag-query buckets, in order. */
const BUCKETS = Object.freeze(['all', 'any', 'none']);

/** What an object key of `system` holds when it is untouched (the merge keys' initials). */
const objectInitial = (key) => ({ ...MERGE_INITIALS[key] });

/** The `system` keys that are objects (a merge path) rather than arrays. */
const OBJECT_KEYS = Object.freeze(['senses', 'movement', 'statCaps']);

/**
 * The creators' own row lists that edit `grants` rows of one kind and mode. A spec row is the grant row
 * without `kind` and `mode`, plus the ledger-only `cost` (rank bonuses); the host locks kind and mode.
 */
export const SPEC_GRANT_LISTS = Object.freeze({
  statPools: Object.freeze({ kind: 'stat', mode: 'pool', ledgerKeys: Object.freeze([]) }),
  rankBonuses: Object.freeze({ kind: 'rank_bonus', mode: 'fixed', ledgerKeys: Object.freeze(['cost']) })
});

/** The creators' own list of requirement rows: `spec.requirements`, one rows form with no perk index. */
export const SPEC_REQUIREMENTS_LIST = 'requirements';

/** Whether `list` is one of the creators' own row lists (a form with no perk index) rather than a perk list. */
const isSpecList = (list) => Object.hasOwn(SPEC_GRANT_LISTS, list) || list === SPEC_REQUIREMENTS_LIST;

/** The input-name root of one perk's rows form, or of a spec list's (which has no index). */
const perkRowsRoot = (list, index) => (isSpecList(list) ? `perkRows.${list}` : `perkRows.${list}.${index}`);

/**
 * Perk rows to a `system` object (pure). Like `applyPerkRows`, except that an appended row is never skipped for being
 * the same as an earlier one: the editor must show a row the user just added or duplicated (the builder dedupes at
 * build time). A path that is not a perk-row path is ignored.
 * @param {{path: string, row: *}[]} rows
 * @returns {object}
 */
export function systemFromRows(rows) {
  const system = {};
  for (const entry of Array.isArray(rows) ? rows : []) {
    const how = PERK_ROW_PATHS[entry?.path];
    if (!how || entry.row === undefined) continue;
    if (how === 'append') {
      const field = fieldOf(entry.path);
      if (!Array.isArray(system[field])) system[field] = [];
      system[field].push(structuredClone(entry.row));
    } else {
      applyPerkRows(system, [entry]);
    }
  }
  return system;
}

/**
 * A `system` object back to perk rows (pure), in `PERK_ROW_PATHS` order. `append` and `union` paths give one row per
 * entry. A `merge` path gives one row holding only the keys that differ from the field's initial value (a full object
 * would overwrite another perk's `fly: 30` with `fly: 0`).
 * @param {object} system
 * @returns {{path: string, row: *}[]}
 */
export function rowsFromSystem(system) {
  const out = [];
  for (const [path, how] of Object.entries(PERK_ROW_PATHS)) {
    const field = fieldOf(path);
    const value = system?.[field];
    if (how === 'append') {
      for (const row of Array.isArray(value) ? value : []) if (isPlain(row)) out.push({ path, row: structuredClone(row) });
    } else if (how === 'union') {
      const seen = new Set();
      for (const tag of Array.isArray(value) ? value : []) {
        if (typeof tag !== 'string' || !tag.trim() || seen.has(tag)) continue;
        seen.add(tag);
        out.push({ path, row: tag });
      }
    } else if (how === 'merge') {
      const initial = MERGE_INITIALS[field] ?? {};
      const row = {};
      for (const [key, entry] of Object.entries(isPlain(value) ? value : {})) {
        if (entry !== undefined && entry !== initial[key]) row[key] = entry;
      }
      if (Object.keys(row).length) out.push({ path, row });
    }
  }
  return out;
}

let hostSchema = null;

/** The schema fields the host presents as `system`: the item row fields, `tags`, and a `rank` (so rank gates show). */
function hostFields() {
  if (hostSchema) return hostSchema;
  const fields = foundry.data.fields;
  hostSchema = {
    damageModifiers: damageModifiersField(fields),
    defenseModifiers: defenseModifiersField(fields),
    attackModifiers: rollModifiersField(fields),
    checkModifiers: rollModifiersField(fields),
    manaCostModifiers: manaCostModifiersField(fields),
    recoveryModifiers: recoveryModifiersField(fields),
    statSubstitutions: statSubstitutionsField(fields),
    popularityTriggers: popularityTriggersField(fields),
    tags: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    grants: grantsField(fields),
    requirements: requirementsField(fields),
    startingItems: startingItemsField(fields),
    senses: sensesField(fields),
    // The same fields as the race and class models' `movement` (MERGE_INITIALS is tested against them).
    movement: new fields.SchemaField({
      walkDelta: new fields.NumberField({ integer: true, initial: 0 }),
      climb: new fields.NumberField({ integer: true, initial: 0 }),
      swim: new fields.NumberField({ integer: true, initial: 0 }),
      fly: new fields.NumberField({ integer: true, initial: 0 }),
      burrow: new fields.NumberField({ integer: true, initial: 0 })
    }),
    statCaps: statCapsField(fields),
    rank: new fields.NumberField({ integer: true, initial: 0 })
  };
  return hostSchema;
}

class PerkRowsSystem {
  static get schema() {
    return { fields: hostFields() };
  }
}

const number = (value) => (value === null || value === undefined || String(value).trim() === '' ? NaN : Number(value));

/** A starting item kept to what its mode uses: blank text, an empty query and a stale `query` on a fixed row are left out. */
function trimStartingItem(row) {
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const mode = row?.mode === 'choice' ? 'choice' : 'fixed';
  const out = {};
  if (text(row?.itemType)) out.itemType = text(row.itemType);
  out.mode = mode;
  const quantity = Math.trunc(number(row?.quantity));
  out.quantity = Number.isFinite(quantity) && quantity >= 1 ? quantity : 1;
  if (mode === 'fixed') {
    if (text(row?.identifier)) out.identifier = text(row.identifier);
    if (text(row?.uuid)) out.uuid = text(row.uuid);
  } else if (BUCKETS.some((bucket) => Array.isArray(row?.query?.[bucket]) && row.query[bucket].length)) {
    out.query = Object.fromEntries(BUCKETS.map((bucket) => [bucket, [...(row.query[bucket] ?? [])]]));
  }
  if (text(row?.label)) out.label = text(row.label);
  return out;
}

/**
 * An object key (senses, movement, stat caps) laid over what it held, with every number cleaned: a blank or
 * non-numeric input stores nothing (the key's initial value), so the row keeps only what the author set.
 */
function cleanObjectKey(key, value, current) {
  const merged = { ...objectInitial(key), ...(isPlain(current) ? current : {}), ...(isPlain(value) ? value : {}) };
  const initial = objectInitial(key);
  const out = {};
  for (const name of Object.keys(initial)) {
    const entry = merged[name];
    if (name === 'darkvisionUnlimited') out[name] = entry === true || entry === 'true';
    else {
      const n = number(entry);
      if (!Number.isFinite(n)) out[name] = initial[name];
      else if (key === 'movement') out[name] = Math.trunc(n);
      else if (key === 'statCaps') out[name] = Math.max(0, Math.trunc(n));
      else out[name] = Math.max(0, n);
    }
  }
  return out;
}

/** A blank `system`: an empty array per array key, the initial object per object key. */
function blankSystem() {
  const system = new PerkRowsSystem();
  for (const key of EDITABLE_KEYS) system[key] = OBJECT_KEYS.includes(key) ? objectInitial(key) : [];
  return system;
}

/** Clean one key's value through its schema field: rows are filled with defaults, anything that is not a row is dropped. */
function cleanKey(key, value, current) {
  if (OBJECT_KEYS.includes(key)) return cleanObjectKey(key, value, current);
  const list = Array.isArray(value) ? value : [];
  if (key === 'startingItems') return list.filter(isPlain).map(trimStartingItem);
  if (key === 'tags') return [...new Set(list.map((tag) => String(tag ?? '').trim()).filter(Boolean))];
  const rows = hostFields()[key].clean(clone(list.filter(isPlain)));
  // A grant row keeps only the fields its kind and mode show (so a kind change leaves no stale stat behind).
  if (key === 'requirements') return rows.map((row) => hostFields().requirements.element.clean(trimRequirementRow(row)));
  return key === 'grants' ? rows.map(trimGrantRow) : rows;
}

/** Apply `{ 'system.<key>': value }` changes to a host's `system`; returns whether any editable key was touched. */
function applyChanges(system, changes) {
  let touched = false;
  for (const [path, value] of Object.entries(changes ?? {})) {
    if (!path.startsWith('system.')) continue;
    const rest = path.slice('system.'.length);
    const key = rest.split('.')[0];
    if (!EDITABLE_KEYS.includes(key)) continue;
    touched = true;
    if (rest === key) system[key] = cleanKey(key, value, system[key]);
    else {
      foundry.utils.setProperty(system, rest, value);
      system[key] = cleanKey(key, system[key]);
    }
  }
  return touched;
}

/**
 * An item-shaped view of one custom perk's rows for the item sheet's row editor and actions.
 * `update({ 'system.<key>': value })` (or a dotted path inside it) cleans the key, turns `system` back into rows and
 * hands them to `save`. Rows on a path this host has no editor for are kept as they were.
 */
export class PerkRowsHost {
  /**
   * @param {'race'|'class'} builderType
   * @param {{path: string, row: *}[]} rows the perk's rows
   * @param {{ save?: (rows: {path: string, row: *}[]) => any }} [options]
   */
  constructor(builderType, rows, { save } = {}) {
    this.id = `perk-rows-${builderType}`;
    this.type = builderType === 'race' ? 'race' : 'class';
    /** A creator's draft, checked at Save: new grant rows start blank (`startGrantRow`). */
    this.holdsDraft = true;
    const all = (Array.isArray(rows) ? rows : []).filter((entry) => entry && Object.hasOwn(PERK_ROW_PATHS, entry.path));
    const mine = all.filter((entry) => EDITABLE_PATHS.includes(entry.path));
    this._others = all.filter((entry) => !EDITABLE_PATHS.includes(entry.path)).map((entry) => clone(entry));
    this.system = blankSystem();
    const projected = systemFromRows(mine);
    for (const key of EDITABLE_KEYS) {
      if (OBJECT_KEYS.includes(key)) this.system[key] = cleanObjectKey(key, projected[key]);
      else this.system[key] = projected[key] ?? [];
    }
    this._save = save;
  }

  /** The perk's rows now: the editable ones from `system`, then the rows this host does not edit. */
  rows() {
    return [...rowsFromSystem(this.system), ...clone(this._others)];
  }

  async update(changes) {
    return applyChanges(this.system, changes) ? this._save?.(this.rows()) : undefined;
  }
}

/** A spec row of a {@link SPEC_GRANT_LISTS} list as the grant row the editor shows. */
function grantRowFromSpec(list, row) {
  const def = SPEC_GRANT_LISTS[list];
  const grant = { kind: def.kind };
  if (def.mode !== 'fixed') grant.mode = def.mode;
  for (const [key, value] of Object.entries(isPlain(row) ? row : {})) {
    if (!def.ledgerKeys.includes(key) && value !== undefined) grant[key] = clone(value);
  }
  return grant;
}

/**
 * A grant row back to the spec row. The ledger-only keys of the old row ride along; every other key is the grant's, so a
 * field the author cleared is gone. A rank bonus whose value first goes below 0 starts as a floor-1 `onlyIfOwned` row
 * (what the catalog's skill penalty does) unless the author has set either.
 */
export function specRowFromGrant(list, grant, old = {}) {
  const def = SPEC_GRANT_LISTS[list];
  const { kind, mode, ...rest } = isPlain(grant) ? grant : {};
  const row = {};
  for (const key of def.ledgerKeys) if (old?.[key] !== undefined) row[key] = old[key];
  Object.assign(row, rest);
  if (list === 'rankBonuses' && Number(row.value) < 0 && !(Number(old?.value) < 0) && !row.floor && !row.onlyIfOwned) {
    row.floor = 1;
    row.onlyIfOwned = true;
  }
  return row;
}

/**
 * An item-shaped view of one of the creator's stat pool or rank bonus lists: `system.grants` holds one
 * grant row per spec row, kind and mode locked, so the grant row editor and its actions run unchanged. `update` hands the
 * cleaned grant rows to `save`.
 */
export class SpecGrantRowsHost {
  /**
   * @param {'statPools'|'rankBonuses'} list
   * @param {object[]} rows the spec rows
   * @param {{ save?: (grants: object[]) => any }} [options]
   */
  constructor(list, rows, { save } = {}) {
    this.id = `spec-grants-${list}`;
    this.type = 'race';
    this.holdsDraft = true;
    this.list = list;
    this.system = blankSystem();
    this.system.grants = (Array.isArray(rows) ? rows : []).map((row) => grantRowFromSpec(list, row));
    this._save = save;
  }

  async update(changes) {
    return applyChanges(this.system, changes) ? this._save?.(clone(this.system.grants)) : undefined;
  }
}

/**
 * An item-shaped view of the creator's own `spec.requirements`: `system.requirements` holds the spec rows, so the
 * requirement row editor and the item sheet's row, tag and pick-list actions run unchanged. `update` hands the cleaned rows
 * (each trimmed to the fields its kind shows) to `save`.
 */
export class SpecRequirementsHost {
  /**
   * @param {'race'|'class'} builderType
   * @param {object[]} rows the spec rows
   * @param {{ save?: (rows: object[]) => any }} [options]
   */
  constructor(builderType, rows, { save } = {}) {
    this.id = `spec-requirements-${builderType}`;
    this.type = builderType === 'race' ? 'race' : 'class';
    this.system = blankSystem();
    this.system.requirements = (Array.isArray(rows) ? rows : []).filter(isPlain).map((row) => clone(row));
    this._save = save;
  }

  async update(changes) {
    return applyChanges(this.system, changes) ? this._save?.(clone(this.system.requirements)) : undefined;
  }
}

/**
 * The Requirements accordion of the creator itself: the rows of `spec.requirements` and the free-text prerequisites below
 * them, every input named `perkRows.requirements.requirements.<i>.<field>` (the prerequisites text keeps its own name and
 * `setField` action).
 * @param {'race'|'class'} builderType
 * @param {{ requirements?: object[], prerequisites?: string }} spec
 * @param {boolean} open whether the accordion is open (the viewer's state)
 * @returns {object} `context.requirementRows` for `requirement-rows.hbs`
 */
export function buildSpecRequirements(builderType, spec, open) {
  const host = new SpecRequirementsHost(builderType, spec.requirements);
  const context = {};
  buildRequirementRowsContext(context, host.system.requirements, {
    path: `${perkRowsRoot(SPEC_REQUIREMENTS_LIST)}.requirements`,
    item: host,
    open,
    prerequisitesName: 'prerequisites',
    prerequisites: spec.prerequisites,
    prerequisitesChange: { action: 'setField', field: 'prerequisites' }
  });
  return context.requirementRows;
}

/**
 * What the Mechanics part of one custom perk shows. Closed, only the row count. Open, the item sheet's modifier row
 * editor, the grant rows and the tag pills for this perk, with every input named
 * `perkRows.<list>.<index>.<key>.<n>.<field>`.
 * @param {'race'|'class'} builderType
 * @param {string} list `customBenefits` or `customDetriments`
 * @param {number} index
 * @param {{ rows?: {path: string, row: *}[] }} perk
 * @param {boolean} open
 * @param {{ skills?: object[], spells?: object[] }} [catalogs] the skill and spell entries the grant rows offer
 * @param {boolean} [requirementsOpen] whether the perk's Requirements accordion is open
 */
export function buildPerkMechanics(builderType, list, index, perk, open, catalogs = {}, requirementsOpen = false) {
  const rows = Array.isArray(perk?.rows) ? perk.rows : [];
  const view = { open: Boolean(open), count: rows.length, list, index, root: perkRowsRoot(list, index) };
  if (!open) return view;
  const host = new PerkRowsHost(builderType, rows);
  const context = { system: host.system };
  buildRowEditorContext(context, host);
  const editors = renameRowPaths(context.rowEditors ?? { blocks: [], addBar: [] }, EDITABLE_KEYS, view.root);
  const identity = { system: host.system };
  buildIdentityRowsContext(identity, host, catalogs);
  const identityRows = renameRowPaths(identity.identityRows, EDITABLE_KEYS, view.root);
  const requirements = {};
  buildRequirementRowsContext(requirements, host.system.requirements, {
    path: `${view.root}.requirements`, item: host, open: requirementsOpen, prerequisitesName: null
  });
  return {
    ...view,
    requirementRows: requirements.requirementRows,
    blocks: editors.blocks,
    addBar: editors.addBar,
    identityRows,
    tagOptions: tagPickerOptions(),
    tagsData: buildTagPills({ explicit: host.system.tags, derived: [], addPlaceholder: 'COG.PointBuilder.PerkTagPlaceholder' })
  };
}

/**
 * The grant row views of one of the creator's stat pool or rank bonus lists, one per spec row, named under
 * `perkRows.<list>.grants.<i>`. A row the builder would drop is marked incomplete (one chip for either reason).
 * @param {'statPools'|'rankBonuses'} list
 * @param {object[]} rows the spec rows
 * @param {(row: object) => boolean} counts whether the builder keeps a row (the ledger's own predicate)
 * @param {{ skills?: object[], spells?: object[] }} [catalogs]
 * @returns {object[]}
 */
export function buildSpecGrantViews(list, rows, counts, catalogs = {}) {
  const host = new SpecGrantRowsHost(list, rows);
  const context = { system: host.system };
  buildIdentityRowsContext(context, host, { ...catalogs, locked: true });
  const views = renameRowPaths(context.identityRows.grants.rows, EDITABLE_KEYS, perkRowsRoot(list));
  return views.map((view, i) => {
    const kept = counts(rows[i]);
    return { ...view, incomplete: !kept, problem: kept ? '' : (view.problem || 'The value must not be 0') };
  });
}

/**
 * The item-sheet path of a perk-form path (`perkRows.customBenefits.0.damageModifiers.1.condition` ->
 * `system.damageModifiers.1.condition`; a spec grant list has no index: `perkRows.rankBonuses.grants.0.query` ->
 * `system.grants.0.query`).
 */
export function toItemPath(path) {
  const parts = String(path ?? '').split('.');
  if (parts[0] !== 'perkRows') return String(path ?? '');
  const skip = isSpecList(parts[1]) ? 2 : 3;
  return parts.length > skip ? `system.${parts.slice(skip).join('.')}` : String(path ?? '');
}

/**
 * Actions that run the item sheet's own handlers (same names, same `data-*`) against the perk whose form the control
 * sits in. `this` is the creator (`perkRowsHost(list, index)`, `render`).
 */
const delegate = (table, name) => async function perkRowsAction(event, target) {
  const form = target.closest?.('[data-perk-list]');
  // A perk's form has `data-perk-index`; the stat pool and rank bonus lists are one form each and have none.
  const host = form ? this.perkRowsHost(form.dataset.perkList, Number(form.dataset.perkIndex)) : null;
  if (!host) return;
  await table()[name].call({ isEditable: true, item: host }, event, retargetRow(target, toItemPath));
  await this.render({ parts: ['builder', 'receipt'] });
};

export const PERK_ROW_DELEGATES = Object.freeze({
  addRow: delegate(() => ROW_ACTIONS, 'addRow'),
  deleteRow: delegate(() => ROW_ACTIONS, 'deleteRow'),
  moveRow: delegate(() => ROW_ACTIONS, 'moveRow'),
  duplicateRow: delegate(() => ROW_ACTIONS, 'duplicateRow'),
  clearRowField: delegate(() => ROW_ACTIONS, 'clearRowField'),
  addQueryTag: delegate(() => TAG_ACTIONS, 'addQueryTag'),
  removeQueryTag: delegate(() => TAG_ACTIONS, 'removeQueryTag'),
  createSituationTag: delegate(() => TAG_ACTIONS, 'createSituationTag'),
  addTag: delegate(() => TAG_ACTIONS, 'addTag'),
  removeTag: delegate(() => TAG_ACTIONS, 'removeTag'),
  addPick: delegate(() => PICK_LIST_ACTIONS, 'addPick'),
  removePick: delegate(() => PICK_LIST_ACTIONS, 'removePick'),
  addCustomPick: delegate(() => PICK_LIST_ACTIONS, 'addCustomPick')
});
