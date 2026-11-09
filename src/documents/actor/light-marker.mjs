/**
 * Light markers: one minimal `marker` actor per source actor, owned by the source actor's owners and reused
 * for every light that actor creates. The light tokens themselves are 3.16c.
 *
 * Any actor with a token can make lights (Q130). A mob's marker belongs to the GM only: a mob has no non-GM owners, so
 * `syncActorOwnership` grants nobody.
 *
 * Ownership follows the codebase rule (see ownership-relay.mjs): only a GM writes other users' `ownership`. The creating
 * user gets `{ default: NONE, [me]: OWNER }`; co-owners come from `syncActorOwnership`. When the user may not create
 * actors, the `createLightMarker` relay builds the marker on the GM from the documents alone: the payload carries one uuid.
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { syncActorOwnership } from './ownership-relay.mjs';
import { userOwnsActor } from './personal-space-links.mjs';
import { MARKER_TYPE } from '../../utils/area/marker.mjs';
import { registerPayloadDelegate, buildPayload } from '../../data/builders/item-payload.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';

export const RELAY_ACTION_CREATE_LIGHT_MARKER = 'createLightMarker';

const MAX_NAME_LENGTH = 100;

function levels() {
  const l = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS;
  return { NONE: l?.NONE ?? 0, OWNER: l?.OWNER ?? 3 };
}

/** The world actor a marker is keyed by (unwraps synthetic token actors, so every token of a mob shares one marker). */
function sourceDoc(actor) {
  return actor?.baseActor ?? actor ?? null;
}

/** Disposition the marker's prototype token starts with: the source's own (friendly when it names none). */
function sourceDisposition(source) {
  const d = Number(source?.prototypeToken?.disposition);
  return Number.isFinite(d) ? d : (globalThis.CONST?.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1);
}

function worldMarkers() {
  const a = globalThis.game?.actors;
  if (!a) return [];
  const all = Array.from(a.values());
  return all.filter((x) => x && x.type === MARKER_TYPE);
}

/**
 * The marker that carries `source`'s lights, if one exists.
 * @param {Actor} source any actor (a synthetic token actor resolves to its world actor)
 * @returns {Actor|null}
 */
export function findLightMarker(source) {
  const ref = sourceDoc(source)?.uuid;
  if (!ref) return null;
  return worldMarkers().find((m) => m.system?.ownerUuid === ref) ?? null;
}

/**
 * Pure: the create data for a source actor's marker. It carries no `ownership` key (the caller sets it).
 * The prototype token is unlinked, sightless, 0.5 squares, hides bars, and shows its name to owners on hover.
 * @param {{ name?: string, ownerUuid?: string, ownerName?: string, disposition?: number }} spec
 * @returns {object}
 */
export function buildMarkerPayload(spec = {}) {
  const ownerName = typeof spec.ownerName === 'string' ? spec.ownerName.trim() : '';
  const rawName = typeof spec.name === 'string' ? spec.name.trim() : '';
  const name = (rawName || (ownerName ? `${ownerName} — Light` : 'Light')).slice(0, MAX_NAME_LENGTH);
  const modes = globalThis.CONST?.TOKEN_DISPLAY_MODES;
  const disposition = Number.isFinite(Number(spec.disposition)) ? Number(spec.disposition) : (globalThis.CONST?.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1);
  return {
    name,
    type: MARKER_TYPE,
    system: { ownerUuid: typeof spec.ownerUuid === 'string' ? spec.ownerUuid : '' },
    prototypeToken: {
      name,
      actorLink: false,
      width: 0.5,
      height: 0.5,
      sight: { enabled: false },
      displayBars: modes?.NONE ?? 0,
      displayName: modes?.OWNER_HOVER ?? 30,
      disposition
    }
  };
}

/** Create a marker for `source` through the one payload entry point, with the given ownership. */
async function createMarkerActor(source, ownership) {
  const data = buildPayload(MARKER_TYPE, {
    ownerUuid: source.uuid,
    ownerName: source.name,
    disposition: sourceDisposition(source)
  });
  data.ownership = ownership;
  const ActorDoc = globalThis.CONFIG?.Actor?.documentClass ?? globalThis.Actor;
  return ActorDoc.create(data);
}

/**
 * The marker that carries `actor`'s lights, created on first use. Reuses an existing one; never makes a second.
 * Creates locally when the user is a GM or may create actors, otherwise through the GM relay (which refuses a requester
 * who does not own `actor`). Co-owners are synced afterwards. Local check-and-create calls for one source run one at a
 * time (`runKeyed`), so two lights lit together share one marker. The relay path holds no lock: the GM serialises it.
 * @param {Actor} actor the light's source: a crawler, pet, mercenary, npc or mob
 * @returns {Promise<Actor|null>} null when the actor is not a document, or no GM could create it
 */
export async function getOrCreateLightMarker(actor) {
  const source = sourceDoc(actor);
  if (!source?.uuid) return null;
  const user = globalThis.game?.user;
  if (user?.isGM || user?.hasPermission?.('ACTOR_CREATE')) {
    return runKeyed(source.uuid, () => reuseOrCreateLocally(source, user));
  }
  const existing = findLightMarker(source);
  if (existing) {
    await syncActorOwnership(existing, source);
    return existing;
  }
  const reply = await requestRelay(RELAY_ACTION_CREATE_LIGHT_MARKER, { sourceUuid: source.uuid });
  return resolveActorByUuid(reply.result?.uuid);
}

async function reuseOrCreateLocally(source, user) {
  const existing = findLightMarker(source);
  if (existing) {
    await syncActorOwnership(existing, source);
    return existing;
  }
  const { NONE, OWNER } = levels();
  const marker = await createMarkerActor(source, { default: NONE, ...(user.isGM ? {} : { [user.id]: OWNER }) });
  if (!marker) return null;
  await syncActorOwnership(marker, source);
  return marker;
}

registerRelayAction(RELAY_ACTION_CREATE_LIGHT_MARKER, {
  authorize: (payload, requester) => {
    if (!requester?.id) return false;
    const source = sourceDoc(resolveActorByUuid(payload?.sourceUuid));
    return Boolean(source) && source.type !== MARKER_TYPE && userOwnsActor(source, requester);
  },
  apply: async (payload, requester) => {
    const source = sourceDoc(resolveActorByUuid(payload?.sourceUuid));
    if (!source) return null;
    // A second request returns the marker that exists; ownership and every field are derived here.
    return runKeyed(source.uuid, async () => {
      let marker = findLightMarker(source);
      if (!marker) {
        const { NONE, OWNER } = levels();
        marker = await createMarkerActor(source, { default: NONE, ...(requester.isGM ? {} : { [requester.id]: OWNER }) });
      }
      if (!marker) return null;
      await syncActorOwnership(marker, source);
      return { uuid: marker.uuid, id: marker.id, name: marker.name };
    });
  }
});

// The one payload entry point delegates here for type 'marker'.
registerPayloadDelegate(MARKER_TYPE, buildMarkerPayload);
