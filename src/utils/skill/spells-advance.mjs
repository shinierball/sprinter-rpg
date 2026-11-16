/**
 * Whether Spells advance in Ranks like Skills ("in the ways that count" a Spell is a special type of Skill), and the
 * item types that do. Pure and import-light: the Rank readers below the tag layer ask it.
 */

/** Whether an item is one that can advance: a Skill or a Spell. */
export const isAdvancingType = (item) => item?.type === 'skill' || item?.type === 'spell';

/** The word for an advancing item in a message title ("Skill", "Spell"). */
export const advancingNoun = (item) => (item?.type === 'spell' ? 'Spell' : 'Skill');

let spellMakesCheckReader = () => true;

/**
 * Where "does casting this spell call for a Check" is read from. The reader reads tags (`spellMakesCheck`,
 * `tag-mechanics.mjs`), which sit above the Rank limits that ask; the tag module hands it in once when it loads, so the
 * limits do not import it back.
 * @param {(spell: object) => boolean} reader
 */
export function registerSpellCheckReader(reader) {
  spellMakesCheckReader = reader;
}

/** Whether casting the spell calls for a Check (true until the tag module has registered its reader). */
export const spellCallsForCheck = (spell) => spellMakesCheckReader(spell);
