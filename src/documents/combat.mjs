/**
 * Sprinter RPG — Custom Combat Document
 * 
 * Rules:
 * - Default Turn Order: Mobs act first in combat, Crawlers act second.
 * - Surprise Round: Crawlers act first if surprise is active (rare).
 * - Action Budget:
 *   - Mobs get 2 actions per round: max 1 Attack action; the other must be Move, non-attack skill, etc.
 *   - Crawlers get 2 actions per round base; can spend 1 AI Favor once per round for +1 non-Attack Action.
 * - Auto-initiative assignment without d20 dice rolls.
 * - Health Thresholds: Green (100%-66%), Yellow (66%-33%), Red (33%-0%).
 */

import { resolveInterception, renderInterceptionHtml, findActorToken } from '../utils/interrupts.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../utils/tag-behaviour.mjs';
import { isMobSide } from '../utils/combat-sides.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { COGCombatMetrics } from '../apps/combat-metrics.mjs';
import { getCurrentFloor } from './actor/actor-environment.mjs';
import { registerRelayAction, dispatchRelay, requestRelay } from '../utils/gm-relay.mjs';
import { messageAuthorId } from '../chat/chat-relay.mjs';
import { readCheckRecord, getAssistSpec } from '../utils/check-assists.mjs';
import { bossActionBudget } from '../data/mob-creation-rules.mjs';
import { postAiFavorTallyCard } from '../chat/ai-favor-tally-card.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';
import { combatDeclarationsMixin, recordInterceptionOnDeclaration } from './combat-declarations.mjs';
import { confirmRuleBreak } from '../utils/rule-break.mjs';
import { addAiFavor } from '../chat/actions/ai-favor-tally.mjs';
import { DECLARATION_STATUS } from '../utils/declared-attacks.mjs';
import { combatText } from '../utils/combat-round-text.mjs';
import { runAuraPulseStep } from './combat-aura-pulse.mjs';
import { tickRoundEffects } from './actor/duration-expiry.mjs';
import { roundEndDebuffEffects, roundEndBuffHealing, roundEndGearEffects } from './combat-round-end.mjs';

/** Relay action: a player records an action (e.g. an interrupt) on a Combat only the GM can update. */
export const RECORD_ACTION_RELAY = 'recordCombatantAction';
export const CLEAR_ACTION_RELAY = 'clearCombatantAction';
const ACTION_DATA_KEYS = ['type', 'label', 'category', 'icon', 'isAttack', 'isInterrupt', 'note', 'slotIndex'];

/** Combat documents are GM-writable only; true when this client may write them directly. */
function isCombatWriter() {
  const user = globalThis.game?.user;
  return !user || Boolean(user.isGM);
}

/**
 * True when this client may update the combatant document itself (the user owns its actor, or is the GM).
 * Foundry lets an owner write their own combatant's flags; only the parent Combat is GM-only.
 */
function canWriteCombatant(c) {
  const user = globalThis.game?.user;
  if (!user || !c) return false;
  if (user.isGM) return true;
  if (typeof c.canUserModify === 'function') return Boolean(c.canUserModify(user, 'update'));
  if (typeof c.actor?.testUserPermission === 'function') return Boolean(c.actor.testUserPermission(user, 'OWNER'));
  return Boolean(c.isOwner ?? c.actor?.isOwner);
}

function pickActionData(actionData = {}) {
  const out = {};
  for (const key of ACTION_DATA_KEYS) {
    if (actionData[key] !== undefined) out[key] = actionData[key];
  }
  return out;
}

function findCombatById(id) {
  const combats = globalThis.game?.combats;
  if (!combats || !id) return null;
  if (typeof combats.get === 'function') return combats.get(id) || null;
  return (Array.isArray(combats) ? combats : Array.from(combats)).find(c => c?.id === id) || null;
}

function ownsRelayedCombatant(payload, user) {
  const combat = findCombatById(payload?.combatId);
  const c = (combat?.combatants || []).find(con => con.id === payload?.combatantId);
  const actor = c?.actor;
  if (!actor) return false;
  return Boolean(user?.isGM || actor.testUserPermission?.(user, 'OWNER'));
}

registerRelayAction(CLEAR_ACTION_RELAY, {
  authorize: ownsRelayedCombatant,
  async apply(payload) {
    const combat = findCombatById(payload.combatId);
    if (!combat) throw new Error(`Combat ${payload.combatId} not found.`);
    const slotIndex = Number.isInteger(payload.slotIndex) ? payload.slotIndex : null;
    await combat.clearCombatantAction(payload.combatantId, slotIndex, { round: payload.round });
  }
});

registerRelayAction(RECORD_ACTION_RELAY, {
  authorize: ownsRelayedCombatant,
  async apply(payload) {
    const combat = findCombatById(payload.combatId);
    if (!combat) throw new Error(`Combat ${payload.combatId} not found.`);
    await combat.recordCombatantAction(payload.combatantId, pickActionData(payload.actionData), { round: payload.round });
  }
});

// -- Called Plays ------------------------------------------
// A Called Play waits on the ally's combatant under `flags.sprinter-rpg.calledPlays.<id>` until the ally's next skill or
// attack roll this round uses it. The stored `round` is the truth (readers filter by it); `resetRoundActions` also
// deletes the flag (housekeeping). Combat documents are GM-writable, so players go through the `calledPlay` relay.

/** Relay action for every Called Play write; `payload.op` names the write (`discard`; B3 adds `store` / `consume`). */
export const CALLED_PLAY_RELAY = 'calledPlay';
export const CALLED_PLAYS_FLAG = 'calledPlays';
export const MAX_CALLED_PLAYS = 20;
/** Entry ids are flag keys; anything else (dots, empty) could address another flag path. */
const CALLED_PLAY_ID = /^[A-Za-z0-9_-]{1,64}$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strField = (v) => (typeof v === 'string' ? v : '');
const strOrNullField = (v) => (typeof v === 'string' && v ? v : null);
const tagList = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()) : []);

export function isCalledPlayId(id) {
  return typeof id === 'string' && CALLED_PLAY_ID.test(id);
}

/**
 * One stored Called Play, or null when unusable (bad id, no round, no finite amount). The amount was rolled on the
 * caller's client when the play was called; `formula` is kept for display.
 * @returns {{ id: string, at: number, round: number, formula: string, amount: number, rollMessageId: string|null, messageId: string|null, fromUuid: string, fromName: string, skillName: string, proposal: string, when: { all: string[], any: string[], none: string[] } }|null}
 */
export function sanitizeCalledPlay(raw, fallbackId = '') {
  if (!isPlainObject(raw)) return null;
  const id = strField(raw.id) || fallbackId;
  if (!isCalledPlayId(id)) return null;
  const round = Number(raw.round);
  const amount = typeof raw.amount === 'number' ? raw.amount : Number(raw.amount);
  if (raw.round === null || raw.round === '' || !Number.isInteger(round) || raw.amount === null || raw.amount === '' || !Number.isFinite(amount)) return null;
  const when = isPlainObject(raw.when) ? raw.when : {};
  return {
    id,
    at: Number.isFinite(raw.at) ? raw.at : 0,
    round,
    formula: strField(raw.formula),
    amount,
    rollMessageId: strOrNullField(raw.rollMessageId),
    messageId: strOrNullField(raw.messageId),
    fromUuid: strField(raw.fromUuid),
    fromName: strField(raw.fromName),
    skillName: strField(raw.skillName),
    proposal: strField(raw.proposal),
    when: { all: tagList(when.all), any: tagList(when.any), none: tagList(when.none) }
  };
}

/**
 * The Called Plays waiting on a combatant, sanitised and sorted by `at`. Only entries of `round` (default: the
 * combatant's combat's current round); `round: null` returns every stored entry.
 * @param {object} combatant
 * @param {{ round?: number|null }} [opts]
 */
export function getCalledPlays(combatant, { round = combatant?.combat?.round ?? combatant?.parent?.round ?? globalThis.game?.combat?.round ?? null } = {}) {
  const raw = combatant?.getFlag?.(SYSTEM_ID, CALLED_PLAYS_FLAG) ?? combatant?.flags?.[SYSTEM_ID]?.[CALLED_PLAYS_FLAG];
  if (!isPlainObject(raw)) return [];
  const wanted = round === null ? null : Number(round);
  const out = [];
  for (const [key, entry] of Object.entries(raw)) {
    const clean = sanitizeCalledPlay(entry, key);
    // The key is the id the writes address; an entry claiming another id is not trusted.
    if (!clean || clean.id !== key) continue;
    if (wanted !== null && clean.round !== wanted) continue;
    out.push(clean);
  }
  out.sort((a, b) => (a.at - b.at) || a.id.localeCompare(b.id));
  return out.slice(0, MAX_CALLED_PLAYS);
}

/**
 * Whether `user` may discard a Called Play: the GM, an owner of the caller (`fromUuid`) or an owner of the ally.
 * @param {object|null} entry a sanitised entry
 * @param {object|null} combatant the ally's combatant
 * @param {object|null} [user]
 */
export function mayDiscardCalledPlay(entry, combatant, user = globalThis.game?.user) {
  if (!entry || !user) return false;
  if (user.isGM) return true;
  if (combatant?.actor?.testUserPermission?.(user, 'OWNER')) return true;
  return Boolean(resolveActorByUuid(entry.fromUuid)?.testUserPermission?.(user, 'OWNER'));
}

function findCombatant(combat, combatantOrId) {
  const id = typeof combatantOrId === 'string' ? combatantOrId : combatantOrId?.id;
  return (combat?.combatants || []).find(con => con?.id === id) || null;
}

/** The stored entry with this id (any round), sanitised, or null. */
function storedCalledPlay(combatant, calledPlayId) {
  if (!combatant || !isCalledPlayId(calledPlayId)) return null;
  return getCalledPlays(combatant, { round: null }).find(e => e.id === calledPlayId) || null;
}

function messageById(id) {
  return typeof id === 'string' && id ? (globalThis.game?.messages?.get?.(id) ?? null) : null;
}

function userById(id) {
  if (!id) return null;
  const users = globalThis.game?.users;
  return users?.get(id) ?? null;
}

/** True when `user` is the GM or an owner of `actor`. */
function userMayActFor(user, actor) {
  return Boolean(user && actor && (user.isGM || actor.testUserPermission?.(user, 'OWNER')));
}

/**
 * Check a `store` request and build the entry it would write. Everything comes from the call message (which the calling player's
 * client rolled and posted: the trust source) and the world; the payload gives only the message id.
 * @returns {{ ok: true, combat: object, combatant: object, entry: object } | { ok: false, reason: string }}
 */
function checkStoreCalledPlay(payload, user) {
  const message = messageById(payload?.callMessageId);
  const flags = message?.flags?.[SYSTEM_ID];
  if (!message || !flags || flags.isCalledPlay !== true) return { ok: false, reason: 'not-called-play' };
  if (!isCalledPlayId(message.id)) return { ok: false, reason: 'bad-id' };
  const authorId = messageAuthorId(message);
  if (!user?.isGM && authorId !== user?.id) return { ok: false, reason: 'not-author' };
  const caller = resolveActorByUuid(flags.fromUuid);
  if (!caller || !userMayActFor(userById(authorId), caller)) return { ok: false, reason: 'untrusted' };
  const combat = findCombatById(flags.combatId);
  if (!combat || Number(flags.round) !== Number(combat.round)) return { ok: false, reason: 'stale' };
  const combatant = findCombatant(combat, flags.allyCombatantId);
  if (!combatant) return { ok: false, reason: 'no-ally' };
  const roll = Array.isArray(message.rolls) ? message.rolls[0] : null;
  const amount = Number(roll?.total);
  if (!roll || !Number.isFinite(amount)) return { ok: false, reason: 'no-roll' };
  const stored = getCalledPlays(combatant, { round: null });
  if (stored.some(e => e.id === message.id)) return { ok: false, reason: 'duplicate' };
  if (stored.length >= MAX_CALLED_PLAYS) return { ok: false, reason: 'full' };
  // The query comes from the caller's own skill when it is still there, else from the card's flags.
  const skill = caller.items?.get(flags.itemId) ?? null;
  const entry = sanitizeCalledPlay({
    id: message.id,
    at: Date.now(),
    round: combat.round,
    formula: strField(roll.formula),
    amount,
    rollMessageId: message.id,
    messageId: message.id,
    fromUuid: caller.uuid,
    fromName: caller.name,
    skillName: strField(skill?.name) || strField(flags.skillName),
    proposal: '',
    when: skill ? getAssistSpec(skill).when : flags.when
  });
  return entry ? { ok: true, combat, combatant, entry } : { ok: false, reason: 'bad-entry' };
}

/**
 * Check a `consume` request: the check card exists, its author owns the ally and its record names this Called Play.
 * An entry that is already gone is a no-op (`gone`), not a refusal.
 */
function checkConsumeCalledPlay(payload, user) {
  const combat = findCombatById(payload?.combatId);
  const combatant = findCombatant(combat, payload?.combatantId);
  if (!combatant || !isCalledPlayId(payload?.calledPlayId)) return { ok: false, reason: 'bad-request' };
  const message = messageById(payload?.checkMessageId);
  const record = message ? readCheckRecord(message) : null;
  if (!record) return { ok: false, reason: 'no-record' };
  const authorId = messageAuthorId(message);
  if (!user?.isGM && authorId !== user?.id) return { ok: false, reason: 'not-author' };
  if (!userMayActFor(userById(authorId), combatant.actor)) return { ok: false, reason: 'untrusted' };
  if (!record.assists.some(a => a.source === 'called_play' && a.calledPlayId === payload.calledPlayId)) return { ok: false, reason: 'not-used' };
  return { ok: true, combatant, gone: !storedCalledPlay(combatant, payload.calledPlayId) };
}

const CALLED_PLAY_OPS = {
  store: {
    authorize: (payload, user) => checkStoreCalledPlay(payload, user).ok,
    async apply(payload, user) {
      const res = checkStoreCalledPlay(payload, user);
      if (!res.ok) return { ok: false, reason: res.reason };
      await res.combatant.update({ [`flags.${SYSTEM_ID}.${CALLED_PLAYS_FLAG}.${res.entry.id}`]: res.entry });
      return { ok: true, entry: res.entry };
    }
  },
  consume: {
    authorize: (payload, user) => checkConsumeCalledPlay(payload, user).ok,
    async apply(payload, user) {
      const res = checkConsumeCalledPlay(payload, user);
      if (!res.ok) return { ok: false, reason: res.reason };
      if (!res.gone) await res.combatant.unsetFlag(SYSTEM_ID, `${CALLED_PLAYS_FLAG}.${payload.calledPlayId}`);
      return { ok: true };
    }
  },
  discard: {
    authorize(payload, user) {
      const c = findCombatant(findCombatById(payload?.combatId), payload?.combatantId);
      return mayDiscardCalledPlay(storedCalledPlay(c, payload?.calledPlayId), c, user);
    },
    async apply(payload) {
      const combat = findCombatById(payload.combatId);
      if (!combat) throw new Error(`Combat ${payload.combatId} not found.`);
      return combat.discardCalledPlay(payload.combatantId, payload.calledPlayId);
    }
  }
};

/** Register (or replace) one `calledPlay` relay op (B3 adds `store` and `consume`). */
export function registerCalledPlayOp(op, { authorize, apply } = {}) {
  if (typeof op !== 'string' || !op || typeof authorize !== 'function' || typeof apply !== 'function') {
    throw new Error('A Called Play relay op needs a name, authorize and apply.');
  }
  CALLED_PLAY_OPS[op] = { authorize, apply };
}

function calledPlayOp(payload) {
  const op = payload?.op;
  return typeof op === 'string' && Object.hasOwn(CALLED_PLAY_OPS, op) ? CALLED_PLAY_OPS[op] : null;
}

registerRelayAction(CALLED_PLAY_RELAY, {
  authorize: (payload, user) => Boolean(calledPlayOp(payload)?.authorize(payload, user)),
  async apply(payload, user) {
    const op = calledPlayOp(payload);
    if (!op) throw new Error(`Unknown Called Play op "${payload?.op}".`);
    return op.apply(payload, user);
  }
});

const BaseCombat = globalThis.CONFIG?.Combat?.documentClass
  ?? globalThis.foundry?.documents?.BaseCombat
  ?? globalThis.Combat
  ?? class {};
const deepClone = (obj) => {
  if (typeof foundry !== 'undefined' && foundry?.utils?.deepClone) {
    return foundry.utils.deepClone(obj);
  }
  return structuredClone(obj);
};

export const COG_ACTION_TYPES = {
  // Standard Actions
  attack: { id: 'attack', label: 'Attack', category: 'damage', icon: 'fa-solid fa-burst', isAttack: true, desc: 'Perform Attack Skill Check against target; roll damage on Success.' },
  move: { id: 'move', label: 'Move', category: 'utility', icon: 'fa-solid fa-person-walking', isAttack: false, desc: 'Move up to full Move distance (default 20ft + 10ft Step).' },
  cast: { id: 'cast', label: 'Cast Spell', category: 'tactical', icon: 'fa-solid fa-wand-magic-sparkles', isAttack: false, desc: 'Cast a Spell or scroll from Hotlist.' },
  check: { id: 'check', label: 'Make Check', category: 'utility', icon: 'fa-solid fa-dice-d20', isAttack: false, desc: 'Perform a Skill Check or Stat Check.' },
  item: { id: 'item', label: 'Use Item', category: 'utility', icon: 'fa-solid fa-flask', isAttack: false, desc: 'Consume something already prepared, or get a different Hotlist Item ready.' },
  retrieve: { id: 'retrieve', label: 'Retrieve', category: 'utility', icon: 'fa-solid fa-box-open', isAttack: false, desc: 'Pull an item out of Inventory and into your hand or onto the Hotlist.' },
  help: { id: 'help', label: 'Help', category: 'buff', icon: 'fa-solid fa-handshake-angle', isAttack: false, desc: 'Lend a hand to another crawler with a Skill Check outside of combat.' },
  play: { id: 'play', label: 'Call a Play', category: 'tactical', icon: 'fa-solid fa-clipboard-list', isAttack: false, desc: 'Set up a plan; an ally who carries it out gets a bonus.' },
  clues: { id: 'clues', label: 'Look for Clues', category: 'tactical', icon: 'fa-solid fa-magnifying-glass', isAttack: false, desc: 'Gain tactical info on a Boss or environment.' },
  
  // Interrupts
  evade: { id: 'evade', label: 'Evade', category: 'defensive', icon: 'fa-solid fa-shield-halved', isAttack: false, isInterrupt: true, desc: 'Attempt to avoid incoming attacks for the rest of the round.' },
  heal: { id: 'heal', label: 'Heal', category: 'buff', icon: 'fa-solid fa-heart-pulse', isAttack: false, isInterrupt: true, desc: 'Use a Spell or item to restore Health.' },
  taunt: { id: 'taunt', label: 'Taunt', category: 'defensive', icon: 'fa-solid fa-bullhorn', isAttack: false, isInterrupt: true, desc: "Redirect a Mob's attack from an ally to yourself." },
  catcher: { id: 'catcher', label: 'Catcher', category: 'defensive', icon: 'fa-solid fa-person-falling-burst', isAttack: false, isInterrupt: true, desc: 'Take a hit meant for an ally.' },
  intervene: { id: 'intervene', label: 'Intervene', category: 'tactical', icon: 'fa-solid fa-user-shield', isAttack: false, isInterrupt: true, desc: "Aid an ally's Skill Check (+1d6 added after they roll)." },
  
  // Other
  other: { id: 'other', label: 'Other Action', category: 'utility', icon: 'fa-solid fa-ellipsis', isAttack: false, desc: 'Custom or non-standard action.' }
};

/**
 * Sprinter RPG 5-Step Combat Round
 * Rules Reference: Chapter 2 (Step-by-Step Combat, pp. 83-89)
 */
export const COMBAT_STEPS = Object.freeze({
  SURPRISE: 0,
  MOB_DECLARATION: 1,
  CRAWLER_INTERRUPTS: 2,
  MOB_RESOLUTION: 3,
  CRAWLER_ACTIONS: 4,
  CLEAN_UP: 5
});

export const COMBAT_STEP_DEFINITIONS = Object.freeze([
  { id: 0, key: 'surprise', label: 'Step 0: Crawler Surprise', shortLabel: 'Surprise', activeSide: 'crawlers', actionBudgetOverride: 1, desc: 'Crawlers receive 1 free action each before combat begins.' },
  { id: 1, key: 'mob_declaration', label: 'Step 1: Mob Declaration', shortLabel: '1: Declare', activeSide: 'mobs', desc: 'Mobs declare movement, targets, and attacks.' },
  { id: 2, key: 'crawler_interrupts', label: 'Step 2: Crawler Reaction Phase', shortLabel: '2: Interrupts', activeSide: 'crawlers', desc: 'Crawlers spend actions on Evade, Intervene, Catcher, Taunt, or Healing.' },
  { id: 3, key: 'mob_resolution', label: 'Step 3: Mob Attack Resolution', shortLabel: '3: Resolve', activeSide: 'mobs', desc: 'Undodged attacks resolve and damage is applied.' },
  { id: 4, key: 'crawler_actions', label: 'Step 4: Crawler Actions', shortLabel: '4: Actions', activeSide: 'crawlers', desc: 'Crawlers spend remaining actions in any order.' },
  { id: 5, key: 'clean_up', label: 'Step 5: Clean Up', shortLabel: '5: Clean Up', activeSide: 'all', desc: 'Debuffs tick, HoTs heal, aura pulses, action budgets reset.' }
]);

const stepLabel = (id) => COMBAT_STEP_DEFINITIONS.find(def => def.id === id)?.shortLabel ?? String(id);

/** Hook fired at the end of Step 5 Clean Up, after every registered clean-up step: `(combat, { round })`. */
export const COMBAT_CLEAN_UP_HOOK = 'sprinter-rpg.combatCleanUp';

/** Order slots of the built-in Clean Up steps; extensions register between or after them (default 500). */
export const CLEAN_UP_ORDER = Object.freeze({ ROUND_END_EFFECTS: 100, AURA_PULSE: 150, DURATIONS: 200, CLEAR_EVADE: 300, EXTENSION: 500 });

/** Registered Step 5 Clean Up steps: `{ id, order, seq, run }`. Sorted on read by `order`, then registration. */
const cleanUpRegistry = [];
let cleanUpSeq = 0;

export class COGCombat extends BaseCombat {
  /**
   * Register a Step 5 Clean Up step (aura pulses, placed zones, round cooldowns...). Steps run once per round, after the
   * built-in end-of-round work (debuff damage and HoTs, buff countdown, Evade stance reset) in ascending `order`
   * (ties keep registration order), and before the `sprinter-rpg.combatCleanUp` hook. A step that throws is logged and
   * the rest still run. Registering an id again replaces the earlier step.
   * @param {string} id unique step id
   * @param {(combat: COGCombat, ctx: { round: number }) => (Promise<*>|*)} run
   * @param {{ order?: number }} [opts] default `CLEAN_UP_ORDER.EXTENSION` (500)
   */
  static registerCleanUpStep(id, run, { order = CLEAN_UP_ORDER.EXTENSION } = {}) {
    if (typeof id !== 'string' || !id || typeof run !== 'function') return;
    COGCombat.unregisterCleanUpStep(id);
    cleanUpRegistry.push({ id, order: Number.isFinite(Number(order)) ? Number(order) : CLEAN_UP_ORDER.EXTENSION, seq: cleanUpSeq++, run });
  }

  /** Remove a registered Clean Up step. @returns {boolean} whether one was removed */
  static unregisterCleanUpStep(id) {
    const at = cleanUpRegistry.findIndex(step => step.id === id);
    if (at < 0) return false;
    cleanUpRegistry.splice(at, 1);
    return true;
  }

  /** The registered Clean Up steps in run order, as `{ id, order }`. */
  static get cleanUpSteps() {
    return [...cleanUpRegistry].sort((a, b) => a.order - b.order || a.seq - b.seq).map(({ id, order }) => ({ id, order }));
  }

  /**
   * Determine if a combatant belongs to the Mob side (NPCs / Hostiles)
   * or the Crawler side (Crawlers, companion pets, allied vehicles).
   * @param {Combatant} combatant
   * @returns {boolean}
   */
  static isMobCombatant(combatant) {
    if (!combatant) return true;
    const actor = combatant.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(combatant.actorId) : null);
    return isMobSide({ actor, token: combatant.token });
  }

  /**
   * Calculate health threshold category according to cheat sheet HUD reference:
   * - Green: 100% to 66% Health
   * - Yellow: 66% to 33% Health
   * - Red: 33% to 0% Health
   * @param {Actor} actor
   * @returns {object}
   */
  static getHealthThreshold(actor) {
    if (!actor) return { status: 'red', label: '0%', color: 'var(--cog-danger)', pct: 0 };
    const curHp = Number(actor.system?.attributes?.hp?.value) || 0;
    const maxHp = Number(actor.system?.attributes?.hp?.max) || 1;
    const pct = Math.max(0, Math.min(100, Math.round((curHp / maxHp) * 100)));

    if (pct >= 66) {
      return { status: 'green', label: `${pct}%`, color: 'var(--cog-success)', pct };
    } else if (pct >= 33) {
      return { status: 'yellow', label: `${pct}%`, color: 'var(--cog-warning)', pct };
    } else {
      return { status: 'red', label: `${pct}%`, color: 'var(--cog-danger)', pct };
    }
  }

  /**
   * True while crawlers may still Interrupt the declared mob attacks (Steps 0-2): resolving them now is a Rule Break.
   * @returns {boolean}
   */
  _interruptWindowOpen() {
    return this.currentStep < COMBAT_STEPS.MOB_RESOLUTION;
  }

  /**
   * Active step of the 5-step combat round (0 = surprise, 1..5 = round steps).
   * @type {number}
   */
  get currentStep() {
    const raw = this.getFlag?.(SYSTEM_ID, 'currentStep') ?? this.flags?.[SYSTEM_ID]?.currentStep;
    if (raw !== undefined && raw !== null) return Number(raw);
    return this.isSurpriseRound ? 0 : 1;
  }

  /**
   * Step definition metadata object for the active step.
   * @type {object}
   */
  get currentStepDefinition() {
    const s = this.currentStep;
    return COMBAT_STEP_DEFINITIONS.find(def => def.id === s) || COMBAT_STEP_DEFINITIONS[1];
  }

  /**
   * Is this encounter currently in a surprise round?
   * @type {boolean}
   */
  get isSurpriseRound() {
    return Boolean(this.getFlag?.(SYSTEM_ID, 'isSurpriseRound') || this.flags?.[SYSTEM_ID]?.isSurpriseRound);
  }

  /**
   * Toggle or set the surprise round state.
   * In Sprinter RPG, surprise rounds give crawlers Step 0 with 1 free action while mobs get 0 actions.
   * @param {boolean|null} [state=null]
   * @returns {Promise<COGCombat>}
   */
  async toggleSurpriseRound(state = null) {
    const nextState = state !== null ? Boolean(state) : !this.isSurpriseRound;
    await this.setFlag(SYSTEM_ID, 'isSurpriseRound', nextState);
    await this.setCombatStep(nextState ? 0 : 1);
    await this.resetRoundActions();
    await this.assignPhaseInitiative();
    return this;
  }

  /**
   * Set the active combat step (0..5).
   * @param {number} step
   * @returns {Promise<COGCombat>}
   */
  async setCombatStep(step) {
    const minStep = this.isSurpriseRound ? 0 : 1;
    const numStep = Number(step);
    const clamped = Math.max(minStep, Math.min(5, Number.isFinite(numStep) ? numStep : minStep));
    await this.setFlag(SYSTEM_ID, 'currentStep', clamped);
    return this;
  }

  /**
   * Advance to the next step of the 5-step combat round.
   * - At Step 0 (Surprise): clears surprise round, transitions to Round 1 Step 1, resets round action budgets.
   * - Step 2 to 3: the declared mob attacks resolve (`resolveDeclaredAttacks`).
   * - Step 4 to 5: Clean Up runs (`stepFiveCleanUp`).
   * - At Step 5 (Clean Up): advances the round via nextRound() (action reset), sets Step 1. Open declarations ask
   *   for a Rule Break first (see nextRound); a refusal leaves the round where it is.
   * - At any other step: increments step by 1.
   * @returns {Promise<COGCombat>}
   */
  async nextStep() {
    const cur = this.currentStep;
    if (cur === COMBAT_STEPS.SURPRISE) {
      await this.setFlag(SYSTEM_ID, 'isSurpriseRound', false);
      await this.setCombatStep(COMBAT_STEPS.MOB_DECLARATION);
      await this.resetRoundActions();
      await this.assignPhaseInitiative();
      return this;
    }
    if (cur >= COMBAT_STEPS.CLEAN_UP) {
      await this.nextRound();
      return this;
    }
    const next = cur + 1;
    await this.setCombatStep(next);
    if (next === COMBAT_STEPS.MOB_RESOLUTION && typeof this.resolveDeclaredAttacks === 'function') {
      await this.resolveDeclaredAttacks();
    }
    if (next === COMBAT_STEPS.CLEAN_UP) {
      await this.stepFiveCleanUp();
    }
    return this;
  }

  /**
   * Go to a step the GM picked. Going back never undoes anything; going forward walks the steps one at a time so each
   * hand-over runs (Step 3 resolves the declared attacks, Step 5 cleans up). Skipping a step ahead is a Rule Break
   * the GM confirms; a refusal leaves the step as it is.
   * @param {number} step 0..5
   * @param {{ ruleBreak?: boolean }} [opts] `ruleBreak` = the caller already confirmed
   * @returns {Promise<{ moved: boolean, ruleBreak: boolean }>}
   */
  async goToStep(step, { ruleBreak = false } = {}) {
    const cur = this.currentStep;
    const minStep = this.isSurpriseRound ? COMBAT_STEPS.SURPRISE : COMBAT_STEPS.MOB_DECLARATION;
    const numStep = Number(step);
    const target = Math.max(minStep, Math.min(COMBAT_STEPS.CLEAN_UP, Number.isFinite(numStep) ? numStep : cur));
    if (target === cur) return { moved: false, ruleBreak: false };
    if (target < cur) {
      await this.setCombatStep(target);
      return { moved: true, ruleBreak: false };
    }
    let isRuleBreak = false;
    if (target > cur + 1) {
      if (ruleBreak === true) {
        isRuleBreak = true;
      } else {
        const verdict = await confirmRuleBreak({
          title: combatText('COG.Combat.RuleBreakTitle'),
          message: combatText('COG.Combat.SkipStep', {
            from: stepLabel(cur), to: stepLabel(target)
          })
        });
        if (!verdict.confirmed) return { moved: false, ruleBreak: false };
        isRuleBreak = true;
      }
    }
    for (let i = 0; i <= COMBAT_STEPS.CLEAN_UP && this.currentStep < target; i++) {
      const before = this.currentStep;
      await this.nextStep();
      if (this.currentStep === before) break;
    }
    return { moved: true, ruleBreak: isRuleBreak };
  }

  /**
   * Move back to the previous step of the combat round.
   * @returns {Promise<COGCombat>}
   */
  async previousStep() {
    const cur = this.currentStep;
    const minStep = this.isSurpriseRound ? 0 : 1;
    const prev = Math.max(minStep, cur - 1);
    await this.setCombatStep(prev);
    return this;
  }

  /**
   * Execute Step 5 Clean Up once per round: every registered step in order (`cleanUpSteps`: debuff damage and HoTs,
   * buff and aura countdown, Evade stance reset, then extensions), then the `sprinter-rpg.combatCleanUp` hook. Going
   * back to Step 4 and forward again does not run it twice. The action reset happens when the round turns over
   * (`nextRound`), after the round's actions are snapshotted into the history.
   * @param {{ force?: boolean }} [opts] `force` runs again even if this round was already cleaned up
   * @returns {Promise<{ ran: string[], skipped?: boolean, endEffects: Array, expiredDurations: Array }>}
   */
  async stepFiveCleanUp({ force = false } = {}) {
    const round = this.round || 1;
    const done = this.getFlag?.(SYSTEM_ID, 'cleanedUpRound') ?? this.flags?.[SYSTEM_ID]?.cleanedUpRound;
    if (!force && Number(done) === round) return { ran: [], skipped: true, endEffects: [], expiredDurations: [] };
    await this.setFlag(SYSTEM_ID, 'cleanedUpRound', round);

    const ran = [];
    const results = {};
    for (const { id } of COGCombat.cleanUpSteps) {
      const step = cleanUpRegistry.find(entry => entry.id === id);
      if (!step) continue;
      try {
        results[id] = await step.run(this, { round });
        ran.push(id);
      } catch (err) {
        console.error(`Sprinter RPG | Clean Up step "${id}" failed:`, err);
      }
    }
    try {
      globalThis.Hooks?.callAll?.(COMBAT_CLEAN_UP_HOOK, this, { round });
    } catch (err) {
      console.error('Sprinter RPG | A combatCleanUp hook failed:', err);
    }
    return { ran, endEffects: results['round-end-effects'] ?? [], auraPulses: results['aura-pulse'] ?? [], expiredDurations: results.durations ?? [] };
  }

  /**
   * Assign phase-based initiative values to all combatants without rolling dice.
   * Normal round: Mobs = 20, Crawlers = 10.
   * Surprise round: Crawlers = 20, Mobs = 10.
   */
  async assignPhaseInitiative() {
    const isSurprise = this.isSurpriseRound;
    const updates = [];

    for (const c of (this.combatants || [])) {
      const isMob = COGCombat.isMobCombatant(c);
      // Primary phase gets initiative 20; secondary gets 10
      const init = isSurprise ? (isMob ? 10 : 20) : (isMob ? 20 : 10);
      updates.push({ _id: c.id, initiative: init });
      c.initiative = init;
    }

    if (updates.length && this.updateEmbeddedDocuments) {
      await this.updateEmbeddedDocuments('Combatant', updates);
    }
  }

  /**
   * Override rollInitiative to assign phase-based initiative without random d20 dice rolls.
   * @param {string|string[]} ids
   * @param {object} [options={}]
   * @returns {Promise<COGCombat>}
   */
  async rollInitiative(ids, options = {}) {
    const targetIds = Array.isArray(ids) ? ids : (ids ? [ids] : []);
    const isSurprise = this.isSurpriseRound;
    const updates = [];

    for (const c of (this.combatants || [])) {
      if (targetIds.length && !targetIds.includes(c.id)) continue;
      const isMob = COGCombat.isMobCombatant(c);
      const init = isSurprise ? (isMob ? 10 : 20) : (isMob ? 20 : 10);
      updates.push({ _id: c.id, initiative: init });
      c.initiative = init;
    }

    if (updates.length && this.updateEmbeddedDocuments) {
      await this.updateEmbeddedDocuments('Combatant', updates);
    }
    return this;
  }

  constructor(...args) {
    super(...args);
    this._sortCombatants = this._sortCombatants.bind(this);
  }

  /** @override */
  async _onCreateDescendantDocuments(parent, collection, documents, data, options, userId) {
    if (typeof super._onCreateDescendantDocuments === 'function') {
      await super._onCreateDescendantDocuments(parent, collection, documents, data, options, userId);
    }
    if (collection === 'Combatant') {
      await this.assignPhaseInitiative();
    }
  }

  /** @override */
  setupTurns() {
    this._sortCombatants = this._sortCombatants.bind(this);
    return super.setupTurns();
  }

  /**
   * Sort combatants by phase:
   * - Default Order: Mobs act first, Crawlers act second.
   * - Surprise Exception: Crawlers act first, Mobs act second.
   * - Within side: sort by unspent actions first, then name.
   */
  _sortCombatants(a, b) {
    const combat = (this && typeof this.isSurpriseRound !== 'undefined')
      ? this
      : (a?.combat || a?.parent || b?.combat || b?.parent || globalThis.game?.combat || null);
    const isSurprise = Boolean(combat?.isSurpriseRound);
    const aIsMob = COGCombat.isMobCombatant(a);
    const bIsMob = COGCombat.isMobCombatant(b);

    // Group priority: 1 for active phase, 2 for second phase
    const aPriority = isSurprise ? (aIsMob ? 2 : 1) : (aIsMob ? 1 : 2);
    const bPriority = isSurprise ? (bIsMob ? 2 : 1) : (bIsMob ? 1 : 2);

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // Within same group: prioritize combatants with remaining actions
    const aActions = COGCombat.getCombatantActions(a, combat);
    const bActions = COGCombat.getCombatantActions(b, combat);
    const aRemaining = (aActions.max - aActions.spent);
    const bRemaining = (bActions.max - bActions.spent);

    if (aRemaining !== bRemaining) {
      return bRemaining - aRemaining; // More actions remaining first
    }

    // Final fallback: alphabetical by name, then ID
    const nameDiff = (a?.name || '').localeCompare(b?.name || '');
    if (nameDiff !== 0) return nameDiff;
    return (a?.id || '').localeCompare(b?.id || '');
  }

  /**
   * Count all crawler-side / crawler-friendly combatants in this combat
   * (crawlers, companion pets, mercenaries, mounts, and allied NPCs).
   * Defeated combatants are counted.
   * Combatants carrying the `uncounted-ally` rule flag (e.g. mob.summoned) are excluded.
   * @returns {number}
   */
  countCrawlerSideAllies() {
    let count = 0;
    for (const c of (this.combatants || [])) {
      if (COGCombat.isMobCombatant(c)) continue;
      const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
      if (!hasRuleFlag(actor, RULE_FLAGS.uncountedAlly)) count++;
    }
    return count;
  }

  /**
   * High-water mark for crawler-side allies seen during this encounter.
   * Recalculates upwards when new allies join; defeats, dismissals, or retreats never lower it.
   * @returns {number}
   */
  getMaxCrawlerAlliesSeen() {
    const current = this.countCrawlerSideAllies();
    const stored = Number(this.getFlag?.(SYSTEM_ID, 'maxCrawlerAlliesSeen') ?? this.flags?.[SYSTEM_ID]?.maxCrawlerAlliesSeen) || 0;
    const maxSeen = Math.max(current, stored);
    if (maxSeen > stored && isCombatWriter() && typeof this.setFlag === 'function') {
      this.setFlag(SYSTEM_ID, 'maxCrawlerAlliesSeen', maxSeen).catch?.(() => {});
    }
    return maxSeen;
  }

  /**
   * Retrieve action tracking data for a combatant (static helper).
   * Supports retrieving active actions or past round actions from history.
   * @param {Combatant|string} combatantOrId
   * @param {Combat|null} [combat=null]
   * @param {number|null} [round=null]
   * @returns {object}
   */
  static getCombatantActions(combatantOrId, combat = null, round = null) {
    let c = null;
    let combatDoc = combat;
    if (combatantOrId && typeof combatantOrId === 'object') {
      c = combatantOrId;
      combatDoc = combat || c.combat || c.parent || globalThis.game?.combat || null;
    } else if (combat && typeof combatantOrId === 'string') {
      c = combat.combatants?.get ? combat.combatants.get(combatantOrId) : (combat.combatants?.find ? combat.combatants.find(con => con.id === combatantOrId) : null);
    }

    const cId = c?.id || (typeof combatantOrId === 'string' ? combatantOrId : null);
    const activeRound = combatDoc?.round || 1;
    const targetRound = Number(round) || activeRound;

    const actor = c?.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c?.actorId) : null);
    const isMob = COGCombat.isMobCombatant(c);
    const isBoss = Boolean(actor?.isBoss);
    const alliesCount = (combatDoc && typeof combatDoc.getMaxCrawlerAlliesSeen === 'function')
      ? combatDoc.getMaxCrawlerAlliesSeen()
      : 2;
    const isStepZero = combatDoc && combatDoc.currentStep === 0;
    const defaultMax = isStepZero ? (isMob ? 0 : 1) : (isBoss ? bossActionBudget(alliesCount) : 2);

    // If querying a past round from history
    if (combatDoc && targetRound !== activeRound) {
      const history = combatDoc.getFlag?.(SYSTEM_ID, 'roundHistory') || combatDoc.flags?.[SYSTEM_ID]?.roundHistory || {};
      const savedRound = history[targetRound]?.[cId];
      if (savedRound) {
        return {
          max: isStepZero ? (isMob ? 0 : 1) : (savedRound.max ?? defaultMax),
          spent: savedRound.spent ?? 0,
          bonusActionGranted: Boolean(savedRound.bonusActionGranted),
          hasAttacked: Boolean(savedRound.hasAttacked),
          slots: Array.isArray(savedRound.slots) ? savedRound.slots : []
        };
      }
      return {
        max: defaultMax,
        spent: 0,
        bonusActionGranted: false,
        hasAttacked: false,
        slots: []
      };
    }

    const saved = c?.getFlag?.(SYSTEM_ID, 'actions') || c?.flags?.[SYSTEM_ID]?.actions || null;

    if (saved) {
      return {
        max: isStepZero ? (isMob ? 0 : 1) : (saved.max ?? defaultMax),
        spent: saved.spent ?? 0,
        bonusActionGranted: Boolean(saved.bonusActionGranted),
        hasAttacked: Boolean(saved.hasAttacked),
        slots: Array.isArray(saved.slots) ? saved.slots : []
      };
    }

    return {
      max: defaultMax,
      spent: 0,
      bonusActionGranted: false,
      hasAttacked: false,
      slots: []
    };
  }

  /**
   * Retrieve action tracking data for a combatant.
   * @param {Combatant|string} combatantOrId
   * @param {number|null} [round=null]
   * @returns {object}
   */
  getCombatantActions(combatantOrId, round = null) {
    return COGCombat.getCombatantActions(combatantOrId, this, round);
  }

  /**
   * Snapshot current combatant actions for a specified round into roundHistory flag.
   * @param {number} [round=this.round]
   * @returns {Promise<object>}
   */
  async snapshotRoundActions(round = this.round) {
    const r = Number(round) || 1;
    const history = deepClone(this.getFlag(SYSTEM_ID, 'roundHistory') || {});
    history[r] = history[r] || {};
    for (const c of (this.combatants || [])) {
      history[r][c.id] = this.getCombatantActions(c);
    }
    await this.setFlag(SYSTEM_ID, 'roundHistory', history);
    return history[r];
  }

  /**
   * Record an action performed by a combatant in the current round or a historical round.
   * Enforces rules:
   * - Base budget is 2 actions per round (or 3 with AI favor bonus action).
   * - Mobs: At most 1 Attack action per round!
   * @param {Combatant|string} combatantOrId
   * @param {object} actionData
   * @param {string} actionData.type - e.g. 'attack', 'move', 'cast', 'check', etc.
   * @param {string} [actionData.name] - custom name/label
   * @param {number} [actionData.slotIndex=null] - specific slot (0, 1, 2)
   * @param {object} [options={}]
   * @param {number|null} [options.round=null] - specific round to record against (defaults to active round)
   * @returns {Promise<object>}
   */
  async recordCombatantAction(combatantOrId, actionData = {}, { round = null } = {}) {
    const id = typeof combatantOrId === 'string' ? combatantOrId : combatantOrId?.id;
    const c = (this.combatants || []).find(con => con.id === id);
    if (!c) throw new Error(`Combatant ${id} not found in this combat.`);

    const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
    const isMob = COGCombat.isMobCombatant(c);
    const isBoss = Boolean(actor?.isBoss);
    const isNormalMob = isMob && !isBoss;

    const targetRound = Number(round) || (this.round || 1);
    const isPastRound = targetRound !== (this.round || 1);
    const actions = this.getCombatantActions(c, targetRound);
    const type = actionData.type || 'other';
    const typeDef = COG_ACTION_TYPES[type] || COG_ACTION_TYPES.other;
    const isAttack = Boolean(typeDef.isAttack || actionData.isAttack || type === 'attack');

    let ruleBreak = false;
    let ruleBreakReason = '';
    let warning = '';

    // Permissive Adjudication: Regular mobs can only perform 1 Attack per round (Bosses have NO attack cap)
    if (isNormalMob && isAttack && actions.hasAttacked) {
      ruleBreak = true;
      ruleBreakReason = `Rule Violation: Regular mobs can only perform at most 1 Attack Action per round! (${c.name} has already attacked)`;
      warning = ruleBreakReason;
      if (globalThis.ui?.notifications?.warn) {
        globalThis.ui.notifications.warn(warning);
      }
    }

    // Permissive Adjudication: Action budget exceeded
    if (actions.spent >= actions.max && actionData.slotIndex === undefined) {
      ruleBreak = true;
      const budgetMsg = `Action Budget Exceeded: ${c.name} has exceeded action budget (${actions.spent + 1}/${actions.max})`;
      ruleBreakReason = ruleBreakReason ? `${ruleBreakReason}; ${budgetMsg}` : budgetMsg;
      warning = ruleBreakReason;
      if (globalThis.ui?.notifications?.warn) {
        globalThis.ui.notifications.warn(warning);
      }
    }

    const category = actionData.category || typeDef.category || 'utility';
    const slot = {
      type,
      category,
      label: actionData.label || typeDef.label,
      icon: actionData.icon || typeDef.icon,
      isAttack,
      isInterrupt: Boolean(typeDef.isInterrupt || actionData.isInterrupt),
      timestamp: Date.now(),
      note: actionData.note || '',
      ruleBreak,
      ruleBreakReason: ruleBreak ? ruleBreakReason : undefined
    };

    const slots = [...actions.slots];
    if (Number.isInteger(actionData.slotIndex) && actionData.slotIndex >= 0 && actionData.slotIndex < actions.max) {
      slots[actionData.slotIndex] = slot;
    } else {
      slots.push(slot);
    }

    const spent = slots.filter(Boolean).length;
    const hasAttacked = slots.some(s => s && s.isAttack);
    const max = Math.max(actions.max, spent);

    const updatedActions = {
      max,
      spent,
      bonusActionGranted: actions.bonusActionGranted,
      hasAttacked,
      slots
    };

    if (isCombatWriter()) {
      if (isPastRound) {
        const history = deepClone(this.getFlag(SYSTEM_ID, 'roundHistory') || {});
        history[targetRound] = history[targetRound] || {};
        history[targetRound][c.id] = updatedActions;
        await this.setFlag(SYSTEM_ID, 'roundHistory', history);
      } else {
        await c.setFlag(SYSTEM_ID, 'actions', updatedActions);
        // Also sync to active round history
        const history = deepClone(this.getFlag(SYSTEM_ID, 'roundHistory') || {});
        history[targetRound] = history[targetRound] || {};
        history[targetRound][c.id] = updatedActions;
        await this.setFlag(SYSTEM_ID, 'roundHistory', history);
      }
    } else if (!isPastRound && canWriteCombatant(c)) {
      // The owner records their own combatant's Action locally, so it works with no GM connected (E7.9 §9.5).
      // The roundHistory copy lives on the GM-only Combat; the round-advance snapshot refreshes it.
      await c.setFlag(SYSTEM_ID, 'actions', updatedActions);
    } else {
      // Only the GM may update a Combat document: ask the active GM to record it (re-validated there).
      const sent = await dispatchRelay(RECORD_ACTION_RELAY, {
        combatId: this.id,
        combatantId: c.id,
        round: targetRound,
        actionData: pickActionData(actionData)
      }, { direct: false });
      if (!sent) return { success: false, error: 'No GM is connected to record this action.', actions };
    }

    return {
      success: true,
      ruleBreak,
      ruleBreakReason: ruleBreak ? ruleBreakReason : undefined,
      warning: warning || undefined,
      actions: updatedActions,
      combatant: c,
      round: targetRound
    };
  }

  /**
   * Clear an action slot or clear all actions for a combatant.
   * @param {Combatant|string} combatantOrId
   * @param {number|null} [slotIndex=null]
   * @param {object} [options={}]
   * @param {number|null} [options.round=null]
   * @returns {Promise<object>}
   */
  async clearCombatantAction(combatantOrId, slotIndex = null, { round = null } = {}) {
    const id = typeof combatantOrId === 'string' ? combatantOrId : combatantOrId?.id;
    const c = (this.combatants || []).find(con => con.id === id);
    if (!c) return { success: false };

    const targetRound = Number(round) || (this.round || 1);
    const isPastRound = targetRound !== (this.round || 1);
    const actions = this.getCombatantActions(c, targetRound);
    let slots = [...actions.slots];

    if (Number.isInteger(slotIndex)) {
      slots.splice(slotIndex, 1);
    } else {
      slots = [];
    }

    const spent = slots.filter(Boolean).length;
    const hasAttacked = slots.some(s => s && s.isAttack);

    const updatedActions = {
      max: actions.max,
      spent,
      bonusActionGranted: actions.bonusActionGranted,
      hasAttacked,
      slots
    };

    if (isCombatWriter()) {
      if (isPastRound) {
        const history = deepClone(this.getFlag(SYSTEM_ID, 'roundHistory') || {});
        history[targetRound] = history[targetRound] || {};
        history[targetRound][c.id] = updatedActions;
        await this.setFlag(SYSTEM_ID, 'roundHistory', history);
      } else {
        await c.setFlag(SYSTEM_ID, 'actions', updatedActions);
        const history = deepClone(this.getFlag(SYSTEM_ID, 'roundHistory') || {});
        history[targetRound] = history[targetRound] || {};
        history[targetRound][c.id] = updatedActions;
        await this.setFlag(SYSTEM_ID, 'roundHistory', history);
      }
    } else if (!isPastRound && canWriteCombatant(c)) {
      // The owner clears their own combatant's Action locally (mirrors recordCombatantAction); the
      // GM-only roundHistory copy is refreshed by the round-advance snapshot.
      await c.setFlag(SYSTEM_ID, 'actions', updatedActions);
    } else {
      // Only the GM may update a Combat document: ask the active GM to clear it (re-validated there).
      const sent = await dispatchRelay(CLEAR_ACTION_RELAY, {
        combatId: this.id,
        combatantId: c.id,
        round: targetRound,
        slotIndex: Number.isInteger(slotIndex) ? slotIndex : null
      }, { direct: false });
      if (!sent) return { success: false, error: 'No GM is connected to clear this action.' };
    }

    return { success: true, actions: updatedActions, round: targetRound };
  }

  /**
   * Spend 1 AI Favor to grant a Crawler +1 additional non-Attack Action. The book allows one claim per round and
   * needs at least 1 AI Favor; either limit asks for a Rule Break confirm instead of blocking (CONTRIBUTING rule 2).
   * The spend goes through `addAiFavor`, the single AI Favor write path (session ledger entry).
   * @param {Combatant|string} combatantOrId
   * @param {{ ruleBreak?: boolean, interactive?: boolean }} [options] `ruleBreak: true` = already confirmed
   * @returns {Promise<object>} `{ success, actions, remainingFavor, ruleBreak }`, or `{ success: false, declined }`
   */
  async spendAIFavorBonusAction(combatantOrId, options = {}) {
    const id = typeof combatantOrId === 'string' ? combatantOrId : combatantOrId?.id;
    const c = (this.combatants || []).find(con => con.id === id);
    if (!c) throw new Error(`Combatant ${id} not found in this combat.`);

    const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
    if (!actor) throw new Error(`Actor for combatant ${c.name} not found.`);

    if (COGCombat.isMobCombatant(c)) {
      const errorMsg = `Rule Violation: Only Crawlers may spend AI Favor for Bonus Actions!`;
      if (globalThis.ui?.notifications?.warn) globalThis.ui.notifications.warn(errorMsg);
      return { success: false, error: errorMsg };
    }

    const actions = this.getCombatantActions(c);
    const currentFavor = Number(actor.system?.attributes?.aiFavor) || 0;
    const reasons = [];
    if (actions.bonusActionGranted) {
      reasons.push(combatText('COG.Combat.BonusActionClaimed', { name: c.name }));
    }
    if (currentFavor < 1) {
      reasons.push(combatText('COG.Combat.BonusActionNoFavor', { name: actor.name, favor: currentFavor }));
    }
    let ruleBreak = false;
    for (const reason of reasons) {
      const verdict = await confirmRuleBreak({
        title: combatText('COG.Combat.RuleBreakTitle'),
        message: `${reason} ${combatText('COG.Combat.BonusActionAnyway')}`,
        reason,
        options
      });
      if (!verdict.confirmed) return { success: false, declined: true, error: reason };
      ruleBreak = true;
    }

    const wrote = await addAiFavor(actor, -1, combatText('COG.Combat.BonusActionLedger', { name: c.name }), { ruleBreak: true });
    if (!wrote) return { success: false, declined: true };

    // First claim lifts the budget from 2 to 3; a confirmed repeat claim adds one more on top of the current budget.
    const max = actions.bonusActionGranted ? actions.max + 1 : 3;
    const updatedActions = {
      max,
      spent: actions.spent,
      bonusActionGranted: true,
      hasAttacked: actions.hasAttacked,
      slots: actions.slots
    };
    if (ruleBreak) {
      updatedActions.ruleBreak = true;
      updatedActions.ruleBreakReason = reasons.join('; ');
    }

    await c.setFlag(SYSTEM_ID, 'actions', updatedActions);

    if (globalThis.ChatMessage?.create) {
      const note = ruleBreak
        ? `<div class="cog-text" style="font-size: 10px; margin-top: 2px;"><em>Rule Break: ${reasons.join(' ')}</em></div>`
        : '';
      await globalThis.ChatMessage.create({
        speaker: globalThis.ChatMessage.getSpeaker?.({ actor }) || { alias: c.name },
        flags: ruleBreak ? { [SYSTEM_ID]: { ruleBreak: true } } : undefined,
        content: `
          <div class="cog-bg-danger-tint" style="border: 1.5px solid var(--cog-danger); padding: 6px 8px; border-radius: 4px; font-family: 'Oswald', sans-serif;">
            <div class="cog-text-danger" style="font-weight: bold; text-transform: uppercase; font-size: 13px;">
              <i class="fa-solid fa-hand-holding-heart"></i> AI Favor Bonus Action
            </div>
            <div class="cog-text" style="font-size: 11px; margin-top: 2px;">
              <strong>${c.name}</strong> spent 1 AI Favor to gain <strong>+1 Non-Attack Action</strong> this round! (${max} actions total)
            </div>
            ${note}
          </div>
        `
      });
    }

    return { success: true, actions: updatedActions, remainingFavor: currentFavor - 1, ruleBreak };
  }

  /**
   * Reset all combatant action slots for a new round.
   * Scales boss action budget based on crawler-side allies high-water mark.
   */
  async resetRoundActions() {
    const isStepZero = this.currentStep === 0;
    const alliesCount = (typeof this.getMaxCrawlerAlliesSeen === 'function') ? this.getMaxCrawlerAlliesSeen() : 2;
    for (const c of (this.combatants || [])) {
      const isMob = COGCombat.isMobCombatant(c);
      const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
      const isBoss = Boolean(actor?.isBoss);
      const max = isStepZero ? (isMob ? 0 : 1) : (isBoss ? bossActionBudget(alliesCount) : 2);

      await c.setFlag(SYSTEM_ID, 'actions', {
        max,
        spent: 0,
        bonusActionGranted: false,
        hasAttacked: false,
        slots: []
      });
      // Clean Up ends every Called Play not used this round (E7.9 D7 c; readers also filter by the stored round).
      const calledPlays = c.getFlag?.(SYSTEM_ID, CALLED_PLAYS_FLAG) ?? c.flags?.[SYSTEM_ID]?.[CALLED_PLAYS_FLAG];
      if (calledPlays !== undefined && calledPlays !== null && typeof c.unsetFlag === 'function') {
        await c.unsetFlag(SYSTEM_ID, CALLED_PLAYS_FLAG);
      }
    }
  }

  /**
   * The Called Plays waiting on a combatant of this combat (default: this round's only).
   * @param {Combatant|string} combatantOrId
   * @param {{ round?: number|null }} [opts]
   */
  getCalledPlays(combatantOrId, { round = this.round } = {}) {
    const c = findCombatant(this, combatantOrId);
    return c ? getCalledPlays(c, { round }) : [];
  }

  /**
   * Remove one Called Play from a combatant (the tracker's ×, B5). The GM writes; a player asks the GM through the
   * `calledPlay` relay, which allows the GM, the caller's owners and the ally's owners.
   * @param {Combatant|string} combatantOrId the ally's combatant
   * @param {string} calledPlayId
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async discardCalledPlay(combatantOrId, calledPlayId) {
    const c = findCombatant(this, combatantOrId);
    if (!c) return { success: false, error: 'Combatant not found.' };
    if (!isCalledPlayId(calledPlayId)) return { success: false, error: 'Not a Called Play id.' };
    if (isCombatWriter()) {
      if (!storedCalledPlay(c, calledPlayId)) return { success: false, error: 'No such Called Play.' };
      await c.unsetFlag(SYSTEM_ID, `${CALLED_PLAYS_FLAG}.${calledPlayId}`);
      return { success: true };
    }
    const sent = await dispatchRelay(CALLED_PLAY_RELAY, {
      op: 'discard',
      combatId: this.id,
      combatantId: c.id,
      calledPlayId
    }, { direct: false });
    return sent ? { success: true } : { success: false, error: 'No GM is connected to discard this Called Play.' };
  }

  /**
   * Bank a called Play on the ally's combatant (E7.9 §3.7). The caller's client has already posted the call message
   * (its roll is the amount); only its id is sent, and whoever writes re-reads the message (D5 trust rule).
   * @param {{ callMessageId: string }} payload anything else is dropped
   * @returns {Promise<{ ok: boolean, reason?: string, entry?: object }>}
   */
  async storeCalledPlay({ callMessageId } = {}) {
    return this._requestCalledPlayOp({ op: 'store', callMessageId: strField(callMessageId) });
  }

  /**
   * Remove a Called Play the ally's roll used. The ally's client sends the check message id; the writer confirms the
   * message's record names this Called Play and that its author owns the ally.
   * @param {{ combatantId: string, calledPlayId: string, checkMessageId: string }} payload
   * @returns {Promise<{ ok: boolean, reason?: string }>}
   */
  async consumeCalledPlay({ combatantId, calledPlayId, checkMessageId } = {}) {
    return this._requestCalledPlayOp({ op: 'consume', combatantId: strField(combatantId), calledPlayId: strField(calledPlayId), checkMessageId: strField(checkMessageId) });
  }

  /** Run a Called Play op here when this client is the GM, else through the GM; a refusal comes back as `{ ok: false }`. */
  async _requestCalledPlayOp(payload) {
    const full = { ...payload, combatId: this.id };
    const res = await requestRelay(CALLED_PLAY_RELAY, full);
    if (!res.ok) return { ok: false, reason: res.reason ?? 'error' };
    const r = res.result;
    return r && typeof r === 'object' && typeof r.ok === 'boolean' ? r : { ok: false, reason: 'error' };
  }

  /** @override */
  async startCombat() {
    const startStep = this.isSurpriseRound ? 0 : 1;
    await this.setCombatStep(startStep);
    await this.resetRoundActions();
    if (typeof super.startCombat === 'function') {
      await super.startCombat();
    }
    await this.assignPhaseInitiative();
    return this;
  }

  /**
   * Record the Action an interrupt costs (nothing for a free one). Shared by `triggerInterrupt` and the assist
   * buttons (E7.9). Over budget is recorded as a Rule Break by `recordCombatantAction`; asking first is the caller's job.
   * @param {Combatant|string} combatantOrId
   * @param {object} interrupt an entry of `getAvailableInterrupts` (or the same shape)
   * @param {{ note?: string|null, type?: string|null, round?: number|null }} [opts]
   * @returns {Promise<object>} `recordCombatantAction`'s result (`success: false` when no GM can record it), plus `isFree`
   */
  async recordInterruptAction(combatantOrId, interrupt = {}, { note = null, type = null, round = null } = {}) {
    const c = findCombatant(this, combatantOrId);
    if (!c) throw new Error(`Combatant ${typeof combatantOrId === 'string' ? combatantOrId : combatantOrId?.id} not found in this combat.`);
    const targetRound = Number(round) || (this.round || 1);
    const isFree = Boolean(interrupt?.isFree || interrupt?.actionCost === 0);
    if (isFree) return { success: true, isFree: true, actions: this.getCombatantActions(c, targetRound), round: targetRound };
    const res = await this.recordCombatantAction(c, {
      type: type || (interrupt.type === 'action' ? interrupt.id : (interrupt.type || 'other')),
      label: interrupt.name,
      category: interrupt.category || 'defensive',
      isAttack: Boolean(interrupt.item?.system?.isAttack),
      isInterrupt: true,
      note: note || `Interrupt (${interrupt.triggerLabel || 'Out-of-turn'})`
    }, { round: targetRound });
    return { ...res, isFree: false };
  }

  /**
   * Execute an Interrupt for a combatant.
   * Handles:
   * - Discovery of the interrupt (built-in or item-based or custom data object)
   * - Deducting an action slot from the combatant's budget (unless free interrupt)
   * - Creating an Interrupt Chat Card
   * - Applying any relevant effects (e.g. Evade stance flag)
   * 
   * @param {Combatant|string} combatantOrId
   * @param {string|object} interruptOrId - Interrupt ID ('evade', 'taunt', 'item:xxx', or item ID) or interrupt data object
   * @param {object} [options={}]
   * @param {string} [options.targetName='']
   * @param {Actor} [options.targetActor=null]
   * @param {number|null} [options.round=null]
   * @returns {Promise<object>}
   */
  async triggerInterrupt(combatantOrId, interruptOrId, options = {}) {
    const id = typeof combatantOrId === 'string' ? combatantOrId : combatantOrId?.id;
    const c = (this.combatants || []).find(con => con.id === id);
    if (!c) throw new Error(`Combatant ${id} not found in this combat.`);

    const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
    if (!actor) throw new Error(`Actor for combatant ${c.name} not found.`);

    const targetRound = Number(options.round) || (this.round || 1);
    const actions = this.getCombatantActions(c, targetRound);

    // Resolve interrupt definition
    let interrupt;
    if (typeof interruptOrId === 'object' && interruptOrId !== null) {
      interrupt = interruptOrId;
    } else {
      const intId = String(interruptOrId).trim();
      const available = typeof actor.getAvailableInterrupts === 'function' ? actor.getAvailableInterrupts({ actionsSpent: actions.spent, actionsMax: actions.max }) : [];
      interrupt = available.find(i => i.id === intId || i.itemId === intId || (i.item && (i.item.id === intId || i.item._id === intId))) || null;

      if (!interrupt) {
        const actDef = COG_ACTION_TYPES[intId];
        if (actDef) {
          interrupt = {
            id: intId,
            name: actDef.label,
            type: 'action',
            category: actDef.category || 'defensive',
            icon: actDef.icon || 'fa-solid fa-bolt',
            isFree: false,
            actionCost: 1,
            costDesc: '1 Action',
            trigger: 'any',
            triggerLabel: 'Anytime',
            description: actDef.desc || ''
          };
        } else {
          interrupt = {
            id: intId,
            name: intId,
            type: 'action',
            category: 'defensive',
            icon: 'fa-solid fa-bolt',
            isFree: false,
            actionCost: 1,
            costDesc: '1 Action',
            trigger: 'any',
            triggerLabel: 'Anytime',
            description: ''
          };
        }
      }
    }

    const isFree = Boolean(interrupt.isFree || interrupt.actionCost === 0);

    // If not free, record action slot
    let updatedActions = actions;
    if (!isFree) {
      const recordRes = await this.recordInterruptAction(c, interrupt, { round: targetRound });
      if (recordRes && recordRes.success) {
        updatedActions = recordRes.actions;
      }
    }

    // If Evade, set active stance flag
    if (interrupt.id === 'evade') {
      if (typeof actor.setFlag === 'function') {
        await actor.setFlag(SYSTEM_ID, 'isEvading', true);
      }
    }

    // What the interrupt does to the attack that triggered it (redirect / intercept)
    const interception = resolveInterception({ interrupter: actor, interrupt, attackContext: options.attackContext });
    const interceptionHtml = renderInterceptionHtml(interception, {
      interrupterUuid: actor.uuid,
      interrupterTokenId: findActorToken(actor, { combatant: c })?.id ?? c.tokenId ?? ''
    });
    // A Taunt or Catcher on a declared mob attack moves the attack to the interrupter (3.18).
    await recordInterceptionOnDeclaration(interception, options.attackContext);

    // Post Interrupt Chat Message
    if (globalThis.ChatMessage?.create) {
      const targetText = options.targetName ? ` vs <strong>${options.targetName}</strong>` : '';
      const costBadge = isFree
        ? `<span class="cog-bg-success-fill cog-text-on-fill" style="padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold;">FREE INTERRUPT (0 ACTIONS)</span>`
        : `<span class="cog-bg-warning-fill cog-text-on-fill" style="padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold;">SPENT 1 ACTION (${updatedActions.spent}/${updatedActions.max})</span>`;

      const content = `
        <div class="cog-chat-card cog-interrupt-card cog-bg-surface-alt" style="font-family: var(--font-primary, sans-serif); border: 2px solid var(--cog-warning); border-radius: 4px; padding: 8px 10px;">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1.5px solid var(--cog-warning); padding-bottom: 4px; margin-bottom: 6px;">
            <div class="cog-text-gold" style="font-weight: bold; font-size: 13px; display: flex; align-items: center; gap: 6px;">
              <i class="fa-solid fa-bolt cog-text-warning"></i> INTERRUPT: ${interrupt.name.toUpperCase()}
            </div>
            ${costBadge}
          </div>
          <div class="cog-text" style="font-size: 11px; margin-bottom: 4px;">
            <strong>${c.name}</strong> triggered an out-of-turn Interrupt${targetText}!
          </div>
          <div class="cog-text-secondary cog-bg-surface" style="font-size: 11px; border: 1px solid var(--cog-warning-border); border-radius: 3px; padding: 5px 7px; margin-top: 4px;">
            <div class="cog-text-muted" style="font-size: 10px; text-transform: uppercase; margin-bottom: 2px;">
              <i class="fa-solid fa-crosshairs"></i> Trigger: <strong>${interrupt.triggerLabel || 'Reactive Trigger'}</strong>
            </div>
            ${interrupt.description || ''}
          </div>
          ${interceptionHtml}
        </div>
      `;

      await globalThis.ChatMessage.create({
        speaker: globalThis.ChatMessage.getSpeaker?.({ actor }) || { alias: c.name },
        content,
        flags: {
          [SYSTEM_ID]: {
            isInterrupt: true,
            interruptId: interrupt.id,
            isFree,
            combatantId: c.id,
            actorId: actor.id,
            round: targetRound,
            ...(options.ruleBreak === true ? { ruleBreak: true } : {}),
            ...(interception ? { interception } : {})
          }
        }
      });
    }

    return {
      success: true,
      combatant: c,
      actor,
      interrupt,
      isFree,
      actions: updatedActions,
      round: targetRound,
      interception
    };
  }

  /**
   * Helper to parse and evaluate damage or healing effect expressions.
   * Supports:
   * - Flat numbers: 5, "4"
   * - Bars: "1 bar", "2 bars" (1 bar = hpPerBar)
   * - Floor variable: "1d10+F", "1d8+F" (F replaced with current floor)
   * - Dice expressions: "1d6", "2d4+2" (evaluated via Foundry Roll or fallback math)
   * @param {string|number} expr
   * @param {object} [options={}]
   * @param {Actor} [options.actor=null]
   * @param {number} [options.floor=1]
   * @returns {Promise<number>}
   */
  static async evaluateEffectFormula(expr, { actor = null, floor = 1 } = {}) {
    if (!expr && expr !== 0) return 0;
    if (typeof expr === 'number') return Math.max(0, Math.floor(expr));

    const str = String(expr).trim();
    if (!str) return 0;

    // Check for "X bar" or "X bars"
    const barMatch = str.match(/^(\d+)\s*bars?$/i);
    if (barMatch) {
      const bars = parseInt(barMatch[1], 10) || 0;
      let hpPerBar = 4;
      if (actor) {
        hpPerBar = COGCombatMetrics.getHpPerBar(actor);
      } else if (actor?.system?.attributes?.hp?.hpPerBar) {
        hpPerBar = Number(actor.system.attributes.hp.hpPerBar) || 4;
      } else if (actor?.getCOGStatModifier && actor?.system?.abilities?.con?.value !== undefined) {
        hpPerBar = Math.max(1, actor.getCOGStatModifier(actor.system.abilities.con.value));
      }
      return bars * hpPerBar;
    }

    // Replace F (Floor) variable: e.g. 1d10+F or 1d8+F
    const fVal = Number(floor) || 1;
    const sanitized = str.replace(/\bF\b/gi, String(fVal));

    // If pure number:
    if (!isNaN(Number(sanitized))) {
      return Math.max(0, Math.floor(Number(sanitized)));
    }

    // Dice expression (e.g. 1d6, 1d8+1, 2d4):
    try {
      if (typeof Roll !== 'undefined') {
        const r = new Roll(sanitized);
        // v14: `evaluate()` is async and takes no `async` option (that option is deprecated); this method is async anyway.
        if (typeof r.evaluate === 'function') {
          const resolved = await r.evaluate();
          return Math.max(0, Math.floor(resolved.total || 0));
        }
      }
    } catch (err) {
      console.warn('Sprinter RPG | Could not evaluate effect roll formula:', sanitized, err);
    }

    // Fallback simple dice parsing (e.g. in test harness if Roll is minimal)
    const diceMatch = sanitized.match(/^(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?$/i);
    if (diceMatch) {
      const count = parseInt(diceMatch[1], 10) || 1;
      const sides = parseInt(diceMatch[2], 10);
      const sign = diceMatch[3] === '-' ? -1 : 1;
      const mod = parseInt(diceMatch[4], 10) || 0;
      let total = 0;
      for (let i = 0; i < count; i++) {
        total += Math.floor(Math.random() * sides) + 1;
      }
      total += (sign * mod);
      return Math.max(0, total);
    }

    return 0;
  }

  /**
   * Post an end-of-round chat card summarizing all debuff damage and buff healing.
   * @param {Array<object>} results
   * @param {number} round
   * @param {Combat} combat
   */
  static async postRoundEndEffectsChatCard(results, round, combat) {
    if (!globalThis.ChatMessage?.create || !results?.length) return;

    const rows = results.map(res => {
      if (res.type === 'debuff') {
        if (res.conCheck?.success) {
          return `
            <div class="cog-bg-success-tint" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; border-left: 3px solid var(--cog-success); margin-bottom: 3px; font-size: 11px;">
              <div>
                <span class="cog-text-success" style="font-weight: bold;"><i class="fa-solid fa-shield-heart"></i> ${res.itemName}</span>
                <span class="cog-text"> &rarr; <strong>${res.actorName}</strong></span>
                <span class="cog-text-success" style="font-size: 10px;"> (CON Check ${res.conCheck.total} vs DC ${res.conCheck.dc}: SUCCESS)</span>
              </div>
              <div style="text-align: right;">
                <span class="cog-text-success" style="font-weight: bold; font-size: 11px;">DAMAGE AVOIDED (${res.itemName} Ended!)</span>
                <span class="cog-text-muted" style="font-size: 10px;"> (${res.hpAfter} HP)</span>
              </div>
            </div>
          `;
        }
        return `
          <div class="cog-bg-danger-tint" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; border-left: 3px solid var(--cog-accent); margin-bottom: 3px; font-size: 11px;">
            <div>
              <span class="cog-text-accent" style="font-weight: bold;"><i class="fa-solid fa-skull"></i> ${res.itemName}</span>
              <span class="cog-text-muted" style="font-size: 10px;"> (${res.damageType || 'Physical'})</span>
              <span class="cog-text"> &rarr; <strong>${res.actorName}</strong></span>
              ${res.conCheck && !res.conCheck.success ? `<span class="cog-text-accent" style="font-size: 10px;"> (CON Check ${res.conCheck.total} vs DC ${res.conCheck.dc}: FAILED)</span>` : ''}
            </div>
            <div style="text-align: right;">
              <span class="cog-text-accent" style="font-weight: bold; font-size: 12px;">${res.actualDamage > 0 ? `-${res.actualDamage} HP` : 'No Health Bar lost'}</span>
              <span class="cog-text-muted" style="font-size: 10px;"> (${res.hpAfter} HP)</span>
            </div>
          </div>
        `;
      } else {
        return `
          <div class="cog-bg-success-tint" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; border-left: 3px solid var(--cog-success); margin-bottom: 3px; font-size: 11px;">
            <div>
              <span class="cog-text-success" style="font-weight: bold;"><i class="fa-solid fa-sparkles"></i> ${res.itemName}</span>
              <span class="cog-text"> &rarr; <strong>${res.actorName}</strong></span>
            </div>
            <div style="text-align: right;">
              <span class="cog-text-success" style="font-weight: bold; font-size: 12px;">+${res.actualHealed} HP</span>
              <span class="cog-text-muted" style="font-size: 10px;"> (${res.hpAfter}/${res.maxHp} HP)</span>
            </div>
          </div>
        `;
      }
    }).join('');

    const content = `
      <div class="cog-chat-card cog-round-end-card" style="border: 2px solid var(--cog-panel-border); border-radius: 4px; overflow: hidden; font-family: 'Oswald', sans-serif;">
        <div class="cog-dark cog-bg-header-fill cog-text-on-fill" style="padding: 6px 10px; font-weight: bold; font-size: 12px; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center;">
          <span><i class="fa-solid fa-hourglass-end"></i> End of Round ${round} Effects</span>
          <span style="font-size: 10px; opacity: 0.85;">${results.length} Triggered</span>
        </div>
        <div class="cog-bg-surface" style="padding: 6px 8px;">
          ${rows}
        </div>
      </div>
    `;

    return globalThis.ChatMessage.create({
      content,
      speaker: { alias: 'Combat Tracker' }
    });
  }

  /**
   * Automatically trigger all debuffs that cause damage and all buffs that cause healing
   * across all combatants at the end of a combat round.
   * @param {number} [round=this.round]
   * @returns {Promise<Array<object>>} List of applied effects
   */
  async triggerRoundEndEffects(round = this.round) {
    const r = Number(round) || 1;
    this._triggeredRoundEndEffects = this._triggeredRoundEndEffects || new Set();
    const roundKey = `${this.id || 'active'}-round-${r}`;
    const doneRound = Number(this.getFlag?.(SYSTEM_ID, 'roundEndEffectsRound') ?? this.flags?.[SYSTEM_ID]?.roundEndEffectsRound) || 0;
    if (this._triggeredRoundEndEffects.has(roundKey) || doneRound >= r) {
      return [];
    }
    this._triggeredRoundEndEffects.add(roundKey);
    if (typeof this.setFlag === 'function') await this.setFlag(SYSTEM_ID, 'roundEndEffectsRound', r);

    const currentFloor = getCurrentFloor();

    const results = [];
    const combatantsList = Array.from(this.combatants || []);
    const ctx = {
      combat: this,
      round: r,
      floor: currentFloor,
      evaluate: (expr, actor) => COGCombat.evaluateEffectFormula(expr, { actor, floor: currentFloor })
    };

    for (const c of combatantsList) {
      const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
      if (!actor) continue;
      // Per combatant: debuffs, then buffs, then equipped gear
      results.push(...await roundEndDebuffEffects(actor, c, ctx));
      results.push(...await roundEndBuffHealing(actor, c, ctx));
      results.push(...await roundEndGearEffects(actor, c, ctx));
    }

    // Post Chat Card if any effects triggered
    if (results.length > 0) {
      await COGCombat.postRoundEndEffectsChatCard(results, r, this);
    }

    return results;
  }

  /**
   * Process duration countdowns for round-timed effects (buffs, debuffs, spells, skills, auras) on combatants and on
   * the auras held on the combat's scene. Decrements remainingRounds by 1 once per round; at 0 an effect ends (a
   * debuff is deleted, an aura deactivates, temporary bars it granted are cleared). See duration-expiry.mjs.
   * @param {number} r Current combat round
   * @returns {Promise<Array<object>>} Expired items list
   */
  async processRoundDurations(r) {
    return tickRoundEffects(this, r);
  }

  /**
   * Advance to the next round of combat.
   * - Triggers all debuffs that cause damage and all buffs that cause healing at the end of the round.
   * - Decrements duration on active round-based spells, auras, and buffs.
   * - Snapshots outgoing round action states into roundHistory.
   * - Resets actions for all combatants.
   * - Surprise round automatically expires after the ambush round.
   * @returns {Promise<COGCombat>}
   */
  async nextRound() {
    const currentRound = this.round || 1;
    const open = typeof this.getDeclaredAttacks === 'function'
      ? this.getDeclaredAttacks({ round: currentRound, status: DECLARATION_STATUS.DECLARED })
      : [];
    if (open.length) {
      const verdict = await confirmRuleBreak({
        title: combatText('COG.Combat.RuleBreakTitle'),
        message: combatText('COG.Combat.EndRoundOpenDeclarations', { count: open.length })
      });
      if (!verdict.confirmed) return this;
    }
    if (this.currentStep !== COMBAT_STEPS.CLEAN_UP) {
      await this.stepFiveCleanUp();
    }
    await this.snapshotRoundActions(currentRound);

    // Surprise rounds are rare and only apply to the initial ambush round
    if (this.isSurpriseRound) {
      await this.setFlag(SYSTEM_ID, 'isSurpriseRound', false);
    }

    if (typeof super.nextRound === 'function') {
      await super.nextRound();
    } else {
      this.round = (this.round || 1) + 1;
    }
    await this.setCombatStep(1);
    await this.resetRoundActions();
    await this.assignPhaseInitiative();
    return this;
  }

  /**
   * Snapshot and archive this combat encounter to permanent world storage.
   * Preserves encounter metadata, combatants, round history, and AI metrics.
   * @returns {Promise<object>} The archived encounter record
   */
  async archiveCombat() {
    await this.snapshotRoundActions(this.round || 1);

    const metrics = this.getFlag(SYSTEM_ID, 'metrics') || {};
    const roundHistory = this.getFlag(SYSTEM_ID, 'roundHistory') || {};
    const scene = this.scene || (globalThis.game?.scenes?.get ? globalThis.game.scenes.get(this.sceneId) : null);

    const combatantsData = Array.from(this.combatants || []).map(c => {
      const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
      const isMob = COGCombat.isMobCombatant(c);
      const actorMetrics = metrics[c.actorId] || {};
      
      // Tally action counts across all rounds in roundHistory
      const actionCategories = { damage: 0, tactical: 0, defensive: 0, buff: 0, utility: 0 };
      for (const roundData of Object.values(roundHistory)) {
        const rAct = roundData?.[c.id];
        if (rAct?.slots && Array.isArray(rAct.slots)) {
          for (const s of rAct.slots) {
            if (!s) continue;
            const cat = s.category || COG_ACTION_TYPES[s.type]?.category || (s.isAttack ? 'damage' : 'utility');
            if (actionCategories[cat] !== undefined) {
              actionCategories[cat]++;
            } else {
              actionCategories.utility++;
            }
          }
        }
      }

      return {
        id: c.id,
        name: c.name,
        actorId: c.actorId,
        img: c.img || actor?.img || 'icons/svg/mystery-man.svg',
        type: actor?.type || (isMob ? 'npc' : 'crawler'),
        isMob,
        isDefeated: Boolean(c.isDefeated),
        level: Number(actor?.system?.details?.level) || 1,
        xpValue: Number(actor?.system?.details?.xpValue) || 0,
        hp: actor?.system?.attributes?.hp?.value ?? null,
        maxHp: actor?.system?.attributes?.hp?.max ?? null,
        actions: this.getCombatantActions(c),
        damageDealt: actorMetrics.totalDamage || 0,
        damageTaken: actorMetrics.damageTaken || 0,
        actionCategories,
        highestHit: actorMetrics.highestHit || 0,
        kills: actorMetrics.kills || 0
      };
    });

    const archiveRecord = {
      id: this.id || ('archived-' + Date.now()),
      name: this.name || (scene ? `${scene.name} Encounter` : 'Dungeon Encounter'),
      timestamp: Date.now(),
      dateString: new Date().toLocaleString(),
      sceneId: this.sceneId || null,
      sceneName: scene?.name || 'Unknown Scene',
      totalRounds: Math.max(1, this.round || 1),
      isSurpriseRound: this.isSurpriseRound,
      combatants: combatantsData,
      roundHistory,
      metrics: {
        ...metrics,
        totalDamageDealt: metrics.totalDamageDealt || 0,
        mvp: metrics.mvp || null,
        awards: metrics.awards || [],
        events: metrics.events || []
      }
    };

    await COGCombat.saveArchivedCombat(archiveRecord);
    return archiveRecord;
  }

  /** @override */
  async endCombat() {
    try {
      await this.archiveCombat();
    } catch (err) {
      console.warn('Sprinter RPG | Could not archive combat before ending:', err);
    }
    // GM card proposing the book's once-per-combat AI Favor awards; nothing is awarded automatically.
    try {
      if (globalThis.game?.user?.isGM) await postAiFavorTallyCard(this);
    } catch (err) {
      console.warn('Sprinter RPG | Could not post the AI Favor tally:', err);
    }
    if (typeof super.endCombat === 'function') {
      return super.endCombat();
    }
    return this;
  }

  /**
   * Retrieve all permanently archived combats from world storage.
   * @returns {Array<object>}
   */
  static getArchivedCombats() {
    try {
      return globalThis.game?.settings?.get?.(SYSTEM_ID, 'archivedCombats') || [];
    } catch {
      return [];
    }
  }

  /**
   * Save or update an archived combat record in world storage.
   * @param {object} record
   * @returns {Promise<Array<object>>}
   */
  static async saveArchivedCombat(record) {
    if (!globalThis.game?.settings) return [];
    const existing = COGCombat.getArchivedCombats();
    const updated = [record, ...existing.filter(e => e.id !== record.id)];
    if (!globalThis.game?.user || globalThis.game.user.isGM !== false) {
      await globalThis.game.settings.set(SYSTEM_ID, 'archivedCombats', updated);
    }
    return updated;
  }

  /**
   * Delete an archived combat record by ID.
   * @param {string} id
   * @returns {Promise<Array<object>>}
   */
  static async deleteArchivedCombat(id) {
    if (!globalThis.game?.settings) return [];
    const existing = COGCombat.getArchivedCombats();
    const updated = existing.filter(e => e.id !== id);
    if (!globalThis.game?.user || globalThis.game.user.isGM !== false) {
      await globalThis.game.settings.set(SYSTEM_ID, 'archivedCombats', updated);
    }
    return updated;
  }

  /**
   * Clear all archived combats.
   * @returns {Promise<Array<object>>}
   */
  static async clearArchivedCombats() {
    if (!globalThis.game?.settings) return [];
    if (!globalThis.game?.user || globalThis.game.user.isGM !== false) {
      await globalThis.game.settings.set(SYSTEM_ID, 'archivedCombats', []);
    }
    return [];
  }
}

Object.assign(COGCombat.prototype, combatDeclarationsMixin);

// Built-in Step 5 Clean Up steps. Other rows register theirs with COGCombat.registerCleanUpStep.
COGCombat.registerCleanUpStep('round-end-effects', (combat, { round }) => combat.triggerRoundEndEffects?.(round) ?? [], { order: CLEAN_UP_ORDER.ROUND_END_EFFECTS });
COGCombat.registerCleanUpStep('aura-pulse', (combat, { round }) => runAuraPulseStep(combat, { round }), { order: CLEAN_UP_ORDER.AURA_PULSE });
COGCombat.registerCleanUpStep('durations', (combat, { round }) => combat.processRoundDurations?.(round) ?? [], { order: CLEAN_UP_ORDER.DURATIONS });
COGCombat.registerCleanUpStep('clear-evade', async (combat) => {
  for (const c of (combat.combatants || [])) {
    const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
    if (!actor) continue;
    if (typeof actor.setFlag === 'function') {
      await actor.setFlag(SYSTEM_ID, 'isEvading', false);
    } else if (actor.flags?.[SYSTEM_ID]) {
      actor.flags[SYSTEM_ID].isEvading = false;
    }
  }
}, { order: CLEAN_UP_ORDER.CLEAR_EVADE });
