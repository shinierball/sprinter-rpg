/**
 * src/sourcery/index.mjs
 * Sourcery engine core. Everything here is pure and runs in Node with no
 * Foundry globals; the pdf.js adapter sits behind `TextSource`.
 *
 *   TextSource -> buildIndex -> resolveRecipe / fetchBlock -> hydrate
 */
export { sha256 } from './hash.mjs';
export { normalizeHeading, normalizeBody, unwrap, headingKeys, headingHash, bodyPrefixHash, PREFIX_CHARS, lineHash, LINE_WORDS, MAX_LINE_WORDS } from './normalize.mjs';
export { escapeHtml, plainText, paragraphsHtml, titleCaseHeading, casingMask, applyCasingMask, applyNameEdits, displayName } from './text.mjs';
export { MemoryTextSource, sanitizeItem, sanitizePage, DEFAULT_PAGE_HEIGHT } from './text-source.mjs';
export { PdfJsTextSource, PDFJS_OPTIONS, openPdfJsDocument } from './pdfjs-source.mjs';
export { buildRuns, itemsToText, styleOf } from './runs.mjs';
export { buildIndex, inMargin, runOf } from './indexer.mjs';
export { GRAMMARS, KINDS, grammarFor } from './grammars.mjs';
export { collectBlock, paragraphs, sliceBlock, cleanLine } from './slicer.mjs';
export { readAnchor, readAnchorsEntry, readAnchorsFile, readPicks, readNameEdits, isSourceKey, readTargetPath } from './anchors.mjs';
export {
  candidatesFor, pickCandidate, estimateShift, resolveAnchor, resolveRecipe, fetchBlock, blockForHit, prefixSource, sourceText, blockPrefixHash, findLine,
  applyPicks, keepOnly
} from './resolver.mjs';
export { FIELD_MAPS, fieldMapFor } from './field-maps.mjs';
export { hydrate, hydrateWithReport, FLAG_SCOPE } from './hydrator.mjs';
export { sliceTable, hydrateTable, hydrateBookTables, similarity, isLayoutHint } from './tables.mjs';
export { readTableRecipe, readTablesFile } from './table-recipes.mjs';
export { rollTableSpec, journalSpec, bookTableSpecs, tablePageHtml, tableName, defaultDocUuid, CELL_JOIN } from './table-builders.mjs';
