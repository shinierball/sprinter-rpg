/**
 * Leg draw from a RollTable: a drawn narrative result becomes the leg's
 * label and a `named` skill option on the drawn row becomes the leg's skill. No table-builder change: the table is an
 * ordinary `buildPayload('rolltable', ...)` table. The skill comes from the option's structured `identifier` (or the
 * document its result points at), never from the narrative text.
 */
import { SYSTEM_ID } from '../../constants.mjs';

const MAX_LABEL = 120;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function text(raw) {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  return typeof val === 'string' ? val.trim() : (typeof val === 'number' ? String(val) : '');
}

/** A narrative line for display: tags removed (a table result's description is HTML), whitespace collapsed, clamped. */
function plain(raw) {
  return text(raw).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
}

/**
 * What a drawn row says about a leg.
 * @param {object[]} results the drawn TableResults (documents or plain data)
 * @param {{ resolveUuid?: (uuid: string) => ({ system?: { identifier?: string } }|null) }} [options]
 * @returns {{ label: string, skill: string|null }} `label` is '' and `skill` null when the row has neither
 */
export function legFromResults(results, options = {}) {
  const resolveUuid = options?.resolveUuid ?? ((uuid) => globalThis.fromUuidSync?.(uuid) ?? null);
  let label = '';
  let skill = null;
  for (const result of Array.isArray(results) ? results : []) {
    if (result === null || typeof result !== 'object') continue;
    const flags = result.flags?.[SYSTEM_ID] ?? {};
    if (flags.role === 'narrative') {
      if (!label) label = plain(result.description ?? result.text) || plain(result.name);
      continue;
    }
    const option = isObject(flags.option) ? flags.option : null;
    if (!skill && option?.kind === 'named' && text(option.docKind) === 'skill') {
      let identifier = text(option.identifier);
      if (!identifier) {
        let doc;
        try { doc = resolveUuid(text(result.documentUuid)); } catch { /* an unresolvable uuid sets no skill */ }
        identifier = text(doc?.system?.identifier);
      }
      if (identifier) skill = identifier;
    }
  }
  return { label, skill };
}

/**
 * Apply a drawn row to a leg. A closed leg is left alone; an empty label keeps the old one; no skill keeps the skill
 * (and the stat). `statOf(identifier)` gives the catalog stat for a new skill.
 * @returns {boolean} true when the leg changed
 */
export function applyLegDraw(leg, draw, statOf = () => null) {
  if (!isObject(leg) || leg.status === 'closed') return false;
  let changed = false;
  if (draw?.label && leg.label !== draw.label) { leg.label = draw.label; changed = true; }
  if (draw?.skill) {
    if (!isObject(leg.check)) leg.check = { skill: null, stat: 'dex' };
    if (leg.check.skill !== draw.skill) {
      leg.check.skill = draw.skill;
      const stat = statOf(draw.skill);
      if (stat) leg.check.stat = stat;
      changed = true;
    }
  }
  return changed;
}

/**
 * Draw one row from a RollTable by uuid (no chat card) and read it as a leg.
 * @param {string} uuid
 * @param {{ fromUuid?: Function, resolveUuid?: Function }} [options]
 * @returns {Promise<{ label: string, skill: string|null, tableName: string }|null>} null when the table is missing or drew nothing
 */
export async function drawLegFromTable(uuid, options = {}) {
  const load = options?.fromUuid ?? globalThis.fromUuid;
  const id = text(uuid);
  if (!id || typeof load !== 'function') return null;
  let table;
  try { table = await load(id); } catch { return null; }
  if (!table || typeof table.draw !== 'function') return null;
  let drawn;
  try { drawn = await table.draw({ displayChat: false }); } catch { return null; }
  const results = Array.isArray(drawn?.results) ? drawn.results : [];
  if (!results.length) return null;
  return { ...legFromResults(results, options), tableName: text(table.name) };
}
