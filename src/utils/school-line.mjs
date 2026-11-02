/**
 * The cast card's `school.*` line (3.58 D6b): the spell's descriptive school tags as one muted line. Nothing reads these
 * tags as a mechanic; the line is for the table. Labels come from the tag definition (a homebrew school registered with
 * `registerTag` shows its own label), never from splitting the id.
 */
import { getTagDefinition, SCHOOL_TAG_PREFIX } from '../data/tags.mjs';

const escapeHtml = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/**
 * The labels of an item's explicit `school.*` tags, in tag order.
 * @param {object} item a spell (anything with `system.tags`)
 * @returns {string[]}
 */
export function schoolLabels(item) {
  const tags = Array.isArray(item?.system?.tags) ? item.system.tags : [];
  const out = [];
  for (const raw of tags) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id.startsWith(SCHOOL_TAG_PREFIX)) continue;
    const label = String(getTagDefinition(id)?.label ?? id);
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * One muted card line listing the school labels, escaped; an empty string when the spell has none.
 * @param {object} item
 * @returns {string}
 */
export function schoolLineHtml(item) {
  const labels = schoolLabels(item);
  if (!labels.length) return '';
  const heading = globalThis.game?.i18n?.localize?.('COG.Tags.School');
  const word = heading && heading !== 'COG.Tags.School' ? heading : 'School';
  return `<div class="cog-text-muted cog-school-line" style="margin-bottom: 6px; font-size: 11px;">${escapeHtml(word)}: ${labels.map(escapeHtml).join(', ')}</div>`;
}
