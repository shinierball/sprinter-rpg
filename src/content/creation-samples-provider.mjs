/**
 * src/content/creation-samples-provider.mjs
 * The sample crawler-creation provider: registers the original sample species (with its background matrices) and the
 * sample story tables (`../data/creation-samples.mjs`) and the 44 sample skills the backgrounds offer
 * (`../data/creation-sample-skills.mjs`, the `shiny` skill catalog) under the built-in `shiny` theme, so a new world on
 * the default theme can pick backgrounds, skills and story traits in the crawler creator. A content theme (`cog`) and a Sourcery
 * import register their own species and tables under their own theme; the samples never reach those themes.
 *
 * Nothing registers at import time. cog.mjs calls `installCreationSamplesHook()` once at load; the tests call
 * `registerCreationSamples` directly.
 */
import { contentRegistry } from './registry.mjs';
import { compileSpecs } from '../data/builders/item-payload.mjs';
import { SAMPLE_SKILL_SPECS } from '../data/creation-sample-skills.mjs';
import { SAMPLE_CRAWLER_SPECIES, SAMPLE_BACKGROUND_TABLES } from '../data/creation-samples.mjs';

export const SAMPLES_THEME_ID = 'shiny';
export const SAMPLES_PROVIDER = 'sprinter-rpg-samples';

/**
 * Register the sample skills, species and story tables under the `shiny` theme, at the lowest priority so any provider that
 * registers the same id there wins.
 * @param {import('./registry.mjs').COGContentRegistry} [registry=contentRegistry]
 */
export function registerCreationSamples(registry = contentRegistry) {
  if (!registry) return;
  const opts = { theme: SAMPLES_THEME_ID, priority: 0, provider: SAMPLES_PROVIDER };
  // The same compile path as the bundled catalogs (`compiledSpecs`): complete skill specs, no budget builder.
  registry.registerCatalog('skills', compileSpecs(SAMPLE_SKILL_SPECS, { warnings: [], delegate: false, dataModel: false }), opts);
  registry.registerSpecies(SAMPLE_CRAWLER_SPECIES.id, structuredClone(SAMPLE_CRAWLER_SPECIES), opts);
  registry.registerBackgroundTables(structuredClone(SAMPLE_BACKGROUND_TABLES), opts);
}

/** Listen to `sprinter-rpg.registerContent` and register the samples. Called once at load by cog.mjs. */
export function installCreationSamplesHook() {
  globalThis.Hooks?.on?.('sprinter-rpg.registerContent', registry => registerCreationSamples(registry));
}
