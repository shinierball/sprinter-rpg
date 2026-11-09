# Content themes and source badges

A content theme is a named body of content: documents in compendiums, catalog entries the pickers and creators list, and setting data such as the crawler creator's species and story tables. The system registers two themes:

- **Shiny** (`shiny`): the system's own original content, in the Shiny Items, Shiny Actors and Shiny Tables compendiums.
- **Rulebook Content** (`cog`): the few documents bundled with the system, plus whatever a Sourcery import writes from your PDFs.

A module can register its own theme the same way.

## How themes combine

Every installed theme is active unless the GM turns it off. Its documents appear in the pickers, managers and compendiums.

The **Primary Content Theme** world setting picks one theme as the primary. The primary theme:

- supplies the setting data: the crawler creator's species, backgrounds and story tables, and the other per-world tables (each kind falls back to another theme when the primary has none);
- comes first when two themes offer the same thing.

Changing the primary needs a reload.

## Turning a theme off

The **Themes Turned Off** world setting lists the themes that are off. The setting stores the ones that are off, so a theme a module adds later starts on. The primary theme is always on. Content of a theme that is off leaves the pickers, creators, managers and compendium sidebar; anything that would land on an actor from one of its entries (a grant, a box prize) lands as **Celestial AI Poop** instead, an item that records what it replaced. After the reload the GM is offered the **Theme Cleanup** (also `/themes`): documents of an off theme already on actors can be deleted or replaced with Celestial AI Poop, and its Restore tab puts replaced documents back.

Every list asks one question, `isContentOff(doc)` in `src/utils/content-source.mjs`, which covers a theme turned off and hidden authorship (below). A module that lists content should filter with it, or read `offeredEntries(kind)`, rather than test the setting itself.

## Registering a theme

Register from the `sprinter-rpg.registerContent` hook, which passes the content registry:

```js
Hooks.on('sprinter-rpg.registerContent', (registry) => {
  registry.registerTheme('my-theme', {
    label: 'My Theme',
    description: 'What the theme holds, for the setting choices.',
    badge: { icon: 'fa-solid fa-dragon', color: '--my-theme-color' }
  }, { priority: 10, provider: 'my-module' });

  registry.registerSourceSet('my-theme', 'core', { label: 'Core Set', symbol: 'CS', release: '1.0.0' });

  registry.registerPack('items', 'my-module.my-items', { theme: 'my-theme', priority: 10, provider: 'my-module' });
});
```

- `badge.icon` is a Font Awesome class. `badge.color` is the name of a CSS custom property, which your module's stylesheet defines for light and dark themes.
- `priority` decides between two registrations of the same id: the higher one wins.

## The source stamp

Each document says where it came from in one flag:

```js
flags['sprinter-rpg'].source = { theme: 'my-theme', set: 'core' }
```

Both values are ids matching `/^[a-z0-9._-]{1,40}$/`. The badge reads this flag and nothing else: never a name, a pack label or a folder name. A document without a stamp shows no badge. A malformed stamp (an array, a comma string, an id that does not match) reads as no stamp.

A stamp can also carry `authorship` (below). A document a person makes in a world gets the stamp `{ theme: 'world', set: 'homebrew', authorship: 'human', by, byName }`: `by` is the id of the user who made it and `byName` their name at the time. The `world` theme is a stamp theme only (`registerSourceTheme`): it has a Homebrew badge but no catalogs, and it cannot be turned off. A module that creates world documents of its own passes the create option `cogSystemMade: true` so they are not stamped as homebrew, or puts its own stamp in the data.

Stamp your documents when you build your packs. Copies keep the stamp: Foundry copies flags when a document is dragged or imported, and the system's creators carry the stamp onto the items they build from a catalog entry.

## Source sets and the badge

`registerSourceSet(themeId, setId, { label, symbol, release, note })` gives a set its display data:

- `symbol`: two or three capitals, shown on the badge, like a set symbol on a collectible card.
- `release`: the release the set shipped in, or "Unreleased".
- `note`: a longer description the tooltip uses instead of `label`.

The badge shows on sheets, lists, pickers and compendium entries, but not on chat cards. Its tooltip reads theme, set and release, for example "Shiny · Base Set · 6.0.0". A stamp whose theme or set is not registered still gets a badge: a puzzle-piece icon in the muted text colour, the set id in capitals (cut to three letters), and the raw ids in the tooltip.

`registerSourceTheme(id, { label, symbol, badge })` gives a stamp theme that is not a content theme its badge.

## Authorship

`source.authorship` says who wrote a document's words: `human`, `ai`, or `edited` (AI-written, then edited by a person). A sheet shows it as a mark beside the source badge, and the sheet's Authorship control changes it. Editing the name or description of an `ai` document makes it `edited`; a module that rewrites text itself (a sync) passes the update option `cogAuthorship: false` so nothing flips.

The **AI-Written Content** world setting (`show`, `hide-ai`, `hide-ai-edited`) hides documents by authorship through the same `isContentOff` rule as a turned-off theme, and the Theme Cleanup offers to replace hidden documents already on actors.

`registerAuthorship(id, { label, icon, rank })` adds a mark. `rank` orders the marks for hiding: 0 is a person, higher is more AI. Stamp your module's documents with the mark that is true of them.
