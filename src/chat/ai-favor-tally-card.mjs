/**
 * End-of-combat AI Favor tally.
 *
 * The book awards a weapon's or skill's AI Favor once per combat, when the crawler used that attack for most of
 * their attacks in a combat of at least three rounds. When a combat ends, this builds one GM-only card that proposes
 * the award per crawler and attack, each with an Apply button. The conditions are shown, not enforced: a line that
 * fails them is still offered and Apply asks for a Rule Break confirm. Nothing is awarded automatically.
 *
 * Sources are structured only: each attack card stores `flags.sprinter-rpg.attackItemId` / `aiFavorBonus` and a check
 * record with `combatId` and `rollerUuid`. Card text is never read.
 */
import { ruleBreakBadgeHtml } from '../utils/rule-break-visibility.mjs';
import { readCheckRecord } from '../utils/roll/check-assists.mjs';
import { isMobSide } from '../utils/combat/combat-sides.mjs';
import { attackCardOf, attackerIdOf } from '../utils/combat/card-flags.mjs';
import { flagPath, readFlag, withFlags } from '../utils/flags.mjs';
import { escapeAttr } from '../utils/escape-attr.mjs';
import { langText } from '../utils/lang-text.mjs';

const AI_FAVOR_TALLY_FLAG = 'aiFavorTally';

/** The tally a card stores (its lines and which of them were applied); undefined on any other card. */
export const aiFavorTallyOf = (message) => readFlag(message, AI_FAVOR_TALLY_FLAG);

/** The update that records one applied line of a tally card. */
export const aiFavorAppliedPath = (lineId) => flagPath(`${AI_FAVOR_TALLY_FLAG}.applied.${lineId}`);
const AI_FAVOR_TALLY_ACTION = 'crawlerApplyAiFavorTally';
/** The book's minimum number of rounds. */
const BOOK_MIN_ROUNDS = 3;

const TEMPLATES = {
  'COG.AiFavorTally.Title': 'AI Favor Tally',
  'COG.AiFavorTally.Hint': 'Proposed awards for this combat. Nothing is awarded until you press Apply.',
  'COG.AiFavorTally.Line': '{item}: AI Favor rating {value} ({k} of {m} attacks, {r} rounds)',
  'COG.AiFavorTally.Apply': 'Apply +{value}',
  'COG.AiFavorTally.Applied': 'Applied',
  'COG.AiFavorTally.BelowBook': 'Does not meet the book conditions (3+ rounds, most of the attacks)',
  'COG.AiFavorTally.RuleBreakTitle': 'AI Favor Tally',
  'COG.AiFavorTally.RuleBreakMessage': '{item} was {k} of {m} attacks over {r} rounds. Award +{value} AI Favor as a Rule Break?',
  'COG.AiFavorTally.RuleBreakReason': '{item} was {k} of {m} attacks over {r} rounds.',
  'COG.AiFavorTally.AlreadyApplied': 'This line was already applied.',
  'COG.AiFavorTally.GmOnly': 'Only the GM can apply the AI Favor tally.',
  'COG.AiFavorTally.NoActor': 'The crawler for this line was not found.',
  'COG.AiFavorTally.Done': '{actor} gains +{value} AI Favor.',
  'COG.AiFavorTally.ChatReason': 'Combat tally: {item}'
};

/** Localized text with an English fallback when no i18n is loaded. */
export const tallyText = langText(TEMPLATES);


const asList = (collection) => {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  return [...collection];
};

/** The chat messages in the world, as an array. */
function worldMessages() {
  return asList(globalThis.game?.messages);
}

function itemOf(actor, itemId) {
  const items = actor?.items;
  if (!items) return null;
  if (typeof items.get === 'function') return items.get(itemId) ?? null;
  return asList(items).find(i => (i.id ?? i._id) === itemId) ?? null;
}

/**
 * Build the tally lines for a combat. Pure apart from reading the actors' items and ratings. A crawler's most-used
 * attack(s) get a line (a tie gives every tied attack one); an attack with no AI Favor rating gets none.
 * @param {object} p
 * @param {object} p.combat a combat (`id`, `round`, `combatants`)
 * @param {object[]} [p.messages] chat messages to scan (default: every world message)
 * @returns {Array<{ id: string, actorUuid: string, actorName: string, itemId: string, itemName: string,
 *   value: number, k: number, m: number, rounds: number, meetsBook: boolean }>}
 */
export function buildAiFavorTally({ combat, messages = worldMessages() } = {}) {
  const combatId = combat?.id;
  if (!combatId) return [];
  const rounds = Math.max(1, Number(combat.round) || 0);

  const cards = [];
  for (const message of messages) {
    const flags = attackCardOf(message);
    if (!flags) continue;
    const itemId = typeof flags.attackItemId === 'string' ? flags.attackItemId : '';
    if (!itemId) continue;
    const record = readCheckRecord(message);
    if (!record || record.combatId !== combatId) continue;
    cards.push({ itemId, rollerUuid: String(record.rollerUuid ?? ''), attackerId: attackerIdOf(message) ?? null, bonus: flags.aiFavorBonus });
  }

  const lines = [];
  const seen = new Set();
  for (const combatant of asList(combat.combatants)) {
    const actor = combatant?.actor;
    if (!actor || actor.type !== 'crawler' || isMobSide({ actor, token: combatant.token })) continue;
    const key = actor.uuid ?? actor.id;
    if (seen.has(key)) continue;
    seen.add(key);

    const mine = cards.filter(c => (c.rollerUuid ? c.rollerUuid === actor.uuid : c.attackerId === actor.id));
    const m = mine.length;
    if (!m) continue;
    const perItem = new Map();
    for (const card of mine) perItem.set(card.itemId, [...(perItem.get(card.itemId) ?? []), card]);
    const top = Math.max(...[...perItem.values()].map(list => list.length));

    for (const [itemId, list] of perItem) {
      if (list.length !== top) continue;
      const item = itemOf(actor, itemId);
      // A conditional row counts only when it matched on the card: the card records the rating it used.
      const recorded = list.map(c => c.bonus).filter(b => typeof b === 'number' && Number.isFinite(b));
      const value = recorded.length
        ? Math.max(...recorded)
        : (item && typeof actor.getAiFavorRating === 'function' ? Number(actor.getAiFavorRating(item).value) || 0 : 0);
      if (!(value > 0)) continue;
      const k = list.length;
      lines.push({
        id: `l${lines.length}`,
        actorUuid: actor.uuid ?? '',
        actorName: actor.name ?? combatant.name ?? '',
        itemId,
        itemName: item?.name ?? '',
        value,
        k,
        m,
        rounds,
        meetsBook: rounds >= BOOK_MIN_ROUNDS && k > m / 2
      });
    }
  }
  return lines;
}

/**
 * The card HTML. `applied` maps a line id to `{ ruleBreak }` once that line was applied.
 * @param {object[]} lines from buildAiFavorTally
 * @param {Record<string, { ruleBreak?: boolean }>} [applied]
 * @returns {string}
 */
export function renderAiFavorTallyCard(lines, applied = {}) {
  const rows = lines.map((line) => {
    const done = applied?.[line.id];
    const text = tallyText('COG.AiFavorTally.Line', { item: line.itemName || '?', value: line.value, k: line.k, m: line.m, r: line.rounds });
    const warn = line.meetsBook ? '' : ` <span class="cog-text-gold">${escapeAttr(tallyText('COG.AiFavorTally.BelowBook'))}</span>`;
    const control = done
      ? `<span class="cog-text-success" style="font-weight: bold;">${escapeAttr(tallyText('COG.AiFavorTally.Applied'))}${done.ruleBreak ? ` ${ruleBreakBadgeHtml({ cls: '' })}` : ''}</span>`
      : `<button type="button" class="cog-bg-accent-fill cog-text-on-fill" data-action="${AI_FAVOR_TALLY_ACTION}" data-line-id="${escapeAttr(line.id)}" data-actor-uuid="${escapeAttr(line.actorUuid)}" data-item-id="${escapeAttr(line.itemId)}" data-value="${escapeAttr(line.value)}" data-meets-book="${line.meetsBook ? 'true' : 'false'}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">${escapeAttr(tallyText('COG.AiFavorTally.Apply', { value: line.value }))}</button>`;
    return `<li style="margin-bottom: 6px;"><strong>${escapeAttr(line.actorName)}</strong><br/>${escapeAttr(text)}${warn}<div style="margin-top: 3px;">${control}</div></li>`;
  }).join('');
  return `
    <div class="cog-chat-card cog-ai-favor-tally-card cog-bg-window cog-text-strong" style="border: 2px solid var(--cog-accent); border-radius: 6px; padding: 12px; font-family: 'Oswald', sans-serif;">
      <div class="cog-bg-accent-fill cog-text-on-fill" style="text-transform: uppercase; font-size: 11px; letter-spacing: 1.5px; padding: 5px 8px; border-radius: 3px; font-weight: bold; text-align: center;">${escapeAttr(tallyText('COG.AiFavorTally.Title'))}</div>
      <div class="cog-text-secondary" style="margin-top: 6px; font-size: 11px;">${escapeAttr(tallyText('COG.AiFavorTally.Hint'))}</div>
      <ul style="margin: 8px 0 0 16px; padding: 0; font-size: 12px;">${rows}</ul>
    </div>
  `;
}

/**
 * Post the tally for a finished combat to the GMs, or return null when no crawler has a line. Nothing is awarded.
 * @param {object} combat
 * @param {object} [options]
 * @param {object[]} [options.messages]
 * @returns {Promise<object|null>} the created message
 */
export async function postAiFavorTallyCard(combat, { messages } = {}) {
  const lines = buildAiFavorTally({ combat, messages });
  if (!lines.length) return null;
  const whisper = globalThis.ChatMessage?.getWhisperRecipients?.('GM')?.map(u => u.id);
  return globalThis.ChatMessage.create(withFlags({
    speaker: { alias: tallyText('COG.AiFavorTally.Title') },
    content: renderAiFavorTallyCard(lines),
    ...(whisper?.length ? { whisper } : {})
  }, { [AI_FAVOR_TALLY_FLAG]: { combatId: combat.id, lines, applied: {} } }));
}
