/**
 * Sprinter RPG — Fast Matrix Crawler Character Creator
 * Guided application that generates legal Crawlers from official rulebook matrices,
 * standard stat array [2, 3, 4, 5, 6], species rules, and floor starting options.
 */

import { COG_STANDARD_ARRAY, validateStatArray, generateRandomCrawler } from '../data/rules/crawler-creation-rules.mjs';
import {
  STARTER_RANK, STARTER_POTION_COUNT, loadoutOptions, loadoutLabel, findLoadout, defaultLoadout, resolveLoadoutId, getStarterWeaponDefinition,
  starterUnarmedPayloads
} from '../content/creation-loadouts.mjs';
import { rollBackgroundTable, storyTableView } from '../data/rules/background-table-rules.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { DEFAULT_SIZE, getSizeInfo, sizeOptions as buildSizeOptions } from '../data/sizes.mjs';
import { findCatalogEntry } from '../content/catalog-lookup.mjs';
import { getCOGStatModifier } from '../documents/actor.mjs';
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH, SYSTEM_ID } from '../constants.mjs';
import { requestRelay, registerRelayAction } from '../utils/gm-relay.mjs';
import { confirmRuleBreak } from '../utils/rule-break.mjs';
import { floorLabel } from '../documents/actor/actor-environment.mjs';
import { CREATOR_START_FLOORS, startLevelForFloor } from '../data/floor-arrivals.mjs';
import { openFloorSimulator } from './floor-simulator/floor-simulator-app.mjs';
import { pendingFloorRun } from './floor-simulator/pending.mjs';
import { sourceryThemeInactive } from '../content/sourcery-content-provider.mjs';
import { buildPayload } from '../data/builders/item-payload.mjs';
// The builder module also registers the `crawler` payload delegate that `buildPayload('crawler')` reaches.
import { resolveCreatorSpecies, starterHotlist } from '../data/builders/crawler-payload.mjs';

/** A background's selection key: its `id` when the matrix row has one, else its name. */
const bgKey = (bg) => bg?.id ?? bg?.name;
/** A matrix skill's selection key: the catalog `ref` when the row has one, else its name. */
const skillKey = (s) => (typeof s === 'string' ? s : (s?.ref ?? s?.name)) ?? '';

/** The default pick for one stage: the first background and its first 2 skills (empty when the stage has none). */
function defaultStageSelection(rows = []) {
  const bg = rows[0];
  if (!bg) return { background: '', skills: [] };
  return { backgroundId: bgKey(bg), background: bg.name, skills: [skillKey(bg.skills?.[0]), skillKey(bg.skills?.[1])].filter(Boolean) };
}

const TRAITS = ['pastTrauma', 'looseEnds', 'regrets'];
/** The story step's cards: label, icon and the creator input names (the table itself comes from the registry). */
const STORY_CARDS = Object.freeze({
  pastTrauma: { label: 'Past Trauma', icon: 'fa-heart-crack', inputName: 'creator-past-trauma', placeholder: 'Enter or edit crawler trauma...' },
  looseEnds: { label: 'Loose Ends', icon: 'fa-hourglass-half', inputName: 'creator-loose-ends', placeholder: 'Enter or edit crawler loose end...' },
  regrets: { label: 'Regrets', icon: 'fa-clock-rotate-left', inputName: 'creator-regrets', placeholder: 'Enter or edit crawler regret...' }
});
const TPL = `${SYSTEM_PATH}/templates/apps/crawler-creator`;

/**
 * The creator's authoring state: one spec object, the same keys `buildPayload('crawler', spec)` reads.
 * Called with no options it is the blank draft: the first species, Medium, the standard array unset and a random crawler #.
 * @param {object} [options={}]
 * @returns {object}
 */
function creatorSpec(options = {}) {
  return {
    name: options.name || 'New Crawler',
    crawlerNumber: options.crawlerNumber || `#${Math.floor(1000 + Math.random() * 9000)}`,
    species: resolveCreatorSpecies(options.species).id,
    floor: floorLabel(options.floor),
    size: options.size || DEFAULT_SIZE,

    // Background story traits (Step 9: Traumas, Loose Ends, Regrets)
    pastTrauma: options.pastTrauma || '',
    looseEnds: options.looseEnds || '',
    regrets: options.regrets || '',

    // Starter combat loadout (Level 1)
    starterMode: options.starterMode || 'weapon', // 'weapon' | 'spell' | 'unarmed'
    starterWeapon: resolveLoadoutId('weapon', options.starterWeapon),
    starterSpell: resolveLoadoutId('spell', options.starterSpell),
    starterUnarmed: resolveLoadoutId('unarmed', options.starterUnarmed),

    // Standard array assignments for stats
    stats: {
      str: options.stats?.str ?? null,
      dex: options.stats?.dex ?? null,
      con: options.stats?.con ?? null,
      int: options.stats?.int ?? null,
      cha: options.stats?.cha ?? null
    },

    // Life Stage Tier Selections: a background by id (`backgroundId`) and its skills by ref
    tierSelections: {
      tier1: { backgroundId: '', background: '', skills: [] },
      tier2: { backgroundId: '', background: '', skills: [] },
      tier3: { backgroundId: '', background: '', skills: [] },
      tier4: { backgroundId: '', background: '', skills: [] }
    }
  };
}

/**
 * The Crawler Creator's form descriptor, the shape `MOB_CREATOR_FORM` has: `state` is what the `data-prop` attributes
 * bind to. The creator has no repeating rows or pick lists yet, so `rows` and `pickLists` are empty.
 */
export const CRAWLER_CREATOR_FORM = Object.freeze({
  state: (app) => app.spec,
  rows: Object.freeze({}),
  pickLists: Object.freeze({})
});

export class COGCrawlerCreatorApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-crawler-creator',
    classes: ['cog-sheet-window', 'cog-crawler-creator-window'],
    window: { title: 'Sprinter RPG — Crawler Induction Terminal', icon: 'fa-solid fa-skull-crossbones', resizable: true },
    position: { width: 960, height: 840 },
    actions: {
      setName: COGCrawlerCreatorApp.#onSetName,
      setNumber: COGCrawlerCreatorApp.#onSetNumber,
      setSpecies: COGCrawlerCreatorApp.#onSetSpecies,
      setSize: COGCrawlerCreatorApp.#onSetSize,
      setFloor: COGCrawlerCreatorApp.#onSetFloor,
      setStat: COGCrawlerCreatorApp.#onSetStat,
      setTierBackground: COGCrawlerCreatorApp.#onSetTierBackground,
      toggleSkill: COGCrawlerCreatorApp.#onToggleSkill,
      setStarterMode: COGCrawlerCreatorApp.#onSetStarterMode,
      setStarterWeapon: COGCrawlerCreatorApp.#onSetStarterWeapon,
      setStarterSpell: COGCrawlerCreatorApp.#onSetStarterSpell,
      setStarterUnarmed: COGCrawlerCreatorApp.#onSetStarterUnarmed,
      pickTrait: COGCrawlerCreatorApp.#onPickTrait,
      setTrait: COGCrawlerCreatorApp.#onSetTrait,
      rollTrait: COGCrawlerCreatorApp.#onRollTrait,
      rollAllTraits: COGCrawlerCreatorApp.#onRollAllTraits,
      randomize: COGCrawlerCreatorApp.#onRandomize,
      resetDefaults: COGCrawlerCreatorApp.#onResetDefaults,
      createCrawler: COGCrawlerCreatorApp.#onCreateCrawler
    }
  };

  // One part per wizard section. Each action re-renders only the sections its change can affect.
  static PARTS = {
    identity: { template: `${TPL}/identity.hbs` },
    stats: { template: `${TPL}/stats.hbs` },
    matrix: { template: `${TPL}/matrix.hbs` },
    loadout: { template: `${TPL}/loadout.hbs` },
    story: { template: `${TPL}/story.hbs` },
    summary: { template: `${TPL}/summary.hbs` },
    footer: { template: `${TPL}/footer.hbs` }
  };

  constructor(options = {}) {
    super(options);

    this.spec = creatorSpec(options);
    this._initializeDefaultSelections();
  }

  /**
   * Set sensible default background and skill selections for the current species.
   */
  _initializeDefaultSelections() {
    const matrix = resolveCreatorSpecies(this.spec.species).matrices || {};
    for (let i = 1; i <= 4; i++) this.spec.tierSelections[`tier${i}`] = defaultStageSelection(matrix[`tier${i}`]);

    // Default standard array if not already provided
    if (!this.spec.stats.str && !this.spec.stats.dex && !this.spec.stats.con && !this.spec.stats.int && !this.spec.stats.cha) {
      this.spec.stats = { str: 5, con: 6, int: 2, dex: 4, cha: 3 };
    }
  }

  /**
   * Content was re-registered (a Sourcery import, a theme sync): keep every pick that still names a row, give the
   * stage that lost its background (or never had one) the default, and redraw.
   */
  async refreshContent() {
    const matrix = resolveCreatorSpecies(this.spec.species).matrices || {};
    for (let i = 1; i <= 4; i++) {
      const key = `tier${i}`;
      const rows = matrix[key] || [];
      const sel = this.spec.tierSelections[key];
      const stillThere = rows.some(b => (sel?.backgroundId ? bgKey(b) === sel.backgroundId : b.name === sel?.background));
      if (!stillThere) this.spec.tierSelections[key] = defaultStageSelection(rows);
    }
    await this.render();
  }

  /**
   * Plain-language list of the official rules the current draft breaks (empty when none).
   * A stage whose species has no backgrounds cannot supply 2 skills, so it is reported as its own reason.
   * @returns {string[]}
   */
  _ruleBreakReasons() {
    const reasons = [];
    const statValidation = validateStatArray(this.spec.stats);
    if (!statValidation.valid) reasons.push(`${String(statValidation.error || 'Invalid stat array').replace(/\.$/, '')}.`);
    const matrix = resolveCreatorSpecies(this.spec.species)?.matrices || {};
    const incomplete = [];
    const noBackgrounds = [];
    for (const i of [1, 2, 3, 4]) {
      const key = `tier${i}`;
      if (this.spec.tierSelections[key]?.skills?.length === 2) continue;
      incomplete.push(i);
      if (!(matrix[key] || []).length) noBackgrounds.push(i);
    }
    if (incomplete.length) {
      reasons.push(`Every stage needs exactly 2 skills (incomplete: stage ${incomplete.join(', ')}).`);
      if (noBackgrounds.length) reasons.push(`This species has no backgrounds for stage ${noBackgrounds.join(', ')}.`);
    }
    return reasons;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const speciesData = resolveCreatorSpecies(this.spec.species);
    const matrix = speciesData.matrices || {};
    const tierLabels = speciesData?.tierLabels || { tier1: 'Origin', tier2: 'Training', tier3: 'Profession', tier4: 'Specialty' };
    const tierRanks = speciesData?.tierRanks || { tier1: 1, tier2: 1, tier3: 3, tier4: 2 };

    // Stat array validation & remaining pool numbers
    const statValidation = validateStatArray(this.spec.stats);
    const assignedValues = Object.values(this.spec.stats).map(Number).filter(n => Number.isInteger(n) && n > 0);
    const availableNumbers = COG_STANDARD_ARRAY.map(num => ({
      value: num,
      used: assignedValues.filter(v => v === num).length > 1 ? 'duplicate' : assignedValues.includes(num)
    }));

    const statList = [
      { key: 'str', label: 'Strength', short: 'STR', value: this.spec.stats.str },
      { key: 'dex', label: 'Dexterity', short: 'DEX', value: this.spec.stats.dex },
      { key: 'con', label: 'Constitution', short: 'CON', value: this.spec.stats.con },
      { key: 'int', label: 'Intelligence', short: 'INT', value: this.spec.stats.int },
      { key: 'cha', label: 'Charisma', short: 'CHA', value: this.spec.stats.cha }
    ];

    // Build the 4 life stage tier views
    const tiers = [];
    for (let i = 1; i <= 4; i++) {
      const tierKey = `tier${i}`;
      const label = tierLabels[tierKey] || tierKey;
      const rank = tierRanks[tierKey] ?? 1;
      const backgrounds = matrix[tierKey] || [];
      const currentSel = this.spec.tierSelections[tierKey] || { background: '', skills: [] };

      const activeBg = backgrounds.find(b => currentSel.backgroundId && bgKey(b) === currentSel.backgroundId)
        || backgrounds.find(b => b.name === currentSel.background) || backgrounds[0] || { name: '', skills: [] };
      const selectedSkillSet = new Set((currentSel.skills || []).map(s => s.toLowerCase().trim()));

      const skills = activeBg.skills.map(s => {
        const isChecked = selectedSkillSet.has(skillKey(s).toLowerCase().trim());
        return {
          key: skillKey(s),
          name: s.name,
          stat: (s.stat || 'none').toUpperCase(),
          checked: isChecked
        };
      });

      tiers.push({
        key: tierKey,
        label,
        rank,
        backgrounds: backgrounds.map(b => ({
          key: bgKey(b),
          name: b.name,
          selected: bgKey(b) === bgKey(activeBg)
        })),
        activeBackground: activeBg.name,
        skills,
        selectedCount: currentSel.skills.length,
        isValid: currentSel.skills.length === 2
      });
    }

    // Resolve final skills, ranks, and duplicate warnings
    const resolved = contentRegistry.resolveSkillRanks(this.spec.species, this.spec.tierSelections);

    const floorOptions = CREATOR_START_FLOORS.map((n) => {
      const value = floorLabel(n);
      return { value, label: `${value} (Level ${startLevelForFloor(n)})`, selected: this.spec.floor === value };
    });

    const sizeInfo = getSizeInfo(this.spec.size);
    const sizeOptions = buildSizeOptions(this.spec.size);

    // Starter loadout options (Level 1)
    const starterModeOptions = [
      { key: 'weapon', label: 'Basic Weapon', desc: 'Rank 3 Weapon Skill', icon: 'fa-solid fa-sword', selected: this.spec.starterMode === 'weapon' },
      { key: 'spell', label: 'Starter Spell', desc: 'Rank 3 Spell + 5 Mana Potions', icon: 'fa-solid fa-wand-magic-sparkles', selected: this.spec.starterMode === 'spell' },
      { key: 'unarmed', label: 'Unarmed & Damage Effect', desc: 'Rank 3 H2H & Effect Combo', icon: 'fa-solid fa-hand-fist', selected: this.spec.starterMode === 'unarmed' }
    ];

    const optionRows = (slot, selectedId, extra = () => ({})) => loadoutOptions(slot).map(o => ({
      id: o.id,
      name: slot === 'spell' ? loadoutLabel(o) : o.name,
      selected: o.id === selectedId,
      baseline: Boolean(o.baseline),
      ...extra(o)
    }));
    const starterWeaponOptions = optionRows('weapon', resolveLoadoutId('weapon', this.spec.starterWeapon));
    const starterSpellOptions = optionRows('spell', resolveLoadoutId('spell', this.spec.starterSpell));
    const starterUnarmedOptions = optionRows('unarmed', resolveLoadoutId('unarmed', this.spec.starterUnarmed), o => ({ label: loadoutLabel(o) }));
    const activeWeapon = getStarterWeaponDefinition(resolveLoadoutId('weapon', this.spec.starterWeapon));
    const activeSpell = findLoadout('spell', this.spec.starterSpell) ?? defaultLoadout('spell');
    const activeUnarmed = findLoadout('unarmed', this.spec.starterUnarmed) ?? defaultLoadout('unarmed');
    const potionEntry = defaultLoadout('potion');
    const starterPotion = { name: potionEntry?.name ?? '', baseline: Boolean(potionEntry?.baseline) };
    const loadoutExampleOnly = this.spec.starterMode === 'spell' ? Boolean(activeSpell?.baseline)
      : this.spec.starterMode === 'unarmed' ? Boolean(activeUnarmed?.baseline) : false;

    // Compute display skills incorporating the starter package for summary display
    const displaySkillsMap = new Map();
    for (const s of resolved.skills) {
      displaySkillsMap.set(s.name.toLowerCase().trim(), { ...s });
    }

    const addStarterDisplay = (name, stat) => {
      const norm = String(name).toLowerCase().trim();
      const existing = displaySkillsMap.get(norm);
      if (existing) {
        existing.rank = Math.max(existing.rank, STARTER_RANK);
        existing.isStarter = true;
      } else {
        displaySkillsMap.set(norm, { name, rank: STARTER_RANK, stat: String(stat || 'str').toLowerCase(), isStarter: true });
      }
    };
    if (this.spec.starterMode === 'weapon') {
      const canonical = findCatalogEntry('skills', activeWeapon.skillIdentifier);
      addStarterDisplay(canonical?.name ?? activeWeapon.name, canonical?.system?.stat ?? activeWeapon.toHitStat);
    } else if (this.spec.starterMode === 'unarmed') {
      const pkg = starterUnarmedPayloads(activeUnarmed, []);
      for (const part of [pkg.skill, pkg.effect]) if (part) addStarterDisplay(part.name, part.system?.stat);
    }

    const allTiersValid = tiers.every(t => t.isValid);
    // canCreate means "meets every official rule"; the Create button itself is never disabled.
    const ruleBreakReasons = this._ruleBreakReasons();
    const canCreate = ruleBreakReasons.length === 0 && allTiersValid;

    const conMod = getCOGStatModifier(this.spec.stats.con);
    const startingHp = 10 * conMod;
    const startingMana = Number(this.spec.stats.int) || 0;

    const registeredTables = contentRegistry.getBackgroundTables();
    const hasBackgroundTables = TRAITS.some(key => registeredTables[key]?.results?.length);
    // One card per story trait; each shows the registered table's own name and die (samples, bundled or imported).
    const storyTables = TRAITS.map(key => {
      const view = storyTableView(key, registeredTables);
      const value = this.spec[key];
      return {
        key,
        ...STORY_CARDS[key],
        tableName: view.tableName,
        formula: view.formula,
        value,
        options: view.results.map(r => ({ roll: r.roll, text: r.text, selected: r.text === value }))
      };
    });
    const backgroundTables = Object.fromEntries(storyTables.map(t => [t.key, t]));

    return Object.assign(context, {
      name: this.spec.name,
      crawlerNumber: this.spec.crawlerNumber,
      species: this.spec.species,
      speciesOptions: contentRegistry.getSpeciesList().map(sp => ({
        id: sp.id,
        label: sp.label || sp.id,
        active: sp.id === this.spec.species
      })),
      speciesData,
      size: this.spec.size,
      sizeInfo,
      sizeOptions,
      floor: this.spec.floor,
      floorOptions,
      statList,
      standardArray: COG_STANDARD_ARRAY,
      statValidation,
      availableNumbers,
      startingHp,
      startingMana,
      tiers,
      starterMode: this.spec.starterMode,
      isStarterWeapon: this.spec.starterMode === 'weapon',
      isStarterSpell: this.spec.starterMode === 'spell',
      isStarterUnarmed: this.spec.starterMode === 'unarmed',
      starterWeapon: this.spec.starterWeapon,
      starterWeaponName: activeWeapon.name,
      starterSpell: this.spec.starterSpell,
      starterSpellName: activeSpell ? loadoutLabel(activeSpell) : '',
      starterUnarmed: this.spec.starterUnarmed,
      starterUnarmedLabel: activeUnarmed ? loadoutLabel(activeUnarmed) : '',
      starterPotion,
      starterPotionCount: STARTER_POTION_COUNT,
      loadoutExampleOnly,
      starterModeOptions,
      starterWeaponOptions,
      starterSpellOptions,
      starterUnarmedOptions,
      pastTrauma: this.spec.pastTrauma,
      looseEnds: this.spec.looseEnds,
      regrets: this.spec.regrets,
      hasBackgroundTables,
      // Decision 323: on the cog theme an empty stage points at the Sourcery import that fills it
      sourceryImportHint: contentRegistry.getActiveThemeId() === 'cog',
      backgroundTables,
      storyTables,
      sourceryThemeInactive: sourceryThemeInactive(),
      resolvedSkills: Array.from(displaySkillsMap.values()),
      duplicates: resolved.duplicates,
      warnings: resolved.warnings,
      ruleBreakReasons,
      canCreate
    });
  }

  static #onSetName(event, target) {
    this.spec.name = target.value;
  }

  static #onSetNumber(event, target) {
    this.spec.crawlerNumber = target.value;
  }

  static async #onSetSpecies(event, target) {
    const newSpecies = target.value;
    if (newSpecies === this.spec.species) return;
    this.spec.species = newSpecies;
    this._initializeDefaultSelections();
    await this.render();
  }

  static #onSetSize(event, target) {
    this.spec.size = target.value;
    return this.render({ parts: ['identity'] });
  }

  static #onSetFloor(event, target) {
    this.spec.floor = target.value;
    return this.render({ parts: ['identity'] });
  }

  static #onSetStat(event, target) {
    const val = parseInt(target.value, 10);
    this.spec.stats[target.dataset.stat] = Number.isInteger(val) ? val : null;
    return this.render({ parts: ['stats', 'summary', 'footer'] });
  }

  static async #onSetTierBackground(event, target) {
    const tierKey = target.dataset.tier;
    const matrix = resolveCreatorSpecies(this.spec.species).matrices || {};
    const bg = matrix[tierKey]?.find(b => bgKey(b) === target.value);
    if (!bg) return;
    // Automatically select the first 2 skills of the new background as default
    this.spec.tierSelections[tierKey] = {
      backgroundId: bgKey(bg),
      background: bg.name,
      skills: [skillKey(bg.skills[0]), skillKey(bg.skills[1])].filter(Boolean)
    };
    await this.render({ parts: ['matrix', 'summary', 'footer'] });
  }

  /** Exactly 2 skills per tier: a third pick is refused and the box unchecked. */
  static async #onToggleSkill(event, target) {
    const tierKey = target.dataset.tier;
    const skillName = target.dataset.skill;
    const currentSkills = this.spec.tierSelections[tierKey]?.skills || [];

    if (target.checked) {
      if (currentSkills.length >= 2) {
        target.checked = false;
        ui.notifications?.warn(`You may only pick 2 skills for this stage.`);
        return;
      }
      if (!currentSkills.includes(skillName)) currentSkills.push(skillName);
    } else {
      const idx = currentSkills.indexOf(skillName);
      if (idx !== -1) currentSkills.splice(idx, 1);
    }

    this.spec.tierSelections[tierKey].skills = currentSkills;
    await this.render({ parts: ['matrix', 'summary', 'footer'] });
  }

  static #onSetStarterMode(event, target) {
    this.spec.starterMode = target.value;
    return this.render({ parts: ['loadout', 'summary'] });
  }

  static #onSetStarterWeapon(event, target) {
    this.spec.starterWeapon = target.value;
    return this.render({ parts: ['loadout', 'summary'] });
  }

  static #onSetStarterSpell(event, target) {
    this.spec.starterSpell = target.value;
    return this.render({ parts: ['loadout', 'summary'] });
  }

  static #onSetStarterUnarmed(event, target) {
    this.spec.starterUnarmed = target.value;
    return this.render({ parts: ['loadout', 'summary'] });
  }

  /** Story trait dropdown: fills the matching description. */
  static async #onPickTrait(event, target) {
    const trait = target.dataset.trait;
    if (!TRAITS.includes(trait)) return;
    this.spec[trait] = target.value;
    await this.render({ parts: ['story'] });
  }

  /** Story trait free text; DOM-only. */
  static #onSetTrait(event, target) {
    const trait = target.dataset.trait;
    if (TRAITS.includes(trait)) this.spec[trait] = target.value;
  }

  static async #onRollTrait(event, target) {
    const trait = target.dataset.trait;
    if (!TRAITS.includes(trait)) return;
    await this._rollBackground(trait);
  }

  /**
   * Roll a specific background trait table if tables are registered.
   * @param {string} trait
   * @returns {Promise<object|null>}
   */
  async _rollBackground(trait) {
    const tables = contentRegistry.getBackgroundTables();
    const tableCount = tables?.size ?? Object.keys(tables || {}).length;
    if (tableCount === 0) {
      ui.notifications?.info('No background roll tables registered. Enter custom details manually.');
      return null;
    }
    const res = await rollBackgroundTable(trait);
    if (res?.text && TRAITS.includes(trait)) {
      this.spec[trait] = res.text;
      await this.render({ parts: ['story'] });
      ui.notifications?.info(`Rolled [${res.roll}] on ${res.tableName || trait}: "${res.text}"`);
    }
    return res;
  }

  static async #onRollAllTraits() {
    const tables = contentRegistry.getBackgroundTables();
    const tableCount = tables?.size ?? Object.keys(tables || {}).length;
    if (tableCount === 0) {
      ui.notifications?.info('No background roll tables registered. Enter custom details manually.');
      return;
    }
    const [tRes, lRes, rRes] = await Promise.all([
      rollBackgroundTable('pastTrauma'),
      rollBackgroundTable('looseEnds'),
      rollBackgroundTable('regrets')
    ]);
    if (tRes?.text) this.spec.pastTrauma = tRes.text;
    if (lRes?.text) this.spec.looseEnds = lRes.text;
    if (rRes?.text) this.spec.regrets = rRes.text;
    await this.render({ parts: ['story'] });
    ui.notifications?.info('Rolled all 3 background tables for Past Trauma, Loose Ends, and Regrets.');
  }

  static async #onRandomize() {
    const generated = generateRandomCrawler(this.spec.species, this.spec.floor);
    this.spec.name = generated.name;
    this.spec.crawlerNumber = generated.crawlerNumber;
    this.spec.stats = generated.stats;
    this.spec.tierSelections = generated.tierSelections;
    if (generated.size) this.spec.size = generated.size;
    if (generated.starterMode) this.spec.starterMode = generated.starterMode;
    if (generated.starterWeapon) this.spec.starterWeapon = generated.starterWeapon;
    if (generated.starterSpell) this.spec.starterSpell = generated.starterSpell;
    if (generated.starterUnarmed) this.spec.starterUnarmed = generated.starterUnarmed;
    this.spec.pastTrauma = generated.pastTrauma || '';
    this.spec.looseEnds = generated.looseEnds || '';
    this.spec.regrets = generated.regrets || '';
    await this.render();
    ui.notifications?.info(`Generated random Crawler build: ${this.spec.name} (${this.spec.species.toUpperCase()})`);
  }

  static async #onResetDefaults() {
    this.spec.size = DEFAULT_SIZE;
    this.spec.starterMode = 'weapon';
    this.spec.starterWeapon = resolveLoadoutId('weapon', '');
    this.spec.starterSpell = resolveLoadoutId('spell', '');
    this.spec.starterUnarmed = resolveLoadoutId('unarmed', '');
    this.spec.pastTrauma = '';
    this.spec.looseEnds = '';
    this.spec.regrets = '';
    this._initializeDefaultSelections();
    await this.render();
  }

  static async #onCreateCrawler() {
    await this.createCrawler();
  }

  /**
   * Validate, build document payload, create the Actor, embed all skills, and render the sheet.
   * @returns {Promise<Actor|null>}
   */
  async createCrawler(options = {}) {
    // One prompt lists every rule the draft breaks; creation is never blocked by rules (CONTRIBUTING rule 2).
    const reasons = this._ruleBreakReasons();
    let isRuleBreak = Boolean(options.ruleBreak || options.forceRuleBreak);

    if (reasons.length && !isRuleBreak) {
      const reasonText = reasons.join(' ');
      const confirmRes = await confirmRuleBreak({
        title: 'Crawler Rule Break',
        message: `${reasonText} Create Crawler anyway as a Rule Break?`,
        reason: reasonText,
        options
      });
      if (!confirmRes.confirmed) {
        if (confirmRes.refusal !== 'cancelled') ui.notifications?.error(reasonText);
        return null;
      }
      isRuleBreak = true;
    }

    const payloadWarnings = [];
    const actorPayload = buildPayload('crawler', { ...this.spec, ruleBreak: isRuleBreak }, { warnings: payloadWarnings });
    for (const w of payloadWarnings) ui.notifications?.warn(`${w.path}: ${w.message}`);
    // A background skill whose catalog entry is missing was added as a plain skill: say so (never a silent stub).
    for (const item of actorPayload.items ?? []) {
      const missing = item?.flags?.[SYSTEM_ID]?.missingCatalogRef;
      if (missing) ui.notifications?.warn(`Skill "${item.name}" is not in the skill catalog (${missing}); added as a plain skill.`);
    }


    try {
      let actor = null;
      const canCreateDirectly = Boolean(globalThis.game?.user?.isGM || globalThis.game?.user?.hasPermission?.('ACTOR_CREATE'));

      if (canCreateDirectly) {
        try {
          actor = await Actor.create(actorPayload);
        } catch (directErr) {
          console.warn('Sprinter RPG | Direct actor creation failed, attempting GM relay fallback:', directErr);
          const reply = await requestRelay(RELAY_ACTION_CREATE_CRAWLER, actorPayload);
          if (reply?.ok && reply?.result?.id) {
            const findActor = (id) => globalThis.game?.actors?.get ? globalThis.game.actors.get(id) : globalThis.game?.actors?.find?.(a => a.id === id);
            actor = findActor(reply.result.id);
          } else {
            throw directErr;
          }
        }
      } else {
        const reply = await requestRelay(RELAY_ACTION_CREATE_CRAWLER, actorPayload);
        if (reply?.ok && reply?.result?.id) {
          const findActor = (id) => globalThis.game?.actors?.get ? globalThis.game.actors.get(id) : globalThis.game?.actors?.find?.(a => a.id === id);
          actor = findActor(reply.result.id);
        } else {
          throw new Error(reply?.reason || 'Failed to create Crawler via GM relay.');
        }
      }

      if (actor) {
        // Hotlist slots by the starter-role flag the payload stamped, shared with the pack shaper
        const hotlistUpdates = Object.fromEntries(
          Object.entries(starterHotlist(actor.items)).map(([slot, id]) => [`system.hotlist.${slot}`, id])
        );

        if (Object.keys(hotlistUpdates).length > 0) {
          await actor.update(hotlistUpdates);
        }

        ui.notifications?.info(`Crawler "${actor.name}" has entered the dungeon!`);
        this.close();
        if (pendingFloorRun(actor)) {
          // Floor 3+ start: the simulator runs the arrivals and applies Race and Class
          await (options.openFloorSimulator ?? openFloorSimulator)(actor);
        } else if (actor.sheet) {
          actor.sheet.render({ force: true });
        }
        return actor;
      }
    } catch (err) {
      console.error('Sprinter RPG | Failed to create crawler:', err);
      ui.notifications?.error(`Failed to create Crawler: ${err.message}`);
    }

    return null;
  }
}

export const RELAY_ACTION_CREATE_CRAWLER = 'createCrawlerActor';

registerRelayAction(RELAY_ACTION_CREATE_CRAWLER, {
  authorize: (payload, requester) => {
    return Boolean(requester?.id && typeof requester.id === 'string' && payload && payload.type === 'crawler');
  },
  apply: async (payload, requester) => {
    // Ownership is derived on the GM from the socketlib caller; anything the client sent is discarded.
    const levels = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS;
    const { ownership: _sent, userId: _sentUserId, ...rest } = payload;
    payload = {
      ...rest,
      ownership: { default: levels?.NONE ?? 0, [requester.id]: levels?.OWNER ?? 3 }
    };
    const ActorDoc = globalThis.CONFIG?.Actor?.documentClass ?? globalThis.Actor;
    const actor = await ActorDoc.create(payload);
    return actor ? { id: actor.id, uuid: actor.uuid, name: actor.name } : null;
  }
});
