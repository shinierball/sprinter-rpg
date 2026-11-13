/**
 * Source badge on compendium entries (7.7e). `renderCompendium` (ApplicationV2: `(app, element, context, options)`)
 * adds the source chip, without text, to each directory entry. The stamp comes from the pack index
 * (`flags.sprinter-rpg.source`, listed in `compendiumIndexFields`), so no document loads. A pack holds only the
 * server's default index until `getIndex()` runs, so the index is loaded on first open (once per pack, lazily) and
 * the entries are decorated again when it arrives. Only the stamp is read,
 * never a name, a pack label or a folder. An entry without a valid stamp is left alone, whatever pack it is in.
 */
import { sourceBadge, readAuthorship } from '../utils/content-source.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { escapeAttr } from '../utils/escape-attr.mjs';

const ENTRY = '[data-entry-id], [data-document-id]';
const CHIP = '.cog-compendium-source-chip';

/** Pack index entry for an id, or null. */
function indexEntry(collection, id) {
  try {
    return collection?.index?.get?.(id) ?? null;
  } catch { return null; }
}

const HIDDEN_CLASS = 'cog-authorship-hidden';
const HIDDEN_NOTE = 'cog-authorship-hidden-note';

/**
 * Hides a directory entry whose index stamp carries an authorship the `aiContent` setting hides (7.16f), or shows it again.
 * Reads only the stamp; an entry with no stamp, no authorship or an unregistered one stays. Idempotent.
 * @returns {boolean} whether the entry is hidden now
 */
export function applyAuthorshipHiding(entry, collection, registry = contentRegistry) {
  const id = entry.dataset?.entryId ?? entry.dataset?.documentId;
  const index = id ? indexEntry(collection, id) : null;
  const hidden = Boolean(index) && registry.isAuthorshipHidden(readAuthorship(index));
  entry.classList?.toggle?.(HIDDEN_CLASS, hidden);
  return hidden;
}

/** Adds (or refreshes) the chip on one directory entry. Never throws. */
export function decorateEntry(entry, collection) {
  try {
    const id = entry.dataset?.entryId ?? entry.dataset?.documentId;
    const index = id ? indexEntry(collection, id) : null;
    const badge = index ? sourceBadge(index) : null;
    const existing = entry.querySelector(CHIP);
    if (!badge) { existing?.remove(); return; }
    const key = [badge.theme, badge.set, badge.authorship?.id].filter(Boolean).join('/');
    if (existing?.dataset.cogSource === key) return;
    existing?.remove();
    const chip = entry.ownerDocument.createElement('span');
    chip.className = 'cog-provenance-chip cog-fg-dyn cog-compendium-source-chip';
    chip.dataset.provenance = 'source';
    chip.dataset.cogSource = key;
    chip.dataset.tooltip = badge.tooltip;
    chip.style.setProperty('--cog-fg-dyn', `var(${badge.color})`);
    chip.innerHTML = `<i class="${escapeAttr(badge.icon)}"></i> ${escapeAttr(badge.symbol)}`
      + (badge.authorship ? `<i class="cog-authorship-glyph ${escapeAttr(badge.authorship.icon)}" data-authorship="${escapeAttr(badge.authorship.id)}"></i>` : '');
    entry.append(chip);
  } catch (err) {
    console.warn('Sprinter RPG | compendium source badge skipped an entry', err);
  }
}

/** The "N AI-written entries hidden" line at the top of the directory: one element, updated or removed in place. */
function showHiddenCount(root, count) {
  const existing = root.querySelector(`.${HIDDEN_NOTE}`);
  if (!count) { existing?.remove(); return; }
  const text = globalThis.game?.i18n?.format?.('COG.AiContent.HiddenCount', { count }) ?? `${count} AI-written entries hidden`;
  if (existing) { existing.textContent = text; return; }
  const note = root.ownerDocument.createElement('p');
  note.className = HIDDEN_NOTE;
  note.textContent = text;
  const list = root.querySelector(ENTRY)?.parentElement;
  (list?.parentElement ?? root).insertBefore(note, list ?? null);
}

/** Decorates every entry of a rendered compendium. */
export function decorateCompendium(app, html) {
  try {
    const root = html?.[0] ?? html ?? app?.element;
    if (!root?.querySelectorAll) return;
    const collection = app?.collection;
    let hiddenCount = 0;
    for (const entry of root.querySelectorAll(ENTRY)) {
      decorateEntry(entry, collection);
      if (applyAuthorshipHiding(entry, collection)) hiddenCount += 1;
    }
    showHiddenCount(root, hiddenCount);
  } catch (err) {
    console.warn('Sprinter RPG | compendium source badges skipped', err);
  }
}

const pending = new WeakSet();

/** Decorates now, then loads the full index once if the pack lacks it and decorates the current root again. */
export function decorateCompendiumLoadingIndex(app, html) {
  decorateCompendium(app, html);
  const collection = app?.collection;
  if (!collection || typeof collection.getIndex !== 'function' || collection.indexed === true || pending.has(collection)) return;
  pending.add(collection);
  const root = html?.[0] ?? html ?? app?.element;
  Promise.resolve().then(() => collection.getIndex()).then(() => {
    const live = root?.isConnected === false ? app?.element : root;
    decorateCompendium(app, live ?? root);
  }).catch((err) => {
    console.warn('Sprinter RPG | compendium index could not be loaded for source badges', err);
  }).finally(() => pending.delete(collection));
}

export function registerCompendiumBadgeHooks() {
  Hooks.on('renderCompendium', (app, element) => decorateCompendiumLoadingIndex(app, element));
}
