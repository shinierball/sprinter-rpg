/**
 * Declared mob attacks on the Combat.
 *
 * Step 1: a mob's auto-hit card is recorded as a declaration (`declareAttack`).
 * Step 2: a target's Evade (`recordDeclaredEvade`), a Taunt (redirect) or a Catcher (intercept)
 *         (`recordDeclaredInterception`) change it. Players reach these writes through the GM relay.
 * Step 3: `resolveDeclaredAttacks` rolls each open declaration's damage card and applies it to the targets the attack
 *         now lands on, through the damage card's own apply (the Evade link, riders, undo and the index all apply).
 *
 * The record never holds a number from a relay payload: the GM rebuilds the declaration from its copy of the attack
 * message and each Evade from its copy of the Evade message. 3.19 drives these from its five-step round.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { registerRelayAction, requestRelay, isNoGmReason } from '../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';
import { readEvadeRecord, findEvadeFor, appliedBeforeEvade } from '../utils/attack/evade-link.mjs';
import { isMobSide } from '../utils/combat/combat-sides.mjs';
import { confirmRuleBreak } from '../utils/rule-break.mjs';
import { messageAuthorId, parseMessageContent, applyCardEffect, isGmAuthored } from '../chat/chat-relay.mjs';
import { getDamageApplications } from '../chat/damage-applications.mjs';
import {
  DECLARED_ATTACKS_FLAG, DECLARATION_STATUS, TARGET_VIA, SKIP_REASONS,
  declarationFromMessage, listDeclarations, sanitizeDeclaration, findDeclarationTarget, evadeSummaryOf,
  isDeclarationId, mobAttackText
} from '../utils/combat/declared-attacks.mjs';

/** Relay action for every declaration write; `payload.op` names the write. */
export const DECLARED_ATTACK_RELAY = 'declaredAttack';

const flagPath = (id) => `flags.${SYSTEM_ID}.${DECLARED_ATTACKS_FLAG}.${id}`;

function toArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  return Array.from(collection.values?.() ?? collection);
}

function findCombatById(id) {
  const combats = globalThis.game?.combats;
  if (combats && id) {
    const found = typeof combats.get === 'function' ? combats.get(id) : toArray(combats).find(c => c?.id === id);
    if (found) return found;
  }
  const active = globalThis.game?.combat;
  return active && (!id || active.id === id) ? active : null;
}

function messageById(id) {
  const messages = globalThis.game?.messages;
  if (!messages || !id) return null;
  if (typeof messages.get === 'function') return messages.get(id) ?? null;
  return toArray(messages).find(m => m?.id === id) ?? null;
}

const owns = (user, actor) => Boolean(user?.isGM || actor?.testUserPermission?.(user, 'OWNER'));

/**
 * Whether `message` is a mob's attack card the GM may declare and resolve (3.56c, A-S1): an auto-hit card naming an
 * attacker that is on the mob side, written by a GM or by an owner of that attacker.
 * @returns {{ ok: true, attacker: object, message: object }|{ ok: false, reason: string }}
 */
function verifyMobAttackMessage(message) {
  const flags = message?.flags?.[SYSTEM_ID];
  if (!message || flags?.isAutoHit !== true) return { ok: false, reason: 'not-attack' };
  const attacker = resolveActorByUuid(flags.attackerUuid);
  if (!attacker) return { ok: false, reason: 'no-attacker' };
  if (!isMobSide({ actor: attacker, token: attacker.token })) return { ok: false, reason: 'not-mob' };
  const author = globalThis.game?.users?.get?.(messageAuthorId(message));
  if (!isGmAuthored(message) && !attacker.testUserPermission?.(author, 'OWNER')) return { ok: false, reason: 'bad-author' };
  return { ok: true, attacker, message };
}

/** The combatant of `actor` in `combat` (uuid first, since unlinked tokens share an actor id). */
export function combatantOfActor(combat, actor) {
  if (!combat || !actor) return null;
  const list = toArray(combat.combatants);
  return list.find(c => c?.actor?.uuid && c.actor.uuid === actor.uuid)
    ?? list.find(c => c?.actorId === actor.id || c?.actor?.id === actor.id)
    ?? null;
}

// -- GM-side writes ---------------------------------------------------------------------------------------------

async function writeDeclaration(combat, message) {
  const record = declarationFromMessage(message, { round: Number(combat.round) || 0 });
  if (!record) return null;
  if (combat.getDeclaredAttack(record.messageId)) return combat.getDeclaredAttack(record.messageId);
  await combat.update({ [flagPath(record.messageId)]: record });
  return combat.getDeclaredAttack(record.messageId);
}

async function writeEvade(combat, { declarationId, evadeMessage, ruleBreak }) {
  const decl = combat.getDeclaredAttack(declarationId);
  const record = readEvadeRecord(evadeMessage);
  if (!decl || !record || record.attackMessageId !== declarationId) return null;
  const target = findDeclarationTarget(decl, { uuid: record.evaderUuid });
  if (!target) return null;
  const isRuleBreak = ruleBreak === true || evadeMessage?.flags?.[SYSTEM_ID]?.ruleBreak === true;
  const evade = evadeSummaryOf(record, { ruleBreak: isRuleBreak });
  await combat.update({ [`${flagPath(declarationId)}.targets.${target.key}.evade`]: evade });
  return { declarationId, targetKey: target.key, evade };
}

async function writeInterception(combat, { declarationId, fromUuid, fromActorId, fromTokenId, toUuid, mode, ruleBreak }) {
  const decl = combat.getDeclaredAttack(declarationId);
  const interrupter = resolveActorByUuid(toUuid);
  if (!decl || !interrupter || !Object.values(TARGET_VIA).includes(mode)) return null;
  const target = findDeclarationTarget(decl, { uuid: fromUuid, actorId: fromActorId, tokenId: fromTokenId });
  if (!target || target.uuid === interrupter.uuid) return null;
  const entry = {
    uuid: interrupter.uuid,
    actorId: interrupter.id ?? null,
    tokenId: interrupter.token?.id ?? null,
    name: String(interrupter.name ?? ''),
    originalUuid: target.originalUuid,
    originalName: target.originalName,
    via: mode,
    interrupterUuid: interrupter.uuid,
    ruleBreak: ruleBreak === true || target.ruleBreak,
    // The new defender has not Evaded yet (a Taunt) or takes the un-evaded hit (a Catcher).
    evade: null
  };
  await combat.update({ [`${flagPath(declarationId)}.targets.${target.key}`]: entry });
  return { declarationId, targetKey: target.key, mode, toUuid: interrupter.uuid };
}

/** Each relayed op: `authorize(payload, user)` on the GM, then `apply(payload, user)`. */
const DECLARATION_OPS = {
  declare: {
    authorize(payload, user) {
      const message = messageById(payload?.messageId);
      const attacker = resolveActorByUuid(message?.flags?.[SYSTEM_ID]?.attackerUuid);
      return Boolean(message && attacker && owns(user, attacker) && verifyMobAttackMessage(message).ok);
    },
    apply: (combat, payload) => writeDeclaration(combat, messageById(payload.messageId))
  },
  evade: {
    authorize(payload, user) {
      const message = messageById(payload?.evadeMessageId);
      const record = readEvadeRecord(message);
      const evader = resolveActorByUuid(record?.evaderUuid);
      if (!record || !evader) return false;
      // The Evade must be the requester's own roll (or the GM's) for an actor they own.
      return Boolean(user?.isGM || (messageAuthorId(message) === user?.id && owns(user, evader)));
    },
    apply: (combat, payload) => writeEvade(combat, {
      declarationId: payload.declarationId, evadeMessage: messageById(payload.evadeMessageId), ruleBreak: payload.ruleBreak === true
    })
  },
  intercept: {
    authorize: (payload, user) => owns(user, resolveActorByUuid(payload?.toUuid)),
    apply: (combat, payload) => writeInterception(combat, payload)
  }
};

registerRelayAction(DECLARED_ATTACK_RELAY, {
  authorize(payload, user) {
    const op = DECLARATION_OPS[payload?.op];
    if (!op || !findCombatById(payload?.combatId)) return false;
    if (payload.op !== 'declare' && !isDeclarationId(payload.declarationId)) return false;
    return op.authorize(payload, user);
  },
  async apply(payload, user) {
    const combat = findCombatById(payload.combatId);
    if (!combat) throw new Error(`Combat ${payload.combatId} not found.`);
    return DECLARATION_OPS[payload.op].apply(combat, payload, user);
  }
});

/** Send one op through the relay (direct on the GM); null when no GM could record it. */
async function relayOp(combat, op, data) {
  const res = await requestRelay(DECLARED_ATTACK_RELAY, { op, combatId: combat.id, ...data });
  if (!res.ok) {
    if (!isNoGmReason(res.reason)) console.warn(`Sprinter RPG | The GM did not record the declared attack (${op}).`);
    return null;
  }
  return res.result ?? null;
}

// -- Step 3 resolution ------------------------------------------------------------------------------------------

/** The first element with `data-action === action` in parsed message content. */
function actionButton(doc, actions) {
  return [...doc.querySelectorAll('[data-action]')].find(b => actions.includes(b.dataset.action)) ?? null;
}

async function resolveOne(combat, decl, { ruleBreak }) {
  // Dynamic: the chat action modules import combat-metrics and the actor document graph.
  const { parseApplyDamage, isTrustedEvade } = await import('../chat/actions/apply-damage.mjs');
  const { handleRollItemDamage, handleRollSpellDamage } = await import('../chat/actions/roll-damage.mjs');
  const messages = globalThis.game?.messages;
  const attackMessage = messageById(decl.messageId);

  // The GM checks the stored attack message, not the declaration: it must still be the mob's attack, the listed targets
  // must be the attack's targets (or a redirect of one), and the damage button must be the attacker's own.
  const trust = verifyMobAttackMessage(attackMessage);
  const attackTargets = new Set((attackMessage?.flags?.[SYSTEM_ID]?.targetResults ?? []).map(tr => tr?.actorUuid));
  const rollButton = attackMessage?.content
    ? actionButton(parseMessageContent(attackMessage.content), ['crawlerRollItemDamage', 'crawlerRollSpellDamage'])
    : null;
  const trusted = trust.ok
    && trust.attacker.uuid === decl.attackerUuid
    && decl.targets.every(t => attackTargets.has(t.originalUuid))
    && rollButton?.dataset.actorUuid === trust.attacker.uuid;

  const results = [];
  const toApply = [];
  for (const t of decl.targets) {
    const actor = resolveActorByUuid(t.uuid);
    const row = { uuid: t.uuid, name: t.name, damage: 0, skipped: null };
    if (!trusted) {
      results.push({ ...row, skipped: SKIP_REASONS.UNTRUSTED });
      continue;
    }
    if (!actor) {
      results.push({ ...row, skipped: SKIP_REASONS.MISSING });
      continue;
    }
    const evade = findEvadeFor(messages, { attackMessageId: decl.messageId, targetUuid: t.uuid, isTrusted: isTrustedEvade });
    if (evade && evade.multiplier === 0) {
      results.push({ ...row, skipped: SKIP_REASONS.EVADED });
      continue;
    }
    // Damage from this attack already applied by hand (the card's own buttons) is never applied twice.
    if (appliedBeforeEvade(messages, { attackMessageId: decl.messageId, evaderUuid: t.uuid, getApplications: getDamageApplications })) {
      results.push({ ...row, skipped: SKIP_REASONS.APPLIED_BEFORE });
      continue;
    }
    toApply.push({ actor, row });
  }

  let damageMessageId = null;
  if (toApply.length && rollButton) {
    const roll = rollButton?.dataset.action === 'crawlerRollSpellDamage' ? handleRollSpellDamage : handleRollItemDamage;
    const damageMessage = await roll(null, rollButton, attackMessage);
    damageMessageId = typeof damageMessage?.id === 'string' ? damageMessage.id : null;
    const applyButton = damageMessage?.content ? actionButton(parseMessageContent(damageMessage.content), ['crawlerApplyDamage']) : null;
    const params = applyButton ? parseApplyDamage(applyButton) : null;
    if (params) {
      const { results: applied } = await applyCardEffect('crawlerApplyDamage', {
        message: damageMessage, button: applyButton, params, targets: toApply.map(e => e.actor)
      });
      for (const e of toApply) {
        const hit = applied.find(r => r?.targetUuid === e.actor.uuid);
        e.row.damage = Number(hit?.actualDamage) || 0;
      }
    }
  }
  results.push(...toApply.map(e => e.row));

  const resolution = { at: Date.now(), damageMessageId, ruleBreak: ruleBreak === true, results };
  await combat.update({
    [`${flagPath(decl.messageId)}.status`]: DECLARATION_STATUS.RESOLVED,
    [`${flagPath(decl.messageId)}.resolution`]: resolution,
    ...(ruleBreak ? { [`${flagPath(decl.messageId)}.ruleBreak`]: true } : {})
  });
  return combat.getDeclaredAttack(decl.messageId);
}

/**
 * COGCombat methods (assigned onto its prototype by combat.mjs).
 */
export const combatDeclarationsMixin = {
  /**
   * The declared mob attacks, oldest first.
   * @param {{ round?: number|null, status?: string|null }} [filter] round defaults to the current round; null = all
   * @returns {object[]}
   */
  getDeclaredAttacks({ round, status = null } = {}) {
    const flag = this.getFlag?.(SYSTEM_ID, DECLARED_ATTACKS_FLAG) ?? this.flags?.[SYSTEM_ID]?.[DECLARED_ATTACKS_FLAG];
    return listDeclarations(flag, { round: round === undefined ? Number(this.round) || 0 : round, status });
  },

  /** One declaration by its attack message id, or null. */
  getDeclaredAttack(declarationId) {
    if (!isDeclarationId(declarationId)) return null;
    const flag = this.getFlag?.(SYSTEM_ID, DECLARED_ATTACKS_FLAG) ?? this.flags?.[SYSTEM_ID]?.[DECLARED_ATTACKS_FLAG];
    return sanitizeDeclaration(flag?.[declarationId]);
  },

  /**
   * Step 1: record a mob's auto-hit card as a declaration. The GM rebuilds it from its copy of the message.
   * @param {object} message the attack ChatMessage
   * @returns {Promise<object|null>} the declaration
   */
  async declareAttack(message) {
    if (!isDeclarationId(message?.id)) return null;
    if (globalThis.game?.user?.isGM) return writeDeclaration(this, message);
    const res = await relayOp(this, 'declare', { messageId: message.id });
    return res ? sanitizeDeclaration(res) ?? this.getDeclaredAttack(message.id) : null;
  },

  /**
   * Step 2: record a target's Evade roll on its declaration. Read back from the Evade message by the GM.
   * @param {{ declarationId: string, evadeMessage: object, ruleBreak?: boolean }} p
   */
  async recordDeclaredEvade({ declarationId, evadeMessage, ruleBreak = false } = {}) {
    if (!this.getDeclaredAttack(declarationId) || !evadeMessage?.id) return null;
    if (globalThis.game?.user?.isGM) return writeEvade(this, { declarationId, evadeMessage, ruleBreak });
    return relayOp(this, 'evade', { declarationId, evadeMessageId: evadeMessage.id, ruleBreak: ruleBreak === true });
  },

  /**
   * Step 2: a Taunt (`redirect`) or a Catcher (`intercept`) moves a target entry to the interrupter.
   * @param {{ declarationId: string, fromUuid?: string, fromActorId?: string, fromTokenId?: string, toUuid: string, mode: string, ruleBreak?: boolean }} p
   */
  async recordDeclaredInterception(p = {}) {
    if (!this.getDeclaredAttack(p.declarationId)) return null;
    const payload = {
      declarationId: p.declarationId,
      fromUuid: p.fromUuid ?? null,
      fromActorId: p.fromActorId ?? null,
      fromTokenId: p.fromTokenId ?? null,
      toUuid: p.toUuid,
      mode: p.mode,
      ruleBreak: p.ruleBreak === true
    };
    if (globalThis.game?.user?.isGM) return writeInterception(this, payload);
    return relayOp(this, 'intercept', payload);
  },

  /**
   * Step 3: resolve the open declarations. Each one's damage card is rolled from its attack card and applied to the
   * targets the attack now lands on; a target whose Evade avoided it, or who already took this attack's damage, is
   * skipped. Resolving while the Interrupt window is still open (before Step 3) asks for a Rule Break.
   * GM only.
   * @param {{ ids?: string[]|null, round?: number|null, ruleBreak?: boolean }} [opts] ids default to every open
   *   declaration of `round` (default: the current round)
   * @returns {Promise<{ resolved: object[], ruleBreak: boolean, refused?: string }>}
   */
  async resolveDeclaredAttacks({ ids = null, round, ruleBreak = false } = {}) {
    if (globalThis.game?.user && !globalThis.game.user.isGM) {
      globalThis.ui?.notifications?.warn?.(mobAttackText('COG.MobAttack.GmOnly'));
      return { resolved: [], ruleBreak: false, refused: 'gm-only' };
    }
    const wanted = Array.isArray(ids) ? ids.filter(isDeclarationId) : null;
    const open = this.getDeclaredAttacks({ round: wanted ? null : round, status: DECLARATION_STATUS.DECLARED })
      .filter(d => !wanted || wanted.includes(d.messageId));
    if (!open.length) return { resolved: [], ruleBreak: false };

    let isRuleBreak = ruleBreak === true;
    if (!isRuleBreak && typeof this._interruptWindowOpen === 'function' && this._interruptWindowOpen()) {
      const verdict = await confirmRuleBreak({
        title: mobAttackText('COG.MobAttack.RuleBreakTitle'),
        message: mobAttackText('COG.MobAttack.ResolvePending', { step: this.currentStep })
      });
      if (!verdict.confirmed) return { resolved: [], ruleBreak: false, refused: verdict.refusal };
      isRuleBreak = true;
    }

    const resolved = [];
    for (const decl of open) resolved.push(await resolveOne(this, decl, { ruleBreak: isRuleBreak }));
    globalThis.ui?.notifications?.info?.(mobAttackText('COG.MobAttack.ResolvedCount', { count: resolved.length }));
    return { resolved, ruleBreak: isRuleBreak };
  }
};

// -- Callers outside the Combat ---------------------------------------------------------------------------------

/** The active, started combat that has `actor` as a combatant, or null. */
export function activeCombatFor(actor) {
  const combat = globalThis.game?.combat;
  if (!combat || typeof combat.declareAttack !== 'function' || !(Number(combat.round) >= 1)) return null;
  return combatantOfActor(combat, actor) ? combat : null;
}

/**
 * Step 1 from a mob's auto-hit card: declare it when the mob is in the active combat. Never throws (the card stands).
 * @returns {Promise<object|null>}
 */
export async function declareMobAttack(attacker, message) {
  const combat = activeCombatFor(attacker);
  if (!combat || !message?.id) return null;
  try {
    return await combat.declareAttack(message);
  } catch (err) {
    console.error('Sprinter RPG | Could not declare the mob attack:', err);
    return null;
  }
}

/**
 * Step 2 from an Evade roll on a declared attack: spend the evader's Interrupt Action and record the Evade on the
 * declaration. Outside a declaration (no combat, a rolled attack) nothing is recorded.
 * @param {object} evader
 * @param {object} evadeMessage the posted Evade message
 * @param {string|null} attackMessageId
 * @param {{ ruleBreak?: boolean, interrupt?: object }} [opts] `interrupt` is the Evade action entry to record
 */
export async function recordEvadeOnDeclaration(evader, evadeMessage, attackMessageId, { ruleBreak = false, interrupt = null } = {}) {
  const combat = globalThis.game?.combat;
  if (!combat?.getDeclaredAttack?.(attackMessageId)) return null;
  try {
    const c = combatantOfActor(combat, evader);
    if (c && interrupt && typeof combat.recordInterruptAction === 'function') {
      const recorded = await combat.recordInterruptAction(c, interrupt, { type: interrupt.id, ruleBreak });
      if (recorded?.declined) return null;
    }
    return await combat.recordDeclaredEvade({ declarationId: attackMessageId, evadeMessage, ruleBreak });
  } catch (err) {
    console.error('Sprinter RPG | Could not record the Evade on the declared attack:', err);
    return null;
  }
}

/**
 * The combat that holds declaration `id`: the one named by `combatId` (carried on the attack context), else the
 * active combat, else any combat in the world that holds it (the declaration id is its attack message id).
 */
export function combatOfDeclaration(id, combatId = null) {
  const game = globalThis.game;
  const holds = (c) => (c?.getDeclaredAttack?.(id) ? c : null);
  if (typeof combatId === 'string' && combatId) {
    const named = holds(game?.combats?.get?.(combatId));
    if (named) return named;
  }
  const active = holds(game?.combat);
  if (active) return active;
  for (const c of game?.combats ?? []) if (holds(c)) return c;
  return null;
}

/**
 * Step 2 from a Taunt or Catcher on a declared attack: move the target entry to the interrupter.
 * @param {object|null} interception `resolveInterception`'s result
 * @param {object|null} attackContext the interrupt button's attack context
 */
export async function recordInterceptionOnDeclaration(interception, attackContext) {
  const id = attackContext?.attackMessageId;
  const combat = combatOfDeclaration(id, attackContext?.combatId);
  if (!interception || !id || !combat) return null;
  try {
    return await combat.recordDeclaredInterception({
      declarationId: id,
      fromUuid: attackContext.defenderUuid ?? null,
      fromActorId: attackContext.defenderId ?? null,
      fromTokenId: attackContext.defenderTokenId ?? null,
      toUuid: interception.toActorUuid,
      mode: interception.mode,
      ruleBreak: attackContext.ruleBreak === true
    });
  } catch (err) {
    console.error('Sprinter RPG | Could not record the interrupt on the declared attack:', err);
    return null;
  }
}
