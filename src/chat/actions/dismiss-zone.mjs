/**
 * "Dismiss Zone" chat button on an "Area placed" card. Ends the placed group (core and splash regions):
 * directly for the GM or an owner of the regions, through the `areaDeleteRegions` relay for anyone else. The GM
 * refuses a requester who does not own the actor holding the source item.
 */
import { findAreaRegions } from '../../utils/region-shapes.mjs';
import { deleteAreaGroup } from '../../documents/actor/area-relay.mjs';

/**
 * @param {Event} event
 * @param {HTMLElement} button carries `data-group-id` and `data-scene-uuid`
 */
export async function handleDismissZone(event, button) {
  const groupId = button.dataset?.groupId;
  const sceneUuid = button.dataset?.sceneUuid;
  const scene = (sceneUuid ? globalThis.fromUuidSync?.(sceneUuid) : null) ?? globalThis.canvas?.scene;
  if (!groupId || !scene) return;
  const regions = findAreaRegions(scene, { groupId });
  if (!regions.length) {
    globalThis.ui?.notifications?.info('Sprinter RPG | That area is already gone.');
    return;
  }
  const name = regions[0].name;
  if (await deleteAreaGroup(scene, groupId)) globalThis.ui?.notifications?.info(`Sprinter RPG | Dismissed ${name}.`);
}
