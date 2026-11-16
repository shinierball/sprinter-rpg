/**
 * The two buttons on a Fan Box alert row (core p. 280): Award Fan Box... (`crawlerFanBoxAlertAward`, asks which tier) and
 * No box (`crawlerFanBoxAlertDismiss`). GM only, and only a card a GM wrote: the milestone is a number on the button, the
 * crawler and the state come from the card's flag and the crawler's record, never from anything the button says.
 */
import { readFlag } from '../../utils/flags.mjs';
import { promptChoicePicks } from '../../utils/ui/choice-picker.mjs';
import { lootBoxTiersInOrder, DEFAULT_LOOT_BOX_TIER } from '../../data/loot-box-tiers.mjs';
import { awardFanBoxFromAlert, dismissFanBoxAlert } from '../../documents/actor/fan-box-alert.mjs';
import { getCurrentFloor } from '../../documents/actor/actor-environment.mjs';
import { readChecklistState } from '../../documents/actor/popularity-checklist.mjs';
import { isGmAuthored } from '../chat-relay.mjs';
import { FAN_BOX_ALERT_FLAG, fanBoxAlertText } from '../fan-box-alert-card.mjs';

const KEY = 'COG.FanBoxAlert';

/** The row a click is for: the card's data and the milestone, or null when the click is not one a GM may answer. */
function clickedRow(button, message) {
  if (!globalThis.game?.user?.isGM) {
    globalThis.ui?.notifications?.warn?.(fanBoxAlertText(`${KEY}.GmOnly`));
    return null;
  }
  if (!isGmAuthored(message)) return null;
  const data = readFlag(message, FAN_BOX_ALERT_FLAG);
  const milestone = Number(button?.dataset?.milestone);
  if (!data || !Array.isArray(data.rows) || !data.rows.some((row) => row.milestone === milestone)) return null;
  return { data, milestone };
}

/**
 * The tier dialog: every registered Fan Box tier in rank order, starting on the first (the tier has no book rule), with the
 * "already one this floor" hint read now. Resolves the tier id, or null when cancelled.
 */
async function askTier({ data, milestone }) {
  const hasOne = Number(readChecklistState().fanBoxes?.lastFloor?.[data.actorId]) === getCurrentFloor();
  const name = globalThis.game?.actors?.get?.(data.actorId)?.name ?? '';
  const picks = await promptChoicePicks({
    title: fanBoxAlertText(`${KEY}.TierTitle`),
    intro: fanBoxAlertText(`${KEY}.TierIntro`, { name, milestone }),
    entries: [{
      key: 'tier',
      label: fanBoxAlertText(`${KEY}.TierLabel`),
      hint: hasOne ? fanBoxAlertText(`${KEY}.Hint`) : '',
      candidates: lootBoxTiersInOrder().map((def) => ({ value: def.id, label: def.label || def.id }))
    }],
    confirmLabel: fanBoxAlertText(`${KEY}.Confirm`),
    cancelLabel: fanBoxAlertText(`${KEY}.Cancel`)
  });
  return picks ? picks.tier || DEFAULT_LOOT_BOX_TIER : null;
}

/** @param {Event} event @param {HTMLElement} button @param {ChatMessage} message */
export async function handleFanBoxAlertAward(event, button, message) {
  const row = clickedRow(button, message);
  if (!row) return;
  const tier = await askTier(row);
  if (!tier) return;
  await awardFanBoxFromAlert(message.id, row.milestone, { tier });
}

/** @param {Event} event @param {HTMLElement} button @param {ChatMessage} message */
export async function handleFanBoxAlertDismiss(event, button, message) {
  const row = clickedRow(button, message);
  if (!row) return;
  await dismissFanBoxAlert(message.id, row.milestone);
}
