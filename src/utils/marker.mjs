/**
 * Marker actors carry light tokens and nothing else. They are not creatures: target and area
 * resolution, aura membership, combat and rosters must skip them. This leaf helper imports nothing.
 */

/** The Actor type of the light carrier. */
export const MARKER_TYPE = 'marker';

/**
 * True when the argument is a marker actor, or a token, token document or combatant whose actor is one.
 * @param {object|null|undefined} subject an Actor, Token placeable, TokenDocument or Combatant
 * @returns {boolean}
 */
export function isMarkerActor(subject) {
  if (!subject) return false;
  if (subject.type === MARKER_TYPE) return true;
  return subject.actor?.type === MARKER_TYPE || subject.document?.actor?.type === MARKER_TYPE;
}
