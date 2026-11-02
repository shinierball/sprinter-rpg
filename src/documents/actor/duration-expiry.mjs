import { SYSTEM_ID } from '../../constants.mjs';
import { isActiveGM } from '../../utils/gm-relay.mjs';
import { clearDispelsForCombat } from '../../utils/dispel.mjs';
import { isAuraItem } from '../../utils/tag-mechanics.mjs';
import { TIME_UNITS, timingAmount, amountRounds } from '../../utils/timing.mjs';
import { durationSpec, effectiveDuration, expiryStamp, isTimeExpired, tickRoundDuration } from '../../utils/durations.mjs';
import { currentTimeContext } from './dungeon-time.mjs';
import { auraRank } from './aura-effects.mjs';
import { activeAurasOnScene } from './aura-pulse.mjs';

/**
 * Duration stamping and expiry.
 *
 * - Stamp: when an effect comes into force (a debuff created, or `system.active` flipping on) `COGItem` writes
 *   `durationConfig.expiresAt` (world time, time units) or `remainingRounds` (rounds).
 * - Sweep: on `updateWorldTime` the active GM ends every effect whose `expiresAt` is reached.
 * - Rounds: `COGCombat#processRoundDurations` counts rounds down in Clean Up and ends them with `expireEffect`.
 * - Combat end: `deleteCombat` ends the effects bound to the combat.
 * Gear never has a duration (a gear aura lasts while worn); zone regions run their own countdown (zone-pulse.mjs).
 */

/** Item types whose duration is stamped and counted. */
const TIMED_TYPES = new Set(['buff', 'debuff', 'spell', 'skill']);
const asArray = (list) => (Array.isArray(list) ? list : Array.from(list?.values?.() ?? list ?? []));

/** True when an effect is working: a debuff always, anything else while `system.active`. Gear is never timed. */
export function isInForce(item) {
  if (!item || item.type === 'gear') return false;
  if (item.type === 'debuff') return true;
  return item.system?.active === true;
}

const readChanged = (changed, path) => {
  if (changed && Object.hasOwn(changed, path)) return changed[path];
  return globalThis.foundry?.utils?.getProperty?.(changed, path);
};

/**
 * The duration fields an effect gets when it comes into force. Null when it is not timed that way.
 * @param {Item} item
 * @param {{ time?: number }} [now] `currentTimeContext()`
 * @returns {{ 'system.durationConfig.expiresAt'?: number, 'system.durationConfig.remainingRounds'?: number }|null}
 */
export function durationStampPatch(item, now = currentTimeContext(item?.actor ?? null)) {
  if (!item || !TIMED_TYPES.has(item.type)) return null;
  const cfg = item.system?.durationConfig;
  if (!cfg) return null;
  const rank = item.actor && (item.type === 'spell' || item.type === 'skill') ? auraRank(item.actor, item) : undefined;
  const eff = effectiveDuration(item, { rank });
  const kind = TIME_UNITS[eff.type]?.kind;
  if (kind !== 'time' && kind !== 'rounds') return null;
  const amount = timingAmount({ value: eff.value, unit: eff.type, scaleBy: eff.scaleBy }, { actor: item.actor ?? null, source: item }) + eff.bonus;
  if (kind === 'time') {
    if (Number.isFinite(cfg.expiresAt)) return null;
    return { 'system.durationConfig.expiresAt': expiryStamp({ ...cfg, type: eff.type }, now?.time ?? 0, { amount }) };
  }
  if ((Number(cfg.remainingRounds) || 0) > 0) return null;
  const rounds = Math.max(0, amountRounds('rounds', amount));
  return rounds > 0 ? { 'system.durationConfig.remainingRounds': rounds } : null;
}

/** `COGItem#_preCreate`: a new debuff, or a new item already active, is stamped. */
export function stampOnCreate(item) {
  if (!isInForce(item)) return null;
  const patch = durationStampPatch(item);
  if (patch) item.updateSource(patch);
  return patch;
}

/**
 * `COGItem#_preUpdate`: stamp when `system.active` flips on; clear `expiresAt` when it flips off. Anything else
 * about the update is left alone. Writes into `changed` (never over a value the update sets itself).
 * @returns {object|null} what was added
 */
export function stampOnUpdate(item, changed) {
  if (!item || !TIMED_TYPES.has(item.type) || item.type === 'debuff') return null;
  const next = readChanged(changed, 'system.active');
  if (typeof next !== 'boolean' || next === Boolean(item.system?.active)) return null;
  const patch = next ? durationStampPatch(item) : { 'system.durationConfig.expiresAt': null, 'system.durationConfig.remainingRounds': 0 };
  if (!patch) return null;
  const flat = Object.hasOwn(changed, 'system.active');
  const written = {};
  for (const [path, value] of Object.entries(patch)) {
    if (readChanged(changed, path) !== undefined) continue;
    if (flat) changed[path] = value;
    else globalThis.foundry.utils.setProperty(changed, path, value);
    written[path] = value;
  }
  return written;
}

// ---- Ending an effect --------------------------------------------------------------------------------------

/**
 * End one effect. A debuff is deleted; an aura goes through `deactivateAura`; anything else is switched off (and
 * releases the temporary bars it granted).
 * @param {Actor} actor the holder
 * @param {Item} item
 * @param {{ combatants?: object }} [opts]
 */
export async function expireEffect(actor, item, { combatants } = {}) {
  if (item.type === 'debuff') {
    await item.delete();
    return;
  }
  if (isAuraItem(item) && typeof actor.deactivateAura === 'function') {
    // Removes the aura's effects from the caster and everyone inside it
    await actor.deactivateAura(item, { combatants });
    return;
  }
  const currentSourceUuid = actor.system?.attributes?.hp?.tempBars?.sourceUuid;
  if (item.uuid && currentSourceUuid === item.uuid) {
    if (typeof actor.grantTempBars === 'function') {
      await actor.grantTempBars({ count: 0, hpPerSlot: 0 });
    } else {
      await actor.update({
        'system.attributes.hp.tempBars.count': 0,
        'system.attributes.hp.tempBars.currentSlotHp': 0,
        'system.attributes.hp.tempBars.source': '',
        'system.attributes.hp.tempBars.sourceUuid': '',
        'system.attributes.hp.temp': 0
      });
    }
  }
  await item.update({
    'system.active': false,
    'system.durationConfig.expiresAt': null,
    'system.durationConfig.remainingRounds': 0
  });
}

async function postExpiryCard(title, rows) {
  if (!rows.length || typeof ChatMessage === 'undefined' || typeof ChatMessage.create !== 'function') return;
  const msgs = rows.map(e => `<li><strong>${e.actorName}</strong>: <em>${e.itemName}</em> has faded.</li>`).join('');
  await ChatMessage.create({
    speaker: { alias: 'Combat Clock' },
    content: `<div class="cog-chat-card cog-expiration-card"><header class="cog-card-header"><span class="cog-badge">[DURATION EXPIRED]</span><h3>${title}</h3></header><div class="cog-card-body"><ul>${msgs}</ul></div></div>`
  });
}

const expiredRow = (actor, item, extra = {}) => ({
  actorId: actor.id, actorName: actor.name, itemId: item.id, itemName: item.name, itemType: item.type, ...extra
});

// ---- Round countdown ---------------------------------------------------------------------------------------

/** True when the effective duration (a reached rank-break override included) is in rounds. */
function countsInRounds(item, actor) {
  const rank = actor && (item.type === 'spell' || item.type === 'skill') ? auraRank(actor, item) : undefined;
  return effectiveDuration(item, { rank }).type === 'rounds';
}

/**
 * The round-timed effects to count down: every in-force round-timed item on a combatant, plus the auras held on
 * the combat's scene by actors who are not combatants.
 * @returns {Array<{ actor: Actor, item: Item, combatantId: string|null }>}
 */
export function roundTimedEffects(combat) {
  const found = [];
  const seen = new Set();
  const take = (actor, item, combatantId) => {
    if (!item || seen.has(item) || !isInForce(item) || !countsInRounds(item, actor)) return;
    seen.add(item);
    found.push({ actor, item, combatantId });
  };
  for (const c of asArray(combat.combatants)) {
    const actor = c.actor || globalThis.game?.actors?.get?.(c.actorId);
    if (!actor?.items) continue;
    for (const item of asArray(actor.items)) take(actor, item, c.id);
  }
  const scene = combat.scene ?? globalThis.canvas?.scene;
  if (scene) for (const { holder, item } of activeAurasOnScene(scene, { combat })) take(holder, item, null);
  return found;
}

/**
 * One Clean Up tick of every round-timed effect. Runs once per round: a second call for the same round does nothing.
 * @param {Combat} combat
 * @param {number} round
 * @returns {Promise<object[]>} the effects that ended
 */
export async function tickRoundEffects(combat, round) {
  const done = combat.getFlag?.(SYSTEM_ID, 'durationsTickedRound') ?? combat.flags?.[SYSTEM_ID]?.durationsTickedRound;
  if (Number(done) === Number(round)) return [];
  await combat.setFlag?.(SYSTEM_ID, 'durationsTickedRound', round);

  const expired = [];
  for (const { actor, item, combatantId } of roundTimedEffects(combat)) {
    const cfg = item.system.durationConfig;
    // Applied during this very Clean Up (a zone's condition): its first round counts from the next one.
    const stamp = item.flags?.[SYSTEM_ID];
    if (Number(stamp?.appliedRound) === Number(round) && stamp?.appliedCombatId === (combat.id ?? '')) continue;
    const remaining = Number(cfg.remainingRounds) > 0 ? cfg.remainingRounds : (durationStampPatch(item)?.['system.durationConfig.remainingRounds'] ?? 0);
    if (!(remaining > 0)) continue;
    const tick = tickRoundDuration({ remainingRounds: remaining });
    if (!tick.expired) {
      await item.update({ 'system.durationConfig.remainingRounds': tick.remainingRounds });
      continue;
    }
    const row = expiredRow(actor, item, { combatantId, round });
    await expireEffect(actor, item, { combatants: combat.combatants });
    expired.push(row);
  }
  await postExpiryCard(`Combat Round ${round} Expirations`, expired);
  return expired;
}

// ---- Combat end ---------------------------------------------------------------------------------------------

/** @returns {boolean} whether an effect lasts only as long as the combat */
export function endsWithCombat(item) {
  const cfg = item?.system?.durationConfig;
  return Boolean(cfg?.endsWithCombat) || ['combat', 'scene'].includes(durationSpec(cfg).unit);
}

/**
 * `deleteCombat`: end every in-force effect bound to the combat on its combatants.
 * @returns {Promise<object[]>}
 */
export async function expireCombatEffects(combat) {
  // A dispel (3.13-2) suspends Buffs "until the combat ends": its entries are bound to this combat and end with it.
  await clearDispelsForCombat(combat?.id, sweepActors());
  const targets = [];
  const seen = new Set();
  for (const c of asArray(combat?.combatants)) {
    const actor = c.actor || globalThis.game?.actors?.get?.(c.actorId);
    for (const item of asArray(actor?.items)) {
      if (seen.has(item) || !isInForce(item) || !endsWithCombat(item)) continue;
      seen.add(item);
      targets.push({ actor, item });
    }
  }
  const expired = [];
  for (const { actor, item } of targets) {
    const row = expiredRow(actor, item);
    await expireEffect(actor, item, { combatants: combat.combatants });
    expired.push(row);
  }
  await postExpiryCard('Combat Ended', expired);
  return expired;
}

// ---- World-time sweep ---------------------------------------------------------------------------------------

const expirySources = new Map();

/**
 * Add something else that ends on the clock (the torch burn registers `'lights'`, 3.12e).
 * @param {string} id
 * @param {{ collect: (now: number) => Array<{ label: string, actorName?: string, expire: () => Promise<void> }> }} source
 */
export function registerExpirySource(id, source) {
  if (typeof id === 'string' && id && typeof source?.collect === 'function') expirySources.set(id, source);
}
export function unregisterExpirySource(id) { expirySources.delete(id); }

/** Every world actor plus the unlinked token actors on every scene. */
function sweepActors() {
  const actors = new Map();
  const add = (actor) => { if (actor?.items) actors.set(actor.uuid || actor.id || actor, actor); };
  for (const actor of asArray(globalThis.game?.actors)) add(actor);
  for (const scene of asArray(globalThis.game?.scenes)) {
    for (const token of asArray(scene?.tokens)) if (token?.actorLink === false) add(token.actor);
  }
  return [...actors.values()];
}

/**
 * End everything whose stamped `expiresAt` has been reached. One pass per time change; debuffs of one actor go in a
 * single delete. Run by the active GM only (see `registerDurationHooks`).
 * @param {number} [now] world time (defaults to `game.time.worldTime`)
 * @returns {Promise<object[]>}
 */
export async function sweepTimedEffects(now = globalThis.game?.time?.worldTime) {
  const time = Number(now) || 0;
  const expired = [];
  for (const actor of sweepActors()) {
    const due = asArray(actor.items).filter(item => isInForce(item) && isTimeExpired(item.system?.durationConfig, time));
    if (!due.length) continue;
    const debuffs = due.filter(item => item.type === 'debuff');
    if (debuffs.length) {
      if (typeof actor.deleteEmbeddedDocuments === 'function') await actor.deleteEmbeddedDocuments('Item', debuffs.map(d => d.id));
      else for (const d of debuffs) await d.delete();
      for (const d of debuffs) expired.push(expiredRow(actor, d));
    }
    for (const item of due.filter(i => i.type !== 'debuff')) {
      await expireEffect(actor, item, { combatants: globalThis.game?.combat?.combatants });
      expired.push(expiredRow(actor, item));
    }
  }
  for (const source of expirySources.values()) {
    for (const entry of source.collect(time) ?? []) {
      await entry.expire();
      expired.push({ actorName: entry.actorName ?? '', itemName: entry.label });
    }
  }
  await postExpiryCard('Dungeon Clock Expirations', expired);
  return expired;
}

let hooks = null;
/** Register the world-time sweep and the combat-end expiry (active GM only at run time). Once, from the ready hook. */
export function registerDurationHooks() {
  if (hooks) return;
  hooks = [
    ['updateWorldTime', (worldTime) => { if (isActiveGM()) return sweepTimedEffects(worldTime); }],
    ['deleteCombat', (combat) => { if (isActiveGM()) return expireCombatEffects(combat); }]
  ];
  for (const [name, fn] of hooks) globalThis.Hooks?.on?.(name, fn);
}

/** Tests only. */
export function resetDurationHooksForTests() {
  for (const [name, fn] of hooks ?? []) globalThis.Hooks?.off?.(name, fn);
  hooks = null;
}
