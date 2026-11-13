/**
 * A patron's advice reaches the Bard by HUD chat or by a messenger fairy (core rulebook p. 316). The fairy takes 5 minutes
 * to reach the patron's floor and 5 more for each extra floor between them, each way. Pure.
 */

/** Minutes for the fairy to cross to a patron on the same floor, one way (p. 316). */
const FAIRY_LEG_MINUTES = 5;
/** Extra minutes for each floor the patron is away, one way (p. 316). */
const FAIRY_EXTRA_FLOOR_MINUTES = 5;

/** @param {number} floorsApart whole floors between the Bard and the patron @returns {number} minutes, one way */
export function fairyTripMinutes(floorsApart) {
  const apart = Math.max(0, Math.trunc(Number(floorsApart)) || 0);
  return FAIRY_LEG_MINUTES + FAIRY_EXTRA_FLOOR_MINUTES * apart;
}
