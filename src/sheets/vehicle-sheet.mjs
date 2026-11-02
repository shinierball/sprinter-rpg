import { COGCrawlerSheet } from './crawler-sheet.mjs';
import { sizeOptions } from '../data/sizes.mjs';
import { readCrew, crewCapacity, vehicleRoleSelectOptions } from '../data/rules/vehicle-crew-rules.mjs';
import { changeVehicleCrew, crewMembers } from '../documents/actor/vehicle-crew.mjs';

/** Open the bonded owner's sheet. */
function vehicleOpenOwner() {
  this.actor.getOwnerActor()?.sheet?.render({ force: true });
}

/** Break the owner bond (through the owner so both sides stay in sync). */
async function vehicleUnlinkOwner() {
  if (!this.isEditable) return;
  const owner = this.actor.getOwnerActor();
  if (owner) await owner.unbondCompanion(this.actor.id);
  else await this.actor.update({ 'system.ownerId': '' });
  return this.render();
}

/**
 * One crew action (`data-op`: takeWheel, stepDown, disembark; embark never comes from a row) on the occupant named
 * by `data-uuid`. The roster's rows and the Missing actor rows share it; the relay decides who may.
 */
async function vehicleCrew(event, target) {
  if (!this.isEditable) return;
  const { op, uuid } = target?.dataset ?? {};
  if (!op || !uuid) return;
  await changeVehicleCrew(this.actor, uuid, op);
  return this.render();
}

/** A role select changed (`data-uuid`): set that occupant's role through the relay. */
async function vehicleCrewRole(event, target) {
  if (!this.isEditable) return;
  const uuid = target?.dataset?.uuid;
  if (!uuid) return;
  await changeVehicleCrew(this.actor, uuid, 'setRole', { role: target.value });
  return this.render();
}

/**
 * Dedicated Sheet Controller for Mounts and Vehicles in Sprinter RPG.
 * Extends COGCrawlerSheet for full capability parity (attacks, spells,
 * skills, hotbar, health bars, inventory, conditions) while omitting
 * story and achievement tabs.
 */
export class COGVehicleSheet extends COGCrawlerSheet {
  /**
   * Application V2 Default Options
   */
  /** Companions have no story or achievements tab (2.6 §5.4). */
  static OMIT_TABS = { primary: ['story', 'achievements'] };

  static DEFAULT_OPTIONS = {
    classes: ['vehicle', 'mount-vehicle'],
    window: { title: 'COG.VehicleSheet' },
    actions: {
      vehicleOpenOwner,
      vehicleUnlinkOwner,
      vehicleCrew,
      vehicleCrewRole
    }
  };

  /**
   * A dropped actor boards this vehicle as a passenger; it never bonds (3.21 defect 4). The relay and the
   * Rule Break confirm live in `changeVehicleCrew`.
   * @override
   */
  async _onDropActor(event, dropped) {
    if (!this.isEditable) return null;
    await changeVehicleCrew(this.actor, dropped, 'embark');
    await this.render();
    return dropped;
  }

  /**
   * Prepares context data for rendering the Vehicle Sheet template.
   * Inherits full crawler context (attacks, spells, skills, hotbar, gear, conditions)
   * and supplements with vehicle-specific pilot/passenger relationships.
   * @override
   */
  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);

    const actor = this.actor;
    context.isVehicle = true;

    // Resolve Owner Crawler
    const owner = actor.getOwnerActor();
    context.owner = owner ? {
      id: owner.id,
      name: owner.name,
      img: owner.img || owner.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg'
    } : null;

    // Crew: roster rows, Missing actor rows, seat readout (3.21 section 6.1)
    const crew = crewMembers(actor);
    const pilot = crew.pilot;
    context.pilot = pilot ? {
      id: pilot.id,
      uuid: pilot.uuid,
      name: pilot.name,
      img: pilot.img || pilot.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg'
    } : null;
    const capacity = crewCapacity(actor.system);
    const aboard = readCrew(actor.system).occupants.length;
    const seats = capacity.limited
      ? `${aboard} / ${capacity.total} seats${capacity.cargo ? `, +${capacity.cargo} cargo` : ''}`
      : `${aboard}, no seat limit`;
    context.crew = {
      aboard,
      seatsLabel: `Aboard (${seats})`,
      over: capacity.limited && aboard > capacity.total,
      rows: crew.occupants.map((o) => ({
        uuid: o.uuid,
        name: o.actor.name,
        img: o.actor.img || o.actor.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg',
        isPilot: o.isPilot,
        ruleBreak: o.ruleBreak,
        roleOptions: vehicleRoleSelectOptions(o.role)
      })),
      missing: crew.missing.map((m) => ({ uuid: m.uuid }))
    };

    // Size options
    context.sizeOptions = sizeOptions(actor?.system?.attributes?.size || 'large');

    // Vehicle Type options
    const vehicleTypes = ['Ground', 'Flying', 'Aquatic', 'Mech', 'Chariot', 'Submersible', 'Hovercraft'];
    context.vehicleTypeOptions = vehicleTypes.map(t => ({
      value: t,
      label: t,
      selected: (actor?.system?.vehicleType || 'Ground').toLowerCase() === t.toLowerCase()
    }));

    // Backwards compatibility bindings for test suites and specialized item lists
    context.weapons = context.attacks || [];
    context.cargo = context.gear || [];

    return context;
  }
}
