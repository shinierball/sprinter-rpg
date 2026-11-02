import { SYSTEM_ID } from '../../constants.mjs';
import { getCurrentFloor } from '../../utils/current-floor.mjs';
import { registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { openApplications } from '../../compat.mjs';
import { parseFloorNumber, floorLabel } from '../../utils/floor-number.mjs';

export const RELAY_ACTION_DECREMENT_FLOOR_TIMER = 'decrementFloorTimer';

/**
 * Most hours one decrement request may take off the floor clock. The callers are a rest (at most a 30-hour
 * full day's rest) and a party grind (the Grind app's hours input is capped at 24).
 */
export const MAX_FLOOR_TIMER_DECREMENT = 30;

/** @returns {number|null} the hours when finite and in (0, MAX_FLOOR_TIMER_DECREMENT], else null */
function validDecrementHours(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return raw > 0 && raw <= MAX_FLOOR_TIMER_DECREMENT ? raw : null;
}

function requesterOwnsActor(actor, user) {
  if (!actor || !user) return false;
  if (user.isGM) return true;
  if (typeof actor.testUserPermission === 'function') return Boolean(actor.testUserPermission(user, 'OWNER'));
  const own = actor.ownership || {};
  const OWNER = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return (Number(own[user.id] ?? own.default ?? 0) || 0) >= OWNER;
}

let floorTimerQueue = Promise.resolve();
/** Run `fn` after every earlier floor-clock write has settled, so concurrent requests all land. */
function enqueueFloorTimer(fn) {
  const run = floorTimerQueue.then(fn);
  floorTimerQueue = run.catch(() => {});
  return run;
}

registerRelayAction(RELAY_ACTION_DECREMENT_FLOOR_TIMER, {
  authorize: (payload, user) => {
    if (validDecrementHours(payload?.hours) === null) return false;
    return requesterOwnsActor(resolveActorByUuid(payload?.actorUuid), user);
  },
  apply: (payload) => enqueueFloorTimer(async () => {
    const h = validDecrementHours(payload?.hours);
    if (h === null) return getFloorTimer();
    // Read inside the queue so two players resting together both subtract.
    return applyDungeonTime(hoursToSeconds(h));
  })
});

/** Seconds in `hours`, free of float noise (so 1/6 h is 600 s). */
function hoursToSeconds(hours) {
  return Math.round(hours * 3600 * 1000) / 1000;
}

/** GM side of `advanceDungeonTime`: lower the floor timer, then move Foundry world time. Call inside the queue. */
async function applyDungeonTime(seconds) {
  const next = Math.max(0, Math.round((getFloorTimer() - seconds / 3600) * 1e6) / 1e6);
  await setFloorTimer(next);
  const time = globalThis.game?.time;
  if (typeof time?.advance === 'function') await time.advance(seconds);
  return next;
}

let warnedGMOnly = false;
/** Non-GM callers of the world setters get one notice and no write (players change the clock only via the relay). */
function refuseNonGMWrite() {
  if (!warnedGMOnly) {
    warnedGMOnly = true;
    globalThis.ui?.notifications?.warn?.('Only the GM can change the floor clock.');
  }
}

function isNonGM() {
  return Boolean(globalThis.game?.user) && globalThis.game.user.isGM === false;
}

/**
 * Active global floor environment getters & setters
 */
export { getCurrentFloor };

export { parseFloorNumber, floorLabel };

export async function setCurrentFloor(floor) {
  const parsed = parseInt(floor, 10);
  const val = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
  if (!globalThis.game?.settings?.set) return val;
  if (isNonGM()) {
    refuseNonGMWrite();
    return getCurrentFloor();
  }
  try {
    await globalThis.game.settings.set(SYSTEM_ID, 'currentFloor', val);
  } catch (_) {}
  return val;
}

export function getFloorTimer() {
  try {
    const val = globalThis.game?.settings?.get?.(SYSTEM_ID, 'floorTimer');
    const parsed = parseFloat(val);
    return Number.isFinite(parsed) ? parsed : 100;
  } catch (_) {
    return 100;
  }
}

export async function setFloorTimer(hours) {
  const parsed = Number(hours);
  const val = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  if (!globalThis.game?.settings?.set) return val;
  if (isNonGM()) {
    refuseNonGMWrite();
    return getFloorTimer();
  }
  try {
    await globalThis.game.settings.set(SYSTEM_ID, 'floorTimer', val);
  } catch (_) {}
  return val;
}

/**
 * Let dungeon time pass: lower the floor timer by `seconds` of hours and advance Foundry world time by the same
 * amount (the clock every cooldown and timed effect runs on, 3.12). World time moves the full amount even when
 * the floor timer is already at 0. The GM writes directly; a player asks the GM through the relay, which checks
 * that the player owns `actorUuid`. With no GM reachable nothing changes.
 * @param {number} seconds
 * @param {{ actorUuid?: string }} [opts] the actor the time is spent for (required for players)
 * @returns {Promise<number|null>} the floor timer in hours after the change (unchanged when refused), null without settings
 */
export async function advanceDungeonTime(seconds, { actorUuid } = {}) {
  if (!globalThis.game?.settings) return null;
  const s = Number(seconds) || 0;
  if (s <= 0) return getFloorTimer();
  if (isNonGM()) {
    const reply = await requestRelay(RELAY_ACTION_DECREMENT_FLOOR_TIMER, { hours: s / 3600, actorUuid });
    return reply.ok && Number.isFinite(reply.result) ? reply.result : getFloorTimer();
  }
  return enqueueFloorTimer(() => applyDungeonTime(s));
}

/**
 * Take hours off the floor clock: `advanceDungeonTime(hours * 3600)`, so world time moves with it.
 * @param {number} hours
 * @param {{ actorUuid?: string }} [opts] the actor the time is spent for (required for players)
 * @returns {Promise<number|null>} the clock after the change (unchanged when refused), null without settings
 */
export async function decrementFloorTimer(hours, opts = {}) {
  const h = Number(hours) || 0;
  if (!globalThis.game?.settings) return null;
  if (h <= 0) return getFloorTimer();
  return advanceDungeonTime(hoursToSeconds(h), opts);
}

/**
 * Re-render open windows and the floor/crawler clock HUDs. Wired as the
 * `onChange` handler of the currentFloor, floorTimer and crawlerCount settings,
 * so every client refreshes whenever any of them changes.
 */
export function refreshEnvironmentDisplays() {
  for (const app of openApplications()) {
    if (typeof app.render === 'function') app.render(false);
  }
  const cog = globalThis.CONFIG?.COG;
  const huds = [cog?.floorClockHUD || globalThis.cog?.floorClockHUD, cog?.crawlerClockHUD || globalThis.cog?.crawlerClockHUD];
  for (const hud of huds) {
    if (typeof hud?.get === 'function') hud.get().render({ force: true });
  }
}

export function getCrawlerCount() {
  try {
    const val = globalThis.game?.settings?.get?.(SYSTEM_ID, 'crawlerCount');
    const parsed = parseInt(String(val).replace(/,/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : 1000000;
  } catch (_) {
    return 1000000;
  }
}

export async function setCrawlerCount(count) {
  const raw = String(count ?? '').replace(/,/g, '').trim();
  const parsed = parseInt(raw, 10);
  const val = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  if (!globalThis.game?.settings?.set) return val;
  if (isNonGM()) {
    refuseNonGMWrite();
    return getCrawlerCount();
  }
  try {
    await globalThis.game.settings.set(SYSTEM_ID, 'crawlerCount', val);
  } catch (_) {}
  return val;
}

export async function decrementCrawlerCount(amount = 1) {
  const cur = getCrawlerCount();
  const dec = parseInt(String(amount ?? '').replace(/,/g, ''), 10) || 1;
  const nextVal = Math.max(0, cur - dec);
  return setCrawlerCount(nextVal);
}

export async function incrementCrawlerCount(amount = 1) {
  const cur = getCrawlerCount();
  const inc = parseInt(String(amount ?? '').replace(/,/g, ''), 10) || 1;
  const nextVal = cur + inc;
  return setCrawlerCount(nextVal);
}

export const actorEnvironmentMixin = {
  getCurrentFloor() {
    return getCurrentFloor();
  },
  getFloorTimer() {
    return getFloorTimer();
  },
  setFloorTimer(hours) {
    return setFloorTimer(hours);
  },
  decrementFloorTimer(hours, opts) {
    return decrementFloorTimer(hours, opts);
  },
  getCrawlerCount() {
    return getCrawlerCount();
  },
  setCrawlerCount(count) {
    return setCrawlerCount(count);
  },
  decrementCrawlerCount(amount) {
    return decrementCrawlerCount(amount);
  },
  incrementCrawlerCount(amount) {
    return incrementCrawlerCount(amount);
  }
};

export const actorEnvironmentStaticMixin = {
  getCurrentFloor() {
    return getCurrentFloor();
  },
  setCurrentFloor(floor) {
    return setCurrentFloor(floor);
  },
  getFloorTimer() {
    return getFloorTimer();
  },
  setFloorTimer(hours) {
    return setFloorTimer(hours);
  },
  decrementFloorTimer(hours, opts) {
    return decrementFloorTimer(hours, opts);
  },
  getCrawlerCount() {
    return getCrawlerCount();
  },
  setCrawlerCount(count) {
    return setCrawlerCount(count);
  },
  decrementCrawlerCount(amount) {
    return decrementCrawlerCount(amount);
  },
  incrementCrawlerCount(amount) {
    return incrementCrawlerCount(amount);
  }
};
