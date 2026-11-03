/**
 * src/content/visibility.mjs
 * Which documents the system ships hidden. A book document (one with an anchors entry, `book-ids.mjs`) is in no
 * system pack and no bundled catalog; the importer writes it only when the owner's PDF had its entry. Our own documents
 * are shown. Pure and browser-safe; it names no document.
 */
import { BOOK_IDS } from './book-ids.mjs';

/**
 * Id -> reason, for runtime code that may name a hidden document. Every key is a book id (tests/content/no-book-shown-6-6).
 *   tag-expansion  a tag's `references` expansion, not a link: it takes effect once the book's document is imported
 *   private-tool   a maintainer tool that is not published and only proposes rows for imported perks
 */
export const RUNTIME_REF_ALLOW = Object.freeze({
  dccskl0000000012: 'tag-expansion',
  dccskl0000000015: 'tag-expansion',
  dccamr0000000006: 'private-tool',
  dccitm0000000012: 'private-tool'
});

/** True when `id` is a book document id. */
export function isHiddenId(id) {
  return typeof id === 'string' && BOOK_IDS.has(id);
}

/** True when a document (or compiled spec) carries a hidden id. */
export function isHiddenDoc(doc) {
  return isHiddenId(doc?._id ?? doc?.id);
}
