/**
 * Sprinter RPG — Custom Race Creator Studio (ApplicationV2)
 *
 * Implements the Race Creator Studio matching Option A: The "Terminal Ledger" Accordion Studio.
 * Derived from Chapter 3 (Pages 128–143 & 158–164) of the core rulebook.
 *
 * Features:
 * - 25 Base Race Build Points with live point ledger.
 * - Shows exact points used for each attribute, perk, skill, size, and detriment.
 * - Soft Limit Policy: does NOT enforce a hard limit; informs the user without blocking
 *   item creation, JSON export, or actor application.
 * - Heritage Selection: Earth (Earth Origin Box + Earth Classes) vs Alien (Off-World Fanbase Popularity).
 * - Creature Size pills come from the size registry (`raceSizeOptions`): a blank "No change" pill at 0 BP, then each
 *   registered size with its `raceCost` (Tiny, Small, Large and Huge cost 3 BP; Petite and Medium cost 0).
 * - Interactive accordion drawers for Minor (1 BP), Moderate (2 BP), Major (3 BP),
 *   Extreme (4 BP), Epic (6 BP) benefits, Detriments (+1 to +3 Extra BP), and Custom Perks.
 * - Instant export to Foundry World Item directory, formatted JSON export/import,
 *   and 1-click active crawler sheet application.
 */

import { COGBasePointBuilderApp } from './base-point-builder.mjs';
import { buildRacePayload } from '../data/builders/point-buy-payload.mjs';

export { buildRacePayload };
import { pointBuildBenefits, pointBuildDetriments, pointBuildPresets } from '../content/point-build.mjs';
import { COG_BENEFIT_TIERS, COG_DETRIMENT_TIERS } from '../data/rules/point-build-tiers.mjs';
import { catalogEntries, findCatalogEntry } from '../content/catalog-lookup.mjs';
import { DEFAULT_SIZE, raceSizeOptions, sanitizeSizeId } from '../data/sizes.mjs';
import { getHeritage, heritagePills, sanitizeHeritageId } from '../data/rules/heritages.mjs';
import { COGRaceClassApplier } from '../data/race-class-applier.mjs';
import { SYSTEM_PATH } from '../constants.mjs';

/** A heritage id as a short capitalized word for the preset list ("Earth"). */
const heritageName = (raw) => { const id = sanitizeHeritageId(raw); return id.charAt(0).toUpperCase() + id.slice(1); };

export class COGRaceCreatorApp extends COGBasePointBuilderApp {
  // No fixed id: several race creators may be open at once.
  static DEFAULT_OPTIONS = {
    id: 'cog-race-creator-{id}',
    classes: ['cog-race-creator-app'],
    window: { title: 'Sprinter RPG — Race Creator Studio', icon: 'fa-solid fa-dna', resizable: true },
    // Heritage and size are pills on the base `setProp` action (`data-prop`), so this app adds no actions
    position: { width: 960, height: 840 }
  };

  static PARTS = {
    header: { template: `${SYSTEM_PATH}/templates/apps/point-builder/header.hbs` },
    builder: { template: `${SYSTEM_PATH}/templates/apps/race-creator/builder.hbs`, scrollable: ['', '.cog-studio-builder'] },
    receipt: { template: `${SYSTEM_PATH}/templates/apps/point-builder/receipt.hbs`, scrollable: ['', '.cog-receipt-list'] }
  };

  constructor(options = {}) {
    super({
      ...options,
      builderType: 'race',
      baseBudget: 25,
      heritage: sanitizeHeritageId(options.heritage),
      size: sanitizeSizeId(options.size ?? DEFAULT_SIZE)
    });

    this.targetActorId = options.targetActorId || null;
  }

  // =========================================================================
  // RACE SPECIFIC MUTATORS
  // =========================================================================

  loadPreset(presetId) {
    super.loadPreset(presetId);

    // Registered races (the preset dropdown carries the race id)
    const canonicalRace = findCatalogEntry('races', presetId);
    if (canonicalRace) {
      this.resetBuild();
      this.spec.name = canonicalRace.name;
      this.spec.description = canonicalRace.system?.description ? canonicalRace.system.description.replace(/<[^>]+>/g, '').trim() : '';
      this.spec.prerequisites = canonicalRace.system?.prerequisites || '';
      this.spec.heritage = sanitizeHeritageId(canonicalRace.system?.heritage);
      
      // Blank stays blank: a race that leaves size alone (D10)
      this.spec.size = sanitizeSizeId(canonicalRace.system?.size);

      // Stats, DR, skills and spells come from the item's grant rows (the only structured form)
      const granted = COGRaceClassApplier.parseGrants(canonicalRace);
      this.spec.stats = { ...granted.stats };
      this.setDRBonus(granted.drBonus);
      this.loadGrantRows(canonicalRace);
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

    // The size pills: blank ("No change", 0 BP) first, then each registered size with its cost
    const sizeOptions = raceSizeOptions(this.spec.size);

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

    // Heritage inherent perk: the 0-cost receipt line the registry gives the chosen heritage
    const heritagePerk = getHeritage(this.spec.heritage)?.perk;
    const heritagePerks = heritagePerk ? [{ ...heritagePerk, points: 0, cost: 0 }] : [];

    // Crawlers in world for direct application
    const crawlers = globalThis.game?.actors
      ? Array.from(globalThis.game.actors.values())
          .filter(a => a.type === 'crawler')
          .map(a => ({
            id: a.id,
            name: a.name,
            isSelected: a.id === this.targetActorId
          }))
      : [];

    // Presets: registered races, plus registered point-build presets
    const presets = [...pointBuildPresets('race').map(p => ({ id: p.id, name: p.name })), ...catalogEntries('races').map(r => ({
      id: r._id,
      name: `${r.name} (${heritageName(r.system.heritage)})`
    }))];

    return Object.assign(context, {
      builderType: 'race',
      name: this.spec.name,
      description: this.spec.description,
      prerequisites: this.spec.prerequisites,
      heritage: this.spec.heritage,
      heritagePills: heritagePills(this.spec.heritage),
      size: this.spec.size,
      sizeName: this.getSizeName(),
      sizeOptions,
      stats: this.spec.stats,
      drBonus: this.spec.drBonus,
      drCost: this.spec.drBonus * 2,
      skills: this.spec.skills,
      spells: this.spec.spells,
      benefits: [...heritagePerks, ...this.spec.selectedBenefits],
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
      sizeCost: ledger.sizeCost,
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
}
