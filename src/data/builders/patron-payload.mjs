/**
 * The patron item's payload normaliser (a creation spec or an import). Never throws: every fix is a warning, so a
 * mistyped field is corrected rather than lost (Directive 4). It owns what only a patron has: the two skill lists, the
 * advice channel and the linked actor's uuid.
 */
import { firstScalar, toStringList } from '../../utils/first-scalar.mjs';
import { slugifyIdentifier } from '../../utils/identifier.mjs';
import { PATRON_MESSAGING } from '../../utils/patron/patron-profile.mjs';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Free-text fields: one trimmed string. Prose keeps its commas ("Assistant manager, night shift"), so only an array is unwrapped. */
const TEXT_FIELDS = Object.freeze(['title', 'availability', 'specialty', 'venues', 'quests', 'favours', 'rewards', 'actorUuid']);

const proseOf = (raw) => String(Array.isArray(raw) ? raw[0] ?? '' : raw ?? '').trim();

/** Slugged, de-duplicated identifiers from an array or comma list. */
function identifierList(raw) {
  const out = [];
  for (const entry of toStringList(raw)) {
    const id = slugifyIdentifier(entry);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Normalise `system` in place for a patron.
 * @param {object} system the payload's `system` (its `identifier` is already filled)
 * @param {(path: string, message: string, code?: string) => void} warn
 * @returns {object} `system`
 */
export function normalizePatronSystem(system, warn) {
  if (!isObject(system)) return system;
  const identifier = slugifyIdentifier(firstScalar(system.identifier, ''));
  if (identifier) system.identifier = identifier;

  for (const key of TEXT_FIELDS) {
    if (system[key] !== undefined) system[key] = proseOf(system[key]);
  }

  if (system.performanceSkills !== undefined) system.performanceSkills = identifierList(system.performanceSkills);
  if (system.skills !== undefined) {
    const performance = Array.isArray(system.performanceSkills) ? system.performanceSkills : [];
    system.skills = identifierList(system.skills).filter((id) => {
      if (!performance.includes(id)) return true;
      warn('system.skills', `"${id}" is already a performance Skill; kept there only`, 'spec');
      return false;
    });
  }

  if (system.messaging !== undefined) {
    const messaging = String(firstScalar(system.messaging, '')).trim().toLowerCase();
    if (PATRON_MESSAGING.includes(messaging)) system.messaging = messaging;
    else {
      warn('system.messaging', `"${messaging}" is not an advice channel (${PATRON_MESSAGING.join(', ')}); changed to hud`, 'spec');
      system.messaging = 'hud';
    }
  }
  return system;
}
