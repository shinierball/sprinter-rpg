/**
 * The flags a RollTable and its results carry so code finds them without reading names: `tableKey` on the table (the
 * key a floor, loot or background table is discovered by), `tableNumber` (its number in its book) and `option` on a result (the structured choice that row
 * stands for), `grindTable` on the table (`{ scope, floors }`, a grinding table), `role` on a result (a narrative row's words, not an option) and `rowFlags` (a row's own flags, which ride
 * on each of its results). This module owns those words.
 */
import { flagPath, readFlag, withFlags } from '../flags.mjs';

const TABLE_KEY = 'tableKey';
const OPTION = 'option';
const ROLE = 'role';
const TABLE_NUMBER = 'tableNumber';
const NARRATIVE = 'narrative';
const GRIND_TABLE = 'grindTable';

/** The pack-index field and query path of a table's key. */
export const TABLE_KEY_FIELD = flagPath(TABLE_KEY);

/** The key a table is discovered by, as stored (undefined when it has none; callers trim and type-check). */
export const tableKeyOf = (table) => readFlag(table, TABLE_KEY);

/** A flags patch (for `withFlags`, or merged with other flags) holding the table key. */
export const tableKeyPatch = (key) => ({ [TABLE_KEY]: key });

/** `data` with its table key set (a copy; see `withFlags`). */
export const withTableKey = (data, key) => withFlags(data, tableKeyPatch(key));

/** The table's number in its book, as stored (undefined when it has none; callers type-check). */
export const tableNumberOf = (table) => readFlag(table, TABLE_NUMBER);

/** `data` (a table) with its number set (a copy; see `withFlags`). */
export const withTableNumber = (data, number) => withFlags(data, { [TABLE_NUMBER]: number });

/** The structured option a table result stands for, as stored (undefined when it has none). */
export const optionOf = (result) => readFlag(result, OPTION);

/** `data` (a table result) with its option set (a copy; see `withFlags`). */
export const withOption = (data, option) => withFlags(data, { [OPTION]: option });

/** Whether a table result carries a narrative row's words rather than an option. */
export const isNarrativeResult = (result) => readFlag(result, ROLE) === NARRATIVE;

/** `data` (a table result) marked as a narrative row's words (a copy; see `withFlags`). */
export const withNarrativeRole = (data) => withFlags(data, { [ROLE]: NARRATIVE });

/** `data` (a table result) with the flags of the row it came from (a copy; see `withFlags`). */
export const withRowFlags = (data, rowFlags) => withFlags(data, { rowFlags });

/** The pack-index field and query path of a table's grinding scope. */
export const GRIND_TABLE_FIELD = flagPath(GRIND_TABLE);

/** The grinding scope of a table, `{ scope, floors }`, as stored (undefined when it has none; callers validate). */
export const grindTableOf = (table) => readFlag(table, GRIND_TABLE);

/** `data` (a table) with its grinding scope set (a copy; see `withFlags`). */
export const withGrindTable = (data, grind) => withFlags(data, { [GRIND_TABLE]: grind });
