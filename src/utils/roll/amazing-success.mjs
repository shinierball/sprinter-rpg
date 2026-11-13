/**
 * Amazing Success: the pure core. A leaf: it reads a check
 * card's record and an item's stored triggers and returns plain data; it writes nothing and names no tag literal.
 * "Success by 10 or more" adds the Floor Number as damage (the engine's apply step) and may fire the weapon's one
 * "AS: effect" (a debuff or a narrative push; extra damage stays a damage row conditioned on the engine situation).
 * A Natural 20 is a Critical Hit, which supersedes: `effectiveCheck` already judges it `critical_success`, so no
 * reader here ever reports an Amazing Success for it.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { COG_ROLL_OUTCOMES } from '../../documents/session/roll-outcomes.mjs';
import { ENGINE_SITUATIONS, identityTag } from '../../data/tag-vocabulary.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { queryReferences } from '../tag/tag-query.mjs';
import { readCheckRecord, effectiveCheck } from './check-assists.mjs';
import { WEAPON_CAPABLE_TYPES } from '../document-types.mjs';
import { escapeAttr, jsonAttr } from '../escape-attr.mjs';

export const AS_TRIGGER_TYPES = Object.freeze(['debuff', 'narrative']);
/** Read cap: a stored array longer than this is truncated with one console warning. */
const MAX_AS_TRIGGERS = 8;
/** Card truncation; the stored text is kept whole. */
export const AS_TEXT_SHOWN = 120;
/** Item types that carry `system.asTriggers`. */
const AS_ITEM_TYPES = WEAPON_CAPABLE_TYPES;
/** Record kinds whose degree counts (D3): an attack or a spell attack. */
const AS_RECORD_KINDS = Object.freeze(['attack', 'spell']);

/** @typedef {{ type: 'debuff'|'narrative', identifier: string, text: string, label: string, ruleBreak: boolean }} AsTrigger */

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const trimmed = (v) => {
  let val = v ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  return typeof val === 'string' ? val.trim() : String(val).trim();
};
const clip = (text, max = AS_TEXT_SHOWN) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
let warnedOverCap = false;

/**
 * One stored or option-derived trigger as a clean AsTrigger.
 * @param {object} raw
 * @returns {AsTrigger|null} null for an unknown type, a debuff without an identifier or a narrative without text
 */
export function sanitizeAsTrigger(raw) {
  if (!isPlain(raw)) return null;
  const type = trimmed(raw.type);
  if (!AS_TRIGGER_TYPES.includes(type)) return null;
  const identifier = trimmed(raw.identifier);
  const text = trimmed(raw.text);
  if (type === 'debuff' && !identifier) return null;
  if (type === 'narrative' && !text) return null;
  return {
    type,
    identifier: type === 'debuff' ? identifier : '',
    text: type === 'narrative' ? text : '',
    label: trimmed(raw.label),
    ruleBreak: raw.ruleBreak === true
  };
}

/** Sanitised, capped list from any raw value (an array, or an index-keyed object). */
function sanitizeList(raw) {
  const list = Array.isArray(raw) ? raw : (isPlain(raw) ? Object.values(raw) : []);
  if (list.length > MAX_AS_TRIGGERS && !warnedOverCap) {
    warnedOverCap = true;
    console.warn(`${SYSTEM_ID} | ${list.length} Amazing Success triggers stored; only the first ${MAX_AS_TRIGGERS} are read.`);
  }
  return list.slice(0, MAX_AS_TRIGGERS).map(sanitizeAsTrigger).filter(Boolean);
}

/**
 * The triggers stored on a gear or attack item.
 * @param {object|null} item
 * @returns {AsTrigger[]} [] for any other item type
 */
export function asTriggersOf(item) {
  if (!AS_ITEM_TYPES.includes(item?.type)) return [];
  return sanitizeList(item.system?.asTriggers);
}

/**
 * The item's enabled damage rows whose condition references the engine situation (the extra-damage shape, D7).
 * @param {object|null} item
 * @returns {object[]}
 */
export function asTriggerRowsOf(item) {
  const rows = item?.system?.damageModifiers;
  const list = Array.isArray(rows) ? rows : (isPlain(rows) ? Object.values(rows) : []);
  return list.filter((row) => isPlain(row) && !row.disabled
    && queryReferences(row.condition, (tag) => tag === ENGINE_SITUATIONS.amazingSuccess));
}

/** How many AS triggers the item carries: field entries plus AS-conditioned damage rows. The book allows one. */
export function asTriggerCount(item) {
  return asTriggersOf(item).length + asTriggerRowsOf(item).length;
}

export function hasAsTrigger(item) {
  return asTriggerCount(item) > 0;
}

/**
 * A floor-table option (`{ kind: 'asTrigger', trigger, nameAddition, label }`) as the trigger to store.
 * The short label is the option's `nameAddition` ("Rimshot").
 * @param {object} option
 * @param {{ ruleBreak?: boolean }} [opts]
 * @returns {AsTrigger|null}
 */
export function asTriggerFromOption(option, { ruleBreak = false } = {}) {
  if (!isPlain(option) || option.kind !== 'asTrigger' || !isPlain(option.trigger)) return null;
  return sanitizeAsTrigger({ ...option.trigger, label: option.nameAddition, ruleBreak: ruleBreak === true });
}

export function isAmazingOutcome(outcomeId) {
  return outcomeId === COG_ROLL_OUTCOMES.AMAZING_SUCCESS;
}

function floorOf(message) {
  const raw = typeof message?.getFlag === 'function' ? message.getFlag(SYSTEM_ID, 'currentFloor') : message?.flags?.[SYSTEM_ID]?.currentFloor;
  const n = Number(raw);
  return raw !== null && raw !== undefined && raw !== '' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

function effectiveAttack(message) {
  const record = readCheckRecord(message);
  if (!record || !AS_RECORD_KINDS.includes(record.kind)) return null;
  return effectiveCheck(record);
}

/**
 * Is `target` an Amazing Success on the source attack or spell card (assist-aware, per target)?
 * @param {object} message the source attack/spell card
 * @param {{ uuid?: string, id?: string }|object} target an Actor or `{ uuid, id }`
 * @returns {{ amazing: boolean, outcome: string|null, floor: number|null }}
 */
export function amazingSuccessFor(message, target) {
  const none = { amazing: false, outcome: null, floor: null };
  const eff = effectiveAttack(message);
  if (!eff) return none;
  const uuid = trimmed(target?.uuid);
  const id = trimmed(target?.id);
  const entry = (uuid && eff.targets.find((t) => t.actorUuid === uuid)) || (id && eff.targets.find((t) => t.actorId === id)) || null;
  if (!entry) return { ...none, floor: floorOf(message) };
  return { amazing: isAmazingOutcome(entry.outcome), outcome: entry.outcome, floor: floorOf(message) };
}

/** The targets whose effective outcome on the card is an Amazing Success. */
export function amazingTargetsOf(message) {
  const eff = effectiveAttack(message);
  if (!eff) return [];
  return eff.targets.filter((t) => isAmazingOutcome(t.outcome)).map((t) => ({ actorUuid: t.actorUuid, actorId: t.actorId, name: t.name }));
}

/** The identity tags of the debuff triggers (condition tags the apply adds to the target). */
export function asTriggerConditionRefs(triggers) {
  return (Array.isArray(triggers) ? triggers : []).filter((t) => t?.type === 'debuff' && t.identifier)
    .map((t) => identityTag('debuff', t.identifier));
}

/** The names a card shows for its Amazing Success debuff triggers: the tag's label, else the identifier. */
export function amazingNames(triggers) {
  const names = new Map();
  for (const t of Array.isArray(triggers) ? triggers : []) {
    if (t?.type === 'debuff' && t.identifier) names.set(t.identifier, getTagDefinition(identityTag('debuff', t.identifier))?.label || t.identifier);
  }
  return names;
}

/**
 * Breakdown lines for the damage card.
 * @param {AsTrigger[]} triggers
 * @param {{ found?: Map<string,string>|Record<string,string>|null }} [opts] debuff identifier to its name, when the caller looked it up
 * @returns {Array<{ stage: 'attacker', text: string }>}
 */
export function asTriggerLines(triggers, { found = null } = {}) {
  const names = found instanceof Map ? found : new Map(Object.entries(found ?? {}));
  const lines = [];
  for (const t of Array.isArray(triggers) ? triggers : []) {
    if (t?.type === 'debuff') {
      const name = names.get(t.identifier) || t.identifier;
      lines.push({ stage: 'attacker', text: `AS: ${t.label || name} (inflicts ${name})` });
    } else if (t?.type === 'narrative') {
      const body = clip(t.text);
      lines.push({ stage: 'attacker', text: t.label ? `AS: ${t.label}: ${body} (GM adjudicates)` : `AS: ${body} (GM adjudicates)` });
    }
  }
  return lines;
}

/** ` data-as-triggers='[...]'` (escaped JSON for a single-quoted attribute), '' when there are none. */
export function asTriggersDataAttr(triggers) {
  const list = (Array.isArray(triggers) ? triggers : []).map(sanitizeAsTrigger).filter(Boolean);
  if (!list.length) return '';
  return ` data-as-triggers='${jsonAttr(list)}'`;
}

/** The triggers from a card's `data-as-triggers` value (JSON text), sanitised and capped; [] for anything unreadable. */
export function parseAsTriggers(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return []; }
  }
  return sanitizeList(value);
}

/** English fallbacks for the card strings; the lang file (`COG.AmazingSuccess.Card.*`) wins where a catalogue is loaded. */
const CARD_TEXT = Object.freeze({
  'COG.AmazingSuccess.Card.FloorBadge': '+{floor} DMG',
  'COG.AmazingSuccess.Card.PreviewTitle': 'Amazing Success (+{floor} Floor)',
  'COG.AmazingSuccess.Card.ApplyOff': 'No Amazing Success',
  'COG.AmazingSuccess.Card.ApplyForce': 'Amazing Success (+{floor})',
  'COG.AmazingSuccess.Card.ApplyOffTitle': 'Apply without the Amazing Success bonus or its effect',
  'COG.AmazingSuccess.Card.ApplyForceTitle': "Apply as an Amazing Success to every clicked target (Floor bonus and the weapon's AS effect)"
});

/** A card string, formatted; works without a loaded i18n catalogue. */
export function amazingCardText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return (CARD_TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}


/** The source attack or spell card of a damage roll, from its message id; null when it is not in the log. */
export function amazingSourceMessage(sourceMessageId) {
  if (typeof sourceMessageId !== 'string' || !sourceMessageId) return null;
  return globalThis.game?.messages?.get?.(sourceMessageId) ?? null;
}

/**
 * The damage card's "Amazing Success" preview: which targets of the source card are one, and what the weapon's
 * trigger does to them. A forecast only: apply re-reads the card (an assist may have changed the degree).
 * @param {object|null} message the source card
 * @param {{ triggers?: AsTrigger[] }} [opts]
 * @returns {string} HTML, '' when no target is an Amazing Success
 */
export function amazingPreviewHtml(message, { triggers = [] } = {}) {
  const targets = amazingTargetsOf(message);
  if (!targets.length) return '';
  const floor = floorOf(message) ?? 0;
  const names = targets.map((t) => escapeAttr(t.name)).join(', ');
  const lines = asTriggerLines(triggers).map((l) => `<li class="cog-per-target-row">${escapeAttr(l.text)}</li>`).join('');
  return `<div class="cog-per-target-box cog-amazing-preview"><div class="cog-per-target-title">${escapeAttr(amazingCardText('COG.AmazingSuccess.Card.PreviewTitle', { floor }))}</div>`
    + `<ul class="cog-per-target-rows"><li class="cog-per-target-row">${names}</li>${lines}</ul></div>`;
}

/**
 * The damage card's Amazing Success sub-action (D6): "No Amazing Success" when the source card shows one, else a
 * button that forces it for the clicked targets.
 * @param {object|null} message the source card
 * @param {number} floor the Floor to show on the force button
 */
export function amazingSubActionHtml(message, floor) {
  const hasAmazing = amazingTargetsOf(message).length > 0;
  const mode = hasAmazing ? 'off' : 'force';
  const label = hasAmazing ? 'ApplyOff' : 'ApplyForce';
  return `<button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="1" data-amazing="${mode}" title="${escapeAttr(amazingCardText(`COG.AmazingSuccess.Card.${label}Title`))}">${escapeAttr(amazingCardText(`COG.AmazingSuccess.Card.${label}`, { floor }))}</button>`;
}
