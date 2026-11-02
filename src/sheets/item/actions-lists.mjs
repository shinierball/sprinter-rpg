/**
 * Pill-list editors for string-array fields (associated skills, optional effects, cleanse debuffs), the shared multi-pick
 * list (persistent buffs/debuffs, aura resistances/immunities) and the buff/debuff scope toggles. Entries compare
 * case-insensitively.
 * Every handler runs with `this` = the item sheet.
 */
import { recommendedWeaponSkillIdentifiers, recommendedOptionalEffects } from './weapon-recommendations.mjs';
import { getCompendiumSkills } from './catalogs.mjs';
import { schemaFieldAt, toStringList } from './util.mjs';
import { slugifyIdentifier } from '../../utils/identifier.mjs';
import { DEFAULT_DAMAGE_TYPES } from './options.mjs';

/** `system` path of each pill list, by the name used in its actions. */
export const LIST_FIELDS = Object.freeze({
  associatedSkills: 'associatedSkills',
  optionalEffects: 'optionalEffects',
  cleanseDebuffs: 'healing.cleanseDebuffs'
});

const readList = (item, path) => toStringList(path.split('.').reduce((cur, key) => cur?.[key], item.system));
const has = (list, value) => list.some((v) => v.toLowerCase() === value.toLowerCase());

/**
 * Append values not already present (case-insensitive) to a list field.
 * @returns {Promise<boolean>} true when the item changed
 */
export async function addToList(item, path, values) {
  const current = readList(item, path);
  let changed = false;
  for (const raw of values) {
    const value = String(raw ?? '').trim();
    if (value && !has(current, value)) { current.push(value); changed = true; }
  }
  if (changed) await item.update({ [`system.${path}`]: current });
  return changed;
}

/** Remove a value (case-insensitive) from a list field. */
export async function removeFromList(item, path, value) {
  const needle = String(value ?? '').trim().toLowerCase();
  await item.update({ [`system.${path}`]: readList(item, path).filter((v) => v.toLowerCase() !== needle) });
}

/** The damage types a typed damage-type entry is matched against (registry, else the defaults). */
const damageTypes = () => toStringList(globalThis.CONFIG?.COG?.damageTypes ?? DEFAULT_DAMAGE_TYPES);

/** A typed damage type in the registry's spelling ("fire" -> "Fire"); an unregistered type is kept as typed. */
const damageTypeValue = (raw) => {
  const value = String(raw ?? '').trim();
  return damageTypes().find((t) => t.toLowerCase() === value.toLowerCase()) ?? value;
};

/**
 * Fields the shared multi-pick list (`pick-list.hbs`) may edit, by the `data-list` key its controls carry.
 * `custom` turns a typed entry into the stored value: identifier lists store the slug, damage types the registered
 * spelling. A key outside this table, or a path the item's schema lacks, is ignored.
 */
export const PICK_LISTS = Object.freeze({
  persistentBuffs: Object.freeze({ path: 'persistentBuffs', custom: slugifyIdentifier }),
  persistentDebuffs: Object.freeze({ path: 'persistentDebuffs', custom: slugifyIdentifier }),
  onHitDebuffs: Object.freeze({ path: 'onHit.debuffs', custom: slugifyIdentifier }),
  evadeFailDebuffs: Object.freeze({ path: 'onHit.evadeFail.debuffs', custom: slugifyIdentifier }),
  slotLossDebuffs: Object.freeze({ path: 'onHit.slotLoss.debuffs', custom: slugifyIdentifier }),
  grantedResistances: Object.freeze({ path: 'area.grantedResistances', custom: damageTypeValue }),
  grantedImmunities: Object.freeze({ path: 'area.grantedImmunities', custom: damageTypeValue }),
  // A list inside a row of `system.grants` (a stat pool's stats, a choice row's options): the control sits in an element
  // carrying `data-grant-path` and `data-grant-index`, and the whole `grants` array is written back.
  grantOptions: Object.freeze({ array: 'grants', rowField: 'options', custom: slugifyIdentifier })
});

/** The `PICK_LISTS` entry a control names, or null when the key is unknown or the item has no such field. */
export function pickListFor(item, key) {
  const def = Object.hasOwn(PICK_LISTS, String(key ?? '')) ? PICK_LISTS[key] : null;
  if (!def) return null;
  const path = def.rowField ? `system.${def.array}.0.${def.rowField}` : `system.${def.path}`;
  return schemaFieldAt(item, path) ? def : null;
}

/** The index of the row a row-level pick control sits in (`[data-grant-index]`), or -1. */
function grantRowIndex(target) {
  const raw = target?.closest?.('[data-grant-path]')?.dataset?.grantIndex;
  const idx = Number(raw);
  return raw === undefined || raw === '' || !Number.isInteger(idx) ? -1 : idx;
}

/**
 * Edit the pick list inside one row of a row array (`def.array`): `edit(list)` returns the new list, or null for no
 * change. The whole array is written back, because a dotted update into an array is not safe on a real document.
 * @returns {Promise<boolean>} true when the item was updated
 */
async function editRowList(item, def, index, edit) {
  const rows = (Array.isArray(item.system?.[def.array]) ? item.system[def.array] : []).map((row) => foundry.utils.deepClone(row));
  if (index < 0 || index >= rows.length) return false;
  const next = edit(toStringList(rows[index][def.rowField]));
  if (!next) return false;
  rows[index][def.rowField] = next;
  await item.update({ [`system.${def.array}`]: rows });
  return true;
}

/** Actions of the shared multi-pick list. Each control names its field with `data-list`. */
export const PICK_LIST_ACTIONS = {
  /** Change action on the unnamed Add select; the chosen option's `data-list` names the field. */
  async addPick(event, target) {
    if (!this.isEditable) return;
    const option = target?.selectedOptions?.[0] ?? [...(target?.querySelectorAll?.('option') ?? [])].find((o) => o.selected);
    const def = pickListFor(this.item, option?.dataset?.list);
    const value = String(option?.value ?? '').trim();
    if (!def || !value) return;
    if (def.rowField) {
      await editRowList(this.item, def, grantRowIndex(target), (list) => (has(list, value) ? null : [...list, value]));
      return;
    }
    await addToList(this.item, def.path, [value]);
  },
  /** Button (`data-list`) next to the unnamed text input inside `[data-custom-entry]`. */
  async addCustomPick(event, target) {
    if (!this.isEditable) return;
    const def = pickListFor(this.item, target?.dataset?.list);
    const input = target?.closest?.('[data-custom-entry]')?.querySelector('input');
    if (!def || !input) return;
    const value = def.custom(input.value);
    if (!value) return;
    if (def.rowField) {
      if (await editRowList(this.item, def, grantRowIndex(target), (list) => (has(list, value) ? null : [...list, value]))) input.value = '';
      return;
    }
    if (await addToList(this.item, def.path, [value])) input.value = '';
  },
  /** The chip's remove link (`data-list`, `data-value`). */
  async removePick(event, target) {
    if (!this.isEditable) return;
    const def = pickListFor(this.item, target?.dataset?.list);
    if (!def) return;
    if (def.rowField) {
      const needle = String(target.dataset.value ?? '').trim().toLowerCase();
      await editRowList(this.item, def, grantRowIndex(target), (list) => list.filter((v) => v.toLowerCase() !== needle));
      return;
    }
    await removeFromList(this.item, def.path, target.dataset.value);
  }
};

/** The three actions of one pill editor: pick from a select, type a custom entry, remove a pill. */
function listActions(name, path, removeKey) {
  const cap = name[0].toUpperCase() + name.slice(1);
  return {
    /** Change action on the unnamed picker select. */
    async [`add${cap}`](event, target) {
      if (!this.isEditable) return;
      await addToList(this.item, path, [target.value]);
    },
    /** Button next to an unnamed text input inside `[data-custom-entry]`. */
    async [`addCustom${cap}`](event, target) {
      if (!this.isEditable) return;
      const input = target.closest('[data-custom-entry]')?.querySelector('input');
      if (!input) return;
      const value = input.value;
      if (await addToList(this.item, path, [value])) input.value = '';
    },
    async [`remove${cap}`](event, target) {
      if (!this.isEditable) return;
      await removeFromList(this.item, path, target.dataset[removeKey]);
    }
  };
}

export const LIST_ACTIONS = {
  ...PICK_LIST_ACTIONS,
  ...listActions('associatedSkill', LIST_FIELDS.associatedSkills, 'skill'),
  ...listActions('optionalEffect', LIST_FIELDS.optionalEffects, 'effect'),
  ...listActions('cleanseDebuff', LIST_FIELDS.cleanseDebuffs, 'debuff'),

  async applyRecommendedSkills() {
    if (!this.isEditable) return;
    // Recommend by tag intersection and store skill identifiers (attacks match skills by identifier).
    const catalog = await getCompendiumSkills();
    const recommended = recommendedWeaponSkillIdentifiers(this.item, catalog);
    if (!recommended.length) {
      globalThis.ui?.notifications?.info('No standard recommended skills found for this weapon type.');
      return;
    }
    await addToList(this.item, LIST_FIELDS.associatedSkills, recommended);
  },

  async applyRecommendedEffects() {
    if (!this.isEditable) return;
    const recommended = recommendedOptionalEffects(this.item, await getCompendiumSkills());
    if (!recommended.length) {
      globalThis.ui?.notifications?.info('No standard recommended techniques found for this weapon type.');
      return;
    }
    await addToList(this.item, LIST_FIELDS.optionalEffects, recommended);
  }
};
