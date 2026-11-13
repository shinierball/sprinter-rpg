/**
 * The Dying, Stabilised and Death chat cards. Public: the table is meant to see a crawler near death. The cards carry
 * no buttons; the countdown is edited on the debuff and a death is undone by deleting the Dead debuff.
 */
import { escapeAttr } from '../../utils/escape-attr.mjs';

/** English defaults, identical to the `COG.Dying` entries in lang/en.json (Foundry's i18n wins when it has the key). */
const DYING_CARD_TEXT = Object.freeze({
  'COG.Dying.Badge': '[DYING]',
  'COG.Dying.BadgeRounds': '[DYING {rounds}]',
  'COG.Dying.Title': '{actor} is Dying: {rounds} rounds left.',
  'COG.Dying.Hint': 'One Health Bar slot of healing ends it. Each round\'s end, and each hit that takes a slot, costs 1 round.',
  'COG.Dying.StabilisedBadge': '[STABILISED]',
  'COG.Dying.Stabilised': '{actor} is no longer Dying.',
  'COG.Dying.DeadBadge': '[DEAD]',
  'COG.Dying.Died': '{actor} has died.',
  'COG.Dying.Dead': '{actor} is dead.',
  'COG.Dying.CauseCountdown': 'The countdown ran out.',
  'COG.Dying.CauseHit': 'A hit ran the countdown out.',
  'COG.Dying.CauseClock': 'The clock ran the countdown out.',
  'COG.Dying.KillByHand': 'The hit that downed them is no longer on record: the GM awards the kill by hand.'
});

const CAUSE_KEYS = Object.freeze({ countdown: 'COG.Dying.CauseCountdown', hit: 'COG.Dying.CauseHit', clock: 'COG.Dying.CauseClock' });

/** Localized text with the English default for a client that has not loaded the language file. */
export function dyingCardText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return String(DYING_CARD_TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

const card = (kind, badge, lines) => `<div class="cog-chat-card cog-dying-card" data-dying-card="${kind}"><header class="cog-card-header"><span class="cog-badge">${escapeAttr(badge)}</span></header><div class="cog-card-body">${lines.map((l) => `<p>${escapeAttr(l)}</p>`).join('')}</div></div>`;

async function post(actor, content) {
  const ChatMessage = globalThis.ChatMessage;
  if (typeof ChatMessage?.create !== 'function') return null;
  try {
    return (await ChatMessage.create({ speaker: ChatMessage.getSpeaker?.({ actor }), content })) ?? null;
  } catch (err) {
    console.warn('Sprinter RPG | Could not post the Dying card:', err);
    return null;
  }
}

/** The actor went Dying with `rounds` on the countdown. */
export function postDyingCard(actor, { rounds }) {
  return post(actor, card('dying', dyingCardText('COG.Dying.Badge'), [dyingCardText('COG.Dying.Title', { actor: actor.name, rounds }), dyingCardText('COG.Dying.Hint')]));
}

/** Healing ended Dying. */
export function postStabilisedCard(actor) {
  return post(actor, card('stabilised', dyingCardText('COG.Dying.StabilisedBadge'), [dyingCardText('COG.Dying.Stabilised', { actor: actor.name })]));
}

/** The actor died; an instant death (a mob or pet at 0%) is one plain line with no cause. `killByHand`: the kill could not be credited. */
export function postDeathCard(actor, { cause, killByHand = false }) {
  const key = CAUSE_KEYS[cause];
  if (!key) return post(actor, `<div class="cog-chat-card cog-dying-card" data-dying-card="dead"><p>${escapeAttr(dyingCardText('COG.Dying.Dead', { actor: actor.name }))}</p></div>`);
  return post(actor, card('dead', dyingCardText('COG.Dying.DeadBadge'), [dyingCardText('COG.Dying.Died', { actor: actor.name }), dyingCardText(key), ...(killByHand ? [dyingCardText('COG.Dying.KillByHand')] : [])]));
}
