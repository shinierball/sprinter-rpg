import { resolveActor } from './actor-constants.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { getSizeInfo } from '../../data/sizes.mjs';
import { syncActorOwnership } from './ownership-relay.mjs';
import { changeVehicleCrew, crewEntryOf, crewMembers, vehicleOf } from './vehicle-crew.mjs';

export const actorCompanionsMixin = {

  /* -------------------------------------------- */
  /*  Companions, Mounts & Vehicles Management    */
  /* -------------------------------------------- */

  /**
   * Bonds a companion actor (pet or vehicle) to this crawler.
   * Updates ownerId on companion and companion list on this crawler.
   * Also synchronizes player ownership from crawler to companion through the GM relay (players never write ownership).
   * @param {COGActor|string} companion
   * @returns {Promise<boolean>}
   */
  async bondCompanion(companion) {
    const compActor = typeof companion === 'string'
      ? resolveActor(companion)
      : companion;
    if (!compActor) return false;

    if (compActor.type === 'pet') {
      const existing = Array.isArray(this.system?.companions?.pets) ? [...this.system.companions.pets] : [];
      if (!existing.includes(compActor.id)) existing.push(compActor.id);
      await this.update({ 'system.companions.pets': existing });

      await compActor.update({ 'system.details.ownerId': this.id });
      await syncActorOwnership(compActor, this);
      return true;
    } else if (compActor.type === 'mercenary') {
      const existing = Array.isArray(this.system?.companions?.mercenaries) ? [...this.system.companions.mercenaries] : [];
      if (!existing.includes(compActor.id)) existing.push(compActor.id);
      await this.update({ 'system.companions.mercenaries': existing });

      const employers = Array.isArray(compActor.system?.details?.employerIds) ? [...compActor.system.details.employerIds] : [];
      if (!employers.includes(this.id)) employers.push(this.id);

      await compActor.update({
        'system.details.ownerId': compActor.system?.details?.ownerId || this.id,
        'system.details.employerIds': employers,
        'system.details.hired': true
      });
      await syncActorOwnership(compActor, this);
      return true;
    } else if (compActor.type === 'mount_vehicle') {
      const existing = Array.isArray(this.system?.companions?.vehicles) ? [...this.system.companions.vehicles] : [];
      if (!existing.includes(compActor.id)) existing.push(compActor.id);
      await this.update({ 'system.companions.vehicles': existing });

      await compActor.update({ 'system.ownerId': this.id });
      await syncActorOwnership(compActor, this);
      return true;
    }
    return false;
  },


  /**
   * Unbonds a companion actor from this crawler, then (through the GM relay) revokes this crawler's players'
   * ownership of it unless they still own another crawler linked to it.
   * @param {COGActor|string} companion
   * @returns {Promise<boolean>}
   */
  async unbondCompanion(companion) {
    const compId = typeof companion === 'string' ? companion : companion?.id;
    if (!compId) return false;

    const compActor = typeof companion === 'object' ? companion : resolveActor(compId);

    const pets = Array.isArray(this.system?.companions?.pets) ? this.system.companions.pets.filter(id => id !== compId) : [];
    const vehicles = Array.isArray(this.system?.companions?.vehicles) ? this.system.companions.vehicles.filter(id => id !== compId) : [];
    const mercenaries = Array.isArray(this.system?.companions?.mercenaries) ? this.system.companions.mercenaries.filter(id => id !== compId) : [];

    await this.update({
      'system.companions.pets': pets,
      'system.companions.vehicles': vehicles,
      'system.companions.mercenaries': mercenaries
    });

    if (compActor) {
      if (compActor.type === 'pet') {
        await compActor.update({ 'system.details.ownerId': '' });
      } else if (compActor.type === 'mount_vehicle') {
        await compActor.update({ 'system.ownerId': '' });
      } else if (compActor.type === 'mercenary') {
        const employers = Array.isArray(compActor.system?.details?.employerIds)
          ? compActor.system.details.employerIds.filter(id => id !== this.id)
          : [];
        await compActor.update({
          'system.details.employerIds': employers,
          'system.details.ownerId': employers[0] || '',
          'system.details.hired': employers.length > 0
        });
      }
      await syncActorOwnership(compActor, this, { revoke: true });
    }
    return true;
  },


  /**
   * Retrieves all resolved Pet Actor documents bonded to this crawler.
   * @returns {Array<COGActor>}
   */
  getBondedPets() {
    const petIds = Array.isArray(this.system?.companions?.pets) ? this.system.companions.pets : [];
    const actors = [];
    for (const id of petIds) {
      const act = resolveActor(id);
      if (act) actors.push(act);
    }
    return actors;
  },


  /**
   * Retrieves all resolved Mercenary Actor documents bonded to / employed by this crawler.
   * @returns {Array<COGActor>}
   */
  getBondedMercenaries() {
    const mercIds = Array.isArray(this.system?.companions?.mercenaries) ? this.system.companions.mercenaries : [];
    const actors = [];
    for (const id of mercIds) {
      const act = resolveActor(id);
      if (act && !actors.some(a => a.id === act.id)) actors.push(act);
    }
    if (globalThis.game?.actors) {
      for (const a of globalThis.game.actors.values()) {
        if (a.type === 'mercenary' && a.system?.isEmployedBy?.(this.id) && !actors.some(ex => ex.id === a.id)) {
          actors.push(a);
        }
      }
    }
    return actors;
  },


  /**
   * Retrieves all resolved Vehicle Actor documents bonded to this crawler.
   * @returns {Array<COGActor>}
   */
  getBondedVehicles() {
    const vehicleIds = Array.isArray(this.system?.companions?.vehicles) ? this.system.companions.vehicles : [];
    const actors = [];
    for (const id of vehicleIds) {
      const act = resolveActor(id);
      if (act) actors.push(act);
    }
    return actors;
  },


  /**
   * Retrieves the owner Crawler Actor of this companion (pet, mercenary, or vehicle).
   * @returns {COGActor|null}
   */
  getOwnerActor() {
    let ownerId = '';
    if (this.type === 'pet') {
      ownerId = this.system?.details?.ownerId || this.system?.ownerId || '';
    } else if (this.type === 'mount_vehicle') {
      ownerId = this.system?.ownerId || '';
    } else if (this.type === 'mercenary') {
      ownerId = this.system?.details?.ownerId || this.system?.details?.employerIds?.[0] || '';
    }
    if (!ownerId) return null;
    return resolveActor(ownerId);
  },

  /**
   * Retrieves all employer Crawler Actors of this mercenary.
   * @returns {Array<COGActor>}
   */
  getEmployerActors() {
    if (this.type !== 'mercenary') return [];
    const empIds = Array.isArray(this.system?.details?.employerIds) ? this.system.details.employerIds : [];
    const employers = [];
    for (const id of empIds) {
      const act = resolveActor(id);
      if (act) employers.push(act);
    }
    return employers;
  },


  /**
   * Checks whether this actor can be mounted or ridden by a crawler.
   * - Mount/vehicles can always be boarded/ridden.
   * - Pets can be ridden if explicitly marked as isMount, or if the pet's size
   *   is larger than the rider crawler's size (e.g. Size 4 Medium or Size 5 Large pet
   *   ridden by Size 3 Petite or Size 2 Small crawler).
   * @param {COGActor|object} crawlerActor
   * @returns {boolean}
   */
  canBeRiddenBy(crawlerActor) {
    if (!crawlerActor) return false;
    if (this.type === 'mount_vehicle') return true;
    if (this.type === 'pet') {
      if (typeof this.system?.canBeRiddenBy === 'function') {
        return this.system.canBeRiddenBy(crawlerActor);
      }
      if (this.system?.details?.isMount) return true;
      const petSize = this.system?.attributes?.sizeNumber ?? (getSizeInfo(this.system?.attributes?.size)?.size || 4);
      const crawlerSize = crawlerActor.system?.attributes?.sizeNumber ?? (getSizeInfo(crawlerActor.system?.attributes?.size)?.size || 4);
      return petSize > crawlerSize;
    }
    return false;
  },


  /**
   * Assigns a crawler as rider on this pet.
   * @param {COGActor|string} crawler
   * @returns {Promise<boolean>}
   */
  async assignRider(crawler) {
    if (this.type !== 'pet') return false;
    const crawlerId = typeof crawler === 'string' ? crawler : crawler?.id;
    if (!crawlerId) return false;
    await this.update({ 'system.details.riderId': crawlerId });
    return true;
  },


  /**
   * Dismounts the rider from this pet.
   * @returns {Promise<boolean>}
   */
  async dismountRider() {
    if (this.type !== 'pet') return false;
    await this.update({ 'system.details.riderId': '' });
    return true;
  },


  /**
   * Gets the active rider Actor on this pet.
   * @returns {COGActor|null}
   */
  getRiderActor() {
    const riderId = this.system?.details?.riderId;
    if (!riderId) return null;
    return resolveActor(riderId);
  },


  /**
   * Gets the active pilot Actor of this vehicle.
   * @returns {COGActor|null}
   */
  getPilotActor() {
    const pilotUuid = this.system?.pilotUuid;
    if (!pilotUuid) return null;
    return resolveActorByUuid(pilotUuid);
  },


  /**
   * The crew of this vehicle with documents resolved (see `crewMembers`).
   * @returns {{ pilot: COGActor|null, occupants: object[], missing: object[] }}
   */
  getCrew() {
    return crewMembers(this);
  },


  /** The vehicle this actor is aboard, or null. */
  getCurrentVehicle() {
    return vehicleOf(this);
  },


  /** This actor's stored role id in its current vehicle, or '' when not aboard. */
  getVehicleRole() {
    const vehicle = this.getCurrentVehicle();
    return vehicle ? (crewEntryOf(vehicle, this)?.role ?? '') : '';
  },


  /**
   * Board a vehicle (as a passenger unless `options.role` says otherwise), leaving any other vehicle.
   * @param {COGActor} vehicle
   * @param {{ role?: string }} [options]
   * @returns {Promise<boolean>}
   */
  embarkVehicle(vehicle, options = {}) {
    return changeVehicleCrew(vehicle, this, 'embark', options);
  },


  /** Leave a vehicle (the current one by default). */
  disembarkVehicle(vehicle = this.getCurrentVehicle()) {
    return vehicle ? changeVehicleCrew(vehicle, this, 'disembark') : Promise.resolve(false);
  },


  /** Take the wheel of a vehicle, boarding it first when needed; any other driver stays aboard. */
  takeVehicleWheel(vehicle, options = {}) {
    return changeVehicleCrew(vehicle, this, 'takeWheel', options);
  },


  /** Stop driving and stay aboard (the current vehicle by default). */
  stepDownFromWheel(vehicle = this.getCurrentVehicle()) {
    return vehicle ? changeVehicleCrew(vehicle, this, 'stepDown') : Promise.resolve(false);
  },


  /** Change this actor's role in a vehicle it is aboard (the current one by default). */
  setVehicleRole(role, vehicle = this.getCurrentVehicle()) {
    return vehicle ? changeVehicleCrew(vehicle, this, 'setRole', { role }) : Promise.resolve(false);
  }
};
