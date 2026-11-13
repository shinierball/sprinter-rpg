/**
 * "What this does" on chat cards: the `describeItem` lines of an item, and of the buffs and debuffs a card
 * names, as one closed `<details>` section frozen into `message.content` at send time. A card lists the `rowPath`s it
 * already prints (`CARD_PROFILES`) and those lines are dropped, so the section only says what the card does not.
 *
 * Writes nothing to any document, and never rejects: a summary can never stop a card from posting (CONTRIBUTING rule 2).
 * The describer is imported on first use, not at load: it reaches `spell-cast.mjs` and the actor modules, which import the
 * documents that import this file, so a static import runs `item-describer/index.mjs` before its own blocks have loaded.
 * `CARD_PROFILES` is plain data for the same reason.
 */
import { t } from './shared.mjs';
import { escapeAttr } from '../escape-attr.mjs';
import { findConditionEntry } from '../../content/catalog-lookup.mjs';
import { conditionItemData, conditionLabel } from '../../documents/actor/condition-data.mjs';
import { GM_ACTOR_TYPES } from '../document-types.mjs';

/** The describer, loaded on first use (see the file header). */
const describer = () => import('./index.mjs');

/** Owner types whose items never get an item summary (417); the effects they land still do (423). */
const SKIP_OWNER_TYPES = GM_ACTOR_TYPES;

const PASSIVE_SKILL = Object.freeze(['system.stat', 'system.rank', 'system.boonBonus', 'system.checkType', 'system.tags']);

/**
 * The rowPaths each card already prints. Exact match; a trailing `.*` matches children. `system.rankCeiling` is not
 * listed: the describer puts the ceiling on the `system.rank` line, so no line has that rowPath.
 */
export const CARD_PROFILES = Object.freeze({
  cast: Object.freeze([
    'system.stat', 'system.rank', 'system.checkType', 'system.aiFavor', 'system.manaCost',
    'system.baseDamage', 'system.durationConfig', 'system.cooldown', 'system.tags'
  ]),
  castHeal: Object.freeze(['system.healing', 'system.healing.*']),
  castTempBars: Object.freeze(['system.tempBars']),
  use: Object.freeze([
    'system.lootType', 'system.executionMode', 'system.hasActivatedAbility', 'system.charges', 'system.cooldown',
    'system.outcomes.*', 'system.slot', 'system.wieldMode', 'system.toHitStat', 'system.baseDamage',
    'system.critMultiplier', 'system.isWeapon', 'system.tags'
  ]),
  passiveSkill: Object.freeze([...PASSIVE_SKILL]),
  auraSkill: Object.freeze([...PASSIVE_SKILL, 'system.area', 'system.area.targetFilter', 'system.durationConfig']),
  effect: Object.freeze(['system.tags'])
});

/** Every line dropped: only effect groups show. For cards that name an effect and print nothing of the item. */
export const OMIT_ALL = Object.freeze(['*']);

function omitted(rowPath, omit) {
  if (omit.includes('*')) return true;
  return omit.some((p) => (p.endsWith('.*') ? rowPath.startsWith(p.slice(0, -1)) : rowPath === p));
}

/**
 * Pure: the lines whose rowPath is not listed. A line with no rowPath is kept.
 * @param {object[]} lines
 * @param {string[]} omit
 * @returns {object[]}
 */
export function filterCardLines(lines, omit) {
  if (!Array.isArray(lines)) return [];
  const list = Array.isArray(omit) ? omit.filter((p) => typeof p === 'string') : [];
  return lines.filter((l) => {
    const path = typeof l?.rowPath === 'string' ? l.rowPath : '';
    return !path || !omitted(path, list);
  });
}


const hasText = (l) => Boolean(l) && typeof l.text === 'string' && l.text !== '';

function listHtml(lines) {
  const items = lines.map((l) => {
    const tip = typeof l.ruleText === 'string' && l.ruleText.trim() ? ` data-tooltip="${escapeAttr(l.ruleText)}"` : '';
    // The same badge as the sheet's feature list (templates/items/parts/feature-list.hbs)
    const badge = typeof l.badge === 'string' && l.badge.trim()
      ? `<span class="cog-badge cog-feature-badge cog-feature-badge-${escapeAttr(l.kind)}">[${escapeAttr(l.badge)}]</span> ` : '';
    return `<li class="cog-feature-line"${tip}>${badge}<span class="cog-feature-text">${escapeAttr(l.text)}</span></li>`;
  });
  return `<ul class="cog-feature-list">${items.join('')}</ul>`;
}

/**
 * Pure and synchronous: `[{ heading?, lines }]` to the `<details>` HTML; '' for no lines.
 * @param {Array<{ heading?: string, lines: object[] }>} groups
 * @returns {string}
 */
export function cardSummaryHtml(groups) {
  const usable = (Array.isArray(groups) ? groups : []).filter((g) => Array.isArray(g?.lines) && g.lines.some(hasText));
  if (!usable.length) return '';
  const body = usable.map((g) => {
    const heading = typeof g.heading === 'string' && g.heading.trim() ? `<div class="cog-card-summary-heading">${escapeAttr(g.heading)}</div>` : '';
    return heading + listHtml(g.lines.filter(hasText));
  }).join('');
  return `<details class="cog-card-summary"><summary><i class="fa-solid fa-circle-info"></i> ${escapeAttr(t('COG.ItemSummary.Heading'))}</summary>${body}</details>`;
}

/** The item data a buff or debuff reference lands as (as `applyCondition` and `crawlerApplyBuff` resolve it), or null. */
function resolveEffect(kind, ref) {
  const id = typeof ref === 'string' ? ref.trim() : '';
  if (!id) return null;
  if (kind === 'debuffs') return conditionItemData(id, { requireKnown: true });
  const entry = findConditionEntry('buffs', id);
  return entry ? { type: 'buff', ...entry } : null;
}

/** The effect's rules: `{ heading, lines }` with the card-irrelevant lines dropped; null when it has no rules text. */
async function effectGroup(kind, ref) {
  const data = resolveEffect(kind, ref);
  if (!data) return null;
  const { describeItem } = await describer();
  const lines = filterCardLines(await describeItem(data), CARD_PROFILES.effect);
  return lines.length ? { heading: String(data.name ?? ''), lines } : null;
}

/**
 * The section's HTML, frozen at send time. '' when there is nothing to say, for a mob or NPC owner's item lines, and on
 * any error. Effect groups come first (what just happened), then the item's own lines.
 * @param {object} item
 * @param {string[]} omit from CARD_PROFILES
 * @param {{ actor?: object|null, effects?: Array<{ kind: 'buffs'|'debuffs', ref: string }> }} [opts] the effects this card names
 * @returns {Promise<string>}
 */
export async function cardSummary(item, omit, opts = {}) {
  try {
    const groups = [];
    const seen = new Set();
    for (const effect of Array.isArray(opts?.effects) ? opts.effects : []) {
      const key = `${effect?.kind}:${effect?.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const group = await effectGroup(effect?.kind, effect?.ref);
      if (group) groups.push(group);
    }
    const owner = opts?.actor ?? item?.parent ?? null;
    // OMIT_ALL prints nothing of the item, so it is not described at all (the describer reads the live targets)
    if (item && !omit?.includes?.('*') && !SKIP_OWNER_TYPES.includes(owner?.type)) {
      const actor = opts?.actor ?? (owner?.documentName === 'Actor' ? owner : undefined);
      const { describeItem } = await describer();
      const lines = filterCardLines(await describeItem(item, { actor }), omit);
      if (lines.length) groups.push({ lines });
    }
    return cardSummaryHtml(groups);
  } catch (err) {
    console.warn('sprinter-rpg | card summary failed', err);
    return '';
  }
}

/**
 * One plain line for the damage card's list: `Inflicted {name}: {summary}`, or `Inflicted {name}` with no rules text.
 * @param {string} ref a debuff reference
 * @returns {Promise<string>}
 */
export async function appliedEffectLine(ref) {
  let name = '';
  let rules = '';
  try {
    const data = resolveEffect('debuffs', ref);
    name = String(data?.name ?? '');
    if (data) {
      const { describeItem, summaryText } = await describer();
      rules = summaryText(filterCardLines(await describeItem(data), CARD_PROFILES.effect));
    }
  } catch (err) {
    console.warn('sprinter-rpg | applied effect line failed', err);
  }
  if (!name) name = String(conditionLabel(ref) ?? ref ?? '');
  return rules ? `Inflicted ${name}: ${rules}` : `Inflicted ${name}`;
}
