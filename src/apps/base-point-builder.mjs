/**
 * Sprinter RPG — Base Point Builder Engine (ApplicationV2)
 *
 * Core interactive controller and point accounting engine for custom creation.
 * Shared foundation for both COGClassCreatorApp (30 BP base) and COGRaceCreatorApp (25 BP base).
 *
 * Per Chapter 3 (page 158) of the core rulebook:
 * - Shows exact points used for each attribute, perk, skill, and detriment.
 * - Does NOT enforce a hard point limit: soft badges and indicators inform the user
 *   without blocking item creation, export, or actor application.
 */

import { COGToolApp } from './tool-app.mjs';
import { RACE_CLASS_KINDS } from '../data/race-class-grants.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { paramPickers } from '../utils/character/point-build-params.mjs';
import { sizeName } from '../data/sizes.mjs';
import {
  sizePoints, statPoints, skillSpellPoints, benefitPoints, grantRowPoints, detrimentPoints, pointLedger
} from '../data/rules/point-buy-budget.mjs';
import { PERK_ROW_DELEGATES } from './perk-rows-host.mjs';
import { blankPointBuySpec } from '../data/builders/point-buy-payload.mjs';
import * as specEdits from '../data/builders/point-buy-spec-edits.mjs';
import { POINT_BUY_FORM, POINT_BUY_PILL_PROPS, rowActions } from './point-builder/form.mjs';
import * as rowEdits from './point-builder/row-edits.mjs';
import { pointBuyRowViews, pointBuyContextFields } from './point-builder/row-views.mjs';
import * as output from './point-builder/output.mjs';

export class COGBasePointBuilderApp extends COGToolApp {
  // Shared actions for the class and race studios; subclasses add their own and inherit these.
  // Parts: `header` (title + preset loader), `builder` (the scrolling left column), `receipt` (the point ledger).
  // Core restores each part's scroll and focus, so there is no manual scroll or focus bookkeeping here.
  static DEFAULT_OPTIONS = {
    actions: {
      setField: COGBasePointBuilderApp.#onSetField,
      setProp: COGBasePointBuilderApp.#onSetProp,
      setSearch: COGBasePointBuilderApp.#onSetSearch,
      setFilter: COGBasePointBuilderApp.#onSetFilter,
      toggleAccordion: COGBasePointBuilderApp.#onToggleAccordion,
      stepStat: COGBasePointBuilderApp.#onStepStat,
      stepDR: COGBasePointBuilderApp.#onStepDR,
      ...rowActions(),
      ...PERK_ROW_DELEGATES,
      togglePerkRows: COGBasePointBuilderApp.#onTogglePerkRows,
      toggleRequirements: COGBasePointBuilderApp.#onToggleRequirements,
      setRowField: COGBasePointBuilderApp.#onSetRowField,
      setCatalogText: COGBasePointBuilderApp.#onSetCatalogText,
      toggleBenefit: COGBasePointBuilderApp.#onToggleBenefit,
      toggleDetriment: COGBasePointBuilderApp.#onToggleDetriment,
      setParam: COGBasePointBuilderApp.#onSetParam,
      loadPresetSelect: COGBasePointBuilderApp.#onLoadPresetSelect,
      setTargetCrawler: COGBasePointBuilderApp.#onSetTargetCrawler,
      saveItem: COGBasePointBuilderApp.#onSaveItem,
      exportJson: COGBasePointBuilderApp.#onExportJson,
      importJson: COGBasePointBuilderApp.#onImportJson,
      importJsonFile: COGBasePointBuilderApp.#onImportJsonFile,
      applyToCrawler: COGBasePointBuilderApp.#onApplyToCrawler,
      resetBlank: COGBasePointBuilderApp.#onResetBlank
    }
  };

  constructor(options = {}) {
    super(options);

    // The build's content: one spec object, the same shape `buildPayload` reads.
    const builderType = options.builderType || 'class'; // 'class' | 'race'
    this.spec = blankPointBuySpec(builderType, options);
    this.baseBudget = options.baseBudget ?? (this.spec.builderType === 'race' ? 25 : 30);
    /** @type {object|null} the crawler this studio applies to (an actor document, token actors included); null from the Items directory */
    this.targetActor = options.actor ?? null;
    /** Options for Foundry's create calls (`{ cogHomebrew: true }` from a crawler sheet). */
    this.createOptions = options.createOptions ?? {};
    this.targetActorId = options.targetActorId || options.actor?.id || null;

    // UI State (Accordion and search)
    this.requirementsOpen = new WeakSet(); // the spec and the custom perks whose Requirements accordion is open (collapsed by default)
    this.perkRowsOpen = new WeakSet(); // the custom perk rows whose Mechanics editor is open (closed by default)
    this.searchQuery = '';
    this.activeTierFilter = 'all';
    this.accordionOpen = {
      minor: false,
      moderate: false,
      major: false,
      extreme: false,
      epic: false,
      detriments: false,
      custom: false
    };
  }


  // =========================================================================
  // BUILD EDITS (the spec edits live in data/builders/point-buy-spec-edits.mjs, the row and output parts in ./point-builder/)
  // =========================================================================

  setStatBonus(stat, value) { return specEdits.setStatBonus(this.spec, stat, value); }

  stepDR(delta) { return specEdits.stepDR(this.spec, delta); }

  setDRBonus(val) { return specEdits.setDRBonus(this.spec, val); }

  addSkill(skill) { return specEdits.addSkill(this.spec, skill); }

  removeSkill(index) { return specEdits.removeSkill(this.spec, index); }

  addSpell(spell) { return specEdits.addSpell(this.spec, spell); }

  removeSpell(index) { return specEdits.removeSpell(this.spec, index); }

  addBuff(buff) { return specEdits.addBuff(this.spec, buff); }

  removeBuff(index) { return specEdits.removeBuff(this.spec, index); }

  addDebuff(debuff) { return specEdits.addDebuff(this.spec, debuff); }

  removeDebuff(index) { return specEdits.removeDebuff(this.spec, index); }

  addCatalogBenefit(benefitId) { return specEdits.addCatalogBenefit(this.spec, benefitId); }

  removeCatalogBenefit(benefitId) { return specEdits.removeCatalogBenefit(this.spec, benefitId); }

  addCatalogDetriment(detrimentId) { return specEdits.addCatalogDetriment(this.spec, detrimentId); }

  removeCatalogDetriment(detrimentId) { return specEdits.removeCatalogDetriment(this.spec, detrimentId); }

  setCatalogParam(entryId, name, value) { return specEdits.setCatalogParam(this.spec, entryId, name, value); }

  addCustomPerk(perk) { return specEdits.addCustomPerk(this.spec, perk); }

  resetBuild() { return specEdits.resetPointBuySpec(this.spec); }

  loadGrantRows(entry) { return specEdits.loadGrantRows(this.spec, entry); }

  loadRequirements(entry) { return specEdits.loadRequirements(this.spec, entry); }

  importBuildJSON(jsonStr) { return specEdits.importPointBuyJSON(this.spec, jsonStr); }

  loadPreset(presetId) { return specEdits.loadPointBuyPreset(this.spec, presetId); }

  exportBuildJSON() {
    return this.exportJSON();
  }

  /** The parameter pickers of a picked entry (empty when it declares none or is not picked), for the creators' contexts. */
  paramPickersFor(entry) {
    const picked = [...this.spec.selectedBenefits, ...this.spec.selectedDetriments].find(e => e.id === entry?.id);
    return picked ? paramPickers(entry, picked.params) : [];
  }

  removeRow(key, index) { return rowEdits.removeRow(this, key, index); }

  setRowField(key, index, fieldName, raw) { return rowEdits.setRowField(this, key, index, fieldName, raw); }

  perkRowsHost(list, index) { return rowEdits.perkRowsHost(this, list, index); }

  specRequirementsHost() { return rowEdits.specRequirementsHost(this); }

  specGrantRowsHost(list) { return rowEdits.specGrantRowsHost(this, list); }

  _rowCatalog(key) { return rowEdits.rowCatalog(this, key); }

  _pickRowIdentifier(key, index, identifier) { return rowEdits.pickRowIdentifier(this, key, index, identifier); }

  pickEffect(list, index, identifier) { return rowEdits.pickEffect(this, list, index, identifier); }

  setCatalogText(list, entryId, text) { return rowEdits.setCatalogText(this, list, entryId, text); }

  customTextFor(list, entryId) { return rowEdits.customTextFor(this, list, entryId); }

  /**
   * A change inside a perk's rows form saves the whole form into that perk; every other change keeps its
   * `data-change-action` routing.
   * @override
   */
  _onChangeForm(formConfig, event) {
    const { scope, prefix } = POINT_BUY_FORM.perkRows;
    const form = event?.target?.closest?.(scope);
    if (!form || !String(event.target.name ?? '').startsWith(`${prefix}.`)) return super._onChangeForm(formConfig, event);
    return rowEdits.savePerkRowsForm(this, form);
  }

  createItemData(options = {}) { return output.createItemData(this, options); }

  _surfaceWarnings() { return output.surfaceWarnings(this); }

  _notifyRuleBreakRefused(res) { return output.notifyRuleBreakRefused(this, res); }

  saveToWorldItem(options = {}) { return output.saveToWorldItem(this, options); }

  exportJSON() { return output.exportJSON(this); }

  applyToActor(actor, options = {}) { return output.applyToActor(this, actor, options); }


  // =========================================================================
  // POINT ACCOUNTING (the maths lives in data/rules/point-buy-budget.mjs)
  // =========================================================================

  calculateSizeCost() { return sizePoints(this.spec); }

  getSizeName() { return sizeName(this.spec.size); }

  calculateStatPoints() { return statPoints(this.spec); }

  calculateSkillSpellPoints() { return skillSpellPoints(this.spec); }

  calculateBenefitPoints() { return benefitPoints(this.spec); }

  calculateGrantRowPoints() { return grantRowPoints(this.spec); }

  calculateDetrimentPoints() { return detrimentPoints(this.spec); }

  /** The complete point ledger and receipt. */
  getPointLedger() { return pointLedger(this.spec, this.baseBudget); }

  /** The crawlers the user owns, for the "Apply to World Crawler" select (only shown when no crawler was handed over). */
  crawlerTargets() {
    return Array.from(globalThis.game?.actors?.values?.() ?? [])
      .filter((a) => a.type === 'crawler' && a.isOwner !== false)
      .map((a) => ({ id: a.id, name: a.name, isSelected: a.id === this.targetActorId }));
  }

  /**
   * The footer's crawler fields: with a handed-over crawler, its name and what Apply replaces (its current race or
   * class); without one, the owned crawlers for the select.
   */
  targetContext() {
    const actor = this.targetActor;
    if (!actor) return { targetActor: null, crawlers: this.crawlerTargets() };
    const profile = RACE_CLASS_KINDS[this.spec.builderType];
    const currentId = actor.getFlag?.(SYSTEM_ID, profile.flagKey)?.itemId;
    const current = currentId ? actor.items?.get(currentId) : null;
    const i18n = globalThis.game?.i18n;
    const fmt = (key, data) => i18n?.format?.(key, data) ?? key;
    const replaces = current?.name ?? '';
    const apply = fmt('COG.PointBuilder.ApplyTo', { name: actor.name });
    return {
      targetActor: {
        name: actor.name,
        replaces,
        appliesTo: fmt('COG.PointBuilder.AppliesTo', { name: actor.name }),
        applyLabel: replaces ? `${apply} ${fmt('COG.PointBuilder.Replaces', { name: replaces })}` : apply
      },
      crawlers: []
    };
  }

  /** The crawler Apply writes to: the handed-over one, else the chosen world crawler. */
  resolveTargetActor() {
    return this.targetActor ?? (this.targetActorId ? globalThis.game?.actors?.get(this.targetActorId) ?? null : null);
  }

  /** The inline rows' display model (see `pointBuyRowViews`). */
  _rowViews() { return pointBuyRowViews(this); }

  /**
   * Context for every part (the point ledger plus the build state).
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, await this._rowViews(), pointBuyContextFields(this, this.getPointLedger()), this.targetContext());
  }


  // =========================================================================
  // RE-RENDER HELPERS
  // =========================================================================

  /** Re-render the catalog column and the ledger (anything that changes the build). */
  _refreshBuild() {
    return this.render({ parts: ['builder', 'receipt'] });
  }

  /** Reset every field to blank; the race studio keeps the shared reset, the class studio overrides it. */
  _resetToBlank() {
    this.resetBuild();
  }

  // =========================================================================
  // ACTIONS (shared by the class and race studios; `this` is the app)
  // =========================================================================

  /** Plain identity inputs. Text fields need no re-render: the DOM already shows the value. */
  static #onSetField(event, target) {
    const field = target.dataset.field;
    if (!['name', 'description', 'prerequisites'].includes(field)) return;
    this.spec[field] = target.value;
  }

  /**
   * Button-group pills (`data-action="setProp" data-prop data-value`). The value is stored as the string in the markup,
   * `''` included: never through `Number`, so a numeric-looking value is not coerced. Only listed props are settable.
   */
  static async #onSetProp(event, target) {
    const prop = target.dataset.prop;
    if (!POINT_BUY_PILL_PROPS.includes(prop)) return;
    this.spec[prop] = String(target.dataset.value ?? '');
    await this._refreshBuild();
  }

  /** Live search: re-render only the builder part, then put the caret back (core restores focus, not the selection). */
  static async #onSetSearch(event, target) {
    this.searchQuery = target.value;
    const { selectionStart, selectionEnd } = target;
    await this.render({ parts: ['builder'] });
    const input = this.element?.querySelector?.('[name="searchQuery"]');
    if (!input) return;
    input.focus?.({ preventScroll: true });
    if (selectionStart !== null && selectionStart !== undefined) input.setSelectionRange?.(selectionStart, selectionEnd);
  }

  static async #onSetFilter(event, target) {
    this.activeTierFilter = target.dataset.filter || 'all';
    await this.render({ parts: ['builder'] });
  }

  static async #onToggleAccordion(event, target) {
    const tierId = target.dataset.tier;
    this.accordionOpen[tierId] = !this.accordionOpen[tierId];
    await this.render({ parts: ['builder'] });
  }

  static async #onStepStat(event, target) {
    const stat = target.dataset.stat;
    const delta = Number(target.dataset.delta) || 0;
    this.spec.stats[stat] = (Number(this.spec.stats[stat]) || 0) + delta;
    await this._refreshBuild();
  }

  static async #onStepDR(event, target) {
    this.stepDR(Number(target.dataset.delta) || 0);
    await this._refreshBuild();
  }

  /**
   * An inline row's control changed (or, for a text field, was typed in): write the spec field it is named for. Typing
   * never re-renders. A committed change re-renders what it affects: the build and receipt when it moves the ledger, the
   * receipt alone when only a label changed.
   */
  static async #onSetRowField(event, target) {
    const rowEl = target.closest?.('.cog-pb-row');
    const key = rowEl?.getAttribute('data-row');
    if (!Object.hasOwn(POINT_BUY_FORM.rows, key)) return;
    const fieldName = target.getAttribute(POINT_BUY_FORM.rows[key].field);
    const raw = target.type === 'checkbox' ? target.checked : target.value;
    const result = await this.setRowField(key, Number(rowEl.getAttribute('data-index')), fieldName, raw);
    if (event?.type !== 'change' || !result) return;
    if (result === 'build') await this._refreshBuild();
    else await this.render({ parts: ['receipt'] });
  }

  /** A custom perk's Mechanics toggle: show or hide its rows editor. */
  static async #onTogglePerkRows(event, target) {
    const perk = POINT_BUY_FORM.perkRows.lists.includes(target.dataset.list) ? this.spec[target.dataset.list]?.[Number(target.dataset.index)] : null;
    if (!perk) return;
    if (this.perkRowsOpen.has(perk)) this.perkRowsOpen.delete(perk); else this.perkRowsOpen.add(perk);
    await this._refreshBuild();
  }

  /** The Requirements accordion's summary (the creator's own, or inside a custom perk's Mechanics). */
  static #onToggleRequirements(event, target) {
    event.preventDefault?.();
    rowEdits.toggleRequirements(this, target);
  }

  /** The custom-wording input of a picked catalog benefit or detriment: stored as typed, no re-render. */
  static #onSetCatalogText(event, target) {
    this.setCatalogText(target.dataset.list, target.dataset.id, target.value);
  }

  static async #onToggleBenefit(event, target) {
    const id = target.dataset.id;
    if (target.checked) this.addCatalogBenefit(id);
    else this.removeCatalogBenefit(id);
    await this._refreshBuild();
  }

  /** A parameter picker changed: store the value; the picker shows the warning state, so re-render the builder part. */
  static async #onSetParam(event, target) {
    this.setCatalogParam(target.dataset.id, target.dataset.param, target.value);
    await this.render({ parts: ['builder'] });
  }

  static async #onToggleDetriment(event, target) {
    const id = target.dataset.id;
    if (target.checked) this.addCatalogDetriment(id);
    else this.removeCatalogDetriment(id);
    await this._refreshBuild();
  }

  static async #onLoadPresetSelect(event, target) {
    const presetId = target.value;
    if (!presetId) return;
    this.loadPreset(presetId);
    await this.render();
  }

  /** The crawler picker only records a choice; nothing on screen depends on it. */
  static #onSetTargetCrawler(event, target) {
    this.targetActorId = target.value || null;
  }

  static async #onSaveItem() {
    await this.saveToWorldItem();
  }

  static #onExportJson() {
    const blob = new Blob([this.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(this.spec.name || `custom-${this.spec.builderType}`).toLowerCase().replace(/\s+/g, '-')}-build.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Opens the hidden file picker; the chosen file is read by `importJsonFile`. */
  static #onImportJson() {
    this.element.querySelector('input.cog-import-json-input')?.click();
  }

  /** Loads a build specification from the picked JSON file into the studio. */
  static async #onImportJsonFile(event, target) {
    const file = target?.files?.[0];
    if (!file) return;
    try {
      this.importBuildJSON(await file.text());
    } catch (err) {
      globalThis.ui?.notifications?.warn(`Could not import "${file.name}": ${err.message}`);
      return;
    } finally {
      target.value = '';
    }
    globalThis.ui?.notifications?.info(`Imported ${this.spec.builderType} build "${this.spec.name}".`);
    await this.render();
  }

  static async #onApplyToCrawler() {
    if (!this.targetActor && !this.targetActorId) {
      const crawlers = this.crawlerTargets();
      if (crawlers.length === 1) this.targetActorId = crawlers[0].id;
    }
    const actor = this.resolveTargetActor();
    if (!actor) {
      const noun = this.spec.builderType === 'race' ? 'Race' : 'Class';
      globalThis.ui?.notifications?.warn(`Please select a target Crawler to apply this ${noun} to.`);
      return;
    }
    if (actor.isOwner === false) {
      globalThis.ui?.notifications?.warn(globalThis.game?.i18n?.format?.('COG.PointBuilder.NoActorPermission', { name: actor.name }) ?? 'COG.PointBuilder.NoActorPermission');
      return;
    }
    const applied = await this.applyToActor(actor, { interactive: true });
    // Handed a crawler by its sheet, the studio's job is done once the race or class is on it.
    if (applied && this.targetActor) await this.close();
  }

  static async #onResetBlank() {
    this._resetToBlank();
    await this.render();
  }
}