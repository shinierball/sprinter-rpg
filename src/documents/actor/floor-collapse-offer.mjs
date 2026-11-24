/**
 * The book's time to collapse, offered when the floor goes up: one whispered GM card with a line and a GM-only button that
 * sets the floor clock to that time. Taking or ignoring it is never a Rule Break (the time is the GM's call, core p. 63).
 * This module imports nothing from `actor-environment.mjs` (which imports it); the chat action imports both.
 */
import { bookCollapseDays, bookCollapseHours } from '../../utils/floor/collapse-time.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { flagPath, readFlag, withFlags } from '../../utils/flags.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { gmWhisper } from '../../utils/owner-recipients.mjs';

/** The flag on the card: `{ floor, days, hours, applied }`. */
const COLLAPSE_OFFER_FLAG = 'floorCollapseOffer';
/** The chat action of the card's button. */
const COLLAPSE_OFFER_ACTION = 'crawlerFloorCollapseOffer';

const TEXT = Object.freeze({
  'COG.FloorCollapse.Title': 'Floor change: time to collapse',
  'COG.FloorCollapse.Line': "Floor {floor}: the book's time to collapse is {days} days ({hours} hours). The clock reads {current} hours.",
  'COG.FloorCollapse.Button': 'Set the clock to {hours} hours',
  'COG.FloorCollapse.Applied': '[APPLIED]',
  'COG.FloorCollapse.GmOnly': 'Only the GM can set the floor clock.'
});

export const collapseOfferText = langText(TEXT);

const isFinitePositive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * The card's state `{ floor, days, hours, applied }`, or null when the message carries no usable offer.
 * @param {object} message
 */
export function readCollapseOffer(message) {
  const offer = readFlag(message, COLLAPSE_OFFER_FLAG);
  if (!offer || !isFinitePositive(offer.hours)) return null;
  return { floor: offer.floor, days: offer.days, hours: offer.hours, applied: offer.applied === true };
}

/** The card's markup: the line, then the GM-only button, or the applied badge once pressed. */
function renderOffer(offer, current) {
  const line = escapeAttr(collapseOfferText('COG.FloorCollapse.Line', { floor: offer.floor, days: offer.days, hours: offer.hours, current }));
  const action = offer.applied
    ? `<span class="cog-state-badge">${escapeAttr(collapseOfferText('COG.FloorCollapse.Applied'))}</span>`
    : `<button type="button" class="cog-btn cog-btn-primary" data-action="${COLLAPSE_OFFER_ACTION}" data-gm-only="true"><i class="fa-solid fa-hourglass-half"></i> ${escapeAttr(collapseOfferText('COG.FloorCollapse.Button', { hours: offer.hours }))}</button>`;
  return `<div class="cog-chat-card cog-bg-window cog-text-strong" style="padding: 12px; font-family: 'Oswald', sans-serif;">
    <div style="text-transform: uppercase; font-size: 12px; letter-spacing: 1.5px; font-weight: bold; margin-bottom: 8px;"><i class="fa-solid fa-hourglass-half"></i> ${escapeAttr(collapseOfferText('COG.FloorCollapse.Title'))}</div>
    <p>${line}</p>
    ${action}
  </div>`;
}

/**
 * Whisper the GM the book's time to collapse for a floor.
 * @param {number} floor the floor just entered
 * @param {{ clockHours: number }} options the clock's reading now
 * @returns {Promise<ChatMessage|null>} null for a non-GM client, a floor with no book time, or no chat
 */
export async function postCollapseOffer(floor, { clockHours }) {
  if (globalThis.game?.user?.isGM === false) return null;
  const hours = bookCollapseHours(floor);
  const days = bookCollapseDays(floor);
  if (hours === null || typeof globalThis.ChatMessage?.create !== 'function') return null;
  const offer = { floor, days, hours, applied: false };
  return globalThis.ChatMessage.create(withFlags({
    content: renderOffer(offer, clockHours),
    whisper: gmWhisper()
  }, { [COLLAPSE_OFFER_FLAG]: offer }));
}

/**
 * Show the card as applied: the badge in place of the button, `applied: true` on the flag. Never writes the clock.
 * @param {object} message
 * @param {{ clockHours: number }} options the clock's reading now, for the line
 */
export async function markCollapseOfferApplied(message, { clockHours } = {}) {
  const offer = readCollapseOffer(message);
  if (!offer) return;
  await message.update({
    content: renderOffer({ ...offer, applied: true }, clockHours ?? offer.hours),
    [flagPath(`${COLLAPSE_OFFER_FLAG}.applied`)]: true
  });
}
