/**
 * Sprinter RPG — Custom Class Creator Studio (ApplicationV2)
 *
 * Implements Option A: The "Terminal Ledger" Accordion Studio.
 * Derived from Chapter 3 (Pages 144–164) of the core rulebook.
 *
 * Features:
 * - 30 Base Build Points with live point ledger.
 * - Shows exact points used for each attribute, perk, skill, and detriment.
 * - Does NOT enforce a hard limit: soft badges allow homebrew and GM-discretion builds.
 * - Interactive accordion drawers for Minor, Moderate, Major, Extreme, and Epic benefits.
 * - Supports Earth Class perks (Silver Earth Box & hobby skill potion).
 * - Instant export to Foundry Item directory, JSON export, and 1-click crawler sheet application.
 */

import { COGBasePointBuilderApp } from './base-point-builder.mjs';
import { pointBuildBenefits, pointBuildDetriments, pointBuildPresets } from '../content/point-build.mjs';
import { COG_BENEFIT_TIERS, COG_DETRIMENT_TIERS } from '../data/rules/point-build-tiers.mjs';
import { findCatalogEntry } from '../content/catalog-lookup.mjs';
import { offeredEntries } from '../utils/content-source.mjs';
import { COGRaceClassApplier } from '../data/race-class-applier.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { archetypeTagId } from '../data/builders/point-buy-payload.mjs';
import { COG_TAGS } from '../data/tag-catalog.mjs';
import { ARCHETYPE_TO_TAG } from '../data/tag-vocabulary.mjs';
import { getCustomTags } from '../data/tag-definitions.mjs';

/** The registered `archetype.*` tags (core and module-registered) the creator offers. */
function registeredArchetypes() {
  return [...COG_TAGS, ...getCustomTags()]
    .filter((t) => t?.id && (t.namespace || String(t.id).split('.')[0]) === 'archetype')
    .map((t) => ({ id: t.id, label: t.label || t.id }));
}

/** Display labels of archetype tags, comma separated. */
function archetypeLabels(ids) {
  const labels = new Map(registeredArchetypes().map((a) => [a.id, a.label]));
  return (Array.isArray(ids) ? ids : []).map((id) => labels.get(id) ?? id).join(', ');
}

export class COGClassCreatorApp extends COGBasePointBuilderApp {
  // No fixed id: several class creators may be open at once.
  static DEFAULT_OPTIONS = {
    id: 'cog-class-creator-{id}',
    classes: ['cog-class-creator-app'],
    window: { title: 'Sprinter RPG — Class Creator Studio', icon: 'fa-solid fa-shield-halved', resizable: true },
    position: { width: 960, height: 840 },
    actions: {
      toggleType: COGClassCreatorApp.#onToggleType,
      setEarthClass: COGClassCreatorApp.#onSetEarthClass
    }
  };

  static PARTS = {
    header: { template: `${SYSTEM_PATH}/templates/apps/point-builder/header.hbs` },
    builder: { template: `${SYSTEM_PATH}/templates/apps/class-creator/builder.hbs`, scrollable: ['', '.cog-studio-builder'] },
    receipt: { template: `${SYSTEM_PATH}/templates/apps/point-builder/receipt.hbs`, scrollable: ['', '.cog-receipt-list'] }
  };

  constructor(options = {}) {
    super({
      ...options,
      builderType: 'class',
      baseBudget: 30
    });

    this.targetActorId = options.targetActorId || null;
  }

  // =========================================================================
  // ARCHETYPE & EARTH CLASS HELPERS
  // =========================================================================

  setArchetype(type) {
    if (type) {
      this.spec.archetypes = [archetypeTagId(type)];
      if (typeof this.render === 'function') this.render({ parts: ['builder', 'receipt'] });
    }
  }

  toggleEarthClass(enabled) {
    this.spec.isEarthClass = Boolean(enabled);
    if (typeof this.render === 'function') this.render({ parts: ['builder', 'receipt'] });
  }

  loadPreset(presetId) {
    super.loadPreset(presetId);

    // 1. Registered presets (e.g. a module's custom class)
    const preset = pointBuildPresets('class').find(p => p.id === presetId);
    if (preset) {
      if (Array.isArray(preset.archetypes) && preset.archetypes.length) this.spec.archetypes = preset.archetypes.map(archetypeTagId);
      if (preset.isEarth !== undefined) this.spec.isEarthClass = Boolean(preset.isEarth);
      return;
    }

    // 2. Registered classes (the preset dropdown carries the class id)
    const canonicalClass = findCatalogEntry('classes', presetId);
    if (canonicalClass) {
      this.resetBuild();
      this.spec.name = canonicalClass.name;
      this.spec.description = canonicalClass.system?.description ? canonicalClass.system.description.replace(/<[^>]+>/g, '').trim() : '';
      this.spec.prerequisites = canonicalClass.system?.prerequisites || '';

      const stored = Array.isArray(canonicalClass.system?.archetypes) ? canonicalClass.system.archetypes : [];
      this.spec.archetypes = stored.length ? stored.map(archetypeTagId) : [ARCHETYPE_TO_TAG.fighter];

      // Stats, DR, skills and spells come from the item's grant rows (the only structured form)
      const granted = COGRaceClassApplier.parseGrants(canonicalClass);
      this.spec.stats = { ...granted.stats };
      this.setDRBonus(granted.drBonus);
      this.loadGrantRows(canonicalClass);
      for (const sk of granted.skills) {
        this.addSkill({ name: sk.name, rank: sk.rank });
      }
      for (const sp of granted.spells) {
        this.addSpell({ name: sp.name, rank: sp.rank });
      }
    }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const ledger = this.getPointLedger();

    // Prepare Archetype selection pills
    const archetypePills = registeredArchetypes().map(({ id, label }) => ({
      id,
      name: label,
      isSelected: this.spec.archetypes.includes(id)
    }));

    // Filtered Benefit Tiers
    const search = (this.searchQuery || '').trim().toLowerCase();
    const benefitTiers = [];

    for (const [tierKey, tierMeta] of Object.entries(COG_BENEFIT_TIERS)) {
      if (this.activeTierFilter !== 'all' && this.activeTierFilter !== tierKey) {
        continue;
      }

      const allItems = pointBuildBenefits().filter(b => b.tier === tierKey);
      const matchedItems = allItems.filter(b => {
        if (!search) return true;
        return (
          b.name.toLowerCase().includes(search) ||
          b.category.toLowerCase().includes(search) ||
          b.description.toLowerCase().includes(search)
        );
      });

      benefitTiers.push({
        id: tierKey,
        label: tierMeta.label,
        cost: tierMeta.cost,
        isOpen: Boolean(this.accordionOpen[tierKey] || search.length > 0),
        count: matchedItems.length,
        items: matchedItems.map(b => ({
          ...b,
          isSelected: this.spec.selectedBenefits.some(sb => sb.id === b.id),
          customText: this.customTextFor('selectedBenefits', b.id),
          paramPickers: this.paramPickersFor(b)
        }))
      });
    }

    // Filtered Detriment Tiers
    const detrimentTiers = [];
    for (const [detTierKey, detMeta] of Object.entries(COG_DETRIMENT_TIERS)) {
      const allDetItems = pointBuildDetriments().filter(d => d.tier === detTierKey);
      const matchedDetItems = allDetItems.filter(d => {
        if (!search) return true;
        return (
          d.name.toLowerCase().includes(search) ||
          d.description.toLowerCase().includes(search)
        );
      });

      detrimentTiers.push({
        id: detTierKey,
        label: detMeta.label,
        extraPoints: detMeta.extraPoints,
        isOpen: Boolean(this.accordionOpen.detriments || search.length > 0),
        items: matchedDetItems.map(d => ({
          ...d,
          isSelected: this.spec.selectedDetriments.some(sd => sd.id === d.id),
          customText: this.customTextFor('selectedDetriments', d.id),
          paramPickers: this.paramPickersFor(d)
        }))
      });
    }

    // Crawlers in the world for direct application
    const crawlers = globalThis.game?.actors
      ? Array.from(globalThis.game.actors.values())
          .filter(a => a.type === 'crawler')
          .map(a => ({
            id: a.id,
            name: a.name,
            isSelected: a.id === this.targetActorId
          }))
      : [];

    // Presets list: the point-build presets plus every class in the catalog
    const presets = [
      ...pointBuildPresets('class').map(p => ({
        id: p.id,
        name: `${p.name} (Preset Class)`,
        isCanonical: true
      })),
      ...offeredEntries('classes').slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => ({
        id: c._id,
        name: `${c.name} (${archetypeLabels(c.system.archetypes) || 'Class'})`,
        isCanonical: true
      }))
    ];

    return Object.assign(context, {
      builderType: 'class',
      name: this.spec.name,
      description: this.spec.description,
      prerequisites: this.spec.prerequisites,
      isEarthClass: this.spec.isEarthClass,
      archetypePills,
      stats: this.spec.stats,
      drBonus: this.spec.drBonus,
      drCost: this.spec.drBonus * 2,
      skills: this.spec.skills,
      spells: this.spec.spells,
      benefits: this.spec.isEarthClass
        ? [{ id: 'earth_class_knowledge', name: 'Silver Earth Box (Hobby Skill Potion)', points: 0, cost: 0, category: 'Earth', tier: 'minor' }, ...this.spec.selectedBenefits]
        : this.spec.selectedBenefits,
      detriments: this.spec.selectedDetriments,
      selectedBenefits: this.spec.selectedBenefits,
      selectedDetriments: this.spec.selectedDetriments,
      customBenefits: this.spec.customBenefits,
      customDetriments: this.spec.customDetriments,
      benefitTiers,
      detrimentsOpen: Boolean(this.accordionOpen.detriments || search.length > 0),
      customOpen: Boolean(this.accordionOpen.custom),
      detrimentTiers,
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
      statCost: ledger.statCost,
      statPenaltyExtra: ledger.statPenaltyExtra,
      skillCost: ledger.skillCost,
      spellCost: ledger.spellCost,
      benefitCost: ledger.benefitCost,
      customCost: ledger.customCost,
      detrimentExtraPoints: ledger.detrimentExtraPoints,
      rawDetrimentPoints: ledger.rawDetrimentPoints,
      crawlers,
      presets,
      searchQuery: this.searchQuery,
      activeTierFilter: this.activeTierFilter
    });
  }

  /** Class studio resets fields in place (the shared reset also renames the build). */
  _resetToBlank() {
    this.spec.name = '';
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
  }

  /** Archetype pills multi-select; at least one stays selected. */
  static async #onToggleType(event, target) {
    const type = archetypeTagId(target.dataset.type);
    if (this.spec.archetypes.includes(type)) {
      if (this.spec.archetypes.length > 1) this.spec.archetypes = this.spec.archetypes.filter(t => t !== type);
    } else {
      this.spec.archetypes.push(type);
    }
    await this._refreshBuild();
  }

  static async #onSetEarthClass(event, target) {
    this.spec.isEarthClass = target.checked;
    await this._refreshBuild();
  }
}

