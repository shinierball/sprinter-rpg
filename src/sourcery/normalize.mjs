/**
 * src/sourcery/normalize.mjs
 * Text normalisers shared by the indexer, the compiler and the hydrator. Pure.
 *
 * The heading normaliser must stay byte-stable: anchors store its SHA-256, so any change invalidates every anchors file.
 */
import { sha256 } from './hash.mjs';

const LIGATURES = { '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi', '\uFB04': 'ffl', '\uFB05': 'st', '\uFB06': 'st' };

/**
 * NFKC (folds ligatures and full-width forms), drops soft hyphens, zero-width characters and private-use code points
 * (ToUnicode gaps), folds quotes and dashes to ASCII, lower-cases, drops apostrophes, and collapses everything that is
 * not a letter or digit to one space.
 */
export function normalizeHeading(text) {
  let s = String(text ?? '');
  s = s.replace(/[\uFB00-\uFB06]/g, ch => LIGATURES[ch] ?? ch);
  s = s.normalize('NFKC');
  s = s.replace(/[\u00AD\u200B-\u200F\u2060\uFEFF]/g, '');
  s = s.replace(/[\uE000-\uF8FF]/g, '');
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032`\u00B4]/g, "'");
  s = s.replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"');
  s = s.replace(/[\u2010-\u2015\u2212]/g, '-');
  s = s.toLowerCase();
  s = s.replace(/'/g, '');
  return s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Join discretionary line-break hyphens and unwrap lines in text that has no item structure (raw page text, a block's
 * paragraphs). A U+2011 or soft hyphen at a line end is joined. A hyphen-minus at a line end is left as is: most of them
 * are the typesetter's breaks, but only the book's vocabulary can tell, and that is decided where the runs are read
 * (`hyphens.mjs`, used by the slicer), which also keeps a U+2011 that stands alone as a real compound's hyphen.
 */
export function unwrap(text) {
  return String(text ?? '')
    .replace(/[\u00AD\u2011][ \t]*\n[ \t]*/g, '')
    .replace(/[\u00AD\u2011] (?=\p{Ll})/gu, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Body normaliser for prefix hashes: joins break hyphens first, then the heading rules (word order kept, no case). */
export function normalizeBody(text) {
  return normalizeHeading(String(text ?? '').replace(/[\u00AD\u2011][ \t]*\n[ \t]*/g, '').replace(/[\u00AD\u2011] (?=\p{Ll})/gu, ''));
}

/** The normalised key of a heading, and of its alias: the text before an opening parenthesis (alternative names). */
export function headingKeys(text) {
  const raw = String(text ?? '');
  const key = normalizeHeading(raw);
  const open = raw.indexOf('(');
  const alias = open > 0 ? normalizeHeading(raw.slice(0, open)) : null;
  return { key, alias: alias && alias !== key ? alias : null };
}

/** Anchor hash of a heading: SHA-256 of its normalised key. Empty keys hash to null (never an anchor). */
export function headingHash(text) {
  const key = normalizeHeading(text);
  return key ? sha256(key) : null;
}

/** Number of normalised characters in a body prefix. */
export const PREFIX_CHARS = 80;

/** Advisory quality hash: SHA-256 of the first 80 characters of the normalised body. Null for an empty body. */
export function bodyPrefixHash(text) {
  const key = normalizeBody(text).slice(0, PREFIX_CHARS).trim();
  return key ? sha256(key) : null;
}

/** Default and maximum number of normalised words a line selector hashes. */
export const LINE_WORDS = 8;
export const MAX_LINE_WORDS = 40;
/** Hex characters kept of a line hash: a selector chooses among the lines of one block, so 64 bits is ample. */
export const LINE_HASH_CHARS = 16;

/**
 * Line selector hash: the first `words` normalised words of a line (the prefix-hash normaliser, so bullets,
 * punctuation and case do not count), SHA-256, first 16 hex characters. Null for a line with no words.
 */
export function lineHash(text, words = LINE_WORDS) {
  const n = Number.isInteger(words) && words > 0 ? Math.min(words, MAX_LINE_WORDS) : LINE_WORDS;
  const key = normalizeBody(text).split(' ').filter(Boolean).slice(0, n).join(' ');
  return key ? sha256(key).slice(0, LINE_HASH_CHARS) : null;
}
