/**
 * Single rule for which side of a fight an actor/token is on.
 * Shared by the combat tracker (turn order) and interrupt offers (who is an ally).
 */

/**
 * True when the actor/token pair belongs to the Mob side.
 * @param {{ actor?: object|null, token?: object|null }} p  token is a TokenDocument-like object with `disposition`
 * @returns {boolean}
 */
export function isMobSide({ actor = null, token = null } = {}) {
  const disp = token?.disposition;
  const hasDisp = disp !== undefined && disp !== null;
  if (actor) {
    if (actor.type === 'crawler' || actor.type === 'pet') return false;
    if (actor.type === 'mount_vehicle' || actor.type === 'mercenary') return hasDisp ? disp < 0 : false;
    if (actor.type === 'npc') return true;
  }
  if (hasDisp) return disp <= 0;
  return true;
}
