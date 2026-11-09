import { SYSTEM_ID } from '../../constants.mjs';
import { contentRegistry } from '../../content/registry.mjs';
import { BUNDLED_SET_ID, withSourceStamp } from '../../utils/content-source.mjs';

/** Background table lookup, rolling and RollTable creation (code). The table rows are content: registered by a provider (samples, a theme, the Sourcery import), none bundled. */

/** The three story traits a crawler rolls on background tables, in display order. */
export const STORY_TRAITS = Object.freeze(['pastTrauma', 'looseEnds', 'regrets']);

/**
 * The registered table behind one story trait, as the creator and the crawler sheet show it: the table's own name
 * and die (samples, a theme or the Sourcery import), and its options. Empty strings and no options when nothing is registered.
 * @param {string} key - one of STORY_TRAITS
 * @param {Record<string, object>} [tables] - defaults to the active theme's registered tables
 * @returns {{ key: string, hasTable: boolean, tableName: string, formula: string, results: object[] }}
 */
export function storyTableView(key, tables = contentRegistry.getBackgroundTables()) {
  const def = tables?.[key];
  const results = Array.isArray(def?.results) ? def.results : [];
  return {
    key,
    hasTable: results.length > 0,
    tableName: def?.name ?? def?.title ?? '',
    formula: def?.formula ?? '',
    results
  };
}

/**
 * Resolve a registered background table definition by exact key, table number, or exact name/title.
 * Reads only the content registry; returns null when nothing matches or nothing is registered.
 * @param {string|number} keyOrName
 * @returns {object|null}
 */
export function getBackgroundTable(keyOrName) {
  if (keyOrName === null || keyOrName === undefined || keyOrName === '') return null;
  const str = String(keyOrName).toLowerCase().trim();
  const tables = contentRegistry.getBackgroundTables();
  for (const table of Object.values(tables)) {
    if (table.key?.toLowerCase() === str) return table;
    if (String(table.tableNumber) === str) return table;
    if (table.name?.toLowerCase() === str || table.title?.toLowerCase() === str) return table;
  }
  return null;
}

/**
 * Roll or choose a result from a background table.
 * @param {string|number} tableKey - 'pastTrauma' | 'looseEnds' | 'regrets' or table number (11, 12, 13)
 * @param {object} [options={}] - Roll options
 * @param {number} [options.roll] - Explicit roll result (1-12) to select without dice roll
 * @returns {Promise<{tableKey: string, tableName: string, tableNumber: number, roll: number, text: string}>}
 */
export async function rollBackgroundTable(tableKey, { roll: explicitRoll = null } = {}) {
  const tables = contentRegistry.getBackgroundTables();
  const tableCount = tables?.size ?? Object.keys(tables || {}).length;
  if (tableCount === 0) {
    return { text: '', table: tableKey, empty: true };
  }

  const tableDef = getBackgroundTable(tableKey);
  if (!tableDef) {
    throw new Error(`Sprinter RPG | Unknown background table: ${tableKey}`);
  }

  // A table with no rows has nothing to roll (the 1d12 fallback below assumes the book's table).
  if (!tableDef.results?.length) return { text: '', table: tableKey, empty: true };

  if (explicitRoll != null) {
    const match = tableDef.results?.find(r => r.roll === explicitRoll) || tableDef.results?.[0];
    return {
      tableKey: tableDef.key,
      tableName: tableDef.title ?? tableDef.name,
      tableNumber: tableDef.tableNumber,
      roll: explicitRoll,
      text: match ? match.text : ''
    };
  }

  const regRoll = await contentRegistry?.rollBackgroundTable?.(tableDef.key || tableKey);
  if (regRoll) {
    return {
      tableKey: tableDef.key,
      tableName: tableDef.title ?? tableDef.name,
      tableNumber: tableDef.tableNumber,
      roll: regRoll.roll,
      text: regRoll.text
    };
  }

  let rollNumber = explicitRoll;
  if (!rollNumber || rollNumber < 1 || rollNumber > 12) {
    const RollClass = CONFIG.Dice?.rolls?.[0]
      ?? globalThis.foundry?.dice?.Roll
      ?? globalThis.Roll;
    if (typeof RollClass !== 'undefined' && typeof RollClass === 'function') {
      const r = new RollClass('1d12');
      await r.evaluate();
      rollNumber = Math.min(12, Math.max(1, Math.floor(Number(r.total) || (Math.random() * 12 + 1))));
    } else {
      rollNumber = Math.floor(Math.random() * 12) + 1;
    }
  }

  const match = tableDef.results?.find(item => item.roll === rollNumber) || tableDef.results?.[0];

  return {
    tableKey: tableDef.key,
    tableName: tableDef.title ?? tableDef.name,
    tableNumber: tableDef.tableNumber,
    roll: rollNumber,
    text: match ? match.text : ''
  };
}

/**
 * Create a Foundry RollTable document data object for a background table.
 * @param {string} tableKey - 'pastTrauma' | 'looseEnds' | 'regrets'
 * @returns {object}
 */
export function createBackgroundRollTableData(tableKey) {
  const tableDef = getBackgroundTable(tableKey);
  if (!tableDef) {
    throw new Error(`Sprinter RPG | Unknown background table: ${tableKey}`);
  }

  // In Foundry VTT, CONST.TABLE_RESULT_TYPES.TEXT is 0.
  // Safely resolve to 0 without truthy check breaking on 0.
  const textResultType = (typeof CONST !== 'undefined' && CONST.TABLE_RESULT_TYPES && typeof CONST.TABLE_RESULT_TYPES.TEXT !== 'undefined')
    ? CONST.TABLE_RESULT_TYPES.TEXT
    : 0;

  return {
    name: tableDef.name,
    img: 'icons/svg/d20-grey.svg',
    description: `<p>${tableDef.description}</p>`,
    formula: tableDef.formula,
    replacement: true,
    displayRoll: true,
    results: tableDef.results.map(r => ({
      type: textResultType,
      text: r.text,
      img: 'icons/svg/d20-black.svg',
      weight: 1,
      range: [r.roll, r.roll],
      drawn: false,
      documentCollection: null,
      documentId: null
    })),
    flags: {
      [SYSTEM_ID]: {
        tableKey: tableDef.key,
        tableNumber: tableDef.tableNumber
      }
    }
  };
}

/**
 * Ensure the official background RollTables exist in the world's RollTable collection.
 * If any table is missing, creates it using RollTable.create.
 * @returns {Promise<Array<RollTable>>}
 */
export async function ensureBackgroundTables() {
  const tables = contentRegistry.getBackgroundTables();
  const tableCount = tables?.size ?? Object.keys(tables || {}).length;
  if (tableCount === 0) {
    return [];
  }

  const RollTableClass = CONFIG.RollTable?.documentClass
    ?? globalThis.foundry?.documents?.RollTable
    ?? globalThis.RollTable;

  if (!RollTableClass || !globalThis.game?.tables) {
    return [];
  }

  // Only GM users should attempt to create or populate world documents
  if (globalThis.game?.user && !globalThis.game.user.isGM) {
    return [];
  }

  const createdOrFound = [];
  const tableKeys = Object.keys(tables).length > 0 ? Object.keys(tables) : ['pastTrauma', 'looseEnds', 'regrets'];
  for (const tableKey of tableKeys) {
    const tableDef = tables[tableKey] || getBackgroundTable(tableKey);
    if (!tableDef) continue;
    const existing = game.tables.find(t => t.flags?.[SYSTEM_ID]?.tableKey === tableKey);

    if (existing) {
      // If table exists but has 0 results, populate them
      const resultCount = existing.results?.size ?? (Array.isArray(existing.results) ? existing.results.length : 0);
      if (resultCount === 0 && typeof existing.createEmbeddedDocuments === 'function') {
        try {
          const tableData = createBackgroundRollTableData(tableKey);
          await existing.createEmbeddedDocuments('TableResult', tableData.results);
        } catch (err) {
          console.warn(`Sprinter RPG | Could not populate results for RollTable ${tableDef.name}:`, err);
        }
      }
      createdOrFound.push(existing);
    } else if (typeof RollTableClass.create === 'function') {
      try {
        const tableData = createBackgroundRollTableData(tableKey);
        // The table carries the stamp of the theme its definition came from; a theme-free ('all') definition is system-made.
        const theme = contentRegistry.getBackgroundTableTheme(tableKey);
        const stamped = theme ? withSourceStamp(tableData, { theme, set: BUNDLED_SET_ID }) : tableData;
        const newTable = await RollTableClass.create(stamped, { renderSheet: false, cogSystemMade: !theme });
        if (newTable) createdOrFound.push(newTable);
      } catch (err) {
        console.warn(`Sprinter RPG | Could not create RollTable ${tableDef.name}:`, err);
      }
    }
  }

  return createdOrFound;
}
