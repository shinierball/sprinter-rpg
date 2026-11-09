/**
 * src/content/registry.mjs
 * Central Content, Theme, and Catalog Registry for Sprinter RPG.
 *
 * Decouples lore, themes, and intellectual property from core engine mechanics while ensuring graceful degradation
 * when running with an empty registry. `COGContentRegistry` is the facade: its state lives on the instance and each
 * concern's behaviour is a module under `./registry/` whose functions take the instance first.
 */

import { registerRuleFlag } from '../utils/tag/tag-behaviour.mjs';
import { registerScalar, getScalar } from '../utils/roll/scalars.mjs';
import { registerRowKind, getRowKind } from '../utils/row-kinds.mjs';
import { registerRuleSkill } from '../utils/skill/rule-skills.mjs';
import {
  initAuthorship, registerAuthorship, getAuthorship, listAuthorship, getAiContentLevel, setAiContentLevel, isAuthorshipHidden
} from './registry/authorship.mjs';
import {
  initThemes, registerTheme, registerSourceSet, getSourceSet, registerSourceTheme, getSourceTheme, getThemes, getPrimaryThemeId,
  setPrimaryThemeId, getPrimaryTheme, getDisabledThemeIds, setDisabledThemeIds, isThemeOff, getActiveThemeIds, readSettingData,
  isThemeAvailable
} from './registry/themes.mjs';
import {
  initPacks, registerPack, registerThemeAssets, getOffPackIds, getRegisteredPackIds, getPackIdsByPriority, removePacks, getPackId,
  getPack, getPacksForKind, getFloorTablePacks, getUnifiedPackIndex, registerCharacterSheetPdf, getCharacterSheetPdf
} from './registry/packs.mjs';
import {
  initCatalogs, registerMercenary, registerMercenaries, getMercenaries, getMercenary, registerCatalog, registerReferences,
  listReferences, getReference, removeCatalogs, getCatalog, catalogWinners, getCatalogOrigin
} from './registry/catalogs.mjs';
import {
  initBackgroundTables, registerBackgroundTable, removeBackgroundTables, registerBackgroundTables, getBackgroundTables,
  getBackgroundTable, getBackgroundTableTheme, rollBackgroundTable
} from './registry/background-tables.mjs';
import {
  initSpecies, registerSpecies, registerBackgroundMatrix, removeBackgroundMatrices, getSpeciesList, getSpecies, resolveSkillRanks
} from './registry/species.mjs';
import {
  initSpaces, registerSpaceType, getSpaceTypes, getDefaultSpaceTypeTag, getSpaceType, registerSpaceUpgrade, getSpaceUpgrades
} from './registry/spaces.mjs';
import {
  resetConfigKinds, registerTag, registerTagNamespace, registerBossTier, registerLootBoxTier, registerSize, registerVehicleKind,
  registerUsedForm, registerLootGenerator, registerMagicItemBase, registerEnchantmentCategory, registerHeritage
} from './registry/config-kinds.mjs';

export class COGContentRegistry {
  constructor() {
    this.reset();
  }

  /** Clears all registered content and re-establishes clean baseline fallbacks. */
  reset() {
    initAuthorship(this);
    initThemes(this);
    initCatalogs(this);
    initBackgroundTables(this);
    initSpecies(this);
    initSpaces(this);
    initPacks(this);
    resetConfigKinds(this);
  }

  // ---- Authorship and the AI-content level (7.16): ./registry/authorship.mjs ----

  registerAuthorship(id, config) { return registerAuthorship(this, id, config); }
  getAuthorship(id) { return getAuthorship(this, id); }
  listAuthorship() { return listAuthorship(this); }
  getAiContentLevel() { return getAiContentLevel(this); }
  setAiContentLevel(level) { return setAiContentLevel(this, level); }
  isAuthorshipHidden(id, level) { return isAuthorshipHidden(this, id, level); }

  // ---- Themes and source stamps: ./registry/themes.mjs ----

  /**
   * Register a content theme, with the packs and character-sheet PDF its config names.
   * @param {string} themeId - e.g. 'shiny', 'cog', 'scifi'
   * @param {object} themeConfig - Theme configuration object
   * @param {object} [options={}] - { priority: number, provider: string }
   */
  registerTheme(themeId, themeConfig, options) {
    const stored = registerTheme(this, themeId, themeConfig, options);
    if (stored) registerThemeAssets(this, themeId, themeConfig, stored);
  }

  registerSourceSet(themeId, setId, config) { return registerSourceSet(this, themeId, setId, config); }
  getSourceSet(themeId, setId) { return getSourceSet(this, themeId, setId); }
  registerSourceTheme(id, config) { return registerSourceTheme(this, id, config); }
  getSourceTheme(id) { return getSourceTheme(this, id); }
  getThemes() { return getThemes(this); }
  getPrimaryThemeId() { return getPrimaryThemeId(this); }
  setPrimaryThemeId(themeId) { return setPrimaryThemeId(this, themeId); }
  getPrimaryTheme() { return getPrimaryTheme(this); }
  getDisabledThemeIds() { return getDisabledThemeIds(this); }
  setDisabledThemeIds(ids) { return setDisabledThemeIds(this, ids); }
  isThemeOff(themeId) { return isThemeOff(this, themeId); }
  getActiveThemeIds() { return getActiveThemeIds(this); }
  isThemeAvailable(themeId) { return isThemeAvailable(this, themeId); }

  /** @private the one-theme read of setting data; tests call it directly */
  _readSettingData(entries, idKey) { return readSettingData(this, entries, idKey); }

  // ---- Catalogs, mercenaries and references (3.85): ./registry/catalogs.mjs ----

  registerMercenary(mercData, options) { return registerMercenary(this, mercData, options); }
  registerMercenaries(mercsArray, options) { return registerMercenaries(this, mercsArray, options); }
  getMercenaries(filter) { return getMercenaries(this, filter); }
  getMercenary(id) { return getMercenary(this, id); }
  hasMercenaries() { return getMercenaries(this).length > 0; }
  registerCatalog(kind, entries, options) { return registerCatalog(this, kind, entries, options); }
  registerReferences(kind, entries) { return registerReferences(this, kind, entries); }
  listReferences(kind) { return listReferences(this, kind); }
  getReference(kind, ref) { return getReference(this, kind, ref); }
  removeCatalogs(predicate) { return removeCatalogs(this, predicate); }
  getCatalog(kind, filter) { return getCatalog(this, kind, filter); }
  getCatalogOrigin(kind, id) { return getCatalogOrigin(this, kind, id); }
  hasCatalog(kind) { return getCatalog(this, kind).length > 0; }

  /** @private the winning entry of each id of a kind; tests call it directly */
  _catalogWinners(kind, filter) { return catalogWinners(this, kind, filter); }

  // ---- Background tables: ./registry/background-tables.mjs ----

  registerBackgroundTable(key, tableDef, options) { return registerBackgroundTable(this, key, tableDef, options); }
  removeBackgroundTables(predicate) { return removeBackgroundTables(this, predicate); }
  registerBackgroundTables(tablesMap, options) { return registerBackgroundTables(this, tablesMap, options); }
  getBackgroundTables() { return getBackgroundTables(this); }
  hasBackgroundTables() { return Object.keys(getBackgroundTables(this)).length > 0; }
  getBackgroundTable(key) { return getBackgroundTable(this, key); }
  getBackgroundTableTheme(key) { return getBackgroundTableTheme(this, key); }
  rollBackgroundTable(key) { return rollBackgroundTable(this, key); }

  // ---- Species, matrix overlays and skill ranks: ./registry/species.mjs ----

  registerSpecies(id, speciesDef, options) { return registerSpecies(this, id, speciesDef, options); }
  registerBackgroundMatrix(speciesId, stage, rows, options) { return registerBackgroundMatrix(this, speciesId, stage, rows, options); }
  removeBackgroundMatrices(predicate) { return removeBackgroundMatrices(this, predicate); }
  getSpeciesList() { return getSpeciesList(this); }
  getSpecies(id) { return getSpecies(this, id); }
  resolveSkillRanks(speciesId, tierSelections) { return resolveSkillRanks(this, speciesId, tierSelections); }

  // ---- Space types and upgrades: ./registry/spaces.mjs ----

  registerSpaceType(tag, typeDef, options) { return registerSpaceType(this, tag, typeDef, options); }
  getSpaceTypes() { return getSpaceTypes(this); }
  getDefaultSpaceTypeTag() { return getDefaultSpaceTypeTag(this); }
  getSpaceType(typeTag) { return getSpaceType(this, typeTag); }
  registerSpaceUpgrade(id, upgradeDef, options) { return registerSpaceUpgrade(this, id, upgradeDef, options); }
  getSpaceUpgrades(filter) { return getSpaceUpgrades(this, filter); }

  // ---- Packs and the character-sheet PDF: ./registry/packs.mjs ----

  registerCharacterSheetPdf(urlOrPath, metadata, options) { return registerCharacterSheetPdf(this, urlOrPath, metadata, options); }
  getCharacterSheetPdf() { return getCharacterSheetPdf(this); }
  hasCharacterSheetPdf() { return getCharacterSheetPdf(this) !== null; }
  registerPack(category, packId, options) { return registerPack(this, category, packId, options); }
  getOffPackIds() { return getOffPackIds(this); }
  getRegisteredPackIds() { return getRegisteredPackIds(this); }
  getPackIdsByPriority() { return getPackIdsByPriority(this); }
  removePacks(predicate) { return removePacks(this, predicate); }
  getPackId(category, theme, options) { return getPackId(this, category, theme, options); }
  getPack(category) { return getPack(this, category); }
  getPacksForKind(kindTag) { return getPacksForKind(this, kindTag); }
  getFloorTablePacks() { return getFloorTablePacks(this); }
  getUnifiedPackIndex(category, indexOptions) { return getUnifiedPackIndex(this, category, indexOptions); }

  // ---- Rule registries (scalars, row kinds, rule flags, rule skills): one-line delegates to the utils ----

  /**
   * Register a scalar: a function a row's `scaleBy` names. Writes into `CONFIG.COG.scalars`.
   * @param {object} def - { id, label, needs, resolve(ctx, spec) -> number, params?, describe?, phase? }
   * @param {{ priority?: number, provider?: string }} [options]
   * @returns {boolean} false when refused
   */
  registerScalar(def, options = {}) {
    return registerScalar(def, { ...options, provider: options.provider ?? 'module' });
  }

  /** The registered scalar with this id, or null. */
  getScalar(id) { return getScalar(id); }

  /**
   * Register a row kind: what a modifier row does. Writes into `CONFIG.COG.rowKinds[arrayKey]`.
   * Open arrays: damageModifiers, defenseModifiers, attackModifiers, checkModifiers.
   * @param {string} arrayKey
   * @param {object} def - { id, label, fields, static?, scaled?, option?, apply: { <stage>: (acc, row, ctx) => boolean|void }, summarize? }
   * @param {{ priority?: number, provider?: string }} [options]
   * @returns {boolean} false when refused
   */
  registerRowKind(arrayKey, def, options = {}) {
    return registerRowKind(arrayKey, def, { ...options, provider: options.provider ?? 'module' });
  }

  /** The registered row kind, or null. */
  getRowKind(arrayKey, kindId) { return getRowKind(arrayKey, kindId); }

  /**
   * Declare a rule flag (a bare id a tag's `flags` may list and `hasRuleFlag` reads).
   * @param {{ id: string, label: string, hint?: string }} def
   * @param {{ priority?: number }} [opts]
   * @returns {boolean}
   */
  registerRuleFlag(def, { priority = 10 } = {}) {
    return registerRuleFlag(def, { priority, provider: 'module' });
  }

  /**
   * Declare or remap the skill a book rule uses (`fatigueCheck`, `appraisal`). Writes into `CONFIG.COG.ruleSkills`.
   * @param {{ id: string, identifier: string, label?: string }} def
   * @param {{ priority?: number }} [opts]
   * @returns {boolean} false when refused
   */
  registerRuleSkill(def, { priority = 10 } = {}) {
    return registerRuleSkill(def, { priority, provider: 'module' });
  }

  // ---- CONFIG.COG-backed kinds under one priority rule: ./registry/config-kinds.mjs ----

  registerTag(tagDef, opts) { return registerTag(this, tagDef, opts); }
  registerTagNamespace(nsKey, nsDef) { return registerTagNamespace(this, nsKey, nsDef); }
  registerBossTier(def, opts) { return registerBossTier(this, def, opts); }
  registerLootBoxTier(def, opts) { return registerLootBoxTier(this, def, opts); }
  registerSize(def, opts) { return registerSize(this, def, opts); }
  registerVehicleKind(def, opts) { return registerVehicleKind(this, def, opts); }
  registerUsedForm(def, opts) { return registerUsedForm(this, def, opts); }
  registerLootGenerator(def, opts) { return registerLootGenerator(this, def, opts); }
  registerMagicItemBase(def, opts) { return registerMagicItemBase(this, def, opts); }
  registerEnchantmentCategory(def, opts) { return registerEnchantmentCategory(this, def, opts); }
  registerHeritage(def, opts) { return registerHeritage(this, def, opts); }
}

export const contentRegistry = new COGContentRegistry();
