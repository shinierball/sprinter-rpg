import { resolveActor } from '../../documents/actor/actor-constants.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { userOwnsActor } from '../../documents/actor/personal-space-links.mjs';
import { getSpaceUpgrade, spaceUpgradeItemData } from '../../data/rules/personal-space-rules.mjs';
import { couponPriceFor, rankPoints, spaceRules, spaceTypeForRank, tableSpacesFor } from '../../data/rules/space-rank-rules.mjs';
import { isCraftingTable } from '../../documents/actor/crafting-tables.mjs';
import { withRuleBreak } from '../../utils/rule-break.mjs';

/**
 * TypeDataModel for Personal Spaces in Sprinter RPG.
 * Encapsulates ownership, co-occupants/tenants, space rank (which sets its type),
 * defense rating, stash storage capacity, rest duration reductions,
 * training facility perks, active upgrade modules, quests/bounties,
 * and outside world communication feeds.
 */
export class PersonalSpaceDataModel extends (globalThis.foundry?.abstract?.TypeDataModel || class {}) {
  /**
   * Helper to retrieve the parent Actor document
   * @type {Actor|null}
   */
  get actor() {
    return this.parent || null;
  }

  /** @override */
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;

    return {
      // UUIDs of the world crawler actors. The owner is also listed in occupantUuids.
      ownerUuid: new fields.StringField({ initial: '' }),
      occupantUuids: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      // The space's rank; its type (stash, defence, mercenary housing) follows the rank (see `spaceTypeForRank`)
      rank: new fields.NumberField({ integer: true, initial: 1, min: 1 }),
      // The spaces this one joined (a group is the connected set over these links in both directions; see `spaceGroup`)
      joinedToUuids: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      defenseRating: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }),
      stashCapacity: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }),
      restHoursReduction: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      wellRestedBonus: new fields.NumberField({ integer: true, initial: 1 }),
      trainingBonusHours: new fields.NumberField({ integer: true, initial: 1, min: 0 }),
      trainingAdvancementBonus: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      quests: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),
      outsideFeed: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),
      details: new fields.SchemaField({
        notes: new fields.StringField({ initial: '' }),
        amenities: new fields.StringField({ initial: '' }),
        security: new fields.StringField({ initial: '' })
      })
    };
  }

  /**
   * The owning crawler (world actor), or null.
   * @returns {Actor|null}
   */
  getOwnerActor() {
    return resolveActorByUuid(this.ownerUuid);
  }

  /**
   * Occupant crawlers that still resolve, in listed order. Dangling uuids are skipped.
   * @returns {Array<Actor>}
   */
  getOccupantActors() {
    const list = Array.isArray(this.occupantUuids) ? this.occupantUuids : [];
    return list.map(uuid => resolveActorByUuid(uuid)).filter(Boolean);
  }

  /** @override */
  prepareBaseData() {
    super.prepareBaseData?.();
    this._rawStashCapacity = this._source?.stashCapacity ?? this.stashCapacity;
    this._rawDefenseRating = this._source?.defenseRating ?? this.defenseRating;
  }

  /** @override */
  prepareDerivedData() {
    const { tag: typeTag, def: typeDef } = spaceTypeForRank(this.rank);
    this.typeInfo = typeDef;
    this.spaceType = typeTag;
    this.typeLabel = typeDef?.label ?? '';

    const rawCap = this._rawStashCapacity !== undefined
      ? this._rawStashCapacity
      : (this._source?.stashCapacity !== undefined ? this._source.stashCapacity : this.stashCapacity);
    const rawDef = this._rawDefenseRating !== undefined
      ? this._rawDefenseRating
      : (this._source?.defenseRating !== undefined ? this._source.defenseRating : this.defenseRating);

    const baseCap = (rawCap !== null && rawCap !== undefined)
      ? Number(rawCap)
      : (Number(typeDef?.baseCapacity) || 100);

    const baseDef = (rawDef !== null && rawDef !== undefined)
      ? Number(rawDef)
      : (Number(typeDef?.baseDefense) || 10);

    const baseMercCap = Number(typeDef?.mercenaryCapacity) || 0;

    // Tally upgrade modifiers
    let hoursRed = Number(this.restHoursReduction) || 0;
    let wellRested = Number(this.wellRestedBonus) || 1;
    let trainHours = Number(this.trainingBonusHours) || 1;
    let trainAdv = Number(this.trainingAdvancementBonus) || 0;
    let extraCap = 0;
    let extraDef = 0;
    let bonusTempBars = 0;
    let tempBarsHpPerSlot = 0;
    let removesInjuries = false;
    let extraMercCap = 0;
    let mercDisc = 0;
    let extraPetCap = 0;
    let extraMountCap = 0;
    const allBuffs = [];

    // Installed upgrades: the embedded space_upgrade items (the only source)
    const actor = this.parent || this.actor;
    const actorItems = Array.from(actor?.items ?? []);
    for (const item of actorItems) {
      if (item?.type !== 'space_upgrade') continue;
      if (item.system?.purchased === false) continue;

      const bonuses = item.system?.bonuses || {};
      if (bonuses.defenseBonus) extraDef += Number(bonuses.defenseBonus) || 0;
      if (bonuses.stashCapacityBonus) extraCap += Number(bonuses.stashCapacityBonus) || 0;
      if (bonuses.restRecoveryBonus) hoursRed += Number(bonuses.restRecoveryBonus) || 0;
      if (bonuses.mercenaryCapacityBonus) extraMercCap += Number(bonuses.mercenaryCapacityBonus) || 0;
      if (bonuses.petCapacityBonus) extraPetCap += Number(bonuses.petCapacityBonus) || 0;
      if (bonuses.mountCapacityBonus) extraMountCap += Number(bonuses.mountCapacityBonus) || 0;
      if (Array.isArray(bonuses.buffs)) {
        for (const b of bonuses.buffs) if (b && !allBuffs.includes(b)) allBuffs.push(b);
      }

      if (bonuses.wellRestedBonus) wellRested += Number(bonuses.wellRestedBonus) || 0;
      if (bonuses.bonusGrindHours) trainHours += Number(bonuses.bonusGrindHours) || 0;
      if (bonuses.advancementBonus) trainAdv += Number(bonuses.advancementBonus) || 0;
      if (bonuses.bonusTempBars) bonusTempBars += Number(bonuses.bonusTempBars) || 0;
      if (bonuses.tempBarsHpPerSlot) tempBarsHpPerSlot = Math.max(tempBarsHpPerSlot, Number(bonuses.tempBarsHpPerSlot) || 0);
      if (bonuses.removesInjuriesOnRest) removesInjuries = true;
      if (bonuses.mercenaryDiscountPct) mercDisc = Math.max(mercDisc, Number(bonuses.mercenaryDiscountPct) || 0);
    }

    const totalStashCap = baseCap + extraCap;
    const totalDefense = baseDef + extraDef;
    const totalMercCap = baseMercCap + extraMercCap;

    this.effectiveRestHoursReduction = Math.min(6, hoursRed); // Cannot reduce 8h rest below 2h
    this.effectiveWellRestedBonus = wellRested;
    this.effectiveTrainingBonusHours = trainHours;
    this.effectiveTrainingAdvancementBonus = trainAdv;
    this.effectiveStashCapacity = totalStashCap;
    this.effectiveDefenseRating = totalDefense;
    this.bonusTempBars = bonusTempBars;
    this.tempBarsHpPerSlot = tempBarsHpPerSlot || 10;
    this.removesInjuriesOnRest = removesInjuries;
    this.effectiveMercenaryCapacity = totalMercCap;
    this.effectiveMercenaryDiscountPct = mercDisc;

    this.stashCapacity = totalStashCap;
    this.defenseRating = totalDefense;
    this.mercenaryCapacity = totalMercCap;
    this.mercenaryDiscountPct = mercDisc;
    this.restRecoveryBonus = hoursRed;
    this.mercenaryCapacityBonus = extraMercCap;
    this.petCapacityBonus = extraPetCap;
    this.mountCapacityBonus = extraMountCap;
    this.buffs = allBuffs;

    // Stash item counts (space_upgrade items are excluded from stash count)
    const stashItems = actorItems.filter(i => i && i.type !== 'space_upgrade');
    this.stashCount = stashItems.length;
    // This space's own tables; the group's room (`roomOf`) is never derived here because it walks other actors
    this.ownTablesUsed = actorItems.filter(i => isCraftingTable(i) && i.system?.purchased !== false).length;
    const rules = spaceRules();
    this.ownTableSpaces = tableSpacesFor(this.rank, rules);
    // What the next rank costs in gold, and what this space is worth when spaces join
    this.rankUpPrice = couponPriceFor(this.rank + 1, rules);
    this.joinPoints = rankPoints(this.rank);
    this.stashFull = this.stashCount >= this.effectiveStashCapacity;
    this.stashPct = Math.min(100, Math.round((this.stashCount / Math.max(1, this.effectiveStashCapacity)) * 100));
  }

  /**
   * The free write of a purchase (`buySpaceUpgrade` pays first): install or activate an upgrade module in this personal space
   * @param {object|string} upgrade - Upgrade definition or upgrade ID
   * @param {{ ruleBreak?: boolean }} [options] `ruleBreak`: a confirmed Rule Break (too many tables, a short purse) is recorded on the item
   * @returns {Promise<Actor>}
   */
  async installUpgrade(upgrade, { ruleBreak = false } = {}) {
    if (!this.actor) return null;
    const upData = typeof upgrade === 'string' ? getSpaceUpgrade(upgrade) : upgrade;
    if (!upData?.id) return null;

    const existing = this._embeddedUpgrade(upData.id);
    if (existing) {
      if (existing.system?.purchased === false) await existing.update({ 'system.purchased': true });
      return this.actor;
    }
    const data = spaceUpgradeItemData(upData);
    if (ruleBreak) data.flags = withRuleBreak(data).flags;
    await this.actor.createEmbeddedDocuments('Item', [data]);
    return this.actor;
  }

  /**
   * Uninstall an upgrade: delete its embedded `space_upgrade` item.
   * @param {string} upgradeId the catalog id, which is the item's identifier
   * @returns {Promise<Actor>}
   */
  async uninstallUpgrade(upgradeId) {
    if (!this.actor) return null;
    const item = this._embeddedUpgrade(upgradeId);
    if (item) await this.actor.deleteEmbeddedDocuments('Item', [item.id]);
    return this.actor;
  }

  /** The embedded space_upgrade item installed from catalog id `id`, if any. */
  _embeddedUpgrade(id) {
    return Array.from(this.actor?.items ?? []).find(i => i?.type === 'space_upgrade' && i.system?.identifier === id) ?? null;
  }

  /**
   * Add a quest / bounty to the space terminal
   * @param {object} questData
   * @returns {Promise<Actor>}
   */
  async addQuest(questData = {}) {
    if (!this.actor) return null;
    const quest = {
      id: questData.id || `quest-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title: questData.title || 'Floor Contract',
      source: questData.source || 'Floor Job Board',
      reward: questData.reward || '100 Gold',
      description: questData.description || '',
      patron: String(questData.patron ?? ''),
      completed: Boolean(questData.completed),
      createdAt: new Date().toISOString()
    };
    const quests = Array.isArray(this.quests) ? structuredClone(this.quests) : [];
    quests.push(quest);
    return this.actor.update({ 'system.quests': quests });
  }

  /**
   * Toggle completion status of a quest
   * @param {string} questId
   * @returns {Promise<Actor>}
   */
  async toggleQuestComplete(questId) {
    if (!this.actor) return null;
    const quests = Array.isArray(this.quests) ? structuredClone(this.quests) : [];
    const target = quests.find(q => q.id === questId);
    if (target) {
      target.completed = !target.completed;
      return this.actor.update({ 'system.quests': quests });
    }
    return null;
  }

  /**
   * Add an outside world broadcast or fan mail message
   * @param {object} messageData
   * @returns {Promise<Actor>}
   */
  async addFeedMessage(messageData = {}) {
    if (!this.actor) return null;
    const msg = {
      id: messageData.id || `feed-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      channel: messageData.channel || 'Universal TV',
      title: messageData.title || 'Broadcast Highlight',
      message: messageData.message || '',
      timestamp: messageData.timestamp || new Date().toISOString()
    };
    const feed = Array.isArray(this.outsideFeed) ? structuredClone(this.outsideFeed) : [];
    feed.unshift(msg);
    return this.actor.update({ 'system.outsideFeed': feed });
  }

  /**
   * Retrieves all mercenary actors housed in this personal space's barracks.
   * @returns {Array<Actor>}
   */
  getHousedMercenaries() {
    if (!this.actor) return [];
    const worldActors = globalThis.game?.actors ? Array.from(globalThis.game.actors.values()) : [];
    return worldActors.filter(a => a.type === 'mercenary' && a.system?.details?.housedSpaceId === this.actor.id);
  }

  /**
   * Retrieves all NPC actors housed in this personal space's barracks.
   * @returns {Array<Actor>}
   */
  getHousedNpcs() {
    if (!this.actor) return [];
    const worldActors = globalThis.game?.actors ? Array.from(globalThis.game.actors.values()) : [];
    return worldActors.filter(a => a.type === 'npc' && a.system?.details?.housedSpaceId === this.actor.id);
  }

  /**
   * Houses a mercenary in this safe space's barracks between levels.
   * @param {Actor|string} mercenary
   * @returns {Promise<boolean>}
   */
  async houseMercenary(mercenary) {
    return this.#changeHousing(mercenary, 'mercenary', 'house');
  }

  /**
   * Removes a mercenary from this space's barracks back to field status.
   * @param {Actor|string} mercenary
   * @returns {Promise<boolean>}
   */
  async unhouseMercenary(mercenary) {
    return this.#changeHousing(mercenary, 'mercenary', 'unhouse');
  }

  /**
   * Houses an allied NPC in this safe space's barracks between levels.
   * @param {Actor|string} npc
   * @returns {Promise<boolean>}
   */
  async houseNpc(npc) {
    return this.#changeHousing(npc, 'npc', 'house');
  }

  /**
   * Removes an allied NPC from this space's barracks.
   * @param {Actor|string} npc
   * @returns {Promise<boolean>}
   */
  async unhouseNpc(npc) {
    return this.#changeHousing(npc, 'npc', 'unhouse');
  }

  /**
   * Housing writes `housedSpaceId` on the housed actor, which a player may not own. The GM or the housed
   * actor's owner writes locally; anyone else asks the GM through the relay.
   */
  async #changeHousing(target, type, mode) {
    if (!this.actor) return false;
    const actor = typeof target === 'string' ? resolveActor(target) : target;
    if (!actor || (mode === 'house' && actor.type !== type)) return false;
    const payload = { spaceUuid: this.actor.uuid, actorUuid: actor.uuid, mode };
    const user = globalThis.game?.user;
    const direct = Boolean(user?.isGM || userOwnsActor(actor, user));
    const reply = await requestRelay(RELAY_ACTION_BARRACKS_HOUSING, payload, { direct });
    if (!reply.ok) return false;
    return reportHousing(reply.result);
  }
}

const RELAY_ACTION_BARRACKS_HOUSING = 'barracksHousing';

const HOUSEABLE_TYPES = ['mercenary', 'npc'];

function reportHousing(result) {
  if (result?.reason === 'capacity') {
    globalThis.ui?.notifications?.warn('Barracks capacity full! Upgrade your space barracks to house more retainers.');
  }
  if (result?.reason === 'not-persisted') {
    globalThis.ui?.notifications?.error('Housing change was not saved on the actor.');
  }
  return result?.ok === true;
}

/**
 * Recompute and perform one housing change from uuids. Runs on the GM client or locally for the housed
 * actor's owner. Capacity is a soft limit reported to the caller; it is never enforced past the warning.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function applyHousing({ spaceUuid, actorUuid, mode }) {
  const space = resolveActorByUuid(spaceUuid);
  const actor = resolveActorByUuid(actorUuid);
  if (space?.type !== 'personal_space' || !HOUSEABLE_TYPES.includes(actor?.type)) return { ok: false, reason: 'invalid' };
  if (mode === 'house') {
    const model = space.system;
    const housed = model.getHousedMercenaries().length + model.getHousedNpcs().length;
    const capacity = Number(model.effectiveMercenaryCapacity ?? model.mercenaryCapacity) || 0;
    if (housed >= capacity) return { ok: false, reason: 'capacity' };
    await actor.update(actor.type === 'mercenary'
      ? { 'system.details.housedSpaceId': space.id, 'system.details.housingStatus': 'barracks' }
      : { 'system.details.housedSpaceId': space.id });
    // The write is dropped when the actor's schema lacks the field; never report that as success.
    if (actor.system?.details?.housedSpaceId !== space.id) return { ok: false, reason: 'not-persisted' };
    return { ok: true };
  }
  if (mode !== 'unhouse') return { ok: false, reason: 'invalid' };
  await actor.update(actor.type === 'mercenary'
    ? { 'system.details.housedSpaceId': '', 'system.details.housingStatus': actor.system?.details?.hired ? 'field' : 'available' }
    : { 'system.details.housedSpaceId': '' });
  if (actor.system?.details?.housedSpaceId) return { ok: false, reason: 'not-persisted' };
  return { ok: true };
}

registerRelayAction(RELAY_ACTION_BARRACKS_HOUSING, {
  authorize: (payload, user) => {
    if (!user) return false;
    if (user.isGM) return true;
    const space = resolveActorByUuid(payload?.spaceUuid);
    const actor = resolveActorByUuid(payload?.actorUuid);
    if (space?.type !== 'personal_space' || !HOUSEABLE_TYPES.includes(actor?.type)) return false;
    if (payload.mode === 'house') return userOwnsActor(space, user);
    if (payload.mode !== 'unhouse') return false;
    if (userOwnsActor(actor, user)) return true;
    // A space owner may only evict from their own barracks.
    return userOwnsActor(space, user) && actor.system?.details?.housedSpaceId === space.id;
  },
  apply: applyHousing
});
