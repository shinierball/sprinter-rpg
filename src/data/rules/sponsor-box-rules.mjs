/**
 * Sponsor Boxes from Playing to the Sponsors (core pp. 281 and 284). Pure rules: the stored state's sanitiser, the
 * quality reduction, the limits that ask a Rule Break, and the Sponsors column of Table 52 as GM choices. Nothing here
 * reads a document or the flag; `src/documents/actor/sponsor-box.mjs` does.
 */
import { firstScalar } from '../../utils/first-scalar.mjs';
import { lootBoxTierDef, lootBoxTiersInOrder, resolveLootBoxTier } from '../loot-box-tiers.mjs';

const wholeFloor = (raw) => {
  const n = Math.trunc(Number(firstScalar(raw)));
  return Number.isFinite(n) && n >= 1 ? n : null;
};

/**
 * The stored state, sanitised: the Floor a cameras box was last gained on, the Floor a Major Fail barred, and the grades
 * the next box is reduced by. Junk reads as null or 0.
 * @param {unknown} raw
 * @returns {{ boxFloor: number|null, barredFloor: number|null, reduce: number }}
 */
export function sanitizeBenefactorState(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const reduce = Math.trunc(Number(firstScalar(src.reduce)));
  return { boxFloor: wholeFloor(src.boxFloor), barredFloor: wholeFloor(src.barredFloor), reduce: Number.isFinite(reduce) && reduce > 0 ? reduce : 0 };
}

/**
 * The tier `steps` places lower in rank order, stopping at the lowest (a Bronze box has nothing below it, and the
 * reduction is used up; the book never says a Fail cancels a box). An unknown tier reads as Bronze.
 * @param {string} tier
 * @param {number} steps
 * @returns {string} a tier id
 */
function reducedTier(tier, steps) {
  const order = lootBoxTiersInOrder().map((def) => def.id);
  const at = Math.max(0, order.indexOf(resolveLootBoxTier(tier)));
  return order[Math.max(0, at - Math.max(0, Math.trunc(Number(steps)) || 0))];
}

/**
 * What awarding a box of `tier` would do: the tier after the owed reduction, whether it uses the reduction, and the limits
 * it exceeds (each asks one Rule Break), in this order: no Sponsor, a box already gained this Floor, a Major Fail's bar.
 * @param {{ state: ReturnType<typeof sanitizeBenefactorState>, floor: number, hasSponsor: boolean, tier: string }} args
 * @returns {{ tier: string, usesReduction: boolean, reasons: string[] }}
 */
export function benefactorAwardPlan({ state, floor, hasSponsor, tier }) {
  const reasons = [];
  if (!hasSponsor) reasons.push('no-sponsor');
  if (state.boxFloor === floor) reasons.push('once-per-floor');
  if (state.barredFloor === floor) reasons.push('barred');
  return { tier: reducedTier(tier, state.reduce), usesReduction: state.reduce > 0, reasons };
}

const boxChoice = (tier) => ({ id: tier, label: `${lootBoxTierDef(tier).label} Sponsor Box`, benefactor: { tier } });
const NO_BOX = () => ({ id: 'none', label: 'No box: interest only' });

/**
 * A copy of a Sponsors cell of Table 52 as GM choices that write the Sponsor Box state (core p. 281). The Amazing Success
 * offers Gold, Platinum or a bid and the Standard Success Bronze or Silver, each with a way out that follows the rule;
 * the Standard Fail's choice owes one grade and the Major Fail's bars the Floor. The cell's text is kept.
 * @param {object} cell
 * @param {string} result a Table 52 result id
 * @returns {object}
 */
export function benefactorSponsorCell(cell, result) {
  if (result === 'amazing') {
    return { ...cell, choices: [boxChoice('gold'), boxChoice('platinum'), { id: 'bid', label: 'An interested Sponsor bids', note: 'An interested Sponsor bids' }, NO_BOX()] };
  }
  if (result === 'success') return { ...cell, choices: [boxChoice('bronze'), boxChoice('silver'), NO_BOX()] };
  const effects = { reduced: { reduce: 1 }, nobox: { bar: true } };
  return { ...cell, choices: (cell.choices ?? []).map((c) => (effects[c.id] ? { ...c, benefactor: effects[c.id] } : c)) };
}
