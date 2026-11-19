/**
 * Floor time a grinding table row offers (core p. 170; toolkit p. 13), on its own card after the party Grind card. The
 * session applies nothing: each offer is a line everyone reads and a button only the GM sees (`crawlerGrindFloorTime`).
 * A press rolls the offer's formula, turns a percentage into hours of the time left on the clock now (rounded down to the
 * whole minute) and takes it off the clock through `decrementFloorTimer`, so world time moves with it.
 */
import { PERCENT_MAX, parseEffectFormula } from '../../utils/grind/grind-effects.mjs';
import { rollEffectFormula } from '../../content/grind-tables.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { flagPath, readFlag, withFlags } from '../../utils/flags.mjs';
import { getFloorTimer, decrementFloorTimer } from './actor-environment.mjs';
import { langText } from '../../utils/lang-text.mjs';

/** The flag on the floor-time card: `{ offers: [{ id, formula, per, label }], applied: { [offerId]: { hours, percent?, ruleBreak } } }`. */
const FLOOR_TIME_FLAG = 'grindFloorTime';
/** The chat action of an offer's button. */
const FLOOR_TIME_ACTION = 'crawlerGrindFloorTime';
const MINUTES_PER_HOUR = 60;
const KEY = 'COG.Content.GrindTables';

const TEXT = Object.freeze({
  [`${KEY}.Offer`]: 'Floor time (the GM decides): {label}',
  [`${KEY}.OfferButton`]: 'Apply: {label}',
  [`${KEY}.OfferApplied`]: 'Applied: {hours} h {minutes} min lost',
  [`${KEY}.OfferTitle`]: 'Floor time on offer',
  [`${KEY}.OfferTwiceTitle`]: 'Floor Time Already Applied',
  [`${KEY}.OfferTwiceMessage`]: 'An offer on this card is already applied. Apply another as a Rule Break?',
  [`${KEY}.OfferTwiceReason`]: 'More than one floor-time offer was applied from one grinding event.'
});

export const grindFloorTimeText = langText(TEXT);

/** The card's state, `{ offers, applied }`, or null when the message is not a floor-time card. */
export function readFloorTimeState(message) {
  const state = readFlag(message, FLOOR_TIME_FLAG);
  return Array.isArray(state?.offers) ? { offers: state.offers, applied: state.applied ?? {} } : null;
}

/** Whether any offer on the card has been applied (then every further press asks a Rule Break). */
export const anyOfferApplied = (state) => Object.keys(state?.applied ?? {}).length > 0;

/**
 * The card's markup: a line per offer for everyone, and for the GM a button (data-gm-only) until it is applied; an applied
 * offer shows what it took in place of its button.
 */
function renderFloorTimeOffers(offers, applied = {}) {
  const rows = offers.map((o) => {
    const line = escapeAttr(grindFloorTimeText(`${KEY}.Offer`, { label: o.label }));
    const done = applied?.[o.id];
    const minutes = done ? Math.round(done.hours * MINUTES_PER_HOUR) : 0;
    const badge = done
      ? ` <span class="cog-state-badge">${escapeAttr(grindFloorTimeText(`${KEY}.OfferApplied`, { hours: Math.floor(minutes / MINUTES_PER_HOUR), minutes: minutes % MINUTES_PER_HOUR }))}</span>`
      : '';
    const button = `<button type="button" class="cog-btn cog-btn-primary" data-action="${FLOOR_TIME_ACTION}" data-offer-id="${escapeAttr(o.id)}" data-gm-only="true"><i class="fa-solid fa-hourglass-half"></i> ${escapeAttr(grindFloorTimeText(`${KEY}.OfferButton`, { label: o.label }))}</button>`;
    return `<div class="cog-grind-floor-time"><span>${line}</span>${badge} ${done ? '' : button}</div>`;
  }).join('');
  const title = escapeAttr(grindFloorTimeText(`${KEY}.OfferTitle`));
  // The party Grind card's shell and header, so the two read as one event.
  return `<div class="cog-chat-card cog-grind-floor-time-card cog-bg-window cog-text-strong" style="border: 2px solid var(--cog-warning); border-radius: 6px; padding: 12px; font-family: 'Oswald', sans-serif;">
    <div class="cog-bg-grad-accent-warning cog-text-on-fill" style="text-transform: uppercase; font-size: 12px; letter-spacing: 1.5px; padding: 5px 8px; border-radius: 3px; font-weight: bold; text-align: center; margin-bottom: 8px;">
      <i class="fa-solid fa-hourglass-half"></i> ${title}
    </div>
    ${rows}
  </div>`;
}

/**
 * Post the floor-time card after a party Grind card. Nothing is applied. No offers, no card.
 * @param {object[]} offers a grind row's `floorTimeOffers`
 */
export async function postFloorTimeCard(offers) {
  if (!offers?.length || typeof globalThis.ChatMessage?.create !== 'function') return null;
  return globalThis.ChatMessage.create(withFlags({
    speaker: { alias: 'Dungeon Grinding Master' },
    content: renderFloorTimeOffers(offers)
  }, { [FLOOR_TIME_FLAG]: { offers, applied: {} } }));
}

/**
 * The hours an offer's rolled total takes off a clock of `timerHours`: that many hours, or that percent of the time left
 * (clamped to 0-PERCENT_MAX), rounded down to the whole minute. Never negative.
 */
function hoursLost(total, per, timerHours) {
  if (per === 'percent') {
    const percent = Math.min(PERCENT_MAX, Math.max(0, total));
    const minutes = Math.floor((timerHours * MINUTES_PER_HOUR * percent) / PERCENT_MAX + 1e-9);
    return minutes / MINUTES_PER_HOUR;
  }
  return Math.max(0, total);
}

/**
 * Apply one offer of a floor-time card (the GM's press): roll it, take the hours off the clock (a percentage is of the time
 * left now), and record it on the card with its Roll. A formula that no longer parses does nothing.
 * @param {object} message the floor-time card
 * @param {{ id: string, formula: string, per: string }} offer one of the card's own offers
 * @param {{ ruleBreak?: boolean }} [options] the press was confirmed as a Rule Break
 * @returns {Promise<number|null>} the hours taken off, or null when nothing was applied
 */
export async function applyFloorTimeOffer(message, offer, { ruleBreak = false } = {}) {
  const state = readFloorTimeState(message);
  if (!state || !parseEffectFormula(offer?.formula)) return null;
  const { total, roll } = await rollEffectFormula(offer.formula);
  const per = offer.per === 'percent' ? 'percent' : 'hours';
  const hours = hoursLost(total, per, getFloorTimer());
  if (hours > 0) await decrementFloorTimer(hours);
  const before = state.applied[offer.id];
  const record = {
    hours: (before?.hours ?? 0) + hours,
    ...(per === 'percent' ? { percent: Math.min(PERCENT_MAX, Math.max(0, total)) } : {}),
    ruleBreak: ruleBreak || Boolean(before?.ruleBreak)
  };
  const applied = { ...state.applied, [offer.id]: record };
  const rolls = [...(message.rolls ?? []), ...(roll ? [roll] : [])].map((r) => r?.toJSON?.() ?? r);
  await message.update({
    content: renderFloorTimeOffers(state.offers, applied),
    rolls,
    [flagPath(`${FLOOR_TIME_FLAG}.applied`)]: applied
  });
  return hours;
}
