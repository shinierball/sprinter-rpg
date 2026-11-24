/**
 * Vehicle driving, the wiring: the relay action `vehicleDrive` (3.44d) with its authorisation and its write ops, and the
 * chat-message hooks that ingest a vehicle check card. The parts it joins: `vehicle-move.mjs` (Move and speed),
 * `vehicle-checks.mjs` (driving checks, Table 6, the card ingest), `vehicle-after-roll.mjs` (offers on a card),
 * `vehicle-ram.mjs` (ramming, the explosion) and `vehicle-drive-common.mjs` (helpers and `requestVehicleDrive`).
 *
 * The relay registers when this module is evaluated; `hooks/ready.mjs` imports it at startup. Imports no sheet and not
 * `actor.mjs`.
 */
import { isMigrationWrite } from '../migrations/world-migration.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { registerRelayAction } from '../../utils/gm-relay.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { userOwnsActor } from './personal-space-links.mjs';
import { resultEffect, VEHICLE_CHECK_RESULTS } from '../../data/rules/vehicle-rules.mjs';
import { str, say, speakerOf, RELAY_ACTION_VEHICLE_DRIVE } from './vehicle-drive-common.mjs';
import { gmWhisper } from '../../utils/owner-recipients.mjs';
import { messageById } from '../../utils/card/recent-cards.mjs';
import { vehicleNow, writeVehicleSpeed } from './vehicle-move.mjs';
import { settleVehicleResult, syncCard, ingestVehicleCheck } from './vehicle-checks.mjs';
import { ramFlag, applyCollision, explodeVehicle } from './vehicle-ram.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

let hooksRegistered = false;

/** Register the ingest hooks (once). Called from the ready hook. */
export function registerVehicleDriveHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  const onMessage = (message) => ingestVehicleCheck(message).catch((err) => console.warn('Sprinter RPG | Vehicle check ingest failed', err));
  globalThis.Hooks?.on?.('createChatMessage', onMessage);
  globalThis.Hooks?.on?.('updateChatMessage', (message, _changes, options) => (isMigrationWrite(options) ? undefined : onMessage(message)));
}

/** Tests only. */
export function resetVehicleDriveHooks() {
  hooksRegistered = false;
}

// ---------------------------------------------------------------------------------------------------------------
// The relay: writes by someone who cannot write the vehicle

const OPS = Object.freeze(['speed', 'choose', 'clear', 'override', 'collision', 'explode']);

const driverActorOf = (vehicle) => resolveActorByUuid(str(vehicle.system?.pilotUuid)) ?? null;

function authorizeOp(payload, user) {
  if (!user) return false;
  const op = payload?.op;
  if (!OPS.includes(op)) return false;
  const vehicle = resolveActorByUuid(payload?.vehicleUuid);
  if (vehicle?.type !== 'mount_vehicle' || vehicle.pack) return false;
  if (user.isGM) return true;
  if (op === 'override' || op === 'explode') return false;
  const owner = userOwnsActor(vehicle, user);
  if (op === 'speed' || op === 'clear') return owner || userOwnsActor(driverActorOf(vehicle), user);
  if (op === 'choose') return owner || userOwnsActor(resolveActorByUuid(str(vehicle.system.drive?.result?.driverUuid)), user);
  if (op === 'collision') {
    // The ramming vehicle's driver (or an owner of it), for a ram card that names this vehicle.
    const ram = ramFlag(messageById(str(payload.messageId)));
    return Boolean(ram) && ram.vehicleUuid === str(payload.vehicleUuid) && (owner || userOwnsActor(driverActorOf(vehicle), user));
  }
  return false;
}

async function applyChoose(vehicle, payload) {
  const stored = vehicle.system.drive?.result ?? {};
  const messageId = str(payload.messageId);
  if (!stored.outcome || stored.messageId !== messageId) return { ok: false, reason: 'not-current' };
  const choice = str(payload.choice);
  if (!resultEffect(stored.outcome, '').choices.some((c) => c.id === choice)) return { ok: false, reason: 'bad-choice' };
  const settled = await settleVehicleResult(vehicle, {
    outcome: stored.outcome, choice, messageId, driverUuid: str(stored.driverUuid), gm: stored.gm === true, ruleBreak: stored.ruleBreak === true,
    now: { combatId: stored.combatId, round: stored.round }
  });
  const message = messageById(messageId);
  if (message) await syncCard(message, { outcome: stored.outcome, choice: settled.choice });
  return { ok: true };
}

async function applyOverride(vehicle, payload) {
  const outcome = str(payload.outcome);
  if (outcome && !Object.hasOwn(VEHICLE_CHECK_RESULTS, outcome)) return { ok: false, reason: 'bad-outcome' };
  await settleVehicleResult(vehicle, {
    outcome, choice: str(payload.choice), driverUuid: str(vehicle.system.pilotUuid), gm: Boolean(outcome), now: vehicleNow(), setAt: Date.now()
  });
  return { ok: true };
}

/** Clear is a full undo; the GM is told who undid which result, and what came back. */
async function applyClear(vehicle, user) {
  const was = vehicle.system.drive?.result ?? {};
  const prev = { outcome: str(was.outcome), driverUuid: str(was.driverUuid) };
  const damage = Number(was.applied?.damage) || 0;
  const favor = Number(was.applied?.aiFavor) || 0;
  await settleVehicleResult(vehicle, { outcome: '', now: vehicleNow(), setAt: Date.now() });
  if (!globalThis.ChatMessage?.create) return { ok: true };
  const label = prev.outcome && VEHICLE_CHECK_RESULTS[prev.outcome] ? say(VEHICLE_CHECK_RESULTS[prev.outcome].label, prev.outcome) : say('COG.VehicleUI.NoResult', 'None');
  const parts = [say('COG.VehicleClear.Note', '{user} cleared the result on {vehicle}. Was: {result}', { user: (user ?? globalThis.game?.user)?.name ?? '', vehicle: vehicle.name ?? '', result: label })];
  if (damage > 0) parts.push(say('COG.VehicleClear.Healed', '{hp} HP restored.', { hp: damage }));
  if (favor > 0) parts.push(say('COG.VehicleClear.Favor', '{favor} AI Favor taken back from {name}.', { favor, name: resolveActorByUuid(prev.driverUuid)?.name ?? '' }));
  await globalThis.ChatMessage.create({
    speaker: speakerOf(vehicle), whisper: gmWhisper(), content: `<div class="cog-chat-card cog-vehicle-clear">${escapeAttr(parts.join(' '))}</div>`
  });
  return { ok: true };
}

registerRelayAction(RELAY_ACTION_VEHICLE_DRIVE, {
  authorize: authorizeOp,
  apply: (payload, user) => {
    const vehicle = resolveActorByUuid(payload?.vehicleUuid);
    if (vehicle?.type !== 'mount_vehicle' || !OPS.includes(payload?.op)) return { ok: false, reason: 'rejected' };
    return runKeyed(`vehicle:${vehicle.uuid}`, async () => {
      switch (payload.op) {
        case 'speed': {
          const raw = (typeof payload.value === 'number' || (typeof payload.value === 'string' && payload.value.trim())) ? Number(payload.value) : NaN;
          if (!Number.isFinite(raw) || raw < 0) return { ok: false, reason: 'bad-speed' };
          return { ok: await writeVehicleSpeed(vehicle, Math.trunc(raw)) };
        }
        case 'choose': return applyChoose(vehicle, payload);
        case 'clear': return applyClear(vehicle, user);
        case 'override': return applyOverride(vehicle, payload);
        case 'collision': return applyCollision(vehicle, payload);
        case 'explode': return explodeVehicle(vehicle, { messageId: str(payload.messageId) });
        default: return { ok: false, reason: 'rejected' };
      }
    });
  }
});
