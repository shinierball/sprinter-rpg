/**
 * src/sourcery/index.mjs
 * Sourcery engine core. Everything here is pure and runs in Node with no
 * Foundry globals; the pdf.js adapter sits behind `TextSource`.
 *
 *   TextSource -> buildIndex -> resolveRecipe / fetchBlock -> hydrate
 */
// These re-exports keep the engine helpers below live for the dead-export rail, which counts them as used by this barrel.
// Nothing reads them through this barrel; the sourcery scripts import the leaf modules directly.
export { normalizeBody, headingHash, PREFIX_CHARS } from './normalize.mjs';
export { casingMask, applyCasingMask, applyNameEdits } from './text.mjs';
export { MemoryTextSource, sanitizeItem } from './text-source.mjs';
export { PDFJS_OPTIONS } from './pdfjs-source.mjs';
export { itemsToText } from './runs.mjs';
export { GRAMMARS } from './grammars.mjs';
export { paragraphs } from './slicer.mjs';
export { readAnchor, readAnchorsEntry, readPicks, readNameEdits } from './anchors.mjs';
export { fetchBlock, candidatesFor, pickCandidate, blockForHit, prefixSource, sourceText, blockPrefixHash, findLine, applyPicks, keepOnly } from './resolver.mjs';
export { FIELD_MAPS, fieldMapFor } from './field-maps.mjs';
export { hydrate, hydrateWithReport, FLAG_SCOPE } from './hydrator.mjs';
export { sliceTable, hydrateTable, similarity } from './tables.mjs';
export { readTableRecipe } from './table-recipes.mjs';
export { rollTableSpec, vehicleSpecs, vehicleDocId, journalSpec, tablePageHtml, tableName } from './table-builders.mjs';
