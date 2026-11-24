/**
 * A module's text lookup: the localised string for a full lang key (through `game.i18n.format`, so `{name}` data fills
 * in) when the catalogue has it, else the module's own English table, else the key itself. A `{name}` in a fallback
 * string with no value in `data` prints as nothing. The table serves a Node run with no catalogue.
 * @param {Record<string, string>} table English fallback strings by full lang key
 * @returns {(key: string, data?: Record<string, unknown>) => string}
 */
export function langText(table) {
  return (key, data = {}) => {
    const i18n = globalThis.game?.i18n;
    if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
    return String(table[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
  };
}

/**
 * A lang key through `game.i18n` with no English table: formatted with `data` when given, else localised; the key itself
 * when there is no catalogue (a Node run) or no answer. For a module with no fallback strings of its own.
 * @param {string} key full lang key
 * @param {Record<string, unknown>} [data] `{name}` values
 * @returns {string}
 */
export const localiseKey = (key, data) => (data ? globalThis.game?.i18n?.format?.(key, data) : globalThis.game?.i18n?.localize?.(key)) ?? key;
