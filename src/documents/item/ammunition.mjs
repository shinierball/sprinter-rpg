/**
 * Ammunition (core pp. 181-182: each Attack with a Bow, Crossbow, Handgun or Shotgun requires proper ammunition). A weapon
 * (a gear item or a Skill) names the ammunition it takes as a tag query in `system.ammunition`; ammunition is any owned gear
 * or loot stack whose tags match. One Attack spends `perAttack` units (default 1) hit or miss, once the card has posted.
 * With two or more matching stacks the attacker is asked which to spend every time, the stack picked last preselected (kept
 * as the item flag `ammunitionPick` on the weapon, read and written only here). None left asks a Rule Break, never a block.
 */
import { readFlag, writeFlag } from '../../utils/flags.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { isEmptyQuery, queryParts } from '../../utils/crafting/craft-materials.mjs';
import { matchesTagQuery } from '../../utils/tag/tag-query.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { getUsedForm, USED_FORM_NONE } from '../../data/rules/used-forms.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { spendConsumableUnit } from '../actor/used-items.mjs';
import { pickOwnedItem } from './item-pick.mjs';

const PICK_FLAG = 'ammunitionPick';

const TEXT = Object.freeze({
  'COG.Ammunition.Line': 'Ammunition: {name} ({left} left)',
  'COG.Ammunition.GateTitle': 'No Ammunition',
  'COG.Ammunition.GateMessage': 'No {kind} left for {name} (core pp. 181-182: each Attack requires proper ammunition). Attack anyway as a Rule Break?',
  'COG.Ammunition.PickTitle': 'Ammunition for {name}',
  'COG.Ammunition.PickLabel': 'Ammunition',
  'COG.Ammunition.PickOk': 'Use',
  'COG.Ammunition.PickNote': '({n} left)',
  'COG.Ammunition.Readout': 'Ammo {n}'
});

/** An ammunition string by its `COG.Ammunition.<key>` lang key (English fallback without a catalogue). */
const ammunitionText = langText(TEXT);

const quantityOf = (item) => Math.max(0, Math.floor(Number(item?.system?.quantity) || 0));
const wholeUnits = (value) => Math.max(1, Math.floor(Number(value) || 1));

/**
 * The ammunition a weapon takes: the gear item's own non-empty query wins, else the Skill it is rolled with, else the
 * Skill used alone. Null when none of them names any.
 * @param {object} attackItem the gear weapon, or the Skill when the Attack is made with the Skill alone
 * @param {object|null} hitSkill the Skill the gear weapon is rolled with
 * @returns {{ query: { all: string[], any: string[], none: string[] }, perAttack: number }|null}
 */
function ammunitionNeedOf(attackItem, hitSkill) {
  const sources = [attackItem?.type === 'gear' ? attackItem : null, hitSkill, attackItem?.type === 'skill' ? attackItem : null];
  for (const source of sources) {
    const field = source?.system?.ammunition;
    if (!field || isEmptyQuery(field.query)) continue;
    return { query: queryParts(field.query), perAttack: wholeUnits(field.perAttack) };
  }
  return null;
}

/**
 * The attacker's stacks that count as that ammunition: gear or loot with at least `perAttack` units whose tags match the
 * query, in sheet order.
 * @param {object} actor
 * @param {{ query: object, perAttack: number }} need
 * @returns {object[]}
 */
function ammunitionStacks(actor, need) {
  return [...(actor?.items ?? [])]
    .filter((item) => (item?.type === 'gear' || item?.type === 'loot')
      && quantityOf(item) >= need.perAttack
      && matchesTagQuery(getItemAllTags(item), need.query))
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0));
}

/** The stack picked last for a weapon (an item id), or null. */
function lastAmmunitionPick(attackItem) {
  const pick = readFlag(attackItem, PICK_FLAG);
  return pick && typeof pick === 'object' && typeof pick.itemId === 'string' && pick.itemId ? pick.itemId : null;
}

/** Remember the stack picked for a weapon. */
function rememberAmmunitionPick(attackItem, stackId) {
  return writeFlag(attackItem, PICK_FLAG, { itemId: String(stackId ?? '') });
}

/** The kind of ammunition a query names, as text ("Arrows"; the tag ids when the catalogue has no label). */
function kindLabel(query) {
  const tags = [...query.all, ...query.any];
  return tags.map((id) => getTagDefinition(id)?.label || id).join(', ');
}

/** Whether a stack's own used form is a registered one other than "none": the unit leaves that form behind. */
function leavesForm(stack) {
  const id = String(firstScalar(stack?.system?.usedInto)).trim().toLowerCase();
  return id !== USED_FORM_NONE && getUsedForm(id) !== null;
}

/** The Attack card's ammunition line for the stack an Attack spent from (`spent` is the gate's `spent`). */
export function ammunitionLineHtml({ name, left }) {
  return `<div class="cog-ammunition-line" style="margin-top: 6px; font-size: 11px;"><i class="fa-solid fa-arrow-up-long"></i> ${escapeAttr(ammunitionText('COG.Ammunition.Line', { name, left }))}</div>`;
}

/** The gate result of an Attack that takes no ammunition: nothing asked, spent or printed. */
const noAmmunition = () => ({ proceed: true, flags: {}, spent: null, commit: async () => {} });

/**
 * The gate of an Attack with a weapon that takes ammunition. Picks the stack (asking when several match, the last pick
 * preselected), or asks a Rule Break when none is left. Nothing is spent here: `commit` spends the units and writes the
 * pick, and the caller runs it after the card has posted, so a roll that never posts spends nothing.
 * @param {object} actor the attacker
 * @param {object} attackItem the gear weapon, or the Skill used alone
 * @param {object|null} hitSkill the Skill the gear weapon is rolled with
 * @param {{ options?: object }} [params] the attack's options (`ruleBreak`, `interactive`)
 * @returns {Promise<{ proceed: boolean, flags: object, spent: { name: string, left: number }|null, commit: () => Promise<void> }>}
 */
export async function gateAmmunition(actor, attackItem, hitSkill, { options = {} } = {}) {
  const need = ammunitionNeedOf(attackItem, hitSkill);
  if (!need) return noAmmunition();
  const stacks = ammunitionStacks(actor, need);
  if (!stacks.length) {
    const verdict = await confirmRuleBreak({
      title: ammunitionText('COG.Ammunition.GateTitle'),
      message: ammunitionText('COG.Ammunition.GateMessage', { kind: kindLabel(need.query), name: attackItem.name || actor?.name || '' }),
      options
    });
    return verdict.confirmed ? { ...noAmmunition(), flags: { ruleBreak: true } } : { ...noAmmunition(), proceed: false };
  }
  let stack = stacks[0];
  const remembered = lastAmmunitionPick(attackItem);
  let asked = false;
  if (stacks.length > 1) {
    stack = await pickOwnedItem(actor, {
      candidates: stacks.map((item) => ({ item, note: ammunitionText('COG.Ammunition.PickNote', { n: quantityOf(item) }) })),
      title: ammunitionText('COG.Ammunition.PickTitle', { name: attackItem.name }),
      label: ammunitionText('COG.Ammunition.PickLabel'),
      okLabel: ammunitionText('COG.Ammunition.PickOk'),
      selectedId: stacks.some((item) => item.id === remembered) ? remembered : null
    });
    if (!stack) return { ...noAmmunition(), proceed: false };
    asked = true;
  }
  const units = need.perAttack;
  const left = quantityOf(stack) - units;
  return {
    proceed: true,
    flags: { ammunition: { itemId: stack.id, units } },
    spent: { name: stack.name, left },
    commit: async () => {
      await spendConsumableUnit(stack, actor, { quantity: quantityOf(stack), units, leaveForm: leavesForm(stack) });
      if (asked && stack.id !== remembered) await rememberAmmunitionPick(attackItem, stack.id);
    }
  };
}

/**
 * What the crawler sheet shows beside a weapon that takes ammunition: the sum of its matching stacks. Empty for a weapon
 * that takes none.
 * @param {object} actor
 * @param {object} item the weapon row (gear or Skill)
 * @param {object|null} [hitSkill] the Skill a gear weapon is rolled with
 * @returns {string}
 */
export function ammunitionReadout(actor, item, hitSkill = null) {
  const need = ammunitionNeedOf(item, hitSkill);
  if (!need) return '';
  const total = ammunitionStacks(actor, { ...need, perAttack: 1 }).reduce((sum, stack) => sum + quantityOf(stack), 0);
  return ammunitionText('COG.Ammunition.Readout', { n: total });
}
