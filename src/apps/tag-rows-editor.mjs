/**
 * Tag Manager rows and flags.
 *
 * A tag definition may carry `rows` (item row JSON) and `flags`. The Tag Manager shows them through the item sheet's
 * row editor (`buildRowEditorContext` + `modifier-rows.hbs`, unchanged) by handing it a {@link TagRowsHost}: an
 * item-shaped adapter whose `system` holds the tag's four row arrays, whose schema is the real item row fields, and
 * whose `update()` writes the world settings. The item sheet's own row and query actions then run against it as they
 * are (`ROW_ACTIONS`, `TAG_ACTIONS`); only the input names differ (`rows.<array>.<i>.<field>`), renamed from the
 * item names after the context is built.
 *
 * Where a write goes: a world custom tag (not in the registry tables) edits its own `customTags` entry; any other tag
 * gets a `tagOverrides` entry, which wins over the registry and is removed by "Reset to default".
 * Registry definitions are never edited. GM only. Problems are shown as warnings and never block a save.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { TAG_MAP, getCustomTags, getTagDefinition } from '../data/tag-definitions.mjs';
import { damageModifiersField, defenseModifiersField, rollModifiersField } from '../models/fields/modifier-fields.mjs';
import { buildRowEditorContext } from '../sheets/item/context-rows.mjs';
import { applyHostForm, renameRowPaths, retargetRow, tagPickerOptions } from '../sheets/item/row-host.mjs';
import { ROW_ACTIONS } from '../sheets/item/actions-rows.mjs';
import { TAG_ACTIONS } from '../sheets/item/actions-tags.mjs';
import { ARRAY_UI } from '../sheets/item/row-fields.mjs';
import { describeRow } from '../utils/item-describer/feature-describer.mjs';
import { scaleSpecErrors } from '../utils/roll/scalars.mjs';
import { RULE_FLAG_DEFS, TAG_ROW_ARRAYS, getTagBehaviour, getTagOverrides, tagBehaviourErrors } from '../utils/tag/tag-behaviour.mjs';

/** The input-name root of a tag's rows in the Tag Manager form. */
export const TAG_ROWS_ROOT = 'rows';

const isGM = () => Boolean(globalThis.game?.user?.isGM);
const clone = (value) => foundry.utils.deepClone(value);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const localize = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

let hostSchema = null;

/** The schema fields the host presents as `system`: the item row fields for the four arrays, and a `rank` (rank gates show). */
function hostFields() {
  if (hostSchema) return hostSchema;
  const fields = foundry.data.fields;
  hostSchema = {
    damageModifiers: damageModifiersField(fields),
    defenseModifiers: defenseModifiersField(fields),
    attackModifiers: rollModifiersField(fields),
    checkModifiers: rollModifiersField(fields),
    rank: new fields.NumberField({ integer: true, initial: 0 })
  };
  return hostSchema;
}

class TagRowsSystem {
  static get schema() {
    return { fields: hostFields() };
  }
}

/** The rows a definition carries, as `{ [array]: row[] }` over the four arrays a tag may carry (bad shapes read as empty). */
function rowsOfDefinition(rows) {
  const out = {};
  for (const key of TAG_ROW_ARRAYS) out[key] = Array.isArray(rows?.[key]) ? clone(rows[key].filter(isPlain)) : [];
  return out;
}

/**
 * An item-shaped view of one tag's rows for the item sheet's row editor and actions. `update({ 'system.<array>': rows })`
 * cleans the rows through the item row fields (R3) and hands the non-empty arrays to `save`.
 */
class TagRowsHost {
  /**
   * @param {string} tagId
   * @param {object} rows `{ [array]: row[] }`
   * @param {{ save?: (rows: object) => Promise<any> }} options
   */
  constructor(tagId, rows, { save } = {}) {
    this.id = tagId;
    this.type = 'tag';
    this.system = new TagRowsSystem();
    Object.assign(this.system, rowsOfDefinition(rows));
    this._save = save;
  }

  /** The non-empty arrays, `{}` when no row is left. */
  rowsObject() {
    const out = {};
    for (const key of TAG_ROW_ARRAYS) if (this.system[key].length) out[key] = clone(this.system[key]);
    return out;
  }

  async update(changes) {
    const fields = hostFields();
    for (const [path, value] of Object.entries(changes ?? {})) {
      if (!path.startsWith('system.')) continue;
      const key = path.slice('system.'.length);
      if (!TAG_ROW_ARRAYS.includes(key)) continue;
      this.system[key] = fields[key].clean(clone(Array.isArray(value) ? value : []));
    }
    return this._save?.(this.rowsObject());
  }
}

// -- What a tag carries and where it is stored -------------------------------------------------------------------

/** True for a world custom tag: stored in `customTags` and not in the core table. */
function isWorldCustomTag(tagId) {
  return !TAG_MAP.has(tagId) && getCustomTags().some((t) => t?.id === tagId);
}

/** The rows and flags the editor starts from: a custom tag's own definition, else what the engine reads now (override included). */
export function editableBehaviour(tagId) {
  if (isWorldCustomTag(tagId)) {
    const def = getCustomTags().find((t) => t?.id === tagId);
    return { rows: rowsOfDefinition(def.rows), flags: Array.isArray(def.flags) ? def.flags.filter((f) => typeof f === 'string' && f.trim()) : [] };
  }
  const b = getTagBehaviour(tagId);
  return { rows: rowsOfDefinition(b?.rows), flags: b ? [...b.flags] : [] };
}

const withoutEmpty = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) if (Array.isArray(v) && v.length) out[k] = v;
  return out;
};

/**
 * Write a tag's rows and/or flags (GM only). A world custom tag updates its `customTags` entry; every other tag
 * gets (or updates) its `tagOverrides` entry. Warns and returns false for a player, an unknown tag or a failed write.
 * @param {string} tagId
 * @param {{ rows?: object, flags?: string[] }} patch
 * @returns {Promise<boolean>}
 */
export async function saveTagBehaviour(tagId, patch) {
  if (!isGM()) {
    globalThis.ui?.notifications?.warn?.(localize('COG.TagManager.GmOnly'));
    return false;
  }
  if (!getTagDefinition(tagId)) return false;
  const settings = globalThis.game.settings;
  try {
    if (isWorldCustomTag(tagId)) {
      const next = getCustomTags().map((def) => {
        if (def?.id !== tagId) return def;
        const updated = { ...def };
        if (patch.rows !== undefined) {
          const rows = withoutEmpty(patch.rows);
          if (Object.keys(rows).length) updated.rows = rows; else delete updated.rows;
        }
        if (patch.flags !== undefined) {
          if (patch.flags.length) updated.flags = [...patch.flags]; else delete updated.flags;
        }
        return updated;
      });
      await settings.set(SYSTEM_ID, 'customTags', next);
    } else {
      const overrides = { ...getTagOverrides() };
      const entry = { ...(isPlain(overrides[tagId]) ? overrides[tagId] : {}) };
      if (patch.rows !== undefined) entry.rows = withoutEmpty(patch.rows);
      if (patch.flags !== undefined) entry.flags = [...patch.flags];
      overrides[tagId] = entry;
      await settings.set(SYSTEM_ID, 'tagOverrides', overrides);
    }
  } catch (err) {
    console.warn('Sprinter RPG | Could not save tag behaviour', err);
    return false;
  }
  return true;
}

/** Remove a tag's world override ("Reset to default"). GM only. */
export async function resetTagOverride(tagId) {
  if (!isGM()) {
    globalThis.ui?.notifications?.warn?.(localize('COG.TagManager.GmOnly'));
    return false;
  }
  const overrides = { ...getTagOverrides() };
  if (!Object.hasOwn(overrides, tagId)) return false;
  delete overrides[tagId];
  await globalThis.game.settings.set(SYSTEM_ID, 'tagOverrides', overrides);
  return true;
}

/** A host for a tag whose writes go to the settings. */
export function hostForTag(tagId) {
  return new TagRowsHost(tagId, editableBehaviour(tagId).rows, { save: (rows) => saveTagBehaviour(tagId, { rows }) });
}

/** Turn one flag on or off for a tag (GM only). */
export async function setTagFlag(tagId, flag, on) {
  const flags = editableBehaviour(tagId).flags.filter((f) => f !== flag);
  if (on) flags.push(flag);
  return saveTagBehaviour(tagId, { flags });
}

/**
 * Apply the submitted `rows.*` inputs of the Tag Manager form (expanded, without the `rows` root) to a host: each
 * array is laid over the stored rows by index (the item sheet's merge), cleaned, and saved.
 * @returns {Promise<void>}
 */
export async function applyRowsForm(host, submitted) {
  return applyHostForm(host, submitted, TAG_ROW_ARRAYS);
}

// -- Context -----------------------------------------------------------------------------------------------------

/** The item-sheet path of a Tag Manager path (`rows.damageModifiers.0.condition` -> `system.damageModifiers.0.condition`). */
function toItemPath(path) {
  const text = String(path ?? '');
  return text.startsWith(`${TAG_ROWS_ROOT}.`) ? `system.${text.slice(TAG_ROWS_ROOT.length + 1)}` : text;
}

/** The source shown for a tag: `override` (a world override is active), `custom`, `registry`, or `none` (no behaviour). */
function providerOf(tagId, behaviour) {
  if (behaviour?.provider === 'override') return 'override';
  if (isWorldCustomTag(tagId)) return 'custom';
  return behaviour ? 'registry' : 'none';
}

/** One entry per row for a player: its label and what it reads. */
function readOnlyBlocks(rows) {
  const blocks = [];
  for (const arrayKey of TAG_ROW_ARRAYS) {
    if (!rows[arrayKey].length) continue;
    const ui = ARRAY_UI[arrayKey];
    blocks.push({
      arrayKey,
      icon: ui.icon,
      titleKey: `COG.Rows.Array.${ui.key}.Title`,
      rows: rows[arrayKey].map((row) => ({ label: row.label || '', disabled: row.disabled === true, reads: describeRow(arrayKey, row).join('; ') }))
    });
  }
  return blocks;
}

/**
 * Everything the Tag Manager's detail part shows for one tag, or null for an unknown id.
 * A GM gets the row editor (`rowEditors`: blocks, addBar, tagOptions; names `rows.<array>.<i>.<field>`); a player
 * gets `readOnly` blocks and no controls.
 * @param {string} tagId
 * @param {{ isGM?: boolean }} [options]
 */
export function buildTagEditorContext(tagId, { isGM: gm = isGM() } = {}) {
  const def = getTagDefinition(tagId);
  if (!def) return null;
  const behaviour = getTagBehaviour(tagId);
  const { rows, flags } = editableBehaviour(tagId);
  const hasOverride = isPlain(getTagOverrides()[tagId]);
  const custom = isWorldCustomTag(tagId);

  const view = {
    id: tagId,
    label: def.label || tagId,
    provider: providerOf(tagId, behaviour),
    providerKey: `COG.TagManager.Provider.${providerOf(tagId, behaviour)}`,
    isRule: Boolean(behaviour),
    isCustom: custom,
    hasOverride,
    overrideOnCustom: custom && hasOverride,
    editable: gm,
    canReset: gm && hasOverride,
    errors: tagBehaviourErrors({ id: tagId, rows: rowsWithContent(rows), flags }, { scaleErrors: scaleSpecErrors }),
    flags: [...new Set([...Object.keys(RULE_FLAG_DEFS), ...flags])].map((id) => ({
      id,
      label: RULE_FLAG_DEFS[id]?.label ?? id,
      hint: RULE_FLAG_DEFS[id]?.hint ?? '',
      checked: flags.includes(id),
      undeclared: !RULE_FLAG_DEFS[id]
    })),
    readOnly: gm ? [] : readOnlyBlocks(rows),
    rowEditors: null
  };
  if (gm) {
    const host = new TagRowsHost(tagId, rows);
    const context = { system: host.system };
    buildRowEditorContext(context, host);
    const editors = renameRowPaths(context.rowEditors ?? { blocks: [], addBar: [] }, TAG_ROW_ARRAYS, TAG_ROWS_ROOT);
    view.rowEditors = { blocks: editors.blocks, addBar: editors.addBar, tagOptions: tagPickerOptions() };
  }
  return view;
}

const rowsWithContent = (rows) => withoutEmpty(rows);

// -- Action delegates --------------------------------------------------------------------------------------------

/**
 * Tag Manager actions that run the item sheet's own handlers (same names, same `data-*`) against the selected tag's
 * {@link TagRowsHost}. `this` is the Tag Manager (`selectedTagId`, `render`). The handlers are looked up when called,
 * so the import cycle through `actions-tags.mjs` never matters.
 */
const delegate = (table, name) => async function tagRowsAction(event, target) {
  const tagId = this.selectedTagId;
  if (!tagId || !isGM()) return;
  const sheetLike = { isEditable: true, item: hostForTag(tagId) };
  await table()[name].call(sheetLike, event, retargetRow(target, toItemPath));
  await this.render({ parts: ['list', 'rules'] });
};

export const TAG_ROW_DELEGATES = Object.freeze({
  addRow: delegate(() => ROW_ACTIONS, 'addRow'),
  deleteRow: delegate(() => ROW_ACTIONS, 'deleteRow'),
  moveRow: delegate(() => ROW_ACTIONS, 'moveRow'),
  duplicateRow: delegate(() => ROW_ACTIONS, 'duplicateRow'),
  clearRowField: delegate(() => ROW_ACTIONS, 'clearRowField'),
  addQueryTag: delegate(() => TAG_ACTIONS, 'addQueryTag'),
  removeQueryTag: delegate(() => TAG_ACTIONS, 'removeQueryTag'),
  createSituationTag: delegate(() => TAG_ACTIONS, 'createSituationTag')
});
