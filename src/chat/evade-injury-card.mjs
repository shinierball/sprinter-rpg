/**
 * The GM's Injury card at the end of a combat (core pp. 80, 96): a Major Fail on an Evade is a Minor Injury "once the adrenaline
 * wears off", a Natural 1 a Major one. A GM whisper built from the combat's Evade cards: one line per Injury, an Apply button
 * per line and an Apply all button. Nothing lands until the GM presses one. What landed is recorded in the card's flag
 * (`applied`), so the card re-renders from the flag alone. Every name is escaped.
 */
import { escapeAttr } from '../utils/escape-attr.mjs';
import { withFlags, flagPath, readFlag } from '../utils/flags.mjs';
import { messageList } from '../utils/card/recent-cards.mjs';
import { evadeAftermathText, evadeInjuryLines } from '../documents/actor/evade-aftermath.mjs';

/** The flag on the Injury card: `{ combatId, lines, applied }`. */
export const EVADE_INJURY_FLAG = 'evadeInjuries';
/** The action of the card's buttons. */
const EVADE_INJURY_ACTION = 'crawlerApplyEvadeInjury';
/** `data-line-id` of the Apply all button. */
export const EVADE_INJURY_ALL = 'all';

const KEY = 'COG.EvadeAftermath.Card';
const text = (key, data) => evadeAftermathText(`${KEY}.${key}`, data);

/** One line's sentence. @param {object} line */
function lineText(line) {
  const data = {
    name: line.actorName,
    injury: text(line.grade === 'major' ? 'Major' : 'Minor'),
    cause: text(line.cause === 'natural_1' ? 'CauseNatural1' : 'CauseMajorFail'),
    attacker: line.attackerName,
    round: line.round ?? '?'
  };
  return text(line.attackerName ? 'Line' : 'LineNoAttacker', data);
}

/** The card's markup, from its flag. @param {{ lines: object[], applied?: object }} state */
function renderEvadeInjuryCard(state) {
  const applied = state.applied ?? {};
  const rows = (state.lines ?? []).map((line) => {
    const done = applied[line.id];
    const dead = line.dead ? `<div class="cog-card-note">${escapeAttr(text('Dead'))}</div>` : '';
    const control = done
      ? `<span class="cog-state-badge">${escapeAttr(text('Landed', { name: done.name }))}</span>`
      : '';
    // An applied line shows what landed and no button (the action still asks a Rule Break if called for it again).
    const button = `<button type="button" class="cog-btn cog-btn-primary" data-action="${EVADE_INJURY_ACTION}" data-line-id="${escapeAttr(line.id)}" data-gm-only="true"><i class="fa-solid fa-bandage"></i> ${escapeAttr(text('Apply'))}</button>`;
    return `<div class="cog-evade-injury-row"><p><strong>${escapeAttr(lineText(line))}</strong></p>${dead}${control}${done ? '' : button}</div>`;
  });
  const anyOpen = (state.lines ?? []).some((line) => !line.dead && !applied[line.id]);
  const all = anyOpen
    ? `<button type="button" class="cog-btn cog-btn-primary" data-action="${EVADE_INJURY_ACTION}" data-line-id="${EVADE_INJURY_ALL}" data-gm-only="true"><i class="fa-solid fa-bandage"></i> ${escapeAttr(text('ApplyAll'))}</button>`
    : '';
  return `<div class="cog-chat-card cog-evade-injury-card">
    <header class="cog-card-header"><h3><i class="fa-solid fa-heart-crack"></i> ${escapeAttr(text('Title'))}</h3></header>
    <div class="cog-card-body"><div class="cog-card-note">${escapeAttr(text('Hint'))}</div>${rows.join('')}${all}</div>
  </div>`;
}

/** The ids of the lines an earlier Injury card of this combat already holds. */
function cardedLineIds(combatId, messages) {
  const ids = new Set();
  for (const message of messageList(messages)) {
    const state = readFlag(message, EVADE_INJURY_FLAG);
    if (state?.combatId !== combatId) continue;
    for (const line of state.lines ?? []) ids.add(line.id);
  }
  return ids;
}

/**
 * Post the Injury card to the GMs, or return null when the combat has no Injury to show that an earlier card of it does not
 * already hold. The card is its own marker: End Combat and the combat's deletion both call this, and a line is shown once.
 * Nothing is applied.
 * @param {object} combat
 * @param {{ messages?: Array<object>|{ contents: object[] } }} [options]
 * @returns {Promise<object|null>} the created message
 */
export async function postEvadeInjuryCard(combat, { messages = globalThis.game?.messages } = {}) {
  if (!combat?.id || typeof globalThis.ChatMessage?.create !== 'function') return null;
  const carded = cardedLineIds(combat.id, messages);
  const lines = evadeInjuryLines(combat, { messages }).filter((line) => !carded.has(line.id));
  if (!lines.length) return null;
  const state = { combatId: combat.id, lines, applied: {} };
  const whisper = globalThis.ChatMessage.getWhisperRecipients?.('GM')?.map((u) => u.id);
  return globalThis.ChatMessage.create(withFlags({
    speaker: { alias: text('Title') },
    content: renderEvadeInjuryCard(state),
    ...(whisper?.length ? { whisper } : {})
  }, { [EVADE_INJURY_FLAG]: state }));
}

/** Rewrite a posted card from new state (content and flag together). */
export async function updateEvadeInjuryCard(message, state) {
  await message.update({ content: renderEvadeInjuryCard(state), [flagPath(EVADE_INJURY_FLAG)]: state });
}
