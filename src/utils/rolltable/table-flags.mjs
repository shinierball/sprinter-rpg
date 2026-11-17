/**
 * The flags a RollTable and its results carry so code finds them without reading names: `tableKey` on the table (the
 * key a floor, loot or background table is discovered by) and `option` on a result (the structured choice that row
 * stands for). This module owns those two words.
 */
import { flagPath, readFlag, withFlags } from '../flags.mjs';

const TABLE_KEY = 'tableKey';
const OPTION = 'option';

/** The pack-index field and query path of a table's key. */
export const TABLE_KEY_FIELD = flagPath(TABLE_KEY);

/** The key a table is discovered by, as stored (undefined when it has none; callers trim and type-check). */
export const tableKeyOf = (table) => readFlag(table, TABLE_KEY);

/** A flags patch (for `withFlags`, or merged with other flags) holding the table key. */
export const tableKeyPatch = (key) => ({ [TABLE_KEY]: key });

/** `data` with its table key set (a copy; see `withFlags`). */
export const withTableKey = (data, key) => withFlags(data, tableKeyPatch(key));

/** The structured option a table result stands for, as stored (undefined when it has none). */
export const optionOf = (result) => readFlag(result, OPTION);

/** `data` (a table result) with its option set (a copy; see `withFlags`). */
export const withOption = (data, option) => withFlags(data, { [OPTION]: option });
