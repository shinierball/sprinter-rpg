/**
 * src/sourcery/hyphens.mjs
 * Line-end breaks: a word the typesetter split over two lines, or a dash left at a line end. Pure; no node APIs.
 *
 * `buildRuns` records where a line wrapped after a hyphen or dash (`run.breaks`, plus `run.endBreak` for a run that ends
 * on one). Nothing is decided there: the run text stays as printed. The slicer resolves a break when it assembles a
 * block, with two kinds of evidence and no dictionary:
 *   - the item structure. In the book's U+2011 font a hyphen set as an item of its own (a lone item) belongs to a real
 *     compound and stays; a U+2011 glued to the end of a word is the typesetter's break and is joined.
 *   - the book's own vocabulary, for a plain hyphen at a line end (no item structure tells them apart): the joined word
 *     printed elsewhere means join, the hyphenated word printed elsewhere means keep.
 * An em dash at a line end loses the space that followed it. A printed word is never altered: a join removes only the
 * hyphen and the line break, a kept hyphen stays.
 *
 * The vocabulary is built per book, from that book alone (never from several books together), so the text a book yields,
 * and the hashes taken of it, are the same whichever other books are provided, at compile time and at import time.
 */

/** Marks `buildRuns` leaves after a line-end hyphen while it builds a run; stripped before a run is returned. */
export const MARK_BREAK = '';
export const MARK_LONE = '';

const SOFT = '­';
const NB = '‑';
const EM = '—';
const HYPHEN_END = /[­‐‑\-—]$/;
const WORD = /[\p{L}\p{N}']+(?:[-‐‑][\p{L}\p{N}']+)*/gu;
const HEAD = /([\p{L}\p{N}']+)$/u;
const TAIL = /^\s*([\p{L}\p{N}']+)/u;

/** Whether a (trimmed) text ends on a character a line may break after. */
export const endsOnBreakChar = text => HYPHEN_END.test(String(text ?? '').replace(/\s+$/, ''));

/** Strip the marks from a run's text and list the breaks: `{ at, lone }` with `at` the index of the hyphen or dash. */
export function extractBreaks(text) {
  const breaks = [];
  let out = '';
  for (const ch of text) {
    if (ch === MARK_BREAK || ch === MARK_LONE) breaks.push({ at: out.length - 1, lone: ch === MARK_LONE });
    else out += ch;
  }
  return { text: out, breaks };
}

/**
 * Vocabulary of one book: words and hyphenated compounds as printed inside a line (lower-case, hyphens folded to `-`).
 * A word the line-end break cuts in two is not counted, so the vocabulary holds only whole words.
 * Built from the runs the index already holds: the book's pages are not read again.
 */
export function buildVocabulary(pages) {
  const words = new Map();
  const compounds = new Map();
  const add = (map, w) => map.set(w, (map.get(w) ?? 0) + 1);
  for (const { runs } of pages) {
    for (const run of runs) {
      const text = run.text;
      const at = new Set((run.breaks ?? []).map(b => b.at));
      for (const m of text.matchAll(WORD)) {
        const end = m.index + m[0].length;
        // the head of a break ends right before its hyphen; its tail starts right after the hyphen (and the space)
        if (at.has(end) || at.has(m.index - 1) || at.has(m.index - 2)) continue;
        // a run that ends on a hyphen: its last word is a head, not a whole word
        if (end === text.length - 1 && HYPHEN_END.test(text[end])) continue;
        const w = m[0].toLowerCase().replace(/[‐‑]/g, '-');
        if (w.includes('-')) { add(compounds, w); for (const part of w.split('-')) add(words, part); } else add(words, w);
      }
    }
  }
  return { words, compounds };
}

/** The empty vocabulary: every plain-hyphen break then joins (the default below). */
export const EMPTY_VOCABULARY = Object.freeze({ words: new Map(), compounds: new Map() });

const SUFFIXES = ['ing', 'ed', 'er', 'ers', 'es', 's', 'al', 'ly', 'ment', 'ments', 'tion', 'tions', 'ties', 'ous', 'able', 'ible'];

/**
 * Whether a plain hyphen at a line end is a typesetter's break (`join`) or part of a compound (`keep`), from the book's
 * own words. A printed compound keeps the hyphen; a printed whole word, or its stem, joins; a tail that is an ending
 * joins; two words the book prints whole keep the hyphen (`rage-fueled`, whose joined form it never prints); anything else
 * joins, because most line-end hyphens are the typesetter's.
 */
export function decideBreak(head, tail, vocab = EMPTY_VOCABULARY) {
  const x = String(head).toLowerCase();
  const y = String(tail).toLowerCase();
  const joined = x + y;
  if (vocab.compounds.has(`${x}-${y}`) && !vocab.words.has(joined)) return 'keep';
  if (vocab.words.has(joined)) return 'join';
  for (const s of SUFFIXES) if (joined.endsWith(s) && vocab.words.has(joined.slice(0, -s.length))) return 'join';
  if (SUFFIXES.includes(y)) return 'join';
  if (vocab.words.has(x) && vocab.words.has(y)) return 'keep';
  return 'join';
}

/** What to do with the break at `char` between `head` and `tail`: `join` (drop hyphen), `keep` (hyphen stays), or `space` (dash: drop the space). */
function decide(char, lone, head, tail, vocab) {
  if (char === EM) return 'dash';
  if (char === SOFT) return 'join';
  if (!head || !tail) return 'none';
  if (char === NB) return lone ? 'keep' : 'join';
  return decideBreak(head, tail, vocab);
}

const fold = text => text.replace(/[‐‑]/g, '-');

/** The text of a run with its in-run breaks resolved and the typesetter's hyphens folded to `-`. */
export function resolveRun(run, vocab = EMPTY_VOCABULARY) {
  const text = run.text;
  const breaks = run.breaks ?? [];
  if (!breaks.length) return fold(text);
  let out = '';
  let pos = 0;
  for (const b of breaks) {
    const before = text.slice(pos, b.at);
    const char = text[b.at];
    const rest = text.slice(b.at + 1);
    const head = HEAD.exec(before)?.[1] ?? '';
    const tail = TAIL.exec(rest)?.[1] ?? '';
    const verdict = decide(char, b.lone, head, tail, vocab);
    const space = /^\s+/.exec(rest)?.[0].length ?? 0;
    out += before;
    if (verdict === 'none') out += text.slice(b.at, b.at + 1 + space);
    else if (verdict === 'keep') out += '-';
    else if (verdict === 'dash') out += char;
    pos = b.at + 1 + space;
  }
  return fold(out + text.slice(pos));
}

/**
 * What a piece (a run in a block) does at its end when the next line is joined to it: `{ verdict }` for a piece whose
 * text ends on a hyphen or dash, decided against the first word of the piece that follows.
 */
export function endVerdict(run, next, vocab = EMPTY_VOCABULARY) {
  const text = run.text;
  if (!run.endBreak || !endsOnBreakChar(text) || !next) return null;
  const char = text[text.length - 1];
  const head = HEAD.exec(text.slice(0, -1))?.[1] ?? '';
  const tail = TAIL.exec(next.text)?.[1] ?? '';
  const verdict = decide(char, run.endBreak.lone, head, tail, vocab);
  return verdict === 'none' ? null : verdict;
}
