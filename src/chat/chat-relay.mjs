/**
 * Chat-card apply relay: lets a card button (damage, healing, buff, cure, grant...) be performed by the
 * active GM on the clicking player's behalf. Policy (option b):
 * only the GM applies to actors a player does not own. A player's click skips every target they cannot
 * write, with a warning; targets they own still go through the GM where the applier asks for it (damage,
 * so HP, combat metrics and the session ledger are written on one client).
 *
 * Each in-scope chat action registers an applier with two parts:
 *   parse(button)                  pure; reads the button and its card's data-* attributes into plain params.
 *                                  Runs on the clicking client AND on the GM (on the GM's own copy of the card).
 *   apply(target, params, ctx)     performs the write(s) for one target and returns a plain result.
 *
 * The clicking client sends only { messageId, action, buttonIndex, buttonData, targetUuids }. The GM looks up
 * its own copy of the message, re-parses message.content, finds the button by action and index, requires the
 * button's data-* attributes to equal buttonData, and runs parse on its copy. No number from the payload is
 * ever used. The requester's identity comes from socketlib's envelope (gm-relay.mjs), never from the payload.
 *
 * Known limits:
 *  - Forged cards: a player can post a chat message with any HTML. Re-reading the message guards against a
 *    tampered payload and a card that changed after the click, not against a card the requester authored
 *    with made-up numbers. The GM refuses any request naming a target the requester does not own, so a
 *    forged card only reaches actors the requester owns. That card stays in the log for everyone to see.
 *  - Target choice is not verified: the GM cannot see the requester's targeting, so any resolvable actor the
 *    requester owns is accepted (and under targetPolicy 'button', only the button's own target).
 *  - Index alignment: buttonIndex assumes the rendered message-content holds the same in-scope data-action
 *    buttons, in the same order, as the stored content. A mismatch rejects the click, never misapplies it.
 *
 * This module must not import any src/chat/actions/* module (they import it).
 */
import { registerRelayAction, requestRelay } from '../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';

export const CHAT_APPLY_RELAY = 'chatCardApply';
export const MAX_RELAY_TARGETS = 50;

const appliers = new Map();

/**
 * @typedef {object} ChatApplier
 * @property {(button: Element) => (object|null)} parse
 * @property {(target: Actor, params: object, ctx: { requester: User|null, message: ChatMessage|object|undefined }) => Promise<object>} apply
 * @property {(target: Actor, params: object) => boolean} [canApplyLocally] default: canWriteTarget(target)
 * @property {'any'|'button'} [targetPolicy='any'] 'button': through the relay, the only accepted target is
 *   the button's own data-target-uuid.
 */

/**
 * Can this client write the actor directly? A GM or an owner. Real Foundry documents always carry a boolean
 * `isOwner`; a bare stand-in without that property is treated as writable so only an explicit
 * `isOwner: false` is sent through the GM.
 */
export function canWriteTarget(actor) {
  return Boolean(globalThis.game?.user?.isGM) || actor?.isOwner !== false;
}

/** Register an applier for a chat action name (a CHAT_ACTIONS key). */
export function registerChatApplier(action, applier) {
  if (typeof action !== 'string' || !action) throw new Error('Chat applier action must be a non-empty string.');
  if (!applier || typeof applier.parse !== 'function' || typeof applier.apply !== 'function') {
    throw new Error(`Chat applier "${action}" needs parse and apply functions.`);
  }
  appliers.set(action, applier);
}

export function getChatApplier(action) {
  return appliers.get(action) ?? null;
}

/** All data-* attributes of an element as a plain { camelKey: string } object. */
export function readDataAttributes(el) {
  const out = {};
  for (const [key, value] of Object.entries(el?.dataset ?? {})) out[key] = String(value);
  return out;
}

function actionButtons(scope, action) {
  return [...scope.querySelectorAll('[data-action]')].filter(el => el.dataset.action === action);
}

/** Index of `button` among elements with the same data-action inside its message, or -1. */
export function chatButtonIndex(button) {
  const scope = button.closest('.message-content') ?? button.closest('[data-message-id]') ?? button.ownerDocument;
  if (!scope) return -1;
  return actionButtons(scope, button.dataset.action).indexOf(button);
}

/** Parse stored message HTML into a document (browser DOMParser). */
export function parseMessageContent(html) {
  return new globalThis.DOMParser().parseFromString(`<!doctype html><html><body>${String(html ?? '')}</body></html>`, 'text/html');
}

/** Author user id of a ChatMessage (a User document, or the raw id in stored data). */
export function messageAuthorId(message) {
  return message?.author?.id ?? (typeof message?.author === 'string' ? message.author : null);
}

/** Whether a ChatMessage was written by a GM (a card only the GM can author: a contest card, an AI Favor tally). */
export function isGmAuthored(message) {
  if (message?.author?.isGM === true) return true;
  const id = messageAuthorId(message);
  return Boolean(id) && Boolean(globalThis.game?.users?.get?.(id)?.isGM);
}

/** Client side: the request the GM needs. Nothing else goes in it. */
export function buildChatRelayPayload(action, message, button, targetUuids) {
  return {
    messageId: message.id,
    action,
    buttonIndex: chatButtonIndex(button),
    buttonData: readDataAttributes(button),
    targetUuids
  };
}

function reject(reason) {
  console.warn(`Sprinter RPG | Chat relay rejected: ${reason}`);
  return null;
}

/**
 * GM side: rebuild the request from the GM's own copy of the message, or return null.
 * @returns {{ message, button, params, applier, targets: Actor[] } | null}
 */
export function resolveChatRelayRequest(payload) {
  if (!payload || typeof payload !== 'object') return reject('payload is not an object');
  const { messageId, action, buttonIndex, buttonData, targetUuids } = payload;
  if (typeof messageId !== 'string' || !messageId) return reject('missing message id');
  const applier = typeof action === 'string' ? getChatApplier(action) : null;
  if (!applier) return reject('unknown chat action');

  const message = globalThis.game?.messages?.get?.(messageId);
  if (!message) return reject('message not found');

  const doc = parseMessageContent(message.content);
  const candidates = actionButtons(doc, action);
  const button = Number.isInteger(buttonIndex) && buttonIndex >= 0 ? candidates[buttonIndex] : null;
  if (!button) return reject('button not found on the message');

  const mine = readDataAttributes(button);
  const theirs = buttonData && typeof buttonData === 'object' ? buttonData : null;
  const sameKeys = theirs && Object.keys(mine).length === Object.keys(theirs).length
    && Object.keys(mine).every(k => Object.hasOwn(theirs, k) && String(theirs[k]) === mine[k]);
  if (!sameKeys) return reject('button data does not match the message');

  const params = applier.parse(button);
  if (!params) return reject('button could not be parsed');

  if (!Array.isArray(targetUuids) || targetUuids.length < 1 || targetUuids.length > MAX_RELAY_TARGETS
    || !targetUuids.every(u => typeof u === 'string' && u)) {
    return reject('bad target list');
  }
  const targets = [];
  for (const uuid of targetUuids) {
    const target = resolveActorByUuid(uuid);
    if (!target) return reject('target does not resolve');
    targets.push(target);
  }
  if (applier.targetPolicy === 'button') {
    const own = button.dataset.targetUuid;
    if (!own || !targetUuids.every(u => u === own)) return reject('target is not the button target');
  }
  return { message, button, params, applier, targets };
}

registerRelayAction(CHAT_APPLY_RELAY, {
  authorize(payload, user) {
    // Who wrote or speaks the card doesn't matter: a player may apply any card (e.g. a monster's
    // damage) to actors they own, and never to actors they don't.
    const req = resolveChatRelayRequest(payload);
    if (!req || !user) return false;
    if (user.isGM) return true;
    return req.targets.every(t => Boolean(t.testUserPermission?.(user, 'OWNER')));
  },
  async apply(payload, user) {
    const req = resolveChatRelayRequest(payload);
    if (!req) throw new Error('Chat relay: request no longer resolves.');
    const results = [];
    for (const target of req.targets) {
      try {
        results.push(await req.applier.apply(target, req.params, { requester: user, message: req.message, targets: req.targets }));
      } catch (err) {
        console.error(`Sprinter RPG | Chat relay failed on ${target.name}:`, err);
        results.push({ targetUuid: target.uuid, targetName: target.name, error: true });
      }
    }
    return { results: JSON.parse(JSON.stringify(results)) };
  }
});

function warn(message) {
  globalThis.ui?.notifications?.warn?.(message);
}

/**
 * Client side: apply the effect to each target, locally where possible, through the GM otherwise.
 * @returns {Promise<{ results: object[], failed: Array<{ targetUuid: string, targetName: string }> }>}
 *   results (successes only) in the original target order; failures are listed in `failed`.
 */
export async function applyCardEffect(action, { message, button, params, targets }) {
  const applier = getChatApplier(action);
  if (!applier) throw new Error(`No chat applier registered for "${action}".`);
  const canLocal = applier.canApplyLocally ?? ((t) => canWriteTarget(t));
  const me = globalThis.game?.user ?? null;

  const outcome = new Map();
  const failedTargets = [];
  // Partition first: the local batch is known before any apply, and every call of it gets the same `targets` array (E3.5).
  const local = [];
  const remote = [];
  for (const t of targets) {
    if (!t.uuid || canLocal(t, params)) {
      local.push(t);
    } else if (canWriteTarget(t)) {
      remote.push(t);
    } else {
      warn(`Only the GM can apply this to ${t.name}.`);
      failedTargets.push(t);
    }
  }
  for (const t of local) {
    try {
      outcome.set(t, await applier.apply(t, params, { requester: me, message, targets: local }));
    } catch (err) {
      console.error(`Sprinter RPG | Chat apply failed on ${t.name}:`, err);
      failedTargets.push(t);
    }
  }

  const names = (list) => list.map(t => t.name).join(', ');
  if (remote.length) {
    if (!message?.id) {
      warn(`Sprinter RPG | This card can't be sent to the GM; you can't change ${names(remote)}.`);
      failedTargets.push(...remote);
    } else {
      const res = await requestRelay(
        CHAT_APPLY_RELAY,
        buildChatRelayPayload(action, message, button, remote.map(t => t.uuid)),
        { direct: false }
      );
      const byUuid = new Map();
      if (res.ok) for (const r of res.result?.results ?? []) byUuid.set(r.targetUuid, r);
      const missed = [];
      for (const t of remote) {
        const r = byUuid.get(t.uuid);
        if (r && !r.error) outcome.set(t, r);
        else missed.push(t);
      }
      failedTargets.push(...missed);
      if (missed.length && (res.ok || res.reason === 'rejected' || res.reason === 'error')) {
        warn(`Sprinter RPG | The GM did not apply this to ${names(missed)}.`);
      }
    }
  }

  return {
    results: targets.filter(t => outcome.has(t)).map(t => outcome.get(t)),
    failed: targets.filter(t => failedTargets.includes(t)).map(t => ({ targetUuid: t.uuid, targetName: t.name }))
  };
}
