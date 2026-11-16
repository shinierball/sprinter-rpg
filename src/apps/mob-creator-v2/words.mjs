/** The creator's words: one lang key (`COG.MobCreator.*`) with its `{name}` data filled in; the key itself when no catalogue is loaded. */
export const tr = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
