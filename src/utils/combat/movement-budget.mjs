/**
 * Movement measured against Move and Step (core p. 69). A Move Action covers the Move; every Action, Move or not, also
 * brings a free Step. So with `actions` Actions of which `k` are Move Actions the creature covers k x Move + actions x Step.
 * Pure: the ruler and the `moveToken` warning read these; nothing here touches a document.
 */

/** Band ids, in the order a longer move passes through them. The ids also name the `COG.Movement.Band` keys. */
export const MOVEMENT_BAND = Object.freeze({ steps: 'steps', one: 'one', many: 'many', over: 'over' });

const feetOf = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * @param {{ move: number, step: number, actions: number }} budget the rated Move, the Step, the round's Action budget
 * @returns {{ upTo: number, moveActions: number }[]} ascending: `moveActions` Move Actions reach `upTo` feet
 */
export function movementBands({ move, step, actions }) {
  const count = Math.max(0, Math.floor(feetOf(actions)));
  return Array.from({ length: count + 1 }, (_, k) => ({ upTo: k * feetOf(move) + count * feetOf(step), moveActions: k }));
}

/**
 * @param {{ upTo: number, moveActions: number }[]} bands from `movementBands`
 * @param {number} feet the measured cost of the move so far
 * @returns {{ upTo: number, moveActions: number }|'over'} the first band that reaches `feet`, or `'over'` past the last
 */
export function movementBand(bands, feet) {
  return bands.find((band) => band.upTo >= feet) ?? MOVEMENT_BAND.over;
}

/**
 * The band of a measured cost, named for display.
 * @returns {{ id: string, moveActions: number }} `id` a `MOVEMENT_BAND` value: Steps alone, one Move Action, more, or over the budget
 */
export function movementBandId(bands, feet) {
  const band = movementBand(bands, feet);
  if (band === MOVEMENT_BAND.over) return { id: MOVEMENT_BAND.over, moveActions: bands.length };
  if (band.moveActions === 0) return { id: MOVEMENT_BAND.steps, moveActions: 0 };
  return { id: band.moveActions === 1 ? MOVEMENT_BAND.one : MOVEMENT_BAND.many, moveActions: band.moveActions };
}

/**
 * Who sees the over-budget warning: the non-GM owner of a token whose actor has a player owner, or a GM for a token with
 * none (the GM owns the Mobs). Everyone else is told nothing.
 */
export function isMoveWarningRecipient({ isGM, isOwner, hasPlayerOwner }) {
  return hasPlayerOwner ? !isGM && Boolean(isOwner) : Boolean(isGM);
}

/**
 * The one-line warning text, or null when the creature stayed inside its budget.
 * @param {{ name: string, feet: number, budget: number, actions: number }} move
 * @returns {string|null}
 */
export function overBudgetWarning({ name, feet, budget, actions }) {
  if (!(feet > budget)) return null;
  return globalThis.game.i18n.format('COG.Movement.OverBudget', { name, feet, actions, budget });
}
