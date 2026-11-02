import { confirmRuleBreak } from '../../utils/rule-break.mjs';
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
import { decrementFloorTimer } from './actor-environment.mjs';
import { currentTimeContext } from './dungeon-time.mjs';
import { openWindow, isWithinWindow, formatWindow } from '../../utils/time-window.mjs';
import { matchesTagQuery } from '../../utils/tag-query.mjs';
import { getItemAllTags } from '../../data/tags.mjs';
import { findConditionEntry } from '../../content/catalog-lookup.mjs';

/** `flags.sprinter-rpg.restBuff` of the buff a rest in a personal space applies; found by this flag, never by name. */
const WELL_RESTED_KEY = 'wellRested';
/** The Well Rested buff's "+N to all Checks" as a structured roll row (no condition = every check). */
const wellRestedRow = (value) => ({ kind: 'bonus', label: 'Well Rested', value });

export { RELAY_ACTION_PERSONAL_SPACE_LEAVE };

export const RELAY_ACTION_SPACE_STASH = 'personalSpaceStash';

const STASH_REFUSALS = {
  equipped: 'Cannot stash equipped items. Unequip first.',
  full: 'Personal Space stash is full!'
};

/** Stash moves for one space run one at a time (create-then-delete must not interleave); the item is read inside. */
const runStashMove = (space, fn) => runKeyed(`stash:${space?.uuid ?? space?.id}`, fn);

/** Move one item from the crawler into the space vault. Runs where the caller can write both documents. */
async function performDeposit(crawler, space, itemId, { ruleBreak = false } = {}) {
  const item = crawler.items?.get(itemId);
  if (!item) return { ok: false, reason: 'missing' };
  if (item.system?.equipped) return { ok: false, reason: 'equipped' };

  const stashItems = crawler.getPersonalSpaceStashItems(space);
  const maxCapacity = space.system?.effectiveStashCapacity ?? space.system?.stashCapacity ?? 100;
  const over = stashItems.length >= maxCapacity;
  if (over && !ruleBreak) return { ok: false, reason: 'full' };

  const itemData = item.toObject ? item.toObject() : structuredClone(item);
  delete itemData._id;
  delete itemData.id;
  if (over) itemData.flags = { ...itemData.flags, [SYSTEM_ID]: { ...itemData.flags?.[SYSTEM_ID], ruleBreak: true } };

  await space.createEmbeddedDocuments('Item', [itemData]);
  await crawler.deleteEmbeddedDocuments('Item', [item.id]);
  return { ok: true, ruleBreak: over };
}

/** Move one item from the space vault into the crawler. Runs where the caller can write both documents. */
async function performWithdraw(crawler, space, itemId) {
  const item = space.items?.get(itemId);
  if (!item) return { ok: false, reason: 'missing' };

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
    return requester.isGM === true || userOwnsActor(crawler, requester);
  },
  apply: async (payload) => {
    const space = resolveSpace(payload?.spaceUuid);
    const crawler = crawlerDoc(resolveActorByUuid(payload?.crawlerUuid));
    if (!space || crawler?.type !== 'crawler' || !spaceLinksCrawler(space, crawler)) return { ok: false, reason: 'invalid' };
    const itemId = String(payload.itemId ?? '');
    // The requester already passed `authorize`; a confirmed Rule Break is honoured and recorded on the moved item.
    if (payload.mode === 'deposit') return runStashMove(space, () => performDeposit(crawler, space, itemId, { ruleBreak: payload.ruleBreak === true }));
    if (payload.mode === 'withdraw') return runStashMove(space, () => performWithdraw(crawler, space, itemId));
    return { ok: false, reason: 'invalid' };
  }
});

/** Crawler uuids already warned about owning several spaces (once per page load; this runs on every sheet render). */
const warnedMultiOwner = new Set();

const hasRuleBreakFlag = (space) => space?.flags?.[SYSTEM_ID]?.ruleBreak === true;

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
 * Resolves the active training room of a personal space: the highest-tier embedded `space_upgrade` item with
 * `training.enabled` (or the one whose id or identifier is `options.upgradeId`). Reads the stored fields only;
 * the schema initial values are the defaults.
 * @param {Actor} space
 * @param {{ upgradeId?: string }} [options={}]
 * @returns {object|null} the room's `training` fields
 */
export function resolveTrainingRoomConfig(space, options = {}) {
  const itemsList = Array.from(space?.items ?? []);
  const candidates = itemsList.filter(item => item?.type === 'space_upgrade'
    && item.system?.purchased !== false
    && (item.system?.training?.enabled === true
      || Boolean(options.upgradeId && (item.id === options.upgradeId || item.system?.identifier === options.upgradeId))));
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

export const actorSpacesMixin = {


  // =========================================================================
  // PERSONAL SPACES & SAFE ROOM STASH METHODS
  // The personal-space actors are the single source of truth: a crawler stores nothing about them.
  // =========================================================================

  /**
   * The one space this crawler owns (`ownerUuid`). Prefers a space that is not flagged as a rule-break
   * second space. Logs once if several spaces claim this crawler.
   * @returns {COGActor|null}
   */
  getOwnedPersonalSpace() {
    const ref = crawlerRef(this);
    if (!ref) return null;
    const owned = worldSpaces().filter(s => s.system?.ownerUuid === ref);
    if (owned.length > 1 && !warnedMultiOwner.has(ref)) {
      warnedMultiOwner.add(ref);
      console.warn(`Sprinter RPG | ${this.name} owns ${owned.length} personal spaces; a crawler may own only one.`);
    }
    return owned.find(s => !hasRuleBreakFlag(s)) ?? owned[0] ?? null;
  },

  /**
   * Every space this crawler owns or occupies: the owned space first, then the others in directory order.
   * @returns {COGActor[]}
   */
  getLinkedPersonalSpaces() {
    const owned = this.getOwnedPersonalSpace();
    const rest = worldSpaces().filter(s => s !== owned && spaceLinksCrawler(s, this));
    return owned ? [owned, ...rest] : rest;
  },

  /**
   * The space this crawler uses by default: the owned one, else the first space they occupy.
   * @returns {COGActor|null}
   */
  getPersonalSpace() {
    return this.getOwnedPersonalSpace() ?? this.getLinkedPersonalSpaces()[0] ?? null;
  },

  /**
   * Add this crawler to a space as an occupant (and as its owner when the space has none and this crawler
   * owns no other). Needs permission to write the space: its owner or the GM.
   * @param {COGActor|string} spaceOrRef
   * @returns {Promise<boolean>}
   */
  async linkPersonalSpace(spaceOrRef) {
    const space = resolveSpace(spaceOrRef);
    if (!space) return false;
    if (!canWriteSpace(space)) {
      globalThis.ui?.notifications?.warn?.(`Only the owner of ${space.name} or the GM can add occupants.`);
      return false;
    }
    return addCrawlerToSpace(space, this);
  },

  /**
   * Leave a space (default: the owned one). An occupant who doesn't own the space document asks the GM;
   * only the GM can take a space from its owner.
   * @param {COGActor|string|null} [spaceOrRef=null]
   * @returns {Promise<boolean>}
   */
  async unlinkPersonalSpace(spaceOrRef = null) {
    const space = resolveSpace(spaceOrRef) ?? this.getOwnedPersonalSpace();
    if (!space || !spaceLinksCrawler(space, this)) return false;
    const ref = crawlerRef(this);
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
  },

  /**
   * 1-Click Auto-Provisioning: creates a new Personal Space Actor owned by this crawler.
   * A crawler may own only one space; a second needs a Rule Break confirmation.
   * @param {object} [options={}] name, spaceType, ruleBreak and the manual stat overrides
   * @returns {Promise<COGActor|null>} null when declined or when the space could not be created
   */
  async acquirePersonalSpace(options = {}) {
    let opts = options || {};
    const existing = this.getOwnedPersonalSpace();
    if (existing) {
      const res = await confirmRuleBreak({
        title: 'Second Personal Space',
        message: `${this.name} already owns ${existing.name}. A crawler may own only one personal space. Acquire another anyway as a Rule Break?`,
        options: opts
      });
      if (!res.confirmed) return null;
      opts = { ...opts, ruleBreak: true };
    }
    const crawler = crawlerDoc(this);
    const space = await createSpaceForCrawler(crawler, opts);
    if (!space) {
      globalThis.ui?.notifications?.error?.('Could not create the personal space.');
      return null;
    }
    await syncActorOwnership(space, crawler);
    return space;
  },


  /**
   * Executes resting in the crawler's personal space, applying upgrade reductions and perks.
   * @param {string} [restType='long']
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  async restInPersonalSpace(restType = 'long', options = {}) {
    const space = resolveSpace(options.space) ?? this.getPersonalSpace();
    const effectiveRed = space?.system?.effectiveRestHoursReduction ?? 0;
    const effectiveWellRested = space?.system?.effectiveWellRestedBonus ?? 1;
    const bonusBanked = space?.system?.effectiveTrainingBonusHours ?? 0;
    const bonusTempBars = space?.system?.bonusTempBars ?? 0;
    const tempBarsHpPerSlot = space?.system?.tempBarsHpPerSlot ?? 10;
    const purgesInjuries = space?.system?.removesInjuriesOnRest ?? false;

    // Apply rest via actor.rest() with reduced hours and personal space context
    const restResult = await this.rest(restType, {
      ...options,
      space: undefined,
      inPersonalSpace: true,
      spaceName: space?.name || 'Personal Space',
      hoursReduced: effectiveRed,
      purgesInjuries
    });

    // Grant bonus banked grind hours from space training facility
    if (bonusBanked > 0) {
      const currentBank = Number(this.system.details?.bankedGrindHours ?? this.system.bankedGrindHours) || 0;
      const newBank = currentBank + bonusBanked;
      if (this.system.details) this.system.details.bankedGrindHours = newBank;
      this.system.bankedGrindHours = newBank;
      await this.update({ 'system.details.bankedGrindHours': newBank });
    }

    // Grant bonus temporary health bars from medical pod if configured
    if (bonusTempBars > 0 && typeof this.grantTempBars === 'function') {
      await this.grantTempBars({
        count: bonusTempBars,
        hpPerSlot: tempBarsHpPerSlot,
        source: `${space?.name || 'Safe Space'} Med Pod`,
        sourceUuid: space?.uuid || ''
      });
    }

    // Apply / Refresh "Well Rested" buff
    if (effectiveWellRested > 0) {
      const itemsList = Array.from(this.items ?? []);
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
        await this.createEmbeddedDocuments('Item', [buffData]);
      }
    }

    // Buffs the space's installed upgrades grant to whoever rests there: embedded items, never an externalBuffs slot
    const spaceBuffs = [];
    const buffIds = Array.isArray(space?.system?.buffs) ? space.system.buffs : [];
    for (const id of buffIds) {
      if (typeof id !== 'string' || !id) continue;
      const have = Array.from(this.items ?? []).some(i => i.type === 'buff' && i.flags?.[SYSTEM_ID]?.spaceBuff === id);
      if (have) continue;
      const match = findConditionEntry('buffs', id);
      if (!match) {
        console.warn(`${SYSTEM_ID} | ${space?.name || 'Personal space'} grants unknown buff "${id}"; nothing applied`);
        continue;
      }
      await this.createEmbeddedDocuments('Item', [{
        name: match.name,
        type: 'buff',
        img: match.img || 'icons/svg/aura.svg',
        system: structuredClone(match.system || {}),
        flags: { [SYSTEM_ID]: { spaceBuff: id } }
      }]);
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
  },


  /**
   * Retrieves stash items on a personal space, excluding space_upgrade items.
   * @param {Actor|null} [spaceActor=null]
   * @returns {Item[]}
   */
  getPersonalSpaceStashItems(spaceActor = null) {
    const space = spaceActor || this.getPersonalSpace();
    if (!space) return [];
    const itemsList = Array.from(space.items ?? []);
    return itemsList.filter(i => i && i.type !== 'space_upgrade');
  },

  /**
   * Deposits an item from the crawler's inventory into the personal space vault.
   * @param {string} itemId
   * @param {number} [quantity=1]
   * @returns {Promise<boolean>}
   */
  async depositToPersonalSpace(itemId, quantity = 1, options = {}) {
    return moveStashItem(this, 'deposit', itemId, options);
  },


  /**
   * Withdraws an item from the personal space vault into the crawler's inventory.
   * @param {string} itemId
   * @param {number} [quantity=1]
   * @returns {Promise<boolean>}
   */
  async withdrawFromPersonalSpace(itemId, quantity = 1, options = {}) {
    return moveStashItem(this, 'withdraw', itemId, options);
  },

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
  async trainSkillInPersonalSpace(skillOrId, options = {}) {
    const space = resolveSpace(options.space) ?? this.getPersonalSpace();
    if (!space) {
      globalThis.ui?.notifications?.warn?.('No personal space found for training.');
      return { success: false, reason: 'no-space' };
    }

    const items = Array.from(this.items ?? []);
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

    if (!spaceLinksCrawler(space, this)
      && !(await breakLimit('Not in This Space', `${this.name} is not in ${space.name}. Train there anyway as a Rule Break?`))) {
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

    // The window runs on world time (3.12f): a floor change or a GM timer correction leaves it open.
    const now = currentTimeContext(this);
    const windowHours = Number(training.windowHours) || 30;
    const sessionsPerWindow = Number.isFinite(Number(training.sessionsPerWindow)) ? Number(training.sessionsPerWindow) : 1;
    const hourCost = Math.max(0, Number.isFinite(Number(training.hourCost)) ? Number(training.hourCost) : 1);
    const rawFlag = typeof this.getFlag === 'function' ? this.getFlag(SYSTEM_ID, 'trainingState') : this.flags?.[SYSTEM_ID]?.trainingState;
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
    if (hourCost > 0) await decrementFloorTimer(hourCost, { actorUuid: this.uuid });

    const currentRank = Number(skill.system?.rank ?? skill.rank ?? 1);
    const spaceBonus = Number(space.system?.effectiveTrainingAdvancementBonus) || 0;
    const check = await this.rollAdvancementCheck(skill, {
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
      gainResult = await this.applyRankGain(skill, { source: 'training', options });
      advanced = gainResult.gained;
      if (gainResult.gained) newRank = gainResult.newRank;
      if (gainResult.ruleBreak) ruleBreak = true;
    }

    // What the result card says: a pass that gained nothing (Rank cap, locked, Floor-ranked) is not a failure.
    let outcome = 'fail';
    if (check.passed) outcome = advanced ? 'gain' : (gainResult?.limit === 'locked' || gainResult?.reason === 'floor-ranked' ? 'locked' : 'capped');

    trainingState.sessionsUsedInWindow = (Number(trainingState.sessionsUsedInWindow) || 0) + 1;
    if (typeof this.setFlag === 'function') {
      await this.setFlag(SYSTEM_ID, 'trainingState', trainingState);
    } else {
      this.flags ??= {};
      this.flags[SYSTEM_ID] ??= {};
      this.flags[SYSTEM_ID].trainingState = trainingState;
      if (typeof this.update === 'function') await this.update({ [`flags.${SYSTEM_ID}.trainingState`]: trainingState });
    }

    if (!options.silent) {
      await this.postAdvancementCard({
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
};
