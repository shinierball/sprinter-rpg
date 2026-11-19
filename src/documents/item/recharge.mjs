/**
 * The `recharge` outcome: refill one of the user's own items that holds charges. Which items can take a recharge, the
 * pick (with a Rule Break when the pick does not fit the row's tag query), and the refill itself. The pure readings of a
 * row (`outcomeRecharge`, `chargesAfterRecharge`) live in `utils/loot/outcome-defaults.mjs`.
 */
import { outcomeRecharge, chargesAfterRecharge } from '../../utils/loot/outcome-defaults.mjs';
import { matchesTagQuery } from '../../utils/tag/tag-query.mjs';
import { getTagsOf, itemUsage } from '../../utils/tag/tag-mechanics.mjs';
import { confirmRuleBreak, RULE_BREAK_REFUSALS } from '../../utils/rule-break.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { say } from '../actor/vehicle-drive-common.mjs';
import { pickOwnedItem } from './item-pick.mjs';
import { resolveUsedOrigin, restoreUsedForm, usedFromLabel } from '../actor/used-items.mjs';

const TEXT = Object.freeze({
  title: ['COG.Outcome.Recharge.Type', 'Recharge an Item'],
  pickLabel: ['COG.Outcome.Recharge.PickLabel', 'Item to recharge'],
  pickOk: ['COG.Outcome.Recharge.PickOk', 'Recharge'],
  noteRuleBreak: ['COG.Outcome.Recharge.NoteRuleBreak', '(Rule Break)'],
  noteFull: ['COG.Outcome.Recharge.NoteFull', '(full)'],
  noneMessage: ['COG.Outcome.Recharge.NoneMessage', 'Nothing here can take a recharge. Use it anyway?'],
  ruleBreakMessage: ['COG.Outcome.Recharge.RuleBreakMessage', '{target} does not fit {source}. Recharge it anyway as a Rule Break?'],
  lineCharged: ['COG.Outcome.Recharge.LineCharged', '{name}: {before} → {after} of {max} charges'],
  lineFull: ['COG.Outcome.Recharge.LineFull', '{name} was already full'],
  lineNothing: ['COG.Outcome.Recharge.LineNothing', 'Nothing was recharged.'],
  lineRestored: ['COG.Outcome.Recharge.LineRestored', '{name} restored ({units}) from {from}'],
  lineMissing: ['COG.Outcome.Recharge.LineMissing', '{from}: origin not found'],
  noteWas: ['COG.Outcome.Recharge.NoteWas', '(was {origin})'],
  noteMissing: ['COG.Outcome.Recharge.NoteMissing', '(origin not found)']
});

const words = (id, data) => say(TEXT[id][0], TEXT[id][1], data);

/** The default heading of a recharge outcome's card block. */
export const rechargeTitle = () => words('title');

/** Whether an item is junk that remembers what it was (`usage.restorable` leaves `system.usedFrom`). */
const isRememberedJunk = (item) => item?.type === 'loot' && Boolean(item.system?.used)
  && Boolean(item.system?.usedFrom?.identifier || item.system?.usedFrom?.spellIdentifier);

/**
 * The tags a recharge query is matched against: the item's own plus its usage kind (`usage.rechargeable` for a wand with
 * no stored kind). Remembered junk is matched by the tags of the item it was (its origin), never its own junk tags.
 */
function rechargeTagsOf(item, origin = null) {
  const subject = origin?.doc ?? item;
  const own = origin && origin.source !== 'owned' && origin.source !== 'world'
    ? new Set(subject.system?.tags ?? [])
    : getTagsOf(subject);
  return new Set([...own, `usage.${itemUsage(subject)}`]);
}

/**
 * The actor's own items that can take a recharge: any item holding charges (`charges.max > 0`), and junk that remembers
 * its origin; the source item itself excluded. `matches` says whether the item fits at least one of the rows' queries (a
 * row with no query fits anything); `full` that it has nothing to gain; `missing` that remembered junk has no origin to
 * come back as. `origin` is the resolved origin of such junk.
 * @param {Actor} actor
 * @param {Item} source the item being used
 * @param {Array<object|null>} queries each recharge row's `query` (null = any)
 * @returns {Promise<Array<{ item: Item, origin: object|null, matches: boolean, full: boolean, missing: boolean }>>}
 */
async function rechargeCandidates(actor, source, queries) {
  const out = [];
  const fits = (tags) => queries.some((q) => !q || matchesTagQuery(tags, q));
  for (const item of actor?.items ?? []) {
    if (item === source || (item.id && item.id === source?.id)) continue;
    if (isRememberedJunk(item)) {
      const origin = await resolveUsedOrigin(actor, item);
      out.push({ item, origin, matches: origin ? fits(rechargeTagsOf(item, origin)) : false, full: false, missing: !origin });
      continue;
    }
    const charges = item.system?.charges;
    if (!(Number(charges?.max) > 0)) continue;
    out.push({
      item,
      origin: null,
      matches: fits(rechargeTagsOf(item)),
      full: chargesAfterRecharge(charges, { full: true, amount: 0 }).gained === 0,
      missing: false
    });
  }
  return out;
}

/** The text after a candidate's name in the pick: what remembered junk was, then why it is odd (missing, full, outside the query). */
function candidateNote(c) {
  const was = usedFromLabel(c.item);
  const state = c.missing ? words('noteMissing') : c.full ? words('noteFull') : (c.matches ? '' : words('noteRuleBreak'));
  return [was ? words('noteWas', { origin: was }) : '', state].filter(Boolean).join(' ');
}

/**
 * Ask which item a recharge refills, before anything is spent. Candidates that fit the rows come first, the others follow
 * marked "(Rule Break)", full ones are listed disabled. Picking one outside the rows' queries asks for a Rule Break. When
 * nothing can take a recharge the user is asked whether to use the item anyway (spent, no effect, no Rule Break).
 * @param {Actor} actor
 * @param {Item} source the item being used
 * @param {{ rows: object[], options?: object }} params the item's recharge rows; the use's options (`interactive`)
 * @returns {Promise<{ cancelled: true }|{ target: Item|null, origin?: object|null, ruleBreak: boolean }>} `origin` is set when the pick is remembered junk; a null target is "use it anyway"
 */
export async function pickRechargeTarget(actor, source, { rows, options = {} }) {
  const candidates = await rechargeCandidates(actor, source, rows.map((r) => outcomeRecharge(r).query));
  if (!candidates.some((c) => !c.full && !c.missing)) {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (options?.interactive === false || typeof DialogV2?.confirm !== 'function') return { cancelled: true };
    const anyway = await DialogV2.confirm({
      window: { title: source?.name ?? words('title') },
      content: `<p>${escapeAttr(words('noneMessage'))}</p>`,
      modal: true
    });
    return anyway ? { target: null, ruleBreak: false } : { cancelled: true };
  }
  const ordered = [...candidates.filter((c) => c.matches), ...candidates.filter((c) => !c.matches)];
  const target = await pickOwnedItem(actor, {
    candidates: ordered.map((c) => ({
      item: c.item,
      note: candidateNote(c),
      disabled: c.full || c.missing
    })),
    title: source?.name ?? words('title'),
    label: words('pickLabel'),
    okLabel: words('pickOk')
  });
  if (!target) return { cancelled: true };
  const picked = ordered.find((c) => c.item === target);
  const origin = picked?.origin ?? null;
  if (picked?.matches) return { target, origin, ruleBreak: false };
  const reason = words('ruleBreakMessage', { target: target.name, source: source?.name ?? '' });
  const verdict = await confirmRuleBreak({ title: 'Rule Break Confirmation', message: reason, reason, options });
  if (!verdict.confirmed) {
    if (verdict.refusal !== RULE_BREAK_REFUSALS.CANCELLED) globalThis.ui?.notifications?.warn?.(reason);
    return { cancelled: true };
  }
  return { target, origin, ruleBreak: true };
}

/**
 * Refill the target as the row says (blank amount: to full; never above max). Remembered junk is turned back into the item
 * it was instead: the row's amount in units (blank: the whole stack, capped at the stack). A null target (nothing could
 * take the recharge) changes nothing.
 * @param {Item|null} target
 * @param {object} row the recharge outcome row
 * @param {{ actor?: Actor, origin?: object|null }} [params] the owner and the junk's resolved origin (looked up when absent)
 * @returns {Promise<{ status: 'charged'|'full'|'restored'|'missing'|'none', name: string, before: number, after: number, max: number, units?: number, from?: string }>}
 */
export async function applyRecharge(target, row, { actor = target?.parent, origin } = {}) {
  if (!target) return { status: 'none', name: '', before: 0, after: 0, max: 0 };
  if (isRememberedJunk(target)) return restoreJunk(actor, target, row, origin);
  const charges = target.system?.charges ?? {};
  const max = Math.max(0, Math.floor(Number(charges.max)) || 0);
  const before = Math.max(0, Math.floor(Number(charges.value)) || 0);
  const { value, gained } = chargesAfterRecharge(charges, outcomeRecharge(row));
  if (gained <= 0) return { status: 'full', name: target.name, before, after: before, max };
  await target.update({ 'system.charges.value': value });
  return { status: 'charged', name: target.name, before, after: value, max };
}

/** Turn units of remembered junk back into the item it was ({@link applyRecharge}). */
async function restoreJunk(actor, junk, row, given) {
  const found = given ?? await resolveUsedOrigin(actor, junk);
  const stack = Math.max(0, Math.floor(Number(junk.system?.quantity)) || 0);
  if (!found) return { status: 'missing', name: junk.name, before: stack, after: stack, max: 0, units: 0, from: junk.name };
  const { full, amount } = outcomeRecharge(row);
  const { item, units } = await restoreUsedForm(actor, junk, full ? stack : amount, found);
  return { status: 'restored', name: item?.name ?? found.doc.name ?? junk.name, before: stack, after: stack - units, max: 0, units, from: junk.name };
}

/** The plain-text card line of an {@link applyRecharge} result (the caller escapes it). */
export function rechargeLine(res) {
  if (res.status === 'charged') return words('lineCharged', { name: res.name, before: res.before, after: res.after, max: res.max });
  if (res.status === 'full') return words('lineFull', { name: res.name });
  if (res.status === 'restored') return words('lineRestored', { name: res.name, units: res.units, from: res.from });
  if (res.status === 'missing') return words('lineMissing', { from: res.from });
  return words('lineNothing');
}
