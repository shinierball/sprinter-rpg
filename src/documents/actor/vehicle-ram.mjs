/**
 * Ramming (3.44f) and the explosion at 0%: the ram card and its damage, the collision the GM applies from the card, and the
 * explosion prompt and damage.
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { collectDamageModifiers, multiplierFor, getActiveModifierSources } from '../../utils/roll/damage-modifiers.mjs';
import { buildRollContext } from '../../utils/roll/roll-context.mjs';
import { resolveActorByUuid, findTokenByActorUuid } from '../../utils/actor-uuid.mjs';
import { actorSizeNumber } from '../../data/sizes.mjs';
import { vehicleDamageCardHtml, vehicleButtonHtml, mobRamBannerHtml } from '../../utils/vehicle/vehicle-damage-card.mjs';
import { VEHICLE_TAGS } from '../../data/tag-vocabulary.mjs';
import { isSuccessOutcome } from '../../utils/roll/check-assists.mjs';
import { withVehicleSources } from '../../utils/vehicle/vehicle-check.mjs';
import { isTrustedAssist } from '../../chat/actions/use-assist.mjs';
import { driverOf } from './vehicle-crew.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { userOwnsActor } from './personal-space-links.mjs';
import { vehicleKindTag, ramDice, ramCollision, explosionFormula } from '../../data/rules/vehicle-rules.mjs';
import { getAttackDifficulty, evadeButtonHtml } from './attack-targets.mjs';
import { wholeFeet, notify, str, say, speakerOf, gmWhisper, messageById, cardFlag, cardKey, requestVehicleDrive } from './vehicle-drive-common.mjs';
import { rollVehicleCheck } from './vehicle-checks.mjs';
import { vehicleCardInfo } from './vehicle-after-roll.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

/** Chat-card flags of a ram and of the explosion. */
export const RAM_FLAGS = Object.freeze({
  attack: 'vehicleRamAttack', damage: 'vehicleRam', rolled: 'vehicleRamRolled', collision: 'vehicleCollision',
  explosion: 'vehicleExplosion', exploded: 'vehicleExploded'
});

const RAM_TAG = `${VEHICLE_TAGS.checkPrefix}ram`;
const actorOf = (ref) => (ref && typeof ref === 'object' ? ref : resolveActorByUuid(str(ref)));
const drOf = (actor) => Math.max(0, Math.trunc(Number(actor?.system?.attributes?.dr?.total)) || 0);
const canvasTokens = () => (Array.isArray(globalThis.canvas?.tokens?.placeables) ? globalThis.canvas.tokens.placeables : []);

/** The ram stored on a damage card (`flags.<system>.vehicleRam`), or null. */
export function ramFlag(message) {
  const f = cardFlag(message, RAM_FLAGS.damage);
  return f && typeof f === 'object' && str(f.vehicleUuid) ? f : null;
}

/** The actors listed aboard a vehicle that still resolve (the driver included). */
export function occupantsOf(vehicle) {
  const crew = Array.isArray(vehicle?.system?.occupants) ? vehicle.system.occupants : [];
  const seen = new Set();
  const out = [];
  for (const o of crew) {
    const actor = resolveActorByUuid(str(o?.uuid));
    if (actor && actor.type !== 'mount_vehicle' && !seen.has(actor.uuid)) {
      seen.add(actor.uuid);
      out.push(actor);
    }
  }
  return out;
}

/** Roll the added damage parts (`damageModifiers` add rows): [{ type, total, formula, source }]. */
async function rollAddParts(parts) {
  const out = [];
  for (const part of parts) {
    const flat = (Number(part.value) || 0) + (part.stat ? Number(part.statMod) || 0 : 0);
    let total = flat;
    let formula = flat ? String(flat) : '';
    if (part.dice) {
      const roll = await new Roll(String(part.dice)).evaluate();
      total += Number(roll.total) || 0;
      formula = [part.dice, flat ? (flat > 0 ? `+ ${flat}` : `- ${Math.abs(flat)}`) : ''].filter(Boolean).join(' ');
    }
    out.push({ type: part.type || 'Physical', total, formula, source: part.source || '' });
  }
  return out;
}

/**
 * Roll a ram's damage and post its card: (size + speed / 10) d6, plus the damage rows of the driver and of the vehicle's
 * installed gear and buffs read in a damage context tagged `vehicle.check.ram` (a Ram bumper, "+F when ramming"). The type is
 * Physical, the system's default for an untyped part. The card carries `vehicleRam` (who rammed whom and the rolled total) for
 * "Apply collision", and the normal Apply buttons for the target.
 * @param {Actor} vehicle the ramming vehicle
 * @param {Actor|null} driver
 * @param {Actor|null} target
 * @returns {Promise<ChatMessage|null>}
 */
export async function rollRamDamage(vehicle, driver, target) {
  if (vehicle?.type !== 'mount_vehicle') return null;
  const size = actorSizeNumber(vehicle);
  const dice = ramDice({ size, currentMove: wholeFeet(vehicle.system?.drive?.currentMove) });
  const roller = driver ?? vehicle;
  const base = buildRollContext({
    actor: roller, phase: 'damage', tags: [RAM_TAG, vehicleKindTag(vehicle.system?.kind)], other: target ?? null
  });
  // The vehicle's own rows are already the roller's when it rams without a driver; add them only for a driver.
  const context = withVehicleSources(base, { extraSources: driver ? getActiveModifierSources(vehicle) : [] });
  const dmod = collectDamageModifiers(roller, context, { primaryType: 'Physical' });
  const baseRoll = dice > 0 ? await new Roll(`${dice}d6`).evaluate() : null;
  const added = await rollAddParts(dmod.addParts);
  const parts = [
    { type: 'Physical', baseTotal: Number(baseRoll?.total) || 0, formula: `${dice}d6`, source: say('COG.VehicleRam.Dice', 'Ram dice') },
    ...added.map((a) => ({ type: a.type, baseTotal: a.total, formula: a.formula, source: a.source }))
  ].map((p) => {
    const multiplier = multiplierFor(dmod.multipliers, p.type);
    return { ...p, multiplier, finalDamage: Math.max(0, Math.floor(p.baseTotal * multiplier)) };
  });
  const total = parts.reduce((sum, p) => sum + p.finalDamage, 0);
  const title = say('COG.VehicleRam.CardTitle', '{name} rams {target}: Ram Damage', { name: vehicle.name ?? '', target: target?.name ?? '' });
  const content = vehicleDamageCardHtml({
    attackerUuid: roller.uuid, itemName: 'Ram', title, parts, rollContext: { ...context, appliedRowKeys: dmod.appliedKeys },
    extraButtonsHtml: vehicleButtonHtml(say('COG.VehicleRam.ApplyCollision', 'Apply collision'), 'crawlerVehicleCollision', { 'vehicle-uuid': vehicle.uuid })
  });
  return globalThis.ChatMessage.create({
    speaker: speakerOf(roller),
    content,
    ...(baseRoll ? { rolls: [baseRoll] } : {}),
    flags: { [SYSTEM_ID]: { [RAM_FLAGS.damage]: { vehicleUuid: vehicle.uuid, driverUuid: str(driver?.uuid), targetUuid: str(target?.uuid), damage: total } } }
  });
}

/**
 * A mob driver rams. Mobs never roll: the card is an auto-hit against the Difficulty the mob driver's attack carries (the
 * mob auto-hit path), with the crawler's Evade button; the Evade context carries `vehicle.check.ram`, so a row that
 * helps against a ram applies. The "Roll ram damage" button is the driver's.
 */
async function postMobRam(vehicle, mob, target, { headOn }) {
  const floor = getCurrentFloor();
  const dc = getAttackDifficulty(mob, null, floor);
  const context = buildRollContext({ actor: mob, phase: 'toHit', check: 'attack', tags: [RAM_TAG, vehicleKindTag(vehicle.system?.kind)], other: null });
  // A vehicle target is evaded by its driver (545): the Driving Evade carries the ram tag. Vehicles do not Evade on their own.
  const driver = target.type === 'mount_vehicle' ? driverOf(target) : null;
  let evade = '';
  if (target.type === 'mount_vehicle') {
    if (driver) {
      evade = vehicleButtonHtml(say('COG.Vehicle.Evade.Button', 'Driver: evade with a Driving check') + ` (${dc})`, 'crawlerVehicleEvade',
        { 'vehicle-uuid': target.uuid, 'driver-uuid': driver.uuid, 'target-dc': dc, ram: 'true' }, { className: 'cog-vehicle-evade-btn' });
    }
  } else {
    evade = evadeButtonHtml(mob, null, floor, { targetDC: dc, rollContext: context, isArea: false });
  }
  const damage = vehicleButtonHtml(say('COG.VehicleRam.RollDamage', 'Roll ram damage'), 'crawlerVehicleRamDamage', {}, { className: 'cog-attack-roll-btn' });
  const content = mobRamBannerHtml({ driverName: mob.name, vehicleName: vehicle.name, targetName: target.name, dc }) + evade + damage;
  return globalThis.ChatMessage.create({
    speaker: speakerOf(mob),
    content,
    flags: { [SYSTEM_ID]: { [RAM_FLAGS.attack]: { vehicleUuid: vehicle.uuid, driverUuid: mob.uuid, targetUuid: target.uuid, dc, headOn } } }
  });
}

/**
 * Start a ram: the driver (or the GM for a mob or NPC driver) rams one target. A crawler or NPC player rolls the operate skill
 * as a `ram` vehicle check against the target's Evade Difficulty (a creature's `getEvadeTargetDC`, a vehicle's 10 + speed / 5,
 * head-on 10), and the card offers "Roll ram damage" on a success. A mob never rolls.
 * @param {Actor} vehicle the ramming vehicle
 * @param {Actor} actor the driver
 * @param {{ target: Actor|string, headOn?: boolean }} options
 * @returns {Promise<ChatMessage|null|undefined>}
 */
export async function startVehicleRam(vehicle, actor, { target, headOn = false } = {}) {
  const victim = actorOf(target);
  if (vehicle?.type !== 'mount_vehicle' || !actor || !victim) return null;
  if (actor.type === 'mob') return postMobRam(vehicle, actor, victim, { headOn });
  const dc = victim.getEvadeTargetDC(getCurrentFloor(), { attacker: actor, headOn });
  return rollVehicleCheck(vehicle, actor, { kind: 'ram', dc, targetUuids: [victim.uuid], headOn });
}

/**
 * The "Roll ram damage" button of a ram card, read from the card (never the button): a successful `ram` vehicle check, or a
 * mob's ram card. The driver's owner or the GM may roll, once per card.
 * @param {object} message
 * @returns {Promise<ChatMessage|null>}
 */
export async function rollRamDamageFromCard(message) {
  const user = globalThis.game?.user;
  const attack = cardFlag(message, RAM_FLAGS.attack);
  let vehicle;
  let driver;
  let target;
  if (attack) {
    vehicle = resolveActorByUuid(str(attack.vehicleUuid));
    driver = resolveActorByUuid(str(attack.driverUuid));
    target = resolveActorByUuid(str(attack.targetUuid));
  } else {
    const info = vehicleCardInfo(message);
    if (!info || info.ref.kind !== 'ram' || !info.outcome || !isSuccessOutcome(info.outcome)) return null;
    ({ vehicle, roller: driver } = info);
    target = resolveActorByUuid(str(info.ref.targetUuids?.[0]));
  }
  if (vehicle?.type !== 'mount_vehicle' || !driver) return null;
  if (!user?.isGM && !userOwnsActor(driver, user)) return null;
  if (cardFlag(message, RAM_FLAGS.rolled)) {
    notify('info', say('COG.VehicleRam.AlreadyRolled', 'The ram damage has already been rolled for this ram.'));
    return null;
  }
  const posted = await rollRamDamage(vehicle, driver, target);
  if (posted) {
    try {
      await message.update({ [cardKey(RAM_FLAGS.rolled)]: true });
    } catch {
      // The card stays clickable; the GM adjudicates a second roll.
    }
  }
  return posted;
}

async function damageTarget(target, amount, attacker, messageId) {
  if (!target || amount <= 0) return null;
  const { COGDamage } = await import('./damage-pipeline.mjs');
  return COGDamage.applyDamageToTarget({
    targetActor: target, rawDamage: amount, typedDamage: { Physical: amount }, attackerActor: attacker,
    attackName: 'Collision', attackType: 'vehicle', messageId
  });
}

/**
 * Apply a ram's collision (the GM, from the damage card's own record): the ramming vehicle takes half the ram damage (the full
 * amount when the target is larger) through its own DR and its Move halves (0 when the target is larger); everyone aboard it
 * takes half of that share less their own DR and the vehicle's DR (547 a); when the target is a vehicle its occupants take the
 * same from the full damage. The target itself is hit by the card's normal Apply. Once per card.
 * @param {Actor} vehicle the ramming vehicle
 * @param {{ messageId?: string }} payload
 * @returns {Promise<{ ok: boolean, reason?: string, result?: object }>}
 */
export async function applyCollision(vehicle, payload) {
  const message = messageById(str(payload?.messageId));
  const ram = ramFlag(message);
  if (!ram || ram.vehicleUuid !== vehicle.uuid) return { ok: false, reason: 'no-card' };
  if (cardFlag(message, RAM_FLAGS.collision)) return { ok: false, reason: 'done' };
  const driver = resolveActorByUuid(str(ram.driverUuid));
  if (!isTrustedAssist(message, driver ?? vehicle)) return { ok: false, reason: 'untrusted' };
  const target = resolveActorByUuid(str(ram.targetUuid));
  const targetIsVehicle = target?.type === 'mount_vehicle';
  const aboard = occupantsOf(vehicle);
  const targetAboard = targetIsVehicle ? occupantsOf(target) : [];
  const damage = Math.max(0, Math.trunc(Number(ram.damage)) || 0);
  const collision = ramCollision({
    damage, ramSize: actorSizeNumber(vehicle), targetSize: target ? actorSizeNumber(target) : actorSizeNumber(vehicle),
    ramDr: drOf(vehicle), occupantDrs: aboard.map(drOf), targetIsVehicle, targetDr: drOf(target), targetOccupantDrs: targetAboard.map(drOf)
  });
  await message.update({ [cardKey(RAM_FLAGS.collision)]: true });

  const lines = [];
  const hit = async (who, amount) => {
    const res = await damageTarget(who, amount, driver ?? vehicle, message.id);
    const dealt = res && !res.error ? Number(res.actualDamage ?? res.damageAfterDR) || 0 : 0;
    lines.push(`${who.name}: ${amount} (${dealt} after DR)`);
  };
  await hit(vehicle, collision.rammerShare);
  for (const [i, who] of aboard.entries()) await hit(who, collision.occupants[i].share);
  for (const [i, who] of targetAboard.entries()) await hit(who, collision.targetOccupants[i].share);
  const speed = wholeFeet(vehicle.system?.drive?.currentMove);
  const next = Math.floor(speed * collision.moveMultiplier);
  if (next !== speed) await vehicle.update({ 'system.drive.currentMove': next });
  const head = collision.larger
    ? say('COG.VehicleRam.CollisionLarger', '{name} hits something larger: full damage, and it stops.', { name: vehicle.name ?? '' })
    : say('COG.VehicleRam.CollisionSummary', '{name} takes half the ram damage and slows to {speed} ft.', { name: vehicle.name ?? '', speed: next });
  await globalThis.ChatMessage.create({
    speaker: speakerOf(vehicle),
    content: `<div class="cog-chat-card cog-vehicle-collision"><strong>${escapeAttr(head)}</strong><ul>${lines.map((l) => `<li>${escapeAttr(l)}</li>`).join('')}</ul></div>`
  });
  return { ok: true, result: { collision, lines } };
}

// ---------------------------------------------------------------------------------------------------------------
// The explosion at 0% (3.44f)

/**
 * The GM's prompt when a vehicle reaches 0%: "Explode" or "Not this time". Whispered to the GMs.
 * @param {Actor} vehicle
 * @returns {Promise<ChatMessage|undefined>}
 */
export async function postExplosionPrompt(vehicle) {
  const content = `<div class="cog-chat-card cog-vehicle-explosion-prompt"><strong>${escapeAttr(say('COG.VehicleExplosion.AtZero', '{name} is at 0%.', { name: vehicle.name ?? '' }))}</strong>`
    + `<div>${vehicleButtonHtml(say('COG.VehicleExplosion.Explode', 'Explode'), 'crawlerVehicleExplode', { 'vehicle-uuid': vehicle.uuid })}`
    + ` ${vehicleButtonHtml(say('COG.VehicleExplosion.NotNow', 'Not this time'), 'crawlerVehicleExplodeDismiss', {})}</div></div>`;
  return globalThis.ChatMessage.create({
    speaker: speakerOf(vehicle), whisper: gmWhisper(), content,
    flags: { [SYSTEM_ID]: { [RAM_FLAGS.explosion]: { vehicleUuid: vehicle.uuid } } }
  });
}

/**
 * The explosion: `size d6 + Floor` Fire, rolled once, to everyone aboard. The card is the normal damage card with the
 * occupants' tokens targeted and the damage context tagged `vehicle.explosion`, so the vehicle's DR does not protect them
 * (their own DR and resistances apply). Occupants stay aboard; the GM disembarks them. Runs on the GM.
 * @param {Actor} vehicle
 * @param {{ messageId?: string }} [options] the prompt card, marked so a second click does nothing
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function explodeVehicle(vehicle, { messageId = '' } = {}) {
  if (vehicle?.type !== 'mount_vehicle') return { ok: false, reason: 'no-vehicle' };
  const prompt = messageById(messageId);
  if (prompt && cardFlag(prompt, RAM_FLAGS.exploded)) return { ok: false, reason: 'done' };
  if (prompt) await prompt.update({ [cardKey(RAM_FLAGS.exploded)]: true });
  const spec = explosionFormula({ size: actorSizeNumber(vehicle), floor: getCurrentFloor() });
  const roll = await new Roll(spec.formula).evaluate();
  const total = Math.max(0, Number(roll.total) || 0);
  const context = buildRollContext({ actor: vehicle, phase: 'damage', tags: [VEHICLE_TAGS.explosion], other: null });
  const aboard = occupantsOf(vehicle);
  const tokens = canvasTokens();
  let first = true;
  for (const who of aboard) {
    const token = findTokenByActorUuid(tokens, who.uuid);
    if (token?.setTarget) {
      token.setTarget(true, { releaseOthers: first });
      first = false;
    }
  }
  const type = spec.type.charAt(0).toUpperCase() + spec.type.slice(1);
  const content = vehicleDamageCardHtml({
    attackerUuid: vehicle.uuid, itemName: 'Explosion', title: say('COG.VehicleExplosion.CardTitle', '{name} explodes', { name: vehicle.name ?? '' }),
    parts: [{ type, finalDamage: total, baseTotal: total, formula: spec.formula }], rollContext: context,
    notes: aboard.length ? [say('COG.VehicleExplosion.Aboard', 'Aboard: {names}', { names: aboard.map((a) => a.name).join(', ') })] : []
  });
  await globalThis.ChatMessage.create({
    speaker: speakerOf(vehicle), content, rolls: [roll],
    flags: { [SYSTEM_ID]: { [RAM_FLAGS.explosion]: { vehicleUuid: vehicle.uuid, occupants: aboard.map((a) => a.uuid), damage: total } } }
  });
  return { ok: true };
}

/** The GM's Explode button on the drive panel: the same card with no prompt behind it. */
export const explodeVehicleNow = (vehicle) => requestVehicleDrive(vehicle, 'explode');
