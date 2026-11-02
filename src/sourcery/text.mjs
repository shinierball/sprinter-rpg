/**
 * src/sourcery/text.mjs
 * Output text helpers for the hydrator: escaping, title-casing and the casing mask.
 * Pure.
 */

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const isLetter = ch => /\p{L}/u.test(ch);
const isUpper = ch => ch === ch.toUpperCase() && ch !== ch.toLowerCase();

/** Strip control characters (keeps tab and newline). Extracted strings are untrusted. */
export function stripControls(text) {
  return Array.from(String(text ?? '')).filter((ch) => {
    const c = ch.codePointAt(0);
    return c === 9 || c === 10 || (c >= 32 && c !== 127);
  }).join('');
}

/**
 * Neutralise Foundry's text-enricher syntax in an extracted string: `@UUID[`, `@Compendium[` (any `@Word[`)
 * and `[[` (inline rolls, `[[/r 1d6]]`) become entity forms the enricher does not match and a browser shows as the same
 * characters. One shared helper: the hydrator and the table builders reach it through `escapeHtml` / `plainText`.
 * The system's own `@UUID[...]{label}` links are built after this and are never passed through it.
 */
export function neutraliseEnrichers(text) {
  return String(text ?? '').replace(/@(?=[A-Za-z]+\[)/g, '&#64;').replace(/\[(?=\[)/g, '&#91;');
}

/** Full HTML escape of an extracted string (enricher syntax neutralised). */
export function escapeHtml(text) {
  return neutraliseEnrichers(stripControls(text).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]));
}

/**
 * Plain-text field value: control characters removed, and `<` / `>` neutralised so the value can never open a tag
 * if a sheet renders the field as HTML. `&` and quotes stay, so a text input shows what the book says.
 */
export function plainText(text) {
  return neutraliseEnrichers(stripControls(text).replace(/</g, '&lt;').replace(/>/g, '&gt;'));
}

/** HTML field value: each blank-line-separated paragraph becomes an escaped `<p>`. The system builds all markup. */
export function paragraphsHtml(text) {
  return stripControls(text).split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p>${escapeHtml(p)}</p>`).join('');
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/**
 * Title-case a heading that is set in capitals. Text that is not all capitals is returned as is.
 * Words split at spaces and hyphens; small words stay lower-case except the first and last word; apostrophes do not
 * start a word.
 */
export function titleCaseHeading(text) {
  const raw = String(text ?? '').trim();
  const hasLetter = [...raw].some(isLetter);
  if (!hasLetter || raw !== raw.toUpperCase() || raw === raw.toLowerCase()) return raw;
  const parts = raw.toLowerCase().split(/(\s+|-)/);
  const wordIdx = parts.map((p, i) => (p && p !== '-' && !/^\s+$/.test(p) ? i : -1)).filter(i => i >= 0);
  const first = wordIdx[0];
  const last = wordIdx[wordIdx.length - 1];
  return parts.map((p, i) => {
    if (!wordIdx.includes(i)) return p;
    if (i !== first && i !== last && SMALL_WORDS.has(p)) return p;
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join('');
}

/**
 * Casing mask (anchors entry `casing`): one character per letter of the display name, in order, `1` upper-case and `0`
 * lower-case; non-letters are not counted. Written by the 5.3 compiler only where title-casing differs from the
 * archive name.
 */
export function casingMask(name) {
  let mask = '';
  for (const ch of String(name ?? '')) if (isLetter(ch)) mask += isUpper(ch) ? '1' : '0';
  return mask;
}

/** Apply a casing mask. A mask whose length differs from the letter count is ignored (the preview shows the plain title case). */
export function applyCasingMask(name, mask) {
  const m = typeof mask === 'string' ? mask : '';
  const s = String(name ?? '');
  const letters = [...s].filter(isLetter).length;
  if (!/^[01]+$/.test(m) || m.length !== letters) return s;
  let i = 0;
  return [...s].map(ch => (isLetter(ch) ? (m[i++] === '1' ? ch.toUpperCase() : ch.toLowerCase()) : ch)).join('');
}

/** Non-letter, non-digit characters only: what a name edit may insert. */
export const NAME_EDIT_INSERT = /^[^\p{L}\p{N}\p{Cc}]{0,8}$/u;

/**
 * Apply name edits (anchors entry `nameEdits`): `[[at, del, ins], ...]`, positions in the title-cased heading
 * before any edit. An edit deletes `del` characters at `at` and inserts `ins`, which may hold only punctuation and
 * spaces (no letters or digits), so an edit list carries no text: it drops a subtitle or fixes an apostrophe. Edits are
 * applied from the end so positions stay valid; a list that overlaps or runs past the end is ignored as a whole.
 */
export function applyNameEdits(name, edits) {
  const s = [...String(name ?? '')];
  if (!Array.isArray(edits) || !edits.length) return s.join('');
  const list = [...edits].sort((a, b) => b[0] - a[0]);
  let limit = s.length;
  for (const [at, del, ins] of list) {
    if (!Number.isInteger(at) || !Number.isInteger(del) || at < 0 || del < 0 || at + del > limit || typeof ins !== 'string' || !NAME_EDIT_INSERT.test(ins)) return s.join('');
    limit = at;
  }
  for (const [at, del, ins] of list) s.splice(at, del, ...ins);
  return s.join('');
}

/**
 * Display name for a heading: fold the typesetter's hyphens (U+2010, U+2011) to `-`, title-case a heading set in
 * capitals, apply the optional name edits, then the optional casing mask.
 */
export function displayName(heading, mask, edits) {
  const folded = String(heading ?? '').replace(/[‐‑]/g, '-');
  return applyCasingMask(applyNameEdits(titleCaseHeading(folded), edits), mask);
}
