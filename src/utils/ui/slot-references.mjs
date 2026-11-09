/**
 * Slot references (hotlist, external buffs) that point at an item by id. Shared by the sheet's delete action and the theme
 * cleanup, which both clear a slot before the item it pointed at goes away.
 */

/**
 * The actor update that clears every slot pointing at `item`.
 * @param {object} actor
 * @param {{ id?: string }} item
 * @returns {Record<string, string>} an update object (empty when nothing points at the item)
 */
export function slotReferencesTo(actor, item) {
  const matches = (val) => Boolean(val) && val === item.id;
  const updates = {};
  for (const [slot, val] of Object.entries(actor.system?.hotlist || {})) {
    if (matches(val)) updates[`system.hotlist.${slot}`] = '';
  }
  for (const [slot, val] of Object.entries(actor.system?.attributes?.externalBuffs || {})) {
    if (matches(val)) updates[`system.attributes.externalBuffs.${slot}`] = '';
  }
  return updates;
}
