/**
 * The Race and Class Creators' inline-row edits, the perk rows hosts and the catalog picks for rows. Every function
 * takes the creator app first and reaches the rest through it (`app.render`, `app.pickEffect`, ...), so a subclass
 * override or a test stub on the instance still steers it.
 */

import { BP_PER_RANK } from '../../data/rules/point-buy-budget.mjs';
import { COG_BENEFIT_TIERS, COG_DETRIMENT_TIERS } from '../../data/rules/point-build-tiers.mjs';
import { getAvailableBuffs, getAvailableDebuffs, getAvailableSpells, getCompendiumSkills } from '../../sheets/item/catalogs.mjs';
import { EDITABLE_KEYS, PerkRowsHost, SpecGrantRowsHost, specRowFromGrant } from '../perk-rows-host.mjs';
import { applyHostForm } from '../../sheets/item/row-host.mjs';
import { POINT_BUY_FORM, POINT_BUY_FIELD_PARSERS, POINT_BUY_ROW_FIELDS, LEDGER_FIELDS } from './form.mjs';

/** Remove row `index` of the row list `key` (a key of `POINT_BUY_FORM.rows`); out-of-range is ignored. */
export function removeRow(app, key, index) {
  const list = Object.hasOwn(POINT_BUY_FORM.rows, key) ? POINT_BUY_FORM.state(app)[key] : null;
  if (Array.isArray(list) && index >= 0 && index < list.length) list.splice(index, 1);
}

/**
 * Write one field of an inline row. Numbers and checkboxes are coerced, never blocked; a tier or rank
 * moves the row's cost with it; `identifier` is a catalog pick.
 * @param {object} app the creator app
 * @param {string} key a key of `POINT_BUY_FORM.rows`
 * @param {number} index
 * @param {string} fieldName
 * @param {*} raw the control's value (a boolean for a checkbox)
 * @returns {Promise<'build'|'text'|null>} what to re-render: `build` (builder and receipt), `text` (the receipt's
 *   labels only), or null when nothing was written
 */
export async function setRowField(app, key, index, fieldName, raw) {
  const row = Object.hasOwn(POINT_BUY_FORM.rows, key) ? POINT_BUY_FORM.state(app)[key]?.[index] : null;
  if (!row || !POINT_BUY_ROW_FIELDS.includes(fieldName)) return null;
  if (fieldName === 'identifier') {
    if (!await app._pickRowIdentifier(key, index, raw)) return null;
    return 'build';
  }
  const parse = Object.hasOwn(POINT_BUY_FIELD_PARSERS, fieldName) ? POINT_BUY_FIELD_PARSERS[fieldName] : null;
  const wasNamed = Boolean(String(row.name ?? '').trim());
  row[fieldName] = parse ? parse(raw) : String(raw ?? '');
  if (fieldName === 'rank') row.cost = row.rank * BP_PER_RANK;
  if (fieldName === 'isPassive' && key === 'skills') row.type = row.isPassive ? 'passive' : 'active';
  if (fieldName === 'tier') {
    if (key === 'buffs') row.cost = COG_BENEFIT_TIERS[row.tier]?.cost ?? row.cost;
    if (key === 'debuffs') row.extraPoints = COG_DETRIMENT_TIERS[row.tier]?.extraPoints ?? row.extraPoints;
  }
  // Naming a nameless row (or blanking a name) flips its "not filled in" chip, which lives in the builder part.
  const namedNow = Boolean(String(row.name ?? '').trim());
  return LEDGER_FIELDS.has(fieldName) || wasNamed !== namedNow ? 'build' : 'text';
}

/**
 * The rows host of custom perk `index` of `list` (a `POINT_BUY_FORM.perkRows.lists` key), or null for an unknown list or
 * index. Its writes land in the perk's `rows` in the spec; an empty list removes the key.
 */
export function perkRowsHost(app, list, index) {
  if (POINT_BUY_FORM.perkRows.grantLists.includes(list)) return app.specGrantRowsHost(list);
  const perk = POINT_BUY_FORM.perkRows.lists.includes(list) ? app.spec[list]?.[index] : null;
  if (!perk) return null;
  return new PerkRowsHost(app.spec.builderType, perk.rows, {
    save: (rows) => {
      if (rows.length) perk.rows = rows; else delete perk.rows;
    }
  });
}

/**
 * The rows host of the stat pool or rank bonus list `list` (a `POINT_BUY_FORM.perkRows.grantLists` key). Its writes
 * replace the spec rows in place, each row keeping its ledger-only `cost`.
 */
export function specGrantRowsHost(app, list) {
  return new SpecGrantRowsHost(list, app.spec[list], {
    save: (grants) => {
      const old = [...app.spec[list]];
      app.spec[list].splice(0, app.spec[list].length, ...grants.map((grant, i) => specRowFromGrant(list, grant, old[i])));
    }
  });
}

export async function savePerkRowsForm(app, form) {
  const { prefix } = POINT_BUY_FORM.perkRows;
  const list = form.dataset.perkList;
  const index = Number(form.dataset.perkIndex);
  const host = app.perkRowsHost(list, index);
  if (!host) return;
  const data = new foundry.applications.ux.FormDataExtended(form).object;
  const listData = foundry.utils.expandObject(data)[prefix]?.[list];
  const submitted = (POINT_BUY_FORM.perkRows.grantLists.includes(list) ? listData : listData?.[index]) ?? {};
  await applyHostForm(host, submitted, EDITABLE_KEYS);
  await app.render({ parts: ['builder', 'receipt'] });
}

/** The catalog entries a row kind picks its `identifier` from, as the item sheet's pickers list them. */
export async function rowCatalog(app, key) {
  if (key === 'skills') return getCompendiumSkills();
  if (key === 'spells') return getAvailableSpells();
  if (key === 'buffs') return getAvailableBuffs();
  if (key === 'debuffs') return getAvailableDebuffs();
  return [];
}

/** A skill, spell, buff or debuff row picked an `identifier` from the catalog (blank clears it). */
export async function pickRowIdentifier(app, key, index, identifier) {
  if (POINT_BUY_FORM.rows[key].copied) return app.pickEffect(key, index, identifier);
  const row = POINT_BUY_FORM.state(app)[key]?.[index];
  const id = String(identifier ?? '').trim();
  if (!row) return false;
  if (!id) {
    delete row.identifier;
    return true;
  }
  const def = (await app._rowCatalog(key)).find(d => d.system?.identifier === id);
  row.identifier = id;
  if (def?.name) row.name = def.name;
  return true;
}

/**
 * A buff or debuff row picked a catalog entry: the row takes a frozen copy of the whole payload
 * (`POINT_BUY_FORM.rows[list].copied.keys`, plus the identifier), so the race or class carries it. A blank identifier
 * clears the pick and leaves a text-only row that keeps its name.
 * @param {object} app the creator app
 * @param {'buffs'|'debuffs'} list
 * @param {number} index
 * @param {string} identifier
 * @returns {Promise<boolean>} whether the row changed
 */
export async function pickEffect(app, list, index, identifier) {
  const form = Object.hasOwn(POINT_BUY_FORM.rows, list) ? POINT_BUY_FORM.rows[list] : null;
  const row = form?.copied ? POINT_BUY_FORM.state(app)[list]?.[index] : null;
  if (!row) return false;
  const id = String(identifier ?? '').trim();
  if (!id) {
    delete row.identifier;
    for (const k of form.copied.keys) if (k !== 'name') delete row[k];
    return true;
  }
  const def = (await app._rowCatalog(list)).find(d => d.system?.[form.copied.by] === id);
  if (!def) return false;
  row.identifier = id;
  const source = { name: def.name, img: def.img, system: def.system?.toObject?.() ?? structuredClone(def.system ?? {}) };
  for (const k of form.copied.keys) if (source[k] !== undefined) row[k] = source[k];
  return true;
}

/** Set (or, when blank, clear) the custom wording of a picked catalog benefit or detriment. */
export function setCatalogText(app, list, entryId, text) {
  if (!Object.hasOwn(POINT_BUY_FORM.catalogs, list)) return false;
  const picked = POINT_BUY_FORM.state(app)[list].find(e => e.id === entryId);
  if (!picked) return false;
  const clean = String(text ?? '').trim();
  if (clean) picked.customText = clean;
  else delete picked.customText;
  return true;
}

/** The custom wording of a picked catalog entry ('' when none), for the contexts. */
export function customTextFor(app, list, entryId) {
  return POINT_BUY_FORM.state(app)[list]?.find(e => e.id === entryId)?.customText ?? '';
}
