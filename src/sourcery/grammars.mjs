/**
 * src/sourcery/grammars.mjs
 * Block grammars per kind. Generic label words only; nothing here names an entity.
 *
 * A grammar is:
 *   labels           label -> block field key, or `null` for a mechanic label (sliced, never hydrated: rule 6).
 *                    Label keys are normalised (`normalizeHeading`).
 *   quote            the first paragraph is the quote when it opens with a quotation mark.
 *   typeLine         the next short paragraph is a type line (mechanics, discarded).
 *   sidebar          block field that receives paragraphs set in a style other than the body style (segment 0).
 *   mechanicSegment  segments from this index on are stat blocks: unknown `X:` lines are attacks (mechanics).
 *   continues        fields that absorb the unlabelled paragraphs that follow them.
 *   listLabels       a `continues` field whose label stands alone on its line absorbs the paragraphs after it (a bulleted list
 *                    printed under the label), set in the styles of the first one.
 *   bodyLabels       labels whose paragraph is body text, label word included (`Example:`): never a field, never dropped.
 *   cells            the anchor is a table row; columns map to these block field keys.
 * Segments: a heading with the anchor's own hash opens the next segment (narrative, sidebar, stat block).
 */

const RANKS = { 'rank 5': 'rank5', 'rank 10': 'rank10', 'rank 15': 'rank15' };
const BODY_LABELS = Object.freeze(['example']);

export const GRAMMARS = Object.freeze({
  skill: { quote: true, typeLine: true, bodyLabels: BODY_LABELS, labels: { limitations: 'limitations', limitation: 'limitations', ...RANKS, 'base damage': null, 'ai favor': null, cooldown: null, effect: 'effect', favored: null } },
  spell: { quote: true, typeLine: true, bodyLabels: BODY_LABELS, labels: { limitations: 'limitations', limitation: 'limitations', ...RANKS, 'mana cost': null, range: null, duration: null, cooldown: null, 'base damage': null, 'ai favor': null, favored: null } },
  race: { bodyLabels: BODY_LABELS, labels: { prerequisites: 'prerequisites', prerequisite: 'prerequisites', 'stat bonuses': null, 'skill bonuses': null, 'race bonuses': null, size: null, movement: null, perks: 'perks', limitations: 'limitations', limitation: 'limitations' } },
  class: { bodyLabels: BODY_LABELS, labels: { prerequisites: 'prerequisites', prerequisite: 'prerequisites', 'class type': null, 'stat bonuses': null, 'skill bonuses': null, 'class bonuses': null, perks: 'perks', limitations: 'limitations', limitation: 'limitations', 'class spells': null, 'starting gear': null } },
  mob: { sidebar: 'sidebar', mechanicSegment: 1, continues: ['notes'], bodyLabels: BODY_LABELS, labels: { level: null, surprise: null, evade: null, move: null, dr: null, notes: 'notes' } },
  gear: { bodyLabels: BODY_LABELS, labels: { 'gear slot': null, warning: 'warning' } },
  buff: { bodyLabels: BODY_LABELS, labels: {} },
  debuff: { cells: ['description', 'duration'], labels: {} },
  achievement: { bodyLabels: BODY_LABELS, labels: { reward: 'reward', contents: 'contents' } },
  // A deity entry: labelled lines, then three benefit lists whose bullets follow their label (`continues`), so no bullet reads
  // as the story. Rivals, signature Skills and Stat are mechanics (identifiers in the spec).
  deity: {
    continues: ['acolyte', 'devotee', 'zealot'],
    listLabels: true,
    labels: {
      temple: 'temple', 'high supreme cleric': 'highCleric', 'daily offering': 'offering', rival: null, 'opposed to': null,
      'likely sponsor': 'sponsor', 'signature skills': null, 'signature stat': null, symbol: 'symbol',
      'additional acolyte benefits': 'acolyte', 'additional devotee benefits': 'devotee', 'additional zealot benefits': 'zealot'
    }
  },
  // A patron entry (core rulebook pp. 317-319): the story, then one labelled line each. The Additional Skills and the
  // Messaging Method are mechanics (identifiers and a choice in the spec).
  patron: {
    labels: {
      availability: 'availability', 'performance skills': 'performance', 'venue connections': 'venues',
      'additional skills': null, 'messaging method': null, quests: 'quests', favors: 'favours', rewards: 'rewards'
    }
  },
  // No space document is asked of a book (the books have no personal-space headings, 5.1). The empty grammar keeps the kind slicing into a body.
  space: { labels: {} }
});

export const KINDS = Object.freeze(Object.keys(GRAMMARS));

/** The grammar for a kind, or null for an unknown kind. */
export function grammarFor(kind) {
  const k = typeof kind === 'string' ? kind : '';
  return Object.hasOwn(GRAMMARS, k) ? GRAMMARS[k] : null;
}
