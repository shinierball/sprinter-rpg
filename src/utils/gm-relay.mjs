/**
 * GM relay: lets a player client ask the active GM to perform a write the player lacks permission for
 * (for example Combat flag updates, or aura effects on an ally the player does not own).
 *
 * Transport is socketlib (https://github.com/farling42/foundryvtt-socketlib): the sender calls
 * `socket.executeAsGM`, and socketlib runs the handler on the active GM's client with
 * `this.socketdata.userId` set from the socket envelope. That id, never anything in the payload, is the
 * identity every permission check uses. Requests carry only IDs and plain data plus a fixed action type
 * from a registered whitelist.
 *
 * Each action registers:
 *   authorize(payload, user) -> boolean   the requesting user may ask for this (e.g. owns the interrupter)
 *   apply(payload, user)     -> Promise   performs the write; only ever runs on the GM client, or
 *                                         locally when the caller can already write
 *
 * Imports nothing from documents so any module may use it without an import cycle.
 */
import { SYSTEM_ID } from '../constants.mjs';

/** Name of the single socketlib function every relay request goes through. */
export const RELAY_FUNCTION = 'gmRelay';

/** socketlib function for relay requests whose caller needs the GM's result. */
export const RELAY_RESULT_FUNCTION = 'gmRelayResult';

const actions = new Map();
let socket = null;
let hooked = false;

/** Register (or replace) a whitelisted relay action. */
export function registerRelayAction(type, { authorize, apply }) {
  if (typeof type !== 'string' || !type) throw new Error('GM relay action type must be a non-empty string.');
  if (typeof authorize !== 'function' || typeof apply !== 'function') {
    throw new Error(`GM relay action "${type}" needs authorize and apply functions.`);
  }
  actions.set(type, { authorize, apply });
}

function usersList() {
  const users = globalThis.game?.users;
  if (!users) return [];
  return Array.from(users.values());
}

/** The single GM that applies relayed writes: Foundry's activeGM, else the first active GM by id. */
export function getActiveGM() {
  const users = globalThis.game?.users;
  if (users?.activeGM) return users.activeGM;
  const gms = usersList().filter(u => u?.isGM && u.active).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return gms[0] || null;
}

/** True on the one GM client that runs system automation: a GM, and the active one when several are connected. */
export function isActiveGM() {
  const user = globalThis.game?.user;
  if (!user?.isGM) return false;
  const gm = getActiveGM();
  return !gm || gm.id === user.id;
}

function notify(level, message) {
  globalThis.ui?.notifications?.[level]?.(message);
}

const NO_GM_MESSAGE = 'Sprinter RPG | No GM is connected to apply this change. Ask your GM to join.';
let noGmScope = null;

/** The "No GM is connected" warning, shown once inside a `withOneNoGmWarning` scope. */
function notifyNoGm() {
  if (noGmScope) {
    if (noGmScope.warned) return;
    noGmScope.warned = true;
  }
  notify('warn', NO_GM_MESSAGE);
}

/**
 * Run one user action that may make several relay requests; the "No GM is connected" warning shows once for all of them
 * (an aura cast writes to every ally and would otherwise warn per write).
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withOneNoGmWarning(fn) {
  if (noGmScope) return fn();
  noGmScope = { warned: false };
  try {
    return await fn();
  } finally {
    noGmScope = null;
  }
}

/**
 * True for the reasons `requestRelay` returns after the relay itself already warned the user (one warning per
 * refused click: callers stay silent for these and only warn about other refusals).
 */
export function isNoGmReason(reason) {
  return reason === 'no-gm' || reason === 'no-socket';
}

/** 'ready' when socketlib is up and a GM is connected; otherwise warns (verbatim texts) and returns the reason. */
function transportStatus() {
  if (!socket) {
    notify('warn', 'Sprinter RPG | The GM relay is unavailable. Is the socketlib module active?');
    return 'no-socket';
  }
  if (!getActiveGM()) {
    notifyNoGm();
    return 'no-gm';
  }
  return 'ready';
}

/**
 * Run a relay action: locally when the caller can write directly, otherwise ask the active GM.
 * @param {string} type registered action type
 * @param {object} payload IDs and plain data only
 * @param {{ direct?: boolean }} [opts] direct defaults to the current user being a GM
 * @returns {Promise<boolean>} true if applied (locally or by the GM); false if no GM could be reached
 *   or the GM refused the request
 */
export async function dispatchRelay(type, payload, { direct } = {}) {
  const action = actions.get(type);
  if (!action) throw new Error(`Unknown GM relay action "${type}".`);
  const user = globalThis.game?.user;
  const canWrite = direct ?? Boolean(user?.isGM);
  if (canWrite) {
    await action.apply(payload, user);
    return true;
  }
  if (transportStatus() !== 'ready') return false;
  try {
    return (await socket.executeAsGM(RELAY_FUNCTION, type, payload)) === true;
  } catch (err) {
    console.warn('Sprinter RPG | GM relay request failed:', err);
    notifyNoGm();
    return false;
  }
}

/**
 * Validate and apply one relayed request on the GM, keeping apply's return value.
 * Checks in order: GM client, caller id string, known action, known user, authorize.
 * @returns {Promise<{ ok: boolean, result?: any, reason?: 'rejected'|'error' }>}
 */
export async function runRelayRequest(callerId, type, payload) {
  const me = globalThis.game?.user;
  if (!me?.isGM) return { ok: false, reason: 'rejected' };
  if (!callerId || typeof callerId !== 'string') {
    console.warn('Sprinter RPG | GM relay rejected a request with no caller id.');
    return { ok: false, reason: 'rejected' };
  }
  const action = typeof type === 'string' ? actions.get(type) : null;
  if (!action) {
    console.warn('Sprinter RPG | GM relay rejected unknown action:', type);
    return { ok: false, reason: 'rejected' };
  }
  const requester = usersList().find(u => u?.id === callerId) || globalThis.game?.users?.get?.(callerId);
  if (!requester) {
    console.warn('Sprinter RPG | GM relay rejected request from unknown user:', callerId);
    return { ok: false, reason: 'rejected' };
  }
  try {
    if (!action.authorize(payload, requester)) {
      console.warn(`Sprinter RPG | GM relay rejected "${type}" from ${requester.name || requester.id}: not permitted.`);
      return { ok: false, reason: 'rejected' };
    }
    const result = await action.apply(payload, requester);
    return { ok: true, result };
  } catch (err) {
    console.error(`Sprinter RPG | GM relay failed applying "${type}":`, err);
    return { ok: false, reason: 'error' };
  }
}

/**
 * Validate and apply one relayed request. Runs on the GM client.
 * @returns {Promise<boolean>} true if the request was applied
 */
export async function applyRelayRequest(callerId, type, payload) {
  return (await runRelayRequest(callerId, type, payload)).ok;
}

/** socketlib handler for RELAY_RESULT_FUNCTION (regular function: reads this.socketdata.userId). */
async function relayResultHandler(type, payload) {
  return runRelayRequest(this?.socketdata?.userId, type, payload);
}

/**
 * Like dispatchRelay, but returns the GM's result.
 * @returns {Promise<{ ok: boolean, result?: any, reason?: 'no-socket'|'no-gm'|'rejected'|'error' }>}
 */
export async function requestRelay(type, payload, { direct } = {}) {
  const action = actions.get(type);
  if (!action) throw new Error(`Unknown GM relay action "${type}".`);
  const user = globalThis.game?.user;
  const canWrite = direct ?? Boolean(user?.isGM);
  if (canWrite) {
    return { ok: true, result: await action.apply(payload, user) };
  }
  const status = transportStatus();
  if (status !== 'ready') return { ok: false, reason: status };
  try {
    const reply = await socket.executeAsGM(RELAY_RESULT_FUNCTION, type, payload);
    if (!reply || typeof reply !== 'object' || typeof reply.ok !== 'boolean') return { ok: false, reason: 'error' };
    return reply;
  } catch (err) {
    console.warn('Sprinter RPG | GM relay request failed:', err);
    notifyNoGm();
    return { ok: false, reason: 'no-gm' };
  }
}

/**
 * The socketlib handler. It must be a regular function: socketlib binds `this` to `{ socketdata }`,
 * and `socketdata.userId` is the sender's user id taken from the socket envelope.
 */
async function relayHandler(type, payload) {
  return applyRelayRequest(this?.socketdata?.userId, type, payload);
}

function onSocketlibReady() {
  socket = globalThis.socketlib.registerSystem(SYSTEM_ID);
  socket.register(RELAY_FUNCTION, relayHandler);
  socket.register(RELAY_RESULT_FUNCTION, relayResultHandler);
}

/**
 * Register the socketlib hook. Call once from the entry point at load: socketlib fires `socketlib.ready`
 * during its own `init`, before the system's `init`/`ready` hooks.
 */
export function initGMRelay() {
  if (hooked) return;
  globalThis.Hooks?.once('socketlib.ready', onSocketlibReady);
  hooked = true;
}

/** Test helper: forget transport state so initGMRelay can be re-run. */
export function resetGMRelayForTests() {
  hooked = false;
  socket = null;
}
