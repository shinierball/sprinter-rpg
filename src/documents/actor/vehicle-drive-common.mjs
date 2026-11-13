/**
 * Vehicle driving, shared base: the small helpers every vehicle-drive part uses (whole feet, notices, text, chat-card flags
 * and their lookups) and the relay request `requestVehicleDrive` with its convenience requests. The relay action itself is
 * registered in `vehicle-drive.mjs`.
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { requestRelay, isNoGmReason } from '../../utils/gm-relay.mjs';

export const wholeFeet = (v) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const notify = (level, text) => globalThis.ui?.notifications?.[level]?.(text);

/** The relay action every vehicle-drive write by someone who cannot write the vehicle goes through. */
export const RELAY_ACTION_VEHICLE_DRIVE = 'vehicleDrive';
/** Chat-card flags the GM writes on a vehicle check card. */
export const VEHICLE_CARD_FLAGS = Object.freeze({ result: 'vehicleResult', shifts: 'vehicleShifts', used: 'vehicleUsed', stop: 'vehicleStop' });

export const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');

export const messageById = (id) => (typeof id === 'string' && id ? globalThis.game?.messages?.get?.(id) ?? null : null);
export const cardFlag = (message, key) => (typeof message?.getFlag === 'function' ? message.getFlag(SYSTEM_ID, key) : message?.flags?.[SYSTEM_ID]?.[key]);
export const cardKey = (name) => `flags.${SYSTEM_ID}.${name}`;

export const say = (key, fallback, data = {}) => {
  const i18n = globalThis.game?.i18n;
  try {
    const out = Object.keys(data).length ? i18n?.format?.(key, data) : i18n?.localize?.(key);
    if (typeof out === 'string' && out && out !== key) return out;
  } catch {
    // fall through to the English text
  }
  return Object.entries(data).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), fallback);
};
export const speakerOf = (actor) => globalThis.ChatMessage?.getSpeaker?.({ actor }) ?? {};
export const gmWhisper = () => (globalThis.ChatMessage?.getWhisperRecipients?.('GM') ?? []).map((u) => u.id).filter(Boolean);

/**
 * Ask for one vehicle-drive write: a GM writes at once, anyone else asks the GM.
 * @param {Actor} vehicle
 * @param {'speed'|'choose'|'shift'|'spend'|'clear'|'override'|'useItem'|'collision'|'explode'} op
 * @param {object} [data] the op's fields
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function requestVehicleDrive(vehicle, op, data = {}) {
  const payload = { vehicleUuid: str(vehicle?.uuid), op, ...data };
  const reply = await requestRelay(RELAY_ACTION_VEHICLE_DRIVE, payload);
  if (reply.ok === true && reply.result?.ok !== false) return { ok: true };
  const reason = reply.ok ? reply.result?.reason ?? 'rejected' : reply.reason ?? 'error';
  if (!isNoGmReason(reason)) notify('warn', reason === 'rejected' ? `You can't change ${vehicle?.name ?? 'this vehicle'} that way.` : `The change to ${vehicle?.name ?? 'the vehicle'} could not be applied.`);
  return { ok: false, reason };
}

/** Set the Critical choice of the stored result (the card's "Take 1 AI Favor instead"). */
export const chooseVehicleResult = (vehicle, messageId, choice) => requestVehicleDrive(vehicle, 'choose', { messageId, choice });
/** Clear the stored Table 6 result. */
export const clearVehicleResult = (vehicle) => requestVehicleDrive(vehicle, 'clear');
/** The GM's override: set this round's result by hand (a degree id, or '' for none). GM only. */
export const overrideVehicleResult = (vehicle, outcome, choice = '') => requestVehicleDrive(vehicle, 'override', { outcome, choice });
