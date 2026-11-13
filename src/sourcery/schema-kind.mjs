/**
 * src/sourcery/schema-kind.mjs
 * What kind of field a spec path is, read from the document's real DataModel schema (`CONFIG.Item` / `CONFIG.Actor`
 * `.dataModels`, walked by Foundry's `SchemaField#getField`), not from a list of field names. The hydrator renders by it: an `HTMLField` takes escaped
 * paragraphs, every other field takes the book's characters as they are.
 */

const documentModel = type => (typeof type === 'string' && type
  ? globalThis.CONFIG?.Item?.dataModels?.[type] ?? globalThis.CONFIG?.Actor?.dataModels?.[type] ?? null
  : null);

/**
 * @param {{ type?: string }} spec a spec document (`type` names its DataModel)
 * @param {string} path dotted path into the spec; only `system.…` paths are in a schema
 * @returns {'html'|'string'|'other'|null} `null` when the type, the model or the path is not found
 */
export function schemaFieldKind(spec, path) {
  const fields = globalThis.foundry?.data?.fields;
  const segments = String(path ?? '').split('.');
  if (segments[0] !== 'system' || segments.length < 2 || !fields?.HTMLField) return null;
  const schema = documentModel(spec?.type)?.schema;
  // Foundry resolves the dotted path; the spec's own `system` is the source, so an array steps through its numeric index.
  const field = schema?.getField?.(segments.slice(1), { source: spec?.system ?? {} });
  if (!field) return null;
  if (field instanceof fields.HTMLField) return 'html';
  return field instanceof fields.StringField ? 'string' : 'other';
}
