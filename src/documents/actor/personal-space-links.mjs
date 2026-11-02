/**
 * Personal-space membership: who owns and who occupies a `personal_space` actor.
 *
 * The space actor is the single source of truth. `system.ownerUuid` holds the owning crawler's UUID and
 * `system.occupantUuids` the authorized occupant crawlers' UUIDs (the owner is also listed). A space always
 * stores the WORLD crawler's uuid (`crawlerRef`), never a synthetic token actor's.
 *
 * Player clients never write `ownership`. Access follows membership through `syncActorOwnership`, which
 * asks the GM: the owner gets OWNER, occupants get OBSERVER (view only). Links are always written before
 * access is revoked, because the GM judges "still linked" from the documents.
 *
 * Only the GM can clear a space's owner (Q4: a crawler never loses their personal space in play).
 * Occupants who are not the owner can always leave.
 *
 * Imports no sheet and not `actor.mjs`, so the actor mixin can import it without a cycle.
 */
import { registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { syncActorOwnership } from './ownership-relay.mjs';
import { resolveActor } from './actor-constants.mjs';
import { getSpaceTypeInfo } from '../../data/rules/personal-space-rules.mjs';
import { contentRegistry } from '../../content/registry.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { registerPayloadDelegate } from '../../data/builders/item-payload.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';

export const RELAY_ACTION_PERSONAL_SPACE_LEAVE = 'personalSpaceLeave';
export const RELAY_ACTION_CREATE_PERSONAL_SPACE = 'createPersonalSpace';

export const SECOND_SPACE_REASON = 'Crawler already owns a personal space';
const MAX_NAME_LENGTH = 100;

function levels() {
  const l = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS;
  return { NONE: l?.NONE ?? 0, OBSERVER: l?.OBSERVER ?? 2, OWNER: l?.OWNER ?? 3 };
}

/** A supplied non-negative whole number (an explicit stat override), else null (follow the space type). */
function explicitCount(raw) {
  let val = firstScalar(raw, null);
  if (val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

const asList = (v) =>(Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);

/** True when `user` owns `actor` (GM, or an OWNER entry; works with and without testUserPermission). */
export function userOwnsActor(actor, user) {
  if (!actor || !user) return false;
  if (user.isGM) return true;
  if (typeof actor.testUserPermission === 'function') return Boolean(actor.testUserPermission(user, 'OWNER'));
  const own = actor.ownership || {};
  return Number(own[user.id] ?? own.default ?? 0) >= levels().OWNER;
}

/** World actors of one type (`game.actors` is a Collection). */
function worldActorsOfType(type) {
  const a = globalThis.game?.actors;
  if (!a) return [];
  const all = Array.from(a.values());
  return all.filter((x) => x && x.type === type);
}

/** World `crawler` actors. */
export function worldCrawlers() {
  return worldActorsOfType('crawler');
}

/** World actor for a crawler (unwraps synthetic token actors). */
export function crawlerDoc(actor) {
  if (!actor) return null;
  return actor.baseActor ?? actor;
}

/** The uuid a space stores for this crawler. */
export function crawlerRef(actor) {
  return crawlerDoc(actor)?.uuid ?? '';
}

/** World `personal_space` actors. */
export function worldSpaces() {
  return worldActorsOfType('personal_space');
}

/** True when the space's owner or occupant list holds `ref` (a crawler uuid). */
export function spaceListsRef(space, ref) {
  if (!space || !ref || typeof ref !== 'string') return false;
  const sys = space.system || {};
  return sys.ownerUuid === ref || asList(sys.occupantUuids).includes(ref);
}

/** True when the space is owned by or occupied by this crawler. */
export function spaceLinksCrawler(space, crawler) {
  return spaceListsRef(space, crawlerRef(crawler));
}

/** True when the current user may write the space document. */
export function canWriteSpace(space) {
  return Boolean(globalThis.game?.user?.isGM || space?.isOwner);
}

/**
 * True when the current user is the GM or owns the space's owner crawler: the one player who runs a space.
 * Holding Foundry OWNER on the space document is not enough (a stale or hand-granted entry must not let an
 * occupant's player rewrite membership, or skip the GM's access revoke).
 */
export function userRunsSpace(space) {
  const user = globalThis.game?.user;
  if (user?.isGM) return true;
  const owner = resolveActorByUuid(space?.system?.ownerUuid);
  return Boolean(owner && space?.isOwner && userOwnsActor(owner, user));
}

/** Resolve a space from an Actor, uuid or id; null unless it is a personal space. */
export function resolveSpace(spaceOrRef) {
  if (!spaceOrRef) return null;
  const doc = typeof spaceOrRef === 'string'
    ? (resolveActorByUuid(spaceOrRef) ?? resolveActor(spaceOrRef))
    : spaceOrRef;
  return doc?.type === 'personal_space' ? doc : null;
}

/**
 * The owner and occupant crawlers that still resolve (owner first, no duplicates) and the refs that do not.
 * @returns {{ owner: Actor|null, occupants: Actor[], missing: string[] }}
 */
export function spaceMembers(space) {
  const sys = space?.system || {};
  const refs = [...new Set([sys.ownerUuid, ...asList(sys.occupantUuids)].filter(Boolean))];
  const owner = resolveActorByUuid(sys.ownerUuid);
  const occupants = [];
  const missing = [];
  for (const ref of refs) {
    const doc = resolveActorByUuid(ref);
    if (doc) occupants.push(doc);
    else missing.push(ref);
  }
  return { owner, occupants, missing };
}

/**
 * Pure: the create data for a new space owned by `crawler`. It carries no `ownership` key (the caller sets it).
 * @param {{ crawlerUuid: string, crawlerName: string }} crawler
 * @param {object} [options] name, spaceType and the manual overrides; `ruleBreak: true` flags a second space
 */
export function buildPersonalSpacePayload({ crawlerUuid, crawlerName }, options = {}) {
  const opts = options || {};
  let typeKey = firstScalar(opts.spaceType, '');
  const spaceTypes = contentRegistry.getSpaceTypes();
  // An unknown type falls back to the first registered one (the baseline safe room when none are registered)
  if (typeof typeKey !== 'string' || !Object.hasOwn(spaceTypes, typeKey)) typeKey = Object.keys(spaceTypes)[0];
  const typeInfo = getSpaceTypeInfo(typeKey);
  const rawName = typeof opts.name === 'string' ? opts.name.trim().slice(0, MAX_NAME_LENGTH) : '';
  const stamp = Date.now();

  const data = {
    name: rawName || `${crawlerName}'s Safe Space`,
    type: 'personal_space',
    system: {
      ownerUuid: crawlerUuid,
      occupantUuids: [crawlerUuid],
      spaceType: typeKey,
      tier: opts.tier || typeInfo.tier || 1,
      size: opts.size || typeInfo.size || 'Single Room',
      // null follows the space type's base values (also after a type change); a number is an explicit override
      defenseRating: explicitCount(opts.defenseRating),
      stashCapacity: explicitCount(opts.stashCapacity),
      restHoursReduction: Number(opts.restHoursReduction) || 0,
      wellRestedBonus: Number(opts.wellRestedBonus) || 1,
      trainingBonusHours: Number(opts.trainingBonusHours) || 1,
      trainingAdvancementBonus: Number(opts.trainingAdvancementBonus) || 0,
      quests: opts.quests || [
        {
          id: `quest-${stamp}-1`,
          title: 'Explore the Floor Safe Zone',
          source: 'Floor Job Board',
          reward: '50 Gold',
          description: 'Scout out the local vendors and secure your living quarters.',
          completed: false
        }
      ],
      outsideFeed: opts.outsideFeed || [
        {
          id: `feed-${stamp}-1`,
          channel: 'Universal Broadcast',
          title: 'Crawler Safe Room Certified',
          message: `Safe Room activated for Crawler ${crawlerName}. Hostile mob access blocked.`,
          timestamp: new Date().toISOString()
        }
      ],
      details: {
        amenities: opts.amenities || typeInfo.amenities || '',
        security: opts.security || typeInfo.security || '',
        notes: opts.notes || `<p>${typeInfo.description}</p>`
      }
    }
  };
  if (opts.ruleBreak === true) {
    data.flags = { [SYSTEM_ID]: { ruleBreak: true, ruleBreakReason: SECOND_SPACE_REASON } };
  }
  return data;
}

/**
 * Add a crawler to a space. The caller must be able to write the space (the owner or the GM).
 * Writes the link first, then grants access: OWNER to the space's owner, OBSERVER to any other occupant.
 * @returns {Promise<boolean>}
 */
export async function addCrawlerToSpace(space, crawler) {
  const doc = crawlerDoc(crawler);
  if (!space || doc?.type !== 'crawler') return false;
  const ref = doc.uuid;
  const sys = space.system || {};
  const update = {};
  const occupants = asList(sys.occupantUuids);
  if (!occupants.includes(ref)) update['system.occupantUuids'] = [...occupants, ref];
  const ownsAnother = typeof doc.getOwnedPersonalSpace === 'function' && doc.getOwnedPersonalSpace();
  if (!sys.ownerUuid && !ownsAnother) update['system.ownerUuid'] = ref;
  if (Object.keys(update).length) await space.update(update);

  await syncActorOwnership(space, doc);
  return true;
}

/**
 * Remove a crawler ref from a space. The caller must be able to write the space (owner, GM, or the GM
 * applying a leave request). Updates the links first, then revokes. Only the GM may remove the owner.
 * @returns {Promise<boolean>}
 */
export async function removeCrawlerFromSpace(space, ref) {
  if (!space || !ref || typeof ref !== 'string') return false;
  const sys = space.system || {};
  const wasOwner = sys.ownerUuid === ref;
  if (wasOwner && !globalThis.game?.user?.isGM) {
    globalThis.ui?.notifications?.warn?.('Only the GM can take a personal space away from its owner.');
    return false;
  }
  const update = { 'system.occupantUuids': asList(sys.occupantUuids).filter((u) => u !== ref) };
  if (wasOwner) update['system.ownerUuid'] = '';
  await space.update(update);

  const crawler = resolveActorByUuid(ref);
  if (crawler) await syncActorOwnership(space, crawler, { revoke: true });
  return true;
}

/**
 * Active GM only: grant every space's members the access they should have. Never revokes.
 * Repairs memberships that were written while no GM was connected.
 * @returns {Promise<number>} how many spaces changed
 */
export async function reconcilePersonalSpaceOwnership() {
  if (!globalThis.game?.user?.isGM) return 0;
  let touched = 0;
  for (const space of worldSpaces()) {
    const before = JSON.stringify(space.ownership || {});
    const { owner, occupants } = spaceMembers(space);
    for (const member of occupants) {
      if (member === owner) continue;
      await syncActorOwnership(space, member);
    }
    if (owner) await syncActorOwnership(space, owner);
    if (JSON.stringify(space.ownership || {}) !== before) touched++;
  }
  return touched;
}

/** Create a space actor for `crawler` from sanitized options with the given ownership. */
async function createSpaceActor(crawler, options, ownership) {
  const data = buildPersonalSpacePayload({ crawlerUuid: crawler.uuid, crawlerName: crawler.name }, options);
  data.ownership = ownership;
  const ActorDoc = globalThis.CONFIG?.Actor?.documentClass ?? globalThis.Actor;
  return ActorDoc.create(data);
}

/**
 * Create a personal space owned by `crawler`: locally when the user may create actors, else through the GM.
 * Does not touch ownership beyond the creating user's own entry.
 * @returns {Promise<Actor|null>}
 */
export async function createSpaceForCrawler(crawler, options = {}) {
  const doc = crawlerDoc(crawler);
  if (!doc) return null;
  const user = globalThis.game?.user;
  const { NONE, OWNER } = levels();
  if (user?.isGM || user?.hasPermission?.('ACTOR_CREATE')) {
    const space = await createSpaceActor(doc, options, { default: NONE, ...(user.isGM ? {} : { [user.id]: OWNER }) });
    return space ?? null;
  }
  const reply = await requestRelay(RELAY_ACTION_CREATE_PERSONAL_SPACE, {
    crawlerUuid: doc.uuid, name: options.name, spaceType: options.spaceType, ruleBreak: options.ruleBreak === true
  });
  return resolveActorByUuid(reply.result?.uuid);
}

registerRelayAction(RELAY_ACTION_PERSONAL_SPACE_LEAVE, {
  authorize: (payload, user) => {
    if (!user) return false;
    if (user.isGM) return true;
    const crawler = resolveActorByUuid(payload?.crawlerUuid);
    const space = resolveActorByUuid(payload?.spaceUuid);
    if (crawler?.type !== 'crawler' || space?.type !== 'personal_space') return false;
    if (!userOwnsActor(crawler, user)) return false;
    // Only the GM takes a space away from its owner.
    if (space.system?.ownerUuid === payload.crawlerUuid) return false;
    return spaceListsRef(space, payload.crawlerUuid);
  },
  apply: async (payload) => {
    const crawler = resolveActorByUuid(payload?.crawlerUuid);
    const space = resolveActorByUuid(payload?.spaceUuid);
    if (crawler?.type !== 'crawler' || space?.type !== 'personal_space') return false;
    if (!spaceListsRef(space, payload.crawlerUuid)) return false;
    return removeCrawlerFromSpace(space, payload.crawlerUuid);
  }
});

registerRelayAction(RELAY_ACTION_CREATE_PERSONAL_SPACE, {
  authorize: (payload, requester) => {
    if (!requester?.id) return false;
    const crawler = resolveActorByUuid(payload?.crawlerUuid);
    return crawler?.type === 'crawler' && userOwnsActor(crawler, requester);
  },
  apply: async (payload, requester) => {
    const crawler = resolveActorByUuid(payload?.crawlerUuid);
    if (!crawler) return null;
    const { NONE, OWNER } = levels();
    const ruleBreak = payload.ruleBreak === true
      || Boolean(typeof crawler.getOwnedPersonalSpace === 'function' && crawler.getOwnedPersonalSpace());
    // Ownership and every field except name and spaceType are derived here; nothing else the client sent is used.
    const space = await createSpaceActor(
      crawler,
      { name: payload.name, spaceType: payload.spaceType, ruleBreak },
      { default: NONE, [requester.id]: OWNER }
    );
    if (!space) return null;
    await syncActorOwnership(space, crawler);
    return { uuid: space.uuid, id: space.id, name: space.name };
  }
});

// The one payload entry point delegates here for type 'personal_space'; its first argument is the owner.
registerPayloadDelegate('personal_space', buildPersonalSpacePayload);
