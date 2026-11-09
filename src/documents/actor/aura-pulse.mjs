/**
 * Who an active aura reaches, and what happens to them as they come and go.
 *
 * Membership is geometry: caster token centre to each candidate token centre, measured with
 * `measureTokenFeet` (never `canvas.grid.measureDistance`, never a controlled-token fallback). The aura's
 * Region is drawn to match but never read. Which side a candidate is on comes from `isMobSide`, relative to
 * the caster.
 *
 * What the aura applies is split by when it happens:
 *  - Entry effects (this module's `syncAuraMembership`, also run at the cast): buffs, temporary health bars
 *    (once per ally per activation; put away on exit and restored at the same level on re-entry), and one
 *    heal-over-time per ally per activation. Exit removes the buffs, puts the bars away, and ends an enemy's
 *    aura debuffs that have no duration of their own (one with a duration runs it out).
 *  - Pulse effects (`applyAuraPulse`, run by the Step 5 pulse): instant healing, cleansing, periodic damage and
 *    inflicted debuffs. The cast itself applies none of these.
 *
 * State lives on the aura item (`system.auraState`). Nothing here reads names or descriptions.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { resolveReachedRankBreaks } from '../../utils/skill/rank-breaks.mjs';
import { measureTokenFeet } from '../../utils/combat/interrupts.mjs';
import { isMobSide } from '../../utils/combat/combat-sides.mjs';
import { isAuraItem } from '../../utils/tag/tag-mechanics.mjs';
import { isMarkerActor } from '../../utils/area/marker.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { auraRank, computeAuraTempBars, buildAuraEffectItems, inflictedDebuffsOf } from './aura-effects.mjs';
import {
  canWriteActor, grantAllyTempBars, createAllyEffects, healAllyFromAura, cleanseAllyFromAura,
  damageTargetFromAura, inflictAuraDebuff, removeAuraItems
} from './aura-relay.mjs';

const FILTERS = ['allies', 'enemies', 'both'];
/** Slack for floating-point distances sitting exactly on the radius. */
const EDGE_EPSILON = 1e-6;

const asArray = (collection) => {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  return Array.from(collection);
};

const keyOf = (actor) => actor?.uuid || actor?.id || '';
const dispositionOf = (token) => token?.document?.disposition ?? token?.disposition;

/**
 * Normalise an aura's target filter: arrays and comma lists take the first entry, `all` means `both`,
 * anything unknown means `allies`.
 * @param {*} raw
 * @returns {'allies'|'enemies'|'both'}
 */
export function normalizeAuraFilter(raw) {
  const val = String(firstScalar(raw)).trim().toLowerCase();
  if (val === 'all') return 'both';
  return FILTERS.includes(val) ? val : 'allies';
}

/**
 * The aura's radius in feet: the configured radius (5 when missing or not positive) plus the reached rank
 * breaks' radius bonus. Skill auras use the skill rank.
 * @returns {number}
 */
export function auraRadius(holder, item) {
  let radius = Number(item?.system?.area?.radius);
  if (!Number.isFinite(radius) || radius <= 0) radius = 5;
  return radius + (resolveReachedRankBreaks(item, auraRank(holder, item)).area?.radiusBonus || 0);
}

/**
 * Which side of the aura a candidate is on, relative to its caster. Markers are not creatures (null), and
 * neutral or secret tokens are unaffected (null) unless they are crawlers or pets.
 * @param {Actor} caster
 * @param {Token|null} casterToken
 * @param {Actor} candidate
 * @param {Token|null} candidateToken
 * @returns {'ally'|'enemy'|null}
 */
export function auraSideOf(caster, casterToken, candidate, candidateToken) {
  if (!candidate || isMarkerActor(candidate) || isMarkerActor(candidateToken)) return null;
  const disposition = dispositionOf(candidateToken);
  const unaligned = disposition === 0 || disposition === -2; // NEUTRAL, SECRET
  if (unaligned && candidate.type !== 'crawler' && candidate.type !== 'pet') return null;
  const casterIsMob = isMobSide({ actor: caster, token: { disposition: dispositionOf(casterToken) } });
  const candidateIsMob = isMobSide({ actor: candidate, token: { disposition } });
  return casterIsMob === candidateIsMob ? 'ally' : 'enemy';
}

/**
 * What an aura applies, read from its own config only.
 * @returns {{ friendly: { buffs: boolean, tempBars: { slots: number, hpPerSlot: number, element: string }, healBars: number, isHoT: boolean, cleanse: string[] },
 *   hostile: { damageFormula: string|null, damageType: string, debuffs: string[] } }}
 */
export function auraEffectsOf(holder, item) {
  const area = item?.system?.area || {};
  const { slots, hpPerSlot, element } = computeAuraTempBars(holder, item);
  const formula = String(area.periodicDamageFormula ?? '').trim();
  return {
    friendly: {
      buffs: buildAuraEffectItems(holder, item).length > 0,
      tempBars: { slots, hpPerSlot, element },
      healBars: Number(area.healingBars) || 0,
      isHoT: Boolean(area.isHoT),
      cleanse: Array.isArray(area.cleanseDebuffs) ? area.cleanseDebuffs.filter(Boolean) : []
    },
    hostile: {
      damageFormula: area.hasPeriodicDamage && formula ? formula : null,
      damageType: area.periodicDamageType || 'Physical',
      debuffs: inflictedDebuffsOf(item)
    }
  };
}

/** True when the aura damages or inflicts anything on enemies. */
export function hasHostileEffects(item) {
  const { hostile } = auraEffectsOf(item?.parent, item);
  return Boolean(hostile.damageFormula) || hostile.debuffs.length > 0;
}

/** An empty `auraState` (what an inactive aura holds). */
export function blankAuraState() {
  return {
    sceneId: '', tokenId: '', allyUuids: [], enemyUuids: [], tempBarUuids: [], hotUuids: [],
    storedBars: [], pulseCombatId: '', pulseRound: 0
  };
}

/**
 * The tokens of a scene and a feet measurer between two of them. The viewed scene uses the canvas
 * placeables and `measureTokenFeet`; any other scene uses its token documents and a straight-line measure.
 * @param {Scene} scene
 * @param {{ centres?: Map<string, {x:number,y:number}> }} [options] `centres`: token id -> where its centre will be
 *   (a token mid-movement, whose document and placeable still hold the origin)
 * @returns {{ tokens: object[], measure: (a: object, b: object) => number|null }}
 */
function sceneTokenViews(scene, { centres = null } = {}) {
  const viewed = globalThis.canvas?.scene;
  if (viewed && (scene === viewed || (scene?.id && scene.id === viewed.id))) {
    const placeables = asArray(globalThis.canvas?.tokens?.placeables).map(t => {
      const centre = centres?.get(t?.id ?? t?.document?.id);
      return centre ? Object.create(t, { center: { value: centre, enumerable: true } }) : t;
    });
    return { tokens: placeables, measure: measureTokenFeet };
  }
  const size = Number(scene?.grid?.size) || 100;
  const unit = Number(scene?.grid?.distance) || 5;
  const tokens = asArray(scene?.tokens).map(doc => {
    const span = size * (Number(doc.width) || 1);
    const height = size * (Number(doc.height) || 1);
    return {
      id: doc.id,
      actor: doc.actor ?? null,
      document: doc,
      center: centres?.get(doc.id) ?? doc.object?.center ?? { x: (Number(doc.x) || 0) + span / 2, y: (Number(doc.y) || 0) + height / 2 }
    };
  });
  const measure = (a, b) => (a?.center && b?.center
    ? Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) / size * unit
    : null);
  return { tokens, measure };
}

/**
 * The board the aura is on: its scene, caster token and candidate tokens.
 * @returns {{ scene: Scene, casterToken: object, tokens: object[], measure: Function }|null|'gone'}
 *   null when the aura has no caster token (theatre of the mind), 'gone' when its token or scene is missing.
 */
function resolveAuraGeometry(holder, item, { centres = null } = {}) {
  const state = item?.system?.auraState;
  if (!state?.tokenId) return null;
  const viewed = globalThis.canvas?.scene;
  const scene = (!state.sceneId || state.sceneId === viewed?.id) ? viewed : globalThis.game?.scenes?.get?.(state.sceneId);
  if (!scene) return 'gone';
  const { tokens, measure } = sceneTokenViews(scene, { centres });
  const casterToken = tokens.find(t => t.id === state.tokenId || t.document?.id === state.tokenId);
  if (!casterToken) return 'gone';
  return { scene, casterToken, tokens, measure };
}

/**
 * Who is inside the aura now. Pure given its inputs. Excludes the caster, tokens without an actor, markers,
 * neutral non-crawlers and actors at 0 HP; a linked actor with several tokens counts once. A distance equal
 * to the radius is inside.
 * @param {{ caster: Actor, casterToken: object, tokens: object[], radius: number, filter?: string, hostile?: boolean, measure?: Function }} p
 *   `hostile`: the aura damages or inflicts debuffs, so enemies are members whatever the filter says.
 * @returns {{ allies: Actor[], enemies: Actor[] }}
 */
export function computeAuraMembers({ caster, casterToken, tokens, radius, filter = 'allies', hostile = false, measure = measureTokenFeet }) {
  const normalized = normalizeAuraFilter(filter);
  const wantAllies = normalized === 'allies' || normalized === 'both';
  const wantEnemies = normalized === 'enemies' || normalized === 'both' || Boolean(hostile);
  const allies = [];
  const enemies = [];
  const seen = new Set([keyOf(caster)]);
  for (const token of tokens) {
    const actor = token?.actor;
    if (!actor || token === casterToken || (casterToken && token.id === casterToken.id)) continue;
    const key = keyOf(actor);
    if (seen.has(key)) continue;
    if (!(Number(actor.system?.attributes?.hp?.value ?? 1) > 0)) continue;
    const side = auraSideOf(caster, casterToken, actor, token);
    if (!side || (side === 'ally' ? !wantAllies : !wantEnemies)) continue;
    const distance = measure(casterToken, token);
    if (distance === null || distance === undefined || distance > radius + EDGE_EPSILON) continue;
    seen.add(key);
    (side === 'ally' ? allies : enemies).push(actor);
  }
  return { allies, enemies };
}

/**
 * Allies for an aura with no caster token: explicit `options.allies`, plus, with no canvas scene, the
 * friendly combatants of the current combat. Honours the aura's target filter.
 * @returns {Actor[]}
 */
export function fallbackAuraAllies(holder, item, options = {}) {
  const filter = normalizeAuraFilter(item?.system?.area?.targetFilter);
  if (filter !== 'allies' && filter !== 'both') return [];
  const found = [];
  const add = (actor) => {
    if (actor && keyOf(actor) !== keyOf(holder) && !found.some(a => keyOf(a) === keyOf(actor))) found.push(actor);
  };
  if (Array.isArray(options.allies)) options.allies.forEach(add);
  const combatants = options.combatants || asArray(globalThis.game?.combat?.combatants);
  if (combatants.length && !globalThis.canvas?.scene) {
    for (const c of combatants) {
      const actor = c.actor || globalThis.game?.actors?.get?.(c.actorId);
      if (actor && (actor.type === 'crawler' || actor.type === 'pet' || actor.type === 'mercenary' || c.disposition === 1)) add(actor);
    }
  }
  return found;
}

// ---------------------------------------------------------------- membership

function readState(item) {
  const s = item?.system?.auraState || {};
  const list = (v) => (Array.isArray(v) ? [...v] : []);
  return {
    allyUuids: list(s.allyUuids),
    enemyUuids: list(s.enemyUuids),
    tempBarUuids: list(s.tempBarUuids),
    hotUuids: list(s.hotUuids),
    storedBars: Array.isArray(s.storedBars) ? s.storedBars.map(b => ({ ...b })) : []
  };
}

/** Write the state back, along with every ally the aura has ever given something to. Skips a no-change write. */
async function commitState(item, before, after) {
  const same = JSON.stringify(before) === JSON.stringify(after);
  if (same) return;
  const applied = Array.isArray(item.system.appliedAllyUuids) ? item.system.appliedAllyUuids : [];
  await item.update({
    'system.auraState.allyUuids': after.allyUuids,
    'system.auraState.enemyUuids': after.enemyUuids,
    'system.auraState.tempBarUuids': after.tempBarUuids,
    'system.auraState.hotUuids': after.hotUuids,
    'system.auraState.storedBars': after.storedBars,
    'system.appliedAllyUuids': [...new Set([...applied, ...after.allyUuids])]
  });
}

function holdsAuraItem(actor, item, type) {
  return asArray(actor?.items).some(it => it.type === type && it.flags?.[SYSTEM_ID]?.auraSourceUuid === item.uuid);
}

/** Put an ally's stored bars back at the level they were put away. True when done (or nothing to restore). */
async function restoreStoredBars(actor, item, stored) {
  if (!(canWriteActor(actor) || !actor.uuid)) return false;
  const current = actor.system?.attributes?.hp?.tempBars;
  if (current?.count > 0 && current.sourceUuid && current.sourceUuid !== item.uuid) return true; // other bars: leave them
  const total = Math.max(0, (stored.count - 1) * stored.hpPerSlot + stored.currentSlotHp);
  await actor.update({
    'system.attributes.hp.tempBars.count': stored.count,
    'system.attributes.hp.tempBars.maxCount': stored.maxCount,
    'system.attributes.hp.tempBars.hpPerSlot': stored.hpPerSlot,
    'system.attributes.hp.tempBars.currentSlotHp': stored.currentSlotHp,
    'system.attributes.hp.tempBars.source': item.name,
    'system.attributes.hp.tempBars.sourceUuid': item.uuid || '',
    'system.attributes.hp.tempBars.element': stored.element || '',
    'system.attributes.hp.temp': total
  });
  return true;
}

/** Entry effects for one ally. True when every write it needed went through (a relay may have had no GM). */
async function enterAlly(holder, item, state, actor) {
  const key = keyOf(actor);
  const fx = auraEffectsOf(holder, item).friendly;
  let ok = true;
  if (!holdsAuraItem(actor, item, 'buff')) ok = (await createAllyEffects(actor, item)) && ok;

  if (fx.tempBars.slots > 0 && fx.tempBars.hpPerSlot > 0) {
    const stored = state.storedBars.find(b => b.uuid === key);
    if (stored) {
      if (await restoreStoredBars(actor, item, stored)) state.storedBars = state.storedBars.filter(b => b.uuid !== key);
      else ok = false;
    } else if (!state.tempBarUuids.includes(key)) {
      if (await grantAllyTempBars(actor, item)) state.tempBarUuids.push(key);
      else ok = false;
    }
  }

  if (fx.isHoT && fx.healBars > 0 && !state.hotUuids.includes(key)) {
    if (await healAllyFromAura(actor, item)) state.hotUuids.push(key);
    else ok = false;
  }
  return ok;
}

/** Exit effects for one ally: the buffs go, the temp bars are put away at their level. True when done. */
async function leaveAlly(item, state, actor) {
  const key = keyOf(actor);
  const bars = actor.system?.attributes?.hp?.tempBars;
  const away = bars?.sourceUuid === item.uuid && bars.count > 0
    ? { uuid: key, count: bars.count, maxCount: bars.maxCount, hpPerSlot: bars.hpPerSlot, currentSlotHp: bars.currentSlotHp, element: bars.element || '' }
    : null;
  if (!(await removeAuraItems(actor, item, { types: ['buff', 'tempBars'] }))) return false;
  if (away) state.storedBars = [...state.storedBars.filter(b => b.uuid !== key), away];
  return true;
}

/** Actors for these member keys: the ones already in hand first, then by UUID. */
const resolveAll = (uuids, known = []) => uuids.map(k => known.find(a => keyOf(a) === k) ?? resolveActorByUuid(k)).filter(Boolean);

/**
 * Apply a membership change: `allies`/`enemies` are who is inside now. Newcomers get entry effects, those no
 * longer inside get exit effects (unless `additive`, which only admits). An actor whose writes could not all
 * be made stays out of the member list (or, for an exit, stays in it), so a later sync retries.
 */
async function reconcile(holder, item, { allies, enemies = [], additive = false }) {
  const before = readState(item);
  const state = readState(item);
  const inside = { allies: new Map(allies.map(a => [keyOf(a), a])), enemies: new Map(enemies.map(a => [keyOf(a), a])) };
  const entered = { allies: [], enemies: [] };
  const left = { allies: [], enemies: [] };

  const nextAllies = [];
  for (const key of state.allyUuids) {
    if (inside.allies.has(key) || additive) { nextAllies.push(key); continue; }
    const actor = resolveActorByUuid(key);
    if (!actor) continue; // deleted: nothing to undo
    if (await leaveAlly(item, state, actor)) left.allies.push(actor);
    else nextAllies.push(key);
  }
  for (const [key, actor] of inside.allies) {
    if (state.allyUuids.includes(key)) continue;
    if (await enterAlly(holder, item, state, actor)) {
      nextAllies.push(key);
      entered.allies.push(actor);
    }
  }
  state.allyUuids = nextAllies;

  if (!additive) {
    const nextEnemies = [];
    for (const key of state.enemyUuids) {
      if (inside.enemies.has(key)) { nextEnemies.push(key); continue; }
      const actor = resolveActorByUuid(key);
      if (!actor) continue;
      if (await removeAuraItems(actor, item, { types: ['debuff'], keepTimed: true })) left.enemies.push(actor);
      else nextEnemies.push(key);
    }
    for (const [key, actor] of inside.enemies) {
      if (state.enemyUuids.includes(key)) continue;
      nextEnemies.push(key);
      entered.enemies.push(actor);
    }
    state.enemyUuids = nextEnemies;
  }

  await commitState(item, before, state);
  return {
    entered, left,
    allies: resolveAll(state.allyUuids, [...inside.allies.values()]),
    enemies: resolveAll(state.enemyUuids, [...inside.enemies.values()])
  };
}

/**
 * Recompute who is inside the aura and apply entry/exit effects. Without a caster token the stored members
 * are left alone. If the token or scene is gone, everyone exits.
 * @returns {Promise<{ entered: {allies: Actor[], enemies: Actor[]}, left: {allies: Actor[], enemies: Actor[]}, allies: Actor[], enemies: Actor[] }>}
 */
export async function syncAuraMembership(holder, item, { centres = null } = {}) {
  const geometry = resolveAuraGeometry(holder, item, { centres });
  if (geometry === null) {
    const state = readState(item);
    return {
      entered: { allies: [], enemies: [] }, left: { allies: [], enemies: [] },
      allies: resolveAll(state.allyUuids), enemies: resolveAll(state.enemyUuids)
    };
  }
  const inside = geometry === 'gone'
    ? { allies: [], enemies: [] }
    : computeAuraMembers({
      caster: holder,
      casterToken: geometry.casterToken,
      tokens: geometry.tokens,
      radius: auraRadius(holder, item),
      filter: item.system.area?.targetFilter,
      hostile: hasHostileEffects(item),
      measure: geometry.measure
    });
  return reconcile(holder, item, inside);
}

/** Give these allies the entry effects (no exits): the cast's path when the caster has no token. */
export async function enterAuraAllies(holder, item, allies) {
  return reconcile(holder, item, { allies, additive: true });
}

/** The caster's own entry effects at the cast: the buffs, and its one heal-over-time. */
export async function enterAuraCaster(holder, item) {
  const before = readState(item);
  const state = readState(item);
  const key = keyOf(holder);
  const fx = auraEffectsOf(holder, item).friendly;
  if (!holdsAuraItem(holder, item, 'buff')) await createAllyEffects(holder, item);
  if (fx.isHoT && fx.healBars > 0 && !state.hotUuids.includes(key)) {
    if (await healAllyFromAura(holder, item)) state.hotUuids.push(key);
  }
  await commitState(item, before, state);
}

// ---------------------------------------------------------------- pulse effects

async function rollAuraDamage(formula) {
  try {
    if (typeof Roll !== 'undefined') {
      const roll = new Roll(formula);
      const rolled = await roll.evaluate();
      return (rolled ?? roll).total;
    }
  } catch { /* fall through to the constant */ }
  return parseInt(formula, 10) || 4;
}

/**
 * Record the round (and combat) a pulse inflicted an aura debuff in, so the same Clean Up's durations step does not
 * count its first round down (3.40 g). Local write: the pulse runs on the GM, and an unowned actor's relayed debuff
 * simply keeps no mark.
 */
export async function markAppliedRound(debuff, { round, combatId }) {
  if (typeof debuff?.setFlag !== 'function') return;
  await debuff.setFlag(SYSTEM_ID, 'appliedRound', Number(round) || 0);
  await debuff.setFlag(SYSTEM_ID, 'appliedCombatId', combatId ?? '');
}

/** The debuff an aura stamped on an actor for a condition ref (by the aura's UUID and the ref, never by name). */
function stampedAuraDebuff(actor, item, ref) {
  return asArray(actor.items).find(i => i.type === 'debuff' &&
    i.flags?.[SYSTEM_ID]?.auraSourceUuid === item.uuid && i.flags?.[SYSTEM_ID]?.auraDebuffRef === ref);
}

/**
 * The per-pulse effects of an aura on the given members: instant healing and cleansing for allies, and for
 * enemies one damage roll for the whole pulse (applied to each enemy through its own damage path, so each
 * target's DR and resistances apply) and each inflicted debuff the enemy lacks (found by the aura's UUID and
 * the configured debuff ref, never by name).
 * @param {Actor} holder
 * @param {Item} item
 * @param {{ allies?: Actor[], enemies?: Actor[] }} members
 * @returns {Promise<{ allies: Array<{actor: Actor, healed: boolean, cleansed: string[]}>,
 *   enemies: Array<{actor: Actor, damage: number, damageType: string, debuffs: string[], inflicted: string[]}>,
 *   damage: {formula: string, total: number, type: string}|null }>} `damage` is the one roll (null when none was made)
 */
export async function applyAuraPulse(holder, item, { allies = [], enemies = [], stamp = null } = {}) {
  const fx = auraEffectsOf(holder, item);
  const report = { allies: [], enemies: [], damage: null, errors: [] };
  // One member failing is a line on the card, not the end of the pulse (3.40 e).
  const fail = (actor, err) => {
    console.error(`Sprinter RPG | Aura pulse "${item?.name}" failed on ${actor?.name}:`, err);
    report.errors.push({ actor, message: err?.message ?? String(err) });
  };

  for (const actor of allies) {
    const entry = { actor, healed: false, cleansed: [] };
    try {
      if (fx.friendly.healBars > 0 && !fx.friendly.isHoT) entry.healed = Boolean(await healAllyFromAura(actor, item));
      for (const ref of fx.friendly.cleanse) {
        if (await cleanseAllyFromAura(actor, item, ref)) entry.cleansed.push(ref);
      }
      actor.prepareData?.();
    } catch (err) { fail(actor, err); }
    report.allies.push(entry);
  }

  // One roll per pulse for everyone inside.
  let rolled = 0;
  if (fx.hostile.damageFormula && enemies.length) {
    rolled = await rollAuraDamage(fx.hostile.damageFormula);
    report.damage = { formula: fx.hostile.damageFormula, total: rolled, type: fx.hostile.damageType };
  }
  for (const actor of enemies) {
    let damage = 0;
    const inflicted = [];
    try {
      if (report.damage) {
        damage = rolled;
        await damageTargetFromAura(actor, item, damage);
      }
      for (const ref of fx.hostile.debuffs) {
        const present = asArray(actor.items).some(i => i.type === 'debuff' &&
          i.flags?.[SYSTEM_ID]?.auraSourceUuid === item.uuid && i.flags?.[SYSTEM_ID]?.auraDebuffRef === ref);
        if (!present && await inflictAuraDebuff(actor, item, ref)) {
          inflicted.push(ref);
          if (stamp) await markAppliedRound(stampedAuraDebuff(actor, item, ref), stamp);
        }
      }
      if (inflicted.length) actor.prepareData?.();
    } catch (err) { fail(actor, err); }
    report.enemies.push({ actor, damage, damageType: fx.hostile.damageType, debuffs: fx.hostile.debuffs, inflicted });
  }
  return report;
}

// ---------------------------------------------------------------- lock, pulse, discovery

const auraLocks = new Map();

/**
 * Run `fn` after every earlier call for the same key has settled, so a membership sync and a pulse on the
 * same aura never interleave (both read-then-write `auraState`). A failing `fn` does not block the next.
 * @template T
 * @param {string} key the aura item's UUID
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>}
 */
export function withAuraLock(key, fn) {
  const id = String(key || '');
  const previous = auraLocks.get(id) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.catch(() => {});
  auraLocks.set(id, tail);
  tail.then(() => { if (auraLocks.get(id) === tail) auraLocks.delete(id); });
  return run;
}

/**
 * Pulse one active aura once for a combat round: re-sync who is inside, apply the per-pulse effects, and stamp
 * the combat and round so the aura never pulses twice in one round (also across a Step 5 re-entry). Nothing
 * pulses out of combat. Runs under the aura's lock. The countdown and the end of the aura belong to
 * `processRoundDurations`, which runs after the pulse.
 * @param {Actor} holder
 * @param {Item} item
 * @param {{ combat?: Combat|null, round?: number|null }} [options]
 * @returns {Promise<{ pulsed: boolean, skipped?: 'inactive'|'no-combat'|'already-pulsed'|'no-token', entered?: object, left?: object, allies?: Actor[], enemies?: Actor[], report?: object }>}
 */
export function pulseAura(holder, item, { combat = null, round = null } = {}) {
  return withAuraLock(item?.uuid, async () => {
    if (!item?.system?.active) return { pulsed: false, skipped: 'inactive' };
    if (!combat) return { pulsed: false, skipped: 'no-combat' };
    const when = Number(round ?? combat.round) || 0;
    const state = item.system.auraState || {};
    if (state.pulseCombatId === combat.id && Number(state.pulseRound) === when) return { pulsed: false, skipped: 'already-pulsed' };

    if (resolveAuraGeometry(holder, item) === 'gone') return { pulsed: false, skipped: 'no-token' };
    const sync = await syncAuraMembership(holder, item);
    const report = await applyAuraPulse(holder, item, { allies: [holder, ...sync.allies], enemies: sync.enemies, stamp: { round: when, combatId: combat.id ?? '' } });
    await item.update({ 'system.auraState.pulseCombatId': combat.id || '', 'system.auraState.pulseRound': when });
    return { pulsed: true, entered: sync.entered, left: sync.left, allies: sync.allies, enemies: sync.enemies, report };
  });
}

/**
 * The active auras that pulse on a scene: aura items whose caster token is on it, plus, with a combat, auras
 * with no caster token held by a combatant. Held by token actors (unlinked tokens included) or combatants.
 * Deduped by item UUID. Does not read regions.
 * @param {Scene} scene
 * @param {{ combat?: Combat|null }} [options]
 * @returns {Array<{ holder: Actor, item: Item }>}
 */
export function activeAurasOnScene(scene, { combat = null } = {}) {
  const { tokens } = sceneTokenViews(scene);
  const tokenIds = new Set(tokens.map(t => t.id ?? t.document?.id));
  const found = [];
  const seen = new Set();
  const holders = new Set();
  const consider = (holder, hasToken) => {
    if (!holder || holders.has(holder)) return;
    holders.add(holder);
    for (const item of asArray(holder.items)) {
      if (!item?.system?.active || !isAuraItem(item) || seen.has(item.uuid || item.id)) continue;
      const state = item.system.auraState || {};
      const here = state.tokenId
        ? hasToken && (!state.sceneId || state.sceneId === scene?.id) && tokenIds.has(state.tokenId)
        : Boolean(combat);
      if (!here) continue;
      seen.add(item.uuid || item.id);
      found.push({ holder, item });
    }
  };
  for (const token of tokens) consider(token.actor, true);
  for (const combatant of asArray(combat?.combatants)) {
    consider(combatant.actor || globalThis.game?.actors?.get?.(combatant.actorId), false);
  }
  return found;
}
