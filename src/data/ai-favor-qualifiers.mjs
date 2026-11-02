/**
 * src/data/ai-favor-qualifiers.mjs
 * The AI Favor qualifiers the system knows: the condition (a tag query, as stored on `aiFavorRatings` rows) and the text the
 * rules print after the number. Data, so the engine-tag-literal guard does not scan it. Used by the Sourcery generators
 * (`src/sourcery/generators.mjs`) to write the notes line from the structured rows, and by the 3.25d codemod.
 */

/** Condition per qualifier. */
export const QUALIFIER_CONDITIONS = Object.freeze({
  none: { all: [], any: [], none: [] },
  noEffect: { all: [], any: [], none: ['situation.damage_effect'] },
  boss: { all: ['subject.mob.boss'], any: [], none: [] }
});

/** The AI Favor phrase and the text that follows its number for each qualifier. */
export const AI_FAVOR_PHRASE = 'AI Favor: ';
export const AI_FAVOR_NO_EFFECT_TEXT = ' (only if no Damage Effect is used)';
export const AI_FAVOR_BOSS_TEXT = ' when fighting Bosses';
