/**
 * Sponsor Boxes from Playing to the Sponsors (core pp. 281 and 284): the crawler's state and what a GM choice writes.
 * One actor flag holds `{ boxFloor, barredFloor, reduce }`; Floors are compared with the current Floor, so a new Floor
 * clears both per-Floor parts with no hook. This is the only file that spells the flag key.
 */
import { clearFlag, readFlag, writeFlag } from '../../utils/flags.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { cameraCell, sanitizeCameraChoice } from '../../utils/roll/cameras.mjs';
import { benefactorAwardPlan, benefactorSponsorCell, sanitizeBenefactorState } from '../../data/rules/sponsor-box-rules.mjs';
import { lootBoxTierDef } from '../../data/loot-box-tiers.mjs';
import { addLootBoxes, entryFromRow } from './loot-box-entries.mjs';

const BENEFACTOR_FLAG = 'sponsorBox';

const TEXT = Object.freeze({
  'COG.Sponsor.Benefactor.ReduceOne': 'The next Sponsor Box is one grade lower.',
  'COG.Sponsor.Benefactor.ReduceMany': 'The next Sponsor Box is {n} grades lower.',
  'COG.Sponsor.Benefactor.Barred': 'Barred from a Sponsor Box until the next Floor.',
  'COG.Sponsor.Benefactor.Gained': 'A Sponsor Box has already come this Floor.',
  'COG.Sponsor.Benefactor.Clear': 'Clear',
  'COG.Sponsor.Benefactor.ClearTip': 'Clear the Sponsor Box state (owed reductions, the bar and this Floor\'s box)',
  'COG.Sponsor.Benefactor.BoxName': '{tier} Sponsor Box',
  'COG.Sponsor.Benefactor.Line': '{reason}: {name} gets a {box}',
  'COG.Sponsor.Benefactor.LineNoSponsor': '{reason}: {name} has no Sponsor, so nothing changes',
  'COG.Sponsor.Benefactor.ReasonTitle': 'Sponsor Box Limit',
  'COG.Sponsor.Benefactor.ReasonMessage': '{name}: {reasons}. Award the box anyway as a Rule Break?',
  'COG.Sponsor.Benefactor.Reason.no-sponsor': 'there is no Sponsor',
  'COG.Sponsor.Benefactor.Reason.once-per-floor': 'a Sponsor Box already came this Floor',
  'COG.Sponsor.Benefactor.Reason.barred': 'a Major Fail barred a box this Floor'
});

/** A string by key; works without a loaded i18n catalogue (headless tests). */
export const benefactorText = langText(TEXT);

const sponsorItems = (actor) => [...(actor?.items ?? [])].filter((item) => item.type === 'sponsor');

/** The crawler's state, sanitised. */
function benefactorState(actor) {
  return sanitizeBenefactorState(readFlag(actor, BENEFACTOR_FLAG));
}

/** The Table 52 cell of an audience and result, with the Sponsors column as Sponsor Box choices; other audiences unchanged. */
export function benefactorCameraCell(id, result) {
  const cell = cameraCell(id, result);
  return cell && sanitizeCameraChoice(id) === 'sponsors' ? benefactorSponsorCell(cell, result) : cell;
}

/**
 * What a choice's `benefactor` effect would do for this crawler on this Floor; null when it awards no box.
 * @returns {null|{ tier: string, usesReduction: boolean, reasons: string[] }}
 */
export function benefactorChoicePlan(actor, effect, floor) {
  if (!effect?.tier) return null;
  return benefactorAwardPlan({ state: benefactorState(actor), floor, hasSponsor: sponsorItems(actor).length > 0, tier: effect.tier });
}

/** "A Major Fail barred a box this Floor; ..." for the Rule Break question. */
export function benefactorReasonsText(reasons) {
  return reasons.map((r) => benefactorText(`COG.Sponsor.Benefactor.Reason.${r}`)).join('; ');
}

/**
 * Write one choice's effect. A reduction or a bar with no Sponsor writes nothing (p. 281: no cost without a Sponsor). A box
 * adds one held box for the GM to fill (p. 284), records the Floor, and uses up the owed reduction. The Rule Break for a box
 * over a limit has already been asked by the caller, who passes `confirmed`.
 * @param {object} actor
 * @param {{ tier?: string, reduce?: number, bar?: boolean }} effect a choice's `benefactor`
 * @param {{ floor: number }} where
 * @returns {Promise<{ written: boolean, reason?: string, tier?: string, boxName?: string }>}
 */
export async function applyBenefactorChoice(actor, effect, { floor }) {
  const sponsors = sponsorItems(actor);
  const state = benefactorState(actor);
  if (effect?.tier) {
    const plan = benefactorChoicePlan(actor, effect, floor);
    const boxName = benefactorText('COG.Sponsor.Benefactor.BoxName', { tier: lootBoxTierDef(plan.tier).label });
    const entry = entryFromRow({ tier: plan.tier, quantity: 1, whenEmpty: 'keep' }, null, { sourceName: sponsors[0]?.name ?? '' });
    await addLootBoxes(actor, [{ ...entry, name: boxName }]);
    await writeFlag(actor, BENEFACTOR_FLAG, { ...state, boxFloor: floor, reduce: plan.usesReduction ? 0 : state.reduce });
    return { written: true, tier: plan.tier, boxName };
  }
  if (!sponsors.length) return { written: false, reason: 'no-sponsor' };
  if (effect?.reduce) await writeFlag(actor, BENEFACTOR_FLAG, { ...state, reduce: state.reduce + effect.reduce });
  else if (effect?.bar) await writeFlag(actor, BENEFACTOR_FLAG, { ...state, barredFloor: floor });
  else return { written: false };
  return { written: true };
}

/** The Story tab's lines: grades owed, barred this Floor, a cameras box already gained this Floor; `[]` when none applies. */
export function benefactorView(actor, floor) {
  const state = benefactorState(actor);
  const lines = [];
  if (state.reduce === 1) lines.push(benefactorText('COG.Sponsor.Benefactor.ReduceOne'));
  else if (state.reduce > 1) lines.push(benefactorText('COG.Sponsor.Benefactor.ReduceMany', { n: state.reduce }));
  if (state.barredFloor === floor) lines.push(benefactorText('COG.Sponsor.Benefactor.Barred'));
  if (state.boxFloor === floor) lines.push(benefactorText('COG.Sponsor.Benefactor.Gained'));
  return lines;
}

/** The GM's [Clear] button. */
export function clearBenefactorState(actor) {
  return clearFlag(actor, BENEFACTOR_FLAG);
}
