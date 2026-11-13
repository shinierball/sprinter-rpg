import { contentRegistry } from '../content/registry.mjs';
import { COGStashApp } from '../apps/stash-app.mjs';
import { COGCraftingApp } from '../apps/crafting-app.mjs';
import { COGGrindApp } from '../apps/grind-app.mjs';
import { resolveTrainingRoomConfig, trainingAllowsSkill, trainingWindowLabel } from '../documents/actor/actor-spaces.mjs';
import { ADVANCEMENT_ROUTES, routeAllowsGain } from '../utils/skill/advancement-routes.mjs';
import { currentTimeContext } from '../documents/actor/dungeon-time.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';
import { unopenedBoxUnits } from '../documents/actor/loot-box-open.mjs';
import { removeCrawlerFromSpace, resolveSpace, spaceMembers, userOwnsActor, worldCrawlers, worldSpaces } from '../documents/actor/personal-space-links.mjs';
import { joinedLinks, spaceGroup } from '../documents/actor/space-group.mjs';
import { applyTableCoupon, buyTableTier, isCraftingTable, isStudio, tableCoupons } from '../documents/actor/crafting-tables.mjs';
import { tableTierParts } from '../utils/item-describer/blocks-crafting.mjs';
import { getCurrentFloor } from '../utils/floor/current-floor.mjs';
import { tablePayer } from './item/actions-blueprint.mjs';
import { detachSpaces, joinProblemLabel, joinSpace, mayDetachSpaces, mayJoinSpace } from '../documents/actor/space-join.mjs';
import { sameParty } from '../utils/combat/party.mjs';
import { roomOf, confirmRoomFor, stampTableRuleBreaks, confirmStudioFor, stampStudioRuleBreaks } from '../documents/actor/space-room.mjs';
import { couponPriceFor, spaceRules } from '../data/rules/space-rank-rules.mjs';
import { buySpaceUpgrade, buyTable, rankUpSpace, spaceCoupons, spacePayers, tableTypeOptions } from '../documents/actor/space-purchases.mjs';
import { COGActorSheetV2 } from './base/actor-sheet-v2.mjs';
import { COGRaceClassApplier } from '../data/race-class-applier.mjs';
import { isRuleBreak, ruleBreakReasonOf } from '../utils/rule-break.mjs';

/**
 * Dedicated Sheet Controller for Personal Spaces in Sprinter RPG.
 * Provides specialized tabs for:
 * - Stash Vault & Item Storage
 * - Rest & Recovery Station
 * - Skill & Spell Training Facilities
 * - Job & Quest Terminal
 * - Outside World Broadcast Feeds
 * - Upgrades & Amenities Catalog
 * - Barracks & Retainer Housing
 * - Space Settings & Co-Tenants
 */
const PARTIAL = `${SYSTEM_PATH}/templates/actors/personal-space`;
const tabPart = (id) => ({ template: `${PARTIAL}/${id}.hbs`, scrollable: [''] });

/** The "Paid by" value that means a free GM grant. */
const GM_GRANT = 'gm';

/** The purchase controls a member of the space uses even on a view-only sheet (the purchase itself checks the payer). */
const MEMBER_ACTIONS = ['rankUp', 'buyTable', 'buyUpgrade', 'joinSpace', 'detachSpace', 'buyGroupTableTier', 'applyGroupTableCoupon'];

/** An item description as HTML for a list row (descriptions are HTML fields). */
const enrichDescription = (item) => globalThis.foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system?.description ?? '', { relativeTo: item, secrets: item.isOwner });

export class COGPersonalSpaceSheet extends COGActorSheetV2 {
  /** The "Paid by" choice: a crawler uuid or GM_GRANT; '' until chosen (the first payer then pays). */
  #payerUuid = '';

  static DEFAULT_OPTIONS = {
    classes: ['personal-space'],
    position: { width: 820, height: 840 },
    actions: {
      openStash: COGPersonalSpaceSheet.#onOpenStash,
      openCraftingApp: COGPersonalSpaceSheet.#onOpenCrafting,
      withdrawItem: COGPersonalSpaceSheet.#onWithdrawItem,
      restInSpace: COGPersonalSpaceSheet.#onRestInSpace,
      launchGrind: COGPersonalSpaceSheet.#onLaunchGrind,
      trainSkill: COGPersonalSpaceSheet.#onTrainSkill,
      buyUpgrade: COGPersonalSpaceSheet.#onBuyUpgrade,
      rankUp: COGPersonalSpaceSheet.#onRankUp,
      buyTable: COGPersonalSpaceSheet.#onBuyTable,
      setPayer: COGPersonalSpaceSheet.#onSetPayer,
      buyGroupTableTier: COGPersonalSpaceSheet.#onBuyGroupTableTier,
      applyGroupTableCoupon: COGPersonalSpaceSheet.#onApplyGroupTableCoupon,
      uninstallUpgrade: COGPersonalSpaceSheet.#onUninstallUpgrade,
      toggleQuest: COGPersonalSpaceSheet.#onToggleQuest,
      addQuest: COGPersonalSpaceSheet.#onAddQuest,
      addFeedMessage: COGPersonalSpaceSheet.#onAddFeedMessage,
      houseMercenary: COGPersonalSpaceSheet.#onHouseMercenary,
      unhouseMercenary: COGPersonalSpaceSheet.#onUnhouseMercenary,
      houseNpc: COGPersonalSpaceSheet.#onHouseNpc,
      unhouseNpc: COGPersonalSpaceSheet.#onUnhouseNpc,
      openGuild: COGPersonalSpaceSheet.#onOpenGuild,
      addOccupant: COGPersonalSpaceSheet.#onAddOccupant,
      removeOccupant: COGPersonalSpaceSheet.#onRemoveOccupant,
      leaveSpace: COGPersonalSpaceSheet.#onLeaveSpace,
      openLootBoxes: COGPersonalSpaceSheet.#onOpenLootBoxes,
      joinSpace: COGPersonalSpaceSheet.#onJoinSpace,
      detachSpace: COGPersonalSpaceSheet.#onDetachSpace
    }
  };

  static TABS = {
    primary: {
      initial: 'vault',
      tabs: [
        { id: 'vault', label: 'Stash Vault', icon: 'fa-solid fa-vault' },
        { id: 'rest', label: 'Rest & Recovery', icon: 'fa-solid fa-bed' },
        { id: 'training', label: 'Training Gym', icon: 'fa-solid fa-dumbbell' },
        { id: 'quests', label: 'Jobs & Quests', icon: 'fa-solid fa-clipboard-list' },
        { id: 'feed', label: 'Outside World', icon: 'fa-solid fa-satellite-dish' },
        { id: 'upgrades', label: 'Upgrades', icon: 'fa-solid fa-screwdriver-wrench' },
        { id: 'barracks', label: 'Barracks', icon: 'fa-solid fa-person-military-pointing' },
        { id: 'settings', label: 'Settings', icon: 'fa-solid fa-gear' }
      ]
    }
  };

  static PARTS = {
    header: { template: `${PARTIAL}/header.hbs` },
    tabs: { template: `${SYSTEM_PATH}/templates/shared/tab-nav.hbs` },
    vault: tabPart('vault'),
    rest: tabPart('rest'),
    training: tabPart('training'),
    quests: tabPart('quests'),
    feed: tabPart('feed'),
    upgrades: tabPart('upgrades'),
    barracks: tabPart('barracks'),
    settings: tabPart('settings')
  };

  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    context.isPersonalSpace = true;

    // Primary owner crawler and co-tenants (crawler uuids)
    const owner = resolveActorByUuid(sys.ownerUuid);
    context.owner = owner ? {
      uuid: owner.uuid,
      name: owner.name,
      img: owner.img || 'icons/svg/mystery-man.svg'
    } : null;

    const user = globalThis.game?.user;
    const members = spaceMembers(actor);
    // Only the GM takes a space away from its owner; every other row can be removed by the space's owner.
    const row = (uuid, crawler) => {
      const isOwner = uuid === sys.ownerUuid;
      const removable = !isOwner || Boolean(user?.isGM);
      return {
        uuid,
        name: crawler?.name ?? 'Missing crawler',
        img: crawler?.img || 'icons/svg/mystery-man.svg',
        isOwner,
        missing: !crawler,
        canRemove: this.isEditable && removable,
        canLeave: Boolean(crawler) && removable && userOwnsActor(crawler, user)
      };
    };
    context.occupants = [
      ...members.occupants.map(c => row(c.uuid, c)),
      ...members.missing.map(uuid => row(uuid, null))
    ];
    // 7.3d: one "Open loot boxes (N)" button per linked crawler this user owns that holds unopened boxes.
    context.lootBoxOpeners = members.occupants
      .filter(c => userOwnsActor(c, user))
      .map(c => ({ uuid: c.uuid, name: c.name, units: unopenedBoxUnits(c) }))
      .filter(c => c.units > 0);
    context.availableOccupants = this.isEditable ? this.#availableOccupants(members) : [];
    context.ruleBreak = isRuleBreak(actor);
    context.ruleBreakReason = ruleBreakReasonOf(actor) || 'Acquired as a Rule Break';

    // Space type & capacity info
    context.typeInfo = sys.typeInfo;
    // The rank is the GM's to edit; a player ranks up by Rank Up
    context.isGM = Boolean(user?.isGM);

    // Categorized stashed items
    const allItems = Array.from(actor.items);
    // Installed space upgrades are not stashed items (they are listed on the Upgrades tab).
    const itemsList = allItems.filter(i => i.type !== 'space_upgrade');

    context.stashedItems = {
      all: itemsList,
      weapons: itemsList.filter(i => i.type === 'attack' || i.system?.isWeapon),
      gear: itemsList.filter(i => i.type === 'gear' && !i.system?.isWeapon),
      loot: itemsList.filter(i => i.type === 'loot')
    };

    // Stash capacity status
    const currentCount = itemsList.length;
    const maxCapacity = Number(sys.effectiveStashCapacity ?? sys.stashCapacity) || 100;
    const capPct = Math.min(100, Math.round((currentCount / maxCapacity) * 100));
    context.stashStats = {
      count: currentCount,
      max: maxCapacity,
      pct: capPct,
      isFull: currentCount >= maxCapacity,
      color: capPct >= 100 ? 'var(--cog-danger)' : (capPct >= 80 ? 'var(--cog-warning)' : 'var(--cog-success)')
    };

    // Table room of the space's group (negative `left` = over room, shown red)
    const tables = roomOf(this.actor);
    context.tableRoom = { used: tables.used, spaces: tables.spaces, over: tables.left < 0, grouped: tables.members.length > 1 };
    const i18n = globalThis.game?.i18n;
    const groupData = { rank: tables.rank, count: tables.members.length };
    context.group = {
      grouped: tables.members.length > 1,
      ...groupData,
      label: i18n?.has?.('COG.SpaceRoom.GroupLine') && typeof i18n.format === 'function' ? i18n.format('COG.SpaceRoom.GroupLine', groupData) : `Group rank ${groupData.rank}, ${groupData.count} spaces`
    };
    context.joining = this.#joiningContext(tables.members);

    // Upgrades: installed vs available
    const installedList = await Promise.all(allItems
      .filter(i => i.type === 'space_upgrade' && i.system?.purchased !== false)
      .map(async i => ({
        id: i.system.identifier || i.id,
        name: i.name,
        descriptionHtml: await enrichDescription(i),
        tier: i.system.tier,
        isCraftingTable: i.system?.craftingTable?.enabled === true
      })));
    const installedIds = new Set(installedList.map(u => u.id));

    context.installedUpgrades = installedList;
    context.purchase = this.#purchaseContext();
    context.groupUpgrades = await this.#groupUpgradesContext(tables.members, context.purchase.canPurchase);
    context.availableUpgrades = contentRegistry.getSpaceUpgrades().filter(u => !installedIds.has(u.id))
      .map(u => ({ ...u, buyLabel: this.#buyLabel(u.cost) }));

    // Quests & Terminal
    context.quests = Array.isArray(sys.quests) ? sys.quests : [];
    context.outsideFeed = Array.isArray(sys.outsideFeed) ? sys.outsideFeed : [];

    // Rest speed calculations
    const reduction = Number(sys.effectiveRestHoursReduction) || 0;
    context.restHours = Math.max(1, 8 - reduction);
    context.hasRestReduction = reduction > 0;

    // Barracks & Retainer Housing
    const housedMercs = sys.getHousedMercenaries();
    const housedNpcs = sys.getHousedNpcs();
    const mercCapacity = Number(sys.effectiveMercenaryCapacity ?? sys.mercenaryCapacity) || 0;
    const housedTotal = housedMercs.length + housedNpcs.length;

    context.barracks = {
      capacity: mercCapacity,
      housedCount: housedTotal,
      isFull: housedTotal >= mercCapacity,
      hasBarracks: mercCapacity > 0,
      discountPct: Number(sys.effectiveMercenaryDiscountPct ?? sys.mercenaryDiscountPct) || 0,
      mercenaries: housedMercs.map(m => ({
        id: m.id,
        name: m.name,
        img: m.img || 'icons/svg/mystery-man.svg',
        race: COGRaceClassApplier.definitionLabel('race', m.system?.details?.race || 'human', { actor: m }),
        class: m.system?.details?.class || 'Bruiser',
        role: m.system?.details?.role || 'DPS',
        level: m.system?.details?.level || 1,
        dailyRate: m.system?.details?.dailyRate || 25,
        effectiveDailyRate: m.system?.effectiveDailyRate || 25
      })),
      npcs: housedNpcs.map(n => ({
        id: n.id,
        name: n.name,
        img: n.img || 'icons/svg/mystery-man.svg',
        level: n.system?.details?.level || 1,
        notes: n.system?.details?.notes || ''
      }))
    };

    // Available unhoused mercenaries and NPCs that can be housed
    const worldActors = globalThis.game?.actors ? Array.from(globalThis.game.actors.values()) : [];
    context.availableForHousing = {
      mercenaries: worldActors.filter(a => a.type === 'mercenary' && !a.system?.details?.housedSpaceId),
      npcs: worldActors.filter(a => a.type === 'npc' && !a.system?.details?.housedSpaceId)
    };

    // Training room: the viewing user's crawler in this space picks one of its skills to train here. Skills the room
    // does not support are listed after the others, labelled: training one asks for a Rule Break.
    const room = resolveTrainingRoomConfig(actor);
    const trainee = spaceMembers(actor).occupants.find(c => userOwnsActor(c, user));
    const traineeSkills = trainee
      ? Array.from(trainee.items ?? []).filter(i => i.type === 'skill').map(i => {
        const allowed = trainingAllowsSkill(room, i) && routeAllowsGain(i, ADVANCEMENT_ROUTES.training);
        const rank = Number(i.system?.rank) || 0;
        return { id: i.id, name: i.name, rank, allowed, label: `${i.name} (Rank ${rank})${allowed ? '' : ' (Rule Break)'}` };
      })
      : [];
    traineeSkills.sort((a, b) => Number(b.allowed) - Number(a.allowed));
    context.training = {
      hasRoom: Boolean(room),
      sessions: room?.sessionsPerWindow,
      windowHours: room?.windowHours,
      windowRemaining: trainee ? trainingWindowLabel(trainee, currentTimeContext(trainee)) : '',
      hourCost: room?.hourCost,
      rollBonus: room?.rollBonus,
      advantage: Boolean(room?.advantage),
      crawlerName: trainee?.name ?? '',
      skills: traineeSkills
    };

    // Tab labels carry live counts (the shared nav part renders `tab.label`)
    context.tabs.vault.label = `Stash Vault (${context.stashStats.count})`;
    context.tabs.quests.label = `Jobs & Quests (${context.quests.length})`;
    context.tabs.upgrades.label = `Upgrades (${context.installedUpgrades.length})`;
    context.tabs.barracks.label = `Barracks (${context.barracks.housedCount}/${context.barracks.capacity})`;

    return context;
  }

  /** The payer for a purchase: the chosen crawler, or null for a GM grant. `undefined` when this user has none to pay with. */
  #payer() {
    const user = globalThis.game?.user;
    const payers = spacePayers(this.actor, user);
    if (user?.isGM && this.#payerUuid === GM_GRANT) return null;
    const chosen = payers.find(c => c.uuid === this.#payerUuid) ?? payers[0];
    if (chosen) return chosen;
    if (user?.isGM) return null;
    globalThis.ui?.notifications?.warn?.(globalThis.game?.i18n?.localize?.('COG.SpacePurchase.NoPayer') ?? 'No crawler to pay with.');
    return undefined;
  }

  /**
   * The tables and studios of the other spaces in this space's group: shown read-only, each table with
   * Craft here and the tier buttons, so a member who cannot open the other space still reaches them.
   * @param {Actor[]} members the group's spaces
   * @param {boolean} canPurchase whether this user has a payer (only then are the coupons counted)
   */
  async #groupUpgradesContext(members, canPurchase) {
    const i18n = globalThis.game?.i18n;
    const t = (key, data) => (i18n?.has?.(key) && typeof i18n.format === 'function' ? i18n.format(key, data) : key);
    const others = members.filter(m => m !== this.actor && m.uuid !== this.actor.uuid);
    const floor = getCurrentFloor();
    const rows = [];
    for (const space of others) {
      for (const item of space.items ?? []) {
        if (item.system?.purchased === false || !(isCraftingTable(item) || isStudio(item))) continue;
        const table = isCraftingTable(item);
        const payer = table && canPurchase ? this.#tierPayer(item, { quiet: true }) : null;
        const ct = item.system.craftingTable ?? {};
        rows.push({
          spaceUuid: space.uuid,
          itemId: item.id,
          name: item.name,
          fromLabel: t('COG.SpaceRoom.FromSpace', { space: space.name }),
          descriptionHtml: await enrichDescription(item),
          isCraftingTable: table,
          tierBadge: table ? t('COG.CraftSheet.Table.TierBadge', { tier: tableTierParts(ct, floor).tier }) : '',
          buyTierLabel: table ? t('COG.CraftSheet.Table.Buy', { cost: Math.max(0, Math.floor(Number(ct.upgradeCostGold) || 0)).toLocaleString() }) : '',
          coupons: payer ? tableCoupons(payer).length : 0
        });
      }
    }
    for (const row of rows) row.couponLabel = row.coupons ? t('COG.CraftSheet.Table.Coupon', { count: row.coupons }) : '';
    return rows;
  }

  /** A table of the group from a row's `data-space-uuid` and `data-item-id`; null when it is not in this space's group. */
  #groupTable(target) {
    const space = resolveSpace(target?.dataset?.spaceUuid);
    if (!space || !spaceGroup(this.actor).members.some(m => m === space || m.uuid === space.uuid)) return null;
    const table = space.items?.get(target.dataset.itemId);
    return isCraftingTable(table) ? table : null;
  }

  /** Who pays for a tier of a group table: the Paid by crawler; with the GM grant chosen, the table's own space owner (tiers are never free). */
  #tierPayer(table, { quiet = false } = {}) {
    const user = globalThis.game?.user;
    if (user?.isGM && this.#payerUuid === GM_GRANT) return tablePayer(table);
    const chosen = spacePayers(this.actor, user).find(c => c.uuid === this.#payerUuid) ?? spacePayers(this.actor, user)[0];
    if (chosen) return chosen;
    if (user?.isGM) return tablePayer(table);
    if (!quiet) globalThis.ui?.notifications?.warn?.(globalThis.game?.i18n?.localize?.('COG.SpacePurchase.NoPayer') ?? 'No crawler to pay with.');
    return null;
  }

  /** Buy one tier for a table of a joined space, paid by the Paid by crawler (written through the relay when this user cannot write that space). */
  static async #onBuyGroupTableTier(event, target) {
    const table = this.#groupTable(target);
    const payer = table && this.#tierPayer(table);
    if (!payer) return;
    this.#reportPurchase(await buyTableTier(table, payer));
    return this.render();
  }

  /** Spend one of the Paid by crawler's table coupons on a table of a joined space. */
  static async #onApplyGroupTableCoupon(event, target) {
    const table = this.#groupTable(target);
    const payer = table && this.#tierPayer(table);
    if (!payer) return;
    this.#reportPurchase(await applyTableCoupon(table, payer));
    return this.render();
  }

  /** A catalog Buy button's text. */
  #buyLabel(cost) {
    const i18n = globalThis.game?.i18n;
    const price = Number(cost || 0).toLocaleString();
    return i18n?.has?.('COG.SpacePurchase.Buy') && typeof i18n.format === 'function' ? i18n.format('COG.SpacePurchase.Buy', { price }) : `Buy (${price} gold)`;
  }

  /** The Upgrades tab's purchase controls: who pays, the Rank Up with its coupons, the table types and the catalog prices. */
  #purchaseContext() {
    const user = globalThis.game?.user;
    const i18n = globalThis.game?.i18n;
    const t = (key, data) => (i18n?.has?.(key) && typeof i18n.format === 'function' ? i18n.format(key, data) : key);
    const payer = this.#payer();
    const payers = spacePayers(this.actor, user).map(c => ({ uuid: c.uuid, name: c.name, selected: payer === c }));
    if (user?.isGM) payers.push({ uuid: GM_GRANT, name: t('COG.SpacePurchase.GMGrant'), selected: payer === null });
    const rules = spaceRules();
    const target = (Number(this.actor.system.rank) || 1) + 1;
    const price = couponPriceFor(target, rules).toLocaleString();
    const coupons = payer ? spaceCoupons(payer).map(c => ({ id: c.id, name: c.name })) : [];
    return {
      canPurchase: payer !== undefined,
      payers,
      rankUp: {
        label: t('COG.SpacePurchase.RankUp', { rank: target, price }),
        coupons,
        hasCoupons: coupons.length > 0,
        payGoldLabel: t('COG.SpacePurchase.PayGold', { price })
      },
      tableTypes: tableTypeOptions(),
      buyTableLabel: t('COG.SpacePurchase.BuyTableButton', { price: rules.newTablePrice.toLocaleString() })
    };
  }

  /**
   * Crawlers the owner can add: those the user can see, every user's assigned character (the player list
   * already shows those names), and crawlers in the space owner's party (non-empty `details.party` match),
   * minus the ones already in the space. Sorted by name.
   */
  #availableOccupants(members) {
    const user = globalThis.game?.user;
    const taken = new Set([...members.occupants.map(c => c.uuid), ...members.missing]);
    const users = globalThis.game?.users;
    const userList = Array.from(users?.values() ?? []);
    const characters = new Set(userList.map(u => u?.character?.uuid).filter(Boolean));
    return worldCrawlers()
      .filter(c => !taken.has(c.uuid)
        && (characters.has(c.uuid) || this.#canSee(c, user) || sameParty(c, members.owner)))
      .map(c => ({ uuid: c.uuid, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The Settings tab's joined spaces: the spaces linked to this one in either direction (each with Detach when this user may),
   * and the spaces this one could join (each with any rule the join would break), with the connector price.
   */
  #joiningContext(members) {
    const actor = this.actor;
    const user = globalThis.game?.user;
    const mine = new Set(joinedLinks(actor));
    const linked = worldSpaces().filter(s => s !== actor && (mine.has(s.uuid) || joinedLinks(s).includes(actor.uuid)));
    const inGroup = new Set(members.map(m => m.uuid));
    const price = Number(spaceRules().connectorPrice).toLocaleString();
    const i18n = globalThis.game?.i18n;
    return {
      linked: linked.map(s => ({ uuid: s.uuid, name: s.name, rank: s.system?.rank, canDetach: mayDetachSpaces(actor, s, user) })),
      canJoin: mayJoinSpace(actor, user),
      options: worldSpaces()
        .filter(s => s !== actor && !inGroup.has(s.uuid) && this.#canSee(s, user))
        .map(s => ({ uuid: s.uuid, name: s.name, note: joinProblemLabel(actor, s) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      priceLabel: i18n?.has?.('COG.SpaceJoin.Connector') && typeof i18n.format === 'function' ? i18n.format('COG.SpaceJoin.Connector', { price }) : `Connector ${price} gold`
    };
  }

  #canSee(actor, user) {
    if (user?.isGM) return true;
    if (typeof actor.testUserPermission === 'function') return Boolean(actor.testUserPermission(user, 'LIMITED'));
    return Number(actor.ownership?.[user?.id] ?? actor.ownership?.default ?? 0) >= 1;
  }

  /**
   * The crawler this user acts for in the space: the first member (space owner first) the user owns, so a
   * player never writes a crawler they do not own. Null when the user owns none; the GM gets the owner.
   */
  #owner() {
    const user = globalThis.game?.user;
    const mine = spaceMembers(this.actor).occupants.find(c => userOwnsActor(c, user));
    if (mine) return mine;
    globalThis.ui?.notifications?.warn?.(`You do not own a crawler in ${this.actor.name}.`);
    return null;
  }

  /**
   * @override A user who lost access to the space (left it; the GM relay then revoked their ownership) gets the sheet
   * closed instead of re-rendered: Foundry would refuse the render with an "insufficient permission" warning on every update.
   */
  async render(...args) {
    const actor = this.actor;
    if (actor && !this.#canSee(actor, globalThis.game?.user)) {
      if (this.rendered) await this.close({ force: true });
      return this;
    }
    return super.render(...args);
  }

  /** @override An observer cannot edit the sheet, but can still leave (the one control they use here). */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Anyone with a crawler in the space leaves, uses the stash and rests from here, even with view-only access.
    const mine = spaceMembers(this.actor).occupants.some(c => userOwnsActor(c, globalThis.game?.user));
    const always = mine ? ['leaveSpace', 'openStash', 'openCraftingApp', 'withdrawItem', 'restInSpace', 'openLootBoxes', ...MEMBER_ACTIONS] : ['leaveSpace'];
    for (const action of always) {
      for (const button of this.element?.querySelectorAll?.(`[data-action="${action}"]`) ?? []) button.disabled = false;
    }
    // The purchase controls: who pays, the coupon choice and the table type work from a view-only sheet too.
    if (mine) {
      for (const selector of ['[data-change-action="setPayer"]', '.cog-rank-coupon', '.cog-table-type']) {
        for (const control of this.element?.querySelectorAll?.(selector) ?? []) control.disabled = false;
      }
    }
  }

  /** @override Dropping a crawler adds it to the space; anything else keeps the base behaviour. */
  async _onDropActor(event, actor) {
    if (!this.isEditable) return null;
    if (actor?.type !== 'crawler') return super._onDropActor(event, actor);
    await actor.linkPersonalSpace(this.actor);
    return actor;
  }

  static async #onOpenStash(event, target) {
    const crawler = this.#owner();
    if (crawler) new COGStashApp({ crawler, space: this.actor }).render({ force: true });
  }

  /** Craft in this space: the crafting app for the crawler this user owns here, with this space chosen. */
  static async #onOpenCrafting() {
    const crawler = this.#owner();
    if (crawler) COGCraftingApp.open({ crawler, space: this.actor });
  }

  static async #onWithdrawItem(event, target) {
    const itemId = target.dataset.itemId;
    if (!itemId) return;
    await this.#owner()?.withdrawFromPersonalSpace(itemId, 1, { space: this.actor });
    return this.render();
  }

  static async #onRestInSpace(event, target) {
    const owner = this.#owner();
    if (!owner) return;
    await owner.restInPersonalSpace('long', { space: this.actor });
  }

  static async #onLaunchGrind(event, target) {
    const owner = this.#owner();
    if (!owner) return;
    COGGrindApp.open({ actor: owner });
  }

  /** Train the skill picked in the Training tab: one check through `trainSkillInPersonalSpace`, which posts the result card. */
  static async #onTrainSkill(event, target) {
    const crawler = this.#owner();
    if (!crawler) return;
    const skillId = this.element?.querySelector('select.cog-train-skill')?.value;
    if (!skillId) {
      globalThis.ui?.notifications?.warn?.('Pick a skill to train first.');
      return;
    }
    await crawler.trainSkillInPersonalSpace(skillId, { space: this.actor });
  }

  /**
   * A drop that would take more table spaces than the space has asks a Rule Break; declined, nothing lands.
   * @override
   */
  async _onDropItemCreate(itemData, event) {
    const list = [itemData].flat().filter(Boolean);
    const room = await confirmRoomFor(this.actor, list);
    if (!room.ok) return [];
    const studio = await confirmStudioFor(this.actor, list);
    if (!studio.ok) return [];
    if (room.ruleBreak) stampTableRuleBreaks(list);
    if (studio.ruleBreak) stampStudioRuleBreaks(list);
    return super._onDropItemCreate(list, event);
  }

  /** Report why a purchase did not go through; a Cancel needs no message. */
  #reportPurchase(result) {
    const note = { notGM: 'Only the GM may grant a purchase.', payer: 'That crawler cannot pay for this space.', noCoupon: 'That coupon is not available.' }[result?.reason];
    if (note) globalThis.ui?.notifications?.warn?.(note);
  }

  /** Run one purchase for the chosen payer and show the sheet again. */
  async #purchase(buy) {
    const payer = this.#payer();
    if (payer === undefined) return;
    const result = await buy(payer);
    this.#reportPurchase(result);
    return this.render();
  }

  static async #onBuyUpgrade(event, target) {
    const id = target.dataset.upgradeId;
    if (id) await this.#purchase(payer => buySpaceUpgrade(this.actor, id, payer));
  }

  /** Rank Up with the coupon picked next to the button (none picked pays gold). */
  static async #onRankUp() {
    await this.#purchase(payer => {
      const couponId = this.element?.querySelector('select.cog-rank-coupon')?.value;
      const coupon = couponId ? spaceCoupons(payer).find(c => c.id === couponId) : null;
      return rankUpSpace(this.actor, payer, { coupon });
    });
  }

  static async #onBuyTable() {
    const tag = this.element?.querySelector('select.cog-table-type')?.value;
    if (tag) await this.#purchase(payer => buyTable(this.actor, tag, payer));
  }

  /** Join this space to the one picked in the Settings tab, paid by the chosen payer. */
  static async #onJoinSpace() {
    const target = resolveSpace(this.element?.querySelector('select.cog-join-target')?.value);
    if (target) await this.#purchase(payer => joinSpace(this.actor, target, payer));
  }

  static async #onDetachSpace(event, target) {
    const other = resolveSpace(target.dataset.spaceUuid);
    if (!other) return;
    await detachSpaces(this.actor, other);
    return this.render();
  }

  static async #onSetPayer(event, target) {
    this.#payerUuid = String(target?.value ?? '');
    return this.render();
  }

  static async #onUninstallUpgrade(event, target) {
    if (!this.isEditable) return;
    const id = target.dataset.upgradeId;
    if (id) await this.actor.system.uninstallUpgrade(id);
  }

  static async #onToggleQuest(event, target) {
    if (!this.isEditable) return;
    const id = target.dataset.questId;
    if (id) await this.actor.system.toggleQuestComplete(id);
  }

  static async #onAddQuest(event, target) {
    if (!this.isEditable) return;
    const form = target.closest('[data-quest-form]');
    const titleInput = form?.querySelector('.new-quest-title');
    const rewardInput = form?.querySelector('.new-quest-reward');
    const descInput = form?.querySelector('.new-quest-desc');
    const title = titleInput?.value?.trim();
    if (!title) return;
    await this.actor.system.addQuest({
      title,
      reward: rewardInput?.value?.trim() || '100 Gold',
      description: descInput?.value?.trim() || ''
    });
    for (const input of [titleInput, rewardInput, descInput]) if (input) input.value = '';
  }

  static async #onAddFeedMessage(event, target) {
    if (!this.isEditable) return;
    const form = target.closest('[data-feed-form]');
    const titleInput = form?.querySelector('.new-feed-title');
    const channelInput = form?.querySelector('.new-feed-channel');
    const msgInput = form?.querySelector('.new-feed-msg');
    const title = titleInput?.value?.trim();
    if (!title) return;
    await this.actor.system.addFeedMessage({
      title,
      channel: channelInput?.value?.trim() || 'Universal TV',
      message: msgInput?.value?.trim() || ''
    });
    for (const input of [titleInput, channelInput, msgInput]) if (input) input.value = '';
  }

  static async #onHouseMercenary(event, target) {
    if (!this.isEditable) return;
    const id = target.dataset.mercId;
    if (id) await this.actor.system.houseMercenary(id);
    return this.render();
  }

  static async #onUnhouseMercenary(event, target) {
    if (!this.isEditable) return;
    const id = target.dataset.mercId;
    if (id) await this.actor.system.unhouseMercenary(id);
    return this.render();
  }

  static async #onHouseNpc(event, target) {
    if (!this.isEditable) return;
    const id = target.dataset.npcId;
    if (id) await this.actor.system.houseNpc(id);
    return this.render();
  }

  static async #onUnhouseNpc(event, target) {
    if (!this.isEditable) return;
    const id = target.dataset.npcId;
    if (id) await this.actor.system.unhouseNpc(id);
    return this.render();
  }

  static async #onAddOccupant(event, target) {
    if (!this.isEditable) return;
    const select = this.element?.querySelector('select.occupant-select');
    const crawler = resolveActorByUuid(select?.value);
    if (crawler?.type !== 'crawler') return;
    await crawler.linkPersonalSpace(this.actor);
    return this.render();
  }

  static async #onRemoveOccupant(event, target) {
    if (!this.isEditable) return;
    const uuid = target.dataset.crawlerUuid;
    if (!uuid) return;
    await removeCrawlerFromSpace(this.actor, uuid);
    return this.render();
  }

  /** Open a linked crawler's loot boxes from this space (the space is not a safe room; the crawler's scene decides). */
  static async #onOpenLootBoxes(event, target) {
    const crawler = resolveActorByUuid(target.dataset.crawlerUuid);
    if (crawler?.type !== 'crawler' || !userOwnsActor(crawler, globalThis.game?.user)) return;
    if (!spaceMembers(this.actor).occupants.some(c => c.uuid === crawler.uuid)) return;
    await crawler.openLootBoxes?.();
    return this.render();
  }

  static async #onLeaveSpace(event, target) {
    const uuid = target.dataset.crawlerUuid;
    const crawler = resolveActorByUuid(uuid);
    if (crawler?.type !== 'crawler' || !userOwnsActor(crawler, globalThis.game?.user)) return;
    await crawler.unlinkPersonalSpace(this.actor);
    return this.render();
  }

  static async #onOpenGuild(event, target) {
    const MercGuild = globalThis.game?.cog?.COGMercenaryGuildApp;
    if (MercGuild) MercGuild.open();
  }
}
