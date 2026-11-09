/**
 * Compendium sidebar for a theme that is turned off. `renderCompendiumDirectory` hides the directory entry of every pack
 * the content registry lists under an off theme (`getOffPackIds`), and any pack folder left with no visible pack. It hides
 * for everyone and writes no pack configuration, so turning the theme back on shows them again. Only the pack ids the
 * registry knows are touched, never a name or a label; another system's or module's packs are left alone.
 */
import { contentRegistry } from '../content/registry.mjs';

const PACK = 'li[data-pack]';
const FOLDER = 'li[data-folder-id]';
const MARK = 'cogThemeOff';

/** Hides (or shows again) one element, remembering that this hook hid it. */
function setHidden(el, hide) {
  if (hide) {
    el.hidden = true;
    el.dataset[MARK] = '1';
  } else if (el.dataset?.[MARK]) {
    el.hidden = false;
    delete el.dataset[MARK];
  }
}

/**
 * Applies the off list to a rendered compendium directory element. Never throws.
 * @param {HTMLElement|object} html the directory element (or a jQuery-like wrapper)
 * @param {Iterable<string>} [offIds=contentRegistry.getOffPackIds()]
 */
export function hideOffPacks(html, offIds = contentRegistry.getOffPackIds()) {
  try {
    const root = html?.[0] ?? html;
    if (!root?.querySelectorAll) return;
    const off = new Set(offIds);
    for (const el of root.querySelectorAll(PACK)) {
      if (!el?.dataset) continue;
      setHidden(el, off.has(el.dataset.pack));
    }
    // Deepest folders first, so a parent sees its children's final state. A folder that held no pack is not touched.
    const folders = [...root.querySelectorAll(FOLDER)].reverse();
    for (const folder of folders) {
      if (!folder?.dataset) continue;
      const packs = [...folder.querySelectorAll(PACK)];
      if (!packs.length) continue;
      setHidden(folder, packs.every((p) => p.hidden));
    }
  } catch (err) {
    console.warn('Sprinter RPG | the compendium sidebar could not hide the packs of a theme that is off', err);
  }
}

export function registerThemeOffSidebarHooks() {
  Hooks.on('renderCompendiumDirectory', (app, element) => hideOffPacks(element ?? app?.element));
}
