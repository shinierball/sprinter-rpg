/**
 * Story tab context: bonded pets and vehicles, the personal space this crawler owns, and the spaces they
 * only occupy.
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { crawlerRef } from '../../documents/actor/personal-space-links.mjs';
import { crewEntryOf, vehicleOf, vehicleUuidOf } from '../../documents/actor/vehicle-crew.mjs';
import { crewCapacity, readCrew, vehicleRoleSelectOptions } from '../../data/rules/vehicle-crew-rules.mjs';
import { STORY_TRAITS, storyTableView } from '../../data/rules/background-table-rules.mjs';
import { DEFAULT_SIZE, sizeName } from '../../data/sizes.mjs';

/** Story box look per trait; the table's name and die come from the registry. */
const STORY_BOXES = Object.freeze({
  pastTrauma: { label: 'Past Traumas', icon: 'fa-heart-crack', color: 'cog-text-accent', noun: 'trauma' },
  looseEnds: { label: 'Loose Ends', icon: 'fa-link-slash', color: 'cog-text-warning', noun: 'loose ends' },
  regrets: { label: 'Regrets', icon: 'fa-clock-rotate-left', color: 'cog-text-info', noun: 'regrets' }
});

/** The user can open the space sheet (a space that has not been shared yet is listed but not openable). */
const canView = (space) => Boolean(globalThis.game?.user?.isGM || space.testUserPermission?.(globalThis.game?.user, 'LIMITED') !== false);

/** Seats readout for a vehicle: "3/4 seats", "3 aboard" when it has no limit. */
function seatsLabel(vehicle) {
  const aboard = readCrew(vehicle.system).occupants.length;
  const cap = crewCapacity(vehicle.system);
  return cap.limited ? `${aboard}/${cap.total} seats` : `${aboard} aboard`;
}

/**
 * @param {object} context
 * @param {Actor} actor
 */
export function prepareStory(context, actor) {
  // Past Trauma / Loose Ends / Regrets boxes: the roll button names the registered table and its die. No table, no button.
  context.storyTables = STORY_TRAITS.map(key => {
    const box = STORY_BOXES[key];
    const view = storyTableView(key);
    const die = view.formula || '';
    return {
      key,
      ...box,
      hasTable: view.hasTable,
      tableName: view.tableName,
      formula: die,
      heading: view.hasTable && view.tableName ? `${box.label.toUpperCase()} (${view.tableName})` : box.label.toUpperCase(),
      rollLabel: die ? `Roll ${die}` : 'Roll',
      rollTitle: `Roll ${die || 'the die'} on ${view.tableName || box.label}`,
      placeholder: view.hasTable ? `Type custom ${box.noun} or click ${die ? `Roll ${die}` : 'Roll'}...` : `Type custom ${box.noun}...`,
      value: actor.system?.details?.[key] ?? ''
    };
  });
  context.hasStoryTables = context.storyTables.some(t => t.hasTable);

  context.bondedPets = actor.getBondedPets().map(p => ({
    id: p.id,
    name: p.name,
    img: p.img || p.prototypeToken?.texture?.src || 'icons/svg/pawprint.svg',
    level: p.system?.details?.level || 1,
    creatureType: p.system?.details?.creatureType || 'Beast',
    size: sizeName(p.system?.attributes?.size || DEFAULT_SIZE),
    hp: p.system?.attributes?.hp || { value: 0, max: 0, pct: 100 },
    isRideable: typeof p.canBeRiddenBy === 'function' ? p.canBeRiddenBy(actor) : false,
    isRidden: p.system?.details?.riderId === actor.id,
    riderName: p.getRiderActor?.()?.name || '',
    actor: p
  }));

  // The vehicle this actor is aboard (bonded or not) and the state of each bonded vehicle's row.
  const current = vehicleOf(actor);
  const entry = current ? crewEntryOf(current, actor) : null;
  context.aboard = entry ? {
    vehicleUuid: vehicleUuidOf(current),
    vehicleId: current.id,
    name: current.name,
    img: current.img || current.prototypeToken?.texture?.src || 'icons/svg/shield.svg',
    isPilot: entry.isPilot,
    role: entry.role,
    roleOptions: vehicleRoleSelectOptions(entry.role),
    seatsLabel: seatsLabel(current),
    hullLabel: `Hull ${current.system?.attributes?.hp?.value ?? 0}/${current.system?.attributes?.hp?.max ?? 0}`,
    canOpen: Boolean(globalThis.game?.user?.isGM || current.testUserPermission?.(globalThis.game?.user, 'OBSERVER') !== false)
  } : null;

  context.bondedVehicles = actor.getBondedVehicles().map(v => ({
    id: v.id,
    name: v.name,
    img: v.img || v.prototypeToken?.texture?.src || 'icons/svg/shield.svg',
    vehicleType: v.system?.vehicleType || 'Ground',
    size: sizeName(v.system?.attributes?.size || 'large'),
    hp: v.system?.attributes?.hp || { value: 0, max: 0, pct: 100 },
    dr: v.system?.attributes?.dr?.total ?? 2,
    move: v.system?.attributes?.move || 40,
    isPiloted: Boolean(actor.uuid) && v.system?.pilotUuid === actor.uuid,
    isAboard: Boolean(crewEntryOf(v, actor)),
    pilotName: v.getPilotActor?.()?.name || '',
    actor: v
  }));

  const ref = crawlerRef(actor);
  const owned = actor.getOwnedPersonalSpace();
  context.linkedSpaces = actor.getLinkedPersonalSpaces()
    .filter(s => s !== owned)
    .map(s => ({
      uuid: s.uuid,
      name: s.name,
      img: s.img || 'icons/svg/door-closed.svg',
      ownerName: resolveActorByUuid(s.system?.ownerUuid)?.name || '',
      extraOwned: s.system?.ownerUuid === ref,
      canView: canView(s)
    }));
  // Only the GM can take a space away from its owner; occupants Leave instead.
  context.canUnlinkOwnedSpace = Boolean(globalThis.game?.user?.isGM);

  const space = owned;
  if (!space) {
    context.personalSpace = null;
    return;
  }
  const sys = space.system || {};
  // Installed space upgrades are not stash items (the model's count excludes them)
  const stashCount = Number(sys.stashCount) || 0;
  const stashMax = Number(sys.effectiveStashCapacity ?? sys.stashCapacity) || 100;
  context.personalSpace = {
    id: space.id,
    uuid: space.uuid,
    name: space.name,
    img: space.img || 'icons/svg/door-closed.svg',
    tier: sys.tier || 1,
    size: sys.size || 'Single Room',
    defense: sys.effectiveDefenseRating || 10,
    stashCount,
    stashMax,
    stashPct: Math.min(100, Math.round((stashCount / stashMax) * 100)),
    restHours: Math.max(1, 8 - (Number(sys.effectiveRestHoursReduction) || 0)),
    restHoursReduction: Number(sys.effectiveRestHoursReduction) || 0,
    wellRestedBonus: Number(sys.effectiveWellRestedBonus) || 1,
    trainingBonusHours: Number(sys.effectiveTrainingBonusHours) || 1,
    amenities: sys.details?.amenities || '',
    actor: space
  };
}
