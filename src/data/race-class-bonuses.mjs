/**
 * Race and class stat, damage-reduction and movement deltas: the pure writes the applier makes into an update payload
 * when it applies a race or class and when it reverts one.
 */

/**
 * Adds (sign = 1) or removes (sign = -1) per-stat deltas on an actor's abilities,
 * writing `value` and `unenhanced` into `updates`. `unenhanced` falls back to the
 * current value when the actor has none recorded.
 * @param {object} actor
 * @param {object} updates Update payload being built (mutated).
 * @param {Record<string, number>} stats Stat key to delta.
 * @param {1|-1} sign
 */
export function addAbilityDeltas(actor, updates, stats, sign) {
  for (const [stat, delta] of Object.entries(stats)) {
    if (delta !== 0 && actor.system?.abilities?.[stat]) {
      const curVal = Number(actor.system.abilities[stat].value ?? 10);
      const curUnenh = Number(actor.system.abilities[stat].unenhanced ?? curVal);
      updates[`system.abilities.${stat}.value`] = curVal + sign * delta;
      updates[`system.abilities.${stat}.unenhanced`] = curUnenh + sign * delta;
    }
  }
}

/**
 * Writes the DR and movement changes granted by a race/class bonus bundle into `updates`.
 * @param {object} actor
 * @param {object} updates Update payload being built (mutated).
 * @param {{drBonus?: number, movement?: object}} bonuses
 */
export function addDrAndMovementBonuses(actor, updates, bonuses) {
  if (bonuses.drBonus) {
    const curDR = Number(actor.system?.attributes?.dr?.buffs) || 0;
    updates['system.attributes.dr.buffs'] = curDR + bonuses.drBonus;
  }
  if (bonuses.movement) {
    if (bonuses.movement.walkDelta) {
      const curMove = Number(actor.system?.attributes?.speed?.move) || 20;
      updates['system.attributes.speed.move'] = curMove + bonuses.movement.walkDelta;
    }
    if (bonuses.movement.climb) updates['system.attributes.speed.climb'] = bonuses.movement.climb;
    if (bonuses.movement.swim) updates['system.attributes.speed.swim'] = bonuses.movement.swim;
    if (bonuses.movement.fly) updates['system.attributes.speed.fly'] = bonuses.movement.fly;
    if (bonuses.movement.burrow) updates['system.attributes.speed.burrow'] = bonuses.movement.burrow;
  }
}

/**
 * Writes the reversal of previously applied DR and movement bonuses into `updates`.
 * DR never drops below 0; granted special speeds reset to 0.
 * @param {object} actor
 * @param {object} updates Update payload being built (mutated).
 * @param {{drBonus?: number, movement?: object}} [applied] The stored applied record.
 */
export function revertDrAndMovementBonuses(actor, updates, applied) {
  if (applied?.drBonus) {
    const curDR = Number(actor.system?.attributes?.dr?.buffs) || 0;
    updates['system.attributes.dr.buffs'] = Math.max(0, curDR - applied.drBonus);
  }
  if (applied?.movement) {
    if (applied.movement.walkDelta) {
      const curMove = Number(actor.system?.attributes?.speed?.move) || 20;
      updates['system.attributes.speed.move'] = curMove - applied.movement.walkDelta;
    }
    if (applied.movement.climb) updates['system.attributes.speed.climb'] = 0;
    if (applied.movement.swim) updates['system.attributes.speed.swim'] = 0;
    if (applied.movement.fly) updates['system.attributes.speed.fly'] = 0;
    if (applied.movement.burrow) updates['system.attributes.speed.burrow'] = 0;
  }
}
