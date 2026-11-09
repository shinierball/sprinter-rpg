/**
 * Builders for game.cog and CONFIG.COG, and environment accessors.
 */
import { COGActor } from '../documents/actor.mjs';
import {
  getCurrentFloor,
  setCurrentFloor,
  getFloorTimer,
  setFloorTimer,
  decrementFloorTimer,
  advanceDungeonTime,
  getCrawlerCount,
  setCrawlerCount,
  decrementCrawlerCount,
  incrementCrawlerCount
} from '../documents/actor/actor-environment.mjs';
import { COGItem } from '../documents/item.mjs';
import { COGCombat } from '../documents/combat.mjs';
import { COGCrawlerSheet } from '../sheets/crawler-sheet.mjs';
import { COGPetSheet } from '../sheets/pet-sheet.mjs';
import { COGMercenarySheet } from '../sheets/mercenary-sheet.mjs';
import { COGVehicleSheet } from '../sheets/vehicle-sheet.mjs';
import { COGPersonalSpaceSheet } from '../sheets/personal-space-sheet.mjs';
import { COGItemSheet } from '../sheets/item-sheet.mjs';
import { COGStashApp } from '../apps/stash-app.mjs';
import { DEFAULT_CAMERA_AUDIENCES } from '../utils/roll/cameras.mjs';
import { promptAttackOptions } from '../apps/attack-options-dialog.mjs';
import { COGMercenaryGuildApp } from '../apps/mercenary-guild.mjs';
import { COGSkillManager } from '../apps/skill-manager.mjs';
import { COGSpellManager } from '../apps/spell-manager.mjs';
import { COGItemManager } from '../apps/item-manager.mjs';
import { COGBuffDebuffManager } from '../apps/buff-manager.mjs';
import { COGCombatTracker } from '../apps/combat-tracker.mjs';
import { COGCombatMetrics } from '../documents/combat-metrics.mjs';
import { COGDamage } from '../documents/actor/damage-pipeline.mjs';
import { COGCombatArchiveApp } from '../apps/combat-archive.mjs';
import { COGSessionEngine } from '../documents/session/session-engine.mjs';
import { COGSessionManagerApp } from '../apps/session-manager/manager-app.mjs';
import { COG_ROLL_OUTCOMES, COG_OUTCOME_CONFIG } from '../documents/session/roll-outcomes.mjs';
import { COGRapidBatchImportApp } from '../apps/rapid-batch-import.mjs';
import { COGRapidTextParser } from '../apps/rapid-text-parser.mjs';
import { openApplications } from '../compat.mjs';
import { COGCrawlerCreatorApp } from '../apps/crawler-creator.mjs';
import { COGClassCreatorApp } from '../apps/class-creator.mjs';
import { COGRaceCreatorApp } from '../apps/race-creator.mjs';
import { COGMobCreatorApp } from '../apps/mob-creator/mob-creator-app.mjs';
import { COGBasePointBuilderApp } from '../apps/base-point-builder.mjs';
import { COGAchievementManagerApp } from '../apps/achievement-manager.mjs';
import { COGFloorClockHUD } from '../apps/floor-clock-hud.mjs';
import { COGCrawlerClockHUD } from '../apps/crawler-clock-hud.mjs';
import { COGEffectsPanel } from '../apps/effects-panel.mjs';
import { COG_ACHIEVEMENT_TIERS } from '../data/rules/achievement-tiers.mjs';
import { TagIndex, tagIndex } from '../utils/tag/tag-index.mjs';
import { COGTagManager } from '../apps/tag-manager.mjs';
import { COG_DAMAGE_TYPES, COG_DAMAGE_TYPE_RARITY } from '../data/damage-types.mjs';
import { COG_STANDARD_ARRAY } from '../data/rules/crawler-creation-rules.mjs';
import { CREATURE_SIZES, getSizeInfo } from '../data/sizes.mjs';
import { HERITAGES } from '../data/rules/heritages.mjs';
import { USED_FORMS } from '../data/rules/used-forms.mjs';
import { LOOT_GENERATORS } from '../data/rules/loot-generators.mjs';
import { MAGIC_ITEM_BASES } from '../data/rules/magic-item-bases.mjs';
import { ENCHANTMENT_CATEGORIES } from '../data/rules/crafting-rules.mjs';
import { COG_MACROS } from '../data/macros.mjs';
import { TOKEN_DEFAULTS } from '../data/token-defaults.mjs';
import { BOSS_TIERS } from '../data/mob-creation-rules.mjs';
import { LOOT_BOX_TIERS } from '../data/loot-box-tiers.mjs';
import { LOOT_BOX_FX } from '../utils/loot/loot-box-timeline.mjs';
import { getBackgroundTable, rollBackgroundTable, ensureBackgroundTables } from '../data/rules/background-table-rules.mjs';
import { TAG_SYSTEM_JOURNAL_DATA, ensureTagSystemJournal, openTagSystemJournal } from '../data/journal-tag-system.mjs';
import {
  SkillDataModel,
  AttackDataModel,
  SpellDataModel,
  GearDataModel,
  BuffDataModel,
  DebuffDataModel,
  LootDataModel,
  AchievementDataModel,
  RaceDataModel,
  ClassDataModel,
  DeityDataModel,
  SponsorDataModel,
  BaseActorDataModel,
  CrawlerDataModel,
  PetDataModel,
  MercenaryDataModel,
  MountVehicleDataModel,
  PersonalSpaceDataModel,
  NPCDataModel,
  MobDataModel
} from '../models/index.mjs';
import { getSpaceTypeInfo, getSpaceUpgrade } from '../data/rules/personal-space-rules.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { SCALARS } from '../utils/roll/scalars.mjs';
import { TIME_UNITS } from '../utils/time/timing.mjs';
import { TRANSFORM_CUES, CURE_WINDOWS } from '../utils/character/transform-rules.mjs';
import { GEAR_SLOT_LIMBS } from '../utils/gear/body-fit.mjs';
import { GEAR_SLOTS } from '../utils/gear/gear-slots.mjs';
import { SEX_OPTIONS } from '../utils/tag/sex.mjs';
import { VEHICLE_ROLES } from '../data/rules/vehicle-crew-rules.mjs';
import { CONTEST_KINDS, CHASE_GROUND } from '../data/rules/contest-rules.mjs';
import { VEHICLE_KINDS, VEHICLE_CHECK_RESULTS, VEHICLE_CHECK_KINDS, VEHICLE_UPGRADE_KINDS, ROLL_PENALTIES } from '../data/rules/vehicle-rules.mjs';
import { CHECK_TYPES } from '../data/rules/check-types.mjs';
import { AREA_REGION_BUILDERS } from '../utils/area/region-shapes.mjs';
import { ROW_KINDS } from '../utils/row-kinds.mjs';
import { RULE_SKILL_DEFS, ruleSkillRank } from '../utils/skill/rule-skills.mjs';
import { RULE_FLAGS, RULE_FLAG_DEFS, hasRuleFlag, registerRuleFlag, getTagBehaviour, listBehaviourTags, tagBehaviourErrors } from '../utils/tag/tag-behaviour.mjs';
import { registerSexOption } from '../utils/tag/sex.mjs';
import { registerStepHandler } from '../data/floor-simulator/steps/index.mjs';
import { onRenderChatMessage } from '../chat/render-chat-message.mjs';
import { registerChatMessageHook } from '../chat/register-chat-hook.mjs';
import { createAndEditItem, openGlobalItemCreatorDialog } from '../apps/item-creator-dialog.mjs';
import { unpauseGame } from './pause.mjs';
import { findFloorTableData, loadFloorTableSnapshots } from '../data/floor-simulator/tables.mjs';
import { RACE_CLASS_UNLOCK_FLOOR } from '../utils/character/race-class-floor.mjs';
import { DEFAULT_LIGHT } from '../documents/actor/light-source.mjs';
import { DEFAULT_GEAR_CONTRIBUTIONS } from '../utils/effects/gear-suppression.mjs';

export function buildGameNamespace() {
  return {
    unpauseGame,
    COGActor,
    COGDamage,
    COGItem,
    COGCombat,
    COGCrawlerSheet,
    COGPetSheet,
    COGMercenarySheet,
    COGVehicleSheet,
    COGPersonalSpaceSheet,
    COGItemSheet,
    COGStashApp,
    COGMercenaryGuildApp,
    COGSkillManager,
    COGSpellManager,
    COGItemManager,
    COGBuffDebuffManager,
    COGCombatMetrics,
    COGCombatTracker,
    COGCombatArchiveApp,
    COGSessionEngine,
    COGSessionManagerApp,
    COGRapidBatchImportApp,
    COGRapidTextParser,
    COGCrawlerCreatorApp,
    COGClassCreatorApp,
    COGRaceCreatorApp,
    COGBasePointBuilderApp,
    COGAchievementManagerApp,
    achievements: contentRegistry.getCatalog('achievements'),
    achievementTiers: COG_ACHIEVEMENT_TIERS,
    mobs: contentRegistry.getCatalog('mobs'),
    pets: contentRegistry.getCatalog('pets'),
    mercenaries: contentRegistry.getCatalog('mercenaries'),
    races: contentRegistry.getCatalog('races'),
    classes: contentRegistry.getCatalog('classes'),
    backgroundTables: contentRegistry.getBackgroundTables(),
    getBackgroundTable,
    rollBackgroundTable,
    ensureBackgroundTables,
    getCurrentFloor,
    setCurrentFloor,
    findFloorTableData,
    loadFloorTableSnapshots,
    onRenderChatMessage,
    registerChatMessageHook,
    createAndEditItem,
    openGlobalItemCreatorDialog,
    openMobCreator: (options = {}) => COGMobCreatorApp.open(options),
    TagIndex,
    tags: tagIndex,
    hasRuleFlag,
    registerRuleFlag,
    registerSexOption,
    registerStepHandler,
    registerRuleSkill: (def, opts) => contentRegistry.registerRuleSkill(def, opts),
    ruleSkillRank,
    RULE_FLAGS,
    getTagBehaviour,
    listBehaviourTags,
    tagBehaviourErrors,
    COGTagManager,
    ensureTagSystemJournal,
    openTagSystemJournal,
    tagSystemJournalData: TAG_SYSTEM_JOURNAL_DATA,
    applications: {
      COGCrawlerSheet,
      COGItemSheet,
      COGSkillManager,
      COGSpellManager,
      COGItemManager,
      COGBuffDebuffManager,
      COGCrawlerCreatorApp,
        COGClassCreatorApp,
      COGRaceCreatorApp,
      COGMobCreatorApp,
      COGBasePointBuilderApp,
      COGAchievementManagerApp,
      COGCombatArchiveApp,
      COGSessionEngine,
      COGSessionManagerApp,
      COGRapidBatchImportApp,
      COGMercenaryGuildApp,
      TagIndex,
      COGTagManager
    },
    models: {
      // Items
      SkillDataModel,
      AttackDataModel,
      SpellDataModel,
      GearDataModel,
      BuffDataModel,
      DebuffDataModel,
      LootDataModel,
      AchievementDataModel,
      RaceDataModel,
      ClassDataModel,
      DeityDataModel,
      SponsorDataModel,
      // Actors
      BaseActorDataModel,
      CrawlerDataModel,
      PetDataModel,
      MercenaryDataModel,
      MountVehicleDataModel,
      PersonalSpaceDataModel,
      NPCDataModel,
      MobDataModel
    },
    spaces: {
      types: contentRegistry.getSpaceTypes(),
      upgrades: contentRegistry.getSpaceUpgrades(),
      getSpaceTypeInfo,
      getSpaceUpgrade
    }
  };
}

export function buildConfigCOG() {
  return {
    skills: contentRegistry.getCatalog('skills'),
    spells: contentRegistry.getCatalog('spells'),
    items: contentRegistry.getCatalog('items'),
    pets: contentRegistry.getCatalog('pets'),
    mercenaries: contentRegistry.getCatalog('mercenaries'),
    mercenaryGuild: COGMercenaryGuildApp,
    buffs: contentRegistry.getCatalog('buffs'),
    macros: COG_MACROS,
    mobs: contentRegistry.getCatalog('mobs'),
    mobCreator: COGMobCreatorApp,
    promptAttackOptions,
    cameraAudiences: { ...DEFAULT_CAMERA_AUDIENCES },
    bossTiers: { ...BOSS_TIERS },
    // New actors' prototype token defaults by actor type; a module may edit a row
    tokenDefaults: { ...TOKEN_DEFAULTS },
    lootBoxTiers: { ...LOOT_BOX_TIERS },
    // The Loot Box Showcase's opening effects (`cog-lootbox-fx-<id>`); a module that adds a tier `fx` lists it here and ships its CSS
    lootBoxFx: [...LOOT_BOX_FX],
    lootGenerators: LOOT_GENERATORS,
    magicItemBases: MAGIC_ITEM_BASES,
    raceClassUnlockFloor: RACE_CLASS_UNLOCK_FLOOR,
    damageTypes: COG_DAMAGE_TYPES,
    damageTypeRarity: COG_DAMAGE_TYPE_RARITY,
    scalars: SCALARS,
    timeUnits: TIME_UNITS,
    transformCues: TRANSFORM_CUES,
    cureWindows: CURE_WINDOWS,
    gearSlotLimbs: GEAR_SLOT_LIMBS,
    gearSlots: GEAR_SLOTS,
    sexOptions: SEX_OPTIONS,
    vehicleRoles: VEHICLE_ROLES,
    checkTypes: CHECK_TYPES,
    contestKinds: CONTEST_KINDS,
    chaseGround: CHASE_GROUND,
    vehicleKinds: VEHICLE_KINDS,
    vehicleCheckResults: VEHICLE_CHECK_RESULTS,
    vehicleCheckKinds: VEHICLE_CHECK_KINDS,
    vehicleUpgradeKinds: VEHICLE_UPGRADE_KINDS,
    rollPenalties: ROLL_PENALTIES,
    areaRegionBuilders: AREA_REGION_BUILDERS,
    rowKinds: ROW_KINDS,
    ruleFlags: RULE_FLAG_DEFS,
    lightDefaults: { ...DEFAULT_LIGHT },
    gearContributions: Object.fromEntries(Object.entries(DEFAULT_GEAR_CONTRIBUTIONS).map(([kind, def]) => [kind, { ...def }])),
    ruleSkills: RULE_SKILL_DEFS,
    debuffs: contentRegistry.getCatalog('debuffs'),
    outcomes: COG_ROLL_OUTCOMES,
    outcomeConfig: COG_OUTCOME_CONFIG,
    sizes: CREATURE_SIZES,
    heritages: HERITAGES,
    usedForms: USED_FORMS,
    enchantmentCategories: ENCHANTMENT_CATEGORIES,
    getSizeInfo,
    achievements: contentRegistry.getCatalog('achievements'),
    achievementTiers: COG_ACHIEVEMENT_TIERS,
    achievementManager: COGAchievementManagerApp,
    crawlerCreation: {
      standardArray: COG_STANDARD_ARRAY,
      species: contentRegistry.getSpeciesList()
    },
    backgroundTables: contentRegistry.getBackgroundTables(),
    rollBackgroundTable,
    findFloorTableData,
    loadFloorTableSnapshots,
    TagIndex,
    tagIndex,
    COGTagManager,
    unpauseGame
  };
}

/**
 * Re-reads the registry into CONFIG.COG / game.cog. Call after the registerContent hook has fired
 * and the primaryTheme setting is registered (a theme change requires a reload).
 */
export function syncRegistryConfig() {
  const config = globalThis.CONFIG?.COG;
  const ns = globalThis.game?.cog;
  for (const kind of ['skills', 'spells', 'items', 'pets', 'mercenaries', 'mobs', 'buffs', 'debuffs', 'achievements', 'pointBuild', 'creationLoadouts', 'grindComplications']) {
    if (config) config[kind] = contentRegistry.getCatalog(kind);
  }
  if (config) {
    config.crawlerCreation = { ...config.crawlerCreation, species: contentRegistry.getSpeciesList() };
    config.backgroundTables = contentRegistry.getBackgroundTables();
  }
  if (ns) {
    for (const kind of ['mobs', 'pets', 'mercenaries', 'races', 'classes', 'achievements']) ns[kind] = contentRegistry.getCatalog(kind);
    ns.backgroundTables = contentRegistry.getBackgroundTables();
    ns.spaces = { ...ns.spaces, types: contentRegistry.getSpaceTypes(), upgrades: contentRegistry.getSpaceUpgrades() };
  }
  // An open crawler creator shows the old matrices and story tables until it redraws
  for (const app of openApplications()) if (app instanceof COGCrawlerCreatorApp) app.refreshContent();
}

/**
 * Redraws what offers content after the AI-content level changed (7.16f): the managers, the mercenary guild, the race,
 * class and crawler creators and the open compendium directories. An app that is not open is not touched.
 */
export function refreshOfferedContent() {
  const redraw = [COGSkillManager, COGSpellManager, COGItemManager, COGBuffDebuffManager, COGAchievementManagerApp,
    COGMercenaryGuildApp, COGClassCreatorApp, COGRaceCreatorApp];
  for (const app of openApplications()) {
    try {
      if (app instanceof COGCrawlerCreatorApp) app.refreshContent();
      else if (redraw.some((cls) => app instanceof cls) || app?.collection?.documentName) app.render?.();
    } catch (err) {
      console.warn('Sprinter RPG | could not redraw an app after the AI-content change:', err);
    }
  }
}

export function installEnvironmentAccessors() {
  COGActor.getCurrentFloor = getCurrentFloor;
  COGActor.setCurrentFloor = setCurrentFloor;
  COGActor.getFloorTimer = getFloorTimer;
  COGActor.setFloorTimer = setFloorTimer;
  COGActor.decrementFloorTimer = decrementFloorTimer;
  COGActor.getCrawlerCount = getCrawlerCount;
  COGActor.setCrawlerCount = setCrawlerCount;
  COGActor.decrementCrawlerCount = decrementCrawlerCount;
  COGActor.incrementCrawlerCount = incrementCrawlerCount;

  CONFIG.COG.getCurrentFloor = getCurrentFloor;
  CONFIG.COG.setCurrentFloor = setCurrentFloor;
  CONFIG.COG.getFloorTimer = getFloorTimer;
  CONFIG.COG.setFloorTimer = setFloorTimer;
  CONFIG.COG.decrementFloorTimer = decrementFloorTimer;
  CONFIG.COG.advanceDungeonTime = advanceDungeonTime;
  CONFIG.COG.getCrawlerCount = getCrawlerCount;
  CONFIG.COG.setCrawlerCount = setCrawlerCount;
  CONFIG.COG.decrementCrawlerCount = decrementCrawlerCount;
  CONFIG.COG.incrementCrawlerCount = incrementCrawlerCount;
  CONFIG.COG.crawlerClockHUD = COGCrawlerClockHUD;
  CONFIG.COG.floorClockHUD = COGFloorClockHUD;
  CONFIG.COG.effectsPanel = COGEffectsPanel;
}

export function installEnvironmentGlobals() {
  if (typeof globalThis.window !== 'undefined') {
    globalThis.window.cog = globalThis.window.cog || {};
    globalThis.window.cog.getCurrentFloor = getCurrentFloor;
    globalThis.window.cog.setCurrentFloor = setCurrentFloor;
    globalThis.window.cog.getFloorTimer = getFloorTimer;
    globalThis.window.cog.setFloorTimer = setFloorTimer;
    globalThis.window.cog.decrementFloorTimer = decrementFloorTimer;
  }
  if (globalThis.CONFIG?.COG) {
    globalThis.CONFIG.COG.getCurrentFloor = getCurrentFloor;
    globalThis.CONFIG.COG.setCurrentFloor = setCurrentFloor;
    globalThis.CONFIG.COG.getFloorTimer = getFloorTimer;
    globalThis.CONFIG.COG.setFloorTimer = setFloorTimer;
    globalThis.CONFIG.COG.decrementFloorTimer = decrementFloorTimer;
  }
}
