/**
 * The world actor behind a token actor, as Foundry reaches it: a synthetic (unlinked) token actor has `isToken` and a
 * `token` (TokenDocument), and `TokenDocument#baseActor` is the world actor. Foundry's Actor has no `baseActor`. Any actor
 * type; an actor that is not a token actor (or whose world actor is gone) is returned as it is.
 * @param {Actor|null|undefined} actor
 * @returns {Actor|null}
 */
export function baseActorOf(actor) {
  return actor?.token?.baseActor ?? actor ?? null;
}
