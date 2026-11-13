/**
 * The deity item's payload normaliser (a creation spec or an import). Never throws: every fix is a warning, so a
 * mistyped field is corrected rather than lost (Directive 4). Runs inside `buildPayload` before the granted effects are
 * compiled one by one; it owns what only a deity has: rivals, the signature stat and skills, the offering numbers, the
 * tier of each tier effect and the one-buff-one-debuff limit of the signature effects.
 */
import { firstScalar, toStringList } from '../../utils/first-scalar.mjs';
import { slugifyIdentifier } from '../../utils/identifier.mjs';
import { STAT_TO_TAG } from '../tag-vocabulary.mjs';
import { EFFECT_ITEM_TYPES } from '../../utils/document-types.mjs';

/** The lowest and highest worship tier (Acolyte, Devotee, Zealot; core rulebook pp. 163-164). */
const TIER_RANGE = Object.freeze({ min: 1, max: 3 });

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A whole number of at least 0: a negative or non-numeric value is 0, with a warning. */
function wholeNumber(raw, path, warn) {
  const value = Number(firstScalar(raw, 0));
  if (Number.isFinite(value) && value >= 0) return Math.floor(value);
  warn(path, 'must be a whole number of 0 or more; changed to 0', 'spec');
  return 0;
}

/** Slugged, de-duplicated identifiers from an array or comma list; `drop` leaves out one value, with a warning. */
function identifierList(raw, path, warn, drop = '') {
  const out = [];
  for (const entry of toStringList(raw)) {
    const id = slugifyIdentifier(entry);
    if (!id || out.includes(id)) continue;
    if (id === drop) { warn(path, `"${id}" cannot be its own rival; dropped`, 'spec'); continue; }
    out.push(id);
  }
  return out;
}

/** The entries of `signatureEffects` or `tierEffects` that are a buff or a debuff with a name; the rest are reported and dropped. */
function usableEffects(list, path, warn) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((entry, i) => {
    const here = `${path}[${i}]`;
    if (!isObject(entry) || !EFFECT_ITEM_TYPES.includes(entry.type)) {
      warn(here, `an effect must be a buff or a debuff, not "${isObject(entry) ? entry.type : typeof entry}"; dropped`, 'grant');
    } else if (typeof entry.name !== 'string' || !entry.name.trim()) {
      warn(here, 'an effect needs a name; dropped', 'grant');
    } else out.push(entry);
  });
  return out;
}

/**
 * Normalise `system` in place for a deity.
 * @param {object} system the payload's `system` (its `identifier` is already filled)
 * @param {(path: string, message: string, code?: string) => void} warn
 * @returns {object} `system`
 */
export function normalizeDeitySystem(system, warn) {
  if (!isObject(system)) return system;
  const identifier = slugifyIdentifier(firstScalar(system.identifier, ''));
  if (identifier) system.identifier = identifier;

  if (system.rivals !== undefined) system.rivals = identifierList(system.rivals, 'system.rivals', warn, identifier);

  if (isObject(system.signature)) {
    const sig = system.signature;
    if (sig.stat !== undefined) {
      const stat = String(firstScalar(sig.stat, '')).trim().toLowerCase();
      const known = Object.hasOwn(STAT_TO_TAG, stat);
      if (stat && !known) warn('system.signature.stat', `"${stat}" is not a stat (${Object.keys(STAT_TO_TAG).join(', ')}); cleared`, 'spec');
      sig.stat = known ? stat : '';
    }
    if (sig.skills !== undefined) sig.skills = identifierList(sig.skills, 'system.signature.skills', warn);
  }

  if (isObject(system.offering)) {
    const offering = system.offering;
    if (offering.gold !== undefined) offering.gold = wholeNumber(offering.gold, 'system.offering.gold', warn);
    if (isObject(offering.consume) && offering.consume.quantity !== undefined) {
      offering.consume.quantity = wholeNumber(offering.consume.quantity, 'system.offering.consume.quantity', warn);
    }
  }

  if (system.signatureEffects !== undefined) {
    const kept = [];
    for (const [i, entry] of usableEffects(system.signatureEffects, 'system.signatureEffects', warn).entries()) {
      if (kept.some((k) => k.type === entry.type)) warn(`system.signatureEffects[${i}]`, `only one ${entry.type} is allowed; dropped`, 'spec');
      else kept.push(entry);
    }
    system.signatureEffects = kept;
  }

  if (system.tierEffects !== undefined) {
    system.tierEffects = usableEffects(system.tierEffects, 'system.tierEffects', warn).map((entry, i) => {
      const asked = Number(firstScalar(entry.tier, TIER_RANGE.min));
      const tier = Number.isFinite(asked) ? Math.min(TIER_RANGE.max, Math.max(TIER_RANGE.min, Math.round(asked))) : TIER_RANGE.min;
      if (tier !== asked) warn(`system.tierEffects[${i}].tier`, `tier must be ${TIER_RANGE.min} to ${TIER_RANGE.max}; changed to ${tier}`, 'spec');
      return { ...entry, tier };
    });
  }
  return system;
}
