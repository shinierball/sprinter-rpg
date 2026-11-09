/**
 * "What this does" for any item.
 *
 * `describeItem(item, { actor, rank })` returns ordered, read-only `FeatureLine[]` (the same shape the race/class
 * "What this grants" block renders). It reads only structured fields, never names, descriptions or notes, and
 * stores nothing on documents. The work is split into blocks keyed by what they describe (grants, rows, attack
 * mechanics, ...), not by item type; a block says whether it `applies` to an item and returns its lines. Lines are
 * grouped by `ITEM_SUMMARY_GROUPS` (race/class order unchanged), and keep registry order inside a group.
 *
 * Block sources: the `DESCRIBERS` of `feature-describer.mjs` (wrapped unchanged), `describeAttackMechanics`
 * (`attack-lines.mjs`) and the three block files owned by the S2 steps.
 */
import { DESCRIBERS } from './feature-describer.mjs';
import { describeAttackLines } from './attack-lines.mjs';
import { ITEM_SUMMARY_GROUPS, t, itemLine, defineItemSummaryTemplates } from './shared.mjs';
import { BLOCKS as SPELL_SKILL_BLOCKS } from './blocks-spell-skill.mjs';
import { BLOCKS as GEAR_LOOT_BLOCKS } from './blocks-gear-loot.mjs';
import { BLOCKS as EFFECT_BLOCKS } from './blocks-effects.mjs';
import { BLOCKS as IDENTITY_BLOCKS } from './blocks-identity.mjs';
import { BLOCKS as CRAFTING_BLOCKS } from './blocks-crafting.mjs';

export { ITEM_SUMMARY_BADGES, ITEM_SUMMARY_KINDS, ITEM_SUMMARY_GROUPS, itemSummaryTemplates, defineItemSummaryTemplates } from './shared.mjs';

/** Block ids for the wrapped `DESCRIBERS`, in the same order as that list. */
const WRAPPED_IDS = Object.freeze([
  'grants-stat', 'stat-caps', 'grants-skill', 'defense', 'rows-damage', 'rows-attack', 'rows-check', 'rows-craft', 'rows-vehicle', 'rows-mana',
  'rows-recovery', 'rows-substitution', 'rows-popularity', 'rows-ai-favor', 'movement', 'senses', 'requires',
  'starting-items', 'descriptive-tags'
]);

const wrapped = DESCRIBERS.map((d, i) => ({ id: WRAPPED_IDS[i], group: d.group, applies: () => true, describe: d.describe }));

const attackBlock = {
  id: 'attack-mechanics',
  group: 'effect',
  applies: (item) => item?.type === 'attack' || item?.type === 'gear',
  describe: (item) => describeAttackLines(item)
};

const GRANTED_EFFECT_KEYS = Object.freeze({ buff: 'COG.ItemSummary.Identity.GrantedBuff', debuff: 'COG.ItemSummary.Identity.GrantedDebuff' });

defineItemSummaryTemplates({
  [GRANTED_EFFECT_KEYS.buff]: 'Grants buff: {name}',
  [GRANTED_EFFECT_KEYS.debuff]: 'Grants debuff: {name}'
});

/** The buffs and debuffs a race or class grants: one line each, the entry's own summary as its rule text. */
const grantedEffectsBlock = {
  id: 'granted-effects',
  group: 'other',
  applies: (item) => item?.type === 'race' || item?.type === 'class',
  async describe(item) {
    const entries = Array.isArray(item?.system?.grantedEffects) ? item.system.grantedEffects : [];
    const lines = [];
    for (const entry of entries) {
      const key = GRANTED_EFFECT_KEYS[entry?.type];
      const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
      if (!key || !name) continue;
      lines.push(itemLine('mod', t(key, { name }), 'system.grantedEffects', summaryText(await describeItem(entry))));
    }
    return lines;
  }
};

/** Every block, in registry order. */
export const ITEM_SUMMARY_BLOCKS = Object.freeze([
  ...wrapped, attackBlock, grantedEffectsBlock, ...SPELL_SKILL_BLOCKS, ...GEAR_LOOT_BLOCKS, ...EFFECT_BLOCKS, ...IDENTITY_BLOCKS, ...CRAFTING_BLOCKS
]);

/** The ids of all blocks. */
export const ITEM_SUMMARY_BLOCK_IDS = Object.freeze(ITEM_SUMMARY_BLOCKS.map((b) => b.id));

/**
 * Describe what an item does as ordered, read-only lines. Returns `[]` for an item with nothing structured to say
 * (see `emptyLine` for the muted line a sheet may show) and for input that is not an item.
 * @param {object} item
 * @param {{ actor?: object|null, rank?: number }} [opts] `actor` defaults to the item's parent when that is an Actor
 * @returns {Promise<import('./shared.mjs').FeatureLine[]>}
 */
export async function describeItem(item, opts = {}) {
  return describeWithBlocks(item, opts, ITEM_SUMMARY_BLOCKS);
}

/** `describeItem` over a given block list (the seam the tests use to probe the context a block receives). */
export async function describeWithBlocks(item, { actor, rank } = {}, blocks = ITEM_SUMMARY_BLOCKS) {
  if (!item || typeof item !== 'object') return [];
  const parent = item.parent;
  const isActor = parent && typeof parent === 'object'
    && (parent.documentName === 'Actor' || (typeof Actor === 'function' && parent instanceof Actor));
  const owner = actor ?? (isActor ? parent : null);
  const ctx = { actor: owner, rank };
  const buckets = new Map(ITEM_SUMMARY_GROUPS.map((g) => [g, []]));
  for (const block of blocks) {
    let lines;
    try {
      if (!block.applies(item, ctx)) continue;
      lines = await block.describe(item, ctx);
    } catch (err) {
      console.warn(`sprinter-rpg | item summary block "${block.id}" failed`, err);
      continue;
    }
    const bucket = buckets.get(block.group) ?? buckets.get('other');
    const group = buckets.has(block.group) ? block.group : 'other';
    for (const l of Array.isArray(lines) ? lines : []) if (l && typeof l.text === 'string' && l.text) bucket.push({ ...l, group });
  }
  return ITEM_SUMMARY_GROUPS.flatMap((g) => buckets.get(g));
}

/** The lines of the given groups (`line.group`, the block group the line came from), in order. */
export function linesInGroups(lines, groups) {
  const wanted = new Set(groups);
  return Array.isArray(lines) ? lines.filter((l) => wanted.has(l?.group)) : [];
}

/** The lines' text joined with " • " for compact lists (crawler rows, item manager, PDF); '' for none. */
export function summaryText(lines) {
  if (!Array.isArray(lines)) return '';
  return lines.map((l) => (typeof l?.text === 'string' ? l.text.trim() : '')).filter(Boolean).join(' • ');
}

const escapeHtml = (v) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * The lines as the HTML of a Foundry tooltip (`data-tooltip`, which Foundry sets as HTML): one escaped line per row,
 * joined with `<br>`. '' for none. Put it in the attribute through Handlebars `{{ }}`, which escapes it once more.
 */
export function summaryTooltip(lines) {
  if (!Array.isArray(lines)) return '';
  return lines.map((l) => (typeof l?.text === 'string' ? l.text.trim() : '')).filter(Boolean).map(escapeHtml).join('<br>');
}

/** The muted line shown for an item with no structured effects (plan D6). Built from the empty result, never from text. */
export function emptyLine() {
  return { text: t('COG.ItemSummary.Empty'), generated: t('COG.ItemSummary.Empty'), kind: 'tag', badge: '', rowPath: '', ruleText: '' };
}
