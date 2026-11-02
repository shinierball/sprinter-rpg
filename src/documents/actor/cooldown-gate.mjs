import { cooldownState, effectiveCooldown, gateCooldown } from '../../utils/cooldowns.mjs';
import { TIME_UNITS, SECONDS_PER_ROUND, timingAmount } from '../../utils/timing.mjs';
import { currentTimeContext } from './dungeon-time.mjs';

/**
 * The cooldown gate at every use site. One helper around
 * `gateCooldown`: it reads the use record from the item that holds it, evaluates the effective cooldown at the
 * item's rank, asks for a Rule Break when the item is on cooldown (never a hard block, CONTRIBUTING rule 2), and hands back
 * `commit()` to store the new record once the use goes ahead (hit or miss: the timer starts at use).
 *
 * @typedef {object} CooldownGateResult
 * @property {boolean} proceed false when the user cancelled (nothing was written, the caller posts nothing)
 * @property {boolean} ruleBreak true when the use went ahead while on cooldown
 * @property {object|null} state the `cooldownState` before the use (null when there is no cooldown)
 * @property {{ cooldownRuleBreak?: true, ruleBreak?: true }} flags spread into the chat card flags
 * @property {() => Promise<void>} commit writes the use record to the holder; call it once, when the use goes ahead
 */

const NO_FLAGS = Object.freeze({});
const NO_COMMIT = async () => {};
const NO_COOLDOWN = () => ({ proceed: true, ruleBreak: false, state: null, flags: NO_FLAGS, commit: NO_COMMIT });

function plainRecord(r) {
  return typeof r?.toObject === 'function' ? r.toObject() : { ...r };
}

/**
 * @param {object} actor the user of the item
 * @param {object} item whose cooldown applies (a spell, skill, gear or loot; the synthetic spell for a granted one)
 * @param {object} [params]
 * @param {string} [params.key='self'] the record key: 'self' or 'grant.<kind>.<identifier>'
 * @param {object|null} [params.grantRow] the gear grant row whose cooldown wins over the item's
 * @param {object} [params.carrier=item] who "per Rank" is read from
 * @param {object} [params.holder=item] the item whose `system.useRecords` stores the record (the gear for a granted spell)
 * @param {number} [params.rank] rank override for rank-break cooldown overrides
 * @param {object} [params.options] passed to `confirmRuleBreak` (`ruleBreak`, `interactive`)
 * @returns {Promise<CooldownGateResult>}
 */
export async function gateItemCooldown(actor, item, { key = 'self', grantRow = null, carrier = item, holder = item, rank, options = {} } = {}) {
  const spec = effectiveCooldown(item, { grantRow, rank });
  if (!spec.unit) return NO_COOLDOWN();

  const amount = timingAmount(spec, { actor, source: carrier, carrier, row: spec, context: { phase: 'use', item: carrier } });
  const records = Array.isArray(holder?.system?.useRecords) ? holder.system.useRecords : [];
  const record = records.find(r => r?.key === key) ?? null;
  const gate = await gateCooldown({
    name: item?.name || 'Item', spec, record, now: currentTimeContext(actor), amount, key, options
  });
  if (!gate.proceed) return { proceed: false, ruleBreak: false, state: gate.state, flags: NO_FLAGS, commit: NO_COMMIT };

  let committed = false;
  const commit = async () => {
    if (committed || !gate.nextRecord || typeof holder?.update !== 'function') return;
    committed = true;
    // Re-read the holder now: the Rule Break dialog may have let another record be stored or a rest clear them.
    const current = Array.isArray(holder?.system?.useRecords) ? holder.system.useRecords : [];
    const next = [...current.filter(r => r?.key !== key).map(plainRecord), gate.nextRecord];
    await holder.update({ 'system.useRecords': next });
  };
  const flags = gate.ruleBreak ? { ruleBreak: true, cooldownRuleBreak: true } : NO_FLAGS;
  return { proceed: true, ruleBreak: gate.ruleBreak, state: gate.state, flags, commit };
}

/** How long a not-ready cooldown has left, as one comparable number (seconds). */
function waitOf(state) {
  const r = state.remaining ?? {};
  if (Number.isFinite(r.seconds)) return r.seconds;
  if (Number.isFinite(r.rounds)) return r.rounds * SECONDS_PER_ROUND;
  return Infinity;
}

/**
 * A gear-granted spell: the first source whose cooldown is ready is used, else the one with the least time left.
 * The record lives on the gear under `grant.spell.<identifier>`, the cooldown is the grant row's own, and "per Rank"
 * reads the grant's rank. A granted spell with no grant source (an outcome-linked spell) has no cooldown of its own.
 * @param {object} actor
 * @param {object} spell the synthetic granted spell (`grantSources: [{ itemId, key, grantIndex, rank }]`)
 * @param {{ options?: object }} [params]
 * @returns {Promise<CooldownGateResult>}
 */
export async function gateGrantedSpellCooldown(actor, spell, { options = {} } = {}) {
  const candidates = [];
  for (const src of spell?.grantSources ?? []) {
    const gear = actor?.items?.get(src.itemId);
    if (!gear) continue;
    const grantRow = Array.isArray(gear.system?.grants) ? gear.system.grants[src.grantIndex] ?? null : null;
    const carrier = { ...spell, system: { ...spell.system, rank: src.rank, modifiedRank: src.rank } };
    candidates.push({ gear, grantRow, carrier, key: src.key, rank: src.rank });
  }
  if (!candidates.length) return NO_COOLDOWN();

  const now = currentTimeContext(actor);
  let best = null;
  for (const c of candidates) {
    const spec = effectiveCooldown(spell, { grantRow: c.grantRow, rank: c.rank });
    let wait = 0;
    if (spec.unit) {
      const amount = timingAmount(spec, { actor, source: c.carrier, carrier: c.carrier, row: spec, context: { phase: 'use', item: c.carrier } });
      const record = (c.gear.system?.useRecords ?? []).find(r => r?.key === c.key) ?? null;
      const state = cooldownState(spec, record, now, { amount });
      wait = state.ready ? 0 : waitOf(state);
    }
    if (!best || wait < best.wait) best = { c, wait };
    if (wait === 0) break;
  }
  const { c } = best;
  return gateItemCooldown(actor, spell, { key: c.key, grantRow: c.grantRow, carrier: c.carrier, holder: c.gear, rank: c.rank, options });
}

/**
 * The item updates that clear the use records of a rest: every record whose unit is a rest unit at or below the
 * rest's level (a long rest clears short and long, a full day's rest clears all three). Level 0 (the 1-hour rest)
 * clears nothing.
 * @param {object} actor
 * @param {number} level 0 | 1 | 2 | 3
 * @returns {object[]} `updateEmbeddedDocuments('Item', ...)` payload
 */
export function restCooldownUpdates(actor, level) {
  if (!(level > 0)) return [];
  const updates = [];
  for (const item of actor?.items ?? []) {
    const records = item.system?.useRecords;
    if (!Array.isArray(records) || !records.length) continue;
    const keep = records.filter(r => !(TIME_UNITS[r?.unit]?.kind === 'rest' && TIME_UNITS[r.unit].level <= level));
    if (keep.length !== records.length) updates.push({ _id: item.id ?? item._id, 'system.useRecords': keep.map(plainRecord) });
  }
  return updates;
}
