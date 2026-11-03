/**
 * src/data/builders/rolltable-payload.mjs
 * `buildRollTablePayload(spec)`: the RollTable creation payload builder.
 * Reached as `buildPayload('rolltable', spec)`. Pure: no Foundry globals needed (`CONST` is read when present).
 *
 * Spec:
 *   { _id?, name, key (flags.sprinter-rpg.tableKey), tableNumber?, formula? ('1d6'), description?, img?, folder?,
 *     rows: [{ range: [lo, hi] | roll: n, name?: string, narrative?: string, options?: Option[], tableRef?: uuid, flags?: { <name>: boolean|number } }] }
 * Option (the `flags.sprinter-rpg.option` of one result; the human-readable `label`/`name` fills the result's name):
 *   { kind: 'named', docKind: 'skill'|'spell', uuid?, identifier, name }   a document result (documentUuid); without a uuid it is
 *     a text result that resolves by identifier through the catalogs (a book document the system does not ship)
 *   { kind: 'choice', docKind, query, label } | { kind: 'custom', label }
 *   { kind: 'lootSlot', slot, tier, spellsAllowed, label? }
 *   { kind: 'asTrigger', trigger, nameAddition, extraTags, label? }
 *   { kind: 'spell', identifier, uuid?, name? }
 * Every result of a row shares that row's range, so Foundry's own multi-result draw returns the whole row.
 * Written in the v14 TableResult shape: `type`, `name`, `description`, `documentUuid`, `range`, `weight`, `flags`.
 */
import { SYSTEM_ID } from '../../constants.mjs';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Option kinds the builder knows. Anything else is kept as a custom option with a warning. */
export const FLOOR_OPTION_KINDS = Object.freeze(['named', 'choice', 'custom', 'lootSlot', 'asTrigger', 'spell', 'tableRef']);

/** Text value: first array entry, trimmed (commas are kept: names may contain them). */
function text(raw) {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  return typeof val === 'string' ? val.trim() : (typeof val === 'number' ? String(val) : '');
}

function toInt(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** The TableResult `type` values: Foundry's constants when present, else the v14 strings. */
function resultTypes(options) {
  const c = globalThis.CONST?.TABLE_RESULT_TYPES;
  return {
    text: options?.resultTypes?.text ?? c?.TEXT ?? 'text',
    document: options?.resultTypes?.document ?? c?.DOCUMENT ?? 'document'
  };
}

/** A row's range: `range: [lo, hi]` or `roll: n`; null when neither is usable. */
function rowRange(row) {
  let lo = null;
  let hi = null;
  if (Array.isArray(row?.range)) { lo = toInt(row.range[0]); hi = toInt(row.range[1] ?? row.range[0]); }
  else if (row?.roll !== undefined) { lo = toInt(row.roll); hi = lo; }
  else if (row?.range !== undefined) { lo = toInt(row.range); hi = lo; }
  if (lo === null || hi === null) return null;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

/** One flagged result; document-backed options carry a documentUuid. */
function optionResult(option, range, types, warn, path) {
  let opt = isPlainObject(option) ? structuredClone(option) : { kind: 'custom', label: text(option) };
  if (!FLOOR_OPTION_KINDS.includes(opt.kind)) {
    warn(path, `unknown option kind "${text(opt.kind)}"; kept as a custom option`);
    opt = { kind: 'custom', label: text(opt.label ?? opt.name) };
  }
  const uuid = text(opt.uuid ?? opt.documentUuid);
  delete opt.uuid;
  delete opt.documentUuid;
  const label = text(opt.label ?? opt.name ?? opt.identifier ?? opt.slot);
  const documentBacked = (opt.kind === 'named' || opt.kind === 'spell' || opt.kind === 'tableRef') && Boolean(uuid);
  // A named or spell option with an identifier and no uuid resolves by identifier through the catalogs: valid, no warning.
  const byIdentifier = (opt.kind === 'named' || opt.kind === 'spell') && Boolean(text(opt.identifier));
  if ((opt.kind === 'named' || opt.kind === 'tableRef') && !uuid && !byIdentifier) warn(path, `${opt.kind} option has no uuid; written as a text result`);
  if (opt.kind === 'named' && !text(opt.identifier) && !uuid) warn(path, 'named option has neither identifier nor uuid');
  return {
    type: documentBacked ? types.document : types.text,
    name: label,
    description: '',
    documentUuid: documentBacked ? uuid : null,
    img: null,
    weight: 1,
    range: [...range],
    drawn: false,
    flags: { [SYSTEM_ID]: { option: opt } }
  };
}

/**
 * Build a RollTable creation payload from a spec.
 * @param {object} [spec]
 * @param {{ warnings?: Array<{path: string, message: string, code: string}>, resultTypes?: {text: *, document: *} }} [options]
 *   `warnings` collects `{ path, message, code: 'spec' }`, else they go to `console.warn`. `resultTypes` overrides the
 *   TableResult `type` values (build:packs runs without Foundry's `CONST`).
 * @returns {object} `{ _id?, name, img, description, formula, replacement, displayRoll, results, flags, folder? }`
 */
export function buildRollTablePayload(spec = {}, options = {}) {
  const warnings = Array.isArray(options?.warnings) ? options.warnings : null;
  const warn = (path, message, code = 'spec') => {
    if (warnings) warnings.push({ path, message, code });
    else console.warn(`Sprinter RPG | ${path}: ${message}`);
  };
  const input = isPlainObject(spec) ? spec : {};
  const types = resultTypes(options);

  const key = text(input.key ?? input.tableKey ?? input.flags?.[SYSTEM_ID]?.tableKey);
  if (!key) warn('key', 'table has no key; it cannot be discovered by tableKey');
  const name = text(input.name) || key || 'New Floor Table';

  if (input.rows !== undefined && !Array.isArray(input.rows)) warn('rows', 'rows must be an array; treated as empty');
  const rawRows = Array.isArray(input.rows) ? input.rows : [];

  const results = [];
  const taken = [];
  rawRows.forEach((row, i) => {
    const path = `rows[${i}]`;
    if (!isPlainObject(row)) { warn(path, 'row is not an object; skipped'); return; }
    const range = rowRange(row);
    if (!range) { warn(path, 'row has no usable range; skipped'); return; }
    const clash = taken.find(([lo, hi]) => range[0] <= hi && range[1] >= lo);
    if (clash) warn(path, `range ${range[0]}-${range[1]} overlaps ${clash[0]}-${clash[1]}`);
    taken.push(range);
    const firstResult = results.length;
    const narrative = text(row.narrative);
    const rowName = text(row.name);
    if (narrative || rowName) {
      results.push({
        type: types.text, name: rowName, description: narrative, documentUuid: null, img: null, weight: 1,
        range: [...range], drawn: false, flags: { [SYSTEM_ID]: { role: 'narrative' } }
      });
    }
    if (row.options !== undefined && !Array.isArray(row.options)) warn(`${path}.options`, 'options must be an array; treated as empty');
    const rowOptions = Array.isArray(row.options) ? row.options : [];
    rowOptions.forEach((option, j) => results.push(optionResult(option, range, types, warn, `${path}.options[${j}]`)));
    const tableRef = text(row.tableRef);
    if (tableRef) results.push(optionResult({ kind: 'tableRef', uuid: tableRef, label: text(row.tableName) }, range, types, warn, `${path}.tableRef`));
    if (!narrative && !rowName && !rowOptions.length && !tableRef) warn(path, 'row has no narrative, options or tableRef');
    // Row flags (booleans and numbers only) ride on every result of the row, under `flags.<system>.rowFlags`.
    const rowFlags = isPlainObject(row.flags) ? Object.fromEntries(Object.entries(row.flags).filter(([, v]) => typeof v === 'boolean' || Number.isFinite(v))) : {};
    if (Object.keys(rowFlags).length) {
      for (const result of results.slice(firstResult)) result.flags[SYSTEM_ID] = { ...result.flags[SYSTEM_ID], rowFlags: { ...rowFlags } };
    }
  });

  let formula = text(input.formula);
  if (!formula) {
    const max = taken.reduce((m, [, hi]) => Math.max(m, hi), 0);
    formula = max > 0 ? `1d${max}` : '1d6';
  }

  const payload = {
    name,
    img: text(input.img) || 'icons/svg/d20-grey.svg',
    description: text(input.description) ? `<p>${text(input.description)}</p>` : '',
    formula,
    replacement: true,
    displayRoll: true,
    results,
    flags: isPlainObject(input.flags) ? structuredClone(input.flags) : {}
  };
  const flagBlock = isPlainObject(payload.flags[SYSTEM_ID]) ? payload.flags[SYSTEM_ID] : {};
  payload.flags[SYSTEM_ID] = { ...flagBlock, tableKey: key };
  const tableNumber = input.tableNumber ?? flagBlock.tableNumber;
  if (tableNumber !== undefined && tableNumber !== null) payload.flags[SYSTEM_ID].tableNumber = tableNumber;
  if (text(input._id)) payload._id = text(input._id);
  if (text(input.folder)) payload.folder = text(input.folder);
  return payload;
}
