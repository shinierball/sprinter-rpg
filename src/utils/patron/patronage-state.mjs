/**
 * Patronage state: what a patron item's `system.patronage` or a deity item's `system.bond.patronage` says, read
 * defensively, and the lists built on it (core rulebook pp. 145-146, 315-316). A leaf: it imports only the sanitiser and
 * the tag vocabulary, so the worship state (itself a leaf the import cycle reaches) can read it without joining the cycle.
 */
import { firstScalar } from '../first-scalar.mjs';
import { PATRON_TAGS } from '../../data/tag-vocabulary.mjs';

/** `none` is a god that is not a patron; the rest are a patron's life (design). */
export const PATRONAGE_STATUSES = Object.freeze(['none', 'prospect', 'auditioning', 'patron', 'former']);
/** How a patron was acquired (pp. 315-316): the class offer, an audition, a transfer, a killer's, or set from the sheet. */
export const PATRONAGE_VIA = Object.freeze(['', 'class', 'audition', 'transfer', 'killer', 'direct']);
/** How a patronage ended (p. 316); `left` is the Bard walking out, a Rule Break. */
export const PATRONAGE_ENDINGS = Object.freeze(['', 'quit', 'died', 'murdered', 'ended', 'left']);
/** A patron's attitude, worst to best (p. 315). */
export const PATRON_ATTITUDES = Object.freeze(['opposed', 'reluctant', 'willing', 'enthusiastic']);
/** How an audition ended (p. 315). */
export const AUDITION_RESULTS = Object.freeze(['', 'agreed', 'declined', 'stormedOff']);
/** What one applied audition check did (p. 316). */
export const AUDITION_EVENTS = Object.freeze(['', 'benefit', 'stormedOff']);

/** An audition is three checks (p. 315). */
export const AUDITION_CHECKS = 3;

const text = (raw) => String(firstScalar(raw, '') ?? '').trim();
const oneOf = (raw, list, fallback) => {
  const value = text(raw);
  return list.includes(value) ? value : fallback;
};
const nullableNumber = (raw, { integer = false, min = -Infinity } = {}) => {
  const first = firstScalar(raw, null);
  if (first === null || first === '') return null;
  const n = Number(first);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, integer ? Math.trunc(n) : n);
};
const plain = (raw) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});

/**
 * One applied audition check, sanitised.
 * @returns {{ skill: string, outcome: string, from: string, to: string, event: string, messageId: string, at: number|null }}
 */
export function sanitizeAuditionCheck(raw) {
  const c = plain(raw);
  return {
    skill: text(c.skill), outcome: text(c.outcome), from: text(c.from), to: text(c.to),
    event: oneOf(c.event, AUDITION_EVENTS, ''), messageId: text(c.messageId), at: nullableNumber(c.at)
  };
}

/**
 * A patronage block with every field at its initial value (the shape `patronageField` stores).
 * @param {string} [status='prospect']
 */
export function freshPatronage(status = 'prospect') {
  return {
    status: oneOf(status, PATRONAGE_STATUSES, 'prospect'), via: '', since: null, attitude: 'willing',
    audition: { dc: null, steady: false, result: '', checks: [] }, earned: 0, endedBy: '', endedFloor: null
  };
}

/**
 * The sanitised patronage of a `patron` item (`system.patronage`) or a `deity` item (`system.bond.patronage`). Anything
 * malformed reads as initial: status `prospect` on a patron item, `none` on a god.
 * @param {object} item
 */
export function patronageOf(item) {
  const isGod = item?.type === 'deity';
  const p = plain(isGod ? item?.system?.bond?.patronage : item?.system?.patronage);
  const a = plain(p.audition);
  return {
    status: oneOf(p.status, PATRONAGE_STATUSES, isGod ? 'none' : 'prospect'),
    via: oneOf(p.via, PATRONAGE_VIA, ''),
    since: nullableNumber(p.since),
    attitude: oneOf(p.attitude, PATRON_ATTITUDES, 'willing'),
    audition: {
      dc: nullableNumber(a.dc, { integer: true, min: 0 }),
      steady: a.steady === true,
      result: oneOf(a.result, AUDITION_RESULTS, ''),
      checks: Array.isArray(a.checks) ? a.checks.map(sanitizeAuditionCheck) : []
    },
    earned: nullableNumber(p.earned, { integer: true, min: 0 }) ?? 0,
    endedBy: oneOf(p.endedBy, PATRONAGE_ENDINGS, ''),
    endedFloor: nullableNumber(p.endedFloor, { integer: true })
  };
}

/** The patron items plus the deity items whose patronage status is not `none`. */
export function patronageItems(items) {
  return Array.from(items ?? []).filter((item) => item?.type === 'patron' || (item?.type === 'deity' && patronageOf(item).status !== 'none'));
}

/** The patronage items whose status is `patron` (active). */
export function activePatrons(items) {
  return patronageItems(items).filter((item) => patronageOf(item).status === 'patron');
}

/**
 * The patronage bonds among a list of items, for the requirement subject: one entry per patronage item.
 * `tags` are the item's own authored tags (a requirement's `query` is judged against them).
 * @returns {{ identifier: string, type: string, status: string, tags: string[] }[]}
 */
export function patronBonds(items) {
  return patronageItems(items).map((item) => ({
    identifier: text(item.system?.identifier),
    type: item.type,
    status: patronageOf(item).status,
    tags: Array.isArray(item.system?.tags) ? item.system.tags.map(text).filter(Boolean) : []
  }));
}

/**
 * Whether a crawler may or must have a patron, from its tags: `rule.patron-required` (the class says so, p. 146),
 * `access.patron` (may acquire one, p. 145), else none.
 * @param {Iterable<string>} tags
 * @returns {'required'|'eligible'|'none'}
 */
export function patronEligibility(tags) {
  const set = new Set(Array.from(tags ?? []).map(text));
  if (set.has(PATRON_TAGS.required)) return 'required';
  if (set.has(PATRON_TAGS.eligible)) return 'eligible';
  return 'none';
}
