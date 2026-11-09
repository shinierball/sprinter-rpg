/**
 * Session ledger writes from player clients.
 *
 * The session list lives in a world setting that only a GM may write, but players roll dice and apply
 * damage. Each recorder here relays the operation, not the sessions
 * array: a non-GM client sends the method name plus primitive arguments (actor UUIDs, a reduced roll) to
 * the active GM through the GM relay. The GM checks the method is on a fixed allowlist, checks the
 * requester owns an actor the entry is for, rebuilds the arguments from the primitives it recognises
 * (anything else in the payload is dropped), and runs the real recorder, so ledger entries are always
 * built on the GM. Relayed and GM-direct recorder calls share one promise queue; each reads the current
 * sessions inside the queue, so concurrent records cannot lose an update.
 *
 * Every other session writer is GM-only (loot boxes included: awards are the GM's call): on a non-GM client it warns, writes nothing and returns null.
 */
import { registerRelayAction, dispatchRelay, getActiveGM } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { extractD20Result } from './roll-outcomes.mjs';

export const SESSION_OP = 'sessionOp';

/** Recorders a player client may relay. A fixed set of method names; never derived from text. */
const PLAYER_RELAYABLE = Object.freeze(['recordRoll', 'recordDamage', 'updateLedgerEntry', 'spendAIFavor']);

/** Session writers that only a GM may run. */
export const GM_ONLY_METHODS = Object.freeze([
  'saveAllSessions', 'setActiveSessionId', 'createSession', 'recordLootBox',
  'createManualEvent', 'batchCreateEvents', 'deleteLedgerEntry', 'updateCrawlerStats',
  'setTrackedCrawlerIds', 'addTrackedCrawler', 'removeTrackedCrawler', 'toggleTrackedCrawler',
  'assignPartyToCrawlers', 'selectPartyForSession',
  'endSession', 'reopenSession', 'activateSession', 'ensureTrackedRoster', 'trainUntrainedSkill', 'distributeSessionXP', 'broadcastAISessionReview',
  'adjustAIFavor', 'adjustPopularity'
]);

/** Ledger fields a player's relayed edit may change (everything the Edit Event dialog and inline controls write). */
const PLAYER_EDITABLE_LEDGER_FIELDS = Object.freeze([
  'actorId', 'name', 'type', 'isUntrained', 'isKill', 'damage', 'healing', 'mitigation', 'condition',
  'conditionAction', 'statDelta', 'rollFormula', 'd20Result', 'total', 'targetDC', 'outcome', 'notes'
]);

const ROLL_TYPES = new Set(['skill', 'untrained_skill', 'spell', 'attack', 'untrained_attack', 'stat']);

const isNonGMClient = () => Boolean(globalThis.game?.user) && !globalThis.game.user.isGM;
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const finite = (v) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);

function ownsAnyActor(actors, user) {
  if (user?.isGM) return true;
  return actors.some(actor => Boolean(actor?.testUserPermission?.(user, 'OWNER')));
}

function ownsAllActors(actors, user) {
  if (user?.isGM) return true;
  return actors.length > 0 && actors.every(actor => Boolean(actor?.testUserPermission?.(user, 'OWNER')));
}

let queue = Promise.resolve();
/** Run `fn` after every earlier queued session write has settled. */
function enqueue(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

let engineRef = null;
const originals = {};
let noGMWarned = false;

/** Per-method: reduce live arguments to primitives (client) and rebuild live arguments from them (GM). */
const OPS = {
  recordRoll: {
    pack(a = {}) {
      const actorUuid = a.actor?.uuid;
      if (!actorUuid) return null;
      const total = finite(a.roll?.total ?? a.roll?.result) ?? 0;
      return {
        actorUuid,
        roll: { total, formula: String(a.roll?.formula ?? total).slice(0, 200), d20Result: extractD20Result(a.roll) },
        type: a.type, name: a.name, isUntrained: a.isUntrained, targetDC: a.targetDC, notes: a.notes
      };
    },
    resolve(p) {
      const actor = resolveActorByUuid(p?.actorUuid);
      if (!actor || !ROLL_TYPES.has(p.type) || !p.roll || finite(p.roll.total) === null) return null;
      return {
        owners: [actor],
        args: {
          actor,
          roll: { total: Number(p.roll.total), formula: str(p.roll.formula), d20Result: finite(p.roll.d20Result) },
          type: p.type,
          name: str(p.name) || 'Action',
          isUntrained: p.isUntrained === true,
          targetDC: finite(p.targetDC),
          notes: str(p.notes, 500)
        }
      };
    }
  },
  updateLedgerEntry: {
    pack(sessionId, entryId, updateData = {}) {
      if (typeof sessionId !== 'string' || typeof entryId !== 'string') return null;
      const data = {};
      for (const key of PLAYER_EDITABLE_LEDGER_FIELDS) {
        if (updateData?.[key] !== undefined) data[key] = updateData[key];
      }
      return { sessionId, entryId, data };
    },
    resolve(p) {
      if (typeof p?.sessionId !== 'string' || typeof p?.entryId !== 'string' || !p.data || typeof p.data !== 'object') return null;
      const session = engineRef?.getAllSessions?.().find(s => s.id === p.sessionId);
      const entry = session?.ledger?.find(e => e.id === p.entryId);
      if (!entry) return null;
      const owners = [globalThis.game?.actors?.get?.(entry.actorId)];
      const data = {};
      for (const key of PLAYER_EDITABLE_LEDGER_FIELDS) {
        if (p.data[key] === undefined) continue;
        const v = p.data[key];
        // Primitives only; anything else in the payload is dropped.
        if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) data[key] = typeof v === 'string' ? v.slice(0, 2000) : v;
      }
      // Moving an entry to another crawler needs a say over that crawler too.
      if (data.actorId !== undefined) owners.push(globalThis.game?.actors?.get?.(data.actorId));
      if (owners.some(a => !a)) return null;
      return { owners, args: [p.sessionId, p.entryId, data] };
    }
  },
  // A player's own AI Favor spend (a negative delta on an actor they own). Gains stay GM-only; the GM runs the real
  // adjustAIFavor, which itself remains on the GM-only list.
  spendAIFavor: {
    pack(a = {}) {
      const delta = Number(a.delta);
      if (!a.actor?.uuid || !Number.isInteger(delta) || delta >= 0) return null;
      return { actorUuid: a.actor.uuid, delta, reason: a.reason };
    },
    resolve(p) {
      const actor = resolveActorByUuid(p?.actorUuid);
      const delta = typeof p?.delta === 'number' ? p.delta : NaN;
      if (!actor || !Number.isInteger(delta) || delta >= 0) return null;
      return { owners: [actor], args: { actorId: actor.id, delta, reason: str(p.reason, 500) } };
    }
  },
  recordDamage: {
    pack(a = {}) {
      if (!a.attackerActor?.uuid && !a.targetActor?.uuid) return null;
      return {
        attackerUuid: a.attackerActor?.uuid ?? null,
        targetUuid: a.targetActor?.uuid ?? null,
        actualDamage: a.actualDamage, attackName: a.attackName, applicationId: a.applicationId
      };
    },
    resolve(p) {
      const attackerActor = p?.attackerUuid ? resolveActorByUuid(p.attackerUuid) : null;
      const targetActor = p?.targetUuid ? resolveActorByUuid(p.targetUuid) : null;
      if (p?.attackerUuid && !attackerActor) return null;
      if (p?.targetUuid && !targetActor) return null;
      // Either side may log the hit: the attacker's player for damage dealt, the target's player for a
      // monster's hit they applied to their own crawler (user decision 2026-10-18).
      const owners = [attackerActor, targetActor].filter(Boolean);
      const damage = finite(p?.actualDamage);
      if (owners.length === 0 || damage === null || damage < 0) return null;
      return {
        owners,
        args: {
          attackerActor, targetActor, actualDamage: damage,
          attackName: str(p.attackName) || 'Attack',
          applicationId: typeof p.applicationId === 'string' ? p.applicationId.slice(0, 64) : null
        }
      };
    }
  }
};

function opFor(method) {
  return typeof method === 'string' && PLAYER_RELAYABLE.includes(method) ? OPS[method] : null;
}

registerRelayAction(SESSION_OP, {
  authorize(payload, user) {
    const resolved = opFor(payload?.method)?.resolve(payload.args);
    if (!resolved) return false;
    return payload.method === 'updateLedgerEntry'
      ? ownsAllActors(resolved.owners, user)
      : ownsAnyActor(resolved.owners, user);
  },
  async apply(payload, user) {
    const resolved = opFor(payload?.method)?.resolve(payload.args);
    if (!resolved) return null;
    if (payload.method === 'updateLedgerEntry') {
      const editor = user?.isGM ? null : { userId: user?.id ?? null, userName: str(user?.name, 100) };
      return enqueue(() => originals.updateLedgerEntry.call(engineRef, ...resolved.args, editor));
    }
    if (payload.method === 'spendAIFavor') return enqueue(() => originals.adjustAIFavor.call(engineRef, resolved.args));
    return enqueue(() => originals[payload.method].call(engineRef, resolved.args));
  }
});

/**
 * Wrap the engine's session writers. Call once after the mixins are assigned.
 * @param {object} Engine the COGSessionEngine class
 */
export function installSessionRelay(Engine) {
  engineRef = Engine;
  for (const name of [...PLAYER_RELAYABLE, ...GM_ONLY_METHODS]) originals[name] = Engine[name];

  /** Spend AI Favor: the GM writes the ledger directly; a player's spend of an owned actor relays. Gains never relay. */
  Engine.spendAIFavor = async function spendAIFavor(args = {}) {
    if (!isNonGMClient()) {
      const delta = Number(args.delta);
      if (!Number.isInteger(delta) || delta >= 0) return null;
      return enqueue(() => originals.adjustAIFavor.call(Engine, { actorId: args.actor?.id, delta, reason: args.reason }));
    }
    const packed = OPS.spendAIFavor.pack(args);
    if (!packed || !getActiveGM()) return null;
    await dispatchRelay(SESSION_OP, { method: 'spendAIFavor', args: packed }, { direct: false });
    return null;
  };

  Engine.updateLedgerEntry = async function relayableLedgerEdit(sessionId, entryId, updateData = {}) {
    if (!isNonGMClient()) return enqueue(() => originals.updateLedgerEntry.call(Engine, sessionId, entryId, updateData));
    const packed = OPS.updateLedgerEntry.pack(sessionId, entryId, updateData);
    if (!packed) return null;
    // The GM would refuse an edit to a crawler this user does not own (silently): say so here instead.
    const owners = OPS.updateLedgerEntry.resolve(packed)?.owners;
    if (owners && !ownsAllActors(owners, globalThis.game.user)) {
      globalThis.ui?.notifications?.warn?.(globalThis.game.i18n?.localize?.('COG.Session.LedgerEditNotOwner') ?? 'COG.Session.LedgerEditNotOwner');
      return null;
    }
    // dispatchRelay tells the player when no GM is connected (ui notification).
    const ok = await dispatchRelay(SESSION_OP, { method: 'updateLedgerEntry', args: packed }, { direct: false });
    if (!ok) return null;
    return Engine.getAllSessions?.().find(s => s.id === sessionId)?.ledger?.find(e => e.id === entryId) ?? null;
  };

  for (const name of PLAYER_RELAYABLE.filter(n => n !== 'updateLedgerEntry' && n !== 'spendAIFavor')) {
    Engine[name] = async function relayableRecorder(args) {
      if (!isNonGMClient()) return enqueue(() => originals[name].call(Engine, args));
      const packed = OPS[name].pack(args);
      if (!packed) return null;
      if (!getActiveGM()) {
        if (!noGMWarned) console.warn(`Sprinter RPG | No GM is connected; dropped the session ledger record "${name}".`);
        noGMWarned = true;
        return null;
      }
      noGMWarned = false;
      await dispatchRelay(SESSION_OP, { method: name, args: packed }, { direct: false });
      return null;
    };
  }

  for (const name of GM_ONLY_METHODS) {
    Engine[name] = async function gmOnlyWriter(...args) {
      if (isNonGMClient()) {
        console.warn(`Sprinter RPG | Only a GM can run the session operation "${name}".`);
        globalThis.ui?.notifications?.warn?.('Sprinter RPG | Only a GM can do that in the session ledger.');
        return null;
      }
      return originals[name].apply(Engine, args);
    };
  }
}
