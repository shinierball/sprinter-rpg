/**
 * Vehicle check card buttons (3.44d). Each handler re-reads the card (nothing is trusted from the DOM) and calls the
 * vehicle-drive functions, which gate cooldowns, ask for Rule Breaks and go through the GM relay where the user cannot write.
 */
import { vehicleCardInfo, useAfterRollOffer } from '../../documents/actor/vehicle-after-roll.mjs';
import { chooseVehicleResult, requestVehicleDrive } from '../../documents/actor/vehicle-drive-common.mjs';
import { rollRamDamageFromCard } from '../../documents/actor/vehicle-ram.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { changeVehicleCrew } from '../../documents/actor/vehicle-crew.mjs';

/** The driver's or GM's "take the other Critical reward" button. */
export async function handleVehicleChoose(event, button, message) {
  const info = vehicleCardInfo(message);
  if (!info) return;
  await chooseVehicleResult(info.vehicle, message.id, button.dataset?.choice ?? '');
}

/** A reroll or degree-shift offer. */
export async function handleVehicleOffer(event, button, message) {
  await useAfterRollOffer(message, button.dataset?.rowKey ?? '');
}

/** The GM waves a failed boarder aboard: a Rule Break on the boarding line. */
export async function handleVehicleBoardAnyway(event, button, message) {
  if (!globalThis.game?.user?.isGM) return;
  const info = vehicleCardInfo(message);
  if (!info) return;
  await changeVehicleCrew(info.vehicle, info.roller, 'embark', { boardCheck: 'skip', boardRuleBreak: true });
}

/** "Roll ram damage" on a successful ram check or a mob's ram card (3.44f). */
export async function handleVehicleRamDamage(event, button, message) {
  await rollRamDamageFromCard(message);
}

/** "Apply collision" on a ram damage card: the driver or the GM, through the relay (3.44f). */
export async function handleVehicleCollision(event, button, message) {
  const vehicle = resolveActorByUuid(button.dataset?.vehicleUuid);
  if (vehicle?.type !== 'mount_vehicle') return;
  await requestVehicleDrive(vehicle, 'collision', { messageId: message.id });
}

/** The GM's "Explode" on the 0% prompt (3.44f). */
export async function handleVehicleExplode(event, button, message) {
  if (!globalThis.game?.user?.isGM) return;
  const vehicle = resolveActorByUuid(button.dataset?.vehicleUuid);
  if (vehicle?.type !== 'mount_vehicle') return;
  await requestVehicleDrive(vehicle, 'explode', { messageId: message.id });
}

/** The GM's "Not this time": the prompt goes away and nothing explodes. */
export async function handleVehicleExplodeDismiss(event, button, message) {
  if (!globalThis.game?.user?.isGM) return;
  await message?.delete?.();
}
