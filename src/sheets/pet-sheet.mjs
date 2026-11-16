import { COGCrawlerSheet } from './crawler-sheet.mjs';
import { DEFAULT_SIZE, sizeOptions } from '../data/sizes.mjs';
import { PET_MAX_HEALTH_BARS, petAttitudeOptions, petOriginOptions } from '../data/rules/pet-rules.mjs';
import { rollPetCheck, tamingReadout } from '../documents/actor/pet-checks.mjs';
import { addPetAbility, applyPetRole, petRoleView } from '../documents/actor/pet-roles.mjs';
import { COGBuffDebuffManager } from '../apps/buff-manager.mjs';
import { PET_TAGS } from '../data/tag-vocabulary.mjs';

/** The Health Bar slots line: where the number comes from, or [OVERRIDE] when a stored count wins. */
function petSlotsReadout(system) {
  const hp = system?.attributes?.hp ?? {};
  const level = Number(system?.details?.level) || 1;
  const overridden = Number(hp.bars) !== Number(hp.derivedBars);
  const how = system?.details?.isMount
    ? `dedicated mount, size ${system?.attributes?.sizeNumber}`
    : `size ${system?.attributes?.startingSizeNumber} + ${level - 1} Levels (max ${PET_MAX_HEALTH_BARS})`;
  return { text: `Slots: ${how} = ${hp.derivedBars}`, overridden };
}

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

/** The rider rolls the Unopposed Riding check to stay on (the GM calls for it; nothing rolls it on its own). */
async function petRideCheck() {
  const rider = this.actor.getRiderActor?.() ?? null;
  if (!rider) return;
  await rollPetCheck(this.actor, rider, { kind: 'ride' });
}

/** Roll a taming check against this pet: the owner rolls, else the user's own character (the GM adjudicates the rest). */
async function petTame() {
  const roller = this.actor.getOwnerActor?.() ?? globalThis.game?.user?.character ?? null;
  if (!roller) {
    globalThis.ui?.notifications?.warn?.('Bond this pet to a crawler, or link a character to your user, to roll the taming check.');
    return;
  }
  await rollPetCheck(this.actor, roller);
}

/** Open the role picker (`kind` 'role') or the special ability picker (anything else): the buff library, listing only the buffs tagged for it. */
function openPetBuffPicker(pet, kind) {
  const role = kind === 'role';
  new COGBuffDebuffManager({
    actor: pet,
    tagPrefix: role ? PET_TAGS.rolePrefix : PET_TAGS.abilityPrefix,
    onPick: async (data) => { await (role ? applyPetRole(pet, data) : addPetAbility(pet, data)); pet.sheet?.render?.({ force: true }); }
  }).render({ force: true });
}

/** Choose the pet's role. */
function petChooseRole() {
  if (this.isEditable) openPetBuffPicker(this.actor, 'role');
}

/** Add a special ability. */
function petAddAbility() {
  if (this.isEditable) openPetBuffPicker(this.actor, 'ability');
}

/** Remove a special ability buff. */
async function petRemoveAbility(event, target) {
  if (!this.isEditable) return;
  const id = String(target?.dataset?.itemId ?? '');
  if (id && this.actor.items.get(id)) await this.actor.deleteEmbeddedDocuments('Item', [id]);
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
    actions: { petOpenOwner, petUnlinkOwner, petDismountRider, petTame, petRideCheck, petChooseRole, petAddAbility, petRemoveAbility }
  };

  /** Open the role picker from the first-Bonded card's button (the chat handler calls this; the viewer must be able to edit). */
  openRolePicker(kind = 'role') {
    if (this.isEditable) openPetBuffPicker(this.actor, kind);
  }

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
    context.petSlots = petSlotsReadout(actor.system);
    context.attitudeOptions = petAttitudeOptions(actor.system?.details?.attitude);
    context.originOptions = petOriginOptions(actor.system?.details?.origin);
    context.petRole = petRoleView(actor);
    context.taming = tamingReadout(actor);
    context.canRideCheck = Boolean(context.rider);

    return context;
  }
}
