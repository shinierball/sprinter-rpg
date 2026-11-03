# Changelog

## 6.0.0

**Breaking.** The compendiums now ship only content written for this system. Every entry from the source books is left out and comes from a Sourcery import of your own PDFs. Worlds made with 5.11.0 should be recreated.

- A base set that works without an import: ten classes (Fighter, Barbarian, Rogue, Monk, Bard, Mage, Cleric, Paladin, Druid, Arcanist), two races (Human, and Non-Human, which is deliberately unbalanced and asks for a Rule Break), 68 skills, 8 spells and 10 debuffs. Every class pick offers at least one more option than it needs.
- The Classes system compendium is gone; the base classes are in the example compendiums, and an import writes the books' classes to its own world compendium.
- An import writes a book entry only when your PDF has it, and its review lists how many were left out. Importing again adds to the last import: a book picked again replaces what was read from it, and books left out keep what they gave.
- Floor-table rewards that name a book entry keep their text, find a base document of the same name before an import, and are marked "needs an import" when nothing matches. They can still be picked.
- Debuffs are found by identifier or condition tag, never by name.
- The scrolls, wand, ring and tooth caps that cast or granted book spells and skills now use base ones.
- The Forge: install by manifest, Game Manager, socketlib, the relay and the Sourcery import are tested on a real Forge account (see `docs/hosting-on-the-forge.md`).

## 5.11.0

First public release of Sprinter RPG, a Foundry VTT system (v14 and later, with socketlib).

- Crawler, mob, pet and vehicle sheets, with health bars, skills, spells, buffs and debuffs, gear and loot.
- Creators for crawlers, races, classes, mobs and items, each built on a pure `buildPayload(spec)` compiler.
- A tag system that carries tiers, damage types and conditions, with registries that modules can extend.
- Original example content, in compendium packs.
- The Sourcery importer, which turns the owner's own PDFs into world compendiums with the book text, in the browser.
- Fillable-sheet PDF export from a sheet the GM supplies.
