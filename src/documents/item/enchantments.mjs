/**
 * Sprinter RPG - Applying enchantments, broken items and Repair
 *
 * An enchantment is written into the item's own row arrays with an `enchantment` stamp, plus one ledger entry in
 * `system.enchantments`. Nothing here blocks: a second same property, a second Amazing Success trigger, the
 * over-enchanting hazard and equipping a broken item all ask a Rule Break and record `ruleBreak: true` when confirmed.
 */

import { SYSTEM_ID } from '../../constants.mjs';
import { confirmRuleBreak, getRuleBreakMode, RULE_BREAK_MODES, markRuleBreak } from '../../utils/rule-break.mjs';
import { hasAsTrigger } from '../../utils/roll/amazing-success.mjs';
import { craftText } from '../../utils/crafting/craft-text.mjs';
import {
  ENCHANTMENT_ROW_ARRAYS, HAZARD_BREAKS_ON, HAZARD_ENCHANTMENTS, breakItemUpdate, buildEnchantmentWrite, enchantmentCount, sharesProperty, mundaneDifficulty, craftContextTags, sanitizeCraftRef
} from '../../utils/crafting/crafting-engine.mjs';
import { sanitizeEnchantmentTemplate } from '../../utils/loot/outcome-defaults.mjs';
import { ITEM_STATE_TAGS } from '../../utils/tag/tag-mechanics.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { skillStandIn } from '../../utils/skill/skill-stand-in.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { confirmRivalBlessedGear } from '../actor/worship-obligations.mjs';
import { buildRollContext } from '../../utils/roll/roll-context.mjs';
import { collectCraftModifiers } from '../../utils/roll/damage-modifiers.mjs';
import { decrementFloorTimer } from '../actor/actor-environment.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

/** Hours a Repair takes (the book: 2 hours). */
export const REPAIR_HOURS = 2;

const asArray = (v) => (Array.isArray(v) ? v : []);
const tagsOf = (item) => asArray(item?.system?.tags).filter((t) => typeof t === 'string');

/** Whether the item carries the repairable `item.broken` tag. */
const isBroken = (item) => tagsOf(item).includes(ITEM_STATE_TAGS.broken);
/** Whether the item carries the permanent `item.destroyed` tag. */
const isDestroyed = (item) => tagsOf(item).includes(ITEM_STATE_TAGS.destroyed);

/** Roll 1d10 with Foundry's `Roll`, or the injected rng (a function returning 1-10). */
async function rollD10(rng) {
  if (typeof rng === 'function') return Number(await rng()) || 1;
  if (typeof Roll !== 'undefined') return (await new Roll('1d10').evaluate()).total;
  return Math.floor(Math.random() * 10) + 1;
}

/** The C5 dialog: 'roll', 'skip' or 'cancel'. With no dialog API (or non-interactive) it cannot ask, so it cancels. */
async function askHazard(item, count, interactive) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!interactive || typeof DialogV2?.wait !== 'function') return 'cancel';
  const answer = await DialogV2.wait({
    window: { title: craftText('COG.Enchanting.OverTitle') },
    content: `<p>${escapeAttr(craftText('COG.Enchanting.OverMessage', { name: item.name, count, breaksOn: HAZARD_BREAKS_ON }))}</p>`,
    buttons: [
      { action: 'roll', label: craftText('COG.Enchanting.Roll'), default: true },
      // The GM's "refuse" mode enforces the limits: the roll is the rule, skipping it is not offered.
      ...(getRuleBreakMode() === RULE_BREAK_MODES.REFUSE ? [] : [{ action: 'skip', label: craftText('COG.Enchanting.Skip') }]),
      { action: 'cancel', label: craftText('COG.Enchanting.Cancel') }
    ],
    rejectClose: false,
    modal: true
  });
  return answer === 'roll' || answer === 'skip' ? answer : 'cancel';
}

/**
 * Mark an item broken (repairable) or destroyed (permanent) and unequip it.
 * @param {Item} item
 * @param {{ destroyed?: boolean }} [options]
 */
export async function breakItem(item, { destroyed = false } = {}) {
  if (!item) return;
  const update = breakItemUpdate({ tags: tagsOf(item), equipped: item.system?.equipped }, { destroyed });
  if (Object.keys(update).length) await item.update(update);
}

/**
 * Apply one enchantment template to an item (spec 5.4). Order: same property, second AS trigger, the over-enchanting
 * hazard, then one update that appends the stamped rows and the ledger entry.
 * @param {Item} item
 * @param {object} template an enchantment template (sanitised here)
 * @param {{ method?: string, ruleBreak?: boolean, rng?: Function, interactive?: boolean, tags?: string[], name?: string }} [opts] `tags` and
 *   `name` add tags to the item and rename it with the enchantment (see `buildEnchantmentWrite`)
 * @returns {Promise<{ applied: boolean, destroyed: boolean, ruleBreak: boolean, ledgerId?: string, refusal?: string }>}
 */
export async function applyEnchantment(item, template, { method = 'craft', ruleBreak = false, rng, interactive = true, tags, name } = {}) {
  const tpl = sanitizeEnchantmentTemplate(template);
  const label = tpl.label || craftText('COG.Enchanting.AnEnchantment');
  const result = { applied: false, destroyed: false, ruleBreak: ruleBreak === true };
  const sys = item?.system ?? {};
  const ask = { interactive, ...(ruleBreak ? { ruleBreak: true } : {}) };

  if (sharesProperty(sys, tpl, { ignoreAs: true })) {
    const res = await confirmRuleBreak({
      title: craftText('COG.Enchanting.SamePropertyTitle'),
      message: craftText('COG.Enchanting.SamePropertyMessage', { name: item.name, label }),
      options: ask
    });
    if (!res.confirmed) return { ...result, refusal: res.refusal ?? 'cancelled' };
    result.ruleBreak = true;
  }

  let asBreak = false;
  if (asArray(tpl.rows.asTriggers).length && hasAsTrigger(item)) {
    const res = await confirmRuleBreak({
      title: craftText('COG.Enchanting.SecondAsTitle'),
      message: craftText('COG.Enchanting.SecondAsMessage', { name: item.name }),
      options: ask
    });
    if (!res.confirmed) return { ...result, refusal: res.refusal ?? 'cancelled' };
    result.ruleBreak = true;
    asBreak = true;
  }

  const count = enchantmentCount(sys);
  if (count >= HAZARD_ENCHANTMENTS) {
    const choice = await askHazard(item, count, interactive);
    if (choice === 'cancel') return { ...result, refusal: 'cancelled' };
    if (choice === 'skip') {
      result.ruleBreak = true;
    } else if (await rollD10(rng) <= HAZARD_BREAKS_ON) {
      await breakItem(item, { destroyed: true });
      return { ...result, destroyed: true };
    }
  }

  const { id: ledgerId, update } = buildEnchantmentWrite(sys, tpl, { method, ruleBreak: result.ruleBreak, asBreak, tags, name });
  await item.update(update);
  return { ...result, applied: true, ledgerId };
}

/**
 * Remove an enchantment: its ledger entry and every row stamped with its id.
 * @param {Item} item
 * @param {string} ledgerId
 * @returns {Promise<boolean>} false when the item has no such entry
 */
export async function removeEnchantment(item, ledgerId) {
  const sys = item?.system ?? {};
  const ledger = asArray(sys.enchantments);
  if (!ledgerId || !ledger.some((e) => e?.id === ledgerId)) return false;
  const update = { 'system.enchantments': ledger.filter((e) => e?.id !== ledgerId) };
  const dropTags = asArray(ledger.find((e) => e?.id === ledgerId)?.tags);
  if (dropTags.length) update['system.tags'] = tagsOf(item).filter((t) => !dropTags.includes(t));
  for (const array of ENCHANTMENT_ROW_ARRAYS) {
    const rows = asArray(sys[array]);
    if (rows.some((r) => r?.enchantment === ledgerId)) update[`system.${array}`] = rows.filter((r) => r?.enchantment !== ledgerId);
  }
  await item.update(update);
  return true;
}

/**
 * Equip or unequip an item. Equipping a broken or destroyed item asks a Rule Break and records it as an item flag.
 * @param {Item} item
 * @param {boolean} value
 * @param {{ interactive?: boolean, ruleBreak?: boolean }} [options]
 * @returns {Promise<boolean>} whether the change was made
 */
export async function setItemEquipped(item, value, options = {}) {
  if (!item) return false;
  const equip = value === true;
  let ruleBreak = false;
  if (equip && (isBroken(item) || isDestroyed(item))) {
    const res = await confirmRuleBreak({
      title: craftText('COG.Enchanting.BrokenTitle'),
      message: craftText(isDestroyed(item) ? 'COG.Enchanting.DestroyedMessage' : 'COG.Enchanting.BrokenMessage', { name: item.name }),
      options
    });
    if (!res.confirmed) return false;
    ruleBreak = true;
  }
  // The Enemy God's Prohibition (p. 163): gear blessed by a rival of a god the owner worships asks a Rule Break.
  if (equip && item.actor) {
    const rival = await confirmRivalBlessedGear(item.actor, item, options);
    if (!rival.proceed) return false;
    ruleBreak = ruleBreak || rival.ruleBreak;
  }
  await item.update({ 'system.equipped': equip });
  if (ruleBreak) await markRuleBreak(item);
  return true;
}

/** A localized string; the key itself when no catalogue is loaded. */
const loc = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (data && typeof i18n?.format === 'function') return i18n.format(key, data);
  return i18n?.localize?.(key) ?? key;
};

/**
 * The craft reference a Repair check is rolled with (`rollSkill`'s `craft` option): the Difficulty and the item's own tags,
 * so the card shows the Difficulty line and the `craftModifiers` rows can judge the item's state (`item.broken`, `item.destroyed`).
 * @param {Item} item
 * @param {number} dc
 */
function repairCraftRef(item, dc) {
  return { dc, tags: [...getItemAllTags(item)], stepLabel: loc('COG.Repair.StepLabel') };
}

/**
 * What the skill's `craftModifiers` rows say about one repair: the hours (2 x the `time` rows, so Rank 10's "1 hour" is
 * a row on the skill) and whether a `rebuild` row lets it rebuild a destroyed item.
 * @param {Actor} actor
 * @param {Item|null} skill the skill that rolls the check (its rows count only then)
 * @param {object|null} craft the sanitized craft reference
 * @returns {{ hours: number, rebuild: boolean }}
 */
function repairModifiers(actor, skill, craft) {
  const context = buildRollContext({ actor, phase: 'check', item: skill ?? null, other: null, tags: craftContextTags(craft) });
  const { timeMultiplier, rebuild } = collectCraftModifiers(actor, context);
  return { hours: Math.round(REPAIR_HOURS * timeMultiplier * 1e6) / 1e6, rebuild };
}

/**
 * Repair a broken item: an Unopposed check (Difficulty 10 + 2 x Floor) with the given skill, 2 hours on the floor clock
 * (fewer with the skill's `time` rows). Success removes `item.broken`. A destroyed item needs a `rebuild` row (the
 * Repair skill's Rank 15); without one it is a Rule Break, and the check then clears `item.destroyed` on success.
 * @param {Actor} actor
 * @param {Item} item
 * @param {{ skill: Item, options?: object }} params
 * @returns {Promise<{ repaired: boolean, dc?: number, total?: number, hours?: number, refusal?: string, ruleBreak?: boolean, rebuilt?: boolean }>}
 */
export async function repairItem(actor, item, { skill, options = {} } = {}) {
  const destroyed = isDestroyed(item);
  if (!destroyed && !isBroken(item)) return { repaired: false, refusal: 'not-broken' };
  const dc = mundaneDifficulty({ floor: options.floor ?? getCurrentFloor() });
  const craft = repairCraftRef(item, dc);
  const { hours, rebuild } = repairModifiers(actor, skill, sanitizeCraftRef(craft));
  let ruleBreak = false;
  if (destroyed && !rebuild) {
    const res = await confirmRuleBreak({
      title: loc('COG.Repair.DestroyedTitle'),
      message: loc('COG.Repair.DestroyedMessage', { name: item.name }),
      options
    });
    if (!res.confirmed) return { repaired: false, refusal: res.refusal ?? 'cancelled' };
    ruleBreak = true;
  }
  const message = await actor.rollSkill(skill, { ...options, craft });
  // A declined roll dialog spends nothing: no hours, no Rule Break flag.
  if (!message) return { repaired: false, refusal: 'roll-declined', dc, ruleBreak };
  await decrementFloorTimer(hours, { actorUuid: actor.uuid });
  const total = Number(message?.flags?.[SYSTEM_ID]?.rollTotal ?? message?.rolls?.[0]?.total);
  const repaired = Number.isFinite(total) && total >= dc;
  if (repaired) {
    const gone = new Set([ITEM_STATE_TAGS.broken, ITEM_STATE_TAGS.destroyed]);
    await item.update({ 'system.tags': tagsOf(item).filter((t) => !gone.has(t)) });
  }
  if (ruleBreak) await markRuleBreak(item);
  return { repaired, dc, total, hours, ruleBreak, rebuilt: repaired && destroyed };
}

/** The identifier of the skill a Repair defaults to. */
const REPAIR_SKILL_IDENTIFIER = 'repair';


/**
 * The skills a Repair can be rolled with: the crawler's own skills, plus the catalog Repair skill as an untrained stand-in
 * when the crawler has none. `value` is the owned skill's id, or the identifier for a stand-in.
 * @param {Actor} actor
 * @returns {Array<{ value: string, label: string, skill: object, isDefault: boolean }>}
 */
export function repairSkillChoices(actor) {
  const owned = [...(actor?.items ?? [])].filter((i) => i?.type === 'skill');
  const choices = owned.map((skill) => ({
    value: skill.id, label: skill.name, skill, isDefault: skill.system?.identifier === REPAIR_SKILL_IDENTIFIER
  }));
  if (!choices.some((c) => c.isDefault)) {
    const stand = skillStandIn(actor, REPAIR_SKILL_IDENTIFIER);
    if (stand) choices.unshift({ value: REPAIR_SKILL_IDENTIFIER, label: stand.name, skill: stand, isDefault: true });
  }
  return choices;
}

/** Ask which skill rolls the Repair (a small select, `repair` selected). Returns the choice's `value`, or null when closed. */
async function askRepairSkill(item, choices) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  const fallback = (choices.find((c) => c.isDefault) ?? choices[0])?.value ?? null;
  if (typeof DialogV2?.wait !== 'function') return fallback;
  const options = choices.map((c) => `<option value="${escapeAttr(c.value)}"${c.isDefault ? ' selected' : ''}>${escapeAttr(c.label)}</option>`).join('');
  const picked = await DialogV2.wait({
    window: { title: loc('COG.Repair.DialogTitle') },
    content: `<div class="form-group"><label>${escapeAttr(loc('COG.Repair.PickSkill', { name: item.name }))}</label><select name="skill">${options}</select></div>`,
    buttons: [
      { action: 'repair', label: loc('COG.Repair.Button'), default: true, callback: (event, button) => button.form?.elements?.skill?.value ?? fallback },
      { action: 'cancel', label: loc('COG.Repair.Cancel') }
    ],
    rejectClose: false,
    modal: true
  });
  return picked && picked !== 'cancel' ? picked : null;
}

/**
 * The Repair action of the inventory row and the gear sheet: ask which skill rolls (the crawler's `repair` by default),
 * ask a Rule Break when that skill is an untrained stand-in, then `repairItem`.
 * @param {Actor} actor
 * @param {Item} item
 * @param {object} [options] passed to `repairItem` (and its Rule Break prompts)
 * @returns {Promise<object>} the `repairItem` result, or `{ repaired: false, refusal }`
 */
export async function startRepair(actor, item, options = {}) {
  if (!actor || !item) return { repaired: false, refusal: 'no-item' };
  if (!isBroken(item) && !isDestroyed(item)) return { repaired: false, refusal: 'not-broken' };
  const choices = repairSkillChoices(actor);
  if (!choices.length) return { repaired: false, refusal: 'no-skill' };
  const value = await askRepairSkill(item, choices);
  const choice = choices.find((c) => c.value === value);
  if (!choice) return { repaired: false, refusal: 'cancelled' };
  const { skill } = choice;
  // A crafter without the skill (a catalog stand-in) rolls untrained only as a Rule Break, as a craft does.
  let untrained = false;
  if (skill.isGranted === true && !(Number(skill.modifiedRank) > 0)) {
    const res = await confirmRuleBreak({
      title: loc('COG.Repair.UntrainedTitle'),
      message: loc('COG.Repair.UntrainedMessage', { skill: skill.name }),
      options
    });
    if (!res.confirmed) return { repaired: false, refusal: res.refusal ?? 'cancelled' };
    untrained = true;
  }
  const result = await repairItem(actor, item, { skill, options });
  // The untrained roll is a confirmed Rule Break too: record it on the item once the check was made.
  if (untrained && result.refusal !== 'roll-declined') await markRuleBreak(item);
  return { ...result, untrained, ruleBreak: result.ruleBreak === true || untrained };
}

/** The broken state of an item for a sheet: `{ brokenState: 'broken'|'destroyed'|'', brokenLabel }`. Destroyed wins. */
export function brokenStateOf(item) {
  const brokenState = isDestroyed(item) ? 'destroyed' : (isBroken(item) ? 'broken' : '');
  const brokenLabel = brokenState === 'destroyed' ? loc('COG.Repair.Destroyed') : (brokenState ? loc('COG.Repair.Broken') : '');
  return { brokenState, brokenLabel };
}
