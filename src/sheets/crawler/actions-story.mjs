/**
 * Story tab actions: background table rolls, companions (pets and vehicles) and the
 * personal space. Every handler runs with `this` bound to the sheet.
 * Handlers that change another actor call `this.render()`; updates to this actor re-render on their own.
 */
import { COGActor } from '../../documents/actor.mjs';
import { rollBackgroundTable } from '../../data/rules/background-table-rules.mjs';
import { contentRegistry } from '../../content/registry.mjs';
import { buildPayload } from '../../data/builders/item-payload.mjs';
import { COGStashApp } from '../../apps/stash-app.mjs';
import { COGCraftingApp } from '../../apps/crafting-app.mjs';
import { changeVehicleCrew, vehicleOf } from '../../documents/actor/vehicle-crew.mjs';
import { resolveSpace } from '../../documents/actor/personal-space-links.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { driveActions } from '../vehicle/drive-actions.mjs';

const worldActor = (id) => (id ? globalThis.game?.actors?.get?.(id) ?? null : null);

/** The vehicle a button names: `data-vehicle-uuid` (the Aboard strip; may be an unlinked token), else `data-vehicle-id`. */
const vehicleFor = (dataset) => (dataset?.vehicleUuid ? resolveActorByUuid(dataset.vehicleUuid) : worldActor(dataset?.vehicleId));

/** The space a dock button names with `data-space-uuid`, else the crawler's owned space. */
function spaceFor(actor, target) {
  const uuid = target?.dataset?.spaceUuid;
  return uuid ? resolveSpace(uuid) : actor.getOwnedPersonalSpace();
}

function storyCard(res) {
  return `
    <div class="cog-chat-card cog-story-roll-card">
      <header class="cog-card-header flexrow">
        <span class="cog-card-title"><strong>${res.tableName}</strong></span>
        <span class="cog-badge roll-badge">Roll: ${res.roll}</span>
      </header>
      <div class="cog-card-body">
        <p class="cog-story-result-text"><em>"${res.text}"</em></p>
      </div>
    </div>
  `;
}

async function createCompanion(sheet, data) {
  const companion = await COGActor.create(buildPayload(data.type, data, { delegate: false }));
  if (companion) await sheet.actor.bondCompanion(companion);
  return sheet.render();
}

export const storyActions = {
  // The Aboard strip's driver controls (speed, Drive, Brake, Ram): the same handlers as the vehicle sheet's drive panel.
  ...driveActions((sheet, target) => vehicleFor(target?.dataset) ?? vehicleOf(sheet.actor)),

  /** Roll a background table (`data-table`: pastTrauma, looseEnds, regrets) and append the result. */
  async rollStoryTable(event, target) {
    if (!this.isEditable) return;
    const tableKey = target.dataset.table;
    if (!contentRegistry.getBackgroundTable(tableKey)) return;
    try {
      const res = await rollBackgroundTable(tableKey);
      if (res.empty || !res.text) return; // a table with no rows has nothing to add
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), content: storyCard(res) });
      const current = this.actor.system?.details?.[tableKey] || '';
      await this.actor.update({ [`system.details.${tableKey}`]: current ? `${current}\n${res.text}` : res.text });
      ui.notifications?.info(`Rolled [${res.roll}] on ${res.tableName}: "${res.text}"`);
    } catch (err) {
      console.error('Sprinter RPG | Error rolling story table:', err);
    }
  },

  async addPet() {
    if (!this.isEditable) return;
    return createCompanion(this, { type: 'pet', system: { details: { ownerId: this.actor.id } } });
  },

  async addVehicle() {
    if (!this.isEditable) return;
    return createCompanion(this, { type: 'mount_vehicle', system: { ownerId: this.actor.id } });
  },

  openCompanion(event, target) {
    const uuid = target.dataset.companionUuid;
    const actor = uuid ? resolveActorByUuid(uuid) : worldActor(target.dataset.companionId);
    actor?.sheet?.render({ force: true });
  },

  async unlinkCompanion(event, target) {
    if (!this.isEditable) return;
    const id = target.dataset.companionId;
    if (!id) return;
    await this.actor.unbondCompanion(id);
    return this.render();
  },

  /** Mount or dismount a bonded pet (`data-mode`: mount, dismount). */
  async toggleMount(event, target) {
    if (!this.isEditable) return;
    const pet = worldActor(target.dataset.petId);
    if (!pet) return;
    if (target.dataset.mode === 'mount') await pet.assignRider(this.actor);
    else if (target.dataset.mode === 'dismount') await pet.dismountRider();
    else return;
    return this.render();
  },

  /** A crew action on a vehicle (`data-vehicle-id`, `data-op`: embark, takeWheel, stepDown, disembark) for this crawler. */
  async vehicleCrew(event, target) {
    if (!this.isEditable) return;
    const vehicle = vehicleFor(target.dataset);
    if (!vehicle || !target.dataset.op) return;
    await changeVehicleCrew(vehicle, this.actor, target.dataset.op);
    return this.render();
  },

  /** The Aboard strip's role select changed: set this crawler's role in the vehicle it is aboard. */
  async vehicleCrewRole(event, target) {
    if (!this.isEditable) return;
    const vehicle = vehicleOf(this.actor);
    if (!vehicle) return;
    await changeVehicleCrew(vehicle, this.actor, 'setRole', { role: target.value });
    return this.render();
  },

  async acquireSpace() {
    if (!this.isEditable) return;
    await this.actor.acquirePersonalSpace();
    return this.render();
  },

  /** Open a space sheet (`data-space-uuid`, else the owned space). A space not shared yet only notifies. */
  openSpace(event, target) {
    const space = spaceFor(this.actor, target);
    if (!space) return;
    const user = globalThis.game?.user;
    if (!user?.isGM && space.testUserPermission?.(user, 'LIMITED') === false) {
      globalThis.ui?.notifications?.info?.(`${space.name} isn't shared with you yet. It will be once a GM connects.`);
      return;
    }
    space.sheet?.render({ force: true });
  },

  openStash() {
    if (!this.isEditable) return;
    new COGStashApp({ crawler: this.actor }).render({ force: true });
  },

  /** Open the crafting app for this crawler (inventory toolbar). */
  openCraftingApp() {
    if (!this.isEditable) return;
    COGCraftingApp.open({ crawler: this.actor });
  },

  async restInSpace(event, target) {
    if (!this.isEditable) return;
    const space = spaceFor(this.actor, target);
    await this.actor.restInPersonalSpace('long', space ? { space } : {});
    return this.render();
  },

  /** Leave a space (`data-space-uuid`, else the owned one). Giving up an owned space is GM-only. */
  async unlinkSpace(event, target) {
    if (!this.isEditable) return;
    const space = spaceFor(this.actor, target);
    if (!space) return;
    if (space === this.actor.getOwnedPersonalSpace()) {
      const proceed = await foundry.applications.api.DialogV2.confirm({
        window: { title: 'Unlink Personal Space' },
        content: `<p>Give up ${space.name}? ${this.actor.name} will no longer own it, and loses access unless a GM adds them back.</p>`,
        modal: true
      });
      if (!proceed) return;
    }
    await this.actor.unlinkPersonalSpace(space);
    return this.render();
  }
};
