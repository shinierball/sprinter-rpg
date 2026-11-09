/**
 * "Apply +N" on the end-of-combat AI Favor tally card. GM only. A line that fails the book's
 * conditions asks for a Rule Break confirm; one write per line.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { COGSessionEngine } from '../../documents/session/session-engine.mjs';
import { currentTimeContext } from '../../documents/actor/dungeon-time.mjs';
import { dayIndex, DAY_HOURS, SECONDS_PER_HOUR } from '../../utils/time/timing.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { isGmAuthored } from '../chat-relay.mjs';
import { AI_FAVOR_TALLY_FLAG, renderAiFavorTallyCard, tallyText } from '../ai-favor-tally-card.mjs';

/** The actor flag holding the "no AI Favor today" bar: `{ day }`, the day index it was set on (E6.10 D-C7). */
const AI_FAVOR_BAR_FLAG = 'aiFavorBar';

const BAR_TEXT = Object.freeze({
  'COG.AiFavor.BarTitle': 'No AI Favor Today',
  'COG.AiFavor.BarMessage': '{name} gets no AI Favor today ({left} left). Award anyway as a Rule Break?'
});

function barText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return (BAR_TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

/**
 * Whether the GM has barred AI Favor for this actor until the next day boundary, and the hours left.
 * @param {Actor} actor
 * @returns {{ barred: boolean, hoursLeft: number }}
 */
export function aiFavorBarState(actor) {
  const bar = actor?.flags?.[SYSTEM_ID]?.[AI_FAVOR_BAR_FLAG];
  const time = currentTimeContext(actor).time;
  if (!bar || !Number.isInteger(bar.day) || bar.day !== dayIndex(time)) return { barred: false, hoursLeft: 0 };
  const left = ((bar.day + 1) * DAY_HOURS * SECONDS_PER_HOUR - time) / SECONDS_PER_HOUR;
  return { barred: true, hoursLeft: Math.max(0, Math.ceil(left)) };
}

/** Bar AI Favor for the rest of the current day (an index, so it expires with no rollover hook). */
export async function setAiFavorBar(actor) {
  await actor.setFlag(SYSTEM_ID, AI_FAVOR_BAR_FLAG, { day: dayIndex(currentTimeContext(actor).time) });
}

/**
 * The write path every AI Favor gain and loss uses: add to `system.attributes.aiFavor` and record it in the session
 * ledger. A gain while the day's bar is up asks a Rule Break confirm (never a block); refused, nothing is written.
 * @param {Actor} actor
 * @param {number} delta
 * @param {string} reason
 * @param {object} [options] `ruleBreak: true` skips the confirm (already given); `interactive: false` refuses without asking
 * @returns {Promise<boolean>} whether the change was written
 */
export async function addAiFavor(actor, delta, reason, options = {}) {
  if (delta > 0) {
    const { barred, hoursLeft } = aiFavorBarState(actor);
    if (barred) {
      const res = await confirmRuleBreak({
        title: barText('COG.AiFavor.BarTitle'),
        message: barText('COG.AiFavor.BarMessage', { name: actor.name, left: `${hoursLeft}h` }),
        options
      });
      if (!res.confirmed) return false;
    }
  }
  // the current value is read inside the per-actor queue, so two concurrent gains both land (3.56e)
  await runKeyed(`ai-favor:${actor.uuid ?? ''}`, async () => {
    const current = Number(actor.system?.attributes?.aiFavor) || 0;
    await actor.update({ 'system.attributes.aiFavor': current + delta });
  });
  // The session ledger is GM-written. A player's own spend is relayed to the GM (owner-authorised, negative deltas
  // only); a player's gain is not ledgered, the actor write above is the record there.
  if (!globalThis.game?.user || globalThis.game.user.isGM) {
    COGSessionEngine.adjustAIFavor({ actorId: actor.id, delta, reason }).catch(() => {});
  } else if (delta < 0) {
    COGSessionEngine.spendAIFavor({ actor, delta, reason }).catch(() => {});
  }
  return true;
}

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleApplyAiFavorTally(event, button, message) {
  const notify = globalThis.ui?.notifications;
  if (!globalThis.game?.user?.isGM) {
    notify?.warn?.(tallyText('COG.AiFavorTally.GmOnly'));
    return;
  }
  // The card's lines carry the award; only a card the GM wrote may be applied (3.56c, A-L3).
  if (!isGmAuthored(message)) return;
  const lineId = button.dataset?.lineId ?? '';
  const state = message?.flags?.[SYSTEM_ID]?.[AI_FAVOR_TALLY_FLAG];
  const line = state?.lines?.find(l => l.id === lineId);
  if (!line) return;
  if (state.applied?.[lineId]) {
    notify?.info?.(tallyText('COG.AiFavorTally.AlreadyApplied'));
    return;
  }
  const actor = resolveActorByUuid(line.actorUuid);
  if (!actor) {
    notify?.warn?.(tallyText('COG.AiFavorTally.NoActor'));
    return;
  }

  const text = { item: line.itemName || '?', value: line.value, k: line.k, m: line.m, r: line.rounds };
  let ruleBreak = false;
  if (!line.meetsBook) {
    const res = await confirmRuleBreak({
      title: tallyText('COG.AiFavorTally.RuleBreakTitle'),
      message: tallyText('COG.AiFavorTally.RuleBreakMessage', text),
      reason: tallyText('COG.AiFavorTally.RuleBreakReason', text)
    });
    if (!res.confirmed) return;
    ruleBreak = true;
  }

  // Claim the line before writing so a second click cannot write again.
  const applied = { ...(state.applied ?? {}), [lineId]: { ruleBreak } };
  state.applied = applied;
  await message.update({
    content: renderAiFavorTallyCard(state.lines, applied),
    [`flags.${SYSTEM_ID}.${AI_FAVOR_TALLY_FLAG}.applied.${lineId}`]: { ruleBreak }
  });
  await addAiFavor(actor, line.value, tallyText('COG.AiFavorTally.ChatReason', text));
  notify?.info?.(tallyText('COG.AiFavorTally.Done', { actor: actor.name, value: line.value }));
}
