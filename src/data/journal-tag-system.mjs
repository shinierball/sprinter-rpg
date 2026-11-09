import { SYSTEM_ID } from '../constants.mjs';
import { AUTHORING_PAGES } from './journal-tag-system/pages-authoring.mjs';
import { ENGINE_PAGES } from './journal-tag-system/pages-engine.mjs';
import { REFERENCE_PAGES } from './journal-tag-system/pages-reference.mjs';

/**
 * Sprinter RPG — Tag System & Content Creation Guide
 *
 * Multi-page in-game Journal Entry and reference documentation
 * explaining the data-driven Unified Tagging System, item creation,
 * secondary skill mechanics, favored spells, and structured grants.
 * Fully supports light mode and dark mode via semantic CSS classes.
 */

export const TAG_SYSTEM_JOURNAL_DATA = {
  name: "Sprinter RPG — Tag System & Content Creation Guide",
  // `version` is stamped from the installed system's manifest when the payload is built (tagSystemJournalPayload).
  flags: {
    [SYSTEM_ID]: {
      guideKey: "tagSystemGuide"
    }
  },
  pages: [...AUTHORING_PAGES, ...ENGINE_PAGES, ...REFERENCE_PAGES]
};

/**
 * Materialise the journal data into plain create data. Page 5's `text.content` is a getter
 * (its lore text is localized when read, after i18n is ready), and Foundry's
 * `JournalEntryPage.cleanData` assigns to `text.content` on the source object, which throws on
 * an accessor property ("Cannot set property content … which has only a getter"). Resolving every
 * page into own data properties here keeps the create payload writable.
 * @returns {{ name: string, flags: object, pages: object[] }}
 */
export function tagSystemJournalPayload() {
  const flags = foundry.utils.deepClone(TAG_SYSTEM_JOURNAL_DATA.flags);
  // The guide is stamped with the installed system's version (system.json), not a string kept here.
  const version = globalThis.game?.system?.version;
  if (version) flags[SYSTEM_ID].version = String(version);
  return {
    name: TAG_SYSTEM_JOURNAL_DATA.name,
    flags,
    pages: TAG_SYSTEM_JOURNAL_DATA.pages.map((page) => ({
      name: page.name,
      type: page.type,
      title: { ...page.title },
      text: { format: page.text.format, content: String(page.text.content ?? '') }
    }))
  };
}

/**
 * Ensure the official Tag System Guide JournalEntry exists in the world.
 * If missing, creates it. If present, ensures pages are up to date.
 * @returns {Promise<JournalEntry|null>}
 */
export async function ensureTagSystemJournal() {
  const JournalEntryClass = CONFIG.JournalEntry?.documentClass
    ?? globalThis.foundry?.documents?.JournalEntry
    ?? globalThis.JournalEntry;

  if (!JournalEntryClass || !globalThis.game?.journal) {
    return null;
  }

  // Only GM users should attempt to create or populate world documents
  if (globalThis.game?.user && !globalThis.game.user.isGM) {
    const existing = globalThis.game.journal.find(j =>
      j.name === TAG_SYSTEM_JOURNAL_DATA.name ||
      j.flags?.[SYSTEM_ID]?.guideKey === "tagSystemGuide"
    );
    return existing || null;
  }

  let existing = null;
  if (typeof globalThis.game.journal.find === "function") {
    existing = globalThis.game.journal.find(j =>
      j.name === TAG_SYSTEM_JOURNAL_DATA.name ||
      j.flags?.[SYSTEM_ID]?.guideKey === "tagSystemGuide"
    );
  } else if (Array.isArray(globalThis.game.journal)) {
    existing = globalThis.game.journal.find(j =>
      j.name === TAG_SYSTEM_JOURNAL_DATA.name ||
      j.flags?.[SYSTEM_ID]?.guideKey === "tagSystemGuide"
    );
  }

  if (existing) {
    const pageCount = existing.pages?.size ?? (Array.isArray(existing.pages) ? existing.pages.length : 0);
    if (pageCount === 0 && typeof existing.createEmbeddedDocuments === "function") {
      try {
        await existing.createEmbeddedDocuments("JournalEntryPage", tagSystemJournalPayload().pages);
      } catch (err) {
        console.warn("Sprinter RPG | Could not populate pages for Tag System Journal:", err);
      }
    }
    return existing;
  }

  if (typeof JournalEntryClass.create === "function") {
    try {
      const entry = await JournalEntryClass.create(tagSystemJournalPayload(), { renderSheet: false });
      return entry;
    } catch (err) {
      console.warn("Sprinter RPG | Could not create Tag System Journal:", err);
    }
  }

  return null;
}

/**
 * Opens and renders the Tag System Guide journal entry sheet.
 * @returns {Promise<JournalEntrySheet|null>}
 */
export async function openTagSystemJournal() {
  let entry = null;
  if (globalThis.game?.journal) {
    if (typeof globalThis.game.journal.find === "function") {
      entry = globalThis.game.journal.find(j =>
        j.name === TAG_SYSTEM_JOURNAL_DATA.name ||
        j.flags?.[SYSTEM_ID]?.guideKey === "tagSystemGuide"
      );
    } else if (Array.isArray(globalThis.game.journal)) {
      entry = globalThis.game.journal.find(j =>
        j.name === TAG_SYSTEM_JOURNAL_DATA.name ||
        j.flags?.[SYSTEM_ID]?.guideKey === "tagSystemGuide"
      );
    }
  }

  if (!entry) {
    entry = await ensureTagSystemJournal();
  }

  if (entry?.sheet) {
    entry.sheet.render({ force: true });
    return entry.sheet;
  }
  return null;
}
