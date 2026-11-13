/**
 * What a patron is, read from either item that can be one: a `patron` item (an NPC patron, core rulebook pp. 315-319)
 * or a `deity` item (a god as a patron, p. 146). A leaf: it imports only the sanitiser, so any layer may read it.
 */
import { firstScalar, toStringList } from '../first-scalar.mjs';

/** How a patron's advice reaches the Bard: HUD chat, or a messenger fairy (p. 316). */
export const PATRON_MESSAGING = Object.freeze(['hud', 'fairy']);

/** Lower-cased, trimmed, de-duplicated identifiers from an array or comma list. */
function identifiers(raw) {
  const out = [];
  for (const entry of toStringList(raw)) {
    const id = String(entry).trim().toLowerCase();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The structured profile of a patron or deity item. Every field is sanitised; nothing reads names or descriptions.
 * @param {object} item a `patron` or `deity` item
 * @returns {{ identifier: string, name: string, type: string, performanceSkills: string[], skills: string[], messaging: string, actorUuid: string, tags: string[] }}
 */
export function patronProfileOf(item) {
  const sys = item?.system ?? {};
  const type = String(firstScalar(item?.type, ''));
  const base = {
    identifier: String(firstScalar(sys.identifier, '')).trim(),
    name: String(firstScalar(item?.name, '')),
    type,
    tags: identifiers(sys.tags)
  };
  if (type === 'deity') {
    return { ...base, performanceSkills: [], skills: identifiers(sys.signature?.skills), messaging: 'fairy', actorUuid: '' };
  }
  const performanceSkills = identifiers(sys.performanceSkills);
  const messaging = String(firstScalar(sys.messaging, 'hud')).trim().toLowerCase();
  return {
    ...base,
    performanceSkills,
    skills: identifiers(sys.skills).filter((id) => !performanceSkills.includes(id)),
    messaging: PATRON_MESSAGING.includes(messaging) ? messaging : 'hud',
    actorUuid: String(firstScalar(sys.actorUuid, '')).trim()
  };
}
