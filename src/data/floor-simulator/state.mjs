/**
 * Floor Simulator working state. A step handler receives this object, reads and mutates
 * it, and reports through its helpers. Pure: it holds plain data cloned from the snapshot and never touches a
 * document.
 *
 * Step handler interface (see steps/index.mjs): `{ kind, skipped?, plan(step, state, ctx), resolve(step, stepSpec, state, ctx, rng) }`.
 */
import { rollFormula } from '../../utils/rng.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';

/** Defensive text: arrays and comma lists collapse to the first entry (CONTRIBUTING §4). */
export function cleanText(raw) {
  let val = firstScalar(raw);
  if (typeof val === 'number') val = String(val);
  return typeof val === 'string' ? val.trim() : '';
}

/** A finite integer, or null for anything else (including empty strings and null). */
export function cleanInt(raw) {
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Read a spec value that may be a plain number (typed or chosen), or the additive rolled form
 * `{ value, rolled: true, dice? }` the app writes after it rolls a die. Returns null when there is no usable number.
 * @returns {{value: number, rolled: boolean, dice: number[]|null}|null}
 */
export function readSpecValue(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const value = cleanInt(raw.value);
    if (value === null) return null;
    const dice = Array.isArray(raw.dice) ? raw.dice.map(cleanInt).filter(n => n !== null) : null;
    return { value, rolled: raw.rolled === true, dice: raw.rolled === true && dice?.length ? dice : null };
  }
  const value = cleanInt(raw);
  return value === null ? null : { value, rolled: false, dice: null };
}

/** The smallest and largest total of an `NdS`, `NdS+k` or `NdS-k` formula, or null when unsupported. */
function formulaRange(formula) {
  const m = /^(\d+)d(\d+)(?:([+-])(\d+))?$/.exec(String(formula ?? '').replace(/\s+/g, '').toLowerCase());
  if (!m) return null;
  const count = Number(m[1]);
  const sides = Number(m[2]);
  if (count < 1 || sides < 1) return null;
  const bonus = m[4] ? Number(m[4]) * (m[3] === '-' ? -1 : 1) : 0;
  return { min: count + bonus, max: count * sides + bonus };
}

const SKILL_FIELDS = ['id', 'identifier', 'name', 'rank', 'rankCeiling', 'tags', 'starterRole', 'aiFavor', 'manaCost'];

/**
 * Build the working state from a snapshot.
 * @param {object} snapshot FloorSnapshot
 * @param {object} context FloorSimContext
 * @param {object} arrival The arrival definition
 * @param {object} spec FloorArrivalSpec (already sanitised by the caller)
 */
export function createState(snapshot, context, arrival, spec) {
  const items = new Map();
  for (const [kind, list] of [['skill', snapshot.skills], ['spell', snapshot.spells]]) {
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw?.id) continue;
      const item = { kind };
      for (const f of SKILL_FIELDS) if (raw[f] !== undefined) item[f] = raw[f];
      item.rank = cleanInt(raw.rank) ?? 0;
      item.before = item.rank;
      item.rankCeiling = cleanInt(raw.rankCeiling);
      item.aiFavor = cleanInt(raw.aiFavor) ?? 0;
      items.set(raw.id, item);
    }
  }
  const abilities = {};
  for (const key of ['str', 'dex', 'con', 'int', 'cha']) {
    const a = snapshot.abilities?.[key] || {};
    const value = cleanInt(a.value) ?? 10;
    abilities[key] = { value, unenhanced: cleanInt(a.unenhanced) ?? value, cap: cleanInt(a.cap) };
  }
  const confirmed = new Set((Array.isArray(spec.confirmedRuleBreaks) ? spec.confirmedRuleBreaks : []).map(cleanText).filter(Boolean));
  const produced = new Map();
  const state = {
    snapshot, context, arrival, spec,
    level: cleanInt(snapshot.level) ?? 1,
    floor: cleanInt(snapshot.floor) ?? 1,
    pendingStatPoints: Math.max(0, cleanInt(snapshot.pendingStatPoints) ?? 0),
    abilities,
    aiFavor: cleanInt(snapshot.aiFavor) ?? 0,
    popularity: cleanInt(snapshot.popularity) ?? 0,
    aiFavorChanged: false,
    popularityChanged: false,
    items,
    weapons: Array.isArray(snapshot.weapons) ? snapshot.weapons : [],
    levelsGained: 0,
    statAllocation: {},
    raceClass: null,
    itemUpdates: new Map(),
    itemCreates: [],
    history: [],
    logEntries: [],
    warnings: [],
    skipped: [],
    produced,
    /** Callbacks run once after every step (e.g. the loot step settles tome or learned after the Stat step, C (a)). */
    finalizers: [],

    /** Record a warning. */
    warn(step, message) {
      state.warnings.push({ step, message });
    },
    /** Register a Rule Break this step's input causes. It is pending until its key is in `confirmedRuleBreaks`. */
    breakKey(key, step, reason) {
      if (!produced.has(key)) produced.set(key, { key, step, reason });
      return confirmed.has(key);
    },
    isConfirmed: (key) => confirmed.has(key),
    /** Append a log entry; `breakKey` entries carry `ruleBreak: true` once their key is confirmed. */
    log(entry) {
      const out = { ...entry };
      if (out.breakKey) out.ruleBreak = confirmed.has(out.breakKey);
      state.logEntries.push(out);
      return out;
    },
    /** The item the creator marked as the primary attack: `primarySkill`, else the starter spell. */
    primaryItem() {
      const all = [...items.values()];
      return all.find(i => i.starterRole === 'primarySkill') ?? all.find(i => i.starterRole === 'starterSpell') ?? null;
    }
  };
  return state;
}

/**
 * Roll a formula through the injected RNG, or take a typed value (a manual roll). A typed value outside the die's
 * range is a Rule Break (`range:<stepId>`, Question M (a)). Returns null when the formula is unsupported.
 * A value of the form `{ value, rolled: true, dice }` is an in-app roll and is recorded as rolled.
 * @returns {{total: number, dice: number[]|null, rolled: boolean, manual: boolean, breakKey: string|null}|null}
 */
export function rollOrTyped(state, stepId, formula, typedValue, rng) {
  const given = readSpecValue(typedValue);
  // An in-app roll is a rolled result, never a typed one: it needs no range check (the die produced it).
  if (given?.rolled) return { total: given.value, dice: given.dice, rolled: true, manual: false, breakKey: null };
  const typed = given?.value ?? null;
  if (typed !== null) {
    const range = formulaRange(formula);
    let breakKey = null;
    if (range && (typed < range.min || typed > range.max)) {
      breakKey = `range:${stepId}`;
      state.breakKey(breakKey, stepId, `${typed} is outside ${formula} (${range.min}-${range.max})`);
    }
    return { total: typed, dice: null, rolled: false, manual: true, breakKey };
  }
  const result = rollFormula(rng, formula);
  if (!result) {
    state.warn(stepId, `Unsupported dice formula "${formula}"; nothing was rolled.`);
    return null;
  }
  return { total: result.total, dice: result.dice, rolled: true, manual: false, breakKey: null };
}

/**
 * Add Ranks to a working item, clamped to `min(creationRankCap, rankCeiling)` (D2c, D10). A rolled overflow is
 * clamped and logged. `keepOverflow` keeps it as a Rule Break (`cap:<itemId>`). A Rank already above the cap is
 * never lowered. Mutates the item and the state's item updates.
 * @returns {{before: number, after: number, capped: boolean, overflow: number, breakKey: string|null}}
 */
export function addRank(state, item, add, { stepId, keepOverflow = false } = {}) {
  const before = item.rank;
  const creationCap = cleanInt(state.arrival?.creationRankCap);
  const limit = Math.min(creationCap ?? Infinity, item.rankCeiling ?? Infinity);
  const desired = before + add;
  let after = desired;
  let capped = false;
  let overflow = 0;
  let breakKey = null;
  if (desired > limit) {
    capped = true;
    after = Math.max(before, limit);
    overflow = desired - after;
    if (keepOverflow && overflow > 0) {
      breakKey = `cap:${item.id}`;
      state.breakKey(breakKey, stepId, `${item.name} would end at Rank ${desired}, above its limit of ${limit}`);
      after = desired;
    }
  }
  item.rank = after;
  if (item.payload) {
    // An item the arrival creates (S6): its Rank lives in the create payload, not in an update.
    item.payload.system = { ...(item.payload.system ?? {}), rank: after };
  } else if (after !== before) state.itemUpdates.set(item.id, { _id: item.id, 'system.rank': after });
  return { before, after, capped, overflow, breakKey };
}
