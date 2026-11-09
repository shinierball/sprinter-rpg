import { COGActorSheetV2 } from './base/actor-sheet-v2.mjs';
import { completeItemTransfer, refuseGmOnlyDrop } from './base/item-transfer.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { vehicleKindOptions, upgradeKindsOf, VEHICLE_UPGRADE_KINDS } from '../data/rules/vehicle-rules.mjs';
import { sizeOptions } from '../data/sizes.mjs';
import { readCrew, crewCapacity, vehicleRoleSelectOptions } from '../data/rules/vehicle-crew-rules.mjs';
import { changeVehicleCrew, crewMembers } from '../documents/actor/vehicle-crew.mjs';
import { explodeVehicleNow } from '../documents/actor/vehicle-ram.mjs';
import { clearVehicleResult, overrideVehicleResult } from '../documents/actor/vehicle-drive-common.mjs';
import { getItemAllTags } from '../documents/active-tags.mjs';
import { cooldownBadge } from '../utils/time/cooldown-badge.mjs';
import { brokenStateOf } from '../documents/item/enchantments.mjs';
import { currentTimeContext } from '../documents/actor/dungeon-time.mjs';
import { COGItemManager } from '../apps/item-manager.mjs';
import { COGBuffDebuffManager } from '../apps/buff-manager.mjs';
import { prepareItemLists, prepareItemSummaries, sortItems } from './crawler/context-items.mjs';
import { healthSegments } from './crawler/context-core.mjs';
import { itemActions } from './crawler/actions-items.mjs';
import { dropCreateData, isOwnedBy } from './crawler/drop.mjs';
import { driveContext } from './vehicle/drive-context.mjs';
import { isMountedWeapon } from '../documents/actor/vehicle-weapons.mjs';
import { driveActions } from './vehicle/drive-actions.mjs';

const DIR = `${SYSTEM_PATH}/templates/actors/vehicle`;
const PARTS_PATH = `${SYSTEM_PATH}/templates/actors/parts`;

/** The item types a vehicle takes: upgrades are gear, and Buffs and Debuffs ride on it like on any actor. */
const DROPPABLE_TYPES = Object.freeze(['gear', 'buff', 'debuff']);

/** A registry label: a lang key localized when the i18n service is up, else the text itself. */
function localizeLabel(label) {
  return globalThis.game?.i18n?.localize?.(label) ?? label;
}

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

/** GM: set this round's driving result from the select beside the button ('' = none). */
async function vehicleOverride(event, target) {
  if (!globalThis.game?.user?.isGM) return;
  const select = target?.closest?.('.cog-vehicle-override')?.querySelector?.('select');
  if (!select) return;
  await overrideVehicleResult(this.actor, select.value);
}

/** Forget this round's driving result (the driver, an owner or the GM). */
async function vehicleClearResult() {
  if (!this.isEditable) return;
  await clearVehicleResult(this.actor);
}

/** GM: the vehicle explodes now (a vehicle edited to 0 by hand has no prompt card). */
async function vehicleExplode() {
  if (!globalThis.game?.user?.isGM) return;
  await explodeVehicleNow(this.actor);
}

/** The item actions a vehicle's upgrade and Buff lists use; the rest of the crawler's item actions have no control here. */
const ITEM_ACTION_NAMES = ['createItem', 'editItem', 'deleteItem', 'useItem', 'toggleGearEquipped', 'openGearPicker', 'openBuffPicker', 'openDebuffPicker'];
const vehicleItemActions = Object.fromEntries(ITEM_ACTION_NAMES.map((name) => [name, itemActions[name]]));

/**
 * Dedicated sheet for Mounts and Vehicles (3.44g). Not a crawler sheet: a vehicle has no stats, mana, Evade, limbs or
 * hotlist. Parts: identity (header), health (10 slots of `size` HP), then tabs for the drive panel, the crew roster, the
 * upgrades (installed gear) and the Buffs and Debuffs on the vehicle.
 */
export class COGVehicleSheet extends COGActorSheetV2 {
  static DEFAULT_OPTIONS = {
    classes: ['actor', 'vehicle', 'mount-vehicle'],
    position: { width: 820, height: 760 },
    window: { title: 'COG.VehicleSheet' },
    actions: {
      ...vehicleItemActions,
      ...driveActions((sheet) => sheet.actor),
      vehicleOpenOwner,
      vehicleUnlinkOwner,
      vehicleCrew,
      vehicleCrewRole,
      vehicleOverride,
      vehicleClearResult,
      vehicleExplode
    }
  };

  static TABS = {
    primary: {
      initial: 'drive',
      tabs: [
        { id: 'drive', label: 'Drive', icon: 'fa-solid fa-gauge-high', cssClass: 'drive' },
        { id: 'crew', label: 'Crew', icon: 'fa-solid fa-users', cssClass: 'crew' },
        { id: 'upgrades', label: 'Upgrades', icon: 'fa-solid fa-screwdriver-wrench', cssClass: 'upgrades' },
        { id: 'conditions', label: 'Effects', icon: 'fa-solid fa-shield-virus', cssClass: 'conditions' }
      ]
    }
  };

  static PARTS = {
    identity: { template: `${DIR}/identity.hbs` },
    health: { template: `${DIR}/health.hbs` },
    tabs: { template: `${SYSTEM_PATH}/templates/shared/tab-nav.hbs` },
    drive: { template: `${DIR}/drive.hbs`, templates: [`${DIR}/drive-controls.hbs`], scrollable: [''] },
    crew: { template: `${DIR}/crew.hbs`, templates: [`${PARTS_PATH}/vehicle-role-select.hbs`], scrollable: [''] },
    upgrades: { template: `${DIR}/upgrades.hbs`, templates: [`${SYSTEM_PATH}/templates/apps/partials/cooldown-badge.hbs`], scrollable: [''] },
    // The crawler's Buffs and Debuffs tab, minus the hotbar slot buttons (`hideBuffSlots`).
    conditions: { template: `${PARTS_PATH}/conditions.hbs`, scrollable: [''] }
  };

  /** Browse the gear compendium for this vehicle. */
  _openItemPicker(activeCategory = 'all', activeSlot = 'all') {
    new COGItemManager({ actor: this.actor, activeCategory, activeSlot }).render({ force: true });
  }

  /** Browse the Buffs or Debuffs compendium for this vehicle. */
  _openBuffPicker(targetSlot = null, initialTab = 'all') {
    new COGBuffDebuffManager({ actor: this.actor, targetSlot, activeTab: initialTab }).render({ force: true });
  }

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
   * A dropped gear item is installed on the vehicle; Buffs and Debuffs are added as they are. Anything else is refused.
   * An item the vehicle already owns is re-sorted.
   * @override
   */
  async _onDropItem(event, item) {
    if (!this.actor.isOwner) return null;
    if (isOwnedBy(item, this.actor)) return this._onSortItem(event, item);
    if (!DROPPABLE_TYPES.includes(item.type)) {
      globalThis.ui?.notifications?.warn?.(globalThis.game?.i18n?.localize?.('COG.VehicleUI.DropRefused') ?? 'A vehicle takes gear (upgrades), Buffs and Debuffs.');
      return null;
    }
    if (refuseGmOnlyDrop(item, this.actor)) return null;
    const created = await this._onDropItemCreate(dropCreateData(item), event);
    if (created && (!Array.isArray(created) || created.length)) await completeItemTransfer(item, this.actor);
    return created;
  }

  /**
   * Gear created on a vehicle is installed (`equipped`): a vehicle has no limbs or hands to run out of.
   * @override
   */
  async _onDropItemCreate(itemData, event) {
    const list = [itemData].flat().filter(Boolean);
    for (const data of list) {
      if (data.type === 'gear') data.system = { ...(data.system ?? {}), equipped: true };
    }
    return super._onDropItemCreate(list, event);
  }

  /**
   * Gear is sorted among gear, Buffs among Buffs.
   * @override
   */
  _isSortSibling(source, other) {
    return other.id !== source.id && other.type === source.type;
  }

  /**
   * Prepares the vehicle sheet's context: identity options, the drive panel, Health slots, the crew roster, the upgrade
   * groups and the Buff and Debuff lists.
   * @override
   */
  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    context.isVehicle = true;
    context.hideBuffSlots = true;

    // Owner crawler (bonded) and driver
    const bonded = actor.getOwnerActor();
    context.bondedOwner = bonded ? {
      id: bonded.id,
      name: bonded.name,
      img: bonded.img || bonded.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg'
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

    // Identity options: the size registry and the kind registry (labels localized)
    context.sizeOptions = sizeOptions(actor.system?.attributes?.size || 'large');
    context.vehicleKindOptions = vehicleKindOptions(actor.system?.kind).map((o) => ({ ...o, label: localizeLabel(o.label) }));

    // Health: 10 slots of `size` HP
    const hp = actor.system?.attributes?.hp ?? {};
    context.hpPerBar = Number(hp.hpPerBar) || 0;
    context.healthSegments = healthSegments(Number(hp.bars) || 10, context.hpPerBar);

    // Drive panel
    context.drive = driveContext(actor);

    // Upgrades and Effects
    prepareItemLists(context, actor);
    await prepareItemSummaries(context, actor);
    const now = currentTimeContext(actor);
    for (const item of context.gear) {
      item.cooldownBadge = cooldownBadge(actor, item, now);
      const state = brokenStateOf(item);
      item.brokenState = state.brokenState;
      item.brokenLabel = state.brokenLabel;
      item.isMountedWeapon = isMountedWeapon(item);
      item.vehicleUuid = actor.uuid;
    }
    context.upgradeGroups = upgradeGroupsOf(context.gear);
    context.upgradeCount = context.gear.length;
    return context;
  }
}

/**
 * Gear grouped by upgrade kind (registry order), then the gear with no upgrade kind. A piece that names two kinds sits in the first.
 * @param {object[]} gear embedded gear items
 * @returns {Array<{ id: string, label: string, items: object[] }>} empty groups are left out
 */
function upgradeGroupsOf(gear) {
  const groups = new Map(Object.keys(VEHICLE_UPGRADE_KINDS).map((id) => [id, { id, label: localizeLabel(VEHICLE_UPGRADE_KINDS[id].label), items: [] }]));
  const other = { id: 'other', label: localizeLabel('COG.VehicleUI.OtherGear') === 'COG.VehicleUI.OtherGear' ? 'Other gear' : localizeLabel('COG.VehicleUI.OtherGear'), items: [] };
  for (const item of [...gear].sort(sortItems)) {
    const kind = upgradeKindsOf(getItemAllTags(item))[0];
    (kind ? groups.get(kind.id) : other).items.push(item);
  }
  return [...groups.values(), other].filter((g) => g.items.length);
}
