/** A key through Foundry's i18n, or the key itself when i18n is not up yet. */
export function localizeKey(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

/** The text of the Item from words windows: `COG.ItemFromWords.<key>`, with `{name}` data when given. */
export function itemFromWordsText(key, data) {
  const i18n = globalThis.game?.i18n;
  const full = `COG.ItemFromWords.${key}`;
  if (!i18n) return full;
  return data && typeof i18n.format === 'function' ? i18n.format(full, data) : localizeKey(full);
}
