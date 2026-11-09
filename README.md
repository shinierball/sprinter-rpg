# Sprinter RPG

A Foundry VTT system for crawler-style dungeon roleplaying games. It has crawler, mob, pet, mercenary and vehicle sheets, a combat tracker built around a five-step round, a tag-driven rules engine, content creators, and a set of original example content. Content is built from tags, so a module or a GM can add tiers, damage types and conditions without touching the code.

Requires Foundry VTT v14 or later, and the [socketlib](https://github.com/farling42/foundryvtt-socketlib) module (version 1.1.0 or later).

## What ships, and what you bring

The package holds the rules engine, the sheets, the creators and original content written for this system: a base set of ten classes, two races, and the skills, spells and debuffs they use, plus the example sets. Its compendiums show none of the source books' entries. If you own the books as PDFs, the Sourcery importer reads them in your browser and writes their skills, spells, races, classes, mobs and the rest, with the books' own names and text, into compendiums in your own world. The PDFs are never uploaded. Without them the system works with the base set and the examples.

The base set and the examples were written with AI, and each document is marked as AI-written, human-written or AI-written and edited by a person. A table that wants none of it sets **AI-Written Content** in Configure Settings to hide them.

The PDF export of a crawler sheet needs a fillable sheet that the GM supplies; see [`docs/pdf-export.md`](https://github.com/shinierball/sprinter-rpg/blob/main/docs/pdf-export.md).

## Install

In Foundry's setup screen, open **Game Systems**, choose **Install System**, and paste this manifest URL:

```
https://github.com/shinierball/sprinter-rpg/releases/latest/download/system.json
```

Install socketlib too if it is not already installed, and enable it in the world. Release zips are on the [releases page](https://github.com/shinierball/sprinter-rpg/releases).

To install by hand, unzip a release zip into `Data/systems/sprinter-rpg/` in your Foundry user data folder and restart Foundry.

To run on The Forge, see [`docs/hosting-on-the-forge.md`](https://github.com/shinierball/sprinter-rpg/blob/main/docs/hosting-on-the-forge.md).

## Add the book text (optional)

1. As GM, open **Configure Settings** and click **Open Sourcery Importer**.
2. Pick your PDFs. They are read in your browser.
3. Review the summary of what was found, then click **Import**. The importer writes world compendiums, and asks before it replaces ones it made earlier.
4. Optionally, make **Rulebook Content** the **Primary Content Theme** and reload. The imported documents are in the pickers and compendiums either way, each with its book's badge. The primary theme supplies the crawler creator's species, backgrounds and story tables, so this switch makes the creator use the books' tables. The importer offers to switch after an import; if you decline, set it later in Configure Settings.
5. Optionally, for classic mode, add **Shiny** to **Themes Turned Off** and reload. Its sample skills, spells and items leave the pickers, creators and compendiums, and a Theme Cleanup offers to replace those already on actors.

Importing again after an update can refresh the world items you already have, matched by their compendium id; the importer asks first and changes nothing if you decline.

## For module authors

The rules this code is built to are in [`CONTRIBUTING.md`](https://github.com/shinierball/sprinter-rpg/blob/main/CONTRIBUTING.md). Four guides cover extending the system:

- [`docs/unified-tagging-system.md`](https://github.com/shinierball/sprinter-rpg/blob/main/docs/unified-tagging-system.md): tags, the way content is extended.
- [`docs/content-themes.md`](https://github.com/shinierball/sprinter-rpg/blob/main/docs/content-themes.md): content themes, source stamps and badges.
- [`docs/engine-extension.md`](https://github.com/shinierball/sprinter-rpg/blob/main/docs/engine-extension.md): the extension API.
- [`docs/conditional-modifiers.md`](https://github.com/shinierball/sprinter-rpg/blob/main/docs/conditional-modifiers.md): the modifier row format.

Each release is also published here as one commit, `Release vX.Y.Z`. See [`CHANGELOG.md`](CHANGELOG.md) for what changed.

## Not affiliated

This work is based on the Dungeon Crawler Carl Roleplaying Game created by Renegade Game Studios, which is based on the
Dungeon Crawler Carl book series by Matt Dinniman. This project does not own that material, and all rights belong to the
original creators. It is not officially endorsed by or affiliated with Renegade Game Studios, Matt
Dinniman, Matt Dinniman LLC, or Veriluxx, LLC.

The game's books credit it as "© 2026 Renegade Game Studios. All Rights Reserved." with "© and TM Matt Dinniman LLC"; the Core
Rulebook prints "© Matt Dinniman and TM Veriluxx, LLC".

This is a fan work created for personal use and shared for educational and non-commercial purposes only. Foundry Virtual
Tabletop is a trademark of Foundry Gaming LLC. This project is not affiliated with or endorsed by Foundry Gaming LLC.

## License

The original work here is licensed under CC BY-NC-SA 4.0 (see [`LICENSE`](LICENSE)). [`NOTICE.md`](NOTICE.md) lists what the license does not cover and the third-party software bundled in `lib/`; the license texts for those are in [`licenses/`](licenses/).
