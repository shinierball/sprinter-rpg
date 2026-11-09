/**
 * Precomputed `<select>` options that pick a catalog skill or spell by `system.identifier` (labels are names). A
 * stored identifier the catalog lacks (a homebrew world item) is kept as its own selected option.
 */
import { sourceBadge, offeredEntries } from '../content-source.mjs';

const entriesOf = (source) => (Array.isArray(source) ? source : offeredEntries(source === 'spell' ? 'spells' : 'skills'));

/** `{ value: identifier, label: name, sourceBadge }` triples, sorted by label, one per identifier. */
function catalogOptions(source) {
  const seen = new Set();
  return entriesOf(source)
    .filter(d => d?.system?.identifier && !seen.has(d.system.identifier) && seen.add(d.system.identifier))
    .map(d => ({ value: d.system.identifier, label: d.name, sourceBadge: d.sourceBadge ?? sourceBadge(d) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * @param {'skill'|'spell'|object[]} source a kind (the registry catalog) or the entries to offer (the item sheet's
 *   skill/spell lists, which include world items)
 * @param {string} selected the stored identifier ('' for none)
 * @param {{fallbackLabel?: string, blankLabel?: string|null}} [options] `blankLabel` adds a leading '' option
 * @returns {Array<{value: string, label: string, selected: boolean}>}
 */
export function identifierOptions(source, selected, { fallbackLabel = '', blankLabel = null } = {}) {
  const id = String(selected ?? '').trim();
  const options = catalogOptions(source).map(o => ({ ...o, selected: o.value === id }));
  if (id && !options.some(o => o.selected)) options.unshift({ value: id, label: fallbackLabel || id, selected: true });
  if (blankLabel !== null) options.unshift({ value: '', label: blankLabel, selected: !id });
  return options;
}

/** The source badge of the selected option (null when none is selected or it has no stamp), for the chip beside a picker. */
export function pickedBadge(options) {
  return (Array.isArray(options) ? options : []).find(o => o.selected && o.value)?.sourceBadge ?? null;
}

/** Display name of a skill or spell identifier: the entry's name, else `fallback`, else the identifier. */
export function identifierLabel(source, identifier, fallback = '') {
  const id = String(identifier ?? '').trim();
  if (!id) return fallback;
  return entriesOf(source).find(d => d?.system?.identifier === id)?.name || fallback || id;
}
