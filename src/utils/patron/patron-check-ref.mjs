/**
 * The patron reference a skill check carries on its record (core rulebook pp. 315-316): which patron item the check was
 * rolled for and why. One slot with a `kind`: an audition check or a gig. A leaf (it imports only the sanitiser) because
 * the check record, itself an import cycle member, reads it.
 */
import { firstScalar } from '../first-scalar.mjs';

/** What a patron check was rolled for. */
const PATRON_CHECK_KINDS = Object.freeze(['audition', 'gig']);

const text = (raw) => String(firstScalar(raw, '') ?? '').trim();
const wholeOrNull = (raw) => {
  const first = firstScalar(raw, null);
  if (first === null || first === '') return null;
  const n = Number(first);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
};

/**
 * Sanitise a patron check reference. The patron item is on the roller, so the reference carries no actor.
 * @param {*} raw
 * @returns {{ kind: string, itemId: string, skill: string, rank: number, dc: number|null }|null} null when the kind is unknown or the item id is empty
 */
export function sanitizePatronCheckRef(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const kind = text(raw.kind);
  const itemId = text(raw.itemId);
  if (!PATRON_CHECK_KINDS.includes(kind) || !itemId) return null;
  return { kind, itemId, skill: text(raw.skill), rank: wholeOrNull(raw.rank) ?? 0, dc: wholeOrNull(raw.dc) };
}
