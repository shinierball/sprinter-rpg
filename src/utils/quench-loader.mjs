/**
 * Loads the Quench integration suite only when the "quench" module is active.
 * The import is dynamic so normal play never fetches anything under tests/.
 */
const QUENCH_MODULE_ID = 'quench';

/** The browser's wording for a dynamic import that failed: Chromium, Firefox and Safari. */
const BROWSER_IMPORT_FAILURE = /dynamically imported module|Importing a module script failed/i;

/**
 * True when the suite's entry point is simply absent: neither a packaged install nor the public repository has a tests/ folder. Node reports the
 * missing file with its code; a browser reports a failed dynamic import as a TypeError.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isMissingSuiteError(err) {
  if (err?.code === 'ERR_MODULE_NOT_FOUND') return true;
  return err instanceof TypeError && BROWSER_IMPORT_FAILURE.test(String(err.message ?? ''));
}

/**
 * @param {object} [options]
 * @param {object} [options.gameRef=globalThis.game]
 * @param {() => Promise<object>} [options.importer] - Loader for the suite entry point.
 * @returns {Promise<boolean>} true when the suite was loaded and wired.
 */
export async function loadQuenchSuite({
  gameRef = globalThis.game,
  importer = () => import('../../tests/quench/index.mjs')
} = {}) {
  if (!gameRef?.modules?.get(QUENCH_MODULE_ID)?.active) return false;
  try {
    const suite = await importer();
    suite.initQuenchSuite();
    return true;
  } catch (err) {
    if (isMissingSuiteError(err)) {
      console.info('Sprinter RPG | Quench is active, but its suite is not part of this install.');
    } else {
      console.warn('Sprinter RPG | Quench is active but the integration suite could not be loaded:', err);
    }
    return false;
  }
}
