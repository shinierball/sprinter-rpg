/**
 * The debuff `paused` switch (7.1b): a paused debuff does nothing until it is switched back on. The conditions row and
 * the crawler HUD both call this. The owner or a GM may flip it; nothing else about the debuff changes.
 */

/** Whether `user` (default: the current user) may flip the switch on this debuff. */
export function canSwitchDebuff(item, user = globalThis.game?.user) {
  if (!item || item.type !== 'debuff') return false;
  return Boolean(user?.isGM || item.isOwner || item.testUserPermission?.(user, 'OWNER'));
}

/**
 * Flip (or set) `system.paused` on a debuff.
 * @param {object} item an embedded debuff
 * @param {{ paused?: boolean, user?: object }} [options] omit `paused` to toggle
 * @returns {Promise<boolean|null>} the new value, or null when nothing was done
 */
export async function setDebuffPaused(item, { paused, user } = {}) {
  if (!canSwitchDebuff(item, user ?? globalThis.game?.user)) return null;
  const next = typeof paused === 'boolean' ? paused : item.system?.paused !== true;
  await item.update({ 'system.paused': next });
  return next;
}
