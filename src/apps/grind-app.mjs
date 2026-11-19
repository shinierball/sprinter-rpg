/**
 * Sprinter RPG — Grinding & Downtime Application
 *
 * Provides a dedicated, interactive party hub for:
 * - Setting grinding hours (1 to 12 hrs, default 5 hrs)
 * - Toggling Guide / Companion Insight (+1 safe hour, e.g. a helpful guide)
 * - Party Roster Selection (checkboxes for all party crawlers)
 * - Party sub-tabs to inspect each crawler, allocate banked hours, and trigger individual advancement checks
 * - Individual Endurance Checks per participant & Fatigued debuff applied only to failures
 * - Resetting unallocated pool hours to 0 at the start of a new grind (use it or lose it)
 * - Decrementing the global Floor Timer Clock once by non-bonus hours accrued
 */

import { COGToolApp } from './tool-app.mjs';
import { COGActor } from '../documents/actor.mjs';
import { GRIND_MAP_TAGS, getRequiredGrindingHours, getAdvancementTarget, getSafeGrindingThreshold } from '../data/rules/grinding-rules.mjs';
import { GRIND_TABLES_SETTING, honouredGrindPick, listGrindTables } from '../content/grind-tables.mjs';
import { SYSTEM_ID, SYSTEM_PATH } from '../constants.mjs';
import { getItemAllTags } from '../documents/active-tags.mjs';
import { getCurrentFloor } from '../utils/floor/current-floor.mjs';
import { buildAdvancementControls, runAdvancementControl } from './advancement-batch.mjs';
import { openAwardLevels } from './award-levels-app.mjs';
import { lowestLevelBonusMembers } from '../utils/skill/skill-advancement.mjs';
import { ADVANCEMENT_ROUTES, routeAllowsGain } from '../utils/skill/advancement-routes.mjs';
import { ruleSkillRank } from '../utils/skill/rule-skills.mjs';
import { patronGrindOptions } from '../documents/actor/patron-benefits.mjs';
import { advancingItemsOf } from '../utils/skill/advancing-items.mjs';


const TPL = `${SYSTEM_PATH}/templates/apps/grind-app`;

/** The GM's stored table picks (`{ floor, neighborhood }`); an unreadable setting reads as no picks. */
function storedGrindPicks() {
  try { return game.settings.get(SYSTEM_ID, GRIND_TABLES_SETTING) ?? {}; } catch { return {}; }
}

export class COGGrindApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-grind-app',
    classes: ['cog-sheet-window', 'cog-grind-app-window'],
    window: { title: 'Sprinter RPG — Party Grinding & Downtime Hub', icon: 'fa-solid fa-dumbbell', resizable: true },
    position: { width: 720, height: 'auto' },
    actions: {
      setHours: COGGrindApp.#onSetHours,
      setFloor: COGGrindApp.#onSetFloor,
      setGuideBonus: COGGrindApp.#onSetGuideBonus,
      setMapType: COGGrindApp.#onSetMapType,
      setComplication: COGGrindApp.#onSetComplication,
      setGrindFloorTable: COGGrindApp.#onSetGrindFloorTable,
      setGrindNeighborhoodTable: COGGrindApp.#onSetGrindNeighborhoodTable,
      setFloorTimer: COGGrindApp.#onSetFloorTimer,
      toggleCrawler: COGGrindApp.#onToggleCrawler,
      toggleLowestBonus: COGGrindApp.#onToggleLowestBonus,
      selectCrawler: COGGrindApp.#onSelectCrawler,
      selectSkill: COGGrindApp.#onSelectSkill,
      allocateHours: COGGrindApp.#onAllocateHours,
      attemptAdvancement: COGGrindApp.#onAttemptAdvancement,
      runTwoHourCheck: COGGrindApp.#onRunTwoHourCheck,
      runFloorCheck: COGGrindApp.#onRunFloorCheck,
      runSkillCheck: COGGrindApp.#onRunSkillCheck,
      awardLevels: COGGrindApp.#onAwardLevels,
      dismissAlert: COGGrindApp.#onDismissAlert,
      executeGrind: COGGrindApp.#onExecuteGrind,
      safeRoomRest: COGGrindApp.#onSafeRoomRest
    }
  };

  static PARTS = {
    header: { template: `${TPL}/header.hbs` },
    roster: { template: `${TPL}/roster.hbs` },
    setup: { template: `${TPL}/setup.hbs` },
    party: { template: `${TPL}/party.hbs`, scrollable: ['.cog-grind-skill-list'] },
    actions: { template: `${TPL}/actions.hbs` }
  };

  /**
   * Open (or focus) the hub. The hub is bound to the actor it was opened for, so a request for
   * a different actor replaces the open window instead of showing stale state; the same actor
   * just focuses it (and adopts a newly requested skill).
   */
  static async open(options = {}) {
    const existing = foundry.applications.instances.get(this.DEFAULT_OPTIONS.id);
    if (existing instanceof this) {
      if (options.actor && existing.actor?.id !== options.actor.id) await existing.close();
      else if (options.selectedSkillId) existing.selectedSkillId = options.selectedSkillId;
    }
    return super.open(options);
  }

  constructor(options = {}) {
    super(options);
    this.actor = options.actor || null;
    this.selectedSkillId = options.selectedSkillId || options.skillId || null;
    this.hours = Number(options.hours) || 5;
    this.hasGuideBonus = Boolean(options.hasGuideBonus);
    this.rollComplication = options.rollComplication !== false;

    // Party selection state: every crawler starts unticked, so each grind needs a deliberate pick
    this.selectedActorIds = new Set();
    // The GM's own ticks on the "lowest-Level party member" box (id -> checked). They win over the
    // automatic tick, which comes from the selected party's Levels; a change of party clears them.
    this.lowestLevelOverrides = new Map();
    this.activeCrawlerId = this.actor?.id || null;

    // Map selection: explicit option or auto-detect from actor inventory
    if (options.mapType) {
      this.mapType = String(options.mapType).toLowerCase().trim();
    } else if (options.hasBoroughMap || options.hasBurroughMap || options.mapBonus === 2) {
      this.mapType = 'borough';
    } else if (options.hasNeighborhoodMap || options.mapBonus === 1) {
      this.mapType = 'neighborhood';
    } else {
      this.mapType = this._detectMapFromActor();
    }

    // Default floor number: a mob's design floor, else the world's current Floor (a crawler's `details.floor` label is the
    // crawler's own record and can lag the world, so it is not read)
    const designFloor = parseInt(this.actor?.system?.details?.designFloor, 10);
    this.floorNumber = (Number.isFinite(designFloor) && designFloor >= 1 ? designFloor : 0) || getCurrentFloor();
  }

  /**
   * The best grinding map the actor owns, by tag: `rule.grind-map-borough` (+2 hrs) over
   * `rule.grind-map-neighborhood` (+1 hr). Item names are never read.
   * @returns {string} 'none' | 'neighborhood' | 'borough'
   */
  _detectMapFromActor() {
    if (!this.actor?.items) return 'none';
    const owned = [...this.actor.items].map(item => (item.allTags instanceof Set ? item.allTags : getItemAllTags(item)));
    return GRIND_MAP_TAGS.find(row => owned.some(tags => tags.has(row.tag)))?.mapType ?? 'none';
  }

  /**
   * Resolve all active crawlers in the world
   * @returns {Actor[]}
   */
  _getAllCrawlers() {
    if (globalThis.game?.actors) {
      const list = Array.from(globalThis.game.actors.values());
      const crawlers = list.filter(a => a.type === 'crawler');
      if (crawlers.length > 0) return crawlers;
    }
    return this.actor ? [this.actor] : [];
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const allCrawlers = this._getAllCrawlers();

    // Active crawler for skills inspection & individual hour allocation
    if (!this.activeCrawlerId || !allCrawlers.some(c => c.id === this.activeCrawlerId)) {
      this.activeCrawlerId = this.actor?.id || allCrawlers[0]?.id || null;
    }

    const activeCrawler = allCrawlers.find(c => c.id === this.activeCrawlerId) || this.actor || allCrawlers[0] || null;
    this.actor = activeCrawler;
    context.actor = activeCrawler;

    context.hours = this.hours;
    context.hasGuideBonus = this.hasGuideBonus;
    context.floorNumber = this.floorNumber;
    context.rollComplication = this.rollComplication;

    const { safeThreshold, mapBonus } = getSafeGrindingThreshold({
      hasGuideBonus: this.hasGuideBonus,
      mapType: this.mapType
    });
    const excessHours = Math.max(0, this.hours - safeThreshold);
    context.mapType = this.mapType;
    context.mapBonus = mapBonus;
    context.safeThreshold = safeThreshold;
    context.excessHours = excessHours;
    context.isMapNone = this.mapType === 'none';
    context.isMapNeighborhood = this.mapType === 'neighborhood';
    context.isMapBorough = this.mapType === 'borough' || this.mapType === 'burrough';

    // Global Floor Timer Clock
    const floorTimer = COGActor.getFloorTimer();
    context.floorTimer = floorTimer;
    context.resultingFloorTimer = Math.max(0, floorTimer - this.hours);

    // Map Party Roster
    const lowestIds = this._lowestLevelBonusIds();
    context.crawlers = allCrawlers.map(c => {
      const isSelected = this.selectedActorIds.has(c.id);
      const isActive = c.id === this.activeCrawlerId;
      const actorBanked = Number(c.system?.details?.bankedGrindHours ?? c.system?.bankedGrindHours) || 0;
      return {
        id: c.id,
        name: c.name,
        img: c.img || 'icons/svg/mystery-man.svg',
        bankedHours: actorBanked,
        level: Number(c.system?.details?.level) || 1,
        grindLevelHours: Number(c.system?.details?.grindLevelHours) || 0,
        lowestLevelBonus: lowestIds.has(c.id),
        isSelected,
        isActive
      };
    });
    context.selectedCount = Array.from(this.selectedActorIds).length;
    context.advancementControls = buildAdvancementControls(this._selectedCrawlers());

    // Active Crawler Banked Hours
    const activeBanked = Number(activeCrawler?.system?.details?.bankedGrindHours ?? activeCrawler?.system?.bankedGrindHours) || 0;
    const bankedHours = (this.lastGrindResult?.bankedHours !== undefined && this.lastGrindResult?.actorId === activeCrawler?.id)
      ? this.lastGrindResult.bankedHours
      : activeBanked;
    context.bankedHours = bankedHours;
    context.lastGrindResult = this.lastGrindResult || null;

    // Active Crawler Endurance stats
    const allSkills = advancingItemsOf(activeCrawler);
    // The Endurance skill by identifier (never by name, moves the identifier to the registry)
    const endRank = ruleSkillRank(activeCrawler, 'fatigueCheck');
    const conMod = activeCrawler?.system?.abilities?.con?.mod ?? 0;
    context.enduranceRank = endRank;
    context.conMod = conMod;
    context.enduranceBonusStr = (endRank + conMod) >= 0 ? `+${endRank + conMod}` : `${endRank + conMod}`;

    // Map Active Crawler Skills for in-app allocation & advancement
    const mappedSkills = allSkills.map(skill => {
      const baseRank = Number(skill.system?.rank) || 0;
      const modifiedRank = Number(skill.modifiedRank ?? skill.system?.modifiedRank ?? baseRank);
      const isChecked = Boolean(skill.system?.checked);
      const reqHours = getRequiredGrindingHours(baseRank);
      const target = getAdvancementTarget(baseRank);
      const investedHours = Number(skill.system?.investedHours ?? skill.system?.grindHours) || 0;
      const neededHours = Math.max(0, reqHours - investedHours);
      const isSelected = skill.id === this.selectedSkillId;
      const canAdvance = investedHours >= reqHours;
      // Grinding closed at this Rank: the skill is listed after the others and labelled; putting hours in asks a Rule Break.
      const grindClosed = !routeAllowsGain(skill, ADVANCEMENT_ROUTES.grind, baseRank);
      const canAddHour = bankedHours > 0 && investedHours < reqHours;
      const canSubHour = investedHours > 0;
      const progressPct = Math.min(100, Math.round((investedHours / Math.max(1, reqHours)) * 100));

      return {
        id: skill.id,
        name: skill.name,
        img: skill.img || 'icons/svg/item-bag.svg',
        baseRank,
        modifiedRank,
        stat: (skill.system?.stat || (skill.type === 'spell' ? 'int' : 'str')).toUpperCase(),
        isSpell: skill.type === 'spell',
        checked: isChecked,
        requiredHours: reqHours,
        investedHours,
        neededHours,
        canAddHour,
        canSubHour,
        progressPct,
        target,
        isSelected,
        canAdvance,
        grindClosed
      };
    });

    // Auto-select first checked skill if none selected
    if (!this.selectedSkillId && mappedSkills.length > 0) {
      const firstChecked = mappedSkills.find(s => s.checked);
      if (firstChecked) {
        this.selectedSkillId = firstChecked.id;
        firstChecked.isSelected = true;
      }
    }

    // Sort: grinding-closed skills last, then selected first, then checked, then alphabetical
    mappedSkills.sort((a, b) => {
      if (a.grindClosed !== b.grindClosed) return a.grindClosed ? 1 : -1;
      if (a.isSelected) return -1;
      if (b.isSelected) return 1;
      if (a.checked && !b.checked) return -1;
      if (!a.checked && b.checked) return 1;
      return a.name.localeCompare(b.name);
    });

    context.skills = mappedSkills;
    context.selectedSkill = mappedSkills.find(s => s.id === this.selectedSkillId) || null;
    await this._prepareTablePicker(context);

    return context;
  }

  /**
   * The table picker's context: a floor-table select and a neighbourhood-table select, each "Default", "None", then its
   * scope's tables and the "Other" ones, with `selected` precomputed from the GM's stored pick. The lists are read once per render.
   * A non-GM sees them disabled: the session reads the GM's pick.
   */
  async _prepareTablePicker(context) {
    const lists = await listGrindTables({ floor: this.floorNumber });
    const stored = storedGrindPicks();
    const canEdit = Boolean(game.user?.isGM);
    const lang = (key) => game.i18n?.localize?.(`COG.Content.GrindTables.${key}`) ?? key;
    const slot = (key, list, groupKey, action) => {
      const pick = honouredGrindPick(stored[key], list, lists.other, this.floorNumber);
      const option = (ref, label) => ({ ref, label, selected: ref === pick });
      const group = (label, tables) => ({ label, options: tables.map((tb) => option(tb.ref, tb.label)) });
      return {
        key, action, label: lang(groupKey), disabled: !canEdit,
        leading: [option('', lang('Default')), option('none', lang('None'))],
        groups: [group(lang(groupKey), list), group(lang('GroupOther'), lists.other)].filter((g) => g.options.length)
      };
    };
    const floor = slot('floor', lists.floor, 'GroupFloor', 'setGrindFloorTable');
    const neighborhood = slot('neighborhood', lists.neighborhood, 'GroupNeighborhood', 'setGrindNeighborhoodTable');
    context.grindTables = { canEdit, selects: [floor, neighborhood] };
  }

  /** The GM's pick for one slot goes into the `grindTables` world setting; a player's change writes nothing. */
  static async #setGrindTable(slot, target) {
    if (!game.user?.isGM) return;
    await game.settings.set(SYSTEM_ID, GRIND_TABLES_SETTING, { floor: '', neighborhood: '', ...storedGrindPicks(), [slot]: String(target.value ?? '') });
    await this.render();
  }

  static async #onSetGrindFloorTable(event, target) {
    return COGGrindApp.#setGrindTable.call(this, 'floor', target);
  }

  static async #onSetGrindNeighborhoodTable(event, target) {
    return COGGrindApp.#setGrindTable.call(this, 'neighborhood', target);
  }

  static async #onSetHours(event, target) {
    const val = parseInt(target.value, 10);
    if (!isNaN(val) && val >= 1) {
      this.hours = val;
      await this.render();
    }
  }

  static async #onSetFloor(event, target) {
    const val = parseInt(target.value, 10);
    if (!isNaN(val) && val >= 1) {
      this.floorNumber = val;
      await this.render();
    }
  }

  static async #onSetGuideBonus(event, target) {
    this.hasGuideBonus = target.checked;
    await this.render();
  }

  static async #onSetMapType(event, target) {
    this.mapType = target.value;
    await this.render();
  }

  static #onSetComplication(event, target) {
    this.rollComplication = target.checked;
  }

  static async #onSetFloorTimer(event, target) {
    if (!globalThis.game?.user?.isGM) return;
    const val = parseFloat(target.value);
    if (Number.isFinite(val)) {
      await COGActor.setFloorTimer(val);
      await this.render();
    }
  }

  static async #onToggleCrawler(event, target) {
    const actorId = target.dataset.actorId;
    if (!actorId) return;
    this.selectedActorIds ??= new Set();
    if (target.checked) {
      this.selectedActorIds.add(actorId);
    } else {
      this.selectedActorIds.delete(actorId);
    }
    this.lowestLevelOverrides.clear();
    await this.render();
  }

  static async #onToggleLowestBonus(event, target) {
    const actorId = target.dataset.actorId;
    if (!actorId) return;
    this.lowestLevelOverrides.set(actorId, Boolean(target.checked));
  }

  static async #onSelectCrawler(event, target) {
    const actorId = target.dataset.actorId;
    if (actorId) {
      this.activeCrawlerId = actorId;
      this.selectedSkillId = null;
      await this.render();
    }
  }

  static async #onSelectSkill(event, target) {
    const skillId = target.dataset.skillId;
    if (skillId) {
      this.selectedSkillId = skillId;
      await this.render();
    }
  }

  static async #onAllocateHours(event, target) {
    const skillId = target.dataset.skillId;
    const mode = target.dataset.mode;
    if (!this.actor || !skillId) return;

    let allocRes = null;
    if (mode === 'add') {
      allocRes = await this.actor.allocateGrindHours(skillId, 1);
    } else if (mode === 'sub') {
      allocRes = await this.actor.allocateGrindHours(skillId, -1);
    } else if (mode === 'max') {
      const skill = this.actor.items?.get(skillId);
      const req = getRequiredGrindingHours(skill?.system?.rank || 0);
      const invested = Number(skill?.system?.investedHours ?? skill?.system?.grindHours) || 0;
      const needed = Math.max(0, req - invested);
      allocRes = await this.actor.allocateGrindHours(skillId, needed);
    }
    if (this.lastGrindResult && allocRes?.newBank !== undefined) {
      this.lastGrindResult.bankedHours = allocRes.newBank;
    }
    await this.render();
  }

  static async #onAttemptAdvancement(event, target) {
    const skillId = target.dataset.skillId;
    if (!this.actor || !skillId) return;
    const skill = this.actor.items?.get(skillId);
    if (skill) await this.actor.attemptSkillAdvancement(skillId, await patronGrindOptions(this.actor, skill));
    await this.render();
  }

  /**
   * Crawlers whose "lowest-Level party member" box is ticked: the selected party's strictly lowest Level
   * (a tie ticks nobody), with the GM's own ticks taking over.
   * @returns {Set<string>}
   */
  _lowestLevelBonusIds() {
    const members = this._selectedCrawlers().map(c => ({ id: c.id, level: Number(c.system?.details?.level) || 1 }));
    const ids = lowestLevelBonusMembers(members);
    for (const [id, checked] of this.lowestLevelOverrides) {
      if (checked) ids.add(id);
      else ids.delete(id);
    }
    return ids;
  }

  /** Crawlers ticked in the roster. */
  _selectedCrawlers() {
    return this._getAllCrawlers().filter(c => this.selectedActorIds?.has(c.id));
  }

  static async #onRunTwoHourCheck() {
    await runAdvancementControl('two-hour', this._selectedCrawlers(), this.element);
    await this.render();
  }

  static async #onRunFloorCheck() {
    await runAdvancementControl('floor', this._selectedCrawlers(), this.element);
    await this.render();
  }

  static async #onRunSkillCheck() {
    await runAdvancementControl('skill', this._selectedCrawlers(), this.element);
    await this.render();
  }

  static async #onAwardLevels() {
    const selected = this._selectedCrawlers();
    await openAwardLevels(selected, { preselect: selected });
  }

  static async #onDismissAlert() {
    this.lastGrindResult = null;
    await this.render();
  }

  /** Execute the grind for every selected party crawler. */
  static async #onExecuteGrind() {
    const allCrawlers = this._getAllCrawlers();
    const participants = allCrawlers.filter(c => this.selectedActorIds.has(c.id));
    if (participants.length === 0) {
      if (globalThis.ui?.notifications) {
        globalThis.ui.notifications.warn('Please select at least one crawler in the party to grind.');
      }
      return;
    }

    const { mapBonus } = getSafeGrindingThreshold({ mapType: this.mapType });
    const options = {
      hours: this.hours,
      hasGuideBonus: this.hasGuideBonus,
      mapType: this.mapType,
      mapBonus,
      hasNeighborhoodMap: this.mapType === 'neighborhood',
      hasBoroughMap: this.mapType === 'borough' || this.mapType === 'burrough',
      hasBurroughMap: this.mapType === 'borough' || this.mapType === 'burrough',
      floor: this.floorNumber,
      rollComplication: this.rollComplication,
      resetPool: true, // Use it or lose it
      lowestLevelBonusIds: [...this._lowestLevelBonusIds()]
    };

    const result = await COGActor.executePartyGrindSession(participants, options);
    this.lastGrindResult = result;
    await this.render();
  }

  static async #onSafeRoomRest() {
    if (!this.actor) return;
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Safe Room Rest' },
      content: '<p>Retreat to a Safe Room for an <strong>8-Hour Long Rest</strong>? This will fully refill your 10 Health Bars, restore all Mana, and clear all stacked Fatigued debuffs.</p>',
      rejectClose: false
    });
    if (proceed) {
      await this.actor.restSafeRoom();
      await this.close();
    }
  }
}
