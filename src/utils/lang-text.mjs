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
