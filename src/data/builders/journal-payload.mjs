/**
 * src/data/builders/journal-payload.mjs
 * `buildJournalPayload(spec)`: the JournalEntry creation payload builder. Reached as `buildPayload('journal', spec)`.
 * Pure: no Foundry globals needed. The sibling of `buildRollTablePayload`.
 *
 * Spec:
 *   { _id?, name, key? (flags.sprinter-rpg.journalKey), folder?, flags?,
 *     pages: [{ _id?, name, html, level? (1-6), flags? }] }
 * `html` is trusted markup: the caller builds it from escaped text (Sourcery builds every page itself). Written in the
 * v14 JournalEntryPage shape: `type: 'text'`, `title`, `text: { format: 1, content }`, `sort`.
 */
import { SYSTEM_ID } from '../../constants.mjs';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Foundry's sort density: the gap between pages (and any sorted documents), so one can be dropped between two. */
export const PAGE_SORT_STEP = 100000;

/** Text value: first array entry, trimmed. */
function text(raw) {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  return typeof val === 'string' ? val.trim() : (typeof val === 'number' ? String(val) : '');
}

/**
 * Build a JournalEntry creation payload from a spec.
 * @param {object} [spec]
 * @param {{ warnings?: Array<{path: string, message: string, code: string}> }} [options] `warnings` collects `{ path, message, code: 'spec' }`, else they go to `console.warn`.
 * @returns {object} `{ _id?, name, pages, flags, folder? }`
 */
export function buildJournalPayload(spec = {}, options = {}) {
  const warnings = Array.isArray(options?.warnings) ? options.warnings : null;
  const warn = (path, message, code = 'spec') => {
    if (warnings) warnings.push({ path, message, code });
    else console.warn(`Sprinter RPG | ${path}: ${message}`);
  };
  const input = isPlainObject(spec) ? spec : {};
  const key = text(input.key ?? input.journalKey ?? input.flags?.[SYSTEM_ID]?.journalKey);
  if (!key) warn('key', 'journal has no key; it cannot be discovered by journalKey');
  const name = text(input.name) || key || 'New Journal';
  if (input.pages !== undefined && !Array.isArray(input.pages)) warn('pages', 'pages must be an array; treated as empty');
  const rawPages = Array.isArray(input.pages) ? input.pages : [];
  const pages = [];
  rawPages.forEach((page, i) => {
    const path = `pages[${i}]`;
    if (!isPlainObject(page)) { warn(path, 'page is not an object; skipped'); return; }
    const level = Number.isInteger(Number(page.level)) && Number(page.level) >= 1 && Number(page.level) <= 6 ? Number(page.level) : 1;
    const out = {
      name: text(page.name) || `Page ${i + 1}`,
      type: 'text',
      title: { show: true, level },
      text: { format: 1, content: typeof page.html === 'string' ? page.html : '' },
      sort: (i + 1) * PAGE_SORT_STEP,
      flags: isPlainObject(page.flags) ? structuredClone(page.flags) : {}
    };
    if (text(page._id)) out._id = text(page._id);
    if (!out.text.content) warn(path, 'page has no html');
    pages.push(out);
  });
  const payload = { name, pages, flags: isPlainObject(input.flags) ? structuredClone(input.flags) : {} };
  const flagBlock = isPlainObject(payload.flags[SYSTEM_ID]) ? payload.flags[SYSTEM_ID] : {};
  payload.flags[SYSTEM_ID] = { ...flagBlock, ...(key ? { journalKey: key } : {}) };
  if (text(input._id)) payload._id = text(input._id);
  if (text(input.folder)) payload.folder = text(input.folder);
  return payload;
}
