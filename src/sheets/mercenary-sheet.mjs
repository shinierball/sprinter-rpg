import { COGCrawlerSheet } from './crawler-sheet.mjs';
import { DEFAULT_SIZE, sizeOptions } from '../data/sizes.mjs';
import { COGRaceClassApplier } from '../data/race-class-applier.mjs';
import { resolveActor } from '../documents/actor.mjs';

/**
 * Dedicated Sheet Controller for Mercenaries in Sprinter RPG.
 * Extends COGCrawlerSheet for full capability parity (attacks, weapons, spells,
 * skills, hotbar, health bars, inventory, conditions) while providing mercenary-specific
 * contract details, daily rates, multi-player employer links, and barracks housing.
 */
export class COGMercenarySheet extends COGCrawlerSheet {
  /** Companions have no story or achievements tab (2.6 §5.4). */
  static OMIT_TABS = { primary: ['story', 'achievements'] };

  static DEFAULT_OPTIONS = {
    classes: ['mercenary'],
    window: { title: 'COG.MercenarySheet' },
    actions: {
      mercOpenEmployer: COGMercenarySheet.#openEmployer,
      mercUnlinkEmployer: COGMercenarySheet.#unlinkEmployer,
      mercOpenGuild: COGMercenarySheet.#openGuild
    }
  };

  /**
   * Prepares context data for rendering the Mercenary Sheet template.
   * Inherits full crawler context (attacks, spells, skills, hotbar, gear, conditions)
   * and supplements with mercenary contract and employer data.
   * @override
   */
  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);

    const actor = this.actor;
    context.isMercenary = true;

    // Resolve Primary Employer Crawler
    const owner = actor.getOwnerActor();
    context.owner = owner ? {
      id: owner.id,
      name: owner.name,
      img: owner.img || owner.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg'
    } : null;

    // Resolve All Linked Employers
    const employers = actor.getEmployerActors();
    context.employers = employers.map(e => ({
      id: e.id,
      name: e.name,
      img: e.img || e.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg',
      isPrimary: e.id === owner?.id
    }));

    // Contract & Rate details
    const sys = actor?.system || {};
    const details = sys.details || {};
    context.isHired = Boolean(details.hired);
    context.contractDays = Number(details.contractDays) || 0;
    context.dailyRate = Number(details.dailyRate) || 0;
    context.effectiveDailyRate = Number(sys.effectiveDailyRate ?? details.dailyRate) || 0;
    context.hasDiscount = context.effectiveDailyRate < context.dailyRate;
    context.discountPct = Number(sys.dailyRateDiscountPct) || 0;

    // Barracks housing
    context.housedSpace = null;
    if (details.housedSpaceId) {
      const spaceActor = resolveActor(details.housedSpaceId);
      if (spaceActor) {
        context.housedSpace = {
          id: spaceActor.id,
          name: spaceActor.name,
          rank: spaceActor.system?.rank,
          typeLabel: spaceActor.system?.typeLabel
        };
      }
    }

    // Role options
    const roles = ['Tank', 'DPS', 'Healer', 'Support', 'Scout'];
    const currentRole = details.role || 'DPS';
    context.roleOptions = roles.map(r => ({
      value: r,
      label: r,
      selected: r.toLowerCase() === currentRole.toLowerCase()
    }));

    // Race selection context
    const raceContext = COGRaceClassApplier.getRaceClassContext(actor, { requirements: true });
    context.raceOptions = raceContext.raceOptions || [];
    context.currentRequirements = raceContext.currentRequirements;
    context.hasCustomRace = raceContext.hasCustomRace || false;
    context.currentRaceLabel = raceContext.currentRaceLabel || '';

    // Precompute size options
    context.sizeOptions = sizeOptions(sys.attributes?.size || DEFAULT_SIZE);

    return context;
  }

  /** click: open a linked employer's sheet (`data-employer-id`). */
  static #openEmployer(event, target) {
    event.preventDefault();
    resolveActor(target.dataset.employerId)?.sheet?.render({ force: true });
  }

  /** click: unlink an employer; the next remaining employer (if any) becomes the primary owner. */
  static async #unlinkEmployer(event, target) {
    event.preventDefault();
    const empId = target.dataset.employerId;
    if (!empId) return;
    // Through the employer so both sides stay in sync (its companion list and this mercenary's employers).
    const employer = resolveActor(empId);
    if (employer?.unbondCompanion) {
      await employer.unbondCompanion(this.actor.id);
      return;
    }
    const employers = (this.actor.system?.details?.employerIds || []).filter(id => id !== empId);
    await this.actor.update({
      'system.details.employerIds': employers,
      'system.details.ownerId': employers[0] || '',
      'system.details.hired': employers.length > 0
    });
  }

  /** click: open the Mercenary Guild app. */
  static #openGuild(event) {
    event.preventDefault();
    const MercGuild = globalThis.game?.cog?.COGMercenaryGuildApp;
    if (MercGuild) MercGuild.open();
  }
}
