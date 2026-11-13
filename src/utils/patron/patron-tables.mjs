/**
 * The recipe ids of the book's patron tables (core rulebook pp. 315-317): audition outcomes (Table 68), humiliations (69),
 * benefits (70), quest ideas (71) and favour ideas (72). `findBookTable` (`sourcery/book-tables.mjs`) finds the imported
 * table; where the import has not been run the GM picks by hand.
 */
export const PATRON_TABLE_RECIPES = Object.freeze({
  auditionOutcomes: 't-core-68',
  humiliations: 't-core-69',
  benefits: 't-core-70',
  quests: 't-core-71',
  favours: 't-core-72'
});
