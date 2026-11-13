/** The rank-break cards the skill and spell sheets share: one entry per milestone, every option precomputed. */
import { RANK_BREAK_THRESHOLDS } from '../../data/tag-vocabulary.mjs';
import { pickOptions, RANK_DICE_SOURCES } from '../../utils/ui/field-options.mjs';

/** Highest Rank a rank break can be set to (the Rank select lists 1..this). */
const MAX_BREAK_RANK = 20;

/** Per-milestone look: the card's colour token and icon. */
const CARD_LOOKS = Object.freeze({
  rank5: { tone: 'success', icon: 'fa-medal' },
  rank10: { tone: 'info', icon: 'fa-medal' },
  rank15: { tone: 'magic', icon: 'fa-medal' },
  rank20: { tone: 'warning', icon: 'fa-trophy' }
});

/** Words that differ between the two sheets (examples in placeholders, lang keys for the rest). */
const KIND_WORDS = Object.freeze({
  skill: {
    damageDicePlaceholder: '2d4',
    buffsPlaceholder: 'e.g. Fire Resistance, +2 STR',
    damageTypeBlankKey: 'COG.AbilitySheet.RankBreaks.SkillDamageType',
    notesPlaceholderKey: 'COG.AbilitySheet.RankBreaks.SkillNotesPlaceholder',
    checkBonusKey: 'COG.AbilitySheet.RankBreaks.SkillCheckBonus'
  },
  spell: {
    damageDicePlaceholder: '1d6',
    buffsPlaceholder: 'e.g. Fire Resistance, +2 INT',
    damageTypeBlankKey: 'COG.AbilitySheet.RankBreaks.SpellDamageType',
    notesPlaceholderKey: 'COG.AbilitySheet.RankBreaks.SpellNotesPlaceholder',
    checkBonusKey: 'COG.AbilitySheet.RankBreaks.SpellCheckBonus'
  }
});

/**
 * One card per rank break (`rank5`..`rank20`) for `rank-break-card.hbs`. Needs `context.rankBreakViews` and
 * `context.rankBreakTagText` (set by `buildRankBreakViews` and `buildRankBreakTagText`) to have run first.
 * @param {object} context render context
 * @param {object} item the skill or spell
 * @returns {Array<object>} the cards; `context.rankBreakCards` is set to the same array
 */
export function buildRankBreakCards(context, item) {
  const isSkill = item.type === 'skill';
  const words = isSkill ? KIND_WORDS.skill : KIND_WORDS.spell;
  const rankBreaks = context.system.rankBreaks || {};
  context.rankBreakCards = Object.entries(RANK_BREAK_THRESHOLDS).map(([key, defaultRank]) => {
    const data = rankBreaks[key] || {};
    const current = Number(data.rank) || defaultRank;
    return {
      key,
      defaultRank,
      ...CARD_LOOKS[key],
      rankOptions: Array.from({ length: MAX_BREAK_RANK }, (_, i) => ({ value: i + 1, label: `Rank ${i + 1}`, selected: i + 1 === current })),
      data,
      view: context.rankBreakViews?.[key] ?? {},
      tagText: context.rankBreakTagText?.[key] ?? '',
      diceSourceOptions: pickOptions(RANK_DICE_SOURCES, data.rankDiceSource || 'attack'),
      ...words
    };
  });
  return context.rankBreakCards;
}
