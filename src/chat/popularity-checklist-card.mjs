/**
 * The Popularity checklist's chat cards. The summary card is public (Popularity is the show's scoreboard): per crawler
 * the lines applied and the net, the Fan Boxes awarded, a Rule Break badge where one was confirmed, and a GM-only
 * Undo button. After Undo the card is marked undone and a short line is posted. Every typed name and label is escaped.
 */
import { escapeAttr } from '../utils/escape-attr.mjs';
import { withFlags } from '../utils/flags.mjs';
import { ruleBreakBadgeHtml } from '../utils/rule-break-visibility.mjs';
import { withRuleBreak } from '../utils/rule-break.mjs';
import { lootBoxTierDef } from '../data/loot-box-tiers.mjs';

/** The flag on the summary card: `{ id }`, the id of the applied record it summarises. */
export const POPULARITY_CHECKLIST_CARD_FLAG = 'popularityChecklist';
/** The flag on the due card: `{ moment }`, the checklist its button opens. */
export const POPULARITY_CHECKLIST_DUE_FLAG = 'popularityChecklistDue';
/** The chat action behind the due card's Open checklist button. */
const POPULARITY_CHECKLIST_OPEN_ACTION = 'crawlerPopularityChecklistOpen';
/** The chat action behind the card's Undo button. */
const POPULARITY_CHECKLIST_UNDO_ACTION = 'crawlerPopularityChecklistUndo';

const KEY = 'COG.PopularityChecklist';
const TEXT = {
  [`${KEY}.Title`]: 'Popularity checklist: {moment}',
  [`${KEY}.Moment.session`]: 'Session',
  [`${KEY}.Moment.day`]: 'Day',
  [`${KEY}.Moment.floor`]: 'Floor',
  [`${KEY}.Net`]: 'Net {net}',
  [`${KEY}.Box`]: '{tier} Fan Box',
  [`${KEY}.Undo`]: 'Undo',
  [`${KEY}.Undone`]: '[UNDONE]',
  [`${KEY}.UndoneLine`]: 'Popularity checklist undone: {moment}.',
  [`${KEY}.UndoneBoxes`]: 'Fan Boxes already awarded stay with their crawlers: {boxes}.',
  [`${KEY}.UndoneBelow`]: '{name} is back below {milestones}; any Fan Box already awarded for it stays.',
  [`${KEY}.Other`]: 'Other',
  [`${KEY}.Unknown`]: 'Crawler',
  [`${KEY}.GmOnly`]: 'Only the GM can apply the Popularity checklist.',
  [`${KEY}.RuleBreakTitle`]: 'Popularity Checklist',
  [`${KEY}.RuleBreakMessage`]: '{detail}. Apply anyway as a Rule Break?',
  [`${KEY}.RuleBreakUsed`]: '{count} change(s) already applied this period',
  [`${KEY}.RuleBreakFirstFloor`]: '{count} change(s) on the First Floor, where Popularity does not count yet',
  [`${KEY}.UndoReason`]: 'Undo: {label}',
  [`${KEY}.ReasonLabel`]: 'Popularity checklist ({moment})',
  [`${KEY}.BoxTrophy`]: 'Fan Box: {tier}',
  [`${KEY}.BoxReward`]: '1x {tier} Fan Box',
  [`${KEY}.BoxQuote`]: 'The audience is voting on the contents. Voting closes {time}.',
  [`${KEY}.Due.Title`]: 'Popularity checklist due',
  [`${KEY}.Due.session`]: 'The session has ended.',
  [`${KEY}.Due.day`]: 'Day {days} ended.',
  [`${KEY}.Due.floor`]: 'Floor {floor} was left.',
  [`${KEY}.Due.Open`]: 'Open checklist'
};

/**
 * A localized-text function over a table of English defaults, used when no i18n is loaded (tests, early load).
 * @param {Record<string, string>} table
 */
export const makeCardText = (table) => (key, data = {}) => {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return (table[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
};

/** Localized checklist text, with the English default when no i18n is loaded (tests, early load). */
export const checklistText = makeCardText(TEXT);

const signed = (n) => (n > 0 ? `+${n}` : String(n));
const momentLabel = (moment) => checklistText(`${KEY}.Moment.${moment}`);
const nameOf = (actorId) => globalThis.game?.actors?.get?.(actorId)?.name || checklistText(`${KEY}.Unknown`);

/** Group a record's entries and boxes by crawler, in first-seen order. */
function byCrawler(record) {
  const groups = new Map();
  const group = (actorId) => {
    if (!groups.has(actorId)) groups.set(actorId, { actorId, lines: [], net: 0, boxes: [], ruleBreak: false });
    return groups.get(actorId);
  };
  for (const e of record.entries ?? []) {
    const g = group(e.actorId);
    g.lines.push(e);
    g.net += Number(e.delta) || 0;
    g.ruleBreak = g.ruleBreak || e.ruleBreak === true;
  }
  for (const b of record.boxes ?? []) group(b.actorId).boxes.push(b);
  return [...groups.values()];
}

/**
 * The summary card's markup.
 * @param {object} record an applied record (`utils/floor/popularity-checklist.mjs`)
 * @param {{ undone?: boolean }} [options] `undone` replaces the Undo button with the undone badge
 * @returns {string}
 */
function renderChecklistSummary(record, { undone = Boolean(record?.undoneAt) } = {}) {
  const crawlers = byCrawler(record).map((g) => {
    const lines = g.lines.map((e) => `<li>${escapeAttr(e.label || checklistText(`${KEY}.Other`))} <strong>${escapeAttr(signed(Number(e.delta) || 0))}</strong></li>`).join('');
    const boxes = g.boxes.map((b) => `<li><i class="fa-solid fa-gift"></i> ${escapeAttr(checklistText(`${KEY}.Box`, { tier: lootBoxTierDef(b.tier).label }))}</li>`).join('');
    const badge = g.ruleBreak ? ` ${ruleBreakBadgeHtml()}` : '';
    return `<div class="cog-popularity-crawler"><strong>${escapeAttr(nameOf(g.actorId))}</strong> ${escapeAttr(checklistText(`${KEY}.Net`, { net: signed(g.net) }))}${badge}<ul>${lines}${boxes}</ul></div>`;
  }).join('');
  const control = undone
    ? `<span class="cog-state-badge cog-badge-undone">${escapeAttr(checklistText(`${KEY}.Undone`))}</span>`
    : `<button type="button" class="cog-btn" data-action="${POPULARITY_CHECKLIST_UNDO_ACTION}" data-gm-only="true"><i class="fa-solid fa-rotate-left"></i> ${escapeAttr(checklistText(`${KEY}.Undo`))}</button>`;
  return `<div class="cog-chat-card cog-popularity-checklist-card">
    <header class="cog-card-header"><h3><i class="fa-solid fa-star"></i> ${escapeAttr(checklistText(`${KEY}.Title`, { moment: momentLabel(record.moment) }))}</h3></header>
    <div class="cog-card-body">${crawlers}<div class="cog-card-actions">${control}</div></div>
  </div>`;
}

/**
 * Post the summary card for an applied record, to everyone. A record with a confirmed Rule Break stamps the card.
 * @returns {Promise<ChatMessage|null>}
 */
export async function postChecklistSummary(record) {
  if (typeof globalThis.ChatMessage?.create !== 'function') return null;
  const data = withFlags({
    speaker: { alias: checklistText(`${KEY}.Title`, { moment: momentLabel(record.moment) }) },
    content: renderChecklistSummary(record, { undone: false })
  }, { [POPULARITY_CHECKLIST_CARD_FLAG]: { id: record.id } });
  const broke = (record.entries ?? []).some((e) => e.ruleBreak === true);
  return globalThis.ChatMessage.create(broke ? withRuleBreak(data) : data);
}

/**
 * Mark the summary card undone (its Undo button becomes the badge) and post the short undo line, with one more line for
 * each crawler the undo took back below a Fan Box milestone.
 * @param {Array<{ actorId: string, milestones: number[] }>} [backBelow]
 */
export async function postChecklistUndone(record, message, backBelow = []) {
  try {
    if (message && typeof message.update === 'function') await message.update({ content: renderChecklistSummary(record, { undone: true }) });
  } catch (_) { /* the card may have been deleted; the undo line still posts */ }
  if (typeof globalThis.ChatMessage?.create !== 'function') return null;
  const boxes = (record.boxes ?? []).map((b) => `${nameOf(b.actorId)} (${lootBoxTierDef(b.tier).label})`).join(', ');
  const lines = [`<p>${escapeAttr(checklistText(`${KEY}.UndoneLine`, { moment: momentLabel(record.moment) }))}</p>`];
  if (boxes) lines.push(`<p>${escapeAttr(checklistText(`${KEY}.UndoneBoxes`, { boxes }))}</p>`);
  for (const { actorId, milestones } of backBelow) {
    lines.push(`<p>${escapeAttr(checklistText(`${KEY}.UndoneBelow`, { name: nameOf(actorId), milestones: milestones.join(', ') }))}</p>`);
  }
  return globalThis.ChatMessage.create(withFlags({
    speaker: { alias: checklistText(`${KEY}.Title`, { moment: momentLabel(record.moment) }) },
    content: `<div class="cog-chat-card cog-popularity-checklist-card">${lines.join('')}</div>`
  }, { [POPULARITY_CHECKLIST_CARD_FLAG]: { id: record.id, undone: true } }));
}

/**
 * Post the due card, a whisper to the GMs: what ended and one button that opens the checklist on that moment. The card
 * is the to-do; nothing opens by itself.
 * @param {'session'|'day'|'floor'} moment
 * @param {{ days?: number[], floor?: number }} [detail] the dungeon day indexes that ended; the floor left
 * @returns {Promise<ChatMessage|null>}
 */
export async function postDueCard(moment, detail = {}) {
  if (typeof globalThis.ChatMessage?.create !== 'function') return null;
  const days = (detail.days ?? []).map((d) => Number(d) + 1).filter(Number.isFinite);
  const what = checklistText(`${KEY}.Due.${moment}`, {
    days: days.length > 1 ? `${days[0]}-${days[days.length - 1]}` : String(days[0] ?? ''),
    floor: String(detail.floor ?? '')
  });
  const content = `<div class="cog-chat-card cog-popularity-checklist-card">
    <header class="cog-card-header"><h3><i class="fa-solid fa-star"></i> ${escapeAttr(checklistText(`${KEY}.Due.Title`))}</h3></header>
    <div class="cog-card-body"><p>${escapeAttr(what)}</p>
    <div class="cog-card-actions"><button type="button" class="cog-btn cog-btn-primary" data-action="${POPULARITY_CHECKLIST_OPEN_ACTION}" data-gm-only="true"><i class="fa-solid fa-clipboard-check"></i> ${escapeAttr(checklistText(`${KEY}.Due.Open`))}</button></div></div>
  </div>`;
  const whisper = globalThis.ChatMessage.getWhisperRecipients?.('GM')?.map((u) => u.id);
  return globalThis.ChatMessage.create(withFlags({
    speaker: { alias: checklistText(`${KEY}.Due.Title`) },
    content,
    ...(whisper?.length ? { whisper } : {})
  }, { [POPULARITY_CHECKLIST_DUE_FLAG]: { moment } }));
}
