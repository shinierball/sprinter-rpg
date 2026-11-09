/**
 * src/sourcery/generators.mjs
 * Pure generators for mechanics-in-disguise text: the mechanic lines of a
 * skill's `notes` ("Range: 30 feet.", "Cooldown: 30 hours.", "AI Favor: 1.", "Base Damage: 1d8 + Str Piercing.") are written
 * from the spec's own structured fields, never read from a book (CONTRIBUTING §2). Runtime-safe: no text is parsed.
 *
 * `generatedStandIn(kind, path, spec)` renders a field-map join with every book part empty: the public value a redacted spec
 * carries until an import adds the book parts around it.
 */
import { fieldMapFor } from './field-maps.mjs';
import { QUALIFIER_CONDITIONS, AI_FAVOR_PHRASE, AI_FAVOR_NO_EFFECT_TEXT, AI_FAVOR_BOSS_TEXT } from '../data/ai-favor-qualifiers.mjs';

const QUALIFIER_TEXT = Object.freeze({ none: '', noEffect: AI_FAVOR_NO_EFFECT_TEXT, boss: AI_FAVOR_BOSS_TEXT });

/** Labels the generators write; the book-text test splits at them. */
export const GENERATOR_LABELS = Object.freeze(['Range', 'Cooldown', 'AI Favor', 'Base Damage']);

const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');

const conditionKey = c => JSON.stringify([[...(c?.all ?? [])].sort(), [...(c?.any ?? [])].sort(), [...(c?.none ?? [])].sort()]);
const QUALIFIER_BY_KEY = new Map(Object.entries(QUALIFIER_CONDITIONS).map(([q, c]) => [conditionKey(c), q]));

/** `Range: N feet.` when `system.rangeFeet` is above zero. */
function range(spec) {
  const n = num(spec?.system?.rangeFeet);
  return n > 0 ? `Range: ${n} feet.` : '';
}

/** `Cooldown: N <unit>.` when `system.cooldown.value` is above zero (a unit of one is singular). */
function cooldown(spec) {
  const c = spec?.system?.cooldown;
  const n = isRecord(c) ? num(c.value) : 0;
  if (n <= 0) return '';
  let unit = typeof c.unit === 'string' ? c.unit.trim() : '';
  if (n === 1 && unit.endsWith('s')) unit = unit.slice(0, -1);
  return `Cooldown: ${n}${unit ? ` ${unit}` : ''}.`;
}

/** One `AI Favor: N` sentence per rating row above zero; the qualifier comes from the row's condition (unknown: none). */
function aiFavor(spec) {
  const rows = Array.isArray(spec?.system?.aiFavorRatings) ? spec.system.aiFavorRatings : [];
  return rows.filter(r => isRecord(r) && num(r.value) > 0)
    .map(r => `${AI_FAVOR_PHRASE}${num(r.value)}${QUALIFIER_TEXT[QUALIFIER_BY_KEY.get(conditionKey(r.condition)) ?? 'none']}.`).join(' ');
}

/** `Base Damage: <dice> + <Stat> <Type>.` from `system.baseDamage`. */
function baseDamage(spec) {
  const b = spec?.system?.baseDamage;
  const dice = isRecord(b) && typeof b.dice === 'string' ? b.dice.trim() : '';
  if (!dice) return '';
  // A stat of `none` is the spec saying there is none, not a stat to print.
  const rawStat = typeof b.stat === 'string' ? b.stat.trim() : '';
  const stat = rawStat.toLowerCase() === 'none' ? '' : cap(rawStat);
  const type = typeof b.damageType === 'string' ? b.damageType.trim() : '';
  return `Base Damage: ${dice}${stat ? ` + ${stat}` : ''}${type ? ` ${type}` : ''}.`;
}

/** Generator id -> `(spec) => string` ('' when the structure is absent). */
export const GENERATORS = Object.freeze({ range, cooldown, aiFavor, baseDamage });

/** Whether a field-map entry is a join with at least one generator part. */
export const hasGenerator = m => !!m?.join?.parts?.some(p => p.gen);

/**
 * The join rendered with every book part empty.
 * @param {string} kind Sourcery kind (`skill`)
 * @param {string} path the mapped path
 * @param {object} spec the spec the numbers are read from
 * @returns {string} '' when the kind has no such generator join or the structure is absent
 */
export function generatedStandIn(kind, path, spec) {
  const m = fieldMapFor(kind)?.find(e => e.path === path);
  if (!hasGenerator(m)) return '';
  return m.join.parts.filter(p => p.gen && Object.hasOwn(GENERATORS, p.gen))
    .map(p => GENERATORS[p.gen](spec)).filter(Boolean).join(m.join.sep);
}
