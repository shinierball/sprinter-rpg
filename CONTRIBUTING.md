Feel free to use this as you will or fork it.  Happy to talk shop if you want to hit me up on discord if you can find me or shinierball on that gmail thing if you are good with email.  Good luck and have fun.

## How this repository works

This repository is a copy of each release. Development happens in a private repository, and each release replaces the whole tree here, so pull requests are not merged. Issues are welcome.

A pull request is still welcome as a suggestion: the owner reads it, and a change worth having is written again in the private repository, where it goes through the same checks as everything else. A pull request is public as soon as it is opened, so please do not paste text from a rulebook into one, even to explain a rule: cite the book and the page.

This repository holds the files the system runs from and a few guides for module authors. It has no tests, scripts or build, so some instructions below refer to things you will not find here.

## The rules this code is built to

Comments in the code cite these as `CONTRIBUTING rule N` and `CONTRIBUTING §N`.

### Rules

0. **When in doubt, ask.** Clear up an underspecified requirement before writing code.
1. **This game's mechanics only.** Formulas and terms follow the rules this system implements. Nothing comes in from other RPGs.
2. **Permissive adjudication.** The system works out and shows budgets, costs and limits, and never hard-blocks a player or GM. Past a limit, a short confirmation asks whether to go ahead as a Rule Break. If so, the action proceeds and records `ruleBreak: true`, and the GM rules on it.
3. **Tests.** Every feature, schema change and fix has unit tests over real logic, and done means lint and the tests pass with 0 failures. The tests live in the private repository where the system is developed, not in this one.
4. **Eat your own dog food.** Bundled content goes through the builders (`buildPayload(spec)`) and tag APIs that users have.
5. **Reuse.** Use what Foundry or this code already provides before writing a new one: logic, data shapes, CSS and interfaces.

### Architecture

1. **Tags are the extension fabric.** Subtypes, tiers, damage types and conditions are namespaced tags paired with a registry (`CONFIG.COG.<registry>`, `ContentRegistry`), not closed enums, so a module can add to them without a schema change. Check them with `hasTag()` and `matchesTagQuery()`.
2. **Text is for humans.** Mechanics read structured fields, tags and ids. Never parse names, descriptions or notes at runtime. Text may become data only at authoring time, where the author reviews the result.
3. **Builders create once.** A creator is a pure `buildPayload(spec)` with a separate app, used only to make new documents. Later edits happen on the live sheet, which has no wizards or draft forms.
4. **Sanitize what comes in.** Imported and user data may hold arrays or comma lists where a string belongs. Validate it, and fall back safely on a missing registry entry.
5. **Keep forms intact.** `name="system.path"` is only for a primary input, and never twice in one form, since Foundry packs duplicates into arrays. Other controls use `data-action`. Precompute option lists in the sheet's context, and register new partials in `preloadTemplates` or the sheet's `PARTS`.
6. **Theme.** Use the theme tokens in `styles/`, Oswald for headings, and clear state badges.
7. **Example content.** A release that adds a tag, row kind, schema field or creator control ships examples that use it, as spec files under `src/content/specs/examples/`, compiled into the example compendiums when a release is built. An example mob, race, class or crawler must be possible to make in its creator.

### Book content

The books' flavour text, descriptions, and character and place names stay out of this repository; owners bring them in from their own PDFs through the Sourcery importer. Examples are original, not adapted from the books.

Before a release is published, it is scanned against the book text, and the packaged zip is scanned for names the project must not carry.

### Document ids

A bundled document's `_id` is 16 characters: the `dcc` prefix, a kind, a 3-digit block, and a serial that fills the rest. Block `000` holds every id that existed before blocks and is frozen; new ids are allocated in another block. An id names the entry, not its text: rewording or renaming an entry keeps its id, and a removed id is never reused.

Modules and homebrew do not use the `dcc` prefix; use Foundry's own random ids or a prefix of your own. Nothing reads meaning from an id or its block. If code needs to know a document's source, kind or tier, it reads a real field or tag.
