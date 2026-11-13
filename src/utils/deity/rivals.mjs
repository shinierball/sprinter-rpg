/**
 * Rival gods and the identification markers (p. 164): who is set against whom, and what a viewer's client draws on a
 * token whose actor worships a fellow or a rival god. Pure: the hooks layer reads the world and draws
 * (`hooks/worship-markers.mjs`, `hooks/worship-notices.mjs`). Token disposition is never changed.
 *
 * Rivalry is read in either direction (A lists B, or B lists A), because the book prints it one-sided for some gods.
 * Everything is compared by identifier, never by name (Principle 2).
 */
import { firstScalar } from '../first-scalar.mjs';
import { WORSHIPS_TAG_PREFIX } from '../../data/tag-vocabulary.mjs';

const id = (raw) => String(firstScalar(raw, '') ?? '').trim().toLowerCase();

/** The sanitised rivals of one deity record: lower-cased, deduplicated, never the god's own identifier. */
function rivalsOfRecord(deity) {
  const own = id(deity?.system?.identifier);
  const raw = deity?.system?.rivals;
  const list = Array.isArray(raw) ? raw : (raw == null || raw === '' ? [] : String(raw).split(','));
  return [...new Set(list.map(id).filter((r) => r && r !== own))];
}

/**
 * A lookup from a deity identifier to its listed rivals.
 * @param {Array<{ system?: { identifier?: string, rivals?: string[] } }>} deities
 * @returns {(identifier: string) => string[]}
 */
export function rivalsLookup(deities) {
  const map = new Map();
  for (const deity of Array.isArray(deities) ? deities : []) {
    const own = id(deity?.system?.identifier);
    if (!own || map.has(own)) continue;
    map.set(own, rivalsOfRecord(deity));
  }
  return (identifier) => map.get(id(identifier)) ?? [];
}

/** True when either god lists the other. A god is never its own rival. */
export function areRivals(a, b, rivalsOf) {
  const x = id(a);
  const y = id(b);
  if (!x || !y || x === y) return false;
  return (rivalsOf(x) ?? []).map(id).includes(y) || (rivalsOf(y) ?? []).map(id).includes(x);
}

/** The identifiers of the `worships.<id>` tags in a tag collection. */
export function godsFromTags(tags) {
  const out = [];
  for (const tag of Array.from(tags ?? [])) {
    if (typeof tag !== 'string' || !tag.startsWith(WORSHIPS_TAG_PREFIX)) continue;
    const god = id(tag.slice(WORSHIPS_TAG_PREFIX.length));
    if (god && !out.includes(god)) out.push(god);
  }
  return out;
}

/**
 * What a viewer sees on a token: a fellow worshipper (one shared god; wins) or a rival (a god of the token set against
 * one of the viewer's), else nothing. `deity` is the god whose image is drawn: the shared one for a fellow, the token's
 * own for a rival.
 * @returns {{ kind: 'fellow'|'rival', deity: string }|null}
 */
export function identificationMark(viewerGods, tokenGods, rivalsOf) {
  const mine = (viewerGods ?? []).map(id).filter(Boolean);
  const theirs = (tokenGods ?? []).map(id).filter(Boolean);
  if (!mine.length || !theirs.length) return null;
  const shared = theirs.find((g) => mine.includes(g));
  if (shared) return { kind: 'fellow', deity: shared };
  const rival = theirs.find((g) => mine.some((m) => areRivals(g, m, rivalsOf)));
  return rival ? { kind: 'rival', deity: rival } : null;
}

const DEFAULT_LINE = ({ token, god, rival, crawler }) => `${token} worships ${god}, a rival of ${rival} (worshipped by ${crawler})`;

/**
 * The GM notice lines: one per token god that is a rival of a god a crawler worships.
 * @param {{ tokenName: string, tokenGods: string[], crawlers: Array<{ name: string, gods: string[] }> }} input
 * @param {(identifier: string) => string[]} rivalsOf
 * @param {{ label?: (identifier: string) => string, format?: (data: object) => string }} [text] a display name for an
 *   identifier (default: the identifier) and the line's wording (default: English)
 * @returns {string[]}
 */
export function rivalNoticeLines({ tokenName, tokenGods, crawlers }, rivalsOf, { label = (g) => g, format = DEFAULT_LINE } = {}) {
  const lines = [];
  for (const god of (tokenGods ?? []).map(id).filter(Boolean)) {
    for (const crawler of crawlers ?? []) {
      for (const theirs of (crawler.gods ?? []).map(id)) {
        if (!areRivals(god, theirs, rivalsOf)) continue;
        lines.push(format({ token: tokenName, god: label(god), rival: label(theirs), crawler: crawler.name }));
      }
    }
  }
  return lines;
}
