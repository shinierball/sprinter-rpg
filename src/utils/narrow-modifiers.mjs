/**
 * Readers for the narrow modifier row arrays: `manaCostModifiers`, `recoveryModifiers`
 * and `statSubstitutions`. Each reader collects rows through `getActiveModifierSources` (via
 * `evaluateRows`), so race, class, equipped gear, buffs and debuffs all count, and matches conditions
 * with the shared tag-query matcher. Nothing here reads names or text.
 */
import { evaluateRows } from './damage-modifiers.mjs';
import { resolveSituations, buildRollContext } from './roll-context.mjs';

const STATS = ['str', 'dex', 'con', 'int', 'cha'];

/** Round away float noise (0.1 * 3), then up: costs are whole Mana. */
function roundUp(value) {
  return Math.ceil(Math.round(value * 1e6) / 1e6);
}

/**
 * Final Mana cost of a spell after `manaCostModifiers` rows. All matching `add` rows apply first, then every
 * matching `multiply` row, rounded up, never below 0.
 *
 * @param {object} actor
 * @param {number} baseCost the spell's cost before modifiers (already including the non-favored +1)
 * @param {object} context a `manaCost` RollContext (the spell's tags plus any ticked `situation.*` tags)
 * @returns {{ cost: number, base: number, added: number, multiplier: number, breakdown: Array<string> }}
 */
export function computeManaCost(actor, baseCost, context) {
  const base = Math.max(0, Number(baseCost) || 0);
  const matches = evaluateRows(actor, 'manaCostModifiers', context);
  let added = 0;
  let multiplier = 1;
  const breakdown = [];
  for (const { source, row, scale } of matches.filter(m => m.row.mode !== 'multiply')) {
    const value = Number(row.value) || 0;
    if (value === 0) continue;
    added += value;
    breakdown.push(`${row.label || source.name || 'Mana cost'} (${value >= 0 ? '+' : ''}${value}${scale ? `, ${scale.note}` : ''})`);
  }
  for (const { source, row, scale } of matches.filter(m => m.row.mode === 'multiply')) {
    const factor = Number(row.multiplier);
    if (!Number.isFinite(factor) || factor === 1) continue;
    multiplier *= factor;
    breakdown.push(`${row.label || source.name || 'Mana cost'} (x${factor}${scale ? `, ${scale.note}` : ''})`);
  }
  const cost = Math.max(0, roundUp((base + added) * multiplier));
  return { cost, base, added, multiplier, breakdown };
}

/**
 * The `situation.*` toggles that a spell's cost rows reference (e.g. "damage-dealing spells while in daylight"):
 * offered through the shared situation dialog, or answered by `options.situations`.
 *
 * @param {object} actor
 * @param {object} context a `manaCost` RollContext
 * @param {object} [options] cast options (`situations`, `interactive`)
 * @returns {Promise<Array<string>>} the ticked situation tags
 */
export function resolveManaCostSituations(actor, context, options = {}) {
  return resolveSituations(actor, context, options, { keys: ['manaCostModifiers'], exclusive: true });
}

/**
 * Recovery multiplier for one resource: the product of every matching `recoveryModifiers` row for `resource`.
 *
 * @param {object} actor
 * @param {'mana'|'hp'} resource
 * @param {object} context a `recovery` RollContext (with the ticked rest situations)
 * @returns {{ multiplier: number, breakdown: Array<string> }}
 */
export function getRecoveryMultiplier(actor, resource, context) {
  let multiplier = 1;
  const breakdown = [];
  for (const { source, row, scale } of evaluateRows(actor, 'recoveryModifiers', context)) {
    if (row.resource !== resource) continue;
    const factor = Number(row.multiplier);
    if (!Number.isFinite(factor) || factor === 1) continue;
    multiplier *= factor;
    breakdown.push(`${row.label || source.name || 'Recovery'} (x${factor}${scale ? `, ${scale.note}` : ''})`);
  }
  return { multiplier, breakdown };
}

/** Rest situations the actor's recovery rows reference, offered through the shared situation dialog. */
export function resolveRecoverySituations(actor, options = {}) {
  const context = buildRollContext({ actor, phase: 'recovery' });
  return resolveSituations(actor, context, options, { keys: ['recoveryModifiers'], exclusive: true });
}

/** Scale a regained amount; whole points, rounded down. */
export function scaleRecovery(amount, multiplier) {
  return Math.max(0, Math.floor(Math.round((Number(amount) || 0) * multiplier * 1e6) / 1e6));
}

/** Modifier of an ability on an actor (derived `mod`, 0 when missing). */
function modOf(actor, stat) {
  return Number(actor?.system?.abilities?.[stat]?.mod) || 0;
}

/**
 * Which stat to use in place of `stat` for one scope. Rows whose `from` is `stat` and whose condition matches
 * `tags` apply; when several do, the one with the best modifier wins. Optional rows whose key is listed in
 * `skip` (the player unticked them) are left out.
 *
 * @param {object} actor
 * @param {'damage'|'check'|'healthBar'|'lift'} scope
 * @param {string} stat the stat the roll would normally use
 * @param {object} context the roll's RollContext (skill tags, `stat.*`, situations)
 * @param {object} [opts]
 * @param {Array<string>} [opts.skip] keys of optional rows to leave out
 * @returns {{ stat: string, mod: number, substituted: boolean, label: string, key: string, optional: boolean }}
 */
export function resolveStatSubstitution(actor, scope, stat, context, { skip: skipKeys } = {}) {
  const from = String(stat ?? '').toLowerCase().trim();
  const skip = new Set(skipKeys ?? []);
  let best = { stat: from, mod: modOf(actor, from), substituted: false, label: '', key: '', optional: false };
  for (const { source, row, key } of evaluateRows(actor, 'statSubstitutions', context)) {
    if (row.scope !== scope || row.from !== from || !STATS.includes(row.to)) continue;
    if (row.optional && skip.has(key)) continue;
    const mod = modOf(actor, row.to);
    if (!best.substituted || mod > best.mod) {
      best = { stat: row.to, mod, substituted: true, label: row.label || source.name || 'Stat substitution', key, optional: Boolean(row.optional) };
    }
  }
  return best;
}

/**
 * Swap the stat on damage parts: every part that adds `from`'s stat mod takes the substituted stat's mod
 * instead (Slice adds Cha Mod rather than Str Mod). Mutates and returns `parts`.
 *
 * @param {object} actor
 * @param {Array<object>} parts damage parts ({ stat, statMod, source })
 * @param {object} context a `damage` RollContext
 * @param {object} [opts] `{ skip }` as resolveStatSubstitution
 * @returns {Array<object>}
 */
export function applyDamageStatSubstitutions(actor, parts, context, opts = {}) {
  for (const part of parts) {
    const stat = String(part?.stat ?? '').toLowerCase().trim();
    if (!stat) continue;
    const sub = resolveStatSubstitution(actor, 'damage', stat, context, opts);
    if (!sub.substituted) continue;
    part.stat = sub.stat;
    part.statMod = sub.mod;
    part.substitution = sub.key;
    part.source = `${part.source || 'Damage'} [${sub.label}: ${sub.stat.toUpperCase()} Mod]`;
  }
  return parts;
}
