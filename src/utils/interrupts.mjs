/**
 * Pure interrupt offer selection, token geometry and interception resolution.
 * Imports only utils/data modules (never documents) so it cannot create an import cycle.
 *
 * Who is offered which interrupt is decided only by the interrupt's trigger tags
 * (see INTERRUPT_TRIGGERS in tag-mechanics.mjs); no ids, names or notes are read.
 */
import { isMobSide } from './combat-sides.mjs';
import { hasRuleFlag, RULE_FLAGS } from './tag-behaviour.mjs';
import {
  getTagsOf, isOfferedOnAttack, isOfferedOnCheck, isOfferedOnMove, MOVE_EVENTS, TOUCH_REACH_FEET, OFFER_ROLES, isAreaTagSet
} from './tag-mechanics.mjs';
import { resolveActorByUuid } from './actor-uuid.mjs';
import { evaluateRollOutcome, COG_ROLL_OUTCOMES } from '../apps/session-manager/roll-outcomes.mjs';
import { effectiveCheck, getAssistSpec, assistOfferMatches } from './check-assists.mjs';
import { mobAttackText } from './declared-attacks.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { MAX_EVADE_SCAN } from './evade-link.mjs';

/** Largest "+N DR" an interrupt record can carry (a sanity cap on hand-entered numbers). */
const MAX_DR_BONUS = 1000;

/** Escape user content for use inside an HTML attribute or text node (plain string replacement). */
export function escapeAttr(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Attack-card words for the degrees that have their own label, keyed by outcome id so the card and the id cannot drift apart. */
export const ATTACK_OUTCOME_LABELS = Object.freeze({
  [COG_ROLL_OUTCOMES.AMAZING_SUCCESS]: 'Amazing Success'
});

/**
 * Outcome label rules for an attack total against a DC. The degree comes from `evaluateRollOutcome` (the one classifier,
 * so the card's words and the `outcome.*` tags agree); `outcomeId` is its result.
 * @returns {{ isHit: boolean, diff: number, outcome: string, outcomeId: string }}
 */
export function classifyAttackOutcome(total, dc, d20Face = null) {
  // A Natural 1 is a Critical Miss and misses even when the total reaches the DC (E6.5); a Natural 20 is judged by its total.
  const isHit = d20Face !== 1 && total >= dc;
  const diff = total - dc;
  const outcomeId = evaluateRollOutcome({ total, d20Result: d20Face, targetDC: dc });
  let outcome = isHit ? 'Hit' : 'Miss';
  if (d20Face === 20) {
    outcome = 'Critical Hit';
  } else if (d20Face === 1) {
    outcome = 'Critical Miss';
  } else if (diff >= 10) {
    outcome = ATTACK_OUTCOME_LABELS[COG_ROLL_OUTCOMES.AMAZING_SUCCESS];
  } else if (outcomeId === COG_ROLL_OUTCOMES.NEAR_MISS && !isHit) {
    outcome = 'Near Miss';
  } else if (diff <= -10) {
    outcome = 'Major Miss';
  }
  return { isHit, diff, outcome, outcomeId };
}

function toArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  return Array.from(collection);
}

function getPlaceables() {
  return toArray(globalThis.canvas?.tokens?.placeables);
}

function lookupActor(id) {
  if (!id) return null;
  return resolveActorByUuid(id) || (typeof globalThis.game?.actors?.get === 'function' ? globalThis.game.actors.get(id) : null);
}

/**
 * Token placeable for an actor: by tokenId first, then combatant.token?.object,
 * then a canvas placeable whose actor id matches. Null if none.
 */
export function findActorToken(actor, { tokenId = null, combatant = null } = {}) {
  const placeables = getPlaceables();
  if (tokenId) {
    const byId = placeables.find(t => t?.id === tokenId || t?.document?.id === tokenId);
    if (byId) return byId;
  }
  const fromCombatant = combatant?.token?.object;
  if (fromCombatant) return fromCombatant;
  if (!actor) return null;
  return placeables.find(t => t?.actor?.uuid === actor.uuid) || null;
}

/** Feet between two token placeables (centres), or null when either is missing. */
export function measureTokenFeet(a, b) {
  const ca = a?.center;
  const cb = b?.center;
  if (!ca || !cb) return null;
  const grid = globalThis.canvas?.grid;
  if (typeof grid?.measurePath === 'function') {
    const d = grid.measurePath([ca, cb])?.distance;
    if (Number.isFinite(d)) return d;
  }
  if (typeof grid?.measureDistance === 'function') {
    const d = grid.measureDistance(ca, cb);
    if (Number.isFinite(d)) return d;
  }
  const size = Number(grid?.size) || 0;
  if (!size) return null;
  const unit = Number(globalThis.canvas?.scene?.grid?.distance ?? globalThis.canvas?.dimensions?.distance) || 5;
  return Math.hypot(ca.x - cb.x, ca.y - cb.y) / size * unit;
}

function findCombatantFor(combatants, { tokenId = null, actorId = null }) {
  if (tokenId) {
    const byToken = combatants.find(c => c?.tokenId === tokenId);
    if (byToken) return byToken;
  }
  if (!actorId) return null;
  return combatants.find(c => c?.actorId === actorId || c?.actor?.id === actorId) || null;
}

/**
 * The other combatants on `actor`'s side of `combat` that are not defeated, with their actors and tokens. The side
 * comes from `actor`'s own combatant (found by token id, else actor id) or, when it has none, from its token.
 * @param {object} actor
 * @param {object|null} combat
 * @param {object} [opts]
 * @param {string|null} [opts.tokenId] `actor`'s token id (unlinked tokens share an actor id)
 * @param {object|null} [opts.combatant] `actor`'s combatant when the caller already has it
 * @param {object[]} [opts.excludeCombatants] combatants never returned (an attacker)
 * @param {string[]} [opts.excludeActorIds] actor ids never returned (an attacker with no combatant)
 * @returns {Array<{ combatant: object, actor: object, token: object|null }>}
 */
export function sameSideCombatants(actor, combat, { tokenId = null, combatant = null, excludeCombatants = [], excludeActorIds = [] } = {}) {
  const combatants = toArray(combat?.combatants);
  if (!actor || !combatants.length) return [];
  const own = combatant ?? findCombatantFor(combatants, { tokenId, actorId: actor.id });
  const ownTok = own ? null : findActorToken(actor, { tokenId });
  const side = own
    ? isMobSide({ actor: own.actor || actor, token: own.token })
    : isMobSide({ actor, token: ownTok?.document });
  const out = [];
  for (const c of combatants) {
    if (!c || c.defeated || c === own || excludeCombatants.includes(c)) continue;
    if (!own && c.actorId === actor.id) continue;
    if (excludeActorIds.includes(c.actorId)) continue;
    const ally = resolveActorByUuid(c.actorUuid || c.actorId) || c.actor || lookupActor(c.actorId);
    if (!ally) continue;
    if (isMobSide({ actor: ally, token: c.token }) !== side) continue;
    out.push({ combatant: c, actor: ally, token: findActorToken(ally, { combatant: c }) });
  }
  return out;
}

/**
 * The assist offers on a check card (E7.9 D4): every after-roll assist (a `moment: 'check'` trigger, a valid
 * `assist.formula`, an `assist.when` that matches the effective check) owned by the roller's allies in the combat
 * and in range of the roller's token. Only while the card belongs to the combat's current round, and only when the
 * roller is one of its combatants. An ally with no Action left is still offered (`noActions`; CONTRIBUTING rule 2).
 * Who may click is the caller's concern (the render keeps the offers this user owns).
 * @param {{ record: object|null, eff?: object|null, combat: object|null }} p
 * @returns {Array<{ actor: object, actorUuid: string, actorName: string, combatantId: string, itemId: string, skillName: string, formula: string, isFree: boolean, highlight: boolean, noActions: boolean, actionsSpent: number|null, actionsMax: number|null }>}
 */
export function collectCheckAssistOffers({ record, eff = null, combat = null } = {}) {
  if (!record || !combat?.id || record.combatId !== combat.id || record.round !== Number(combat.round)) return [];
  const roller = resolveActorByUuid(record.rollerUuid);
  const combatants = toArray(combat.combatants);
  const rollerCbt = roller ? findCombatantFor(combatants, { tokenId: record.rollerTokenId, actorId: roller.id }) : null;
  if (!rollerCbt) return [];
  const effective = eff ?? effectiveCheck(record);
  if (!effective) return [];
  const rollerTok = findActorToken(roller, { tokenId: record.rollerTokenId, combatant: rollerCbt });
  const offers = [];
  for (const { combatant: c, actor: ally, token: allyTok } of sameSideCombatants(roller, combat, { combatant: rollerCbt })) {
    const interrupts = typeof ally.getAvailableInterrupts === 'function' ? ally.getAvailableInterrupts() : [];
    for (const int of interrupts) {
      if (!int?.item || !isOfferedOnCheck(int.triggers ?? [])) continue;
      const spec = getAssistSpec(int.item);
      if (!spec.valid || spec.moment !== 'check') continue;
      const match = assistOfferMatches(spec.when, effective);
      if (!match.show) continue;
      if (int.range && !int.range.unlimited) {
        const d = measureTokenFeet(allyTok, rollerTok);
        if (d !== null && d > int.range.reach) continue;
      }
      const actions = typeof combat.getCombatantActions === 'function' ? combat.getCombatantActions(c) : null;
      const spent = Number.isFinite(actions?.spent) ? actions.spent : null;
      const max = Number.isFinite(actions?.max) ? actions.max : null;
      const isFree = Boolean(int.isFree);
      offers.push({
        actor: ally,
        actorUuid: ally.uuid,
        actorName: ally.name,
        combatantId: c.id || '',
        itemId: int.itemId || int.item.id || '',
        skillName: int.name || int.item.name || '',
        formula: spec.formula,
        isFree,
        highlight: match.highlight,
        noActions: !isFree && spent !== null && max !== null && spent >= max,
        actionsSpent: spent,
        actionsMax: max
      });
    }
  }
  return offers;
}

/** A token's centre at a top-left pixel position (grid squares wide from the document), as `measureTokenFeet` reads it. */
function centreAt(tokenDoc, pos) {
  const size = Number(globalThis.canvas?.grid?.size) || 50;
  const span = (Number(tokenDoc?.width) || 1) * size;
  return { center: { x: Number(pos?.x) + span / 2, y: Number(pos?.y) + span / 2 } };
}

/**
 * The offers a foe's move earns: every opposite-side combatant in the combat holding an interrupt with a
 * `move` trigger, offered `leave` when the mover was within its reach before and is not now (Attack of Opportunity)
 * and `enter` when it was not and is now (Zone of Control). Reach is the interrupt's own range (touch = one square;
 * an unlimited range counts as touch, since "leaving reach" needs a reach). Only the before and after positions
 * count, not the path. An interrupter with no Action left is still offered (`canUse: false`; the click asks for a Rule Break).
 * @param {{ moverToken: object, origin: {x:number,y:number}, destination?: {x:number,y:number}, combat: object|null }} p
 *   moverToken is a token document; `destination` is its top-left after the move (the placeable still holds the origin
 *   when an animated move starts), falling back to the placeable's centre
 * @returns {Array<{ actor: object, actorUuid: string, combatantId: string, interrupt: object, event: string, moverName: string, moverTokenId: string, moverUuid: string }>}
 */
export function collectMoveInterruptOffers({ moverToken, origin, destination = null, combat = null } = {}) {
  const combatants = toArray(combat?.combatants);
  const moverActor = moverToken?.actor;
  if (!moverToken || !moverActor || !origin || !combatants.length) return [];
  const moverCbt = findCombatantFor(combatants, { tokenId: moverToken.id, actorId: moverActor.id });
  if (!moverCbt || moverCbt.defeated) return [];
  const after = destination
    ? centreAt(moverToken, destination)
    : (moverToken.object ?? findActorToken(moverActor, { tokenId: moverToken.id }));
  if (!after?.center) return [];
  const before = centreAt(moverToken, origin);
  const moverSide = isMobSide({ actor: moverActor, token: moverToken });
  const offers = [];
  for (const c of combatants) {
    if (!c || c.defeated || c === moverCbt) continue;
    const holder = resolveActorByUuid(c.actorUuid || c.actorId) || c.actor || lookupActor(c.actorId);
    if (!holder || isMobSide({ actor: holder, token: c.token }) === moverSide) continue;
    const holderTok = findActorToken(holder, { combatant: c });
    if (!holderTok) continue;
    const interrupts = typeof holder.getAvailableInterrupts === 'function' ? holder.getAvailableInterrupts() : [];
    const dBefore = measureTokenFeet(holderTok, before);
    const dAfter = measureTokenFeet(holderTok, after);
    if (dBefore === null || dAfter === null) continue;
    for (const int of interrupts) {
      if (!int?.item) continue;
      const reach = int.range?.reach ?? TOUCH_REACH_FEET;
      const wasIn = dBefore <= reach + 1e-6;
      const isIn = dAfter <= reach + 1e-6;
      const event = wasIn && !isIn ? MOVE_EVENTS.leave : (!wasIn && isIn ? MOVE_EVENTS.enter : null);
      if (!event || !isOfferedOnMove(int.triggers ?? [], { event })) continue;
      offers.push({
        actor: holder, actorUuid: holder.uuid, actorName: holder.name, combatantId: c.id || '', interrupt: int, event,
        moverName: moverActor.name, moverTokenId: moverToken.id, moverUuid: moverToken.uuid || ''
      });
    }
  }
  return offers;
}

/**
 * All interrupt offers for an attack.
 * @param {object} p
 * @param {Actor} p.attacker
 * @param {Array} p.targetResults rows from _resolveAttackTargets (actor, actorId, actorName, tokenId?, isHit)
 * @param {Combat|null} p.combat
 * @param {Item|null} p.sourceItem
 * @returns {Array<object>}
 */
export function collectInterruptOffers({ attacker, targetResults, combat = null, sourceItem = null }) {
  const offers = [];
  const srcTags = sourceItem ? getTagsOf(sourceItem) : new Set();
  const isArea = isAreaTagSet(srcTags);
  const noRedirect = hasRuleFlag(srcTags, RULE_FLAGS.noRedirect);
  const attackFilter = (int) => !(int.notVsArea && isArea) && !(int.interceptMode && noRedirect);

  const combatants = toArray(combat?.combatants);
  const attackerCbt = combatants.length
    ? findCombatantFor(combatants, { tokenId: attacker?.token?.id ?? null, actorId: attacker?.id })
    : null;

  for (const tr of targetResults || []) {
    const defender = tr.actor || lookupActor(tr.actorId);
    if (!defender) continue;
    const defCbt = combatants.length
      ? findCombatantFor(combatants, { tokenId: tr.tokenId ?? null, actorId: defender.id })
      : null;

    const base = {
      defender,
      defenderId: defender.id,
      defenderName: defender.name,
      defenderTokenId: tr.tokenId ?? null
    };
    const makeOffer = (role, actor, combatantId, int) => ({
      ...base,
      actor,
      actorId: actor.id,
      actorUuid: actor.uuid,
      actorName: actor.name,
      combatantId: combatantId || '',
      interrupt: int,
      role,
      interceptMode: int.interceptMode || null
    });

    // Target role: the attacked actor's own interrupts
    const defInterrupts = typeof defender.getAvailableInterrupts === 'function' ? defender.getAvailableInterrupts() : [];
    for (const int of defInterrupts) {
      if (int.canUse === false) continue;
      if (!isOfferedOnAttack(int.triggers, { role: OFFER_ROLES.TARGET, isHit: tr.isHit })) continue;
      if (!attackFilter(int)) continue;
      offers.push(makeOffer(OFFER_ROLES.TARGET, defender, defCbt?.id, int));
    }

    if (!combatants.length) continue;

    const defTok = findActorToken(defender, { tokenId: tr.tokenId, combatant: defCbt });
    const atkTok = attacker ? findActorToken(attacker, { combatant: attackerCbt }) : null;
    const allies = sameSideCombatants(defender, combat, {
      tokenId: tr.tokenId ?? null,
      combatant: defCbt,
      excludeCombatants: attackerCbt ? [attackerCbt] : [],
      excludeActorIds: !attackerCbt && attacker ? [attacker.id] : []
    });

    for (const { combatant: c, actor: ally, token: allyTok } of allies) {
      const allyInterrupts = typeof ally.getAvailableInterrupts === 'function' ? ally.getAvailableInterrupts() : [];
      for (const int of allyInterrupts) {
        if (int.canUse === false) continue;
        if (!isOfferedOnAttack(int.triggers, { role: OFFER_ROLES.ALLY, isHit: tr.isHit })) continue;
        if (!attackFilter(int)) continue;
        if (int.range && !int.range.unlimited) {
          const origin = int.range.from === 'attacker' ? atkTok : defTok;
          const d = measureTokenFeet(allyTok, origin);
          if (d !== null && d > int.range.reach) continue;
        }
        offers.push(makeOffer(OFFER_ROLES.ALLY, ally, c.id, int));
      }
    }
  }
  return offers;
}

/**
 * Resolve what a used interrupt does to the attack that triggered it.
 * @param {{ interrupter: Actor, interrupt: object, attackContext?: object|null }} p
 * @returns {null | { mode: string, fromActorId: string, fromName: string, toActorId: string, toName: string, attackTotal: number, targetDC: number|null, isHit: boolean, outcome: string }}
 */
export function resolveInterception({ interrupter, interrupt, attackContext = null }) {
  if (!attackContext || !interrupt?.interceptMode || !interrupter) return null;
  const mode = interrupt.interceptMode;
  const attackTotal = Number(attackContext.attackTotal);
  // What the interrupt does to this one attack (Catcher): looked up again, by attack message and interrupter, when the damage
  // card is applied to the interrupter (`findInterceptionFor`).
  const drBonus = Math.min(MAX_DR_BONUS, Math.max(0, Math.floor(Number(interrupt.drBonus) || 0)));
  const base = {
    mode,
    name: typeof interrupt.name === 'string' ? interrupt.name : '',
    attackMessageId: typeof attackContext.attackMessageId === 'string' && attackContext.attackMessageId ? attackContext.attackMessageId : null,
    ...(drBonus > 0 ? { drBonus } : {}),
    ...(interrupt.ignoreDebuffs === true ? { ignoreDebuffs: true } : {}),
    fromActorId: attackContext.defenderId,
    fromName: attackContext.defenderName,
    toActorId: interrupter.id,
    toActorUuid: interrupter.uuid,
    toName: interrupter.name,
    attackTotal
  };
  // A mob's attack hits automatically (3.18): the interrupter becomes its target against the mob's fixed Evade DC and may
  // Evade it like the defender could have; nothing is re-rolled.
  if (attackContext.isAutoHit === true) {
    const dc = Number(attackContext.targetDC ?? attackContext.attackTotal);
    return {
      ...base,
      targetDC: mode === 'redirect' && Number.isFinite(dc) ? dc : null,
      isHit: true,
      outcome: 'Auto-Hit',
      isAutoHit: true,
      isArea: attackContext.isArea === true,
      floor: Number(attackContext.floor) || null,
      attackerName: typeof attackContext.attackerName === 'string' ? attackContext.attackerName : '',
      ...(attackContext.ruleBreak === true ? { ruleBreak: true } : {})
    };
  }
  if (mode === 'redirect') {
    const floor = Number(attackContext.floor) || 0;
    const targetDC = typeof interrupter.getEvadeTargetDC === 'function'
      ? interrupter.getEvadeTargetDC(floor)
      : 10 + (interrupter.system?.abilities?.dex?.mod ?? 0) + floor;
    const { isHit, outcome } = classifyAttackOutcome(attackTotal, targetDC, attackContext.d20Face ?? null);
    return { ...base, targetDC, isHit, outcome, ...(attackContext.isArea === true ? { isArea: true } : {}) };
  }
  return { ...base, targetDC: null, isHit: true, outcome: 'Hit' };
}

/**
 * The plain-text effect of an interrupt on the one attack that triggered it ("+5 DR vs. this attack, ignores attached
 * debuffs"), from an interrupt entry (`getAvailableInterrupts`) or an interception record. '' when it has none.
 * @param {{ drBonus?: number, ignoreDebuffs?: boolean }|null} source
 * @returns {string}
 */
export function interruptEffectsText(source) {
  const dr = Math.max(0, Math.floor(Number(source?.drBonus) || 0));
  const parts = [];
  if (dr > 0) parts.push(`+${dr} DR vs. this attack`);
  if (source?.ignoreDebuffs === true) parts.push('ignores attached debuffs');
  return parts.join(', ');
}

/**
 * The latest trusted interception of an attack by one interrupter, read from the interrupt cards in the chat log. The
 * interrupter's damage application uses its `drBonus` / `ignoreDebuffs` for that attack only: a different attack message
 * has a different id, so nothing carries over to the next hit.
 * @param {Array<object>|{ contents: object[] }} messages oldest first
 * @param {{ attackMessageId: string, interrupterUuid: string, isTrusted?: (message: object, record: object) => boolean }} query
 * @returns {{ messageId: string|null, name: string, mode: string, interrupterUuid: string, attackMessageId: string, drBonus: number, ignoreDebuffs: boolean }|null}
 */
export function findInterceptionFor(messages, { attackMessageId, interrupterUuid, isTrusted = () => true } = {}) {
  if (typeof attackMessageId !== 'string' || !attackMessageId || typeof interrupterUuid !== 'string' || !interrupterUuid) return null;
  const list = toArray(messages);
  for (let i = list.length - 1, scanned = 0; i >= 0 && scanned < MAX_EVADE_SCAN; i--, scanned++) {
    const message = list[i];
    if (message?.id === attackMessageId) break;
    const flags = message?.flags?.[SYSTEM_ID];
    const rec = flags?.isInterrupt === true ? flags.interception : null;
    if (!rec || rec.attackMessageId !== attackMessageId || rec.toActorUuid !== interrupterUuid) continue;
    const record = {
      messageId: message.id ?? null,
      name: typeof rec.name === 'string' ? rec.name : '',
      mode: typeof rec.mode === 'string' ? rec.mode : '',
      interrupterUuid,
      attackMessageId,
      drBonus: Math.min(MAX_DR_BONUS, Math.max(0, Math.floor(Number(rec.drBonus) || 0))),
      ignoreDebuffs: rec.ignoreDebuffs === true
    };
    if (!isTrusted(message, record)) continue;
    return record;
  }
  return null;
}

/** HTML block for the interrupt card: what happened to the attack plus a retarget button. */
export function renderInterceptionHtml(interception, { interrupterUuid = '', interrupterTokenId = '' } = {}) {
  if (!interception) return '';
  const from = escapeAttr(interception.fromName);
  const to = escapeAttr(interception.toName);
  let summary;
  let evadeButton = '';
  if (interception.isAutoHit) {
    const key = interception.mode === 'redirect' ? 'COG.MobAttack.Redirected' : 'COG.MobAttack.Intercepted';
    summary = escapeAttr(mobAttackText(key, { from: interception.fromName, to: interception.toName, dc: interception.targetDC }));
    // The taunter answers the auto-hit with their own Evade, linked to the original attack message (evade-link.mjs).
    if (interception.mode === 'redirect' && interception.attackMessageId && Number.isFinite(interception.targetDC)) {
      evadeButton = `<button type="button" class="cog-evade-roll-btn cog-bg-info-fill cog-text-on-fill" data-action="crawlerRollEvade"`
        + ` data-evader-uuid="${escapeAttr(interrupterUuid || interception.toActorUuid)}" data-attack-message-id="${escapeAttr(interception.attackMessageId)}"`
        + ` data-attacker-name="${escapeAttr(interception.attackerName ?? '')}" data-target-dc="${escapeAttr(interception.targetDC)}"`
        + ` data-attack-total="${escapeAttr(interception.targetDC)}" data-floor="${escapeAttr(interception.floor ?? '')}"${interception.isArea ? ' data-is-area="true"' : ''}`
        + ` style="margin-top: 4px; margin-left: 4px; cursor: pointer;">${escapeAttr(mobAttackText('COG.MobAttack.RollEvadeFor', { name: interception.toName, dc: interception.targetDC }))}</button>`;
    }
  } else if (interception.mode === 'redirect') {
    const verdict = interception.isHit ? 'HIT' : 'MISS';
    summary = `<strong>REDIRECTED:</strong> ${from} &rarr; ${to}. ${verdict} (${interception.attackTotal} vs DC ${interception.targetDC}, ${escapeAttr(interception.outcome)})`;
  } else {
    summary = `<strong>INTERCEPTED:</strong> ${to} takes the hit meant for ${from}.`;
  }
  const effects = interruptEffectsText(interception);
  if (effects) summary += ` <em>${escapeAttr(effects)}</em>`;
  return `
    <div class="cog-interception-result cog-text cog-bg-surface" style="font-size: 11px; border: 1px solid var(--cog-warning); border-radius: 3px; padding: 5px 7px; margin-top: 6px;">
      <div>${summary}</div>
      <button type="button" class="cog-retarget-interrupt-btn" data-action="crawlerRetargetInterrupter" data-actor-uuid="${escapeAttr(interrupterUuid || interception.toActorUuid)}" data-token-id="${escapeAttr(interrupterTokenId)}" style="margin-top: 4px; cursor: pointer;">Target ${to}</button>${evadeButton}
    </div>
  `;
}
