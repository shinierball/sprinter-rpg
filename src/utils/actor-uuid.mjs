/**
 * Actor lookup by UUID. Unlinked token actors share their base actor's `id`, so `game.actors.get(id)`
 * returns the wrong actor (or none); the UUID is the identity. In v14 a token actor's `actor.uuid` is
 * `Scene.<id>.Token.<id>.Actor.<base id>`; the bare token UUID resolves to the TokenDocument, so unwrap `.actor`.
 * Imports nothing from documents so any module may use it without an import cycle.
 */

/**
 * Resolve an actor from an actor UUID (world actor or synthetic token actor).
 * @param {string} [uuid]
 * @returns {Actor|null}
 */
export function resolveActorByUuid(uuid) {
  if (!uuid || typeof uuid !== 'string') return null;
  let doc;
  try {
    doc = fromUuidSync(uuid);
  } catch {
    return null; // not a UUID (Foundry throws for strings it cannot parse)
  }
  if (!doc) return null;
  if (doc.documentName === 'Token') return doc.actor ?? null;
  return doc;
}

/** True when both actors are the same actor by UUID (never by id, which unlinked tokens share). */
export function isSameActor(a, b) {
  return Boolean(a?.uuid) && a.uuid === b?.uuid;
}

/**
 * The canvas token whose actor has this UUID.
 * @param {Iterable<Token>} placeables
 * @param {string} uuid
 * @returns {Token|null}
 */
export function findTokenByActorUuid(placeables, uuid) {
  if (!uuid) return null;
  return Array.from(placeables || []).find(t => (t.actor?.uuid ?? t.document?.actor?.uuid) === uuid) || null;
}

/**
 * The actor a chat message speaks as. A token speaker resolves through the token (so an unlinked token
 * gives its own synthetic actor); otherwise the speaker's world actor.
 * @param {{ scene?: string, token?: string, actor?: string }} [speaker]
 * @returns {Actor|null}
 */
export function resolveSpeakerActor(speaker) {
  if (!speaker) return null;
  if (speaker.scene && speaker.token) {
    const tokenActor = resolveActorByUuid(`Scene.${speaker.scene}.Token.${speaker.token}`);
    if (tokenActor) return tokenActor;
  }
  return speaker.actor ? (game.actors?.get(speaker.actor) ?? null) : null;
}
