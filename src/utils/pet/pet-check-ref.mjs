/**
 * The pet reference a skill check carries on its record: which pet the check was rolled about and what for (taming, guiding,
 * riding). A leaf (it imports only the sanitiser) because the check record, itself an import cycle member, reads it. The
 * outcome is never stored: `effectiveCheck` derives it from the card.
 */
import { firstScalar } from '../first-scalar.mjs';

/** A kind id's shape; whether the kind is registered is checked where the card is settled (this leaf imports no rules). */
const KIND_ID = /^[a-z][a-z0-9_.-]*$/;

const text = (raw) => String(firstScalar(raw, '') ?? '').trim();
const wholeOrNull = (raw) => {
  const first = firstScalar(raw, null);
  if (first === null || first === '' || typeof first === 'boolean') return null;
  const n = Number(first);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/**
 * Sanitise a pet check reference.
 * @param {*} raw
 * @returns {{ petUuid: string, kind: string, dc: number|null, ruleBreak: boolean, minutes: number }|null} null when the pet or the kind is missing or malformed
 */
export function sanitizePetCheckRef(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const petUuid = text(raw.petUuid);
  const kind = text(raw.kind);
  if (!petUuid || !KIND_ID.test(kind)) return null;
  return { petUuid, kind, dc: wholeOrNull(raw.dc), ruleBreak: raw.ruleBreak === true, minutes: Math.max(0, wholeOrNull(raw.minutes) ?? 0) };
}
