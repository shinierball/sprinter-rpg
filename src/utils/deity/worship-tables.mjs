/**
 * The recipe ids of the book's worship tables (core rulebook pp. 313-314); `findBookTable` (`sourcery/book-tables.mjs`)
 * finds the imported table. Where the import has not been run, the GM picks a gift by hand.
 */
/** The recipe ids of the tables the gift dialog offers: Table 63 boons, 64 Divine Debuffs, 66 smites, 67 signature smites. */
export const WORSHIP_TABLE_RECIPES = Object.freeze({
  boons: 't-core-63',
  divineDebuffs: 't-core-64',
  pcSmites: 't-core-66',
  signatureSmites: 't-core-67'
});
