/**
 * Render-time assist block on check cards.
 *
 * The card's flags are the truth (`flags.sprinter-rpg.check`); this module only decorates. For a card with assists it
 * re-labels the target rows and the Evade banner from `effectiveCheck` and lists the assists; while the card belongs
 * to the combat's current round it adds the Assist offers this user may click. An assist card whose entry never
 * reached its check gets a GM-only Apply button. Markup is built with createElement/textContent: names, skill names
 * and the proposal are user text and never go through innerHTML.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { readCheckRecord, effectiveCheck } from '../../utils/check-assists.mjs';
import { collectCheckAssistOffers, classifyAttackOutcome } from '../../utils/interrupts.mjs';
import { appliedBeforeEvade } from '../../utils/evade-link.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { getDamageApplications } from '../damage-applications.mjs';

/** English fallbacks of the `COG.Assist.*` keys in lang/en.json (the headless test world has no i18n). */
const TEXT = Object.freeze({
  OffersTitle: 'Assist',
  OffersHint: 'Interrupt after the roll',
  OfferCost: 'Interrupt, 1 Action',
  OfferCostFree: 'Interrupt, Free',
  NoActions: '0 Actions',
  NearMiss: 'NEAR MISS',
  AppliedTitle: 'Assists',
  TotalChange: 'Total {before} → {after}',
  LineInterrupt: '{skill} +{amount} ({name}, {formula}) → check',
  LineCalledPlay: 'Called Play ({name}) {formula} = {amount}',
  ToCheck: '→ check',
  ToDamage: '→ damage',
  NotNeeded: 'not needed (no damage)',
  Awaiting: 'awaiting the GM: {total}, or {with} with it',
  AppliedBefore: 'Damage was already applied; Undo and apply again to use this assist.',
  ApplyButton: "Apply to {name}'s check",
  NotApplied: 'Not applied yet: no GM connected',
  CardTitle: "INTERRUPT: {skill} +{amount} → {name}'s check",
  NoActionsTitle: 'Assist Rule Break',
  NoActionsReason: 'No Actions left ({spent}/{max}).',
  NoActionsConfirm: 'No Actions left ({spent}/{max}). {skill} anyway as a Rule Break?',
  NoGmAction: 'No GM connected to record the Action.',
  NoGmApply: 'Not applied: no GM connected. The GM can apply it from the assist card.',
  Refused: 'The assist was not applied ({reason}).',
  InvalidFormula: '{skill}: not a valid roll formula.',
  RollFailed: '{skill}: the assist dice could not be rolled.',
  NotInCombat: 'Assists are used in combat.',
  NoCheck: 'This card has no check to assist.',
  NoSkill: 'The assisting skill was not found.',
  SheetNote: "Use it from the Interrupt button on the ally's check card.",
  NoEffect: 'No effect',
  ResolveFirst: 'Resolve the Called Play before rolling damage.',
  CalledPlayTitle: 'CALL A PLAY: {name} → {ally}: +{amount} ({formula}), for {ally}\'s next skill or attack roll this round',
  CalledPlayTitleByHand: 'CALL A PLAY: {name}: +{amount} ({formula})',
  CalledPlayByHand: 'No combat: apply it by hand.',
  CalledPlayNote: 'Called Play for {ally}',
  CalledPlayPickTitle: 'Call a Play',
  CalledPlayPick: 'Which ally is this play for?',
  CalledPlayPickOk: 'Call it',
  CalledPlayNotCleared: 'Called Play not cleared: no GM connected. It ends with the round.',
  NoGmStore: 'The Called Play was rolled but not stored: no GM connected.'
});

/**
 * Localized assist text: `COG.Assist.<key>` through `game.i18n` when it knows the key, else the English fallback.
 * @param {keyof TEXT} key
 * @param {Record<string, string|number>} [data] `{name}` placeholders
 */
export function assistText(key, data = {}) {
  const full = `COG.Assist.${key}`;
  const i18n = globalThis.game?.i18n;
  try {
    const s = Object.keys(data).length ? i18n?.format?.(full, data) : i18n?.localize?.(full);
    if (typeof s === 'string' && s && s !== full) return s;
  } catch {
    // fall through to the fallback
  }
  return Object.entries(data).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), TEXT[key] ?? full);
}

function messageList() {
  const messages = globalThis.game?.messages;
  if (!messages) return [];
  if (Array.isArray(messages)) return messages;
  if (Array.isArray(messages.contents)) return messages.contents;
  return Array.from(messages.values?.() ?? messages);
}

function flagsOf(message) {
  const f = message?.flags?.[SYSTEM_ID];
  return f && typeof f === 'object' ? f : {};
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
// Role tokens (3.0a), so the re-labelled rows follow the light/dark theme.
export const HIT_BG = 'var(--cog-success-tint)';
export const MISS_BG = 'var(--cog-danger-tint)';
export const HIT_EDGE = 'var(--cog-success)';
export const MISS_EDGE = 'var(--cog-accent)';
export const HIT_FILL = 'var(--cog-success-fill)';
export const MISS_FILL = 'var(--cog-accent-fill)';

/** Re-label each target row from the effective totals (the row's words come from the attack card's classifier). */
function decorateTargets(card, eff, record) {
  const rows = [...card.querySelectorAll('.cog-target-eval-row[data-target-id]')];
  for (const t of eff.targets) {
    if (t.dc === null) continue;
    const row = rows.find((r) => r.dataset.targetId === t.actorId);
    if (!row) continue;
    const { isHit, diff, outcome } = classifyAttackOutcome(t.total, t.dc, record.d20);
    row.classList.toggle('hit', isHit);
    row.classList.toggle('miss', !isHit);
    row.dataset.assisted = 'true';
    row.style?.setProperty?.('--cog-bg-dyn', isHit ? HIT_BG : MISS_BG);
    row.style?.setProperty?.('border-color', isHit ? HIT_EDGE : MISS_EDGE);
    // The outcome badge is the row's second child (combat-targeting.mjs builds the row).
    const badge = row.children?.[1];
    if (badge && !badge.classList.contains('cog-target-tohit-lines')) {
      badge.textContent = `${outcome.toUpperCase()} (${signed(diff)})`;
      badge.style?.setProperty?.('--cog-bg-dyn', isHit ? HIT_FILL : MISS_FILL);
    }
  }
}

/** Replace the Evade banner's verdict with the assisted one. */
function decorateEvade(card, eff, record) {
  const banner = card.querySelector('.cog-evade-result-banner');
  if (!banner || !eff.evade) return;
  const doc = card.ownerDocument;
  banner.replaceChildren(
    el(doc, 'i', `fa-solid ${eff.evade.isEvaded ? 'fa-shield-halved' : 'fa-burst'}`),
    ` ${eff.evade.bannerText} `,
    el(doc, 'span', 'cog-evade-result-detail', `(${eff.total} vs ${record.dc})`)
  );
  banner.dataset.assisted = 'true';
  banner.style?.setProperty?.('--cog-bg-dyn', eff.evade.bannerBg);
  banner.style?.setProperty?.('border-color', eff.evade.bannerBorder);
}

/** The display line of one assist entry. */
export function assistLineText(entry, eff) {
  if (entry.source === 'interrupt') {
    return assistText('LineInterrupt', { skill: entry.skillName || 'Assist', amount: entry.amount, name: entry.fromName, formula: entry.formula });
  }
  const head = assistText('LineCalledPlay', { name: entry.fromName, formula: entry.formula, amount: entry.amount });
  let tail;
  if (entry.appliedTo === 'check') tail = assistText('ToCheck');
  else if (entry.appliedTo === 'damage') tail = assistText('ToDamage');
  else if (entry.appliedTo === 'none') tail = assistText('NotNeeded');
  else tail = assistText('Awaiting', { total: eff.total, with: eff.total + entry.amount });
  const text = `${head} ${tail}`;
  return entry.proposal ? `${text} — ${entry.proposal}` : text;
}

/** True when a damage card answering this check has an application that was not undone (E6.3 detection). */
function damageAlreadyApplied(message, record) {
  const messages = messageList();
  const f = flagsOf(message);
  if (record.kind === 'evade') {
    return appliedBeforeEvade(messages, { attackMessageId: f.attackMessageId, evaderUuid: f.evaderUuid ?? record.rollerUuid, getApplications: getDamageApplications });
  }
  if (!message?.id) return false;
  return messages.some((m) => flagsOf(m).sourceMessageId === message.id && getDamageApplications(m).some((a) => !a.undone));
}

/** Whether this user may choose where an unresolved Called Play goes: the GM, the caller's or the roller's owners (D14). */
function mayResolveCalledPlay(entry, record) {
  const user = globalThis.game?.user;
  if (user?.isGM) return true;
  return [entry.fromUuid, record.rollerUuid].some((uuid) => resolveActorByUuid(uuid)?.isOwner === true);
}

/** The "→ check" / "→ damage" / "No effect" buttons of an unresolved Called Play line (D14). */
function resolveButtons(doc, entry, record) {
  const wrap = el(doc, 'span', 'cog-check-assist-resolve');
  const choices = [['check', 'ToCheck'], ...(record.hasDamage ? [['damage', 'ToDamage']] : [['none', 'NoEffect']])];
  for (const [appliedTo, key] of choices) {
    const button = el(doc, 'button', 'cog-assist-offer-btn cog-resolve-called-play-btn', assistText(key));
    button.type = 'button';
    button.dataset.action = 'crawlerResolveCalledPlay';
    button.dataset.entryId = entry.id;
    button.dataset.appliedTo = appliedTo;
    wrap.append(button);
  }
  return wrap;
}

function buildAssistList(doc, message, record, eff) {
  const wrap = el(doc, 'div', 'cog-check-assists');
  wrap.append(el(doc, 'div', 'cog-check-assists-title', assistText('AppliedTitle')));
  const list = el(doc, 'ul', 'cog-check-assists-lines');
  for (const entry of eff.assists) {
    const item = el(doc, 'li', `cog-check-assist cog-check-assist-${entry.appliedTo}`, assistLineText(entry, eff));
    item.dataset.assistId = entry.id;
    item.dataset.source = entry.source;
    if (entry.appliedTo === 'unresolved' && mayResolveCalledPlay(entry, record)) item.append(' ', resolveButtons(doc, entry, record));
    list.append(item);
  }
  wrap.append(list);
  if (eff.unresolved.length && record.hasDamage) wrap.append(el(doc, 'div', 'cog-check-assists-note', assistText('ResolveFirst')));
  if (eff.checkBonus !== 0) wrap.append(el(doc, 'div', 'cog-check-assists-total', assistText('TotalChange', { before: record.total, after: eff.total })));
  if (damageAlreadyApplied(message, record)) wrap.append(el(doc, 'div', 'cog-check-assists-note', assistText('AppliedBefore')));
  return wrap;
}

function offerButton(doc, offer) {
  const button = el(doc, 'button', 'cog-assist-offer-btn');
  button.type = 'button';
  button.dataset.action = 'crawlerUseAssist';
  button.dataset.assisterUuid = offer.actorUuid;
  button.dataset.combatantId = offer.combatantId;
  button.dataset.itemId = offer.itemId;
  if (offer.highlight) button.classList.add('is-highlighted');
  const label = el(doc, 'span', 'cog-assist-offer-label', `${offer.actorName}: ${offer.skillName} +${offer.formula}`);
  const cost = el(doc, 'span', 'cog-assist-offer-cost', `(${assistText(offer.isFree ? 'OfferCostFree' : 'OfferCost')})`);
  button.append(el(doc, 'i', 'fa-solid fa-handshake-angle'), label, cost);
  if (offer.highlight) button.append(el(doc, 'span', 'cog-state-badge cog-badge-near-miss', assistText('NearMiss')));
  if (offer.noActions) button.append(el(doc, 'span', 'cog-state-badge cog-badge-no-actions', assistText('NoActions')));
  return button;
}

function buildOfferBlock(doc, offers) {
  const wrap = el(doc, 'div', 'cog-interrupt-prompts-container cog-assist-offers');
  const head = el(doc, 'div', 'cog-assist-offers-title');
  head.append(el(doc, 'span', '', assistText('OffersTitle')), el(doc, 'span', 'cog-assist-offers-hint', assistText('OffersHint')));
  wrap.append(head);
  for (const offer of offers) wrap.append(offerButton(doc, offer));
  return wrap;
}

/** The GM-only Apply button of an assist card whose entry is not on its check yet (no GM was connected). */
function renderAssistCardApply(root, message) {
  const f = flagsOf(message);
  if (f.isAssistRoll !== true || f.source !== 'interrupt' || typeof f.checkMessageId !== 'string' || !f.checkMessageId) return;
  const card = root.querySelector('.message-content') ?? root;
  card.querySelectorAll('.cog-assist-apply').forEach((n) => n.remove());
  const check = globalThis.game?.messages?.get?.(f.checkMessageId);
  const record = check ? readCheckRecord(check) : null;
  if (!record || record.assists.some((a) => a.messageId === message.id)) return;
  const doc = root.ownerDocument;
  const wrap = el(doc, 'div', 'cog-assist-apply');
  if (globalThis.game?.user?.isGM) {
    const button = el(doc, 'button', 'cog-assist-apply-btn');
    button.type = 'button';
    button.dataset.action = 'crawlerApplyAssist';
    const rollerName = resolveActorByUuid(record.rollerUuid)?.name ?? '';
    button.append(el(doc, 'i', 'fa-solid fa-check'), ` ${assistText('ApplyButton', { name: rollerName })}`);
    wrap.append(button);
  } else {
    wrap.append(el(doc, 'span', 'cog-assist-apply-note', assistText('NotApplied')));
  }
  card.append(wrap);
}

/**
 * Decorate a rendered chat message (idempotent: earlier blocks are removed first).
 * @param {HTMLElement} root the rendered message element
 * @param {ChatMessage} message
 */
export function renderCheckAssists(root, message) {
  if (!root?.querySelector) return;
  renderAssistCardApply(root, message);
  const record = readCheckRecord(message);
  if (!record) return;
  const eff = effectiveCheck(record);
  if (!eff) return;
  const card = root.querySelector('.message-content') ?? root;
  card.querySelectorAll('.cog-check-assists, .cog-assist-offers').forEach((n) => n.remove());
  const doc = root.ownerDocument;
  if (eff.assists.length) {
    decorateTargets(card, eff, record);
    decorateEvade(card, eff, record);
    card.append(buildAssistList(doc, message, record, eff));
  }
  const combat = globalThis.game?.combat;
  if (!combat || record.combatId !== combat.id || record.round !== Number(combat.round)) return;
  const isGM = Boolean(globalThis.game?.user?.isGM);
  // Built per client: only the offers of actors this user owns (all for the GM), so a stranger never sees a button.
  const offers = collectCheckAssistOffers({ record, eff, combat }).filter((o) => isGM || o.actor?.isOwner === true);
  if (offers.length) card.append(buildOfferBlock(doc, offers));
}
