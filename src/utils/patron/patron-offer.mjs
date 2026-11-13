/**
 * The class-selection offer (core rulebook pp. 146, 315): a class that must choose a patron is offered "at least two",
 * "two or three" of the GM's patrons. A leaf: the picker asks it whether the GM's list fits the book.
 */

/** "At least two" patrons (p. 146; p. 315 "two or three"). */
const OFFER_MIN_PATRONS = 2;
/** "Two or three" patrons (p. 315). */
const OFFER_MAX_PATRONS = 3;

/** Whether `count` offered patrons fit the book: two or three. Anything else is a Rule Break the GM may confirm. */
export function offerCountOk(count) {
  const n = Number(count);
  return Number.isInteger(n) && n >= OFFER_MIN_PATRONS && n <= OFFER_MAX_PATRONS;
}
