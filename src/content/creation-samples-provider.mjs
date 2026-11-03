/**
 * src/content/creation-samples-provider.mjs
 * The sample crawler-creation provider: registers the original sample species (with its background matrices) and the
 * sample story tables (`../data/creation-samples.mjs`) and the 68 Base Skills (the 44 sample skills the backgrounds offer, the weapon, unarmed and natural skills, and one extra)
 * (promoted into the Base Skills example set, `./specs/examples/items/base-skills.mjs`, which is the `shiny` skill catalog) under the built-in `shiny` theme, so a new world on
 * the default theme can pick backgrounds, skills and story traits in the crawler creator. The Base Set's spells, classes and
 * races (`./specs/examples/items/base-set.mjs`) are the `shiny` spell, class and race catalogs; every Base document (the
 * Base Skills and the Base Set, debuffs included) is also registered as a reference, so an identifier resolves under any theme. A content theme (`cog`) and a Sourcery
 * import register their own species and tables under their own theme; the samples never reach those themes.
 *
 * Nothing registers at import time. cog.mjs calls `installCreationSamplesHook()` once at load; the tests call
 * `registerCreationSamples` directly.
 */
import { contentRegistry } from './registry.mjs';
import { compileSpecs } from '../data/builders/item-payload.mjs';
// Registers the race and class delegates, which compile the Base Set's classes and races (the point-buy compiler is pure).
import '../data/builders/point-buy-payload.mjs';
import { SPECS as BASE_SKILL_SPECS } from './specs/examples/items/base-skills.mjs';
import { SPECS as BASE_SET_SPECS } from './specs/examples/items/base-set.mjs';
import { SAMPLE_CRAWLER_SPECIES, SAMPLE_BACKGROUND_TABLES } from '../data/creation-samples.mjs';

export const SAMPLES_THEME_ID = 'shiny';
export const SAMPLES_PROVIDER = 'sprinter-rpg-samples';

/** The Base Set documents of one type, compiled the way `build:packs` compiles them (classes and races through their builders). */
function compiledBaseSet(type) {
  return compileSpecs(BASE_SET_SPECS.filter(spec => spec.type === type), { warnings: [], dataModel: false });
}

/**
 * Register the Base Skills and Base Set, the species and the story tables under the `shiny` theme, at the lowest priority so any provider that
 * registers the same id there wins.
 * @param {import('./registry.mjs').COGContentRegistry} [registry=contentRegistry]
 */
export function registerCreationSamples(registry = contentRegistry) {
  if (!registry) return;
  const opts = { theme: SAMPLES_THEME_ID, priority: 0, provider: SAMPLES_PROVIDER };
  // The same compile path as the bundled catalogs (`compiledSpecs`): complete skill specs, no budget builder.
  const skills = compileSpecs(BASE_SKILL_SPECS, { warnings: [], delegate: false, dataModel: false });
  registry.registerCatalog('skills', skills, opts);
  // Referenceable under every theme: a Base identifier resolves after a theme switch, never offered by a picker there.
  registry.registerReferences('skills', skills);
  for (const [kind, type] of [['spells', 'spell'], ['classes', 'class'], ['races', 'race'], ['debuffs', 'debuff']]) {
    const docs = compiledBaseSet(type);
    if (kind !== 'debuffs') registry.registerCatalog(kind, docs, opts);
    registry.registerReferences(kind, docs);
  }
  registry.registerSpecies(SAMPLE_CRAWLER_SPECIES.id, structuredClone(SAMPLE_CRAWLER_SPECIES), opts);
  registry.registerBackgroundTables(structuredClone(SAMPLE_BACKGROUND_TABLES), opts);
}

/** Listen to `sprinter-rpg.registerContent` and register the samples. Called once at load by cog.mjs. */
export function installCreationSamplesHook() {
  globalThis.Hooks?.on?.('sprinter-rpg.registerContent', registry => registerCreationSamples(registry));
}
