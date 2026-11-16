/**
 * The Fan Box milestone alert card (core p. 280): a GM whisper, one row per milestone a crawler reached, with Award and
 * No box buttons on a row the GM has not answered. An answered row shows its badge and loses its buttons; a row whose
 * crawler has dropped back below keeps its buttons and shows the crawler's new number. Players never see the card.
 * Every typed name is escaped. The card's data rides in its flag: `{ actorId, now, rows: [{ milestone, state, below,
 * tier, hint }] }`, so the card re-renders from the flag alone.
 */
import { escapeAttr } from '../utils/escape-attr.mjs';
import { withFlags, flagPath } from '../utils/flags.mjs';
import { lootBoxTierDef } from '../data/loot-box-tiers.mjs';
import { makeCardText } from './popularity-checklist-card.mjs';

/** The flag on the alert card. */
export const FAN_BOX_ALERT_FLAG = 'fanBoxAlert';
/** The chat actions behind a row's two buttons. */
const FAN_BOX_ALERT_AWARD_ACTION = 'crawlerFanBoxAlertAward';
const FAN_BOX_ALERT_DISMISS_ACTION = 'crawlerFanBoxAlertDismiss';

const KEY = 'COG.FanBoxAlert';
export const fanBoxAlertText = makeCardText({
  [`${KEY}.Title`]: 'Fan Box milestone',
  [`${KEY}.Reached`]: '{name} reached Popularity {milestone} (now {now})',
  [`${KEY}.Hint`]: 'Already had a Fan Box on this floor.',
  [`${KEY}.Below`]: 'Popularity is now {now}, below {milestone}',
  [`${KEY}.Award`]: 'Award Fan Box...',
  [`${KEY}.NoBox`]: 'No box',
  [`${KEY}.Awarded`]: '[AWARDED] {tier}',
  [`${KEY}.Dismissed`]: '[NO BOX]',
  [`${KEY}.TierTitle`]: 'Award a Fan Box',
  [`${KEY}.TierLabel`]: 'Tier',
  [`${KEY}.TierIntro`]: '{name} reached Popularity {milestone}. Which tier of Fan Box?',
  [`${KEY}.Confirm`]: 'Award',
  [`${KEY}.Cancel`]: 'Cancel',
  [`${KEY}.GmOnly`]: 'Only the GM can answer a Fan Box alert.',
  [`${KEY}.Unknown`]: 'Crawler'
});

const nameOf = (actorId) => globalThis.game?.actors?.get?.(actorId)?.name || fanBoxAlertText(`${KEY}.Unknown`);

function rowHtml(data, row) {
  const name = nameOf(data.actorId);
  const reached = escapeAttr(fanBoxAlertText(`${KEY}.Reached`, { name, milestone: row.milestone, now: data.now }));
  const hint = row.hint ? `<div class="cog-card-note">${escapeAttr(fanBoxAlertText(`${KEY}.Hint`))}</div>` : '';
  const below = row.below !== null && row.below !== undefined && row.state === 'open'
    ? `<div class="cog-card-note">${escapeAttr(fanBoxAlertText(`${KEY}.Below`, { now: row.below, milestone: row.milestone }))}</div>`
    : '';
  let control;
  if (row.state === 'awarded') {
    control = `<span class="cog-state-badge cog-badge-awarded">${escapeAttr(fanBoxAlertText(`${KEY}.Awarded`, { tier: lootBoxTierDef(row.tier).label }))}</span>`;
  } else if (row.state === 'dismissed') {
    control = `<span class="cog-state-badge cog-badge-dismissed">${escapeAttr(fanBoxAlertText(`${KEY}.Dismissed`))}</span>`;
  } else {
    control = `<button type="button" class="cog-btn cog-btn-primary" data-action="${FAN_BOX_ALERT_AWARD_ACTION}" data-milestone="${escapeAttr(row.milestone)}" data-gm-only="true"><i class="fa-solid fa-gift"></i> ${escapeAttr(fanBoxAlertText(`${KEY}.Award`))}</button>
      <button type="button" class="cog-btn" data-action="${FAN_BOX_ALERT_DISMISS_ACTION}" data-milestone="${escapeAttr(row.milestone)}" data-gm-only="true">${escapeAttr(fanBoxAlertText(`${KEY}.NoBox`))}</button>`;
  }
  return `<div class="cog-fan-box-alert-row"><p><strong>${reached}</strong></p>${hint}${below}<div class="cog-card-actions">${control}</div></div>`;
}

/** The card's markup. @param {{ actorId: string, now: number, rows: object[] }} data */
function renderFanBoxAlert(data) {
  return `<div class="cog-chat-card cog-fan-box-alert-card">
    <header class="cog-card-header"><h3><i class="fa-solid fa-gift"></i> ${escapeAttr(fanBoxAlertText(`${KEY}.Title`))}</h3></header>
    <div class="cog-card-body">${(data.rows ?? []).map((row) => rowHtml(data, row)).join('')}</div>
  </div>`;
}

/** Post the card as a whisper to every GM. @returns {Promise<ChatMessage|null>} */
export async function postFanBoxAlertCard(data) {
  if (typeof globalThis.ChatMessage?.create !== 'function') return null;
  const whisper = globalThis.ChatMessage.getWhisperRecipients?.('GM')?.map((u) => u.id);
  return globalThis.ChatMessage.create(withFlags({
    speaker: { alias: fanBoxAlertText(`${KEY}.Title`) },
    content: renderFanBoxAlert(data),
    ...(whisper?.length ? { whisper } : {})
  }, { [FAN_BOX_ALERT_FLAG]: data }));
}

/** Rewrite a posted card from new data (content and flag together). Resolves false when the card is gone. */
export async function updateFanBoxAlertCard(message, data) {
  if (typeof message?.update !== 'function') return false;
  try {
    await message.update({ content: renderFanBoxAlert(data), [flagPath(FAN_BOX_ALERT_FLAG)]: data });
    return true;
  } catch (_) {
    return false;
  }
}
