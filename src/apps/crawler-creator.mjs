/**
 * Sprinter RPG — Fast Matrix Crawler Character Creator
 * Guided application that generates legal Crawlers from official rulebook matrices,
 * standard stat array [2, 3, 4, 5, 6], species rules, and floor starting options.
 */

import {
  COG_STANDARD_ARRAY, STAGE_SKILL_PICKS, STAT_METHODS, CHANCE_STAT_ORDER, validateStats, rollChanceStats, starterLoadoutBreaks, generateRandomCrawler,
  CRAWLER_NUMBER_RANGE, randomCrawlerNumber, speciesSizeRange, speciesTypicalSize, inductionSizeBreaks, startingGearBreaks, STARTING_GEAR_KINDS, sanitizeStartingGear
} from '../data/rules/crawler-creation-rules.mjs';
import {
  STARTER_RANK, STARTER_POTION_COUNT, loadoutOptions, loadoutLabel, findLoadout, defaultLoadout, resolveLoadoutId, getStarterWeaponDefinition,
  starterUnarmedPayloads
} from '../content/creation-loadouts.mjs';
import { rollBackgroundTable, storyTableView } from '../data/rules/background-table-rules.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { DEFAULT_SIZE, getSizeInfo, sizesInOrder, sizeOptions as buildSizeOptions } from '../data/sizes.mjs';
import { findCatalogEntry } from '../content/catalog-lookup.mjs';
import { sourceBadge } from '../utils/content-source.mjs';
import { whenSourceryCatalogsSettled } from '../content/sourcery-content-provider.mjs';
import { getCOGStatModifier } from '../documents/actor.mjs';
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { withFlags } from '../utils/flags.mjs';
import { escapeAttr } from '../utils/escape-attr.mjs';
import { langText } from '../utils/lang-text.mjs';
import { rngPick } from '../utils/rng.mjs';
import { requestRelay, registerRelayAction } from '../utils/gm-relay.mjs';
import { confirmRuleBreak } from '../utils/rule-break.mjs';
import { floorLabel } from '../documents/actor/actor-environment.mjs';
import { CREATOR_START_FLOORS, startLevelForFloor } from '../data/floor-arrivals.mjs';
import { buildFloorArrivalCard } from '../chat/floor-arrival-card.mjs';
import { sourceryNotPrimary } from '../content/sourcery-content-provider.mjs';
import { buildPayload } from '../data/builders/item-payload.mjs';
import { CrawlerCreatorController, INDUCTION_STOP, RACE_CLASS_STOP, unsavedActorSnapshot } from './crawler-creator/controller.mjs';
import { readControl, stageFooter, stagePanel, stagePreview, stageRail } from './crawler-creator/stage-context.mjs';
// The builder module also registers the `crawler` payload delegate that `buildPayload('crawler')` reaches.
import { missingCatalogRefOf, resolveCreatorSpecies, starterHotlist } from '../data/builders/crawler-payload.mjs';

/** A background's selection key: its `id` when the matrix row has one, else its name. */
const bgKey = (bg) => bg?.id ?? bg?.name;
/** A matrix skill's selection key: the catalog `ref` when the row has one, else its name. */
const skillKey = (s) => (typeof s === 'string' ? s : (s?.ref ?? s?.name)) ?? '';

/** The source badge of the catalog document a loadout entry gives (by identifier, never by name), else of its embedded fallback spec. */
function loadoutSourceBadge(slot, entry) {
  const kind = slot === 'spell' ? 'spells' : 'skills';
  const ref = slot === 'spell' ? (entry?.spellIdentifier ?? entry?.id) : entry?.skillIdentifier;
  return sourceBadge(findCatalogEntry(kind, ref) ?? entry?.fallback ?? null);
}

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
const methodText = langText({
  'COG.CrawlerCreator.StatMethod.Array': 'Standard Array',
  'COG.CrawlerCreator.StatMethod.Chance': 'Roll for Stats'
});

const identityText = langText({
  'COG.CrawlerCreator.Identity.SizeOutside': '(Rule Break)',
  'COG.CrawlerCreator.Identity.SizeHint': 'A {species} starts at size {min} to {max} (core p. 112).',
  'COG.CrawlerCreator.Identity.SizeTypical': 'A {species} is typically size {size} (core p. 112).',
  'COG.CrawlerCreator.Identity.NumberHint': 'Any number will do. For simplicity the book suggests one from {min} to {max} (core p. 102).'
});

const gearText = langText({
  'COG.CrawlerCreator.Gear.Kind.clothing': 'Clothing',
  'COG.CrawlerCreator.Gear.Kind.item': 'Interesting or useful item',
  'COG.CrawlerCreator.Gear.Kind.weird': 'Weird stuff',
  'COG.CrawlerCreator.Gear.Add': 'Add {kind}',
  'COG.CrawlerCreator.Gear.KitWeaponSkipped': "{kit}'s weapon was not used: this crawler does not start with a weapon."
});

const TPL = `${SYSTEM_PATH}/templates/apps/crawler-creator`;
const FLOOR_TPL = `${SYSTEM_PATH}/templates/apps/floor-simulator`;
/** The Induction parts: the whole page for a Floor 1 or 2 start, the first stage of a floor start. */
const INDUCTION_PARTS = Object.freeze(['stats', 'matrix', 'loadout', 'story', 'gear', 'summary']);
/** The floor-start parts: the stage rail, the active stage's panel and the sticky preview. */
const STAGE_PARTS = Object.freeze(['rail', 'panel', 'preview']);

/**
 * The creator's authoring state: one spec object, the same keys `buildPayload('crawler', spec)` reads.
 * Called with no options it is the blank draft: the first species, Medium, the standard array unset and a random crawler #.
 * @param {object} [options={}]
 * @returns {object}
 */
function creatorSpec(options = {}) {
  return {
    name: options.name || 'New Crawler',
    crawlerNumber: options.crawlerNumber || randomCrawlerNumber(),
    species: resolveCreatorSpecies(options.species).id,
    floor: floorLabel(options.floor),
    size: options.size || DEFAULT_SIZE,

    // Background story traits (Step 9: Traumas, Loose Ends, Regrets)
    pastTrauma: options.pastTrauma || '',
    looseEnds: options.looseEnds || '',
    regrets: options.regrets || '',
    // The crawler's description (the sheet's Notes field)
    description: options.description || '',

    // Starter combat loadout (Level 1)
    starterMode: options.starterMode || 'weapon', // 'weapon' | 'spell' | 'unarmed'
    starterWeapon: resolveLoadoutId('weapon', options.starterWeapon),
    starterSpell: resolveLoadoutId('spell', options.starterSpell),
    starterUnarmed: resolveLoadoutId('unarmed', options.starterUnarmed),

    // Step 10 starting gear (core p. 113): the gear lines and the name the starting weapon takes
    startingGear: sanitizeStartingGear(options.startingGear),
    starterWeaponName: typeof options.starterWeaponName === 'string' ? options.starterWeaponName : '',

    // Standard array assignments for stats
    stats: {
      str: options.stats?.str ?? null,
      dex: options.stats?.dex ?? null,
      con: options.stats?.con ?? null,
      int: options.stats?.int ?? null,
      cha: options.stats?.cha ?? null
    },

    // How the Stats are set (core p. 109) and the rolls of the chance method; creator-only, never built into the actor
    statMethod: options.statMethod === STAT_METHODS.CHANCE ? STAT_METHODS.CHANCE : STAT_METHODS.ARRAY,
    statRolls: options.statRolls ?? null,

    // Life Stage Tier Selections: a background by id (`backgroundId`) and its skills by ref
    tierSelections: {
      tier1: { backgroundId: '', background: '', skills: [] },
      tier2: { backgroundId: '', background: '', skills: [] },
      tier3: { backgroundId: '', background: '', skills: [] },
      tier4: { backgroundId: '', background: '', skills: [] }
    }
  };
}

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
      setStatMethod: COGCrawlerCreatorApp.#onSetStatMethod,
      rollStats: COGCrawlerCreatorApp.#onRollStats,
      setTierBackground: COGCrawlerCreatorApp.#onSetTierBackground,
      toggleSkill: COGCrawlerCreatorApp.#onToggleSkill,
      setStarterMode: COGCrawlerCreatorApp.#onSetStarterMode,
      setStarterWeapon: COGCrawlerCreatorApp.#onSetStarterWeapon,
      setStarterSpell: COGCrawlerCreatorApp.#onSetStarterSpell,
      setStarterUnarmed: COGCrawlerCreatorApp.#onSetStarterUnarmed,
      pickTrait: COGCrawlerCreatorApp.#onPickTrait,
      setTrait: COGCrawlerCreatorApp.#onSetTrait,
      setDescription: COGCrawlerCreatorApp.#onSetDescription,
      addGearRow: COGCrawlerCreatorApp.#onAddGearRow,
      removeGearRow: COGCrawlerCreatorApp.#onRemoveGearRow,
      setGearField: COGCrawlerCreatorApp.#onSetGearField,
      setStarterWeaponName: COGCrawlerCreatorApp.#onSetStarterWeaponName,
      applyKit: COGCrawlerCreatorApp.#onApplyKit,
      rollTrait: COGCrawlerCreatorApp.#onRollTrait,
      rollAllTraits: COGCrawlerCreatorApp.#onRollAllTraits,
      randomize: COGCrawlerCreatorApp.#onRandomize,
      resetDefaults: COGCrawlerCreatorApp.#onResetDefaults,
      createCrawler: COGCrawlerCreatorApp.#onCreateCrawler,
      // Floor-start stages (the floor templates' controls)
      goStep: COGCrawlerCreatorApp.#onGoStep,
      nextStep: COGCrawlerCreatorApp.#onNextStep,
      prevStep: COGCrawlerCreatorApp.#onPrevStep,
      setField: COGCrawlerCreatorApp.#onSetField,
      rollDie: COGCrawlerCreatorApp.#onRollDie,
      rollAll: COGCrawlerCreatorApp.#onRollAll,
      setPrimary: COGCrawlerCreatorApp.#onSetPrimary,
      togglePick: COGCrawlerCreatorApp.#onTogglePick,
      setMode: COGCrawlerCreatorApp.#onSetMode,
      pickOption: COGCrawlerCreatorApp.#onPickOption,
      swapFormulas: COGCrawlerCreatorApp.#onSwapFormulas,
      adjustStat: COGCrawlerCreatorApp.#onAdjustStat,
      setPoolStat: COGCrawlerCreatorApp.#onSetPoolStat,
      toggleStartingItem: COGCrawlerCreatorApp.#onToggleStartingItem
    }
  };

  // One part per wizard section. Each action re-renders only the sections its change can affect. A Floor 3, 4 or 5
  // start adds the stage rail, the active stage's panel and the sticky preview (the floor templates); the Induction
  // sections are its first stage.
  static PARTS = {
    identity: { template: `${TPL}/identity.hbs` },
    rail: { template: `${FLOOR_TPL}/rail.hbs` },
    stats: { template: `${TPL}/stats.hbs` },
    matrix: { template: `${TPL}/matrix.hbs` },
    loadout: { template: `${TPL}/loadout.hbs` },
    story: { template: `${TPL}/story.hbs` },
    gear: { template: `${TPL}/gear.hbs` },
    summary: { template: `${TPL}/summary.hbs` },
    panel: { template: `${FLOOR_TPL}/panel.hbs` },
    preview: { template: `${FLOOR_TPL}/preview.hbs` },
    footer: { template: `${TPL}/footer.hbs` }
  };

  /**
   * @param {object} [options] Application options and the creator spec's starting values; `floorStartDeps` is passed to
   *   the floor-start controller (tests inject tables, dice and the id seed)
   */
  constructor(options = {}) {
    const { floorStartDeps, ...rest } = options;
    super(rest);

    this.spec = creatorSpec(rest);
    this._initializeDefaultSelections();
    // The floor-start draft (Floors 3-5): the stages after Induction, compiled with the spec through buildPayload
    this.controller = new CrawlerCreatorController(this.spec, { snapshot: unsavedActorSnapshot, ...(floorStartDeps ?? {}) });
  }

  /** Whether the draft is a floor start (the stage rail shows). */
  get staged() {
    return this.controller.staged;
  }

  /** The parts an Induction edit re-renders, plus the stage rail, the preview and the footer of a floor start. */
  _withStages(parts) {
    return this.staged ? [...new Set([...parts, ...STAGE_PARTS, 'footer'])] : parts;
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
    const statValidation = validateStats(this.spec);
    if (!statValidation.valid) reasons.push(`${String(statValidation.error || 'Invalid stat array').replace(/\.$/, '')}.`);
    reasons.push(...starterLoadoutBreaks(this.spec));
    reasons.push(...inductionSizeBreaks(this.spec));
    reasons.push(...startingGearBreaks(this.spec));
    const matrix = resolveCreatorSpecies(this.spec.species)?.matrices || {};
    const incomplete = [];
    const noBackgrounds = [];
    for (const i of [1, 2, 3, 4]) {
      const key = `tier${i}`;
      if (this.spec.tierSelections[key]?.skills?.length === STAGE_SKILL_PICKS) continue;
      incomplete.push(i);
      if (!(matrix[key] || []).length) noBackgrounds.push(i);
    }
    if (incomplete.length) {
      reasons.push(`Every stage needs exactly ${STAGE_SKILL_PICKS} skills (incomplete: stage ${incomplete.join(', ')}).`);
      if (noBackgrounds.length) reasons.push(`This species has no backgrounds for stage ${noBackgrounds.join(', ')}.`);
    }
    return reasons;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    await this.controller.prepare();
    const speciesData = resolveCreatorSpecies(this.spec.species);
    const matrix = speciesData.matrices || {};
    const tierLabels = speciesData?.tierLabels || { tier1: 'Origin', tier2: 'Training', tier3: 'Profession', tier4: 'Specialty' };
    const tierRanks = speciesData?.tierRanks || { tier1: 1, tier2: 1, tier3: 3, tier4: 2 };

    // Stat array validation & remaining pool numbers
    const statValidation = validateStats(this.spec);
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
          sourceBadge: s.ref ? sourceBadge(findCatalogEntry('skills', s.ref)) : null,
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
        isValid: currentSel.skills.length === STAGE_SKILL_PICKS
      });
    }

    // Resolve final skills, ranks, and duplicate warnings
    const resolved = contentRegistry.resolveSkillRanks(this.spec.species, this.spec.tierSelections);

    const floorOptions = CREATOR_START_FLOORS.map((n) => {
      const value = floorLabel(n);
      return { value, label: `${value} (Level ${startLevelForFloor(n)})`, selected: this.spec.floor === value };
    });

    const sizeInfo = getSizeInfo(this.spec.size);
    const sizeRange = speciesSizeRange(this.spec.species);
    const outside = identityText('COG.CrawlerCreator.Identity.SizeOutside');
    const sizeOptions = buildSizeOptions(this.spec.size).map(o => (
      sizeRange && Number.isFinite(o.size) && (o.size < sizeRange.min || o.size > sizeRange.max) ? { ...o, label: `${o.label} ${outside}` } : o
    ));
    const speciesLabel = speciesData.label || speciesData.id || this.spec.species;
    const typicalSize = getSizeInfo(speciesTypicalSize(this.spec.species));
    const sizeHint = sizeRange
      ? identityText('COG.CrawlerCreator.Identity.SizeHint', { species: speciesLabel, ...sizeRange })
      : (speciesTypicalSize(this.spec.species) ? identityText('COG.CrawlerCreator.Identity.SizeTypical', { species: speciesLabel, size: typicalSize.size }) : '');
    const numberFormat = new Intl.NumberFormat('en-US');
    const numberHint = identityText('COG.CrawlerCreator.Identity.NumberHint', { min: numberFormat.format(CRAWLER_NUMBER_RANGE[0]), max: numberFormat.format(CRAWLER_NUMBER_RANGE[1]) });

    // Starter loadout options (Level 1)
    const starterModeOptions = [
      { key: 'weapon', label: 'Basic Weapon', desc: 'Rank 3 Weapon Skill', icon: 'fa-solid fa-sword', selected: this.spec.starterMode === 'weapon' },
      { key: 'spell', label: 'Starter Spell', desc: 'Rank 3 Spell + 5 Mana Potions', icon: 'fa-solid fa-wand-magic-sparkles', selected: this.spec.starterMode === 'spell' },
      { key: 'unarmed', label: 'Unarmed & Damage Effect', desc: 'Rank 3 H2H & Effect Combo', icon: 'fa-solid fa-hand-fist', selected: this.spec.starterMode === 'unarmed' }
    ];

    const optionRows = (slot, selectedId, extra = () => ({})) => loadoutOptions(slot).map(o => ({
      id: o.id,
      name: slot === 'unarmed' ? o.name : loadoutLabel(o),
      selected: o.id === selectedId,
      baseline: Boolean(o.baseline),
      sourceBadge: loadoutSourceBadge(slot, o),
      ...extra(o)
    }));
    const starterWeaponOptions = optionRows('weapon', resolveLoadoutId('weapon', this.spec.starterWeapon));
    const starterSpellOptions = optionRows('spell', resolveLoadoutId('spell', this.spec.starterSpell));
    const starterUnarmedOptions = optionRows('unarmed', resolveLoadoutId('unarmed', this.spec.starterUnarmed), o => ({ label: loadoutLabel(o) }));
    const activeWeapon = getStarterWeaponDefinition(resolveLoadoutId('weapon', this.spec.starterWeapon));
    const activeSpell = findLoadout('spell', this.spec.starterSpell) ?? defaultLoadout('spell');
    const activeUnarmed = findLoadout('unarmed', this.spec.starterUnarmed) ?? defaultLoadout('unarmed');
    const potionEntry = defaultLoadout('potion');
    const starterPotion = { name: potionEntry?.name ?? '', baseline: Boolean(potionEntry?.baseline), sourceBadge: sourceBadge(findCatalogEntry('items', potionEntry?.itemRef)) };
    const kits = loadoutOptions('kit');
    const gearRows = (this.spec.startingGear ?? []).map((row, index) => ({
      index,
      name: row.name ?? '',
      quantity: row.quantity ?? 1,
      kindOptions: STARTING_GEAR_KINDS.map(kind => ({ value: kind, label: gearText(`COG.CrawlerCreator.Gear.Kind.${kind}`), selected: row.kind === kind }))
    }));
    const gearAdd = STARTING_GEAR_KINDS.map(kind => ({ kind, label: gearText('COG.CrawlerCreator.Gear.Add', { kind: gearText(`COG.CrawlerCreator.Gear.Kind.${kind}`) }) }));
    const gearWeapon = { show: this.spec.starterMode === 'weapon', loadoutName: activeWeapon.name, name: this.spec.starterWeaponName ?? '' };
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
    // A floor start's own Rule Breaks (every arrival, Race and Class) show beside the Induction ones
    const floorBreakReasons = this.staged ? this.controller.pendingRuleBreaks().map(b => String(b.reason ?? '').replace(/\.$/, '')) : [];
    const canCreate = ruleBreakReasons.length === 0 && floorBreakReasons.length === 0 && allTiersValid;

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
      sizeHint,
      numberHint,
      floor: this.spec.floor,
      floorOptions,
      statList,
      standardArray: COG_STANDARD_ARRAY,
      statValidation,
      availableNumbers,
      isChanceStats: this.spec.statMethod === STAT_METHODS.CHANCE,
      statMethods: [
        { value: STAT_METHODS.ARRAY, label: methodText('COG.CrawlerCreator.StatMethod.Array'), selected: this.spec.statMethod !== STAT_METHODS.CHANCE },
        { value: STAT_METHODS.CHANCE, label: methodText('COG.CrawlerCreator.StatMethod.Chance'), selected: this.spec.statMethod === STAT_METHODS.CHANCE }
      ],
      startingHp,
      startingMana,
      tiers,
      starterMode: this.spec.starterMode,
      isStarterWeapon: this.spec.starterMode === 'weapon',
      isStarterSpell: this.spec.starterMode === 'spell',
      isStarterUnarmed: this.spec.starterMode === 'unarmed',
      starterWeapon: this.spec.starterWeapon,
      starterWeaponName: activeWeapon.name,
      starterWeaponBadge: loadoutSourceBadge('weapon', activeWeapon),
      starterSpellBadge: activeSpell ? loadoutSourceBadge('spell', activeSpell) : null,
      starterUnarmedBadge: activeUnarmed ? loadoutSourceBadge('unarmed', activeUnarmed) : null,
      starterSpell: this.spec.starterSpell,
      starterSpellName: activeSpell ? loadoutLabel(activeSpell) : '',
      starterUnarmed: this.spec.starterUnarmed,
      starterUnarmedLabel: activeUnarmed ? loadoutLabel(activeUnarmed) : '',
      starterPotion,
      starterPotionCount: STARTER_POTION_COUNT,
      loadoutExampleOnly,
      gearRows,
      gearAdd,
      gearWeapon,
      kitOptions: kits.map(kit => ({ id: kit.id, label: kit.name ?? kit.id })),
      kitExampleOnly: kits.length > 0 && kits.every(kit => kit.baseline),
      starterModeOptions,
      starterWeaponOptions,
      starterSpellOptions,
      starterUnarmedOptions,
      pastTrauma: this.spec.pastTrauma,
      looseEnds: this.spec.looseEnds,
      regrets: this.spec.regrets,
      description: this.spec.description,
      hasBackgroundTables,
      // Decision 323: on the cog theme an empty stage points at the Sourcery import that fills it
      sourceryImportHint: contentRegistry.getPrimaryThemeId() === 'cog',
      backgroundTables,
      storyTables,
      sourceryNotPrimary: sourceryNotPrimary(),
      resolvedSkills: Array.from(displaySkillsMap.values()),
      duplicates: resolved.duplicates,
      warnings: resolved.warnings,
      ruleBreakReasons,
      floorBreakReasons,
      canCreate,
      staged: this.staged,
      stageRail: this.staged ? stageRail(this.controller, { inductionBreaks: ruleBreakReasons.length }) : { empty: true, steps: [] },
      stagePanel: this.staged && this.controller.active !== INDUCTION_STOP ? stagePanel(this.controller) : { panel: null },
      stagePreview: this.staged ? stagePreview(this.controller) : { preview: { available: false } },
      stageFooter: stageFooter(this.controller)
    });
  }

  /** The floor templates read their own top-level keys (`steps`, `panel`, `preview`). @override */
  async _preparePartContext(partId, context, options) {
    const part = await super._preparePartContext(partId, context, options);
    if (partId === 'rail') return { ...part, ...context.stageRail };
    if (partId === 'panel') return { ...part, ...context.stagePanel };
    if (partId === 'preview') return { ...part, ...context.stagePreview };
    return part;
  }

  /** Show the parts of the active stage: the rail and preview for a floor start, Induction or the stage panel. @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    if (!root?.querySelector) return;
    const staged = this.staged;
    const onInduction = !staged || this.controller.active === INDUCTION_STOP;
    root.classList?.toggle('cog-creator-staged', staged);
    const show = (id, visible) => root.querySelector(`[data-application-part="${id}"]`)?.toggleAttribute('hidden', !visible);
    for (const id of INDUCTION_PARTS) show(id, onInduction);
    show('rail', staged);
    show('preview', staged);
    show('panel', staged && !onInduction);
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
    // A species with a size range pulls a size outside it back inside; one with no range leaves the size alone
    const range = speciesSizeRange(newSpecies);
    if (range && inductionSizeBreaks({ species: newSpecies, size: this.spec.size }).length) {
      const inside = sizesInOrder().filter(s => s.size >= range.min && s.size <= range.max);
      this.spec.size = (inside.find(s => s.id === DEFAULT_SIZE) ?? inside[0])?.id ?? this.spec.size;
    }
    this._initializeDefaultSelections();
    await this.render();
  }

  static #onSetSize(event, target) {
    this.spec.size = target.value;
    return this.render({ parts: this._withStages(['identity']) });
  }

  /** A start floor with a run shows the stages (and switching between runs re-plans them): every part re-renders. */
  static #onSetFloor(event, target) {
    const before = this.controller.run.join(',');
    this.spec.floor = target.value;
    if (before === this.controller.run.join(',') && !this.staged) return this.render({ parts: ['identity'] });
    return this.render();
  }

  static #onSetStat(event, target) {
    const val = parseInt(target.value, 10);
    this.spec.stats[target.dataset.stat] = Number.isInteger(val) ? val : null;
    return this.render({ parts: this._withStages(['stats', 'summary', 'footer']) });
  }

  static #onSetStatMethod(event, target) {
    this.spec.statMethod = target.value === STAT_METHODS.CHANCE ? STAT_METHODS.CHANCE : STAT_METHODS.ARRAY;
    return this.render({ parts: this._withStages(['stats', 'summary', 'footer']) });
  }

  static #onRollStats() { return this.rollStats(); }

  /**
   * "Leaving it to Chance" (core p. 109): roll every Stat, keep the rolls as the draft's scores, post the five Rolls to chat.
   * Rolling again before Create replaces them and adds no reason.
   */
  async rollStats() {
    const { rolls, dice } = await rollChanceStats();
    this.spec.statRolls = { ...rolls };
    this.spec.stats = { ...rolls };
    const mode = globalThis.game?.settings?.get?.('core', 'rollMode');
    const data = {
      speaker: globalThis.ChatMessage?.getSpeaker?.(),
      flavor: escapeAttr(CHANCE_STAT_ORDER.map(k => `${k.toUpperCase()} ${rolls[k]}`).join(', ')),
      rolls: dice
    };
    if (mode && typeof globalThis.ChatMessage?.applyMode === 'function') globalThis.ChatMessage.applyMode(data, mode);
    await globalThis.ChatMessage.create(data);
    return this.render({ parts: this._withStages(['stats', 'summary', 'footer']) });
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
    await this.render({ parts: this._withStages(['matrix', 'summary', 'footer']) });
  }

  /** Exactly 2 skills per tier: a third pick is refused and the box unchecked. */
  static async #onToggleSkill(event, target) {
    const tierKey = target.dataset.tier;
    const skillName = target.dataset.skill;
    const currentSkills = this.spec.tierSelections[tierKey]?.skills || [];

    if (target.checked) {
      if (currentSkills.length >= STAGE_SKILL_PICKS) {
        target.checked = false;
        ui.notifications?.warn(`You may only pick ${STAGE_SKILL_PICKS} skills for this stage.`);
        return;
      }
      if (!currentSkills.includes(skillName)) currentSkills.push(skillName);
    } else {
      const idx = currentSkills.indexOf(skillName);
      if (idx !== -1) currentSkills.splice(idx, 1);
    }

    this.spec.tierSelections[tierKey].skills = currentSkills;
    await this.render({ parts: this._withStages(['matrix', 'summary', 'footer']) });
  }

  static #onSetStarterMode(event, target) {
    this.spec.starterMode = target.value;
    return this.render({ parts: this._withStages(['loadout', 'gear', 'summary']) });
  }

  static #onSetStarterWeapon(event, target) {
    this.spec.starterWeapon = target.value;
    return this.render({ parts: this._withStages(['loadout', 'gear', 'summary']) });
  }

  // ---------------------------------------------------------------- Step 10: starting gear

  static #onAddGearRow(event, target) {
    const kind = STARTING_GEAR_KINDS.includes(target.dataset.kind) ? target.dataset.kind : 'weird';
    this.spec.startingGear = [...(this.spec.startingGear ?? []), { kind, name: '', quantity: 1 }];
    return this.render({ parts: this._withStages(['gear', 'footer']) });
  }

  static #onRemoveGearRow(event, target) {
    const index = Number(target.dataset.index);
    this.spec.startingGear = (this.spec.startingGear ?? []).filter((_, i) => i !== index);
    return this.render({ parts: this._withStages(['gear', 'footer']) });
  }

  /**
   * One field of a gear row. A kind re-renders (the footer counts the item lines). A name is DOM-only, except that a
   * row counts only once it is named, so a name going from blank to typed (or back) re-renders the footer alone, which
   * keeps the focus in the name box. A quantity is DOM-only.
   */
  static #onSetGearField(event, target) {
    const row = (this.spec.startingGear ?? [])[Number(target.dataset.index)];
    const field = target.dataset.field;
    if (!row) return undefined;
    if (field === 'name') {
      const wasNamed = String(row.name ?? '').trim() !== '';
      row.name = target.value;
      if (wasNamed !== (String(row.name).trim() !== '')) return this.render({ parts: ['footer'] });
    } else if (field === 'quantity') {
      const quantity = Math.floor(Number(target.value));
      row.quantity = Number.isFinite(quantity) && quantity >= 1 ? quantity : 1;
    } else if (field === 'kind') {
      row.kind = STARTING_GEAR_KINDS.includes(target.value) ? target.value : 'weird';
      return this.render({ parts: this._withStages(['gear', 'footer']) });
    }
    return undefined;
  }

  /** The name the starting weapon takes; DOM-only. */
  static #onSetStarterWeaponName(event, target) {
    this.spec.starterWeaponName = target.value;
  }

  /**
   * Fill the gear lines from a kit (a fill-in helper: the rows stay editable and the kit is not remembered). In weapon mode
   * the kit's weapon becomes the starting weapon, under its own name; any other start brings no weapon (core p. 113), and a
   * weapon no provider registered is skipped, both with a notice. The starter mode never changes.
   */
  static #onApplyKit(event, target) {
    const kit = target.value ? findLoadout('kit', target.value) : null;
    if (!kit) return undefined;
    this.spec.startingGear = sanitizeStartingGear(kit.gear);
    const weaponLoadout = kit.weapon ? findLoadout('weapon', kit.weapon.loadout) : null;
    if (this.spec.starterMode === 'weapon' && weaponLoadout) {
      this.spec.starterWeapon = weaponLoadout.id;
      this.spec.starterWeaponName = typeof kit.weapon.name === 'string' ? kit.weapon.name : '';
    } else if (kit.weapon) {
      ui.notifications?.info(gearText('COG.CrawlerCreator.Gear.KitWeaponSkipped', { kit: kit.name ?? kit.id }));
    }
    return this.render({ parts: this._withStages(['gear', 'loadout', 'summary', 'footer']) });
  }

  static #onSetStarterSpell(event, target) {
    this.spec.starterSpell = target.value;
    return this.render({ parts: this._withStages(['loadout', 'summary']) });
  }

  static #onSetStarterUnarmed(event, target) {
    this.spec.starterUnarmed = target.value;
    return this.render({ parts: this._withStages(['loadout', 'summary']) });
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

  /** The crawler's description free text; DOM-only. */
  static #onSetDescription(event, target) {
    this.spec.description = target.value;
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
    // The random crawler takes a random kit's lines in place of any typed ones
    const kit = rngPick(Math.random, loadoutOptions('kit'));
    this.spec.startingGear = sanitizeStartingGear(kit?.gear);
    const weaponLoadout = kit?.weapon ? findLoadout('weapon', kit.weapon.loadout) : null;
    this.spec.starterWeaponName = this.spec.starterMode === 'weapon' && weaponLoadout && typeof kit.weapon.name === 'string' ? kit.weapon.name : '';
    if (this.spec.starterMode === 'weapon' && weaponLoadout) this.spec.starterWeapon = weaponLoadout.id;
    // A floor start rolls the rest too: every arrival's choices and dice, and a Race and Class
    if (this.staged) await this.controller.randomize();
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
    this.spec.description = '';
    this.spec.startingGear = [];
    this.spec.starterWeaponName = '';
    this._initializeDefaultSelections();
    this.controller.reset();
    await this.render();
  }

  // ---------------------------------------------------------------- floor-start stages

  static #onGoStep(event, target) {
    this.controller.goTo(target.dataset.step);
    return this.render();
  }

  static #onNextStep() {
    this.controller.next();
    return this.render();
  }

  static #onPrevStep() {
    this.controller.back();
    return this.render();
  }

  /** The active arrival's draft, or null on Induction, Race and Class and Review. */
  _activeDraft() {
    return this.controller.activeArrival()?.draft ?? null;
  }

  /** A stage control's value by path: the Race and Class answers on that stage, else the active arrival's draft. */
  static #onSetField(event, target) {
    const path = target.dataset.path;
    if (this.controller.active === RACE_CLASS_STOP) this.controller.setRaceClass(path, readControl(target));
    else this._activeDraft()?.set(path, readControl(target));
    return this.render();
  }

  static async #onRollDie(event, target) {
    await this._activeDraft()?.roll(target.dataset.path, target.dataset.formula);
    return this.render();
  }

  static async #onRollAll() {
    await this.controller.fillRemaining();
    return this.render();
  }

  static #onSetPrimary(event, target) {
    this._activeDraft()?.setPrimary(target.value);
    return this.render();
  }

  static #onTogglePick(event, target) {
    this._activeDraft()?.togglePick(target.dataset.step, target.dataset.item);
    return this.render();
  }

  static #onSetMode(event, target) {
    this._activeDraft()?.setExperienceMode(target.dataset.step, target.dataset.mode);
    return this.render();
  }

  static #onPickOption(event, target) {
    const d = target.dataset;
    this._activeDraft()?.pickOption(d.step, Number(d.slot), Number(d.skill), Number(d.option));
    return this.render();
  }

  static #onSwapFormulas(event, target) {
    this._activeDraft()?.swapFormulas(target.dataset.step, Number(target.dataset.slot));
    return this.render();
  }

  static #onAdjustStat(event, target) {
    this._activeDraft()?.adjustStat(target.dataset.step, target.dataset.key, Number(target.dataset.delta));
    return this.render();
  }

  static #onSetPoolStat(event, target) {
    this.controller.setPoolStat(target.dataset.kind, target.dataset.grant, target.dataset.stat, readControl(target));
    return this.render();
  }

  static #onToggleStartingItem(event, target) {
    this.controller.toggleStartingItem(target.dataset.kind, target.dataset.index);
    return this.render();
  }

  static async #onCreateCrawler() {
    await this.createCrawler();
  }

  /**
   * Validate, build document payload, create the Actor, embed all skills, and render the sheet.
   * A Floor 3 to 5 start rolls its open dice, lists every Rule Break (Induction, each arrival, Race and Class) in the one
   * prompt, compiles the whole run into the payload, creates the actor once (or relays that one create) and then posts one
   * chat card per arrival.
   * @returns {Promise<Actor|null>}
   */
  async createCrawler(options = {}) {
    // The imported Skills reach CONFIG.COG when a refresh that `ready` does not wait for ends; the build reads them.
    await whenSourceryCatalogsSettled();
    const staged = this.staged;
    if (staged && !(await this.controller.finishRolls())) return null;
    // One prompt lists every rule the draft breaks; creation is never blocked by rules (CONTRIBUTING rule 2).
    const inductionReasons = this._ruleBreakReasons();
    const floorBreaks = staged ? this.controller.pendingRuleBreaks() : [];
    const reasons = [...inductionReasons, ...floorBreaks.map(b => `${String(b.reason ?? b.key).replace(/\.$/, '')}.`)];
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

    let actorPayload;
    let built = null;
    const payloadWarnings = [];
    if (staged) {
      // Confirmed floor breaks ride into the build, which then records them; the same seed gives the ids the answers name
      this.controller.confirmedRuleBreaks = isRuleBreak ? floorBreaks.map(b => b.key) : [];
      built = this.controller.build({ rng: this.controller.deps.rng, spec: { ...this.spec, ruleBreak: isRuleBreak } });
      actorPayload = built.payload;
      payloadWarnings.push(...built.payloadWarnings);
      for (const w of built.warnings ?? []) ui.notifications?.warn(w.message ?? String(w));
      // Every item has its id, so the hotlist slots are part of the one create
      actorPayload.system = { ...actorPayload.system, hotlist: { ...(actorPayload.system?.hotlist ?? {}), ...starterHotlist(actorPayload.items) } };
    } else {
      actorPayload = buildPayload('crawler', { ...this.spec, ruleBreak: isRuleBreak }, { warnings: payloadWarnings });
    }
    for (const w of payloadWarnings) ui.notifications?.warn(`${w.path}: ${w.message}`);
    // A background skill whose catalog entry is missing was added as a plain skill: say so (never a silent stub).
    for (const item of actorPayload.items ?? []) {
      const missing = missingCatalogRefOf(item);
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
        if (!staged) {
          // Hotlist slots by the starter-role flag the payload stamped, shared with the pack shaper
          const hotlistUpdates = Object.fromEntries(
            Object.entries(starterHotlist(actor.items)).map(([slot, id]) => [`system.hotlist.${slot}`, id])
          );
          if (Object.keys(hotlistUpdates).length > 0) {
            await actor.update(hotlistUpdates);
          }
        }

        ui.notifications?.info(`Crawler "${actor.name}" has entered the dungeon!`);
        this.close();
        if (built) await this._postArrivalCards(actor, built);
        if (actor.sheet) actor.sheet.render({ force: true });
        return actor;
      }
    } catch (err) {
      console.error('Sprinter RPG | Failed to create crawler:', err);
      ui.notifications?.error(`Failed to create Crawler: ${err.message}`);
    }

    return null;
  }

  /**
   * One chat card per arrival, spoken by the new actor, in run order. The Roll objects the player rolled in the draft ride
   * on the card (Dice So Nice shows them when installed); the value markers say rolled, typed or chosen. A card that
   * fails to post is a warning and never undoes the creation.
   * @param {Actor} actor
   * @param {{ results: {floor: number, result: object}[] }} built the controller's build
   */
  async _postArrivalCards(actor, built) {
    const mode = globalThis.game?.settings?.get?.('core', 'rollMode');
    for (const { floor, result } of built.results ?? []) {
      try {
        const draft = this.controller.drafts.get(floor);
        const rolls = [...(draft?.rolls?.values() ?? [])].filter(Boolean);
        const data = withFlags({
          speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
          content: buildFloorArrivalCard(result, { actorUuid: actor.uuid }),
          rolls,
          // Dice So Nice already animated these dice when the player rolled them in the creator; its own per-message
          // flag (`dice-so-nice.skip`) keeps the card from animating them a second time.
          flags: rolls.length ? { 'dice-so-nice': { skip: true } } : {}
        }, {
          floorArrival: {
            actorUuid: actor.uuid ?? null, floor, startFloor: this.controller.startFloor,
            history: result.history ?? [], ruleBreak: (result.ruleBreaks?.confirmed?.length ?? 0) > 0
          }
        });
        if (mode && typeof globalThis.ChatMessage?.applyMode === 'function') globalThis.ChatMessage.applyMode(data, mode);
        await globalThis.ChatMessage.create(data);
      } catch (err) {
        console.error('Sprinter RPG | Floor arrival card failed:', err);
        ui.notifications?.warn(`The Floor ${floor} arrival card could not be posted: ${err.message}`);
      }
    }
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
