/**
 * src/content/visibility.mjs
 * Which documents the system ships hidden. A book document (one with an anchors entry, `book-ids.mjs`) is in no
 * system pack and no bundled catalog; the importer writes it only when the owner's PDF had its entry. Our own documents
 * are shown. Pure and browser-safe; it names no document.
 */
import { BOOK_IDS } from './book-ids.mjs';

/** True when `id` is a book document id. */
export function isHiddenId(id) {
  return typeof id === 'string' && BOOK_IDS.has(id);
}

/** True when a document (or compiled spec) carries a hidden id. */
export function isHiddenDoc(doc) {
  return isHiddenId(doc?._id ?? doc?.id);
}
