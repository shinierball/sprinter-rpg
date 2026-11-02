import { SYSTEM_ID } from '../../constants.mjs';
import { getActiveGM } from '../../utils/gm-relay.mjs';
import { getCurrentFloor } from '../../utils/current-floor.mjs';
import { popularityTokens } from '../../utils/popularity.mjs';
import { advanceDungeonTime } from './actor-environment.mjs';

/**
 * The dungeon clock.
 *
 * Every cooldown and timed effect runs on Foundry world time (`game.time.worldTime`, seconds). The floor clock
 * (`floorTimer`) and each combat round move it: `advanceDungeonTime` lowers the floor timer and advances world time;
 * `CONFIG.time.roundTime = 10` makes core's `Combat#nextRound` add 10 seconds per round. Combat time counts for
 * effects only; it never lowers the floor timer.
 *
 * A "scene" here is NOT a Foundry scene. It is bounded by a combat starting, a combat ending, or the GM's
 * "New Scene" button. Activating a different Foundry scene is not a boundary. `sceneEpoch` counts those boundaries.
 */

export { advanceDungeonTime };

/** Why the scene epoch moved. */
export const SCENE_EPOCH_REASONS = Object.freeze({ COMBAT_START: 'combat-start', COMBAT_END: 'combat-end', MANUAL: 'manual' });

/** @returns {number} the scene epoch (0 when unreadable) */
export function getSceneEpoch() {
  try {
    const n = Number(globalThis.game?.settings?.get?.(SYSTEM_ID, 'sceneEpoch'));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/**
 * Start a new scene: raise the epoch so every "once per scene" cooldown comes back. A world setting, so only
 * a GM can write it; any other client leaves it alone.
 * @param {string} [reason] one of SCENE_EPOCH_REASONS (informational)
 * @returns {Promise<number>} the epoch after
 */
export async function bumpSceneEpoch(reason = SCENE_EPOCH_REASONS.MANUAL) {
  const settings = globalThis.game?.settings;
  if (!settings?.set || globalThis.game?.user?.isGM === false) return getSceneEpoch();
  const next = getSceneEpoch() + 1;
  try {
    await settings.set(SYSTEM_ID, 'sceneEpoch', next);
  } catch (err) {
    console.warn(`Sprinter RPG | Could not start a new scene (${reason}):`, err);
    return getSceneEpoch();
  }
  return next;
}

/** True when this client is the one GM that writes shared state (so two GMs never double-bump). */
function isActiveGM() {
  const gm = getActiveGM();
  const me = globalThis.game?.user;
  return Boolean(gm && me && gm.id === me.id);
}

/**
 * The combat an actor's cooldowns count rounds in: `game.combat` once it has started (`round >= 1`) and `actor` is
 * one of its combatants (any actor when none is given).
 */
function activeCombatFor(actor) {
  const combat = globalThis.game?.combat;
  if (!combat || !(Number(combat.round) >= 1)) return null;
  if (actor) {
    const combatants = combat.combatants?.contents ?? Array.from(combat.combatants ?? []);
    const inFight = combatants.some(c => c?.actor === actor || (c?.actorId && c.actorId === actor.id) || (c?.actor?.id && c.actor.id === actor.id));
    if (!inFight) return null;
  }
  return { id: combat.id, round: Number(combat.round) };
}

/**
 * A snapshot of the clock for cooldown evaluation.
 * @param {object|null} [actor]
 * @returns {import('../../utils/cooldowns.mjs').TimeNow}
 */
export function currentTimeContext(actor = null) {
  const floor = getCurrentFloor();
  return {
    time: Number(globalThis.game?.time?.worldTime) || 0,
    floor,
    sceneToken: `scene:${getSceneEpoch()}`,
    floorToken: popularityTokens({ floor }).floor,
    combat: activeCombatFor(actor)
  };
}

let epochHooks = null;
/**
 * Bump the scene epoch when a combat starts and when one ends (the active GM only). Nothing watches Foundry scene
 * activation. Registered once, from the ready hook.
 */
export function registerSceneEpochHooks() {
  if (epochHooks) return;
  epochHooks = [
    ['combatStart', () => { if (isActiveGM()) return bumpSceneEpoch(SCENE_EPOCH_REASONS.COMBAT_START); }],
    ['deleteCombat', () => { if (isActiveGM()) return bumpSceneEpoch(SCENE_EPOCH_REASONS.COMBAT_END); }]
  ];
  for (const [name, fn] of epochHooks) globalThis.Hooks?.on?.(name, fn);
}

/** Tests only: unhook and allow registerSceneEpochHooks to run again. */
export function resetSceneEpochHooksForTests() {
  for (const [name, fn] of epochHooks ?? []) globalThis.Hooks?.off?.(name, fn);
  epochHooks = null;
}
