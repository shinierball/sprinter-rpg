/**
 * Draft providers: the seam where a module offers to write the draft itself (step doc 7.43 section 2.10). A provider is
 * `{ id, label, generate }`; `generate({ words, prompt, vocabulary })` resolves to the reply text or to the draft object, and
 * the bridge window sends the result through the same check and review as a pasted reply. The system ships none and makes
 * no network call; a module that wants one registers it. `CONFIG.COG.draftProviders` is this object.
 */

/** @type {Record<string, { id: string, label: string, generate: Function }>} The registry, in registration order. */
export const DRAFT_PROVIDERS = {};

const PROVIDER_ID = /^[A-Za-z][\w.-]*$/;

/**
 * Add (or replace) a provider. A module prefixes its own id (`my-module.assistant`).
 * @param {{ id: string, label: string, generate: (input: { words: string, prompt: string, vocabulary: object }) => Promise<string|object> }} def
 * @returns {boolean} whether it was registered; a malformed one is refused with a console warning
 */
export function registerDraftProvider(def) {
  const id = def?.id;
  const problem = typeof id !== 'string' || !PROVIDER_ID.test(id) ? 'it needs an id of letters, digits, _, . or -, starting with a letter'
    : typeof def.label !== 'string' || !def.label.trim() ? 'it needs a label'
      : typeof def.generate !== 'function' ? 'it needs a generate function'
        : '';
  if (problem) {
    console.warn(`Sprinter RPG | Draft provider ${String(id)} was not registered: ${problem}.`);
    return false;
  }
  DRAFT_PROVIDERS[id] = { id, label: def.label.trim(), generate: def.generate };
  return true;
}

/** Empty the registry (a test reset hook). */
export function _resetDraftProviders() {
  for (const id of Object.keys(DRAFT_PROVIDERS)) delete DRAFT_PROVIDERS[id];
}
