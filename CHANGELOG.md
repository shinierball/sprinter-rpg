# Changelog

## 7.0.0

**Breaking.** Some fields were removed or moved with no migration, so worlds made with 6.0.0 should be recreated: gear's five Stat bonus boxes are now Stat bonus rows, the crafting workstation level and craft fields are gone, and vehicles no longer carry a copy of the crawler's fields.

- **Transformations.** A debuff can be an affliction that changes its victim: into a form (a race made in the Race Creator with the new Transformation form box), with added buffs and debuffs, or both. The change happens when someone clicks Change, from the landing card, the conditions row or the sheet's banner; the original race stays underneath and comes back on Revert. Alternate forms (a werewolf's wolf and human shapes), a cure window per affliction (never, always, or until the end of the floor; past it a cure asks a Rule Break), a GM-only card when a carrier drops to 0 Health, and stat rows with a Minimum ("−10 Charisma, not below 2"). A debuff marked Secret is held by the GM until revealed; the Session Manager's new Secrets tab lists every secret and pending affliction. A paused debuff does nothing until switched on. New example set: Contract Clauses.
- **Turn a theme off.** A new **Themes Turned Off** world setting removes a theme's content (say Shiny, after a rulebook import) from the pickers, creators, managers and compendium sidebar. After the reload the GM is offered a **Theme Cleanup**: documents of a turned-off theme already on actors can be deleted or replaced with Celestial AI Poop, which the GM can restore later. `/themes` opens it again.
- **Homebrew badge.** A document made in a world gets a Homebrew badge naming the user who made it.
- **AI-written content.** Every document carries who wrote its words: a person, AI, or AI edited by a person, shown as a mark beside the source badge and changed from the sheet's Authorship control. The shipped examples are marked AI-written. A new **AI-Written Content** world setting can hide AI-written content, or AI-written and human-edited content, everywhere the theme switch does; the cleanup offers to replace hidden documents already on actors. With nothing human-written installed, the race and class lists are empty until you import your books or make your own.
- **Zero zone.** The GM switches on a world-wide zero zone (Token controls, a keybinding, or a Scene Region with the Zero Zone behavior) where crawlers' enhancements stop working: every player's HUD goes dark, equipped gear goes offline unless tagged Works in Zero Zone, buffs and debuffs pause, and casting a spell, using an item or attacking asks a Rule Break. Players are never told why. The sheet shows which gear is offline. New example set: Offline Mode.
- **Hide the HUD.** A player hides their crawler HUD and hotlist from the Token controls or with Shift+H; the sheet keeps them.
- **Loot boxes and achievements are the GM's.** Boxes sit in a Loot Boxes strip, not the inventory; players can only Open all, and an opened box leaves nothing behind. Boxes never go into or out of a stash. The safe room is a scene tagged as one, nothing else.
- **Token defaults.** Every new actor's token shows its name to everyone; crawlers, NPCs, pets and mercenaries also get vision with a 120 ft range. Compendium companions and example actors carry the same defaults.
- **The action ledger asks.** An action past a combatant's budget, or a regular mob's second attack, asks a Rule Break first.
- **Combat.** Next Step and Previous Step hotkeys (Shift+Period, Shift+Comma), and End Round & Reset at Step 5. The Called Play discard button works.
- **Rich-text descriptions.** Race, class, gear, skill and every other item sheet edits its description in the rich-text editor instead of showing raw HTML.
- **Item sheets edit every example field.** The Stat Bonuses table has a Label column; the Light section shows on any item with a light; outcome rows gain a plain damage type, a filter for Cure Debuff and spell damage controls; skill rank tiers gain Rank Dice Source and Temp Bars Granted; Delivery and gear slot choices come from their registries, so a module's `delivery.*` tags and gear slots appear.
- The Cure Debuff outcome picks the debuff it cures; the old text box did nothing.
- The Item Manager merges entries by their source, not their name.
- The floor-start bracelet rolls its race on its own table, and the arrival card links to write-in picks.
- The day clock uses the 30-hour dungeon day everywhere.
- Long and full-day rests never lower Health or Mana that is above its maximum.
- Bundled mercenaries' weapons use real weapon categories.
- Dark theme: unchecked checkboxes are visible in every system window and chat card.
- The crawler HUD appears for a token controlled before the world finished loading.
- **Crafting.** A crafting window, opened from the crawler's inventory, a blueprint or a personal space, runs the crafting check: materials come from the crawler first, then their space; the margin decides salvage; the result card lists what was made. Enchantments, broken gear and Repair, crafting specialties, crafting tables bought by tier, and Misc. Junk to spend or pull a common item from. Crafting rules live on skills as rows (caps by Rank, half-time upgrades). New example set: Crafting.
- **Vehicles.** Vehicle checks with after-roll offers (reroll, degree shift), driving, boarding, ramming and explosions, vehicle combat (attack Difficulty, occupant Evade, vehicle DR), mounted weapons fired by an occupant, and a vehicle sheet with an Aboard strip. A vehicle's Health follows its size. New example set: Vehicles.
- **Loot boxes.** An achievement that rewards a box gives the crawler a real box item. The GM fills boxes with items, spells, skill potions, money and consumables, or with choices the crawler picks from. In a safe room the crawler opens their boxes in the Loot Box Showcase, lowest tier first. Boxes can be pre-rolled, and an item shows where it came from. New example set: Loot Boxes.
- **Percent Stat bonuses.** Gear, buffs and debuffs give flat and percent Stat bonuses as rows ("+5 STR, +10% STR"). A world setting picks whether gear percents are worked out once when received (the default) or kept live; buff and debuff percents are always live.
- **Floor 3, 4 and 5 starts in the Crawler Creator.** The creator builds a later-floor crawler in its own steps, with a preview that follows the choices; the separate Floor Simulator window is gone. The footer says what Create will do. New example set: Floor Starts.
- **Content themes and source badges.** Every installed theme's content is in the pickers and compendiums at once; a new **Primary Content Theme** setting (it replaces Active Content Theme) picks which one supplies the crawler creator's species, backgrounds and story tables. The examples theme is merged into Shiny, whose compendiums are now Shiny Items, Shiny Actors and Shiny Tables. Each document shows a set-symbol badge for where it came from (Shiny and its set, a book from your import, or the bundled documents) on sheets, lists, pickers and compendium entries. A borrowed-text import is badged with the book whose PDF supplied the text. Module authors: see `docs/content-themes.md`.
- **Sex on the character sheet.** Crawler and mob sheets have a Sex select (Male, Female, Non-binary, Other) that sets the actor's own sex tag; a sex that comes from a race or other item is shown as a hint. New tags `creature.nonbinary` and `creature.sex_other`.
- The creator's starter mana potion, Green Room Mana Spritzer, is a real Shiny document with its badge.
- Loot and gear outcomes offer Restore Resource in their type selects; editing a mana-restore item no longer turns it into a heal.
- Gear auras pick their buffs, debuffs and pulse conditions from the same pickers as the rest of the sheet, not from comma lists.
- System hotbar macros in an older world are rewritten to match the system's code.
- A compendium sync keeps a crawler's race and class picks.
- The importer reads the books' crafting, vehicle and loot box rows, and the Crawler Creator waits for an import's catalogs before it builds.
- Arrival cards tell Dice So Nice not to roll dice already shown in the creator.
- Under the hood: the code was reorganised (engines moved out of the windows, actor behaviour as plain functions, `src/utils/` grouped by feature, long modules split) with no change to play. The stylesheet is now thirteen files under `styles/`, listed in `system.json`; a module that overrode `styles/cog.css` by path should target the new files.

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
