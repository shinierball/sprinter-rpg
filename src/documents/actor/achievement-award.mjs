/**
 * One award path. Every way a crawler is awarded an achievement calls `awardAchievement`: the Achievement
 * Manager, the Dungeon AI award console (`dispatchAIAward`), a hand-entered session loot event and Rapid Batch Import
 * (the last two through `recordLootBox({ award })`). It creates the trophy, applies favor and XP once, creates or stacks
 * the achievement's `system.rewardBoxes[]` as loot boxes on the crawler, and announces.
 *
 * Awards are the GM's call: a non-GM client warns and writes nothing, like the session ledger's GM-only writers
 * (`session-relay.mjs`). Players never reach this module, so there is no relay action for it.
 *
 * Boxes stack: a grant adds to an unopened box with the same identifier, tier, template and contents, and otherwise
 * creates a new item. A second award of the same (non-repeatable) achievement asks a Rule Break and records it on the
 * trophy (`flags.sprinter-rpg.rewardBoxesGranted = { at, by, ruleBreak }`), as `grantStartingItems` does.
 * Does not import `actor.mjs`.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { buildPayload } from '../../data/builders/item-payload.mjs';
import { resolveGrantDocument } from '../../data/race-class-grants.mjs';
import { sanitizeRewardBoxes } from '../../data/loot-box-rows.mjs';
import { DEFAULT_LOOT_BOX_IMG, lootBoxTierDef, resolveLootBoxTier } from '../../data/loot-box-tiers.mjs';
import { LOOT_BOX_LOOT_TYPE, isLootBoxType } from '../../models/items/loot-model.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { landItems } from '../../utils/content-source.mjs';
import { addAiFavor } from '../../chat/actions/ai-favor-tally.mjs';

/** The flag on a trophy whose reward boxes were granted. */
export const REWARD_BOXES_FLAG = 'rewardBoxesGranted';
/** The flag on a box made from a template: the template's uuid, so copies of one template stack. */
const BOX_TEMPLATE_FLAG = 'boxTemplate';

const TEXT = Object.freeze({
  'COG.Award.BoxName': '{tier} Loot Box',
  'COG.Award.RepeatTitle': 'Already Awarded',
  'COG.Award.RepeatMessage': '{actor} already received {name}. Award it again as a Rule Break?',
  'COG.Award.TemplateMissing': 'The box template "{name}" was not found or is not a loot box, so a generic {tier} Loot Box was made.',
  'COG.Award.GmOnly': 'Only the GM can award achievements.'
});

/** Localized award text, with the English default when the key is not loaded (tests, early load). */
function awardText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return (TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

/** "<Tier label> Loot Box" for a tier id, from the registry. */
export function lootBoxName(tier) {
  return awardText('COG.Award.BoxName', { tier: lootBoxTierDef(tier).label });
}

/** Items as an array: an embedded collection or a plain list. */
const asArray = (items) => Array.from(items ?? []);

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

const templateKeyOf = (data) => data?.flags?.[SYSTEM_ID]?.[BOX_TEMPLATE_FLAG] ?? '';

/**
 * Pure: the create data for one reward-box row. With no template it is the generic tier box, built through
 * `buildPayload('loot', ...)`; with a template (a plain object from a box document) it is a copy of it.
 * @param {{ tier?: *, quantity?: number, uuid?: string }} row a `rewardBoxes` row
 * @param {object|null} [template] the template box as plain data, or null
 * @returns {object} item create data
 */
export function lootBoxDataFor(row, template = null) {
  const [clean] = sanitizeRewardBoxes([row ?? {}]);
  const quantity = clean.quantity;
  if (template && typeof template === 'object') {
    const data = structuredClone(template);
    delete data._id;
    delete data.id;
    delete data.folder;
    delete data.ownership;
    delete data.sort;
    data.system = data.system ?? {};
    data.system.quantity = quantity;
    data.system.box = data.system.box ?? {};
    data.system.box.tier = resolveLootBoxTier(data.system.box.tier || clean.tier);
    const key = clean.uuid || template.uuid || '';
    if (key) {
      data.flags = data.flags ?? {};
      data.flags[SYSTEM_ID] = { ...(data.flags[SYSTEM_ID] ?? {}), [BOX_TEMPLATE_FLAG]: key };
    }
    return data;
  }
  const tier = clean.tier;
  const def = lootBoxTierDef(tier);
  return buildPayload('loot', {
    name: lootBoxName(tier),
    img: def.img || DEFAULT_LOOT_BOX_IMG,
    system: {
      identifier: `loot-box-${tier}`,
      lootType: LOOT_BOX_LOOT_TYPE,
      quantity,
      box: { tier, contents: [] }
    }
  }, { warnings: [] });
}

/**
 * Pure: the unopened box among `actorItems` that `data` stacks onto (same identifier, tier, template and contents),
 * or null. A box the GM edited on the crawler no longer matches, so it stays separate.
 * @param {Iterable<object>|object[]} actorItems
 * @param {object} data a box's create data (see `lootBoxDataFor`)
 */
export function findBoxStack(actorItems, data) {
  const sys = data?.system ?? {};
  const identifier = sys.identifier ?? '';
  const tier = resolveLootBoxTier(sys.box?.tier);
  const key = templateKeyOf(data);
  const contents = sys.box?.contents ?? [];
  return asArray(actorItems).find((item) => {
    if (item?.type !== 'loot' || !isLootBoxType(item.system?.lootType) || item.system?.used) return false;
    if ((item.system?.identifier ?? '') !== identifier) return false;
    if (resolveLootBoxTier(item.system?.box?.tier) !== tier) return false;
    if (templateKeyOf(item) !== key) return false;
    const have = item.system?.box?.contents ?? [];
    return deepEqual(JSON.parse(JSON.stringify(have)), JSON.parse(JSON.stringify(contents)));
  }) ?? null;
}

function warn(message) {
  console.warn(`Sprinter RPG | ${message}`);
  globalThis.ui?.notifications?.warn?.(message);
}

/** The template a row points at as plain data, or null (with a warning) when it does not resolve to a loot box. */
async function templateFor(row) {
  if (!row.uuid && !row.identifier) return null;
  const doc = await resolveGrantDocument({ uuid: row.uuid, identifier: row.identifier }, 'loot');
  const plain = doc && typeof doc.toObject === 'function' ? doc.toObject() : (doc ? structuredClone(doc) : null);
  if (plain && isLootBoxType(plain.system?.lootType)) {
    plain.uuid = doc.uuid ?? plain.uuid ?? row.uuid;
    return plain;
  }
  warn(awardText('COG.Award.TemplateMissing', { name: row.name || row.uuid || row.identifier, tier: lootBoxTierDef(row.tier).label }));
  return null;
}

/**
 * Create or stack the box items for `rewardBoxes` rows on `actor`.
 * @param {Actor} actor
 * @param {object[]} rows `rewardBoxes` rows (sanitized here)
 * @param {{ sourceName?: string }} [options]
 * @returns {Promise<Item[]>} the created and the stacked-onto box items
 */
export async function grantLootBoxes(actor, rows, { sourceName = '' } = {}) {
  const clean = sanitizeRewardBoxes(rows ?? []);
  if (!actor || !clean.length) return [];
  const pending = [];
  const stacks = new Map();
  for (const row of clean) {
    const data = lootBoxDataFor(row, await templateFor(row));
    if (sourceName) {
      data.flags = data.flags ?? {};
      data.flags[SYSTEM_ID] = { ...(data.flags[SYSTEM_ID] ?? {}), awardedBy: sourceName };
    }
    const inBatch = pending.find((p) => findBoxStack([p], data));
    if (inBatch) {
      inBatch.system.quantity += data.system.quantity;
      continue;
    }
    const existing = findBoxStack(actor.items, data);
    if (existing) {
      const entry = stacks.get(existing.id) ?? { item: existing, quantity: Number(existing.system.quantity) || 0 };
      entry.quantity += data.system.quantity;
      stacks.set(existing.id, entry);
      continue;
    }
    pending.push(data);
  }
  const touched = [];
  for (const { item, quantity } of stacks.values()) {
    await item.update({ 'system.quantity': quantity });
    touched.push(item);
  }
  if (pending.length) touched.push(...await actor.createEmbeddedDocuments('Item', landItems(pending)));
  return touched;
}

/**
 * Create the trophy, apply favor and XP, grant its reward boxes, announce. GM-side.
 * @param {Actor} actor the crawler
 * @param {object} data trophy create data `{ name, img?, system: { tier, quote, reward, rewardContents, favor, xp, floor, session, description, rewardBoxes } }`
 * @param {object} [options]
 * @param {boolean} [options.announce=true] post the achievement chat card
 * @param {boolean} [options.repeatable=false] true for awards that legitimately repeat (an AI dispatch, a session loot event); a non-repeatable second grant of the same achievement asks a Rule Break
 * @param {boolean} [options.ruleBreak] already confirmed by the caller
 * @param {boolean} [options.interactive] false refuses a Rule Break instead of asking
 * @returns {Promise<{ item: Item|null, boxes: Item[], declined?: boolean }|null>} null on a non-GM client
 */
export async function awardAchievement(actor, data, { announce = true, repeatable = false, ruleBreak = false, interactive } = {}) {
  if (!actor) return null;
  if (globalThis.game?.user && !globalThis.game.user.isGM) {
    globalThis.ui?.notifications?.warn?.(awardText('COG.Award.GmOnly'));
    return null;
  }
  const src = data?.system ?? {};
  const rows = sanitizeRewardBoxes(src.rewardBoxes ?? []);
  const name = data?.name || 'Achievement';
  const favor = Number(src.favor) || 0;
  const xp = Number(src.xp) || 0;

  let brokeRule = Boolean(ruleBreak);
  if (!repeatable && rows.length && !brokeRule) {
    const previous = asArray(actor.items).find((i) => i.type === 'achievement' && i.name === name && i.flags?.[SYSTEM_ID]?.[REWARD_BOXES_FLAG]);
    if (previous) {
      const res = await confirmRuleBreak({
        title: awardText('COG.Award.RepeatTitle'),
        message: awardText('COG.Award.RepeatMessage', { actor: actor.name, name }),
        options: { interactive }
      });
      if (!res.confirmed) return { item: null, boxes: [], declined: true };
      brokeRule = true;
    }
  }

  const itemData = {
    name,
    type: 'achievement',
    img: data?.img || 'icons/svg/upgrade.svg',
    system: {
      quote: src.quote || '',
      reward: src.reward || 'Special Recognition',
      rewardContents: src.rewardContents || '',
      tier: src.tier || 'bronze',
      floor: src.floor || actor.system?.details?.floor || 'Floor 1',
      dateEarned: src.dateEarned || new Date().toLocaleDateString(),
      session: src.session || '',
      favor,
      xp,
      description: src.description || '',
      rewardBoxes: rows
    },
    flags: { ...(data?.flags ?? {}) }
  };
  if (rows.length) {
    itemData.flags[SYSTEM_ID] = {
      ...(itemData.flags[SYSTEM_ID] ?? {}),
      [REWARD_BOXES_FLAG]: { at: Date.now(), by: globalThis.game?.user?.id ?? '', ruleBreak: brokeRule }
    };
  }

  const created = await actor.createEmbeddedDocuments('Item', landItems([itemData]));
  const item = created?.[0] ?? null;

  if (favor !== 0) await addAiFavor(actor, favor, name, { ruleBreak: brokeRule, interactive });
  if (xp > 0) {
    const current = Number(actor.system?.details?.xp?.value) || 0;
    await actor.update({ 'system.details.xp.value': current + xp });
  }
  const boxes = await grantLootBoxes(actor, rows, { sourceName: name });

  if (announce && item && typeof actor.announceAchievement === 'function') await actor.announceAchievement(item);
  return { item, boxes };
}
