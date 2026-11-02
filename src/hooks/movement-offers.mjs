/**
 * Movement offers: when a foe's token moves in combat, the active GM offers the interrupts it triggers.
 * A foe leaving a holder's reach offers `trigger.on_foe_leave_reach` (Attack of Opportunity); a foe entering it offers
 * `trigger.on_foe_enter_reach` (Zone of Control). One whispered card per mover per move; the buttons are the same
 * "Trigger Interrupt" buttons as the attack cards, so accepting spends the holder's Action (or asks for a Rule Break).
 * Offers only, never blocks (CONTRIBUTING rule 2). The book's exceptions (the foe used its Step; once per round) are text
 * on the card, because movement data cannot tell a Step from a Move: the GM adjudicates.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { isActiveGM } from '../utils/gm-relay.mjs';
import { positionAfterMovement } from '../utils/movement-position.mjs';
import { isMarkerActor } from '../utils/marker.mjs';
import { collectMoveInterruptOffers, escapeAttr, interruptEffectsText } from '../utils/interrupts.mjs';
import { MOVE_EVENTS } from '../utils/tag-mechanics.mjs';

/** Moves for one scene inside this window share one evaluation (a drag fires many). Tests may lower it. */
export const movementOffersConfig = { debounceMs: 75 };

/** Scene id -> { movers: Map(tokenId -> { tokenDoc, origin }), promise }. The first origin of a window is kept. */
const pending = new Map();

const EVENT_TEXT = Object.freeze({
  [MOVE_EVENTS.leave]: { title: 'moved out of reach', note: 'Not offered if the foe used its Step.' },
  [MOVE_EVENTS.enter]: { title: 'moved into reach', note: 'Once per round.' }
});

function userIdsFor(actors) {
  const users = Array.from(globalThis.game?.users?.contents ?? globalThis.game?.users ?? []);
  return users.filter(u => u?.isGM || actors.some(a => a?.testUserPermission?.(u, 'OWNER'))).map(u => u.id);
}

/** The card for one mover's offers. */
export function movementOfferHtml(offers) {
  const mover = offers[0];
  const lines = [...new Set(offers.map(o => o.event))].map(e => `${EVENT_TEXT[e].title} (${EVENT_TEXT[e].note})`).join('; ');
  const buttons = offers.map(o => {
    const int = o.interrupt;
    const effects = interruptEffectsText(int);
    const detail = [int.costDesc ? `(${int.costDesc})` : '', effects ? `(${effects})` : ''].filter(Boolean).join(' ');
    const unusable = int.canUse === false;
    return `
        <button type="button" class="cog-trigger-interrupt-btn cog-dark cog-bg-header-fill cog-text-on-fill" data-action="crawlerTriggerInterrupt"
          data-actor-uuid="${escapeAttr(o.actorUuid)}"
          data-combatant-id="${escapeAttr(o.combatantId)}"
          data-interrupt-id="${escapeAttr(int.id)}"
          data-target-name="${escapeAttr(o.moverName)}"
          data-can-use="${unusable ? 'false' : 'true'}"
          data-reason="${escapeAttr(int.reasonCannotUse || '')}"
          data-role="foe"
          style="width: 100%; margin-top: 4px; padding: 5px 8px; font-size: 11px; cursor: pointer; border: 1px solid var(--cog-warning); border-radius: 3px; display: flex; align-items: center; justify-content: space-between; gap: 6px; font-weight: bold; font-family: var(--font-primary, 'Oswald', sans-serif); text-transform: uppercase;">
          <span><i class="${escapeAttr(int.icon || 'fa-solid fa-bolt')}"></i> ${escapeAttr(`${o.actorName}: ${int.name}`)}</span>
          <span style="font-size: 10px; white-space: nowrap;">${escapeAttr(detail)}</span>
        </button>`;
  }).join('');
  return `
      <div class="cog-interrupt-prompts-container cog-bg-warning-tint" style="margin-top: 8px; padding: 6px 8px; border: 1.5px solid var(--cog-warning); border-radius: 4px; font-family: var(--font-primary, 'Oswald', sans-serif);">
        <div class="cog-text-warning" style="font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">
          <i class="fa-solid fa-bolt"></i> Interrupt Opportunities
        </div>
        <div class="cog-text" style="font-size: 11px; margin-top: 2px;"><strong>${escapeAttr(mover.moverName)}</strong> ${escapeAttr(lines)}</div>
        ${buttons}
      </div>`;
}

/** Post the card for one moved token (nothing when it earned no offers). */
async function offerForMover({ tokenDoc, origin, destination }) {
  const combat = globalThis.game?.combat ?? null;
  if (!combat || (combat.scene?.id && tokenDoc.parent?.id && combat.scene.id !== tokenDoc.parent.id)) return null;
  const offers = collectMoveInterruptOffers({ moverToken: tokenDoc, origin, destination, combat });
  if (!offers.length || !globalThis.ChatMessage?.create) return null;
  return globalThis.ChatMessage.create({
    speaker: { alias: tokenDoc.actor?.name ?? 'Movement' },
    whisper: userIdsFor(offers.map(o => o.actor)),
    content: movementOfferHtml(offers),
    flags: { [SYSTEM_ID]: { movementOffer: { moverUuid: tokenDoc.uuid ?? '', events: [...new Set(offers.map(o => o.event))] } } }
  });
}

/**
 * Queue a movement evaluation for the token's scene; moves inside the window coalesce (one offer per mover, measured
 * from where it first stood to where it ended). The returned promise settles when the evaluation is done.
 * @param {TokenDocument} tokenDoc
 * @param {{ origin?: {x:number,y:number} }|null} movement
 * @returns {Promise<void>}
 */
export function queueMovementOffers(tokenDoc, movement) {
  const actor = tokenDoc?.actor;
  const origin = movement?.origin;
  if (!isActiveGM() || !actor || isMarkerActor(actor) || !globalThis.game?.combat || !origin) return Promise.resolve();
  const scene = tokenDoc.parent ?? globalThis.canvas?.scene;
  const key = scene?.id ?? '';
  let entry = pending.get(key);
  if (!entry) {
    entry = { movers: new Map() };
    entry.promise = new Promise(resolve => {
      setTimeout(async () => {
        pending.delete(key);
        try {
          if (isActiveGM()) for (const mover of entry.movers.values()) await offerForMover(mover);
        } catch (err) { console.error('sprinter-rpg | movement offers failed', err); }
        resolve();
      }, movementOffersConfig.debounceMs);
    });
    pending.set(key, entry);
  }
  const destination = positionAfterMovement(tokenDoc, movement);
  const mover = entry.movers.get(tokenDoc.id);
  if (mover) mover.destination = destination;
  else entry.movers.set(tokenDoc.id, { tokenDoc, origin: { x: origin.x, y: origin.y }, destination });
  return entry.promise;
}

export function onMovementOffersTokenMove(tokenDoc, movement) { return queueMovementOffers(tokenDoc, movement); }

export function registerMovementOffersHooks() {
  Hooks.on('moveToken', onMovementOffersTokenMove);
}
