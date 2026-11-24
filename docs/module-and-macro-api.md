# Module and macro author guide

This page lists what a world macro or a module may use from the system, and says what you may rely on. It is the whole supported surface: the list is kept in `src/hooks/public-api.mjs`, and a check in the system's tests fails when this page leaves an entry out or when a listed entry is removed. Worked examples of registering content are in [engine-extension.md](engine-extension.md) and [content-themes.md](content-themes.md).

## 1. The promise

- **What is supported.** Only the entries on this page. They are on four roots, `game.cog`, `CONFIG.COG`, `window.cog` and the content registry, plus two hooks.
- **From which release.** The promise starts with the first release that ships the list. Earlier releases carry no promise about these names.
- **How an entry leaves.** A supported entry is removed, or changes what kind of value it is (a function becoming a class, a table becoming a list), only after one published release marked it deprecated and named the entry to use instead. Section 8 lists what is deprecated.
- **File paths are not supported.** Do not import a file from `systems/sprinter-rpg/`. Files move between releases. Everything a module needs from a file is an entry below.
- **Document methods are not covered yet.** Methods on actors and items (`rollSkill` and the rest) are internal until a later release lists them.
- **Everything else is internal.** Any name on these roots that this page does not list (the sheet and window classes, data models, the catalog views, helpers that exist on more than one root) may change or go in any release without notice. A line in a guide that names an internal says so.
- **Add nothing to the system's roots.** The system builds `game.cog`, `CONFIG.COG` and `window.cog` during `init` and may replace what a module put there. Register content through the hook (section 3); keep your own values in your own module's namespace.

## 2. The roots

| Root | What is on it | When it exists |
|---|---|---|
| `game.cog` | Functions and helpers. `game.sprinterRpg` is the same object. | From the system's `init`, before `sprinter-rpg.registerContent` fires. |
| `CONFIG.COG` | Tables a module may read or extend. | From the system's `init`, before `sprinter-rpg.registerContent` fires. |
| `window.cog` | Launchers and console helpers. | At the end of the system's `init`, so a macro always finds it. |
| The content registry | The `register*` calls and readers. | The argument of `sprinter-rpg.registerContent`; also on `game.cog` and `CONFIG.COG` as `content`. |

| Entry | What it is |
|---|---|
| `game.sprinterRpg` | The same object as `game.cog`. |
| `game.cog.content` | The content registry, the same object `sprinter-rpg.registerContent` passes. |

## 3. Registering content

Register from the `sprinter-rpg.registerContent` hook. The system fires it once during `init` and passes the content registry:

```js
Hooks.on('sprinter-rpg.registerContent', (registry) => {
  registry.registerScalar({
    id: 'my-module.applause',
    label: 'Applause meter',
    needs: ['actor'],
    resolve: ({ actor }) => Number(actor?.flags?.['my-module']?.applause) || 0
  });
});
```

- **Ids are prefixed** with your module id (`my-module.applause`) so they never collide with the system's.
- **Priority.** Every call takes `{ priority }` (default 10; the system's own content is 0). A higher priority replaces an existing id. An equal or lower one is refused.
- **Refusals are visible, never fatal.** A bad definition, or one that loses on priority, returns `false` and logs a `Sprinter RPG | register... refused` warning.
- **The registry calls**, each made on the hook's argument:

| Call | What it does |
|---|---|
| `registry.getBackgroundTable(...)` | One background table by key. |
| `registry.getCatalog(...)` | The entries of a catalog kind. |
| `registry.getReference(...)` | One reference entry. |
| `registry.getRowKind(...)` | One row kind by modifier array and id. |
| `registry.getScalar(...)` | One scalar by id. |
| `registry.getSpaceTypes(...)` | Every personal space type. |
| `registry.getSpaceUpgrades(...)` | The personal space upgrades. |
| `registry.getSpecies(...)` | One species by id. |
| `registry.getSpeciesList(...)` | Every registered species. |
| `registry.hasCatalog(...)` | Whether a catalog kind has any entries. |
| `registry.listReferences(...)` | The reference entries of a kind. |
| `registry.registerAdvancementRoute(...)` | Registers a way a Skill gains Ranks. |
| `registry.registerAuthorship(...)` | Adds an authorship mark (`human`, `ai` and `edited` are the system's own). |
| `registry.registerBackgroundMatrix(...)` | Registers the background rows of a species and stage. |
| `registry.registerBackgroundTable(...)` | Registers one background table. |
| `registry.registerBackgroundTables(...)` | Registers a map of background tables. |
| `registry.registerBossTier(...)` | Registers a boss tier and its `mob.tier.<id>` tag. |
| `registry.registerCatalog(...)` | Registers the entries of a catalog kind (skills, spells, items, mobs and the rest). |
| `registry.registerCharacterSheetPdf(...)` | Registers the fillable character sheet PDF. |
| `registry.registerEnchantmentCategory(...)` | Registers an enchantment category. |
| `registry.registerHeritage(...)` | Registers a heritage. |
| `registry.registerLootBoxTier(...)` | Registers a loot box tier. |
| `registry.registerLootGenerator(...)` | Registers a loot generator. |
| `registry.registerMagicItemBase(...)` | Registers a base item for generated magic items. |
| `registry.registerMercenaries(...)` | Registers a list of mercenaries. |
| `registry.registerMercenary(...)` | Registers one mercenary. |
| `registry.registerPack(...)` | Registers a compendium pack under a category. |
| `registry.registerPopularityChange(...)` | Registers a Popularity change. |
| `registry.registerReferences(...)` | Registers reference entries of a kind. |
| `registry.registerRowKind(...)` | Registers a row kind on a modifier array. |
| `registry.registerRuleFlag(...)` | Registers a rule flag. |
| `registry.registerRuleSkill(...)` | Registers a Skill the rules read by key. |
| `registry.registerScalar(...)` | Registers a scalar (a number a row scales by). |
| `registry.registerSize(...)` | Registers a creature size. |
| `registry.registerSourceSet(...)` | Gives a source set its label, symbol and release. |
| `registry.registerSourceTheme(...)` | Gives a stamp theme that is not a content theme its badge. |
| `registry.registerSpaceType(...)` | Registers a personal space type. |
| `registry.registerSpaceUpgrade(...)` | Registers a personal space upgrade. |
| `registry.registerSpecies(...)` | Registers a species for the crawler creator. |
| `registry.registerTag(...)` | Registers a tag, with its rows and flags. |
| `registry.registerTagNamespace(...)` | Registers a tag namespace. |
| `registry.registerTheme(...)` | Registers a content theme. |
| `registry.registerUsedForm(...)` | Registers a form of used gear. |
| `registry.registerVehicleKind(...)` | Registers a vehicle kind. |
| `registry.rollBackgroundTable(...)` | Rolls a background table. |

## 4. Tables you may read or extend

These are on `CONFIG.COG`. A table is a plain object (or a list, or a number) that exists for the whole session; its rows are content, so you may read any row and add your own. Where a table has a `register*` call, use it: it also registers the tag and applies the priority rule. The content registry is on `CONFIG.COG` too:

| Entry | What it is |
|---|---|
| `CONFIG.COG.content` | The content registry, the same object as `game.cog.content`. |

| Table | What it is |
|---|---|
| `CONFIG.COG.achievementTiers` | The tiers an achievement can have, with their labels. |
| `CONFIG.COG.advancementRoutes` | The ways a Skill gains Ranks. Add a route with `registry.registerAdvancementRoute(`. |
| `CONFIG.COG.areaRegionBuilders` | How an area shape is turned into a scene region. |
| `CONFIG.COG.bossMaps` | The map a boss tier drops. |
| `CONFIG.COG.bossTiers` | Boss tiers (stats per level, base Health Bars). Add one with `registry.registerBossTier(`. |
| `CONFIG.COG.cameraAudiences` | Who a camera shot is shown to. |
| `CONFIG.COG.challengeDegrees` | The degrees of difficulty a challenge can have. |
| `CONFIG.COG.chaseGround` | The kinds of ground a chase crosses. |
| `CONFIG.COG.checkTypes` | The kinds of check a roll can be. |
| `CONFIG.COG.contestKinds` | The kinds of contest the Contest Tracker runs. |
| `CONFIG.COG.cureWindows` | How long a debuff can still be cured. |
| `CONFIG.COG.damageTypeRarity` | How rare each damage type is for loot. |
| `CONFIG.COG.damageTypes` | The list of damage types. |
| `CONFIG.COG.enchantmentCategories` | Groups of enchantments for generated magic items. Add one with `registry.registerEnchantmentCategory(`. |
| `CONFIG.COG.fanBoxMilestones` | The Fan Box milestone rule: `{ list, factor }`. A module may replace either value. |
| `CONFIG.COG.gearContributions` | What each kind of gear contributes to its wearer. |
| `CONFIG.COG.gearSlotLimbs` | Which limbs each gear slot needs. |
| `CONFIG.COG.gearSlots` | The slots gear can be worn in. |
| `CONFIG.COG.heritages` | Heritage entries a character can have. Add one with `registry.registerHeritage(`. |
| `CONFIG.COG.levelAwardPresets` | The presets the level award dialog offers. |
| `CONFIG.COG.lightDefaults` | The light a light source gives when a row says nothing else. |
| `CONFIG.COG.lootBoxFx` | The opening effects of the Loot Box Showcase. A tier that names an `fx` lists it here and ships its own CSS. |
| `CONFIG.COG.lootBoxTiers` | Loot box tiers. Add one with `registry.registerLootBoxTier(`. |
| `CONFIG.COG.lootGenerators` | Loot generators. Add one with `registry.registerLootGenerator(`. |
| `CONFIG.COG.magicItemBases` | The base items a generated magic item is built on. Add one with `registry.registerMagicItemBase(`. |
| `CONFIG.COG.mobLootByFloor` | The gold a defeated mob carries, by Floor. |
| `CONFIG.COG.moveModes` | The kinds of Move a row may name (walk, swim, fly and the rest). |
| `CONFIG.COG.outcomeConfig` | How roll outcomes are shown and counted. |
| `CONFIG.COG.outcomes` | The outcomes a roll can have. |
| `CONFIG.COG.petAttitudes` | A pet's attitude toward its handler. |
| `CONFIG.COG.petCheckKinds` | The checks a pet rolls. |
| `CONFIG.COG.petGuidance` | The guidance a handler can give a pet. |
| `CONFIG.COG.petRoles` | A pet's roles. |
| `CONFIG.COG.popularityChanges` | The standard Popularity changes. A module may replace the table. |
| `CONFIG.COG.raceClassUnlockFloor` | The Floor from which a crawler can pick a race and a class. |
| `CONFIG.COG.rollPenalties` | The penalties a roll can carry. |
| `CONFIG.COG.rowKinds` | The row kinds each modifier array accepts. Add one with `registry.registerRowKind(`. |
| `CONFIG.COG.ruleFlags` | The rule flags a tag may carry. Add one with `registry.registerRuleFlag(`. |
| `CONFIG.COG.ruleSkills` | The Skills the rules read by key. Add one with `registry.registerRuleSkill(`. |
| `CONFIG.COG.scalars` | The numbers a row may scale by. Add one with `registry.registerScalar(`. |
| `CONFIG.COG.sexOptions` | The options the sex field offers. Add one with `game.cog.registerSexOption(`. |
| `CONFIG.COG.situationDetectors` | The detectors that pre-tick a situation in the Attack Options window. Add one with `game.cog.registerSituationDetector(`. |
| `CONFIG.COG.sizes` | Creature sizes. Add one with `registry.registerSize(`. |
| `CONFIG.COG.spaceRules` | Personal space ranks and prices. A module may replace the table. |
| `CONFIG.COG.timeUnits` | The units of time a duration can use. |
| `CONFIG.COG.tokenDefaults` | The prototype token defaults for a new actor, by actor type. A module may edit a row. |
| `CONFIG.COG.transformCues` | The cues that say a transformation starts or ends. |
| `CONFIG.COG.usedForms` | The forms of used gear. Add one with `registry.registerUsedForm(`. |
| `CONFIG.COG.vehicleCheckKinds` | The checks a vehicle rolls. |
| `CONFIG.COG.vehicleCheckResults` | The results of a vehicle check. |
| `CONFIG.COG.vehicleKinds` | Vehicle kinds. Add one with `registry.registerVehicleKind(`. |
| `CONFIG.COG.vehicleRoles` | The roles a crew member can take on a vehicle. |
| `CONFIG.COG.vehicleUpgradeKinds` | The kinds of vehicle upgrade. |
| `CONFIG.COG.zeroHealthOutcomes` | What happens at 0% Health, by actor type: `'dying'` or `'dead'`. A module that adds an actor type adds its entry. |

**Override keys.** The system reads these only when a module sets them and never sets them itself:

| Override key | What it is |
|---|---|
| `CONFIG.COG.lootTiers` | Replaces the loot tier table when a module sets it. |
| `CONFIG.COG.floorArrivals` | Replaces what happens when the party arrives on a Floor, when a module sets it. |
| `CONFIG.COG.floorStartRuns` | Replaces what runs when a Floor starts, when a module sets it. |

## 5. Macros

A macro calls `window.cog` and `game.cog`. A macro that opens a window checks that the launcher exists and warns when it does not:

```js
if (typeof window.cog?.openCrawlerCreator === 'function') window.cog.openCrawlerCreator();
else ui.notifications?.warn('Crawler Creator application is not available.');
```

**Launchers** on `window.cog`:

| Launcher | What it is |
|---|---|
| `window.cog.openAchievementManager` | Opens the Achievement Manager. |
| `window.cog.openActionHUD` | Opens the Action HUD. |
| `window.cog.openClassCreator` | Opens the Class Creator Studio. |
| `window.cog.openCombatArchive` | Opens the Combat Archive. |
| `window.cog.openCombatMetrics` | Opens Combat Metrics. |
| `window.cog.openContestTracker` | Opens the Contest Tracker. |
| `window.cog.openCrawlerCreator` | Opens the Crawler Creator. |
| `window.cog.openGrindApp` | Opens the Party Grinding and Downtime hub. |
| `window.cog.openHotbarHUD` | Opens the Hotbar HUD. |
| `window.cog.openItemManager` | Opens the Item Manager. |
| `window.cog.openRaceCreator` | Opens the Race Creator Studio. |
| `window.cog.openRapidBatchImport` | Opens the rapid batch import window. |
| `window.cog.openSessionManager` | Opens the Party Progression and Session Hub. |
| `window.cog.openSkillManager` | Opens the Skill Manager. |
| `window.cog.openSpellManager` | Opens the Spell Manager. |
| `window.cog.openTagGuide` | Opens the Tag System and Content Creation guide journal. |
| `window.cog.openTagManager` | Opens the Tag Manager. |
| `window.cog.rapidBatchImport` | Runs the rapid batch import without the window. |

**The Floor clock and the crawler count** on `window.cog`:

| Function | What it is |
|---|---|
| `window.cog.decrementCrawlerCount` | Takes crawlers off the count. |
| `window.cog.decrementFloorTimer` | Counts the Floor timer down. |
| `window.cog.getCrawlerCount` | The number of crawlers left. |
| `window.cog.getCurrentFloor` | The current Floor number. |
| `window.cog.getFloorTimer` | The Floor timer. |
| `window.cog.incrementCrawlerCount` | Adds crawlers to the count. |
| `window.cog.setCrawlerCount` | Sets the number of crawlers left. |
| `window.cog.setCurrentFloor` | Sets the current Floor. |
| `window.cog.setFloorTimer` | Sets the Floor timer. |

**Console helpers** on `window.cog`:

| Entry | What it is |
|---|---|
| `window.cog.migrations` | The namespace of the world migration helpers. |
| `window.cog.migrations.run` | Runs world migrations from the console: `window.cog.migrations.run({ dryRun: true })` previews them and writes nothing. |

**Helpers on `game.cog`** for macros:

| Entry | What it is |
|---|---|
| `game.cog.activation` | The namespace of buff activation. |
| `game.cog.activation.end` | Ends a buff's activation. |
| `game.cog.activation.use` | Activates a buff on an actor. |
| `game.cog.createAndEditItem` | Creates an item and opens its sheet. |
| `game.cog.damagePartOf` | Builds the damage part a row adds, for a row kind that adds damage. |
| `game.cog.exportCrawlerToPdf` | Fills the character sheet PDF for a crawler and returns the bytes. |
| `game.cog.getCurrentFloor` | The current Floor number. |
| `game.cog.openItemSetup` | Opens the item setup window. |
| `game.cog.openMobCreator` | Opens the Mob Creator. |
| `game.cog.openWeaponBuilder` | Opens the Weapon Builder. |
| `game.cog.saveCrawlerPdf` | Fills the character sheet PDF for a crawler and downloads it. |
| `game.cog.setCurrentFloor` | Sets the current Floor. |
| `game.cog.unpauseGame` | Unpauses the game. |

Two examples:

```js
// Download a crawler's character sheet as a PDF.
const actor = game.actors.find((a) => a.type === 'crawler');
await game.cog.saveCrawlerPdf(actor);

// Open the Mob Creator.
game.cog.openMobCreator();
```

## 6. Tags and rule flags

`game.cog.tags` is the tag index, and the rule-flag and tag-behaviour helpers sit beside it on `game.cog`:

| Entry | What it is |
|---|---|
| `game.cog.tags` | The tag index. `game.cog.tags.find('element.fire')` lists the items that carry a tag. |
| `game.cog.hasRuleFlag` | Whether an actor, an item or a list of tags carries a rule flag. |
| `game.cog.registerRuleFlag` | Registers a rule flag (the registry's call of the same name does the same). |
| `game.cog.registerSituationDetector` | Teaches the Attack Options window to pre-tick a situation tag: `(tag, detect, { priority })`. |
| `game.cog.registerSexOption` | Adds an option to the sex field. |
| `game.cog.registerStepHandler` | Registers a handler for a Floor simulator step. |
| `game.cog.registerRuleSkill` | Registers a Skill the rules read by key. |
| `game.cog.ruleSkillRank` | An actor's Rank in a rule Skill. |
| `game.cog.getTagBehaviour` | The behaviour (rows and flags) a tag carries. |
| `game.cog.listBehaviourTags` | Every tag that carries a behaviour. |
| `game.cog.tagBehaviourErrors` | The problems in a tag behaviour definition, as a list of lines. |
| `game.cog.RULE_FLAGS` | The core rule flag ids. |

Engine code asks `game.cog.hasRuleFlag(subject, flag)`; it never matches a `rule.*` tag id, so renaming or replacing the tag keeps the rule.

## 7. Hooks

| Hook | Fired | Arguments |
|---|---|---|
| `'sprinter-rpg.registerContent'` | Once, during the system's `init`. | The content registry. |
| `'sprinter-rpg.combatCleanUp'` | At the end of a combat round's Clean Up step, after every registered clean-up step. | `(combat, { round })` |

## 8. Deprecated

Nothing is deprecated.
