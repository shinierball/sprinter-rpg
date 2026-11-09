/**
 * Item summary blocks for what a race, class or skill is: its Rank source (a Floor-ranked skill), its archetypes and
 * a race's size and size by level. Text goes under `COG.ItemSummary.Identity` in lang/en.json and is registered with
 * `defineItemSummaryTemplates`. Nothing here reads names, descriptions or notes.
 */
import { itemLine, t, defineItemSummaryTemplates, humanizeId } from './shared.mjs';
import { isFloorRanked } from '../skill/rank-source.mjs';
import { sanitizeSizeId, sizeText } from '../../data/sizes.mjs';
import { ARCHETYPE_TO_TAG } from '../../data/tag-vocabulary.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';

const K = 'COG.ItemSummary.Identity.';

defineItemSummaryTemplates({
  [`${K}RankFloor`]: 'Rank follows the current Floor',
  [`${K}Archetype`]: 'Archetype: {list}',
  [`${K}Size`]: 'Size: {size}',
  [`${K}SizeByLevel`]: 'Size by level: {stages}',
  [`${K}SizeStage`]: '{size} from level {level}'
});

const sysOf = (item) => (item?.system && typeof item.system === 'object' ? item.system : {});

/** The archetype tag for a stored archetype (`mage`, `archetype.mage`), the same way `computeDerivedTags` reads it. */
function archetypeTag(raw) {
  const key = String(raw ?? '').replace(/^archetype\./, '').toLowerCase().trim();
  if (!key) return '';
  return ARCHETYPE_TO_TAG[key] ?? (String(raw).trim().startsWith('archetype.') ? String(raw).trim() : '');
}

const rankFloor = {
  id: 'rank-source',
  group: 'skill',
  applies: (item) => item?.type === 'skill' && isFloorRanked(item),
  describe: () => [itemLine('skill', t(`${K}RankFloor`), 'system.rankSource')]
};

const archetypes = {
  id: 'archetypes',
  group: 'other',
  applies: (item) => item?.type === 'race' || item?.type === 'class',
  describe(item) {
    const list = Array.isArray(sysOf(item).archetypes) ? sysOf(item).archetypes : [];
    const names = [];
    for (const a of list) {
      const tag = archetypeTag(a);
      if (!tag) continue;
      const name = getTagDefinition(tag)?.label || humanizeId(tag.replace(/^archetype\./, ''));
      if (!names.includes(name)) names.push(name);
    }
    return names.length ? [itemLine('tag', t(`${K}Archetype`, { list: names.join(', ') }), 'system.archetypes')] : [];
  }
};

const raceSize = {
  id: 'race-size',
  group: 'other',
  applies: (item) => item?.type === 'race',
  describe(item) {
    const s = sysOf(item);
    const lines = [];
    const size = sanitizeSizeId(s.size); // blank: no change, so no line (never looked up)
    if (size) lines.push(itemLine('stat', t(`${K}Size`, { size: sizeText(size) }), 'system.size'));
    const stages = (Array.isArray(s.sizeProgression) ? s.sizeProgression : [])
      .filter((st) => st && Number.isFinite(Number(st.level)) && sanitizeSizeId(st.size))
      .sort((a, b) => Number(a.level) - Number(b.level))
      .map((st) => t(`${K}SizeStage`, { size: sizeText(st.size), level: Number(st.level) }));
    if (stages.length) lines.push(itemLine('stat', t(`${K}SizeByLevel`, { stages: stages.join(', ') }), 'system.sizeProgression'));
    return lines;
  }
};

/** @type {ReadonlyArray<import('./shared.mjs').ItemSummaryBlock>} */
export const BLOCKS = Object.freeze([rankFloor, archetypes, raceSize]);
