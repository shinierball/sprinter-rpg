/**
 * Template paths declared by sheet classes, for `loadTemplates` (CONTRIBUTING §5).
 * @param {Function[]} sheetClasses classes with a static `PARTS`
 * @returns {string[]} every PART `template` and `templates[]` entry, deduplicated, in order
 */
export function collectSheetTemplates(sheetClasses) {
  const paths = new Set();
  for (const cls of sheetClasses) {
    for (const part of Object.values(cls?.PARTS ?? {})) {
      if (part?.template) paths.add(part.template);
      for (const extra of part?.templates ?? []) paths.add(extra);
    }
  }
  return [...paths];
}
