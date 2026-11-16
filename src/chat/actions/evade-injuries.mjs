/**
 * The buttons on the GM's Injury card (core pp. 80, 96): "Apply" on a line and "Apply all". GM only, and only a card a GM
 * wrote: everything a click does comes from the card's flag, never from the button but its line id. Lines land one at a time,
 * in order, through `landEvadeInjury`, so a second Minor Injury promotes the first (9.16c) and a third of a grade asks the
 * GM. A line already applied asks a Rule Break instead of refusing (Directive 2). Apply all skips a Dead actor's line.
 */
import { readFlag } from '../../utils/flags.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { isGmAuthored } from '../chat-relay.mjs';
import { isDead } from '../../documents/actor/dying.mjs';
import { evadeAftermathText, landEvadeInjury } from '../../documents/actor/evade-aftermath.mjs';
import { EVADE_INJURY_ALL, EVADE_INJURY_FLAG, updateEvadeInjuryCard } from '../evade-injury-card.mjs';

const KEY = 'COG.EvadeAftermath.Card';
const text = (key, data) => evadeAftermathText(`${KEY}.${key}`, data);
const warn = (message) => globalThis.ui?.notifications?.warn?.(message);

/** Land the lines `ids` name, in order; returns the new `applied` record. */
async function landLines(lines, applied) {
  const next = { ...applied };
  for (const line of lines) {
    const actor = resolveActorByUuid(line.actorUuid);
    if (!actor) {
      warn(text('Gone', { name: line.actorName }));
      continue;
    }
    const landed = await landEvadeInjury(actor, line.grade);
    if (!landed) {
      warn(text('NotLanded', { name: line.actorName }));
      continue;
    }
    next[line.id] = { name: landed.name, at: Date.now() };
  }
  return next;
}

async function applyNow(button, message) {
  // Read again inside the queue: a click that waited behind another sees what it landed.
  const state = readFlag(message, EVADE_INJURY_FLAG);
  if (!state) return;
  const lineId = button?.dataset?.lineId ?? '';
  const applied = state.applied ?? {};
  let chosen;
  if (lineId === EVADE_INJURY_ALL) {
    chosen = (state.lines ?? []).filter((line) => !applied[line.id] && !isDead(resolveActorByUuid(line.actorUuid)));
  } else {
    const line = (state.lines ?? []).find((l) => l.id === lineId);
    if (!line) return;
    if (applied[line.id]) {
      const answer = await confirmRuleBreak({
        title: text('AlreadyTitle'),
        message: text('AlreadyMessage'),
        reason: text('AlreadyReason')
      });
      if (!answer.confirmed) return;
    }
    chosen = [line];
  }
  if (!chosen.length) return;
  const next = await landLines(chosen, applied);
  await updateEvadeInjuryCard(message, { ...state, applied: next });
}

/** @param {Event} event @param {HTMLElement} button @param {ChatMessage} message */
export async function handleApplyEvadeInjury(event, button, message) {
  if (!globalThis.game?.user?.isGM) {
    warn(text('GmOnly'));
    return;
  }
  if (!isGmAuthored(message)) return;
  await runKeyed(`evade-injuries:${message?.id ?? ''}`, () => applyNow(button, message));
}
