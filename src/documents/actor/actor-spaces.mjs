import { confirmRuleBreak, withRuleBreak, isRuleBreak } from '../../utils/rule-break.mjs';
import {
  RELAY_ACTION_PERSONAL_SPACE_LEAVE,
  addCrawlerToSpace,
  canWriteSpace,
  createSpaceForCrawler,
  crawlerDoc,
  crawlerRef,
  resolveSpace,
  spaceLinksCrawler,
  userOwnsActor,
  userRunsSpace,
  worldSpaces
} from './personal-space-links.mjs';
import { registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { syncActorOwnership } from './ownership-relay.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { carrySourceStamp, landItems } from '../../utils/content-source.mjs';
import { decrementFloorTimer } from './actor-environment.mjs';
import { currentTimeContext } from './dungeon-time.mjs';
import { openWindow, isWithinWindow, formatWindow } from '../../utils/time/time-window.mjs';
import { matchesTagQuery } from '../../utils/tag/tag-query.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { findConditionEntry } from '../../content/catalog-lookup.mjs';
import { rollAdvancementCheck, applyRankGain, postAdvancementCard } from './actor-advancement.mjs';
import { confirmRouteGain } from './advancement-gates.mjs';
import { ADVANCEMENT_ROUTES } from '../../utils/skill/advancement-routes.mjs';
import { roomOf, tablesIn, confirmRoomFor, studioProblems, confirmStudioFor } from './space-room.mjs';
import { spaceGroupFurniture } from './space-group.mjs';
import { isGmOnlyItem, isUnopenedBox, refuseGmOnlyItem, refuseStashedBox } from './gm-only-items.mjs';

/** `flags.sprinter-rpg.restBuff` of the buff a rest in a personal space applies; found by this flag, never by name. */
const WELL_RESTED_KEY = 'wellRested';
/** The Well Rested buff's "+N to all Checks" as a structured roll row (no condition = every check). */
const wellRestedRow = (value) => ({ kind: 'bonus', label: 'Well Rested', value });


const RELAY_ACTION_SPACE_STASH = 'personalSpaceStash';

const STASH_REFUSALS = {
  equipped: 'Cannot stash equipped items. Unequip first.',
  'gm-only': 'Only the GM can move or change loot boxes and achievements.',
  box: 'Loot boxes cannot go in or out of a stash. Open them instead.',
  full: 'Personal Space stash is full!',
  noRoom: 'No room for another table.',
  noStudio: 'A studio needs a bigger space, or one with no studio for that table type.'
};

/** Stash moves for one space run one at a time (create-then-delete must not interleave); the item is read inside. */
const runStashMove = (space, fn) => runKeyed(`stash:${space?.uuid ?? space?.id}`, fn);

/** Move one item from the crawler into the space vault. Runs where the caller can write both documents. */
async function performDeposit(crawler, space, itemId, { ruleBreak = false, performer = globalThis.game?.user } = {}) {
  const item = crawler.items?.get(itemId);
  if (!item) return { ok: false, reason: 'missing' };
  if (item.system?.equipped) return { ok: false, reason: 'equipped' };
  if (isUnopenedBox(item)) return { ok: false, reason: 'box' };
  if (performer && !performer.isGM && isGmOnlyItem(item)) return { ok: false, reason: 'gm-only' };

  const stashItems = getPersonalSpaceStashItems(crawler, space);
  const maxCapacity = space.system?.effectiveStashCapacity ?? space.system?.stashCapacity ?? 100;
  // A space upgrade (a table, a studio) is installed, not stashed: it takes no stash slot
  const over = item.type !== 'space_upgrade' && stashItems.length >= maxCapacity;
  if (over && !ruleBreak) return { ok: false, reason: 'full' };
  // A table past the group's room is a Rule Break too (the caller asks through `confirmRoomFor`).
  const overRoom = tablesIn([item]) > roomOf(space).left;
  if (overRoom && !ruleBreak) return { ok: false, reason: 'noRoom' };
  // A studio the space cannot take as the rules stand (too small a group, or a second one for a table type) is one too
  const found = studioProblems(space, [item]);
  const overStudio = found.tooSmall || found.duplicates.length > 0;
  if (overStudio && !ruleBreak) return { ok: false, reason: 'noStudio' };

  const itemData = item.toObject ? item.toObject() : structuredClone(item);
  delete itemData._id;
  delete itemData.id;
  if (over || overRoom || overStudio) itemData.flags = withRuleBreak(itemData).flags;

  await space.createEmbeddedDocuments('Item', [itemData]);
  await crawler.deleteEmbeddedDocuments('Item', [item.id]);
  return { ok: true, ruleBreak: over || overRoom || overStudio };
}

/** Move one item from the space vault into the crawler. Runs where the caller can write both documents. */
async function performWithdraw(crawler, space, itemId, { performer = globalThis.game?.user } = {}) {
  const item = space.items?.get(itemId);
  if (!item) return { ok: false, reason: 'missing' };
  if (isUnopenedBox(item)) return { ok: false, reason: 'box' };
  if (performer && !performer.isGM && isGmOnlyItem(item)) return { ok: false, reason: 'gm-only' };

  const itemData = item.toObject ? item.toObject() : structuredClone(item);
  delete itemData._id;
  delete itemData.id;

  await crawler.createEmbeddedDocuments('Item', [itemData]);
  await space.deleteEmbeddedDocuments('Item', [item.id]);
  return { ok: true };
}

/**
 * Anyone with a crawler in the space uses its stash. The space owner and the GM write directly; an
 * occupant's player (OBSERVER on the space) asks the GM, who re-checks that the space lists the crawler.
 * @returns {Promise<boolean>}
 */
async function moveStashItem(crawler, mode, itemId, options = {}) {
  const space = resolveSpace(options.space) ?? crawler.getPersonalSpace();
  if (!space) {
    if (mode === 'deposit') globalThis.ui?.notifications?.warn?.('No linked Personal Space found.');
    return false;
  }
  const user = globalThis.game?.user;
  const direct = canWriteSpace(space);
  if (!direct && !(spaceLinksCrawler(space, crawler) && userOwnsActor(crawler, user))) {
    globalThis.ui?.notifications?.warn?.(`Only the owner of ${space.name} can use its stash.`);
    return false;
  }
  // Boxes never go in or out of a stash (anyone); achievements move only for the GM.
  const moving = mode === 'deposit' ? crawler.items?.get(itemId) : space.items?.get(itemId);
  if (refuseStashedBox(moving) || refuseGmOnlyItem(moving)) return false;
  const perform = mode === 'deposit' ? performDeposit : performWithdraw;
  const attempt = async (ruleBreak) => {
    if (direct) return runStashMove(space, () => perform(crawler, space, itemId, { ruleBreak }));
    const reply = await requestRelay(
      RELAY_ACTION_SPACE_STASH,
      { spaceUuid: space.uuid, crawlerUuid: crawlerRef(crawler), itemId, mode, ruleBreak },
      { direct: false }
    );
    return reply.ok ? reply.result : null;
  };
  let result = await attempt(options.ruleBreak === true);
  if (result === null) return false;
  if (result?.reason === 'full') {
    // A full stash is a Rule Break, never a block (CONTRIBUTING rule 2): ask, and on yes move it and record the break.
    const confirm = await confirmRuleBreak({
      title: 'Stash Full',
      message: `${space.name}'s stash is full. Stash it anyway as a Rule Break?`,
      reason: STASH_REFUSALS.full,
      options: { ruleBreak: options.ruleBreak }
    });
    if (!confirm.confirmed) return false;
    result = await attempt(true);
    if (result === null) return false;
  } else if (result?.reason === 'noRoom') {
    const room = await confirmRoomFor(space, [crawler.items?.get(itemId)], { ruleBreak: options.ruleBreak });
    if (!room.ok) return false;
    result = await attempt(true);
    if (result === null) return false;
  } else if (result?.reason === 'noStudio') {
    const studio = await confirmStudioFor(space, [crawler.items?.get(itemId)], { ruleBreak: options.ruleBreak });
    if (!studio.ok) return false;
    result = await attempt(true);
    if (result === null) return false;
  }
  if (STASH_REFUSALS[result?.reason]) globalThis.ui?.notifications?.[result.reason === 'full' ? 'error' : 'warn']?.(STASH_REFUSALS[result.reason]);
  return result?.ok === true;
}

registerRelayAction(RELAY_ACTION_SPACE_STASH, {
  authorize: (payload, requester) => {
    if (!requester) return false;
    const space = resolveSpace(payload?.spaceUuid);
    const crawler = crawlerDoc(resolveActorByUuid(payload?.crawlerUuid));
    if (!space || crawler?.type !== 'crawler' || !spaceLinksCrawler(space, crawler)) return false;
    if (requester.isGM === true) return true;
    const itemId = String(payload?.itemId ?? '');
    if (isGmOnlyItem(payload?.mode === 'withdraw' ? space.items?.get(itemId) : crawler.items?.get(itemId))) return false;
    return userOwnsActor(crawler, requester);
  },
  apply: async (payload) => {
    const space = resolveSpace(payload?.spaceUuid);
    const crawler = crawlerDoc(resolveActorByUuid(payload?.crawlerUuid));
    if (!space || crawler?.type !== 'crawler' || !spaceLinksCrawler(space, crawler)) return { ok: false, reason: 'invalid' };
    const itemId = String(payload.itemId ?? '');
    // The requester already passed `authorize`; a confirmed Rule Break is honoured and recorded on the moved item.
    if (payload.mode === 'deposit') return runStashMove(space, () => performDeposit(crawler, space, itemId, { ruleBreak: payload.ruleBreak === true, performer: null }));
    if (payload.mode === 'withdraw') return runStashMove(space, () => performWithdraw(crawler, space, itemId, { performer: null }));
    return { ok: false, reason: 'invalid' };
  }
});

/** Crawler uuids already warned about owning several spaces (once per page load; this runs on every sheet render). */
const warnedMultiOwner = new Set();

/**
 * What is left of a crawler's open Training Room window ("3h 10m remaining"); empty when no window is open.
 * @param {Actor} crawler
 * @param {object} now `currentTimeContext()`
 * @returns {string}
 */
export function trainingWindowLabel(crawler, now) {
  const state = typeof crawler?.getFlag === 'function' ? crawler.getFlag(SYSTEM_ID, 'trainingState') : crawler?.flags?.[SYSTEM_ID]?.trainingState;
  const stamp = { expiresAt: state?.windowExpiresAt };
  return isWithinWindow(stamp, now) ? formatWindow(stamp, now) : '';
}

/**
 * Resolves the active training room of a personal space's group (the best room in any joined space): the highest-tier `space_upgrade` item with
 * `training.enabled` (or the one whose id or identifier is `options.upgradeId`). Reads the stored fields only;
 * the schema initial values are the defaults.
 * @param {Actor} space
 * @param {{ upgradeId?: string }} [options={}]
 * @returns {object|null} the room's `training` fields
 */
export function resolveTrainingRoomConfig(space, options = {}) {
  const candidates = spaceGroupFurniture(space).filter(item => item.system?.training?.enabled === true
    || Boolean(options.upgradeId && (item.id === options.upgradeId || item.system?.identifier === options.upgradeId)));
  if (!candidates.length) return null;
  const picked = (options.upgradeId && candidates.find(i => i.id === options.upgradeId || i.system?.identifier === options.upgradeId))
    || [...candidates].sort((a, b) => (Number(b.system?.tier) || 1) - (Number(a.system?.tier) || 1))[0];
  return { ...picked.system.training, enabled: true };
}

/** True when a tag query names at least one tag in some bucket. */
function hasQuery(query) {
  return ['all', 'any', 'none'].some(k => Array.isArray(query?.[k]) && query[k].length > 0);
}

/**
 * True when a training room's `allowedSkillTags` admits the skill (an empty query admits every skill). A query
 * for one exact skill uses its identity tag `id.skill.<identifier>`.
 * @param {object|null} training a room from `resolveTrainingRoomConfig`
 * @param {Item} skill
 * @returns {boolean}
 */
export function trainingAllowsSkill(training, skill) {
  if (!hasQuery(training?.allowedSkillTags)) return true;
  const skillTags = skill?.allTags instanceof Set ? skill.allTags : getItemAllTags(skill);
  return matchesTagQuery(skillTags, training.allowedSkillTags);
}

// =========================================================================
// PERSONAL SPACES & SAFE ROOM STASH METHODS
// The personal-space actors are the single source of truth: a crawler stores nothing about them.
// =========================================================================

/**
 * The one space this crawler owns (`ownerUuid`). Prefers a space that is not flagged as a rule-break
 * second space. Logs once if several spaces claim this crawler.
 * @returns {COGActor|null}
 */
export function getOwnedPersonalSpace(actor) {
  const ref = crawlerRef(actor);
  if (!ref) return null;
  const owned = worldSpaces().filter(s => s.system?.ownerUuid === ref);
  if (owned.length > 1 && !warnedMultiOwner.has(ref)) {
    warnedMultiOwner.add(ref);
    console.warn(`Sprinter RPG | ${actor.name} owns ${owned.length} personal spaces; a crawler may own only one.`);
  }
  return owned.find(s => !isRuleBreak(s)) ?? owned[0] ?? null;
}

/**
 * Every space this crawler owns or occupies: the owned space first, then the others in directory order.
 * @returns {COGActor[]}
 */
export function getLinkedPersonalSpaces(actor) {
  const owned = getOwnedPersonalSpace(actor);
  const rest = worldSpaces().filter(s => s !== owned && spaceLinksCrawler(s, actor));
  return owned ? [owned, ...rest] : rest;
}

/**
 * The space this crawler uses by default: the owned one, else the first space they occupy.
 * @returns {COGActor|null}
 */
export function getPersonalSpace(actor) {
  return getOwnedPersonalSpace(actor) ?? getLinkedPersonalSpaces(actor)[0] ?? null;
}

/**
 * Add this crawler to a space as an occupant (and as its owner when the space has none and this crawler
 * owns no other). Needs permission to write the space: its owner or the GM.
 * @param {COGActor|string} spaceOrRef
 * @returns {Promise<boolean>}
 */
export async function linkPersonalSpace(actor, spaceOrRef) {
  const space = resolveSpace(spaceOrRef);
  if (!space) return false;
  if (!canWriteSpace(space)) {
    globalThis.ui?.notifications?.warn?.(`Only the owner of ${space.name} or the GM can add occupants.`);
    return false;
  }
  return addCrawlerToSpace(space, actor);
}

/**
 * Leave a space (default: the owned one). An occupant who doesn't own the space document asks the GM;
 * only the GM can take a space from its owner.
 * @param {COGActor|string|null} [spaceOrRef=null]
 * @returns {Promise<boolean>}
 */
export async function unlinkPersonalSpace(actor, spaceOrRef = null) {
  const space = resolveSpace(spaceOrRef) ?? getOwnedPersonalSpace(actor);
  if (!space || !spaceLinksCrawler(space, actor)) return false;
  const ref = crawlerRef(actor);
  if (space.system?.ownerUuid === ref && !globalThis.game?.user?.isGM) {
    globalThis.ui?.notifications?.warn?.('Only the GM can take a personal space away from its owner.');
    return false;
  }
  const reply = await requestRelay(
    RELAY_ACTION_PERSONAL_SPACE_LEAVE,
    { spaceUuid: space.uuid, crawlerUuid: ref },
    { direct: userRunsSpace(space) }
  );
  return reply.ok === true && reply.result === true;
}

/**
 * 1-Click Auto-Provisioning: creates a new Personal Space Actor owned by this crawler.
 * A crawler may own only one space; a second needs a Rule Break confirmation.
 * @param {object} [options={}] name, rank, ruleBreak and the manual stat overrides
 * @returns {Promise<COGActor|null>} null when declined or when the space could not be created
 */
export async function acquirePersonalSpace(actor, options = {}) {
  let opts = options || {};
  const existing = getOwnedPersonalSpace(actor);
  if (existing) {
    const res = await confirmRuleBreak({
      title: 'Second Personal Space',
      message: `${actor.name} already owns ${existing.name}. A crawler may own only one personal space. Acquire another anyway as a Rule Break?`,
      options: opts
    });
    if (!res.confirmed) return null;
    opts = { ...opts, ruleBreak: true };
  }
  const crawler = crawlerDoc(actor);
  const space = await createSpaceForCrawler(crawler, opts);
  if (!space) {
    globalThis.ui?.notifications?.error?.('Could not create the personal space.');
    return null;
  }
  await syncActorOwnership(space, crawler);
  return space;
}


/**
 * Executes resting in the crawler's personal space, applying upgrade reductions and perks.
 * @param {string} [restType='long']
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export async function restInPersonalSpace(actor, restType = 'long', options = {}) {
  const space = resolveSpace(options.space) ?? getPersonalSpace(actor);
  const effectiveRed = space?.system?.effectiveRestHoursReduction ?? 0;
  const effectiveWellRested = space?.system?.effectiveWellRestedBonus ?? 1;
  const bonusBanked = space?.system?.effectiveTrainingBonusHours ?? 0;
  const bonusTempBars = space?.system?.bonusTempBars ?? 0;
  const tempBarsHpPerSlot = space?.system?.tempBarsHpPerSlot ?? 10;
  const purgesInjuries = space?.system?.removesInjuriesOnRest ?? false;

  // Apply rest via actor.rest() with reduced hours and personal space context
  const restResult = await actor.rest(restType, {
    ...options,
    space: undefined,
    inPersonalSpace: true,
    spaceName: space?.name || 'Personal Space',
    hoursReduced: effectiveRed,
    purgesInjuries
  });

  // Grant bonus banked grind hours from space training facility
  if (bonusBanked > 0) {
    const currentBank = Number(actor.system.details?.bankedGrindHours ?? actor.system.bankedGrindHours) || 0;
    const newBank = currentBank + bonusBanked;
    if (actor.system.details) actor.system.details.bankedGrindHours = newBank;
    actor.system.bankedGrindHours = newBank;
    await actor.update({ 'system.details.bankedGrindHours': newBank });
  }

  // Grant bonus temporary health bars from medical pod if configured
  if (bonusTempBars > 0) {
    await actor.grantTempBars({
      count: bonusTempBars,
      hpPerSlot: tempBarsHpPerSlot,
      source: `${space?.name || 'Safe Space'} Med Pod`,
      sourceUuid: space?.uuid || ''
    });
  }

  // Apply / Refresh "Well Rested" buff
  if (effectiveWellRested > 0) {
    const itemsList = Array.from(actor.items ?? []);
    const existingBuff = itemsList.find(i => i.type === 'buff' && i.flags?.[SYSTEM_ID]?.restBuff === WELL_RESTED_KEY);
    if (existingBuff) {
      await existingBuff.update({
        'system.checkModifiers': [wellRestedRow(effectiveWellRested)],
        'system.duration': 'Until end of next rest'
      });
    } else {
      const buffData = {
        name: 'Well Rested',
        type: 'buff',
        flags: { [SYSTEM_ID]: { restBuff: WELL_RESTED_KEY } },
        system: {
          checkModifiers: [wellRestedRow(effectiveWellRested)],
          duration: 'Until end of next rest',
          description: `Rested in ${space?.name || 'Safe Space'}. +${effectiveWellRested} bonus to all Checks.`
        }
      };
      await actor.createEmbeddedDocuments('Item', [buffData]);
    }
  }

  // Buffs the space's installed upgrades grant to whoever rests there: embedded items, never an externalBuffs slot
  const spaceBuffs = [];
  const buffIds = Array.isArray(space?.system?.buffs) ? space.system.buffs : [];
  for (const id of buffIds) {
    if (typeof id !== 'string' || !id) continue;
    const have = Array.from(actor.items ?? []).some(i => i.type === 'buff' && i.flags?.[SYSTEM_ID]?.spaceBuff === id);
    if (have) continue;
    const match = findConditionEntry('buffs', id);
    if (!match) {
      console.warn(`${SYSTEM_ID} | ${space?.name || 'Personal space'} grants unknown buff "${id}"; nothing applied`);
      continue;
    }
    await actor.createEmbeddedDocuments('Item', landItems([carrySourceStamp({
      name: match.name,
      type: 'buff',
      img: match.img || 'icons/svg/aura.svg',
      system: { ...structuredClone(match.system || {}), active: true },
      flags: { [SYSTEM_ID]: { spaceBuff: id } }
    }, match)]));
    spaceBuffs.push(match.name);
  }

  return {
    ...restResult,
    spaceBuffs,
    spaceName: space?.name || 'Safe Space',
    hoursReduced: effectiveRed,
    bonusBankedHours: bonusBanked,
    bonusTempBars,
    wellRestedBonus: effectiveWellRested
  };
}


/**
 * Retrieves stash items on a personal space, excluding space_upgrade items.
 * @param {Actor|null} [spaceActor=null]
 * @returns {Item[]}
 */
function getPersonalSpaceStashItems(actor, spaceActor = null) {
  const space = spaceActor || getPersonalSpace(actor);
  if (!space) return [];
  const itemsList = Array.from(space.items ?? []);
  return itemsList.filter(i => i && i.type !== 'space_upgrade');
}

/**
 * Deposits an item from the crawler's inventory into the personal space vault.
 * @param {string} itemId
 * @param {number} [quantity=1]
 * @returns {Promise<boolean>}
 */
export async function depositToPersonalSpace(actor, itemId, quantity = 1, options = {}) {
  return moveStashItem(actor, 'deposit', itemId, options);
}


/**
 * Withdraws an item from the personal space vault into the crawler's inventory.
 * @param {string} itemId
 * @param {number} [quantity=1]
 * @returns {Promise<boolean>}
 */
export async function withdrawFromPersonalSpace(actor, itemId, quantity = 1, options = {}) {
  return moveStashItem(actor, 'withdraw', itemId, options);
}

/**
 * One training session in a personal space's training room: an
 * extra Skill Advancement Check (d20 + bonus >= current Rank, as for grinding) that costs the room's hours off the
 * floor clock. The room's `space_upgrade` fields set the sessions per window, hour cost, roll bonus, advantage,
 * target modifier and allowed skills; the space's `effectiveTrainingAdvancementBonus` adds to the roll. Every limit
 * (crawler not in the space, no room, skill outside the room, window used up, Rank cap) asks for a Rule Break and
 * records `ruleBreak: true`; declining stops before anything is spent. Never hard-blocks.
 *
 * @param {Item|string} skillOrId an owned skill, its item id or its identifier (never a name)
 * @param {object} [options={}] `space`, `rollResult` (tests), `silent`, and the confirmRuleBreak options
 * @returns {Promise<object>}
 */
export async function trainSkillInPersonalSpace(actor, skillOrId, options = {}) {
  const space = resolveSpace(options.space) ?? getPersonalSpace(actor);
  if (!space) {
    globalThis.ui?.notifications?.warn?.('No personal space found for training.');
    return { success: false, reason: 'no-space' };
  }

  const items = Array.from(actor.items ?? []);
  const skill = (typeof skillOrId === 'object' && skillOrId !== null)
    ? skillOrId
    : items.find(i => i.type === 'skill' && (i.id === skillOrId || i._id === skillOrId || i.system?.identifier === skillOrId)) ?? null;
  if (!skill) return { success: false, reason: 'skill-not-found' };

  let ruleBreak = false;
  /** Ask once about one limit; true when confirmed (the session then is a Rule Break). */
  const breakLimit = async (title, message) => {
    const res = await confirmRuleBreak({ title, message, options });
    if (res.confirmed) ruleBreak = true;
    return res.confirmed;
  };

  if (!spaceLinksCrawler(space, actor)
    && !(await breakLimit('Not in This Space', `${actor.name} is not in ${space.name}. Train there anyway as a Rule Break?`))) {
    return { success: false, reason: 'not-in-space' };
  }

  let training = resolveTrainingRoomConfig(space);
  if (!training) {
    if (!(await breakLimit('No Training Room', `${space.name} has no Training Room upgrade. Train anyway as a Rule Break?`))) {
      return { success: false, reason: 'no-training-room' };
    }
    // No room: the schema defaults of a training room (one session per 30 hours, 1 hour, no bonus).
    training = { sessionsPerWindow: 1, windowHours: 30, hourCost: 1, rollBonus: 0, advantage: false, dcModifier: 0 };
  }

  if (!trainingAllowsSkill(training, skill)
    && !(await breakLimit('Skill Not Supported by Room', `The training room does not support ${skill.name}. Train anyway as a Rule Break?`))) {
    return { success: false, reason: 'skill-not-allowed' };
  }

  // A closed training route asks with the room's limits, before any hours are spent; the gain below then does not ask it again
  const routeGate = await confirmRouteGain(actor, skill, ADVANCEMENT_ROUTES.training, { options, verb: 'Train' });
  if (!routeGate.ok) return { success: false, reason: 'route-limit' };
  if (routeGate.ruleBreak) ruleBreak = true;

  // The window runs on world time (3.12f): a floor change or a GM timer correction leaves it open.
  const now = currentTimeContext(actor);
  const windowHours = Number(training.windowHours) || 30;
  const sessionsPerWindow = Number.isFinite(Number(training.sessionsPerWindow)) ? Number(training.sessionsPerWindow) : 1;
  const hourCost = Math.max(0, Number.isFinite(Number(training.hourCost)) ? Number(training.hourCost) : 1);
  const rawFlag = typeof actor.getFlag === 'function' ? actor.getFlag(SYSTEM_ID, 'trainingState') : actor.flags?.[SYSTEM_ID]?.trainingState;
  const trainingState = rawFlag ? structuredClone(rawFlag) : { windowExpiresAt: null, sessionsUsedInWindow: 0 };
  if (!isWithinWindow({ expiresAt: trainingState.windowExpiresAt }, now)) {
    trainingState.windowExpiresAt = openWindow(windowHours, now).expiresAt;
    trainingState.sessionsUsedInWindow = 0;
  }
  if ((Number(trainingState.sessionsUsedInWindow) || 0) >= sessionsPerWindow
    && !(await breakLimit('Training Window Limit Exceeded', `Training window limit (${sessionsPerWindow} session(s) per ${windowHours}h) exceeded. Train anyway as a Rule Break?`))) {
    return { success: false, reason: 'window-limit' };
  }

  // A player's hours go through the GM relay, which needs the actor they are spent for.
  if (hourCost > 0) await decrementFloorTimer(hourCost, { actorUuid: actor.uuid });

  const currentRank = Number(skill.system?.rank ?? skill.rank ?? 1);
  const spaceBonus = Number(space.system?.effectiveTrainingAdvancementBonus) || 0;
  const check = await rollAdvancementCheck(actor, skill, {
    bonus: (Number(training.rollBonus) || 0) + spaceBonus,
    advantage: training.advantage === true,
    dcModifier: Number(training.dcModifier) || 0,
    rank: currentRank,
    rollResult: options.rollResult
  });
  let advanced = false;
  let gainResult = null;
  let newRank = currentRank;
  if (check.passed) {
    // The caller's own options only: a Rule Break confirmed for the window does not pre-confirm the cap.
    gainResult = await applyRankGain(actor, skill, { source: 'training', options, routeChecked: routeGate.limited });
    advanced = gainResult.gained;
    if (gainResult.gained) newRank = gainResult.newRank;
    if (gainResult.ruleBreak) ruleBreak = true;
  }

  // What the result card says: a pass that gained nothing (Rank cap, locked, Floor-ranked) is not a failure.
  let outcome = 'fail';
  if (check.passed) outcome = advanced ? 'gain' : (gainResult?.limit === 'limited' || gainResult?.reason === 'floor-ranked' ? 'limited' : 'capped');

  trainingState.sessionsUsedInWindow = (Number(trainingState.sessionsUsedInWindow) || 0) + 1;
  if (typeof actor.setFlag === 'function') {
    await actor.setFlag(SYSTEM_ID, 'trainingState', trainingState);
  } else {
    actor.flags ??= {};
    actor.flags[SYSTEM_ID] ??= {};
    actor.flags[SYSTEM_ID].trainingState = trainingState;
    if (typeof actor.update === 'function') await actor.update({ [`flags.${SYSTEM_ID}.trainingState`]: trainingState });
  }

  if (!options.silent) {
    await postAdvancementCard(actor, {
      skillId: skill.id,
      skillName: skill.name,
      previousRank: currentRank,
      newRank,
      target: check.target,
      rollTotal: check.total,
      formula: check.formula,
      rollMode: check.rollMode,
      outcome,
      ruleBreak,
      note: `Training Room: ${hourCost} hour(s) off the floor clock.`
    });
  }

  return {
    success: true,
    advanced,
    outcome,
    rollTotal: check.total,
    formula: check.formula,
    previousRank: currentRank,
    newRank,
    hoursSpent: hourCost,
    ruleBreak
  };
}
