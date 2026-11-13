/**
 * Dying and death. A crawler (or mercenary) who loses the last slot of the regular Health Bar gains the Dying
 * debuff: a round countdown of the crawler's Con Mod, counted down by the Clean Up `durations` step. When it runs out
 * the actor dies. Healing the actor above 0 ends Dying. A mob, pet or NPC dies at once at 0%.
 *
 * "Is Dying" is "carries an in-force debuff whose tags include `condition.dying`", never "HP is 0", so a GM who deletes
 * the debuff by hand has overruled the rule. "Dead" is the same with `condition.dead`; the engine leaves a Dead actor alone.
 *
 * Plain functions taking the actor first. This module reaches the actor's debuffs through `actor.applyCondition`.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { debuffInForce } from '../../utils/effects/debuff-force.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { conditionTagId } from '../../utils/identifier.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { SECONDS_PER_ROUND } from '../../utils/time/timing.mjs';
import { canWriteCombatant } from '../combat/combatants.mjs';
import { conditionItemData } from './condition-data.mjs';
import { postDyingCard, postStabilisedCard, postDeathCard } from './dying-card.mjs';
import { creditDeferredKill } from './kill-credit.mjs';

/** The condition tags of the two debuffs, derived from the shipped identifiers (the same derivation every debuff's tag uses). */
const DYING_CONDITION = conditionTagId('dying');
const DEAD_CONDITION = conditionTagId('dead');
export const ZERO_HEALTH = Object.freeze({ DYING: 'dying', DEAD: 'dead', NONE: 'none' });

/** Actor type to what happens at 0%. `CONFIG.COG.zeroHealthOutcomes` is this same object; an unlisted type has none. */
export const ZERO_HEALTH_OUTCOMES = {
  crawler: ZERO_HEALTH.DYING,
  mercenary: ZERO_HEALTH.DYING,
  mob: ZERO_HEALTH.DEAD,
  pet: ZERO_HEALTH.DEAD,
  npc: ZERO_HEALTH.DEAD
};

/** What happens at 0% to this actor: `'dying'`, `'dead'` or `'none'`. Read from the registry, so homebrew can add a type. */
export function zeroHealthOutcome(actor) {
  const registry = globalThis.CONFIG?.COG?.zeroHealthOutcomes ?? ZERO_HEALTH_OUTCOMES;
  const outcome = registry[actor?.type];
  return outcome === ZERO_HEALTH.DYING || outcome === ZERO_HEALTH.DEAD ? outcome : ZERO_HEALTH.NONE;
}

/** The Dying countdown at onset: the crawler's plain Con Mod, never below 0. The one place that reading lives. */
function dyingRounds(actor) {
  return Math.max(0, Math.floor(Number(actor?.system?.abilities?.con?.mod) || 0));
}

const tagsOf = (item) => Array.from(item?.allTags ?? getItemAllTags(item) ?? []);
const hasConditionTag = (item, tag) => item?.type === 'debuff' && tagsOf(item).includes(tag);

/** Whether a debuff carries `condition.dying` (stored or derived). */
export function isDyingDebuff(item) {
  return hasConditionTag(item, DYING_CONDITION);
}

/** Whether a debuff carries `condition.dead` (stored or derived). */
export function isDeadDebuff(item) {
  return hasConditionTag(item, DEAD_CONDITION);
}

const debuffsOf = (actor) => Array.from(actor?.items ?? []).filter((i) => i?.type === 'debuff' && debuffInForce(i));
const dyingDebuff = (actor) => debuffsOf(actor).find(isDyingDebuff) ?? null;
const deadDebuff = (actor) => debuffsOf(actor).find(isDeadDebuff) ?? null;

/** Whether the actor carries an in-force Dying debuff. */
export function isDying(actor) {
  return Boolean(dyingDebuff(actor));
}

/** Whether the actor carries an in-force Dead debuff. */
function isDead(actor) {
  return Boolean(deadDebuff(actor));
}

const hpOf = (actor) => Number(actor?.system?.attributes?.hp?.value);
const worldTime = () => Number(globalThis.game?.time?.worldTime) || 0;

/** Every started combat (current first) the actor fights in, as `{ combat, combatant }`. */
function combatantsOf(actor) {
  const game = globalThis.game;
  const list = [game?.combat, ...Array.from(game?.combats?.contents ?? game?.combats ?? [])].filter(Boolean);
  const found = [];
  for (const combat of new Set(list)) {
    if (!(combat.started ?? Number(combat.round) >= 1)) continue;
    const combatant = Array.from(combat.combatants ?? []).find((c) => (c.actor ?? null) === actor || (actor.id && c.actorId === actor.id));
    if (combatant) found.push({ combat, combatant });
  }
  return found;
}

const flagOf = (doc, key) => doc?.getFlag?.(SYSTEM_ID, key) ?? doc?.flags?.[SYSTEM_ID]?.[key];

/**
 * The stamp that makes a debuff that landed during this round's Clean Up (after Step 5 began, before the countdown
 * ticked) start counting from the next round.
 */
function appliedStamp(actor) {
  for (const { combat } of combatantsOf(actor)) {
    const round = Number(combat.round);
    if (Number(flagOf(combat, 'cleanedUpRound')) === round && Number(flagOf(combat, 'durationsTickedRound')) !== round) {
      return { appliedRound: round, appliedCombatId: combat.id ?? '' };
    }
  }
  return {};
}

/** Condition data with a name even when the catalog entry has none (the canon text is emptied until an import). */
function conditionData(tag, options) {
  const data = conditionItemData(tag, options);
  if (!data.name) data.name = getTagDefinition(tag)?.label || tag;
  return data;
}

/**
 * Start Dying: one Dying debuff counting down the Con Mod. Does nothing to an actor already Dying or Dead.
 * `downedBy` is the hit that took the last slot (`{ attackerUuid, applicationId, attackTags, combatId }`), kept on the
 * debuff so the kill is credited to it at the death.
 */
async function beginDying(actor, { downedBy = null } = {}) {
  if (isDying(actor) || isDead(actor)) return null;
  const rounds = dyingRounds(actor);
  if (rounds <= 0) return die(actor, { cause: 'countdown', downedBy });
  const duration = `${rounds} rounds`;
  const debuff = await actor.applyCondition(conditionData(DYING_CONDITION, { duration }), { durationRounds: rounds, duration });
  if (!debuff) return null;
  await debuff.update({
    [`flags.${SYSTEM_ID}.dying`]: { clockAt: worldTime(), downedBy },
    ...Object.fromEntries(Object.entries(appliedStamp(actor)).map(([key, value]) => [`flags.${SYSTEM_ID}.${key}`, value]))
  });
  await postDyingCard(actor, { rounds });
  return debuff;
}

/**
 * Lose `by` rounds of the countdown (a hit that took a slot, R5). At 0 the actor dies. Nothing if the actor is not Dying.
 * @returns {Promise<{ remaining: number, died: boolean }|null>}
 */
export async function tickDying(actor, { by = 1, cause = 'hit', applicationId = null } = {}) {
  const debuff = dyingDebuff(actor);
  if (!debuff) return null;
  const remaining = (Number(debuff.system?.durationConfig?.remainingRounds) || 0) - by;
  if (remaining <= 0) {
    await die(actor, { cause, applicationId });
    return { remaining: 0, died: true };
  }
  await debuff.update({ 'system.durationConfig.remainingRounds': remaining });
  return { remaining, died: false };
}

/** Give one round of the countdown back (undo of a hit that ticked it), never above the Con Mod it began at. */
export async function untickDying(actor) {
  const debuff = dyingDebuff(actor);
  if (!debuff) return null;
  const remaining = Math.min(dyingRounds(actor), (Number(debuff.system?.durationConfig?.remainingRounds) || 0) + 1);
  await debuff.update({ 'system.durationConfig.remainingRounds': remaining });
  return remaining;
}

const writeClock = (debuff, at) => debuff.update({ [`flags.${SYSTEM_ID}.dying.clockAt`]: at });

/**
 * The out-of-combat countdown (D11): every `SECONDS_PER_ROUND` of world time that passes while a Dying actor is not a
 * combatant of a started combat costs one round, and running out is death. A combatant's clock stamp follows the
 * clock instead (the combat ticks it); a clock moved backwards only moves the stamp. Run by the active GM on `updateWorldTime`.
 * @param {number} now world time in seconds
 * @param {Iterable<Actor>} actors the actors to look at (the duration sweep's)
 */
export async function sweepDyingClock(now, actors) {
  const time = Number(now) || 0;
  for (const actor of actors) {
    const debuff = dyingDebuff(actor);
    if (!debuff) continue;
    const stamp = Number(flagOf(debuff, 'dying')?.clockAt);
    if (combatantsOf(actor).length || !Number.isFinite(stamp) || time < stamp) {
      await writeClock(debuff, time);
      continue;
    }
    const elapsed = Math.floor((time - stamp) / SECONDS_PER_ROUND);
    if (elapsed < 1) continue;
    const result = await tickDying(actor, { by: elapsed, cause: 'clock' });
    if (result && !result.died) await writeClock(debuff, stamp + elapsed * SECONDS_PER_ROUND);
  }
}

/** A combat's round tick or end: the clock stamp of each Dying combatant becomes now, so combat time is never charged to the clock. */
export async function restampDyingClock(combat, now = worldTime()) {
  for (const c of Array.from(combat?.combatants ?? [])) {
    const actor = c.actor ?? globalThis.game?.actors?.get?.(c.actorId);
    const debuff = actor ? dyingDebuff(actor) : null;
    if (debuff) await writeClock(debuff, Number(now) || 0);
  }
}

/** Dying ends: healed above 0. */
async function endDying(actor) {
  const debuff = dyingDebuff(actor);
  if (!debuff) return;
  await debuff.delete();
  await postStabilisedCard(actor);
}

/** Mark each of the actor's combatants in a started combat defeated, where this client may write it. */
async function markDefeated(actor) {
  for (const { combatant } of combatantsOf(actor)) {
    if (combatant.defeated || !canWriteCombatant(combatant)) continue;
    await combatant.update({ defeated: true });
  }
}

/**
 * The actor dies: any Dying debuff is replaced by a permanent Dead debuff and its combatants are marked defeated. The
 * GM undoes a death by deleting the Dead debuff. Nothing else is deleted.
 * @param {Actor} actor
 * The kill is credited now, to `downedBy` (or the one stored on the Dying debuff): the hit that took the last slot (D9).
 * @param {{ cause?: 'countdown'|'hit'|'instant'|'clock', applicationId?: string|null, downedBy?: object|null }} [opts]
 */
export async function die(actor, { cause = 'countdown', applicationId = null, downedBy = null } = {}) {
  if (isDead(actor)) return null;
  const dying = dyingDebuff(actor);
  const downing = downedBy ?? flagOf(dying, 'dying')?.downedBy ?? null;
  await dying?.delete();
  const data = conditionData(DEAD_CONDITION, { duration: 'Permanent' });
  data.system.durationConfig = { type: 'permanent', value: 0 };
  const dead = await actor.applyCondition(data, {});
  await dead?.update({ [`flags.${SYSTEM_ID}.death`]: { at: worldTime(), cause, applicationId } });
  await markDefeated(actor);
  const credit = await creditDeferredKill(actor, downing);
  await postDeathCard(actor, { cause, killByHand: credit === 'no-record' });
  return dead;
}

/**
 * `COGActor#update` calls this after every write. HP going from above 0 to 0 starts Dying (or kills at once) by
 * `zeroHealthOutcome`; HP rising from 0 to above 0 ends Dying. Idempotent. A Dead actor and an actor created at 0 are
 * never touched.
 * @param {Actor} actor
 * @param {{ hpBefore: number, options?: object }} state regular HP before the update, and the update's options (`cogDowning`: the hit)
 */
export async function syncZeroHealth(actor, { hpBefore, options = {} } = {}) {
  const before = Number(hpBefore);
  const after = hpOf(actor);
  if (!Number.isFinite(before) || !Number.isFinite(after) || isDead(actor)) return;
  if (before > 0 && after <= 0) {
    const outcome = zeroHealthOutcome(actor);
    if (outcome === ZERO_HEALTH.DYING) await beginDying(actor, { downedBy: options?.cogDowning ?? null });
    else if (outcome === ZERO_HEALTH.DEAD) await die(actor, { cause: 'instant', applicationId: options?.cogDowning?.applicationId ?? null });
  } else if (before <= 0 && after > 0 && isDying(actor)) {
    await endDying(actor);
  }
}
