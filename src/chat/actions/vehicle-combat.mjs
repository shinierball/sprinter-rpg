/**
 * Chat buttons for attacks on vehicles (3.44e).
 *
 * - `crawlerHitVehicle`: a Near Miss on someone aboard "hits the vehicle" (548 a). The button targets the vehicle's token
 *   so the card's normal damage application lands on it (its own DR, Health Bars and Rule Breaks).
 * - `crawlerVehicleEvade`: a mob's attack on a vehicle hits unless the driver chooses to evade (545, the human's ruling).
 *   The driver rolls the vehicle's operate skill (`rollVehicleCheck`: found by tag query, else untrained, else Dex) against the attack's Difficulty as a
 *   vehicle check of kind `evade`; success avoids the hit. Declining is simply not clicking: the attack stays an auto-hit.
 */
import { resolveActorByUuid, findTokenByActorUuid } from '../../utils/actor-uuid.mjs';
import { rollVehicleCheck } from '../../documents/actor/vehicle-checks.mjs';

const say = (level, text) => globalThis.ui?.notifications?.[level]?.(`Sprinter RPG | ${text}`);

/**
 * Target the vehicle's token (releasing other targets) so the damage card applies to it.
 * @returns {Promise<boolean>} true when a token was targeted
 */
export async function handleHitVehicle(event, button) {
  const uuid = button?.dataset?.vehicleUuid;
  const vehicle = resolveActorByUuid(uuid);
  const token = vehicle && canvas?.tokens?.placeables ? findTokenByActorUuid(canvas.tokens.placeables, uuid) : null;
  if (!token) {
    say('warn', `${vehicle?.name ?? 'The vehicle'} has no token on this scene to target. Target it by hand, then apply the damage.`);
    return false;
  }
  token.setTarget?.(true, { releaseOthers: true });
  say('info', `${vehicle.name} is targeted. Roll or apply the damage and it lands on the vehicle.`);
  return true;
}

/**
 * The driver's Evade for a vehicle (545): a Driving check against the attack's Difficulty.
 * @returns {Promise<ChatMessage|null>}
 */
export async function handleVehicleEvade(event, button) {
  const vehicle = resolveActorByUuid(button?.dataset?.vehicleUuid);
  const driver = resolveActorByUuid(button?.dataset?.driverUuid);
  if (!vehicle || !driver) return null;
  if (!(globalThis.game?.user?.isGM || driver.isOwner)) {
    say('warn', 'Only the driver or the GM can evade for the vehicle.');
    return null;
  }
  const dc = Number(button.dataset.targetDc);
  // The same roll as every vehicle check: the operate skill, else the untrained stand-in, else a Dex check (never a refusal).
  // A mob's ram marks the button, so the check also carries `vehicle.check.ram`.
  return rollVehicleCheck(vehicle, driver, {
    kind: 'evade',
    dc: Number.isFinite(dc) ? dc : undefined,
    ram: button.dataset.ram === 'true'
  });
}
