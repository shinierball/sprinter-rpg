/**
 * Hiding AI-written content (7.16f): the part of the `aiContent` setting's change that is not UI. Hiding works like turning
 * a theme off: lists stop offering the documents (`isContentOff`, the authorship rule of `OFF_RULES`), and AI-written
 * documents already on actors are offered for replacement by Celestial AI Poop through the theme cleanup. No starter kit
 * stays behind, so with nothing human-written left the race and class lists are empty; the change asks first, and the
 * crawler creator says why.
 */
import { contentRegistry } from './registry.mjs';
import { catalogEntries } from './catalog-lookup.mjs';
import { readAuthorship, readSourceStamp } from '../utils/content-source.mjs';

/** The level the setting last applied (null until `noteAppliedAiLevel` runs at ready); the answer to "back to what?". */
let appliedLevel = null;

/** Record the level in force (at ready, and after a change is applied). */
export function noteAppliedAiLevel(level) {
  appliedLevel = level;
}

/**
 * The creator lists that nothing would fill at `level` (default: the current one): `['races']`, `['classes']`, both or none.
 * An entry counts when its theme is on and its authorship is not hidden at `level`.
 * @param {string} [level]
 * @param {import('./registry.mjs').COGContentRegistry} [registry]
 * @returns {Array<'races'|'classes'>}
 */
export function emptyCreatorLists(level = contentRegistry.getAiContentLevel(), registry = contentRegistry) {
  const offered = (def) => !registry.isThemeOff(readSourceStamp(def)?.theme) && !registry.isAuthorshipHidden(readAuthorship(def), level);
  return ['races', 'classes'].filter((kind) => !catalogEntries(kind).some(offered));
}

/**
 * Apply a change of the `aiContent` setting. The confirmation (a plain prompt, never a block) shows only when the new level
 * is a hide level and races or classes would be empty (from one hide level to another, only a list that move empties); declining sets the setting back.
 * Afterwards CONFIG is re-synced, open managers and creators redraw, and the cleanup is offered.
 * @param {object} params
 * @param {string} params.level the new level (already stored)
 * @param {(empty: string[]) => Promise<boolean>} [params.confirm] asked before a hide level that empties a creator list
 * @param {(previous: string) => Promise<void>} [params.revert] puts the setting back
 * @param {() => void} [params.sync] re-syncs CONFIG
 * @param {() => void} [params.refresh] redraws open managers, creators and compendium directories
 * @param {() => Promise<unknown>} [params.prompt] offers the cleanup
 * @param {boolean} [params.ask=true] whether this client asks, reverts and offers the cleanup (the GM who made the change)
 * @returns {Promise<{ applied: boolean, reverted: boolean, empty: string[] }>}
 */
export async function applyAiContentChange({ level, confirm, revert, sync, refresh, prompt, ask = true }) {
  const previous = appliedLevel ?? 'show';
  const hides = level === 'hide-ai' || level === 'hide-ai-edited';
  // Moving from one hide level to another asks only about a list this move empties; leaving `show` asks about every empty list.
  const before = hides && previous !== 'show' ? emptyCreatorLists(previous) : [];
  const empty = hides ? emptyCreatorLists(level).filter((kind) => !before.includes(kind)) : [];
  if (ask && empty.length && confirm && !(await confirm(empty))) {
    await revert?.(previous);
    return { applied: false, reverted: true, empty };
  }
  appliedLevel = level;
  sync?.();
  refresh?.();
  if (ask) await prompt?.();
  return { applied: true, reverted: false, empty };
}

/** Whether the registry is hiding anything right now (the crawler creator's "why empty" line asks). */
export function aiContentIsHidden(registry = contentRegistry) {
  return registry.getAiContentLevel() !== 'show';
}
