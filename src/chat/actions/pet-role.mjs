/**
 * The first-Bonded card's button (core book p. 231): [Choose role] (`crawlerChoosePetRole`, the pet's owner or the GM) opens the
 * pet's sheet at its role picker.
 */
const actorOf = (button) => globalThis.fromUuid?.(String(button.dataset?.actorUuid ?? ''));

/** @param {HTMLElement} button `data-actor-uuid` of the pet */
export async function handleChoosePetRole(event, button, message) {
  const user = globalThis.game?.user;
  const pet = await actorOf(button);
  if (pet?.type !== 'pet' || !(user?.isGM || pet.testUserPermission?.(user, 'OWNER'))) return null;
  const sheet = pet.sheet;
  await sheet?.render?.({ force: true });
  return sheet?.openRolePicker?.('role') ?? null;
}
