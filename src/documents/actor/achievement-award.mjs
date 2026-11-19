/**
 * One award path. Every way a crawler is awarded an achievement calls `awardAchievement`: the Achievement
 * Manager, the Dungeon AI award console (`dispatchAIAward`), a hand-entered session loot event and Rapid Batch Import
 * (the last two through `recordLootBox({ award })`). It creates the trophy, applies favor and XP once, creates or stacks
 * the achievement's `system.rewardBoxes[]` as loot boxes on the crawler, and announces.
 *
 * Awards are the GM's call: a non-GM client warns and writes nothing, like the session ledger's GM-only writers
 * (`session-relay.mjs`). Players never reach this module, so there is no relay action for it.
 *
 * Boxes are entries of the crawler's `system.lootBoxes[]` (`loot-box-entries.mjs`), never items, and only a crawler holds
 * them: a grant to another actor warns the GM and writes no box. They stack: a grant adds to a held box with the same
 * identifier, tier, template, contents and `whenEmpty`, and otherwise adds a new entry. A template whose theme is off still
 * makes its box (Question 6 (c)): boxes never become Celestial AI Poop. A second award of the same (non-repeatable) achievement asks a Rule Break and records it on the
 * trophy (`flags.sprinter-rpg.rewardBoxesGranted = { at, by, ruleBreak }`), as `grantStartingItems` does.
 * Does not import `actor.mjs`.
 */
import { readFlag, writeFlag, withFlags } from '../../utils/flags.mjs';
import { resolveGrantDocument } from '../../data/race-class-grants.mjs';
import { sanitizeRewardBoxes } from '../../data/loot-box-rows.mjs';
import { lootBoxTierDef } from '../../data/loot-box-tiers.mjs';
import { isLootBoxType } from '../../models/items/loot-model.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { landItems } from '../../utils/content-source.mjs';
import { addAiFavor } from '../../chat/actions/ai-favor-tally.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { addLootBoxes, canHoldLootBoxes, entryFromRow, lootBoxName } from './loot-box-entries.mjs';

export { lootBoxName };

/** The flag on a trophy whose reward boxes were granted. */
const REWARD_BOXES_FLAG = 'rewardBoxesGranted';

/** `{ at, by, ruleBreak }` on a trophy whose reward boxes were granted (undefined when they were not). */
export const rewardBoxesGrantedOf = (trophy) => readFlag(trophy, REWARD_BOXES_FLAG);

/** Record on a trophy that its reward boxes were granted. */
export const markRewardBoxesGranted = (trophy, ruleBreak) => writeFlag(trophy, REWARD_BOXES_FLAG, rewardBoxesRecord(ruleBreak));

const rewardBoxesRecord = (ruleBreak) => ({ at: Date.now(), by: globalThis.game?.user?.id ?? '', ruleBreak });

const TEXT = Object.freeze({
  'COG.Award.RepeatTitle': 'Already Awarded',
  'COG.Award.RepeatMessage': '{actor} already received {name}. Award it again as a Rule Break?',
  'COG.Award.TemplateMissing': 'The box template "{name}" was not found or is not a loot box, so a generic {tier} Loot Box was made.',
  'COG.Award.GmOnly': 'Only the GM can award achievements.',
  'COG.LootBoxHeld.NotCrawler': 'Only crawlers hold loot boxes, so {name} was given no box.'
});

/** Localized award text, with the English default when the key is not loaded (tests, early load). */
const awardText = langText(TEXT);

/** Items as an array: an embedded collection or a plain list. */
const asArray = (items) => Array.from(items ?? []);

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
 * Add or stack the boxes for `rewardBoxes` rows on a crawler, in one write. Another actor type holds no box: the GM is
 * warned and nothing is written.
 * @param {Actor} actor
 * @param {object[]} rows `rewardBoxes` rows (sanitized here)
 * @param {{ sourceName?: string }} [options]
 * @returns {Promise<object[]>} the entries added or stacked onto (plain data)
 */
export async function grantLootBoxes(actor, rows, { sourceName = '' } = {}) {
  const clean = sanitizeRewardBoxes(rows ?? []);
  if (!actor || !clean.length) return [];
  if (!canHoldLootBoxes(actor)) {
    warn(awardText('COG.LootBoxHeld.NotCrawler', { name: actor.name ?? '' }));
    return [];
  }
  const entries = [];
  for (const row of clean) entries.push(entryFromRow(row, await templateFor(row), { sourceName }));
  return addLootBoxes(actor, entries);
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
 * @returns {Promise<{ item: Item|null, boxes: object[], declined?: boolean }|null>} null on a non-GM client; `boxes` the
 *   held box entries added or stacked onto
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
    const previous = asArray(actor.items).find((i) => i.type === 'achievement' && i.name === name && rewardBoxesGrantedOf(i));
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

  const baseData = {
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
  const itemData = rows.length ? withFlags(baseData, { [REWARD_BOXES_FLAG]: rewardBoxesRecord(brokeRule) }) : baseData;

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
