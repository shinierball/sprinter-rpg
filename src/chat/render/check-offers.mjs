/**
 * Render-time after-roll block on check cards: the offers this user may click (a gear row's reroll, a degree shift) and,
 * for everyone, one line per reroll and shift the card carries. The card's flags are the truth (`flags.sprinter-rpg.check`);
 * this module only decorates. Markup is built with createElement/textContent: labels and names are user text and never go
 * through innerHTML.
 */
import { COG_OUTCOME_CONFIG, shiftDegree } from '../../documents/session/roll-outcomes.mjs';
import { checkCardInfo, readCheckReroll } from '../../documents/actor/check-after-roll.mjs';
import { readCheckRecord } from '../../utils/roll/check-assists.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { readFlag } from '../../utils/flags.mjs';
import { craftDifficultyLine } from '../../utils/crafting/crafting-engine.mjs';
import { checkOfferText } from '../../utils/roll/check-offer-text.mjs';
import { userOwnsActor } from '../../documents/actor/personal-space-links.mjs';

const BLOCK_CLASS = 'cog-check-offers';
const SOURCE_TEXT = Object.freeze({ ai_favor: 'AI Favor', row: 'gear' });

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const degreeLabel = (id) => COG_OUTCOME_CONFIG[id]?.label ?? id;

function offerLabel(offer, outcome) {
  if (offer.source === 'ai_favor') return checkOfferText('AiFavorReroll', { have: offer.have });
  if (offer.kind === 'reroll') return checkOfferText('RowReroll', { label: offer.label, source: offer.sourceName });
  const to = shiftDegree(outcome, offer.steps, { failOnly: offer.failOnly });
  return checkOfferText('Shift', { label: offer.label, from: degreeLabel(outcome), to: degreeLabel(to) });
}

function offerButton(doc, offer, outcome) {
  const button = el(doc, 'button', 'cog-check-offer-btn', offerLabel(offer, outcome));
  button.type = 'button';
  button.dataset.action = 'crawlerCheckOffer';
  button.dataset.rowKey = offer.rowKey;
  button.dataset.offerKind = offer.kind;
  if (offer.reasons?.length) {
    // Out of the rules: the click asks a Rule Break confirm, and the button says why.
    button.title = checkOfferText(`Reason.${offer.reasons[0]}`, { have: offer.have, need: 1 });
    button.append(' ', ruleBreakBadge(doc));
  }
  return button;
}

function ruleBreakBadge(doc) {
  return el(doc, 'span', 'cog-state-badge cog-badge-rule-break', `[${checkOfferText('RuleBreak').toUpperCase()}]`);
}

/** One line per reroll (old total → new total) and one per shift (degree → degree), in the order they happened. */
function historyLines(doc, info) {
  const { record, eff } = info;
  const lines = [];
  let before = record.rolled.total;
  for (const entry of record.rerolls) {
    const line = el(doc, 'li', 'cog-check-offer-line', checkOfferText('Rerolled', { source: SOURCE_TEXT[entry.source] ?? entry.source, old: before, new: entry.total }));
    if (entry.ruleBreak) line.append(' ', ruleBreakBadge(doc));
    lines.push(line);
    before = entry.total;
  }
  const craft = readFlag(info.message, 'craft');
  if (record.rerolls.length && craft && typeof craft.dc === 'number') lines.push(el(doc, 'li', 'cog-check-offer-line', craftDifficultyLine(craft, craft)));
  let degree = eff.outcomeRolled;
  for (const shift of record.shifts) {
    const next = shiftDegree(degree, shift.steps, { failOnly: shift.failOnly });
    lines.push(el(doc, 'li', 'cog-check-offer-line', checkOfferText('Shifted', { source: SOURCE_TEXT.row, from: degreeLabel(degree), to: degreeLabel(next) })));
    degree = next;
  }
  return lines;
}

/**
 * Add the after-roll block to a rendered check card (idempotent).
 * @param {HTMLElement} root the rendered message element
 * @param {ChatMessage} message
 */
export function renderCheckOffers(root, message) {
  if (!root?.querySelector) return;
  const host = root.querySelector('.message-content') ?? root;
  host.querySelectorAll(`.${BLOCK_CLASS}`).forEach((n) => n.remove());
  const info = checkCardInfo(message);
  if (!info) return;
  const doc = root.ownerDocument;
  const lines = historyLines(doc, info);
  const user = globalThis.game?.user;
  const offers = info.roller && userOwnsActor(info.roller, user) ? info.offers : [];
  if (!lines.length && !offers.length) return;
  const block = el(doc, 'div', BLOCK_CLASS);
  if (offers.length) {
    block.append(el(doc, 'div', 'cog-check-offers-title', checkOfferText('Title')));
    for (const offer of offers) block.append(offerButton(doc, offer, info.outcome ?? ''));
  }
  if (lines.length) {
    const list = el(doc, 'ul', 'cog-check-offer-lines');
    list.append(...lines);
    block.append(list);
  }
  if (info.eff.rerolled) host.querySelector('.dice-roll')?.classList.add('is-rerolled');
  host.append(block);
}

/**
 * The GM-only Apply button of a reroll card whose entry never reached its check (no one who may write the card was
 * connected); everyone else sees why the check has not changed. Idempotent.
 * @param {HTMLElement} root the rendered message element
 * @param {ChatMessage} message the reroll card
 */
export function renderCheckRerollApply(root, message) {
  if (!root?.querySelector) return;
  const host = root.querySelector('.message-content') ?? root;
  host.querySelectorAll('.cog-check-reroll-apply').forEach((n) => n.remove());
  const meta = readCheckReroll(message);
  if (!meta) return;
  const check = globalThis.game?.messages?.get?.(meta.checkMessageId);
  const record = check ? readCheckRecord(check) : null;
  if (!record || record.rerolls.some((r) => r.messageId === message.id)) return;
  const doc = root.ownerDocument;
  const wrap = el(doc, 'div', 'cog-check-reroll-apply');
  if (globalThis.game?.user?.isGM) {
    const button = el(doc, 'button', 'cog-check-offer-btn', checkOfferText('Apply', { name: resolveActorByUuid(record.rollerUuid)?.name ?? '' }));
    button.type = 'button';
    button.dataset.action = 'crawlerApplyCheckReroll';
    wrap.append(button);
  } else {
    wrap.append(el(doc, 'span', 'cog-check-reroll-note', checkOfferText('NotApplied')));
  }
  host.append(wrap);
}
