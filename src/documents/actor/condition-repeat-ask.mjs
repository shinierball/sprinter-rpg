/**
 * The GM's ruling when a further injury of a grade lands on an actor that already carries its Long-Term form. The rulebook
 * is silent past the second injury, so this is a ruling, not a Rule Break: the world's `ruleBreakMode` does not answer it.
 * A GM's client opens the dialog; any other client asks the active GM through the relay and waits for the answer.
 */
import { registerRelayAction, requestRelay, isNoGmReason } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { REPEAT_RULINGS } from './condition-repeat.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

/** Relay action: ask a GM what a further injury does. Payload: ids and plain text only. */
const REPEAT_RULING_RELAY = 'conditionRepeatRuling';

const KEY = 'COG.Effects.RepeatRuling.';

function text(name, data, fallback) {
  const i18n = globalThis.game?.i18n;
  return i18n?.has?.(`${KEY}${name}`) && typeof i18n.format === 'function' ? i18n.format(`${KEY}${name}`, data) : fallback;
}


function notify(level, message) {
  globalThis.ui?.notifications?.[level]?.(message);
}

/** The ruling dialog, on this client. Resolves to a `REPEAT_RULINGS` value, or null for Cancel or a closed window. */
async function askOnThisClient(actorName, existingName, incomingName) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.wait !== 'function') return null;
  // The title and button labels are plain text in Foundry; only the message is HTML, so only it takes escaped names.
  const data = { actor: actorName, existing: existingName, incoming: incomingName };
  const html = { actor: escapeAttr(actorName), existing: escapeAttr(existingName), incoming: escapeAttr(incomingName) };
  const answer = await DialogV2.wait({
    window: { title: text('Title', data, 'Another injury') },
    content: `<p>${text('Message', html, `${html.actor} already has ${html.existing}. ${html.incoming} would land again. What happens?`)}</p>`,
    buttons: [
      { action: REPEAT_RULINGS.NONE, label: text('None', data, 'Nothing more'), default: true },
      { action: REPEAT_RULINGS.BESIDE, label: text('Beside', data, `Add ${data.incoming}`) },
      { action: 'cancel', label: text('Cancel', data, 'Cancel') }
    ],
    rejectClose: false
  });
  return Object.values(REPEAT_RULINGS).includes(answer) ? answer : null;
}

registerRelayAction(REPEAT_RULING_RELAY, {
  authorize(payload, user) {
    const actor = resolveActorByUuid(payload?.actorUuid);
    return Boolean(actor?.testUserPermission?.(user, 'OWNER'));
  },
  async apply(payload) {
    const actor = resolveActorByUuid(payload?.actorUuid);
    const existing = actor ? actor.items.get(payload?.existingId) : null;
    if (!actor || !existing) return null;
    return askOnThisClient(actor.name, existing.name, String(payload?.incomingName ?? ''));
  }
});

/**
 * The ruling for an `ask` verdict.
 * @param {object} actor the bearer
 * @param {{ existing: object, incoming: object, options?: object }} ctx `existing` is the Long-Term debuff, `incoming` the
 *   plain one's item data; `options.repeatRuling` answers in advance, `options.interactive === false` means nobody to ask
 * @returns {Promise<'none'|'beside'|null>} null: cancelled, no GM could be asked, or nobody to ask (nothing is applied)
 */
export async function askRepeatRuling(actor, { existing, incoming, options = {} }) {
  const given = options?.repeatRuling;
  if (Object.values(REPEAT_RULINGS).includes(given)) return given;
  if (options?.interactive === false) return null;
  if (!globalThis.game?.user?.isGM) notify('info', text('Asking', { actor: actor.name }, `Asking the GM about ${actor.name}'s injury...`));
  const res = await requestRelay(REPEAT_RULING_RELAY, { actorUuid: actor.uuid, existingId: existing.id, incomingName: incoming?.name ?? '' });
  if (res.ok) return Object.values(REPEAT_RULINGS).includes(res.result) ? res.result : null;
  if (!isNoGmReason(res.reason)) notify('warn', text('NotAsked', { actor: actor.name }, `The GM could not be asked about ${actor.name}'s injury. Nothing was applied.`));
  return null;
}
