/**
 * Sprinter RPG - Body fit after a transformation. A change, a form switch and a revert leave the victim with a body that
 * may not hold what they had equipped: this pass takes off what the new body cannot wear or hold, flags each item with the
 * affliction that took it off (`takenOffBy`), and puts back the flagged items that fit the body as it now is. It reads
 * derived limbs and writes only `system.equipped` and the flag; it never prompts and never blocks (Directive 2): gear
 * forced on under a Rule Break comes off like any other misfit, and anyone may force it on again.
 */
import { bodyLimbsOf, planRefit, isEquipped } from '../../utils/gear/body-fit.mjs';
import { ITEM_STATE_TAGS } from '../../utils/tag/tag-mechanics.mjs';
import { transformText } from '../../utils/character/transform-text.mjs';
import { afflictionStage, isAffliction } from '../../utils/character/transform-rules.mjs';
import { takenOffByOf, takenOffByUpdate } from '../../utils/character/overlay-state.mjs';

/**
 * The equip gate this pass puts gear back through. `enchantments.mjs` registers `setItemEquipped` when it loads: that module
 * sits in the document import cycle, and importing it here would pull the transformation engine into it.
 * @type {((item: Item, value: boolean, options?: object) => Promise<boolean>)|null}
 */
let equipper = null;

/** @param {(item: Item, value: boolean, options?: object) => Promise<boolean>} fn the equip toggle with its Rule Break gates */
export function registerGearEquipper(fn) {
  equipper = fn;
}

/** Why a piece of gear was left off at a revert (the codes `fitLines` words). */
const LEFT_OFF = Object.freeze({ fit: 'fit', broken: 'broken', ruleBreak: 'ruleBreak' });
const REASON_KEYS = Object.freeze({
  fit: 'COG.TransformCard.LeftOffFit',
  broken: 'COG.TransformCard.LeftOffBroken',
  ruleBreak: 'COG.TransformCard.LeftOffRuleBreak'
});

const idOf = (doc) => String(doc?.id ?? doc?._id ?? '');
const row = (item) => ({ id: idOf(item), name: item.name });
const inInventoryOrder = (a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || idOf(a).localeCompare(idOf(b));
const isBrokenOrDestroyed = (item) => (item.system?.tags ?? []).some((tag) => tag === ITEM_STATE_TAGS.broken || tag === ITEM_STATE_TAGS.destroyed);

/**
 * Make the equipped gear fit the body as it is now. Never prompts.
 * @param {Actor} actor
 * @param {{ affliction?: Item|null, reverting?: boolean }} [ctx] the affliction this pass runs for; `reverting` when it is
 *   the one being undone (its flagged items are put back or released, never kept)
 * @returns {Promise<{ off: Array<{id: string, name: string}>, on: Array<{id: string, name: string}>, left: Array<{id: string, name: string, reason: string}> }>}
 */
export async function refitBody(actor, { affliction = null, reverting = false } = {}) {
  const report = { off: [], on: [], left: [] };
  const limbs = bodyLimbsOf(actor);
  if (!limbs) return report;
  const gear = () => Array.from(actor.items ?? []).filter((item) => item.type === 'gear' || item.type === 'attack');
  const ownId = idOf(affliction);
  // The afflictions whose changes are in force: the one being reverted is not, the one just changed is
  const changed = new Set(Array.from(actor.items ?? [])
    .filter((item) => isAffliction(item) && afflictionStage(item) === 'changed' && !(reverting && idOf(item) === ownId))
    .map(idOf));
  if (ownId && !reverting) changed.add(ownId);

  // Candidates to put back: gear still off that a changed affliction took off, or the one being reverted
  const taker = new Set(changed);
  if (reverting && ownId) taker.add(ownId);
  const candidates = gear().filter((item) => !isEquipped(item) && taker.has(takenOffByOf(item))).sort(inInventoryOrder);
  const plan = planRefit(gear(), limbs, candidates.map(idOf));

  // Take off what the body cannot wear or hold; a revert's leftovers get no flag, nothing will put them back
  const flag = reverting || !ownId ? '' : ownId;
  if (plan.unequip.length) {
    await actor.updateEmbeddedDocuments('Item', plan.unequip.map((id) => ({ _id: id, 'system.equipped': false, ...takenOffByUpdate(flag) })));
    for (const id of plan.unequip) report.off.push(row(actor.items.get(id)));
  }

  // Put back what fits again, through the gate a person meets (never a dialog)
  const reasons = new Map();
  for (const id of plan.equip) {
    const item = actor.items.get(id);
    if (!item) continue;
    if (!equipper) console.warn('Sprinter RPG | No equip gate is registered, so gear taken off by a body change stays off.');
    if (equipper && await equipper(item, true, { interactive: false })) report.on.push(row(item));
    else reasons.set(id, isBrokenOrDestroyed(item) ? LEFT_OFF.broken : LEFT_OFF.ruleBreak);
  }

  // Release the records that describe nothing: gear that is on, a name no changed affliction owns, a revert's leftovers
  const release = [];
  for (const item of gear()) {
    const by = takenOffByOf(item);
    if (!by || !(isEquipped(item) || !changed.has(by))) continue;
    release.push(item);
    if (reverting && by === ownId && !isEquipped(item)) report.left.push({ ...row(item), reason: reasons.get(idOf(item)) ?? LEFT_OFF.fit });
  }
  if (release.length) await actor.updateEmbeddedDocuments('Item', release.map((item) => ({ _id: idOf(item), ...takenOffByUpdate('') })));
  return report;
}

const names = (list) => list.map((entry) => entry.name).join(', ');

/**
 * The card lines for what a pass did; a line is left out when its list is empty.
 * @param {{ off: object[], on: object[], left: object[] }} report from {@link refitBody}
 * @returns {string[]}
 */
export function fitLines({ off, on, left }) {
  const lines = [];
  if (off.length) lines.push(transformText('COG.TransformCard.TakenOff', { items: names(off) }));
  if (on.length) lines.push(transformText('COG.TransformCard.PutBack', { items: names(on) }));
  if (left.length) {
    const items = left.map((entry) => `${entry.name} (${transformText(REASON_KEYS[entry.reason] ?? REASON_KEYS.fit)})`).join(', ');
    lines.push(transformText('COG.TransformCard.LeftOff', { items }));
  }
  return lines;
}
