/**
 * Derivation of a transformation overlay. While a changed affliction names a form race, the original
 * race item stays embedded and `appliedRace` stays as written, but the numbers the original wrote onto the actor are
 * neutralised and the form race's are added, all in derived data:
 *
 * - stats and DR are **additive deltas** (`form - applied`) that the caller adds on top of the stored values, so a stat
 *   point edited while transformed lands in the stored base and the revert is exact;
 * - size and speed are single stored fields, so `applyOverlayToAttributes` swaps them in memory and remembers what it
 *   replaced, putting it back on the next prepare (idempotent whether or not Foundry reset the model in between).
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { overlayOf, transformState } from '../../utils/character/transform-rules.mjs';
import { STAT_KEYS } from './actor-derivation.mjs';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const SPECIAL_SPEEDS = ['climb', 'swim', 'fly', 'burrow'];

/**
 * Per-stat change of an overlay: what the form gives minus what the original race wrote.
 * @param {{stats?: Record<string, number>}|null} applied the `appliedRace` record
 * @param {Record<string, number>} formStats
 * @returns {Record<string, number>}
 */
function overlayStatDeltas(applied, formStats) {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, num(formStats?.[k]) - num(applied?.stats?.[k])]));
}

/**
 * The overlay in force on an actor, or null: the affliction, its state, the form race item, the record of the
 * original race and the form's parsed bonuses. A changed affliction whose form item is missing is no overlay.
 * @param {object} actor
 * @param {object[]} items the actor's items
 * @returns {object|null}
 */
export function overlayContext(actor, items) {
  const overlay = overlayOf(items);
  if (!overlay) return null;
  const state = transformState(overlay);
  const formItem = items.find((i) => i.type === 'race' && (i.id ?? i._id) === state.formItemId) ?? null;
  if (!formItem) return null;
  const applied = actor?.getFlag?.(SYSTEM_ID, 'appliedRace') ?? null;
  const form = COGRaceClassApplier.parseRaceBonuses(formItem);
  // The form's fixed skill and spell rows, read like gear rows: a race row's `rank` is a gear row's `value`
  const rows = (formItem.system?.grants ?? [])
    .filter((g) => (g?.kind === 'skill' || g?.kind === 'spell') && g.mode !== 'choice')
    .map((g) => ({ ...g, value: Number(g.rank) || 0 }));
  return {
    overlay, state, formItem, applied, form,
    skillGear: { id: formItem.id ?? formItem._id, name: formItem.name, system: { grants: rows } },
    statDeltas: overlayStatDeltas(applied, form.stats),
    drDelta: num(form.drBonus) - num(applied?.drBonus)
  };
}

/**
 * Swap size and speed for the overlay's, in memory. Call at the top of every prepare: it first puts back what an
 * earlier call replaced.
 * @param {object} system the actor's system model
 * @param {object|null} ctx from {@link overlayContext}
 */
export function applyOverlayToAttributes(system, ctx) {
  const attributes = system?.attributes;
  if (!attributes) return;
  const saved = system._transformOriginals;
  if (saved) {
    attributes.size = saved.size;
    if (attributes.speed) for (const [k, v] of Object.entries(saved.speed)) attributes.speed[k] = v;
    system._transformOriginals = null;
  }
  if (!ctx) return;
  const { applied, form } = ctx;
  system._transformOriginals = { size: attributes.size, speed: { ...(attributes.speed ?? {}) } };

  if (form.size) attributes.size = form.size;
  else if (applied?.size && applied.originalSize) attributes.size = applied.originalSize;

  if (attributes.speed) {
    const walk = num(form.movement?.walkDelta) - num(applied?.movement?.walkDelta);
    if (walk) attributes.speed.move = (Number(attributes.speed.move) || 20) + walk;
    for (const key of SPECIAL_SPEEDS) if (num(form.movement?.[key])) attributes.speed[key] = num(form.movement[key]);
  }
}
