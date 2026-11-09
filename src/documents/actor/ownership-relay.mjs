/**
 * Ownership sync through the GM relay.
 *
 * Only a GM or Assistant GM may write an actor's `ownership`, so player clients never do. Instead the
 * client asks the active GM to copy "who owns the source actor" onto a target actor (a bonded pet,
 * mercenary, vehicle or personal space). The GM recomputes everything from the documents: the payload
 * carries only two UUIDs and a revoke flag, never an ownership object and never a level.
 *
 * Semantics (computed on the GM): for every non-GM user who owns `source`, set that user's explicit entry on
 * `target` to the level the documents imply (`grantLevel`): OWNER for a pet, mercenary or marker; for a personal
 * space OWNER when `source` is the space's `ownerUuid`, OBSERVER when it is only an occupant, nothing when it is
 * neither; for a vehicle OWNER when `source` is bonded to it (the vehicle's `ownerId`; a crawler's
 * `companions.vehicles` is display only) or is its driver (`pilotUuid`, Q220 (a)), OBSERVER when it is merely aboard,
 * nothing when it has no link. Grants only raise a level. With `revoke`, each user's explicit entry is LOWERED to
 * the level they are still entitled to (`entitledLevel`: the highest `linkLevel` over every actor they own that is
 * still linked to `target`, `source` included) or removed when they are entitled to nothing. On a vehicle every
 * grant is recorded (`CREW_ACCESS_FLAG`) and a revoke lowers only recorded users, never below their level before the
 * grant, so ownership set by hand is never taken away. A bonded owner who disembarks keeps OWNER, an unbonded
 * passenger drops to OBSERVER, and a user with another actor still aboard keeps OBSERVER. The entitlement is always
 * recomputed from the documents, never taken from the payload. `default` and every other user's entry are never
 * touched. Callers update the link fields first, then revoke, so "still linked" is judged after the change.
 *
 * GM-side authorization: the requester (identified by socketlib, never by the payload) must be a GM, or
 * own the target, or own the source while the target is a companion or space linked back to that source
 * (grants), or, for a revoke, own the source once the target is no longer linked back to it (a player can
 * withdraw their own access after unbonding).
 */
import { registerRelayAction, requestRelay, getActiveGM } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { readCrew } from '../../data/rules/vehicle-crew-rules.mjs';
import { SYSTEM_ID } from '../../constants.mjs';

export const SYNC_ACTOR_OWNERSHIP = 'syncActorOwnership';

/**
 * Flag key of a vehicle's grant record: `flags[SYSTEM_ID].crewAccess[userId] = { before, granted }`, one entry per user
 * whose level the system raised. `before` is their explicit level before the first grant (INHERIT when they had none),
 * `granted` the level the system last wrote. A dropped entry is written as `null` (no `-=` key).
 */
export const CREW_ACCESS_FLAG = 'crewAccess';

/** DOCUMENT_OWNERSHIP_LEVELS.INHERIT: v14 rejects `-=<userId>` keys in `ownership`; writing -1 removes the explicit entry. */
const INHERIT = -1;

function levels() {
  const l = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS;
  return { NONE: l?.NONE ?? 0, OBSERVER: l?.OBSERVER ?? 2, OWNER: l?.OWNER ?? 3 };
}

function usersList() {
  const users = globalThis.game?.users;
  if (!users) return [];
  return Array.from(users.values());
}

/** The user's explicit entry on `actor`, or INHERIT when there is none. */
function explicitLevel(actor, userId) {
  const raw = (actor?.ownership || {})[userId];
  const n = Number(raw);
  return raw !== undefined && raw !== null && Number.isInteger(n) ? n : INHERIT;
}

const isLevel = (v) => Number.isInteger(v) && v >= INHERIT && v <= 3;

/**
 * A vehicle's grant record, sanitised: `{ [userId]: { before, granted } }`. Entries that are null or malformed are
 * left out (a malformed entry is never trusted to lower anyone).
 * @returns {Record<string, { before: number, granted: number }>}
 */
export function accessRecord(target) {
  const raw = target?.flags?.[SYSTEM_ID]?.[CREW_ACCESS_FLAG];
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, rec] of Object.entries(raw)) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
    const before = Number(rec.before);
    const granted = Number(rec.granted);
    if (isLevel(before) && isLevel(granted)) out[id] = { before, granted };
  }
  return out;
}

/** Explicit-or-default ownership level of `user` on `actor`. */
function levelOf(actor, user) {
  const own = actor?.ownership || {};
  const explicit = Number(own[user.id]);
  if (Number.isFinite(explicit) && explicit !== INHERIT) return explicit;
  return Number(own.default ?? 0) || 0;
}

function ownsActor(actor, user) {
  if (!actor || !user) return false;
  if (user.isGM) return true;
  if (typeof actor.testUserPermission === 'function') return Boolean(actor.testUserPermission(user, 'OWNER'));
  return levelOf(actor, user) >= levels().OWNER;
}

/** Non-GM users who own `source`. */
function sourceOwners(source) {
  return usersList().filter(u => u && !u.isGM && ownsActor(source, u));
}

/** True when `target` is a companion or space that points back at `source`. */
function isLinkedTo(target, source) {
  const id = source?.id;
  const sys = target?.system || {};
  const ids = v => (Array.isArray(v) ? v : []);
  switch (target?.type) {
    case 'pet': return Boolean(id) && (sys.details?.ownerId || sys.ownerId) === id;
    case 'mount_vehicle': {
      if (Boolean(id) && sys.ownerId === id) return true;
      const ref = source?.uuid;
      return Boolean(ref) && readCrew(sys).occupants.some((o) => o.uuid === ref);
    }
    case 'mercenary': return Boolean(id) && (sys.details?.ownerId === id || ids(sys.details?.employerIds).includes(id));
    case 'personal_space': {
      // Spaces store crawler uuids (ids are not unique across unlinked tokens).
      const ref = source?.uuid;
      return Boolean(ref) && (sys.ownerUuid === ref || ids(sys.occupantUuids).includes(ref));
    }
    // A light marker stores the uuid of the actor whose lights it carries.
    case 'marker': return Boolean(source?.uuid) && sys.ownerUuid === source.uuid;
    default: return false;
  }
}

function worldActors() {
  const a = globalThis.game?.actors;
  if (!a) return [];
  return Array.from(a.values());
}

/** True when crawler `other` is still linked to `target` (link fields or its companion lists). */
function crawlerStillLinked(target, other) {
  if (isLinkedTo(target, other)) return true;
  const c = other.system?.companions || {};
  return [c.pets, c.vehicles, c.mercenaries].some(l => Array.isArray(l) && l.includes(target.id));
}

/**
 * True when `source` is bonded to vehicle `target`: the vehicle's own `ownerId` names it. The crawler's
 * `companions.vehicles` list is display only, never an access signal (a player can write their own crawler).
 */
function vehicleBonded(target, source) {
  return Boolean(source?.id) && target.system?.ownerId === source.id;
}

/**
 * The level `source` alone entitles its owners to on `target`, from the documents only.
 * @returns {number|null} OWNER, OBSERVER, or null when `source` has no standing on `target`
 */
export function linkLevel(target, source) {
  const { OBSERVER, OWNER } = levels();
  if (target?.type === 'personal_space') {
    const ref = source?.uuid;
    if (!ref) return null;
    if (target.system?.ownerUuid === ref) return OWNER;
    return Array.isArray(target.system?.occupantUuids) && target.system.occupantUuids.includes(ref) ? OBSERVER : null;
  }
  if (target?.type === 'mount_vehicle') {
    if (vehicleBonded(target, source)) return OWNER;
    const crew = readCrew(target.system);
    const ref = source?.uuid;
    if (!ref || !crew.occupants.some((o) => o.uuid === ref)) return null;
    // Q220 (a): the driver gets OWNER while driving (Foundry lets only an owner move a token).
    return crew.pilotUuid === ref ? OWNER : OBSERVER;
  }
  return crawlerStillLinked(target, source) ? OWNER : null;
}

/**
 * The highest level `user` still holds on `target` through the actors they own that are linked to it.
 * @param {Actor|null} source included even when it no longer resolves (a deleted actor still in memory)
 */
function entitledLevel(target, source, user) {
  const candidates = new Map();
  for (const a of [source, ...worldActors().filter((x) => x && x.type === 'crawler' && x.id !== target.id)]) {
    if (a?.uuid) candidates.set(a.uuid, a);
  }
  if (target.type === 'mount_vehicle') {
    for (const { uuid } of readCrew(target.system).occupants) {
      const doc = resolveActorByUuid(uuid);
      if (doc) candidates.set(uuid, doc);
    }
  }
  let best = null;
  for (const a of candidates.values()) {
    if (!ownsActor(a, user)) continue;
    const level = linkLevel(target, a);
    if (level !== null && (best === null || level > best)) best = level;
  }
  return best;
}

/**
 * The ownership level `source`'s owners are entitled to on `target`, derived from the documents only.
 * @returns {number|null} null when `source` has no standing on a personal space or vehicle
 */
function grantLevel(target, source) {
  if (target?.type === 'personal_space' || target?.type === 'mount_vehicle') return linkLevel(target, source);
  return levels().OWNER;
}

/** The source owners whose entry on a space or companion still has to change (no grant record). */
function pendingUsers(target, source, revoke) {
  const own = target?.ownership || {};
  if (revoke) {
    return sourceOwners(source)
      .map((u) => ({ user: u, level: entitledLevel(target, source, u) }))
      .filter(({ user, level }) => user.id in own && own[user.id] !== INHERIT && Number(own[user.id]) > (level ?? INHERIT))
      .map(({ user, level }) => ({ user, level: level ?? INHERIT }));
  }
  const level = grantLevel(target, source);
  if (level === null) return [];
  return sourceOwners(source).filter((u) => levelOf(target, u) < level).map((user) => ({ user, level }));
}

/**
 * Lower each recorded user in `users` to what they are still entitled to, never below their level before the grant.
 * A user whose entry no longer equals what the system wrote was changed by hand: their record is dropped and their
 * entry left alone. Fills `ownership` ({ userId: level }) and `records` ({ userId: record | null }).
 */
function lowerRecorded(target, source, users, ownership, records) {
  const record = accessRecord(target);
  for (const user of users) {
    const rec = record[user.id];
    if (!rec) continue;
    const current = explicitLevel(target, user.id);
    if (current !== rec.granted) {
      records[user.id] = null;
      continue;
    }
    const entitled = entitledLevel(target, source, user);
    if (entitled !== null && entitled > rec.before) {
      if (entitled < current) {
        ownership[user.id] = entitled;
        records[user.id] = { before: rec.before, granted: entitled };
      }
      continue;
    }
    if (current !== rec.before) ownership[user.id] = rec.before;
    records[user.id] = null;
  }
}

/**
 * The writes `source` implies on `target`, from the documents only.
 * Vehicles keep the grant record (`CREW_ACCESS_FLAG`): a grant records the level it replaced, and a revoke only lowers
 * recorded users, never below that level, so ownership set by hand or by creating the actor is never taken away.
 * Personal spaces, pets, mercenaries and markers keep the plain rule (lower to what is still entitled).
 * @returns {{ ownership: Record<string, number>, records: Record<string, object|null> }}
 */
function planSync(target, source, revoke) {
  const ownership = {};
  const records = {};
  if (target?.type !== 'mount_vehicle') {
    for (const { user, level } of pendingUsers(target, source, revoke)) ownership[user.id] = level;
    return { ownership, records };
  }
  if (revoke) {
    lowerRecorded(target, source, sourceOwners(source), ownership, records);
    return { ownership, records };
  }
  const level = grantLevel(target, source);
  if (level === null) return { ownership, records };
  const record = accessRecord(target);
  for (const user of sourceOwners(source)) {
    if (levelOf(target, user) >= level) continue;
    const current = explicitLevel(target, user.id);
    const rec = record[user.id];
    // A recorded entry that still holds what the system wrote keeps its first `before`; anything else starts over.
    const before = rec && rec.granted === current ? rec.before : current;
    ownership[user.id] = level;
    records[user.id] = { before, granted: level };
  }
  return { ownership, records };
}

const isEmptyPlan = ({ ownership, records }) => Object.keys(ownership).length === 0 && Object.keys(records).length === 0;

/**
 * One update with the ownership entries and the grant-record entries.
 * A synthetic (unlinked token) actor stores ownership in its ActorDelta, merged over the base actor's. There INHERIT (-1)
 * would make Foundry's `getUserLevel` defer to the token, which defers back to the synthetic actor, so "no entry" is
 * written as the actor's explicit default level instead (the same effective level).
 */
async function writePlan(target, { ownership, records }) {
  const data = {};
  if (target?.isToken) {
    const fallback = Number(target.ownership?.default ?? levels().NONE);
    const safe = Number.isInteger(fallback) && fallback >= 0 ? fallback : levels().NONE;
    for (const id of Object.keys(ownership)) if (ownership[id] === INHERIT) ownership[id] = safe;
  }
  if (Object.keys(ownership).length) data.ownership = ownership;
  for (const [id, rec] of Object.entries(records)) data[`flags.${SYSTEM_ID}.${CREW_ACCESS_FLAG}.${id}`] = rec;
  await target.update(data);
}

/**
 * True when some non-GM owner of `source` holds a recorded (system-granted) level on vehicle `target`, so a revoke for
 * `source` may change something. Readable on any client that can see both documents.
 */
export function hasRecordedAccess(target, source) {
  if (!target || !source) return false;
  const record = accessRecord(target);
  return sourceOwners(source).some((u) => u.id in record);
}

/**
 * GM side: write the ownership changes `source` implies on `target` (see the module comment). Takes documents, so a
 * deletion hook can pass an in-memory actor that no longer resolves by uuid.
 * @param {Actor} target
 * @param {Actor} source
 * @param {{ revoke?: boolean }} [opts]
 * @returns {Promise<boolean>} true when the target is in sync
 */
export async function applyOwnershipSync(target, source, { revoke = false } = {}) {
  if (!target || !source) return false;
  const plan = planSync(target, source, revoke === true);
  if (!isEmptyPlan(plan)) await writePlan(target, plan);
  return true;
}

/**
 * GM side: lower every recorded grant on vehicle `target` that its user is no longer entitled to (the login reconcile
 * for revokes missed while no GM was connected, e.g. a deletion). Never touches unrecorded entries.
 * @returns {Promise<boolean>} true when something was written
 */
export async function reconcileRecordedAccess(target) {
  if (target?.type !== 'mount_vehicle') return false;
  const record = accessRecord(target);
  const users = usersList().filter((u) => u && !u.isGM && u.id in record);
  const plan = { ownership: {}, records: {} };
  lowerRecorded(target, null, users, plan.ownership, plan.records);
  if (isEmptyPlan(plan)) return false;
  await writePlan(target, plan);
  return true;
}

/**
 * Sync the source actor's non-GM owners onto the target. See the module comment for the rules.
 * @param {Actor} target
 * @param {Actor} source
 * @param {{ revoke?: boolean }} [opts]
 * @returns {Promise<boolean>} true when the target is in sync (applied, or nothing to do); false when no GM
 *   could apply it or the GM refused
 */
export async function syncActorOwnership(target, source, { revoke = false } = {}) {
  if (!target || !source) return false;
  if (!globalThis.game?.user?.isGM) {
    if (isEmptyPlan(planSync(target, source, revoke === true))) return true;
    if (!getActiveGM()) {
      console.debug('Sprinter RPG | No GM connected; ownership sync for', target.name, 'is deferred.');
      return false;
    }
  }
  const res = await requestRelay(SYNC_ACTOR_OWNERSHIP, {
    targetUuid: target.uuid, sourceUuid: source.uuid, revoke: Boolean(revoke)
  });
  return res.ok === true;
}

registerRelayAction(SYNC_ACTOR_OWNERSHIP, {
  authorize: (payload, requester) => {
    if (!requester) return false;
    if (requester.isGM) return true;
    const target = resolveActorByUuid(payload?.targetUuid);
    const source = resolveActorByUuid(payload?.sourceUuid);
    if (!target || !source) return false;
    if (ownsActor(target, requester)) return true;
    if (!ownsActor(source, requester)) return false;
    return payload.revoke ? !isLinkedTo(target, source) : isLinkedTo(target, source);
  },
  apply: async (payload) => {
    const target = resolveActorByUuid(payload?.targetUuid);
    const source = resolveActorByUuid(payload?.sourceUuid);
    if (!target || !source) return false;
    return applyOwnershipSync(target, source, { revoke: payload.revoke === true });
  }
});
