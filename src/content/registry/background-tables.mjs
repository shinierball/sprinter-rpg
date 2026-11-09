/**
 * src/content/registry/background-tables.mjs
 * Background rollable tables of the crawler creator (past trauma, loose ends, …): setting data read from one theme.
 *
 * Every function takes the registry instance first and reads its `_backgroundTables` field.
 */

import { authorshipOption } from './authorship.mjs';
import { readSettingData } from './themes.mjs';

/** Fresh background-table state. */
export function initBackgroundTables(reg) {
  /** @type {Map<string, object>} storeKey -> tableEntry */
  reg._backgroundTables = new Map();
}

/**
 * Register a background rollable table definition.
 * @param {object} reg
 * @param {string} key - e.g. 'pastTrauma', 'looseEnds', 'regrets'
 * @param {object} tableDef - { key, name, formula, results: [{ roll: number, text: string }] }
 * @param {object} [options={}] - { provider: string, priority: number, theme: string, origin: string }
 *   `origin` names what the table was read from (a pack id), so `removeBackgroundTables` can drop it again.
 */
export function registerBackgroundTable(reg, key, tableDef, options = {}) {
  if (!key || !tableDef) return;
  const theme = options.theme ?? 'all';
  const priority = Number.isFinite(options.priority) ? options.priority : 10;
  const provider = options.provider || 'core';
  const origin = typeof options.origin === 'string' ? options.origin : null;
  const storeKey = `${theme}:${key}`;

  const existing = reg._backgroundTables.get(storeKey);
  if (existing && existing.priority > priority) return;
  // The table this one replaces stays underneath, so `removeBackgroundTables` can bring it back (as `registerCatalog`).
  const under = existing ? (existing.provider === provider && existing.origin === origin ? existing.under : existing) : undefined;

  reg._backgroundTables.set(storeKey, {
    key,
    data: { ...tableDef, key },
    theme,
    priority,
    provider,
    origin,
    under,
    authorship: authorshipOption(options)
  });
}

/**
 * Drop the background tables a predicate names; a table that replaced another one gives the replaced table back.
 * @param {object} reg
 * @param {(entry: { key: string, provider: string, origin: string|null, priority: number }) => boolean} predicate
 * @returns {number} how many tables were dropped
 */
export function removeBackgroundTables(reg, predicate) {
  let n = 0;
  for (const [storeKey, entry] of [...reg._backgroundTables]) {
    if (!predicate(entry)) continue;
    n++;
    if (entry.under) reg._backgroundTables.set(storeKey, entry.under); else reg._backgroundTables.delete(storeKey);
  }
  return n;
}

/**
 * Register multiple background tables.
 * @param {object} reg
 * @param {Record<string, object>|Map<string, object>} tablesMap
 * @param {object} [options={}]
 */
export function registerBackgroundTables(reg, tablesMap, options = {}) {
  if (!tablesMap) return;
  const entries = tablesMap instanceof Map ? tablesMap.entries() : Object.entries(tablesMap);
  for (const [key, tableDef] of entries) {
    registerBackgroundTable(reg, key, tableDef, options);
  }
}

/**
 * Get all registered background tables for the active theme.
 * @returns {Record<string, object>} Keyed map of tables (empty object if none)
 */
export function getBackgroundTables(reg) {
  const result = {};
  for (const entry of readSettingData(reg, reg._backgroundTables.values(), 'key').entries) {
    result[entry.key] = entry.data;
  }
  Object.defineProperty(result, 'size', {
    get() {
      return Object.keys(this).length;
    },
    enumerable: false,
    configurable: true
  });
  return result;
}

/**
 * Get a registered background table definition for the active theme.
 * @param {object} reg
 * @param {string} key
 * @returns {object|null}
 */
export function getBackgroundTable(reg, key) {
  if (!key) return null;
  const tables = getBackgroundTables(reg);
  return tables[key] || null;
}

/**
 * The theme a background table definition is read from now: the theme whose table wins for the key, or null when it
 * is an `'all'` table or unknown. World tables made from the definition are stamped with it.
 * @param {object} reg
 * @param {string} key
 * @returns {string|null}
 */
export function getBackgroundTableTheme(reg, key) {
  if (!key) return null;
  const list = [...reg._backgroundTables.values()].filter(e => e.key === key);
  const { theme } = readSettingData(reg, reg._backgroundTables.values(), 'key');
  const entry = list.find(e => e.theme === theme) ?? list.find(e => e.theme === 'all');
  return entry && entry.theme !== 'all' ? entry.theme : null;
}

/**
 * Roll on a registered background table.
 * @param {object} reg
 * @param {string} key
 * @returns {Promise<{ roll: number, text: string }|null>}
 */
export async function rollBackgroundTable(reg, key) {
  const table = getBackgroundTable(reg, key);
  if (!table || !Array.isArray(table.results) || table.results.length === 0) {
    return null;
  }

  let rollTotal;
  const formula = table.formula || `1d${table.results.length}`;
  if (globalThis.Roll) {
    try {
      const roll = new globalThis.Roll(formula);
      const evalRes = await roll.evaluate();
      rollTotal = Number.isFinite(roll.total) ? roll.total : (Number.isFinite(evalRes?.total) ? evalRes.total : undefined);
      if (!Number.isFinite(rollTotal)) {
        rollTotal = Math.floor(Math.random() * table.results.length) + 1;
      }
    } catch (_e) {
      rollTotal = Math.floor(Math.random() * table.results.length) + 1;
    }
  } else {
    rollTotal = Math.floor(Math.random() * table.results.length) + 1;
  }

  let matched = table.results.find(r => {
    if (r && typeof r === 'object') {
      if (Number.isFinite(r.roll)) return r.roll === rollTotal;
      if (Array.isArray(r.range)) return rollTotal >= r.range[0] && rollTotal <= r.range[1];
    }
    return false;
  });

  if (!matched) {
    const idx = Math.min(Math.max(rollTotal - 1, 0), table.results.length - 1);
    matched = table.results[idx];
  }

  const text = typeof matched === 'string' ? matched : (matched?.text ?? matched?.description ?? '');
  return { roll: rollTotal, text };
}
