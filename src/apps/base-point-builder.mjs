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
import { pointBuildBenefits, pointBuildDetriments, pointBuildPresets } from '../content/point-build.mjs';
import { raceSizeCost, sizeName, sizeText } from '../data/sizes.mjs';
import { sanitizeHeritageId } from '../data/rules/heritages.mjs';
import { COGRaceClassApplier } from '../data/race-class-applier.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { confirmRuleBreak } from '../utils/rule-break.mjs';
import { normalizeBaseDamage } from '../utils/base-damage.mjs';
import { normalizeTiming } from '../utils/timing.mjs';
import { cleanParamValue, paramPickers } from '../utils/point-build-params.mjs';
import { buildPayload } from '../data/builders/item-payload.mjs';
import { COG_BENEFIT_TIERS, COG_DETRIMENT_TIERS } from '../data/rules/point-build-tiers.mjs';
import { identifierOptions } from '../sheets/item/identifier-options.mjs';
import { getAvailableBuffs, getAvailableDebuffs, getAvailableSpells, getCompendiumSkills } from '../sheets/item/catalogs.mjs';
import {
  PERK_ROW_DELEGATES, EDITABLE_KEYS, PerkRowsHost, SpecGrantRowsHost, SPEC_GRANT_LISTS, buildPerkMechanics, buildSpecGrantViews, specRowFromGrant
} from './perk-rows-host.mjs';
import { applyHostForm } from '../sheets/item/row-host.mjs';
import {
  drBonusOfBenefit, buildPointBuyPayload, buildPointBuyItemPayload, blankPointBuySpec,
  statPoolCounts, rankBonusCounts, statPoolLabel, rankBonusLabel
} from '../data/builders/point-buy-payload.mjs';

import { descriptionToPlainText } from '../utils/plain-paragraphs.mjs';

export { drBonusOfBenefit, buildPointBuyPayload, buildPointBuyItemPayload, descriptionToPlainText };

/** A rank select's options, 1 to 5, at 2 BP per rank (a stored rank outside that range stays selectable). */
function rankOptions(rank) {
  const current = Number(rank) || 1;
  const ranks = [1, 2, 3, 4, 5];
  if (!ranks.includes(current)) ranks.push(current);
  return ranks.map(r => ({ value: r, label: `Rank ${r} (+${r * 2} BP)`, selected: r === current }));
}

const tierLabel = (id) => `${id[0].toUpperCase()}${id.slice(1)}`;

/** The benefit tiers as `<option>`s (Minor (1 BP) ... Epic (6 BP)), keyed by tier id or by cost. */
function benefitTierOptions(selected, { by = 'id' } = {}) {
  return Object.entries(COG_BENEFIT_TIERS).map(([id, t]) => {
    const value = by === 'cost' ? t.cost : id;
    return { value, label: `${tierLabel(id)} (${t.cost} BP)`, selected: String(value) === String(selected) };
  });
}

/** The detriment tiers as `<option>`s (Minor (+1 Extra BP) ...), keyed by tier id or by extra points. */
function detrimentTierOptions(selected, { by = 'id' } = {}) {
  return Object.entries(COG_DETRIMENT_TIERS).map(([id, t]) => {
    const value = by === 'cost' ? t.extraPoints : id;
    return { value, label: `${tierLabel(id)} (+${t.extraPoints} Extra BP)`, selected: String(value) === String(selected) };
  });
}

/** Keep a stored value that is not one of the tier choices (an imported cost) selectable. */
function withStoredValue(options, stored) {
  if (options.some(o => o.selected)) return options;
  return [{ value: stored, label: `${stored} BP`, selected: true }, ...options];
}

const nonNegative = (raw) => Math.max(0, Number(raw) || 0);

/** What a rank bonus costs when its row names no `cost` (a Major benefit's price). */
const DEFAULT_RANK_BONUS_COST = 4;

/**
 * The inline-row fields that need coercion, keyed by field name (the `data-row-field` value). Checkboxes arrive as
 * booleans. Every other field is a string field.
 */
export const POINT_BUY_FIELD_PARSERS = Object.freeze({
  rank: (raw) => Math.max(0, Math.trunc(Number(raw)) || 1),
  cost: nonNegative,
  extraPoints: nonNegative,
  isPassive: Boolean
});

/** Fields stored as typed or picked text. */
const POINT_BUY_STRING_FIELDS = Object.freeze(['identifier', 'name', 'description', 'tier']);

/** Every `data-row-field` the point-buy rows may carry. */
export const POINT_BUY_ROW_FIELDS = Object.freeze([...Object.keys(POINT_BUY_FIELD_PARSERS), ...POINT_BUY_STRING_FIELDS]);

/** Fields whose change alters the ledger (or the layout around the row): they re-render the build and the receipt. */
const LEDGER_FIELDS = new Set(['rank', 'cost', 'extraPoints', 'isPassive', 'tier', 'identifier']);

const rowSelector = (key) => `.cog-pb-row[data-row="${key}"]`;
const rowForm = (key, noun, extra = {}) => Object.freeze({
  item: rowSelector(key),
  field: 'data-row-field',
  add: `add${noun}Row`,
  remove: `remove${noun}Row`,
  ...extra
});
const COPIED_EFFECT = Object.freeze({ by: 'identifier', keys: Object.freeze(['name', 'img', 'system']) });

/**
 * The Race and Class Creators' form as data, in the shape of `MOB_CREATOR_FORM`: `state` is the object
 * every `data-row-field` path is relative to, `rows` the repeating inline rows (`item` the row element carrying
 * `data-row` and `data-index`, `field` the attribute whose value names the row's spec field, `add` and `remove` the
 * action names), `copied` what a catalog pick copies into a row, and `catalogs` the checkbox lists with their actions.
 */
export const POINT_BUY_FORM = Object.freeze({
  state: (app) => app.spec,
  rows: Object.freeze({
    skills: rowForm('skills', 'Skill'),
    spells: rowForm('spells', 'Spell'),
    buffs: rowForm('buffs', 'Buff', { copied: COPIED_EFFECT }),
    debuffs: rowForm('debuffs', 'Debuff', { copied: COPIED_EFFECT }),
    customBenefits: rowForm('customBenefits', 'CustomBenefit'),
    customDetriments: rowForm('customDetriments', 'CustomDetriment'),
    statPools: rowForm('statPools', 'StatPool'),
    rankBonuses: rowForm('rankBonuses', 'RankBonus')
  }),
  // The pick list and the tag query inside a spec grant row (D4, D5): `row` is the list, `path` the field of the row.
  pickLists: Object.freeze({ grantOptions: Object.freeze({ row: 'statPools', path: 'options' }) }),
  queries: Object.freeze({ rankBonuses: 'query' }),
  catalogs: Object.freeze({
    selectedBenefits: Object.freeze({ toggle: 'toggleBenefit', text: 'setCatalogText' }),
    selectedDetriments: Object.freeze({ toggle: 'toggleDetriment', text: 'setCatalogText' })
  }),
  // Each custom perk's Mechanics rows editor (D5): `open` toggles it, `scope` is its form, `prefix` roots its input names.
  // `grantLists` are the stat pool and rank bonus lists: one rows form each, with no perk index.
  perkRows: Object.freeze({
    lists: Object.freeze(['customBenefits', 'customDetriments']),
    grantLists: Object.freeze(Object.keys(SPEC_GRANT_LISTS)),
    open: 'togglePerkRows', scope: '.cog-perk-rows-form, .cog-spec-grants-form', prefix: 'perkRows'
  })
});

/** What Add pushes for each row kind: a blank row, filled in place. */
const ROW_ADDERS = Object.freeze({
  skills: (app) => app.addSkill({ name: '' }),
  spells: (app) => app.addSpell({ name: '' }),
  buffs: (app) => app.addBuff({ name: '' }),
  debuffs: (app) => app.addDebuff({ name: '' }),
  customBenefits: (app) => app.spec.customBenefits.push({ name: '', cost: 1 }),
  customDetriments: (app) => app.spec.customDetriments.push({ name: '', extraPoints: 1 }),
  statPools: (app) => app.spec.statPools.push({ value: 1, options: [] }),
  rankBonuses: (app) => app.spec.rankBonuses.push({ value: 1, cost: DEFAULT_RANK_BONUS_COST })
});

/** The Add and Remove actions of every row in `POINT_BUY_FORM.rows`, generated from the descriptor. */
function rowActions() {
  const actions = {};
  for (const [key, form] of Object.entries(POINT_BUY_FORM.rows)) {
    actions[form.add] = async function addRow() {
      ROW_ADDERS[key](this);
      await this._refreshBuild();
    };
    actions[form.remove] = async function removeRow(event, target) {
      this.removeRow(key, Number(target.dataset.index));
      await this._refreshBuild();
    };
  }
  return actions;
}

/** Spec props a pill button group may set through `setProp`. */
const POINT_BUY_PILL_PROPS = ['size', 'heritage'];

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
    this.targetActorId = options.targetActorId || options.actor?.id || null;

    // UI State (Accordion and search)
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
  // PROGRAMMATIC BUILD MUTATORS
  // =========================================================================

  setStatBonus(stat, value) {
    const key = String(stat).toLowerCase();
    this.spec.stats[key] = Number(value) || 0;
  }

  /**
   * Adjust Damage Reduction (DR) by delta (+1 or -1).
   * Automatically synchronizes with the Moderate Benefit catalog (2 BP per +1 DR).
   */
  stepDR(delta) {
    const cur = Number(this.spec.drBonus) || 0;
    this.setDRBonus(Math.max(0, cur + Number(delta)));
  }

  /**
   * Sets Damage Reduction (DR) to an absolute value and synchronizes catalog benefits.
   */
  setDRBonus(val) {
    const next = Math.max(0, Number(val) || 0);
    this.spec.drBonus = next;

    // Synchronize selectedBenefits: remove existing DR benefits, add the catalog one granting `next` DR
    this.spec.selectedBenefits = this.spec.selectedBenefits.filter(b => drBonusOfBenefit(b) === 0);
    const catalogDr = next > 0 ? pointBuildBenefits().find(x => Number(x.drBonus) === next) : null;

    if (catalogDr) {
      this.spec.selectedBenefits.push({ ...catalogDr });
    } else if (next > 0) {
      this.spec.selectedBenefits.push({
        id: `mod_dr_buff_${next}`,
        name: `+${next} DR Buff`,
        tier: 'moderate',
        cost: next * 2,
        drBonus: next,
        category: 'Defense',
        description: `Permanently gain +${next} Damage Reduction (DR). Costs ${next * 2} BP (2 BP per +1 DR).`
      });
    }
  }

  addSkill({ name, identifier = '', rank = 1, isPassive = false, type = 'active', stat = '', checkType = 'stat', checkNote = '', baseDamage = null, canGainRanks = true, cooldown = { value: 0, unit: '' }, notes = '', choice = false, category = '' } = {}) {
    const passive = Boolean(isPassive || type === 'passive');
    const r = Math.max(0, Number(rank) || 1);
    this.spec.skills.push({
      name: name || '',
      ...(identifier ? { identifier: String(identifier) } : {}),
      rank: r,
      isPassive: passive,
      type: passive ? 'passive' : 'active',
      ...(stat ? { stat } : {}),
      checkType,
      checkNote,
      baseDamage: normalizeBaseDamage(baseDamage),
      canGainRanks: Boolean(canGainRanks),
      cooldown: normalizeTiming(cooldown),
      notes,
      ...(choice ? { choice: true, category } : {}),
      cost: r * 2
    });
  }

  removeSkill(index) {
    if (index >= 0 && index < this.spec.skills.length) {
      this.spec.skills.splice(index, 1);
    }
  }

  addSpell({ name, identifier = '', rank = 1, isPassive = false, mpCost = 0 } = {}) {
    const r = Math.max(0, Number(rank) || 1);
    this.spec.spells.push({
      name: name || '',
      ...(identifier ? { identifier: String(identifier) } : {}),
      rank: r,
      isPassive: Boolean(isPassive),
      mpCost: Number(mpCost) || 0,
      cost: r * 2
    });
  }

  removeSpell(index) {
    if (index >= 0 && index < this.spec.spells.length) {
      this.spec.spells.splice(index, 1);
    }
  }

  addBuff({ name, description = '', tier = 'moderate', cost } = {}) {
    const c = cost !== undefined ? Number(cost) : (COG_BENEFIT_TIERS[String(tier).toLowerCase()]?.cost ?? 2);
    this.spec.buffs.push({
      name: name ?? 'Custom Buff',
      description,
      tier,
      cost: c
    });
  }

  removeBuff(index) {
    if (index >= 0 && index < this.spec.buffs.length) {
      this.spec.buffs.splice(index, 1);
    }
  }

  addDebuff({ name, description = '', tier = 'moderate', extraPoints } = {}) {
    const xp = extraPoints !== undefined ? Number(extraPoints) : (COG_DETRIMENT_TIERS[String(tier).toLowerCase()]?.extraPoints ?? 2);
    this.spec.debuffs.push({
      name: name ?? 'Custom Debuff',
      description,
      tier,
      extraPoints: xp
    });
  }

  removeDebuff(index) {
    if (index >= 0 && index < this.spec.debuffs.length) {
      this.spec.debuffs.splice(index, 1);
    }
  }

  /** Remove row `index` of the row list `key` (a key of `POINT_BUY_FORM.rows`); out-of-range is ignored. */
  removeRow(key, index) {
    const list = Object.hasOwn(POINT_BUY_FORM.rows, key) ? POINT_BUY_FORM.state(this)[key] : null;
    if (Array.isArray(list) && index >= 0 && index < list.length) list.splice(index, 1);
  }

  /**
   * Write one field of an inline row. Numbers and checkboxes are coerced, never blocked; a tier or rank
   * moves the row's cost with it; `identifier` is a catalog pick.
   * @param {string} key a key of `POINT_BUY_FORM.rows`
   * @param {number} index
   * @param {string} fieldName
   * @param {*} raw the control's value (a boolean for a checkbox)
   * @returns {Promise<'build'|'text'|null>} what to re-render: `build` (builder and receipt), `text` (the receipt's
   *   labels only), or null when nothing was written
   */
  async setRowField(key, index, fieldName, raw) {
    const row = Object.hasOwn(POINT_BUY_FORM.rows, key) ? POINT_BUY_FORM.state(this)[key]?.[index] : null;
    if (!row || !POINT_BUY_ROW_FIELDS.includes(fieldName)) return null;
    if (fieldName === 'identifier') {
      if (!await this._pickRowIdentifier(key, index, raw)) return null;
      return 'build';
    }
    const parse = Object.hasOwn(POINT_BUY_FIELD_PARSERS, fieldName) ? POINT_BUY_FIELD_PARSERS[fieldName] : null;
    const wasNamed = Boolean(String(row.name ?? '').trim());
    row[fieldName] = parse ? parse(raw) : String(raw ?? '');
    if (fieldName === 'rank') row.cost = row.rank * 2;
    if (fieldName === 'isPassive' && key === 'skills') row.type = row.isPassive ? 'passive' : 'active';
    if (fieldName === 'tier') {
      if (key === 'buffs') row.cost = COG_BENEFIT_TIERS[row.tier]?.cost ?? row.cost;
      if (key === 'debuffs') row.extraPoints = COG_DETRIMENT_TIERS[row.tier]?.extraPoints ?? row.extraPoints;
    }
    // Naming a nameless row (or blanking a name) flips its "not filled in" chip, which lives in the builder part.
    const namedNow = Boolean(String(row.name ?? '').trim());
    return LEDGER_FIELDS.has(fieldName) || wasNamed !== namedNow ? 'build' : 'text';
  }

  /**
   * The rows host of custom perk `index` of `list` (a `POINT_BUY_FORM.perkRows.lists` key), or null for an unknown list or
   * index. Its writes land in the perk's `rows` in the spec; an empty list removes the key.
   */
  perkRowsHost(list, index) {
    if (POINT_BUY_FORM.perkRows.grantLists.includes(list)) return this.specGrantRowsHost(list);
    const perk = POINT_BUY_FORM.perkRows.lists.includes(list) ? this.spec[list]?.[index] : null;
    if (!perk) return null;
    return new PerkRowsHost(this.spec.builderType, perk.rows, {
      save: (rows) => {
        if (rows.length) perk.rows = rows; else delete perk.rows;
      }
    });
  }

  /**
   * The rows host of the stat pool or rank bonus list `list` (a `POINT_BUY_FORM.perkRows.grantLists` key). Its writes
   * replace the spec rows in place, each row keeping its ledger-only `cost`.
   */
  specGrantRowsHost(list) {
    return new SpecGrantRowsHost(list, this.spec[list], {
      save: (grants) => {
        const old = [...this.spec[list]];
        this.spec[list].splice(0, this.spec[list].length, ...grants.map((grant, i) => specRowFromGrant(list, grant, old[i])));
      }
    });
  }

  /**
   * A change inside a perk's rows form saves the whole form into that perk; every other change keeps its
   * `data-change-action` routing.
   * @override
   */
  _onChangeForm(formConfig, event) {
    const { scope, prefix } = POINT_BUY_FORM.perkRows;
    const form = event?.target?.closest?.(scope);
    if (!form || !String(event.target.name ?? '').startsWith(`${prefix}.`)) return super._onChangeForm(formConfig, event);
    return this.#savePerkRowsForm(form);
  }

  async #savePerkRowsForm(form) {
    const { prefix } = POINT_BUY_FORM.perkRows;
    const list = form.dataset.perkList;
    const index = Number(form.dataset.perkIndex);
    const host = this.perkRowsHost(list, index);
    if (!host) return;
    const data = new foundry.applications.ux.FormDataExtended(form).object;
    const listData = foundry.utils.expandObject(data)[prefix]?.[list];
    const submitted = (POINT_BUY_FORM.perkRows.grantLists.includes(list) ? listData : listData?.[index]) ?? {};
    await applyHostForm(host, submitted, EDITABLE_KEYS);
    await this.render({ parts: ['builder', 'receipt'] });
  }

  /** The catalog entries a row kind picks its `identifier` from, as the item sheet's pickers list them. */
  async _rowCatalog(key) {
    if (key === 'skills') return getCompendiumSkills();
    if (key === 'spells') return getAvailableSpells();
    if (key === 'buffs') return getAvailableBuffs();
    if (key === 'debuffs') return getAvailableDebuffs();
    return [];
  }

  /** A skill, spell, buff or debuff row picked an `identifier` from the catalog (blank clears it). */
  async _pickRowIdentifier(key, index, identifier) {
    if (POINT_BUY_FORM.rows[key].copied) return this.pickEffect(key, index, identifier);
    const row = POINT_BUY_FORM.state(this)[key]?.[index];
    const id = String(identifier ?? '').trim();
    if (!row) return false;
    if (!id) {
      delete row.identifier;
      return true;
    }
    const def = (await this._rowCatalog(key)).find(d => d.system?.identifier === id);
    row.identifier = id;
    if (def?.name) row.name = def.name;
    return true;
  }

  /**
   * A buff or debuff row picked a catalog entry: the row takes a frozen copy of the whole payload
   * (`POINT_BUY_FORM.rows[list].copied.keys`, plus the identifier), so the race or class carries it. A blank identifier
   * clears the pick and leaves a text-only row that keeps its name.
   * @param {'buffs'|'debuffs'} list
   * @param {number} index
   * @param {string} identifier
   * @returns {Promise<boolean>} whether the row changed
   */
  async pickEffect(list, index, identifier) {
    const form = Object.hasOwn(POINT_BUY_FORM.rows, list) ? POINT_BUY_FORM.rows[list] : null;
    const row = form?.copied ? POINT_BUY_FORM.state(this)[list]?.[index] : null;
    if (!row) return false;
    const id = String(identifier ?? '').trim();
    if (!id) {
      delete row.identifier;
      for (const k of form.copied.keys) if (k !== 'name') delete row[k];
      return true;
    }
    const def = (await this._rowCatalog(list)).find(d => d.system?.[form.copied.by] === id);
    if (!def) return false;
    row.identifier = id;
    const source = { name: def.name, img: def.img, system: def.system?.toObject?.() ?? structuredClone(def.system ?? {}) };
    for (const k of form.copied.keys) if (source[k] !== undefined) row[k] = source[k];
    return true;
  }

  /** Set (or, when blank, clear) the custom wording of a picked catalog benefit or detriment. */
  setCatalogText(list, entryId, text) {
    if (!Object.hasOwn(POINT_BUY_FORM.catalogs, list)) return false;
    const picked = POINT_BUY_FORM.state(this)[list].find(e => e.id === entryId);
    if (!picked) return false;
    const clean = String(text ?? '').trim();
    if (clean) picked.customText = clean;
    else delete picked.customText;
    return true;
  }

  /** The custom wording of a picked catalog entry ('' when none), for the contexts. */
  customTextFor(list, entryId) {
    return POINT_BUY_FORM.state(this)[list]?.find(e => e.id === entryId)?.customText ?? '';
  }

  addCatalogBenefit(benefitId) {
    const drBonus = drBonusOfBenefit({ id: benefitId });
    if (drBonus > 0) {
      this.setDRBonus(drBonus);
      return;
    }

    const item = pointBuildBenefits().find(b => b.id === benefitId);
    if (item && !this.spec.selectedBenefits.some(b => b.id === benefitId)) {
      this.spec.selectedBenefits.push({ ...item });
    }
  }

  removeCatalogBenefit(benefitId) {
    const selected = this.spec.selectedBenefits.find(b => b.id === benefitId) ?? { id: benefitId };
    if (drBonusOfBenefit(selected) > 0) {
      this.setDRBonus(0);
      return;
    }

    this.spec.selectedBenefits = this.spec.selectedBenefits.filter(b => b.id !== benefitId);
  }

  addCatalogDetriment(detrimentId) {
    const item = pointBuildDetriments().find(d => d.id === detrimentId);
    if (item && !this.spec.selectedDetriments.some(d => d.id === detrimentId)) {
      this.spec.selectedDetriments.push({ ...item });
    }
  }

  removeCatalogDetriment(detrimentId) {
    this.spec.selectedDetriments = this.spec.selectedDetriments.filter(d => d.id !== detrimentId);
  }

  /**
   * Record the user's choice for one `rowParams` parameter of a picked catalog benefit or detriment. A blank value clears
   * it. The row is built from `params` by `buildPointBuyPayload`, so nothing else changes here.
   * @returns {boolean} whether a selected entry was found
   */
  setCatalogParam(entryId, name, value) {
    const picked = [...this.spec.selectedBenefits, ...this.spec.selectedDetriments].find(e => e.id === entryId);
    if (!picked || !(picked.rowParams ?? []).includes(name)) return false;
    const clean = cleanParamValue(value);
    const params = { ...(picked.params ?? {}) };
    if (clean) params[name] = clean;
    else delete params[name];
    picked.params = params;
    return true;
  }

  /** The parameter pickers of a picked entry (empty when it declares none or is not picked), for the creators' contexts. */
  paramPickersFor(entry) {
    const picked = [...this.spec.selectedBenefits, ...this.spec.selectedDetriments].find(e => e.id === entry?.id);
    return picked ? paramPickers(entry, picked.params) : [];
  }

  addCustomPerk({ name, type = 'benefit', tier = 'Moderate', points = 1, extraPoints = 1, description = '' } = {}) {
    if (type === 'detriment') {
      this.spec.customDetriments.push({
        name: name || 'Custom Detriment',
        tier,
        extraPoints: Number(extraPoints ?? points) || 1,
        description
      });
    } else {
      this.spec.customBenefits.push({
        name: name || 'Custom Benefit',
        tier,
        cost: Number(points) || 1,
        description
      });
    }
  }

  resetBuild() {
    this.spec.name = this.spec.builderType === 'race' ? 'Unnamed Custom Race' : 'Custom Class';
    this.spec.description = '';
    this.spec.prerequisites = '';
    this.spec.stats = { str: 0, dex: 0, con: 0, int: 0, cha: 0 };
    this.spec.drBonus = 0;
    this.spec.skills = [];
    this.spec.spells = [];
    this.spec.buffs = [];
    this.spec.debuffs = [];
    this.spec.selectedBenefits = [];
    this.spec.selectedDetriments = [];
    this.spec.customBenefits = [];
    this.spec.customDetriments = [];
    this.spec.statPools = [];
    this.spec.rankBonuses = [];
  }

  exportBuildJSON() {
    return this.exportJSON();
  }

  /** The stat pool and rank bonus spec rows a list of grant rows holds (rank bonuses start at the default cost). */
  #grantRowSeeds(grants) {
    const rows = Array.isArray(grants) ? grants : [];
    const label = (g) => (g.label ? { label: String(g.label) } : {});
    return {
      statPools: rows.filter(g => g?.kind === 'stat' && g.mode === 'pool')
        .map(g => ({ value: Number(g.value) || 0, options: Array.isArray(g.options) ? [...g.options] : [], ...label(g) })),
      rankBonuses: rows.filter(g => g?.kind === 'rank_bonus').map(g => ({
        value: Number(g.value) || 0,
        ...(g.tag ? { tag: String(g.tag) } : {}),
        ...(g.query ? { query: structuredClone(g.query) } : {}),
        ...(g.floor ? { floor: Number(g.floor) } : {}),
        ...(g.onlyIfOwned ? { onlyIfOwned: true } : {}),
        ...label(g),
        cost: DEFAULT_RANK_BONUS_COST
      }))
    };
  }

  /** Fill the stat pools and rank bonuses from a canonical race or class item's grant rows (`mode: 'pool'`, `rank_bonus`). */
  loadGrantRows(entry) {
    const { statPools, rankBonuses } = this.#grantRowSeeds(entry?.system?.grants);
    this.spec.statPools = statPools;
    this.spec.rankBonuses = rankBonuses;
  }

  importBuildJSON(jsonStr) {
    const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    if (data.name) this.spec.name = data.name;
    // The builder's own export carries the typed text as `description`; `system.description` is that text plus the
    // generated bullet list, so it is only the source for a plain item's JSON.
    if (typeof data.description === 'string' && data.system) this.spec.description = data.description;
    else if (data.system?.description || data.description) this.spec.description = descriptionToPlainText(data.system?.description || data.description);
    if (data.system?.prerequisites || data.prerequisites) this.spec.prerequisites = data.system?.prerequisites || data.prerequisites;
    // Rows first (the item's own form), then the builder's own export keys.
    const importedGrants = Array.isArray(data.system?.grants) ? data.system.grants : (Array.isArray(data.grants) ? data.grants : []);
    const fixedRows = (kind) => importedGrants.filter(g => g?.kind === kind && g.mode !== 'choice' && g.mode !== 'pool');
    const grantStats = { str: 0, dex: 0, con: 0, int: 0, cha: 0 };
    for (const g of fixedRows('stat')) if (Object.hasOwn(grantStats, g.stat)) grantStats[g.stat] += Number(g.value) || 0;
    if (data.stats || fixedRows('stat').length) {
      const s = data.stats || grantStats;
      this.spec.stats = {
        str: Number(s.str) || 0,
        dex: Number(s.dex) || 0,
        con: Number(s.con) || 0,
        int: Number(s.int) || 0,
        cha: Number(s.cha) || 0
      };
    }
    const skillEntries = Array.isArray(data.skills) ? data.skills : fixedRows('skill').map(g => ({ name: g.label || g.identifier, identifier: g.identifier, rank: g.rank, stat: g.stat, cooldown: g.cooldown }));
    if (skillEntries.length) {
      // Through `addSkill`, so an imported row is the row the studio would have made: `type`, a catalog `identifier`,
      // `choice` and `category` all come back as exported.
      this.spec.skills = [];
      for (const sk of skillEntries) {
        this.addSkill({ ...sk, canGainRanks: sk.canGainRanks !== undefined ? Boolean(sk.canGainRanks) : true, type: sk.type || (sk.isPassive ? 'passive' : 'active') });
      }
    }
    const spellEntries = Array.isArray(data.spells) ? data.spells : fixedRows('spell').map(g => ({ name: g.label || g.identifier, rank: g.rank }));
    if (spellEntries.length) this.spec.spells = spellEntries.map(sp => ({
      name: sp.name,
      rank: Number(sp.rank) || 1,
      isPassive: Boolean(sp.isPassive),
      mpCost: Number(sp.mpCost) || 0,
      cost: (Number(sp.rank) || 1) * 2
    }));
    // Effects: the export's `buffs` / `debuffs` keys, else a plain item's `system.grantedEffects` (a typed entry reads as
    // a picked one, since it carries a `system`).
    const importedEffects = (type) => (Array.isArray(data.system?.grantedEffects) ? data.system.grantedEffects : [])
      .filter(e => e?.type === type)
      .map(e => ({ name: e.name, identifier: e.system?.identifier, img: e.img, system: e.system }));
    const effectRows = blankPointBuySpec(this.spec.builderType, {
      buffs: Array.isArray(data.buffs) ? data.buffs : importedEffects('buff'),
      debuffs: Array.isArray(data.debuffs) ? data.debuffs : importedEffects('debuff')
    });
    if (Array.isArray(data.buffs) || data.system?.grantedEffects) this.spec.buffs = effectRows.buffs;
    if (Array.isArray(data.debuffs) || data.system?.grantedEffects) this.spec.debuffs = effectRows.debuffs;
    // The builder's own export keys come back whole; a plain item's pool and rank bonus grant rows become the same rows.
    const rowsOf = (key) => (Array.isArray(data[key]) ? data[key].filter(r => r && typeof r === 'object').map(r => structuredClone(r)) : null);
    for (const key of ['customBenefits', 'customDetriments']) {
      const rows = rowsOf(key);
      if (rows) this.spec[key] = rows;
    }
    const pools = rowsOf('statPools') ?? (importedGrants.some(g => g?.kind === 'stat' && g.mode === 'pool') ? this.#grantRowSeeds(importedGrants).statPools : null);
    const bonuses = rowsOf('rankBonuses') ?? (importedGrants.some(g => g?.kind === 'rank_bonus') ? this.#grantRowSeeds(importedGrants).rankBonuses : null);
    if (pools) this.spec.statPools = pools;
    if (bonuses) this.spec.rankBonuses = bonuses;
    if (typeof data.img === 'string' && data.img) this.spec.img = data.img;
    if (Array.isArray(data.selectedBenefits || data.benefits)) {
      this.spec.selectedBenefits = [...(data.selectedBenefits || data.benefits)];
    }
    if (Array.isArray(data.selectedDetriments || data.detriments)) {
      this.spec.selectedDetriments = [...(data.selectedDetriments || data.detriments)];
    }

    if (data.system?.drBonus !== undefined || data.drBonus !== undefined) {
      this.setDRBonus(data.system?.drBonus ?? data.drBonus);
    } else {
      this.spec.drBonus = this.spec.selectedBenefits.reduce((max, b) => Math.max(max, drBonusOfBenefit(b)), 0);
    }
    return { success: true };
  }

  // =========================================================================
  // POINT ACCOUNTING ENGINE
  // =========================================================================

  /**
   * Calculate point cost for creature size (Races only): the size entry's `raceCost` in the registry
   * (3 BP for Tiny, Small, Large and above; 0 for Petite and Medium; blank, "no change", costs 0).
   */
  calculateSizeCost() {
    if (this.spec.builderType !== 'race') return 0;
    return raceSizeCost(this.spec.size);
  }

  getSizeName() {
    return sizeName(this.spec.size);
  }

  /**
   * Calculate point cost for ability score deltas.
   * Positive points: 1 BP per +1 stat.
   * Negative points: 1 extra BP per -2 penalty (handled under detriments).
   */
  calculateStatPoints() {
    let positiveCost = 0;
    let negativePoints = 0;

    for (const [, val] of Object.entries(this.spec.stats)) {
      const num = Number(val) || 0;
      if (num > 0) {
        positiveCost += num;
      } else if (num < 0) {
        negativePoints += Math.abs(num);
      }
    }

    // Every 2 points of penalties pays back 1 extra build point
    const extraPointsFromNegatives = Math.floor(negativePoints / 2);

    return {
      positiveCost,
      negativePoints,
      extraPointsFromNegatives
    };
  }

  /**
   * Calculate points spent on skills and spells (2 BP per rank).
   */
  calculateSkillSpellPoints() {
    let skillCost = 0;
    let spellCost = 0;
    let passiveSkillRanks = 0;

    for (const s of this.spec.skills) {
      const r = Math.max(0, Number(s.rank) || 0);
      skillCost += r * 2;
      if (s.isPassive) passiveSkillRanks += r;
    }

    for (const sp of this.spec.spells) {
      const r = Math.max(0, Number(sp.rank) || 0);
      spellCost += r * 2;
      if (sp.isPassive) passiveSkillRanks += r;
    }

    return {
      skillCost,
      spellCost,
      passiveSkillRanks,
      isPassiveExceeded: passiveSkillRanks > 5
    };
  }

  /**
   * Calculate points spent on benefits (catalog + custom).
   */
  calculateBenefitPoints() {
    let catalogCost = 0;
    for (const b of this.spec.selectedBenefits) {
      catalogCost += Number(b.cost) || 0;
    }

    let customCost = 0;
    for (const cb of this.spec.customBenefits) {
      customCost += Number(cb.cost) || 0;
    }

    let buffCost = 0;
    for (const buf of this.spec.buffs) {
      buffCost += Number(buf.cost) || 0;
    }

    return {
      catalogCost,
      customCost,
      buffCost,
      totalBenefitCost: catalogCost + customCost + buffCost
    };
  }

  /**
   * What the stat pool and rank bonus rows cost and earn. A row counts only if the builder would keep it
   * (`statPoolCounts`, `rankBonusCounts`: the payload uses the same two predicates). A pool costs its points. A positive
   * rank bonus costs its `cost` (4 BP when unset), whatever its value. A negative one costs nothing and earns 1 Extra BP
   * per point, the rate of the catalog's skill penalties.
   */
  calculateGrantRowPoints() {
    const pools = this.spec.statPools.filter(statPoolCounts);
    const bonuses = this.spec.rankBonuses.filter(rankBonusCounts);
    const positive = bonuses.filter(b => Number(b.value) > 0);
    const negative = bonuses.filter(b => Number(b.value) < 0);
    return {
      pools,
      positive,
      negative,
      statPoolCost: pools.reduce((sum, p) => sum + Number(p.value), 0),
      rankBonusCost: positive.reduce((sum, b) => sum + (Number(b.cost) || DEFAULT_RANK_BONUS_COST), 0),
      rankBonusExtra: negative.reduce((sum, b) => sum + Math.abs(Math.trunc(Number(b.value))), 0)
    };
  }

  /**
   * Calculate extra build points gained from detriments (catalog + custom + stats + negative rank bonuses).
   */
  calculateDetrimentPoints() {
    let catalogExtra = 0;
    for (const d of this.spec.selectedDetriments) {
      catalogExtra += Number(d.extraPoints) || 0;
    }

    let customExtra = 0;
    for (const cd of this.spec.customDetriments) {
      customExtra += Number(cd.extraPoints) || 0;
    }

    let debuffExtra = 0;
    for (const deb of this.spec.debuffs) {
      debuffExtra += Number(deb.extraPoints) || 0;
    }

    const { extraPointsFromNegatives } = this.calculateStatPoints();
    const { rankBonusExtra } = this.calculateGrantRowPoints();
    const totalExtra = catalogExtra + customExtra + debuffExtra + extraPointsFromNegatives + rankBonusExtra;

    return {
      catalogExtra,
      customExtra,
      debuffExtra,
      rankBonusExtra,
      statExtra: extraPointsFromNegatives,
      totalExtraPoints: totalExtra,
      isDetrimentCapped: totalExtra > 5 // Rule: max +5 extra BP per class/race
    };
  }

  /**
   * Compute complete point ledger and receipt.
   */
  getPointLedger() {
    const statData = this.calculateStatPoints();
    const skillData = this.calculateSkillSpellPoints();
    const benefitData = this.calculateBenefitPoints();
    const detrimentData = this.calculateDetrimentPoints();
    const grantRowData = this.calculateGrantRowPoints();

    const sizeCost = this.calculateSizeCost();
    const pointsSpent =
      statData.positiveCost +
      skillData.skillCost +
      skillData.spellCost +
      benefitData.totalBenefitCost +
      grantRowData.statPoolCost +
      grantRowData.rankBonusCost +
      sizeCost;

    const extraPoints = detrimentData.totalExtraPoints;
    const effectiveBudget = this.baseBudget + extraPoints;
    const balance = effectiveBudget - pointsSpent;
    const isOverbudget = pointsSpent > effectiveBudget;
    const overbudgetAmount = Math.max(0, pointsSpent - effectiveBudget);

    // Itemized receipt lines
    const receiptItems = [];

    // Stats
    for (const [stat, val] of Object.entries(this.spec.stats)) {
      if (val > 0) {
        receiptItems.push({
          type: 'stat',
          label: `+${val} ${stat.toUpperCase()}`,
          cost: val,
          isExtra: false
        });
      } else if (val < 0) {
        // A penalty earns nothing by itself: the pool of all penalties earns 1 Extra BP per 2 points
        receiptItems.push({
          type: 'stat_detriment',
          label: `${val} ${stat.toUpperCase()}`,
          isPenalty: true,
          isExtra: false
        });
      }
    }
    if (statData.extraPointsFromNegatives > 0) {
      receiptItems.push({
        type: 'stat_penalty',
        label: `Stat penalties (${statData.negativePoints})`,
        extraPoints: statData.extraPointsFromNegatives,
        isExtra: true
      });
    }

    // Skills
    for (const s of this.spec.skills) {
      if (s.name && s.rank > 0) {
        receiptItems.push({
          type: 'skill',
          label: `+${s.rank} ${s.name} Skill${s.isPassive ? ' (Passive)' : ''}`,
          cost: s.rank * 2,
          isExtra: false
        });
      }
    }

    // Spells
    for (const sp of this.spec.spells) {
      if (sp.name && sp.rank > 0) {
        receiptItems.push({
          type: 'spell',
          label: `+${sp.rank} ${sp.name} Spell${sp.isPassive ? ' (Passive)' : ''}`,
          cost: sp.rank * 2,
          isExtra: false
        });
      }
    }

    // Stat pools and rank bonuses (a negative bonus earns Extra BP instead of costing)
    for (const pool of grantRowData.pools) {
      receiptItems.push({ type: 'stat_pool', label: statPoolLabel(pool), cost: Number(pool.value), isExtra: false });
    }
    for (const bonus of grantRowData.positive) {
      receiptItems.push({ type: 'rank_bonus', label: rankBonusLabel(bonus), cost: Number(bonus.cost) || DEFAULT_RANK_BONUS_COST, isExtra: false });
    }
    for (const bonus of grantRowData.negative) {
      receiptItems.push({ type: 'rank_penalty', label: rankBonusLabel(bonus), extraPoints: Math.abs(Math.trunc(Number(bonus.value))), isExtra: true });
    }

    // Benefits
    for (const b of this.spec.selectedBenefits) {
      receiptItems.push({
        type: 'benefit',
        label: b.name,
        cost: b.cost,
        isExtra: false
      });
    }

    // Custom Benefits
    for (const cb of this.spec.customBenefits) {
      receiptItems.push({
        type: 'custom_benefit',
        label: cb.name,
        cost: cb.cost,
        isExtra: false
      });
    }

    // Custom Buffs
    for (const buf of this.spec.buffs) {
      receiptItems.push({
        type: 'buff',
        label: buf.name + (buf.tier ? ` (${buf.tier})` : ''),
        cost: buf.cost,
        isExtra: false
      });
    }

    // Detriments
    for (const d of this.spec.selectedDetriments) {
      receiptItems.push({
        type: 'detriment',
        label: d.name,
        extraPoints: d.extraPoints,
        isExtra: true
      });
    }

    // Custom Detriments
    for (const cd of this.spec.customDetriments) {
      receiptItems.push({
        type: 'custom_detriment',
        label: cd.name,
        extraPoints: cd.extraPoints,
        isExtra: true
      });
    }

    // Custom Debuffs
    for (const deb of this.spec.debuffs) {
      receiptItems.push({
        type: 'debuff',
        label: deb.name + (deb.tier ? ` (${deb.tier})` : ''),
        extraPoints: deb.extraPoints,
        isExtra: true
      });
    }

    // Size Cost (for Races)
    if (sizeCost > 0) {
      receiptItems.push({
        type: 'size',
        label: `Size ${sizeText(this.spec.size)}`,
        cost: sizeCost,
        isExtra: false
      });
    }

    return {
      baseBudget: this.baseBudget,
      extraPoints,
      effectiveBudget,
      spent: pointsSpent,
      pointsSpent,
      balance,
      remaining: balance,
      isOverbudget,
      overbudgetAmount,
      isLegal: !isOverbudget && !skillData.isPassiveExceeded,
      hasSkillRankCapWarning: skillData.isPassiveExceeded,
      statCost: statData.positiveCost,
      statPenaltyExtra: statData.extraPointsFromNegatives,
      skillCost: skillData.skillCost,
      spellCost: skillData.spellCost,
      benefitCost: benefitData.catalogCost,
      customCost: benefitData.customCost,
      buffCost: benefitData.buffCost,
      debuffExtra: detrimentData.debuffExtra,
      sizeCost,
      statPoolCost: grantRowData.statPoolCost,
      rankBonusCost: grantRowData.rankBonusCost,
      rankBonusExtra: grantRowData.rankBonusExtra,
      detrimentExtraPoints: Math.min(5, detrimentData.catalogExtra + detrimentData.customExtra + detrimentData.debuffExtra + detrimentData.rankBonusExtra),
      rawDetrimentPoints: detrimentData.catalogExtra + detrimentData.customExtra + detrimentData.debuffExtra + detrimentData.rankBonusExtra,
      receiptItems,
      items: receiptItems,
      passiveSkillRanks: skillData.passiveSkillRanks,
      isPassiveExceeded: skillData.isPassiveExceeded,
      isDetrimentCapped: detrimentData.isDetrimentCapped
    };
  }

  /**
   * The inline rows' display model, with every option list and `selected` flag precomputed (CONTRIBUTING §5).
   * @returns {Promise<object>} `skillRows`, `spellRows`, `buffRows`, `debuffRows`, `customBenefitRows`, `customDetrimentRows`
   */
  async _rowViews() {
    const [skillCatalog, spellCatalog, buffCatalog, debuffCatalog] = await Promise.all([
      getCompendiumSkills(), getAvailableSpells(), getAvailableBuffs(), getAvailableDebuffs()
    ]);
    const unfilled = (row) => !String(row.name ?? '').trim();
    const reference = (catalog) => (row) => ({
      ...row,
      cost: (Number(row.rank) || 0) * 2,
      unfilled: unfilled(row),
      identifierOptions: identifierOptions(catalog, row.identifier, { blankLabel: '(custom)', fallbackLabel: row.name }),
      rankOptions: rankOptions(row.rank)
    });
    const effect = (catalog, tierOptions) => (row) => ({
      ...row,
      picked: row.system !== null && typeof row.system === 'object',
      unfilled: unfilled(row),
      identifierOptions: identifierOptions(catalog, row.identifier, { blankLabel: '(typed effect)', fallbackLabel: row.name }),
      tierOptions: tierOptions(row.tier)
    });
    const catalogs = { skills: skillCatalog, spells: spellCatalog };
    const costOptions = (stored) => withStoredValue(benefitTierOptions(stored, { by: 'cost' }), stored);
    const poolViews = buildSpecGrantViews('statPools', this.spec.statPools, statPoolCounts, catalogs);
    const bonusViews = buildSpecGrantViews('rankBonuses', this.spec.rankBonuses, rankBonusCounts, catalogs);
    return {
      statPoolRows: this.spec.statPools.map((row, index) => ({
        index, grant: poolViews[index], unfilled: poolViews[index].incomplete, cost: statPoolCounts(row) ? Number(row.value) : 0
      })),
      rankBonusRows: this.spec.rankBonuses.map((row, index) => {
        const value = Number(row.value) || 0;
        const cost = Number(row.cost) || DEFAULT_RANK_BONUS_COST;
        return {
          index, grant: bonusViews[index], unfilled: bonusViews[index].incomplete, negative: value < 0,
          earns: Math.abs(Math.trunc(value)), cost: rankBonusCounts(row) && value > 0 ? cost : 0, costOptions: costOptions(cost)
        };
      }),
      skillRows: this.spec.skills.map(reference(skillCatalog)),
      spellRows: this.spec.spells.map(reference(spellCatalog)),
      buffRows: this.spec.buffs.map(effect(buffCatalog, (tier) => benefitTierOptions(tier))),
      debuffRows: this.spec.debuffs.map(effect(debuffCatalog, (tier) => detrimentTierOptions(tier))),
      customBenefitRows: this.spec.customBenefits.map((row, index) => ({
        ...row,
        mechanics: buildPerkMechanics(this.spec.builderType, 'customBenefits', index, row, this.perkRowsOpen.has(row), catalogs),
        unfilled: unfilled(row),
        costOptions: withStoredValue(benefitTierOptions(row.cost, { by: 'cost' }), row.cost)
      })),
      customDetrimentRows: this.spec.customDetriments.map((row, index) => ({
        ...row,
        mechanics: buildPerkMechanics(this.spec.builderType, 'customDetriments', index, row, this.perkRowsOpen.has(row), catalogs),
        unfilled: unfilled(row),
        costOptions: withStoredValue(detrimentTierOptions(row.extraPoints, { by: 'cost' }), row.extraPoints)
      }))
    };
  }

  /**
   * Context for every part (the point ledger plus the build state).
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const ledger = this.getPointLedger();
    return Object.assign(context, await this._rowViews(), {
      builderType: this.spec.builderType,
      name: this.spec.name,
      description: this.spec.description,
      prerequisites: this.spec.prerequisites,
      stats: this.spec.stats,
      drBonus: this.spec.drBonus,
      drCost: this.spec.drBonus * 2,
      skills: this.spec.skills,
      spells: this.spec.spells,
      benefits: this.spec.selectedBenefits,
      detriments: this.spec.selectedDetriments,
      selectedBenefits: this.spec.selectedBenefits,
      selectedDetriments: this.spec.selectedDetriments,
      customBenefits: this.spec.customBenefits,
      customDetriments: this.spec.customDetriments,
      buffs: this.spec.buffs,
      debuffs: this.spec.debuffs,
      ledger,
      baseBudget: ledger.baseBudget,
      spent: ledger.spent,
      pointsSpent: ledger.pointsSpent,
      extraPoints: ledger.extraPoints,
      effectiveBudget: ledger.effectiveBudget,
      balance: ledger.balance,
      remaining: ledger.remaining,
      isOverbudget: ledger.isOverbudget,
      overbudgetAmount: ledger.overbudgetAmount,
      isLegal: ledger.isLegal,
      hasSkillRankCapWarning: ledger.hasSkillRankCapWarning,
      heritage: this.spec.heritage,
      size: this.spec.size,
      sizeName: this.getSizeName(),
      sizeCost: ledger.sizeCost,
      statCost: ledger.statCost,
      statPenaltyExtra: ledger.statPenaltyExtra,
      skillCost: ledger.skillCost,
      spellCost: ledger.spellCost,
      benefitCost: ledger.benefitCost,
      customCost: ledger.customCost,
      buffCost: ledger.buffCost,
      debuffExtra: ledger.debuffExtra,
      statPoolCost: ledger.statPoolCost,
      rankBonusCost: ledger.rankBonusCost,
      rankBonusExtra: ledger.rankBonusExtra,
      detrimentExtraPoints: ledger.detrimentExtraPoints,
      rawDetrimentPoints: ledger.rawDetrimentPoints
    });
  }

  // =========================================================================
  // DOCUMENT GENERATION & EXPORT
  // =========================================================================

  /**
   * Generates a complete Item document payload conforming to Foundry VTT Item schema.
   * @param {object} [options={}]
   * @returns {object}
   */
  createItemData(options = {}) {
    const isRuleBreak = Boolean(options.ruleBreak || options.isRuleBreak);
    const warnings = [];
    this.payloadWarnings = warnings;
    return buildPayload(this.spec.builderType === 'race' ? 'race' : 'class', { ...this.spec, ruleBreak: isRuleBreak }, { warnings });
  }

  /** Show what `buildPayload` warned about in the last payload (an unknown tag, a bad grant row). */
  _surfaceWarnings() {
    for (const w of this.payloadWarnings ?? []) globalThis.ui?.notifications?.warn?.(`${w.path}: ${w.message}`);
  }

  /** Tell the user why a Rule Break was refused. A Cancel is the user's own choice and needs no message. */
  _notifyRuleBreakRefused(res) {
    if (res?.refusal === 'cancelled') return;
    globalThis.ui?.notifications?.warn?.(res?.reason || 'Rule Break refused.');
  }

  /**
   * Save the created item directly into the world's Items directory, adjudicating
   * permissive rule breaks if point-buy budget is exceeded.
   *
   * @param {object} [options={}]
   * @returns {Promise<Item|null>}
   */
  async saveToWorldItem(options = {}) {
    const ledger = this.getPointLedger();
    let isRuleBreak = Boolean(options.ruleBreak || options.forceRuleBreak);

    if (ledger.isOverbudget && !isRuleBreak) {
      const confirmRes = await confirmRuleBreak({
        title: 'Point-Buy Budget Exceeded',
        message: `Points spent (${ledger.pointsSpent}) exceeds effective budget (${ledger.effectiveBudget}). Save anyway as a Rule Break?`,
        reason: `Points spent (${ledger.pointsSpent}) exceeds the effective budget (${ledger.effectiveBudget}).`,
        options
      });
      if (!confirmRes.confirmed) {
        this._notifyRuleBreakRefused(confirmRes);
        return null;
      }
      isRuleBreak = true;
    }

    const itemData = this.createItemData({ ruleBreak: isRuleBreak });
    this._surfaceWarnings();
    if (globalThis.Item && typeof globalThis.Item.create === 'function') {
      const created = await globalThis.Item.create(itemData);
      if (globalThis.ui?.notifications) {
        globalThis.ui.notifications.info(`Created ${this.spec.builderType}: "${created.name}" in Items directory!`);
      }
      return created;
    }
    return null;
  }

  /**
   * Exports the build specification as formatted JSON.
   */
  exportJSON() {
    const itemData = this.createItemData();
    const ledger = this.getPointLedger();
    return JSON.stringify({
      ...itemData,
      description: this.spec.description,
      ledger,
      stats: this.spec.stats,
      skills: this.spec.skills,
      spells: this.spec.spells,
      selectedBenefits: this.spec.selectedBenefits,
      selectedDetriments: this.spec.selectedDetriments,
      customBenefits: this.spec.customBenefits,
      customDetriments: this.spec.customDetriments,
      statPools: this.spec.statPools,
      rankBonuses: this.spec.rankBonuses,
      buffs: this.spec.buffs,
      debuffs: this.spec.debuffs
    }, null, 2);
  }

  /**
   * Applies the custom class/race directly to a Crawler Actor.
   *
   * @param {Actor} actor
   * @param {object} [options={}]
   * @returns {Promise<Item|null>}
   */
  async applyToActor(actor, options = {}) {
    if (!actor) return null;

    // The Third Floor gate, choices, grants, stat deltas and flags all belong to the applier.
    const kind = this.spec.builderType === 'race' ? 'race' : 'class';

    const ledger = this.getPointLedger();
    let isRuleBreak = Boolean(options.ruleBreak || options.forceRuleBreak);

    if (ledger.isOverbudget && !isRuleBreak) {
      const confirmRes = await confirmRuleBreak({
        title: 'Point-Buy Budget Exceeded',
        message: `Points spent (${ledger.pointsSpent}) exceeds effective budget (${ledger.effectiveBudget}). Apply anyway as a Rule Break?`,
        reason: `Points spent (${ledger.pointsSpent}) exceeds the effective budget (${ledger.effectiveBudget}).`,
        options
      });
      if (!confirmRes.confirmed) {
        this._notifyRuleBreakRefused(confirmRes);
        return null;
      }
      isRuleBreak = true;
    }

    const itemData = this.createItemData({ ruleBreak: isRuleBreak });
    this._surfaceWarnings();

    // The applier is the one path that writes race and class stats, items, skills, spells, effects and flags (the same as
    // compendium and dropped races and classes); the builder's in-memory payload is its definition.
    const applied = await COGRaceClassApplier.applyKind(actor, kind, itemData, options);
    if (!applied) return null;
    const flagKey = kind === 'race' ? 'appliedRace' : 'appliedClass';
    const itemId = actor.getFlag?.(SYSTEM_ID, flagKey)?.itemId;
    const createdItem = (itemId && actor.items?.get(itemId)) || actor.items?.find(i => i.type === kind) || null;

    if (typeof this.render === 'function') {
      this.render();
    }

    return createdItem;
  }

  // =========================================================================
  // PRESET HANDLING
  // =========================================================================

  loadPreset(presetId) {
    const preset = pointBuildPresets().find(p => p.id === presetId);
    if (!preset) return;

    this.spec.name = preset.name;
    this.spec.description = preset.description || '';
    this.spec.prerequisites = preset.prerequisites || '';
    if (preset.stats) this.spec.stats = { ...preset.stats };
    if (preset.skills) this.spec.skills = preset.skills.map(s => ({ ...s }));
    if (preset.spells) this.spec.spells = preset.spells.map(sp => ({ ...sp }));
    if (preset.selectedBenefits) this.spec.selectedBenefits = preset.selectedBenefits.map(b => ({ ...b }));
    if (preset.selectedDetriments) this.spec.selectedDetriments = preset.selectedDetriments.map(d => ({ ...d }));
    this.spec.customBenefits = [];
    this.spec.customDetriments = [];
    this.spec.statPools = Array.isArray(preset.statPools) ? preset.statPools.map(p => structuredClone(p)) : [];
    this.spec.rankBonuses = Array.isArray(preset.rankBonuses) ? preset.rankBonuses.map(r => structuredClone(r)) : [];
    // Heritage and size ride along as the preset states them; the builder reads them as the spec does.
    if (preset.heritage) this.spec.heritage = sanitizeHeritageId(preset.heritage);
    if (preset.size !== undefined && preset.size !== null) this.spec.size = String(preset.size);

    // Synchronize drBonus from the preset's DR benefit, by its structured drBonus (never its name)
    const presetDr = this.spec.selectedBenefits.reduce((max, b) => Math.max(max, drBonusOfBenefit(b)), 0);
    this.spec.drBonus = presetDr || Number(preset.drBonus) || 0;
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
    if (!this.targetActorId && globalThis.game?.actors) {
      const crawlers = Array.from(globalThis.game.actors.values()).filter(a => a.type === 'crawler');
      if (crawlers.length === 1) this.targetActorId = crawlers[0].id;
    }

    if (!this.targetActorId) {
      const noun = this.spec.builderType === 'race' ? 'Race' : 'Class';
      globalThis.ui?.notifications?.warn(`Please select a target Crawler to apply this ${noun} to.`);
      return;
    }

    const actor = globalThis.game?.actors?.get(this.targetActorId);
    if (actor) await this.applyToActor(actor, { interactive: true });
  }

  static async #onResetBlank() {
    this._resetToBlank();
    await this.render();
  }
}
