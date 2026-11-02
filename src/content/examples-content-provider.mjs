/**
 * src/content/examples-content-provider.mjs
 * The example content provider: registers the example buffs and debuffs as the
 * `buffs`/`debuffs` catalogs of its own theme, `examples` (and, since 3.81, the default `shiny` theme), so the example items that reference them by identifier
 * resolve, plus the two tags the examples carry (the Cue Light module tag and the Live Audience situation). Nothing
 * else: the example skills, spells, gear, loot and actors live in the examples packs and are never registered as
 * catalogs, so creators and pickers do not offer them. The `cog`
 * provider's sections are untouched.
 *
 * Nothing registers at import time. cog.mjs calls `installExampleContentHook()` at load (the release switch,
 * together with the examples packs declared in system.json); the tests and build:packs call the functions
 * directly.
 */
import { contentRegistry } from './registry.mjs';
import { getPackSpecs } from './specs/index.mjs';
import { exampleTagDefinitions } from './specs/examples/refs.mjs';
import { SAMPLES_THEME_ID } from './creation-samples-provider.mjs';
import { compilePackSpecs } from '../data/builders/item-payload.mjs';

export const EXAMPLES_THEME_ID = 'examples';
export const EXAMPLES_PROVIDER = 'sprinter-rpg-examples';

/** Tag ids the examples need, registered once per registry. */
const registered = new WeakSet();

/**
 * Register the tags the example documents carry. build:packs and the tests call this before compiling the examples
 * (the builder's tag check must know them). Idempotent per registry.
 * @param {import('./registry.mjs').COGContentRegistry} [registry=contentRegistry]
 */
export function registerExampleTags(registry = contentRegistry) {
  if (!registry || registered.has(registry)) return;
  registered.add(registry);
  for (const tag of exampleTagDefinitions()) registry.registerTag(tag, { priority: 1 });
}

/**
 * The compiled example buffs and debuffs (the same specs build:packs compiles into examples-items).
 * @returns {{ buffs: object[], debuffs: object[] }}
 */
export function compiledExampleConditions() {
  const entry = getPackSpecs('examples-items');
  const docs = entry ? compilePackSpecs(entry, { warnings: [], dataModel: false }) : [];
  return {
    buffs: docs.filter(doc => doc.type === 'buff'),
    debuffs: docs.filter(doc => doc.type === 'debuff')
  };
}

/**
 * Register the example theme, its buff and debuff catalogs and the example tags.
 * @param {import('./registry.mjs').COGContentRegistry} [registry=contentRegistry]
 */
export function registerExampleContent(registry = contentRegistry) {
  if (!registry) return;
  registry.registerTheme(EXAMPLES_THEME_ID, {
    label: 'Example Content',
    description: 'The system\'s original example content: buffs and debuffs the example items reference. The example items and actors are in the Example Content compendiums.'
  }, { priority: 1, provider: EXAMPLES_PROVIDER });
  registerExampleTags(registry);
  const opts = { theme: EXAMPLES_THEME_ID, priority: 1, provider: EXAMPLES_PROVIDER };
  const { buffs, debuffs } = compiledExampleConditions();
  registry.registerCatalog('buffs', buffs, opts);
  registry.registerCatalog('debuffs', debuffs, opts);
  // new world's default theme is `shiny`, so the example items' effects resolve there too.
  // The store key carries the theme, so this second registration sits beside the first and replaces nothing. There is no
  // fallback across themes: bundled mobs and scrolls still resolve no effects under `shiny` until the world switches theme.
  const shinyOpts = { ...opts, theme: SAMPLES_THEME_ID };
  registry.registerCatalog('buffs', buffs, shinyOpts);
  registry.registerCatalog('debuffs', debuffs, shinyOpts);
  // Referenceable under every theme (the `cog` theme included), never offered by a picker or creator there (3.85).
  registry.registerReferences('buffs', buffs);
  registry.registerReferences('debuffs', debuffs);
}

/** Listen to `sprinter-rpg.registerContent` and register the examples. Called once at load by cog.mjs. */
export function installExampleContentHook() {
  globalThis.Hooks?.on?.('sprinter-rpg.registerContent', registry => registerExampleContent(registry));
}
