# Hosting Sprinter RPG on The Forge

For a GM who plays on The Forge.

**Status (research done 2026-10-30):** nothing here has been tried on a real Forge account yet. Every statement is marked **Documented** (a primary source says it, with a link), **From our code** (we checked our own files), or **Unverified** (no source found; do not rely on it). If you try it, the issue tracker is the place to report what worked.

## 1. What the system needs from a host

| Need | Where it comes from |
|---|---|
| Foundry v14 or later (`compatibility`: minimum 14, verified 14, maximum 16) | `system.json` |
| The module `socketlib` 1.1.0 or later (`relationships.requires`) | `system.json` |
| The release zip has `system.json` at its root | The release zip |
| The manifest URL `https://github.com/shinierball/sprinter-rpg/releases/latest/download/system.json` | `system.json` |
| For the Sourcery import only: Foundry's own pdf.js under `scripts/pdfjs/build/` and permission to create world compendiums | `src/apps/sourcery-importer.mjs` |

## 2. Installing on The Forge

### What The Forge documents

- The Forge supports installing by manifest URL: a package's manifest link is pasted in, and The Forge installs it. The Forge's own guide describes this for worlds. **Documented** for worlds, [How to create a Foundry VTT world on The Forge](https://forums.forge-vtt.com/t/how-to-create-a-foundry-vtt-world-on-the-forge/660).
- That guide says a user without Game Manager can install a system "within the Foundry VTT setup menu, or from our Bazaar Interface". It does not give steps for pasting a system manifest URL. **Documented** (same page).
- Game Manager users do not install a system separately: The Forge installs the system while the world is created, and the system cannot be changed afterwards. The setup-menu manifest method does not work when Game Manager is on. **Documented** (same page).
- Creator guides for modules describe the Bazaar's "Install From Manifest" entry in the left sidebar, a manifest link field, and a toggle "Install from the Bazaar if the package is found" (leave it on), e.g. [Loading content](https://www.patreon.com/posts/102188975). These are modules, written by third parties, 2020 to 2024. **Documented for modules only; for systems Unverified.**

### Steps to try (in this order; stop at the first that works)

1. Without Game Manager: open the Forge game's setup screen, System tab, Install System, paste the manifest URL, Install. (The Forge's guide names this route; the paste step for a system is **Unverified**.)
2. Bazaar: Install From Manifest, paste the manifest URL, keep "Install from the Bazaar if the package is found" on. (**Unverified** for systems.)
3. With Game Manager only: a custom system may not be installable through it at all. Whether Game Manager accepts a custom system manifest is **Unverified**; if it does not, steps 1 or 2 need Game Manager turned off.

### Foundry version

- Foundry v14 is available on The Forge. In April 2026 The Forge said it was available but not yet in the Recommended channel, and advised not updating yet; it expected to move it "in the next few weeks". [April 2026 developer update](https://blog.forge-vtt.com/april-2026-developer-update/). **Documented, but dated**; the current channel is **Unverified**.
- A game can choose Forge Recommended, Latest, or one fixed version. [Foundry VTT version selection](https://forums.forge-vtt.com/t/foundry-vtt-version-selection/16637) (January 2022 page). Set the game to a v14 build before installing; a system whose `compatibility.minimum` is 14 will not load on v13.

### Dependency on socketlib

- A 2021 Forge changelog line says The Forge will "Automatically install package dependencies when installing a world". [Forge Server changelog archives](https://forums.forge-vtt.com/t/forge-server-changelog-archives/10721). A moderator on another thread says dependencies should install automatically but can fail, and the fix was to install the dependency from the Bazaar directly and restart. [Vaesen premium module JAL dependency](https://forums.forge-vtt.com/t/vaesen-premium-module-jal-dependency/15523).
- Whether installing a custom system by manifest pulls in `socketlib` is **Unverified**. Install socketlib from the Bazaar first and enable it in the world. The system relays many player actions to the GM through socketlib, so without it those actions fail.
- Whether socketlib works on The Forge is **Unverified** (no Forge statement found). The module is widely used, but we have no source.

### Updates

The manifest URL points at "latest release", so a Forge update check reads the newest release's `system.json`. A prerelease tag (a version with a dash) is marked as a prerelease and is not "latest". Because a prerelease is never `releases/latest`, the first public release must be a full release, or the `latest/download` manifest URL will not resolve.

## 3. What to expect from the Sourcery import

The importer (Configure Settings, Sourcery Importer, GM only: the menu is `restricted`) reads PDFs you own in your browser. Nothing is uploaded to a server except the resulting world compendium documents.

How it works, from our code:

- **File input.** A browser file input; the file is read with `file.arrayBuffer()` in the tab. It does not use Foundry's FilePicker, so it does not depend on the Forge's Data or Assets sources. (`src/apps/sourcery-importer.mjs`)
- **pdf.js.** Loaded by dynamic `import()` of `scripts/pdfjs/build/pdf.mjs` and its worker `pdf.worker.mjs`, both routed through `foundry.utils.getRoute`, which adds the route prefix when one is set ([getRoute](https://foundryvtt.com/api/v14/functions/foundry.utils.getRoute.html)). Nothing is bundled. Foundry 14.361 and later restrict modules to the pdf.js that Foundry ships ([PDF Pager notice](https://www.foundryvtt-hub.com/package/pdf-pager)), which is the library we use.
- **Recipes.** The anchor files under `systems/sprinter-rpg/src/content/sourcery/` are fetched with `getRoute`.
- **Compendiums.** `CompendiumCollection.createCompendium({ packageType: 'world' })` creates world packs named `world.sourcery-*`; documents are created with `keepId`. A Gamemaster must run it (Foundry documents GM-only for deleting world packs; it does not state the creation rule, **Unverified**) ([CompendiumCollection](https://foundryvtt.com/api/v14/classes/foundry.documents.collections.CompendiumCollection.html)).
- **Catalog.** A world setting `sourceryCatalog` records the packs; the content provider registers them at start-up.

What The Forge says that matters here:

- World compendium databases live in the Data Library quota (worlds, custom systems, custom modules), not the Assets Library. [Managing storage on The Forge](https://forums.forge-vtt.com/t/managing-storage-on-the-forge-your-asset-and-data-library/15307). **Documented.**
- The quotas per plan are on [forge-vtt.com/plans](https://forge-vtt.com/plans); a forum summary lists 500 MB, 1 GB and 2 GB of game data for the paid tiers ([Noob Questions](https://forums.forge-vtt.com/t/noob-questions-game-data-and-assets/8388/2) and the plans page; the table was hard to read, **check the live page**). The Forge says a typical world uses 5 to 10 MB and a large one about 20 MB. An imported canon set is a few megabytes of text; its measured size is **Unverified**.
- A forum reply (poster's role not stated) says there should be no difference in how the file picker works on Foundry and The Forge ([thread](https://forums.forge-vtt.com/t/attempting-to-import-csv-using-a-module/17828)). That thread was about the FilePicker, which we do not use for the import.

Unknown, so not promised: whether The Forge serves `scripts/pdfjs/build/pdf.worker.mjs` from the same origin as the game page (a cross-origin worker makes pdf.js fall back to running on the main thread, which is slower but works), whether any content-security policy blocks the worker (no Forge source found), and how long a 600-page book takes in a Forge-hosted tab.

## 4. Known limits and gaps

- No Forge source was found on: serving of `scripts/pdfjs/`, a content-security policy for game pages, compendium creation by a GM, a size limit per compendium, or custom system install through Game Manager. They are all unverified.
- The Forge says its assets library is reachable from any origin ([Getting CORS errors](https://forums.forge-vtt.com/t/getting-cors-errors-when-trying-to-access-asset-library/18139), a user thread, the speaker's role is not stated). The system makes one cross-origin request of its own: `styles/cog.css` line 5 imports the Google Fonts stylesheet from `fonts.googleapis.com`, and that stylesheet points the browser at Google's font files. A strict content-security policy on a host that blocks Google's font hosts would stop them loading. The text then falls back to the next family in each `font-family` stack: `sans-serif` for Oswald, and `'Arial Narrow'` then `sans-serif` for Roboto Condensed, so the layout still renders in a plain sans-serif face. **Unverified** on a live game.
- The system's own files (templates, styles, language file) are loaded by relative `systems/sprinter-rpg/...` paths, which Foundry resolves. The GM's character sheet PDF (a world setting, not shipped) is fetched through `getRoute` so a route prefix cannot break it.
- Direct use of the FilePicker: only the profile image picker (`src/sheets/base/sheet-mixin.mjs`), which uses Foundry's default sources. On The Forge, pick images from the Assets Library. The picker's Data source is restricted on The Forge (a developer said modules cannot create folders in the data directory, [thread](https://forums.forge-vtt.com/t/uploading-monsters-spells-and-items-from-ddb-via-vttassets/304), an older statement; **Unverified** today). The system never writes files to Data.
- Code that ships to players has no Node file-system dependency in the browser path. The character sheet PDF export loads Node's file-system module only when running under Node, through a variable specifier, so it never loads in the browser. `lib/pdf-lib.mjs` loads `createRequire` only under Node.
- The Sourcery import needs the GM to have the PDFs on the computer running the browser. It cannot run on a phone-only setup.
