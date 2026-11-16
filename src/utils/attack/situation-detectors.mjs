/**
 * The detector registry: which stock reasons the Attack Options window may pre-tick, and what it says about each.
 * A detector is a pure function of the attack's facts (`readAttackFacts`) that answers `{ state, note }`;
 * a tag without one reads as `unknown` with no note (a plain toggle). `CONFIG.COG.situationDetectors` is the registry object.
 */
import { DETECTED } from '../../data/rules/attack-situation-rules.mjs';

/** @type {Record<string, { tag: string, detect: Function, provider: string }>} tag id -> detector */
export const SITUATION_DETECTORS = {};
const priorities = new Map();

const TAG_ID = /^[A-Za-z][\w-]*(\.[\w-]+)+$/;

/**
 * Register (or, at a higher priority, replace) the detector of a situation tag. `detect(facts, raw)` returns `{ state, note? }`.
 * @returns {boolean} whether it took effect (a bad id, a non-function, or an equal-or-higher priority owner refuses it)
 */
export function registerSituationDetector(tag, detect, { priority = 10, provider = 'core' } = {}) {
  if (typeof tag !== 'string' || !TAG_ID.test(tag) || typeof detect !== 'function') {
    console.warn(`Sprinter RPG | registerSituationDetector refused "${tag}": needs a tag id and a function.`);
    return false;
  }
  const current = priorities.get(tag);
  if (current !== undefined && current >= priority) {
    console.warn(`Sprinter RPG | registerSituationDetector refused "${tag}": already registered at an equal or higher priority.`);
    return false;
  }
  priorities.set(tag, priority);
  SITUATION_DETECTORS[tag] = { tag, detect, provider };
  return true;
}

const UNKNOWN = Object.freeze({ state: DETECTED.unknown, note: '' });

function read(tag, facts, raw) {
  const entry = SITUATION_DETECTORS[tag];
  if (!entry || !facts) return UNKNOWN;
  try {
    const out = entry.detect(facts, raw);
    const state = out?.state;
    if (state !== DETECTED.yes && state !== DETECTED.no && state !== DETECTED.unknown) return UNKNOWN;
    return { state, note: typeof out.note === 'string' ? out.note : '' };
  } catch (err) {
    console.warn(`Sprinter RPG | The detector of "${tag}" threw`, err);
    return UNKNOWN;
  }
}

/**
 * Run the detectors of these tags. A tag with none, a throw or a bad result reads as `{ state: 'unknown', note: '' }`.
 * @param {Iterable<string>} tags
 * @param {object|null} facts `readAttackFacts` result; null (nothing read) makes every tag unknown
 * @param {{ actor?: object, item?: object, context?: object, targets?: Array }|null} [raw] for a module's detector that needs more than the facts
 * @returns {Map<string, { state: 'yes'|'no'|'unknown', note: string }>}
 */
export function detectSituations(tags, facts, raw = null) {
  const out = new Map();
  for (const tag of tags ?? []) out.set(tag, read(tag, facts, raw));
  return out;
}
