/**
 * Misc. Junk (3.15 S3). Junk is the loot tagged `material.misc_junk` that used-up consumables leave behind. A point of it is
 * one unit. `planJunkSpend` (craft-materials) decides which stacks pay; this module asks a Rule Break when the crawler has
 * fewer points than needed, then lowers the stacks. "Pull out a common item" turns one point into a plain named loot item.
 */
import { confirmRuleBreak, withRuleBreak } from '../../utils/rule-break.mjs';
import { planJunkSpend, junkPoints } from '../../utils/crafting/craft-materials.mjs';
import { buildPayload } from '../../data/builders/item-payload.mjs';

/**
 * Work out a spend and ask the Rule Break when the actor is short; nothing is written.
 * @param {object} actor
 * @param {number} n points to spend
 * @param {{ ruleBreak?: boolean, interactive?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, plan: Array<object>, missing: number }>}
 */
async function reserveJunk(actor, n, options = {}) {
  const items = [...(actor?.items ?? [])];
  const { plan, missing } = planJunkSpend(items, n);
  if (missing <= 0) return { ok: true, ruleBreak: false, plan, missing: 0 };
  const res = await confirmRuleBreak({
    title: 'Not Enough Misc. Junk',
    message: `That takes ${n} Misc. Junk; ${actor?.name ?? 'the crawler'} has ${junkPoints(items)}. Proceed anyway as a Rule Break?`,
    options: { ruleBreak: options.ruleBreak === true, interactive: options.interactive }
  });
  if (!res.confirmed) return { ok: false, ruleBreak: false, plan, missing };
  return { ok: true, ruleBreak: true, plan, missing };
}

/** Lower the stacks of a plan; a stack at zero is deleted. */
export async function applyJunkPlan(actor, plan) {
  for (const { itemId, quantity } of plan) {
    const item = actor.items.get(itemId);
    if (!item) continue;
    const left = (Number(item.system?.quantity) || 0) - quantity;
    if (left > 0) await item.update({ 'system.quantity': left });
    else await item.delete();
  }
}

/** Ask what the common item is called; null when cancelled or empty. */
async function promptItemName() {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt !== 'function') return null;
  const i18n = globalThis.game?.i18n;
  const loc = (key) => i18n?.localize?.(key) ?? key;
  const result = await DialogV2.prompt({
    window: { title: loc('COG.PullOut.DialogTitle') },
    content: `<label>${loc('COG.PullOut.NameLabel')} <input type="text" name="name" autofocus></label>`,
    ok: { label: loc('COG.PullOut.Confirm'), callback: (_event, button) => String(button?.form?.elements?.name?.value ?? '').trim() },
    rejectClose: false,
    modal: true
  });
  return typeof result === 'string' && result ? result : null;
}

/**
 * Pull out a common item: spend 1 Misc. Junk and create a plain loot item with the given name and no effect. With no junk
 * it asks a Rule Break first. The item is created before the junk is spent, so a failure never loses the junk.
 * @param {object} actor
 * @param {{ name?: string, ruleBreak?: boolean, interactive?: boolean }} [options] `name` skips the name prompt
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, item?: object }>}
 */
export async function pullOutCommonItem(actor, options = {}) {
  const name = String(options.name ?? '').trim() || await promptItemName();
  if (!name) return { ok: false, ruleBreak: false };
  const reserved = await reserveJunk(actor, 1, options);
  if (!reserved.ok) return { ok: false, ruleBreak: false };
  const payload = buildPayload('loot', {
    name,
    system: { lootType: 'crafting', quantity: 1, outcomes: [] }
  }, { warnings: [] });
  if (reserved.ruleBreak) payload.flags = withRuleBreak(payload).flags;
  const [item] = await actor.createEmbeddedDocuments('Item', [payload]);
  await applyJunkPlan(actor, reserved.plan);
  return { ok: true, ruleBreak: reserved.ruleBreak, item };
}
