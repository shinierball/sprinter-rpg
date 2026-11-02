import { COGCrawlerSheet } from './crawler-sheet.mjs';
import { DEFAULT_SIZE, sizeOptions } from '../data/sizes.mjs';

/** Open the bonded owner's sheet. */
function petOpenOwner() {
  this.actor.getOwnerActor?.()?.sheet?.render({ force: true });
}

/** Unbond this pet from its owner. */
async function petUnlinkOwner() {
  if (!this.isEditable) return;
  const owner = this.actor.getOwnerActor?.();
  if (owner?.unbondCompanion) await owner.unbondCompanion(this.actor.id);
  else await this.actor.update({ 'system.details.ownerId': '' });
}

/** Dismount the current rider. */
async function petDismountRider() {
  if (!this.isEditable) return;
  await this.actor.dismountRider?.();
}

/**
 * Dedicated Sheet Controller for Pets and Companions in Sprinter RPG.
 * Extends COGCrawlerSheet for full capability parity (attacks, spells,
 * skills, hotbar, health bars, inventory, conditions) while omitting
 * story and achievement tabs.
 */
export class COGPetSheet extends COGCrawlerSheet {
  /** Companions have no story or achievements tab (2.6 §5.4). */
  static OMIT_TABS = { primary: ['story', 'achievements'] };

  static DEFAULT_OPTIONS = {
    classes: ['pet'],
    window: { title: 'COG.PetSheet' },
    actions: { petOpenOwner, petUnlinkOwner, petDismountRider }
  };

  /**
   * Prepares context data for rendering the Pet Sheet template.
   * Inherits full crawler context and supplements with pet-specific owner/rider relationships.
   * @override
   */
  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    context.isPet = true;

    const brief = (a) => a ? {
      id: a.id,
      name: a.name,
      img: a.img || a.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg'
    } : null;

    const owner = actor.getOwnerActor?.() ?? null;
    context.owner = brief(owner);
    context.rider = brief(actor.getRiderActor?.() ?? null);

    // Check rideable status relative to owner
    context.isRideableByOwner = owner ? Boolean(actor.canBeRiddenBy?.(owner)) : Boolean(actor.system?.details?.isMount);

    context.sizeOptions = sizeOptions(actor.system?.attributes?.size || DEFAULT_SIZE);

    return context;
  }
}
