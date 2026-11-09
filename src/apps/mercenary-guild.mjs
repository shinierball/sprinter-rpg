/**
 * Sprinter RPG — Mercenary Guild & Freelance Retainers
 *
 * Interactive application providing:
 * - Mercenary Roster: Browse, search, filter by role (Tank, DPS, Healer, Support, Scout) and race.
 * - Hiring Contracts: Daily rate calculation, contract duration (days), gold deduction, and ratifying chat cards.
 * - Multi-Player Linking: Link hired mercenaries to a single player, multiple players, or ALL players in the party.
 * - Active Contracts Management: Extend days, modify employer links, release/dismiss retainers.
 * - Barracks Lodging Integration: House mercenaries in personal space barracks between levels for daily rate discounts.
 * - Mercenary Recruitment: Create custom mercenaries with any crawler race and class.
 */

import { COGToolApp } from './tool-app.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { COGRaceClassApplier } from '../data/race-class-applier.mjs';
import { resolveActor } from '../documents/actor.mjs';
import { syncActorOwnership } from '../documents/actor/ownership-relay.mjs';
import { userOwnsActor } from '../documents/actor/personal-space-links.mjs';
import { SYSTEM_PATH, SYSTEM_ID } from '../constants.mjs';
import { confirmRuleBreak } from '../utils/rule-break.mjs';
import { sourceBadge, isContentOff } from '../utils/content-source.mjs';
import { ruleBreakBadgeHtml, ruleBreakMessageData } from '../utils/rule-break-visibility.mjs';
import { registerRelayAction, requestRelay } from '../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';
import { runKeyed } from '../utils/keyed-queue.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/mercenary-guild`;

/** The id a catalog mercenary is registered under; stamped on enlisted actors as `flags.sprinter-rpg.catalogId`. */
const catalogMercId = (cat) => cat.id || cat._id || cat.name;

/** The GM, or a user who owns one of the mercenary's employer crawlers, may extend or dismiss its contract. */
export function canManageContract(mercActor, user = globalThis.game?.user) {
  if (!mercActor || !user) return false;
  if (user.isGM) return true;
  const ids = Array.isArray(mercActor.system?.details?.employerIds) ? mercActor.system.details.employerIds : [];
  return ids.some(id => userOwnsActor(resolveActor(id), user));
}

/** Relay action: add or remove a mercenary in an employer crawler's `system.companions.mercenaries`. */
const MERCENARY_COMPANION_RELAY = 'mercenaryCompanion';

/** The employer's companion list after adding or removing the mercenary id; null when nothing changes. */
function nextMercenaryList(employer, mercenaryId, add) {
  const list = employer?.system?.companions?.mercenaries;
  if (!Array.isArray(list)) return null;
  if (add) return list.includes(mercenaryId) ? null : [...list, mercenaryId];
  return list.includes(mercenaryId) ? list.filter(id => id !== mercenaryId) : null;
}

registerRelayAction(MERCENARY_COMPANION_RELAY, {
  // Add: the requester must own one of the mercenary's employers and the contract must name this employer.
  // Remove: the contract no longer names this employer (a dangling list entry), so dropping it harms no link.
  authorize: (payload, requester) => {
    const employer = resolveActorByUuid(payload?.employerUuid);
    const merc = resolveActorByUuid(payload?.mercenaryUuid);
    if (!employer || !merc || employer.type !== 'crawler' || merc.type !== 'mercenary') return false;
    if (requester?.isGM) return true;
    const ids = Array.isArray(merc.system?.details?.employerIds) ? merc.system.details.employerIds : [];
    if (payload.add === true) return ids.includes(employer.id) && ids.some(id => userOwnsActor(resolveActor(id), requester));
    return !ids.includes(employer.id);
  },
  apply: async (payload) => {
    const employer = resolveActorByUuid(payload?.employerUuid);
    const merc = resolveActorByUuid(payload?.mercenaryUuid);
    if (!employer || !merc) return false;
    const list = nextMercenaryList(employer, merc.id, payload.add === true);
    if (list) await employer.update({ 'system.companions.mercenaries': list });
    return true;
  }
});

/**
 * Add or remove a mercenary in one employer crawler's companion list. Written locally when this user can update the
 * employer (GM or owner); a party-mate's crawler owned by another player goes through the GM relay.
 * @returns {Promise<boolean>} true when the list is in sync; false when no GM could apply it (the relay warned)
 */
async function setEmployerMercenary(employer, mercActor, add) {
  const list = nextMercenaryList(employer, mercActor?.id, add);
  if (!list) return true;
  if (userOwnsActor(employer, globalThis.game?.user)) {
    await employer.update({ 'system.companions.mercenaries': list });
    return true;
  }
  const res = await requestRelay(MERCENARY_COMPANION_RELAY, { employerUuid: employer.uuid, mercenaryUuid: mercActor.uuid, add: Boolean(add) }, { direct: false });
  return res.ok === true && res.result !== false;
}

/** Relay action: write a hire's contract on a mercenary the hiring player does not own yet. */
const MERCENARY_CONTRACT_RELAY = 'mercenaryContract';

/** The longest contract one hire may sign (the Guild's day box). */
export const MAX_CONTRACT_DAYS = 90;

/** Crawlers sharing the hirer's non-empty `details.party`; the hirer alone when it has no party. */
function partyCrawlerIds(crawler) {
  const party = String(crawler.system?.details?.party ?? '').trim();
  if (!party) return [crawler.id];
  const all = globalThis.game?.actors ? Array.from(globalThis.game.actors.values?.() ?? globalThis.game.actors) : [];
  const ids = all.filter(a => a.type === 'crawler' && String(a.system?.details?.party ?? '').trim() === party).map(a => a.id);
  return ids.includes(crawler.id) ? ids : [...ids, crawler.id];
}

/** A whole number of days from 1 to the Guild's limit, or null. */
function validContractDays(raw) {
  const n = typeof raw === 'number' ? raw : Number.NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_CONTRACT_DAYS ? n : null;
}

/** The gold a hire (or extension) of `days` days costs, from the mercenary's stored rate. The one cost formula. */
export function mercenaryHireCost(merc, days) {
  const rate = Number(merc?.system?.effectiveDailyRate ?? merc?.system?.details?.dailyRate) || 25;
  return { rate, totalCost: rate * days };
}

/**
 * The contract a hire writes, computed from stored data: the hirer, the hirer's stored party (Link All) or the
 * crawlers asked for, plus every employer the mercenary already has (a hire never removes one), and the mercenary's
 * own stored days plus the purchased days. The one place `employerIds` and `contractDays` are decided; the GM relay
 * and the local path both use it, so a forged payload value is never written.
 * @param {Actor} merc
 * @param {Actor} crawler the verified hirer
 * @param {{ days?: number, linkAll?: boolean, linkedCrawlerIds?: string[] }} request
 * @returns {{ updates: object, employers: string[] }|null} null when the days are not a valid whole number
 */
export function mercenaryContractTerms(merc, crawler, request = {}) {
  const days = validContractDays(request.days);
  if (days === null) return null;
  const known = (id) => resolveActor(id)?.type === 'crawler';
  const asked = Array.isArray(request.linkedCrawlerIds) ? request.linkedCrawlerIds.filter(id => typeof id === 'string' && known(id)) : [];
  const hirer = request.linkAll === true ? partyCrawlerIds(crawler) : [crawler.id, ...asked];
  const details = merc.system?.details ?? {};
  const existing = details.hired === true && Array.isArray(details.employerIds) ? details.employerIds : [];
  const employers = [...new Set([...existing, ...hirer])];
  const existingDays = details.hired === true ? Math.max(0, Number(details.contractDays) || 0) : 0;
  return {
    employers,
    days,
    ...mercenaryHireCost(merc, days),
    updates: {
      'system.details.hired': true,
      'system.details.contractDays': existingDays + days,
      'system.details.employerIds': employers,
      'system.details.ownerId': crawler.id,
      'system.details.housingStatus': details.housedSpaceId ? 'barracks' : 'field'
    }
  };
}

registerRelayAction(MERCENARY_CONTRACT_RELAY, {
  // The requester must own the hiring crawler, the days must be a valid whole number, and the mercenary must be free
  // to hire (not under contract) or already manageable by the requester. Employers and total days are computed in
  // `apply`; nothing in the payload names them.
  authorize: (payload, requester) => {
    const crawler = resolveActorByUuid(payload?.crawlerUuid);
    const merc = resolveActorByUuid(payload?.mercenaryUuid);
    if (!crawler || !merc || crawler.type !== 'crawler' || merc.type !== 'mercenary') return false;
    if (validContractDays(payload?.days) === null) return false;
    if (requester?.isGM) return true;
    if (!userOwnsActor(crawler, requester)) return false;
    return merc.system?.details?.hired !== true || canManageContract(merc, requester);
  },
  apply: async (payload) => {
    const merc = resolveActorByUuid(payload?.mercenaryUuid);
    const crawler = resolveActorByUuid(payload?.crawlerUuid);
    if (!merc || !crawler) return false;
    return (await signContract(merc, crawler, payload, { ruleBreak: payload.ruleBreak === true })).ok;
  }
});

/**
 * Charge a hire and write its contract as one step inside the mercenary's `merc-contract` queue. The cost comes from
 * `mercenaryContractTerms` (the stored rate and the validated days), never from the request. The hirer is debited
 * first (the purse never goes below 0) and refunded if the contract write fails, so a failed payment writes no
 * contract and a failed contract keeps the gold. Not enough gold needs `ruleBreak` (the caller confirmed it).
 * @returns {Promise<{ ok: boolean, terms?: object, ruleBreak?: boolean }>}
 */
export async function signContract(merc, crawler, request, { ruleBreak = false } = {}) {
  return runKeyed(`merc-contract:${merc.uuid}`, async () => {
    const terms = mercenaryContractTerms(merc, crawler, request);
    if (!terms) return { ok: false };
    const paid = await runKeyed(`merc-gold:${crawler.uuid}`, async () => {
      const gold = Number(crawler.system?.currency?.gold) || 0;
      const short = gold < terms.totalCost;
      if (short && ruleBreak !== true) return null;
      await crawler.update({ 'system.currency.gold': Math.max(0, gold - terms.totalCost) });
      return { gold, short };
    });
    if (!paid) return { ok: false };
    const stamp = paid.short || ruleBreak === true;
    try {
      await merc.update(terms.updates);
      if (stamp) await merc.setFlag?.(SYSTEM_ID, 'contractRuleBreak', true);
    } catch (err) {
      await runKeyed(`merc-gold:${crawler.uuid}`, async () => {
        await crawler.update({ 'system.currency.gold': (Number(crawler.system?.currency?.gold) || 0) + Math.min(terms.totalCost, paid.gold) });
      });
      throw err;
    }
    return { ok: true, terms, ruleBreak: stamp };
  });
}

/**
 * Charge and write a hire's contract on the mercenary: locally when this user may update it (GM or owner), else through the GM
 * relay (a player hiring a GM-created mercenary does not own it until the hire grants ownership). Either way the
 * contract comes from `mercenaryContractTerms`; only the request (days, link choice) is sent.
 * @returns {Promise<boolean>} false when the days are invalid or no GM could apply it (the relay warned)
 */
async function applyMercenaryContract(mercActor, crawler, request, { ruleBreak = false } = {}) {
  if (userOwnsActor(mercActor, globalThis.game?.user)) {
    return (await signContract(mercActor, crawler, request, { ruleBreak })).ok;
  }
  const res = await requestRelay(MERCENARY_CONTRACT_RELAY, {
    mercenaryUuid: mercActor.uuid,
    crawlerUuid: crawler.uuid,
    days: request.days,
    linkAll: request.linkAll === true,
    linkedCrawlerIds: Array.isArray(request.linkedCrawlerIds) ? request.linkedCrawlerIds : [],
    ruleBreak: Boolean(ruleBreak)
  }, { direct: false });
  return res.ok === true && res.result !== false;
}

export class COGMercenaryGuildApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-mercenary-guild',
    classes: ['cog-sheet-window', 'cog-guild-window'],
    position: { width: 920, height: 760 },
    window: { title: 'Mercenary Guild & Freelance Retainers', icon: 'fa-solid fa-users-gear', resizable: true },
    actions: {
      setTab: COGMercenaryGuildApp.#onSetTab,
      setRole: COGMercenaryGuildApp.#onSetRole,
      setSearch: COGMercenaryGuildApp.#onSetSearch,
      setCrawler: COGMercenaryGuildApp.#onSetCrawler,
      hire: COGMercenaryGuildApp.#onHire,
      extend: COGMercenaryGuildApp.#onExtend,
      dismiss: COGMercenaryGuildApp.#onDismiss,
      openSheet: COGMercenaryGuildApp.#onOpenSheet,
      enlist: COGMercenaryGuildApp.#onEnlist,
      assignBarracks: COGMercenaryGuildApp.#onAssignBarracks,
      recruit: COGMercenaryGuildApp.#onRecruit
    }
  };

  // The search box lives in `toolbar`, which typing never re-renders, so it keeps focus and caret.
  // `list` is the scroll container for the roster, contracts and barracks tabs.
  static PARTS = {
    header: { template: `${TPL}/header.hbs` },
    nav: { template: `${TPL}/nav.hbs` },
    toolbar: { template: `${TPL}/toolbar.hbs` },
    list: { template: `${TPL}/list.hbs`, scrollable: [''] },
    recruit: { template: `${TPL}/recruit.hbs`, scrollable: [''] }
  };

  constructor(options = {}) {
    super(options);
    this.selectedRole = options.role || 'all';
    this.searchQuery = '';
    this.activeTab = options.tab || 'roster'; // 'roster', 'contracts', 'barracks', 'recruit'
    // The hiring crawler is always a deliberate pick: nothing is pre-selected, whoever opened the Guild.
    this.selectedCrawlerId = '';
  }

  /** @override */
  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);
    const worldActors = globalThis.game?.actors ? Array.from(globalThis.game.actors.values()) : [];

    // 1. Resolve Crawlers (Potential Employers)
    const crawlers = worldActors.filter(a => a.type === 'crawler');
    context.crawlers = crawlers.map(c => ({
      id: c.id,
      name: c.name,
      img: c.img || 'icons/svg/mystery-man.svg',
      gold: Number(c.system?.currency?.gold) || 0,
      selected: c.id === this.selectedCrawlerId
    }));

    const currentCrawler = crawlers.find(c => c.id === this.selectedCrawlerId) || null;
    context.currentCrawler = currentCrawler ? {
      id: currentCrawler.id,
      name: currentCrawler.name,
      img: currentCrawler.img || 'icons/svg/mystery-man.svg',
      gold: Number(currentCrawler.system?.currency?.gold) || 0
    } : null;

    // 2. Resolve All Mercenaries (World Actors + Catalog Templates)
    const worldMercs = worldActors.filter(a => a.type === 'mercenary' && !isContentOff(a));
    const mercList = [];

    // World mercenaries
    for (const m of worldMercs) {
      mercList.push(this._formatMercenaryData(m, false));
    }

    // Catalog pre-configured mercenaries (available for instant enlistment if not present in world)
    const enlistedIds = new Set(worldMercs.map(wm => wm.flags?.[SYSTEM_ID]?.catalogId).filter(Boolean));
    for (const cat of contentRegistry.getMercenaries()) {
      if (isContentOff(cat)) continue;
      if (!enlistedIds.has(catalogMercId(cat))) {
        mercList.push(this._formatMercenaryData(cat, true));
      }
    }

    // 3. Filter Mercenaries. Hired retainers are listed under Active Contracts only.
    const available = mercList.filter(m => !m.isHired);
    let filtered = [...available];

    // Filter by Role
    if (this.selectedRole !== 'all') {
      filtered = filtered.filter(m => (m.role || '').toLowerCase() === this.selectedRole.toLowerCase());
    }

    // Filter by Search Query
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase().trim();
      filtered = filtered.filter(m =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.race || '').toLowerCase().includes(q) ||
        (m.class || '').toLowerCase().includes(q) ||
        (m.role || '').toLowerCase().includes(q)
      );
    }

    context.hasCatalogMercenaries = contentRegistry.hasMercenaries();
    context.catalogMercenaries = mercList.filter(m => m.isCatalog);
    context.mercenaries = filtered;
    context.activeContracts = mercList.filter(m => m.isHired && !m.isCatalog);

    // 4. Role Counts for Filter Pills
    context.roleCounts = {
      all: available.length,
      Tank: available.filter(m => (m.role || '').toLowerCase() === 'tank').length,
      DPS: available.filter(m => (m.role || '').toLowerCase() === 'dps').length,
      Healer: available.filter(m => (m.role || '').toLowerCase() === 'healer').length,
      Support: available.filter(m => (m.role || '').toLowerCase() === 'support').length,
      Scout: available.filter(m => (m.role || '').toLowerCase() === 'scout').length
    };

    // 5. Personal Spaces with Barracks
    const spaces = worldActors.filter(a => a.type === 'personal_space');
    context.spaces = spaces.map(s => {
      const mercCap = Number(s.system?.effectiveMercenaryCapacity ?? s.system?.mercenaryCapacity) || 0;
      const housedMercs = typeof s.system?.getHousedMercenaries === 'function' ? s.system.getHousedMercenaries() : [];
      const housedNpcs = typeof s.system?.getHousedNpcs === 'function' ? s.system.getHousedNpcs() : [];
      const housedTotal = housedMercs.length + housedNpcs.length;
      return {
        id: s.id,
        name: s.name,
        tier: s.system?.tier || 1,
        size: s.system?.size || 'Single Room',
        capacity: mercCap,
        housedCount: housedTotal,
        discountPct: Number(s.system?.effectiveMercenaryDiscountPct ?? s.system?.mercenaryDiscountPct) || 0,
        isFull: housedTotal >= mercCap,
        hasBarracks: mercCap > 0
      };
    });

    // 6. Race Options for Custom Recruitment
    const raceContext = COGRaceClassApplier.getRaceClassContext({ type: 'crawler' });
    context.raceOptions = raceContext.raceOptions || [];

    context.selectedRole = this.selectedRole;
    context.searchQuery = this.searchQuery;
    context.activeTab = this.activeTab;

    return context;
  }

  /**
   * Helper to structure mercenary data for template rendering
   * @private
   */
  _formatMercenaryData(merc, isCatalog = false) {
    const sys = merc.system || {};
    const details = sys.details || {};
    const abilities = sys.abilities || {};
    const attributes = sys.attributes || {};

    const employerIds = Array.isArray(details.employerIds) ? details.employerIds : [];
    const employers = [];
    for (const eid of employerIds) {
      const emp = resolveActor(eid);
      if (emp) employers.push({ id: emp.id, name: emp.name });
    }

    const items = merc.items
      ? (Array.from(merc.items ?? []))
      : [];

    const weapons = items.filter(i => i.type === 'attack' || i.type === 'gear' && i.system?.isWeapon);
    const spells = items.filter(i => i.type === 'spell');
    const skills = items.filter(i => i.type === 'skill');

    let housedSpace = null;
    if (details.housedSpaceId) {
      const sp = resolveActor(details.housedSpaceId);
      if (sp) housedSpace = { id: sp.id, name: sp.name };
    }

    const dailyRate = Number(details.dailyRate) || 25;
    const effectiveDailyRate = Number(sys.effectiveDailyRate ?? dailyRate) || dailyRate;

    return {
      id: merc._id || merc.id,
      name: merc.name,
      sourceBadge: sourceBadge(merc),
      img: merc.img || 'icons/svg/mystery-man.svg',
      isCatalog,
      actorRef: isCatalog ? null : merc,
      level: Number(details.level) || 1,
      race: COGRaceClassApplier.definitionLabel('race', details.race || 'human', { actor: isCatalog ? null : merc }),
      class: details.class || 'Bruiser',
      role: details.role || 'DPS',
      dailyRate,
      effectiveDailyRate,
      hasDiscount: effectiveDailyRate < dailyRate,
      discountPct: Number(sys.dailyRateDiscountPct) || 0,
      contractDays: Number(details.contractDays) || 0,
      isHired: Boolean(details.hired),
      employerIds,
      employers,
      canManage: !isCatalog && canManageContract(merc),
      ownerId: details.ownerId || '',
      housedSpace,
      housingStatus: details.housingStatus || 'available',
      hp: {
        value: Number(attributes.hp?.value) || 40,
        max: Number(attributes.hp?.max) || 40
      },
      mana: {
        value: Number(attributes.mana?.value) || 10,
        max: Number(attributes.mana?.max) || 10
      },
      evade: Number(attributes.evade?.total) || 4,
      dr: Number(attributes.dr?.total) || 0,
      str: Number(abilities.str?.mod) || 4,
      int: Number(abilities.int?.mod) || 4,
      con: Number(abilities.con?.mod) || 4,
      dex: Number(abilities.dex?.mod) || 4,
      cha: Number(abilities.cha?.mod) || 4,
      special: details.special || '',
      notes: details.notes || '',
      weapons: weapons.map(w => w.name),
      spells: spells.map(s => s.name),
      skills: skills.map(sk => sk.name),
      // Display strings; the template has no `join` helper (CONTRIBUTING §5).
      weaponsText: weapons.map(w => w.name).join(', '),
      spellsText: spells.map(s => s.name).join(', '),
      skillsText: skills.map(sk => sk.name).join(', ')
    };
  }

  /* -------------------------------------------- */
  /*  Guild Business Actions                      */
  /* -------------------------------------------- */

  /**
   * Hires a mercenary for a specified number of days, deducting gold and linking to players.
   * @param {object} params
   * @returns {Promise<boolean>}
   */
  async hireMercenary({ mercenaryId, crawlerId, days = 1, linkAllPlayers = true, linkedCrawlerIds = [], ruleBreak = false } = {}) {
    let mercActor = resolveActor(mercenaryId);

    // If hiring a catalog mercenary not yet in world, enlist first
    if (!mercActor) {
      const cat = contentRegistry.getMercenary(mercenaryId);
      if (cat) {
        mercActor = await this.enlistCatalogMercenary(catalogMercId(cat));
      }
    }
    if (!mercActor) return false;

    const crawler = resolveActor(crawlerId || this.selectedCrawlerId);
    if (!crawler) {
      if (globalThis.ui?.notifications) ui.notifications.warn('Please select a hiring Crawler.');
      return false;
    }

    const contractDays = Math.min(MAX_CONTRACT_DAYS, Math.max(1, parseInt(days, 10) || 1));
    const { rate, totalCost } = mercenaryHireCost(mercActor, contractDays);

    // Not enough gold asks for a Rule Break (CONTRIBUTING rule 2); the purse never goes below 0
    const currentGold = Number(crawler.system?.currency?.gold) || 0;
    let contractRuleBreak = false;
    if (currentGold < totalCost) {
      const confirm = await confirmRuleBreak({
        title: 'Insufficient Gold',
        message: `Hiring ${mercActor.name} for ${contractDays} days costs ${totalCost} Gold, but ${crawler.name} only has ${currentGold} Gold. Hire anyway as a Rule Break?`,
        reason: `Insufficient Gold (${currentGold}/${totalCost})`,
        options: { ruleBreak }
      });
      if (!confirm.confirmed) return false;
      contractRuleBreak = true;
    }

    // The contract (employers, total days) is computed by `mercenaryContractTerms`, here or on the GM.
    const request = { days: contractDays, linkAll: linkAllPlayers === true, linkedCrawlerIds };
    const employers = mercenaryContractTerms(mercActor, crawler, request).employers;

    // Payment and contract are one step (`signContract`, here or on the GM): if it fails, nothing is charged.
    if (!await applyMercenaryContract(mercActor, crawler, request, { ruleBreak: contractRuleBreak })) return false;

    // Grant every employer crawler's players ownership (via the GM relay; players never write ownership), so
    // each employer can Extend and Dismiss. The hirer goes first: owning the mercenary authorizes the rest.
    await syncActorOwnership(mercActor, crawler);
    for (const eid of employers) {
      const emp = resolveActor(eid);
      if (emp && emp.id !== crawler.id) await syncActorOwnership(mercActor, emp);
    }

    // Sync crawler companion lists
    for (const eid of employers) {
      const emp = resolveActor(eid);
      if (emp) await setEmployerMercenary(emp, mercActor, true);
    }

    // Ratification Chat Message
    await this._postContractChatMessage({
      action: 'hired',
      mercenary: mercActor,
      crawler,
      days: contractDays,
      totalCost,
      rate,
      linkAll: linkAllPlayers,
      employerCount: employers.length,
      ruleBreak: contractRuleBreak,
      paid: Math.min(totalCost, currentGold)
    });

    if (globalThis.ui?.notifications) {
      ui.notifications.info(`Contract Ratified! ${mercActor.name} hired for ${contractDays} days (${contractRuleBreak ? `${Math.min(totalCost, currentGold)} of ${totalCost} Gold paid, Rule Break` : `${totalCost} Gold`}).`);
    }

    return true;
  }

  /**
   * Extends an active mercenary contract with additional days.
   * @param {object} params
   * @returns {Promise<boolean>}
   */
  async extendContract({ mercenaryId, crawlerId, days = 1, ruleBreak = false } = {}) {
    const mercActor = resolveActor(mercenaryId);
    if (!mercActor || !canManageContract(mercActor)) return false;

    const crawler = resolveActor(crawlerId || mercActor.system?.details?.ownerId || this.selectedCrawlerId);
    if (!crawler) return false;

    const extendDays = Math.max(1, parseInt(days, 10) || 1);
    const { rate, totalCost } = mercenaryHireCost(mercActor, extendDays);

    const currentGold = Number(crawler.system?.currency?.gold) || 0;
    let contractRuleBreak = false;
    if (currentGold < totalCost) {
      const confirm = await confirmRuleBreak({
        title: 'Insufficient Gold',
        message: `Extending the contract for ${extendDays} days costs ${totalCost} Gold, but ${crawler.name} only has ${currentGold} Gold. Extend anyway as a Rule Break?`,
        reason: `Insufficient Gold (${currentGold}/${totalCost})`,
        options: { ruleBreak }
      });
      if (!confirm.confirmed) return false;
      contractRuleBreak = true;
    }

    await crawler.update({ 'system.currency.gold': Math.max(0, currentGold - totalCost) });

    const curDays = Number(mercActor.system?.details?.contractDays) || 0;
    await mercActor.update({
      'system.details.contractDays': curDays + extendDays
    });
    if (contractRuleBreak) await mercActor.setFlag?.(SYSTEM_ID, 'contractRuleBreak', true);

    await this._postContractChatMessage({
      action: 'extended',
      mercenary: mercActor,
      crawler,
      days: extendDays,
      totalCost,
      rate,
      ruleBreak: contractRuleBreak,
      paid: Math.min(totalCost, currentGold)
    });

    return true;
  }

  /**
   * Dismisses a mercenary contract early.
   * @param {string} mercenaryId
   * @returns {Promise<boolean>}
   */
  async dismissMercenary(mercenaryId) {
    const mercActor = resolveActor(mercenaryId);
    if (!mercActor || !canManageContract(mercActor)) return false;

    const employerIds = Array.isArray(mercActor.system?.details?.employerIds) ? [...mercActor.system.details.employerIds] : [];

    await mercActor.update({
      'system.details.hired': false,
      'system.details.contractDays': 0,
      'system.details.employerIds': [],
      'system.details.ownerId': '',
      'system.details.housingStatus': mercActor.system?.details?.housedSpaceId ? 'barracks' : 'available'
    });

    // Clean up crawler companion lists
    for (const eid of employerIds) {
      const emp = resolveActor(eid);
      if (emp) await setEmployerMercenary(emp, mercActor, false);
    }
    // Links are gone; now drop each former employer's players from the mercenary.
    // The requester's own crawlers go last: while they still own the mercenary, the GM authorizes every
    // other employer's revoke; once their own entry is gone they could no longer ask for the rest.
    const me = globalThis.game?.user;
    const employers = employerIds.map(eid => resolveActor(eid)).filter(Boolean)
      .sort((a, b) => Number(userOwnsActor(a, me) && !me?.isGM) - Number(userOwnsActor(b, me) && !me?.isGM));
    for (const emp of employers) await syncActorOwnership(mercActor, emp, { revoke: true });

    await this._postContractChatMessage({
      action: 'dismissed',
      mercenary: mercActor
    });

    return true;
  }

  /**
   * Enlists a pre-configured catalog mercenary into the world Actor directory.
   * @param {string} catalogId
   * @returns {Promise<Actor|null>}
   */
  async enlistCatalogMercenary(catalogId) {
    const cat = contentRegistry.getMercenary(catalogId);
    if (!cat) return null;

    const ActorClass = globalThis.CONFIG?.Actor?.documentClass || globalThis.Actor;
    if (!ActorClass?.create) return null;

    const actorData = {
      name: cat.name,
      type: 'mercenary',
      img: cat.img,
      system: structuredClone(cat.system),
      items: structuredClone(cat.items || []),
      flags: { [SYSTEM_ID]: { catalogId: catalogMercId(cat) } }
    };

    const created = await ActorClass.create(actorData, { cogSystemMade: true });
    return created;
  }

  /**
   * Recruits a brand-new custom mercenary with arbitrary race, class, level, and stats.
   * @param {object} data
   * @returns {Promise<Actor|null>}
   */
  async recruitCustomMercenary(data = {}) {
    const ActorClass = globalThis.CONFIG?.Actor?.documentClass || globalThis.Actor;
    if (!ActorClass?.create) return null;

    const name = data.name?.trim() || 'Guild Freelancer';
    const race = data.race?.trim() || 'human'; // a race reference from the recruit select (or a write-in)
    const className = data.class?.trim() || 'Bruiser';
    const role = data.role || 'DPS';
    const level = Math.max(1, parseInt(data.level, 10) || 1);
    const dailyRate = Math.max(0, parseInt(data.dailyRate, 10) || (20 + (level * 5)));

    const actorData = {
      name,
      type: 'mercenary',
      img: data.img || 'icons/svg/mystery-man.svg',
      system: {
        abilities: {
          str: { value: Number(data.str) || 10, unenhanced: Number(data.str) || 10, mod: 4 },
          int: { value: Number(data.int) || 10, unenhanced: Number(data.int) || 10, mod: 4 },
          con: { value: Number(data.con) || 10, unenhanced: Number(data.con) || 10, mod: 4 },
          dex: { value: Number(data.dex) || 10, unenhanced: Number(data.dex) || 10, mod: 4 },
          cha: { value: Number(data.cha) || 10, unenhanced: Number(data.cha) || 10, mod: 4 }
        },
        details: {
          level,
          race,
          class: className,
          role,
          dailyRate,
          contractDays: 0,
          hired: false,
          notes: data.notes || '',
          special: data.special || ''
        }
      }
    };

    const created = await ActorClass.create(actorData);
    return created;
  }

  /**
   * Posts the chat card for contract events
   * @private
   */
  async _postContractChatMessage({ action, mercenary, crawler, days, totalCost, rate, linkAll, employerCount, ruleBreak = false, paid = totalCost } = {}) {
    if (!globalThis.ChatMessage?.create) return;

    let title = '';
    let body = '';
    const accent = 'var(--cog-accent-fill)';
    // A confirmed Rule Break (not enough gold) pays what the purse held, so the card says so and carries the badge.
    const paidText = ruleBreak === true ? `Paid ${paid} of ${totalCost} Gold` : `${totalCost} Gold`;
    const badge = ruleBreak === true ? ` ${ruleBreakBadgeHtml()}` : '';

    if (action === 'hired') {
      title = 'MERCENARY CONTRACT RATIFIED';
      body = `
        <div style="font-family: 'Oswald', sans-serif; font-size: 13px;">
          <p>Crawler <strong>${crawler.name}</strong> has retained <strong>${mercenary.name}</strong> (${COGRaceClassApplier.definitionLabel('race', mercenary.system?.details?.race || 'human', { actor: mercenary })} ${mercenary.system?.details?.class || 'Mercenary'}).</p>
          <div class="cog-bg-surface-muted" style="padding: 8px; border-radius: 4px; margin: 6px 0; border-left: 3px solid var(--cog-success);">
            <div><strong>Duration:</strong> ${days} Days</div>
            <div><strong>Daily Rate:</strong> ${rate} Gold / Day</div>
            <div><strong>Total Retainer Paid:</strong> <span class="cog-text-warning" style="font-weight: bold;">${paidText}</span>${badge}</div>
            <div><strong>Linked Employers:</strong> ${linkAll ? 'All Party Members' : `${employerCount} Crawlers`}</div>
          </div>
        </div>
      `;
    } else if (action === 'extended') {
      title = 'MERCENARY CONTRACT EXTENDED';
      body = `
        <div style="font-family: 'Oswald', sans-serif; font-size: 13px;">
          <p>Crawler <strong>${crawler.name}</strong> extended the contract for <strong>${mercenary.name}</strong> by <strong>+${days} Days</strong>.</p>
          <p class="cog-text-warning" style="font-weight: bold;">Payment: ${paidText}${badge}</p>
        </div>
      `;
    } else if (action === 'dismissed') {
      title = 'MERCENARY CONTRACT CONCLUDED';
      body = `
        <div style="font-family: 'Oswald', sans-serif; font-size: 13px;">
          <p><strong>${mercenary.name}</strong> has been released from active service and returned to the Freelance Retainer Roster.</p>
        </div>
      `;
    }

    const content = `
      <div class="cog-chat-card cog-mercenary-contract-card cog-bg-window cog-text-strong" style="border: 2px solid ${accent}; border-radius: 6px; overflow: hidden;">
        <header class="cog-bg-dyn" style="--cog-bg-dyn: ${accent}; padding: 8px 12px; font-family: 'Oswald', sans-serif; font-weight: bold; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-file-contract"></i> ${title}
        </header>
        <div style="padding: 12px;">
          ${body}
        </div>
      </div>
    `;

    const data = { content, speaker: { alias: 'Mercenary Guild Registrar' } };
    await globalThis.ChatMessage.create(ruleBreak === true
      ? ruleBreakMessageData({ ...data, flags: { [SYSTEM_ID]: { ruleBreak: true } } })
      : data);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** Re-render everything except the recruit form, so a half-filled form survives unrelated actions. */
  _renderBrowse() {
    return this.render({ parts: ['header', 'nav', 'toolbar', 'list'] });
  }

  static async #onSetTab(event, target) {
    this.activeTab = target.dataset.tab || 'roster';
    await this.render();
  }

  static async #onSetRole(event, target) {
    this.selectedRole = target.dataset.role || 'all';
    await this._renderBrowse();
  }

  static async #onSetSearch(event, target) {
    this.searchQuery = target.value;
    await this.render({ parts: ['nav', 'list'] });
  }

  static async #onSetCrawler(event, target) {
    this.selectedCrawlerId = target.value;
    await this._renderBrowse();
  }

  /** Sign a contract using the card's days and link-all controls. */
  static async #onHire(event, target) {
    const mercId = target.dataset.mercId;
    const daysInput = this.element.querySelector(`.hire-days-input[data-merc-id="${mercId}"]`);
    const linkAllCheck = this.element.querySelector(`.hire-link-all-check[data-merc-id="${mercId}"]`);
    const days = parseInt(daysInput?.value, 10) || 1;
    const linkAll = linkAllCheck ? linkAllCheck.checked : true;

    await this.hireMercenary({
      mercenaryId: mercId,
      crawlerId: this.selectedCrawlerId,
      days,
      linkAllPlayers: linkAll
    });
    await this._renderBrowse();
  }

  static async #onExtend(event, target) {
    const days = parseInt(target.dataset.days, 10) || 1;
    await this.extendContract({
      mercenaryId: target.dataset.mercId,
      crawlerId: this.selectedCrawlerId,
      days
    });
    await this._renderBrowse();
  }

  static async #onDismiss(event, target) {
    await this.dismissMercenary(target.dataset.mercId);
    await this._renderBrowse();
  }

  static #onOpenSheet(event, target) {
    const act = resolveActor(target.dataset.mercId);
    if (act?.sheet) act.sheet.render({ force: true });
  }

  static async #onEnlist(event, target) {
    const created = await this.enlistCatalogMercenary(target.dataset.catId);
    if (created?.sheet) created.sheet.render({ force: true });
    await this._renderBrowse();
  }

  static async #onAssignBarracks(event, target) {
    const mercId = target.dataset.mercId;
    const spaceId = target.value;
    const space = resolveActor(spaceId);
    if (space?.system?.houseMercenary) {
      await space.system.houseMercenary(mercId);
    } else if (!spaceId) {
      const merc = resolveActor(mercId);
      if (merc?.system?.details?.housedSpaceId) {
        const oldSpace = resolveActor(merc.system.details.housedSpaceId);
        if (oldSpace?.system?.unhouseMercenary) {
          await oldSpace.system.unhouseMercenary(mercId);
        }
      }
    }
    await this._renderBrowse();
  }

  /**
   * Read the recruit controls by `name` and create the mercenary. The recruit block is a plain
   * container, not a `<form>`, so Enter in a field never submits or reloads the page.
   */
  static async #onRecruit(event, target) {
    const container = target.closest('.guild-recruit-form') ?? this.element.querySelector('.guild-recruit-form');
    const fields = {};
    for (const control of container?.querySelectorAll('[name]') ?? []) {
      fields[control.getAttribute('name')] = control.value;
    }
    const newMerc = await this.recruitCustomMercenary({
      name: fields.name,
      race: fields.race,
      class: fields.class,
      role: fields.role,
      level: fields.level,
      dailyRate: fields.dailyRate,
      str: fields.str,
      int: fields.int,
      con: fields.con,
      dex: fields.dex,
      cha: fields.cha,
      special: fields.special,
      notes: fields.notes
    });

    if (newMerc?.sheet) newMerc.sheet.render({ force: true });
    this.activeTab = 'roster';
    await this.render();
  }
}
