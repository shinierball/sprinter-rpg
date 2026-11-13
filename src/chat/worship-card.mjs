/**
 * GM-only chat notices about worship. Each is a whisper to the GMs in the `cog-chat-card` markup; the GM decides what,
 * if anything, follows (the system never applies a penalty by itself).
 */
import { say, speakerOf, gmWhisper } from '../documents/actor/vehicle-drive-common.mjs';
import { WORSHIP_TAGS } from '../data/tag-vocabulary.mjs';
import { WORSHIP_TABLE_RECIPES } from '../utils/deity/worship-tables.mjs';
import { findBookTable } from '../sourcery/book-tables.mjs';
import { escapeAttr } from '../utils/escape-attr.mjs';

const DIVINE_DEBUFF_TAG = WORSHIP_TAGS.divine;

/** One chat button. `attrs` are data attributes, already escaped values by key. */
const button = (action, icon, label, attrs = {}) => {
  const data = Object.entries(attrs).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => ` data-${k}="${escapeAttr(v)}"`).join('');
  return `<button type="button" class="cog-btn" data-action="${action}"${data}><i class="fa-solid ${icon}"></i> ${escapeAttr(label)}</button>`;
};

/** A [Boon] or [Smite] button that opens the gift dialog for this actor and god. */
const giftButton = (actor, deity, mode, label, filterTag = '') => button('crawlerDeityGift', mode === 'boon' ? 'fa-gift' : 'fa-bolt', label, {
  mode, 'actor-uuid': actor?.uuid ?? '', 'item-id': deity?.id ?? '', 'filter-tag': filterTag
});

/** The buttons for a Divine Debuff: the book's Table 64 when the import made it, and a pick from the tagged debuffs. */
const divineButtons = (actor, deity, tableUuid) => [
  tableUuid ? button('crawlerDrawTable', 'fa-dice-d20', say('COG.Deity.Notice.RollTable64', 'Roll Table 64'), { 'table-uuid': tableUuid, 'table-name': 'Table 64' }) : '',
  giftButton(actor, deity, 'smite', say('COG.Deity.Notice.Pick', 'Pick'), DIVINE_DEBUFF_TAG)
];

/** The buttons for Fallen from Grace: apply it, and roll the book's chance of being smitten as well. */
const fallenButtons = (actor, deity) => {
  const ids = { 'actor-uuid': actor?.uuid ?? '', 'item-id': deity?.id ?? '' };
  return [
    button('crawlerDeityFallen', 'fa-person-falling', say('COG.Deity.Notice.Apply', 'Apply'), ids),
    button('crawlerDeitySmiteChance', 'fa-dice-d20', say('COG.Deity.Notice.RollSmiteChance', 'Roll smite chance'), ids)
  ];
};

/**
 * The notice kinds. `rows(ctx, tableUuid)` returns `[{ text, buttons }]`: one row per line the card shows.
 * `devotion` rows come from `ctx.entries` (one per crawler and god the sweep changed).
 */
const NOTICES = Object.freeze({
  smiteDue: {
    icon: 'fa-hands-praying',
    title: ['COG.Deity.Notice.SmiteDueTitle', 'Smite due'],
    rows: ({ actor, deity, reason }) => [{
      text: reason === 'offenses'
        ? say('COG.Deity.Notice.SmiteDueOffenses', '{actor} has offended {deity} three times (p. 312): roll or pick a smite for them.', { actor: actor?.name ?? '', deity: deity?.name ?? '' })
        : say('COG.Deity.Notice.SmiteDue', '{actor} left the faith of {deity}. Leaving voluntarily means being smote (p. 163): roll or pick a smite for them.', { actor: actor?.name ?? '', deity: deity?.name ?? '' }),
      buttons: [giftButton(actor, deity, 'smite', say('COG.Deity.Notice.SmiteButton', 'Smite'))]
    }]
  },
  boonDue: {
    icon: 'fa-gift',
    title: ['COG.Deity.Notice.BoonDueTitle', 'Boon due'],
    rows: ({ actor, deity }) => [{
      text: say('COG.Deity.Notice.BoonDue', '{actor} has kept up the offerings to {deity}: a Boon is due (p. 164).', { actor: actor?.name ?? '', deity: deity?.name ?? '' }),
      buttons: [giftButton(actor, deity, 'boon', say('COG.Deity.Notice.BoonButton', 'Boon'))]
    }]
  },
  offense: {
    icon: 'fa-triangle-exclamation',
    title: ['COG.Deity.Notice.OffenseTitle', 'Offense'],
    rows: ({ actor, deity }, tableUuid) => [{
      text: say('COG.Deity.Notice.Offense', '{actor} offended {deity} and is Shunned: its worship benefits are withheld until penance is paid (p. 312). A Divine Debuff may follow.', { actor: actor?.name ?? '', deity: deity?.name ?? '' }),
      buttons: divineButtons(actor, deity, tableUuid)
    }]
  },
  infidels: {
    icon: 'fa-skull',
    title: ['COG.Deity.Obligations.InfidelsTitle', 'Death to the Infidels'],
    rows: ({ actor, victim, god, rival }) => [{
      text: say('COG.Deity.Obligations.InfidelsLine', '{actor} killed {victim}, who worships {rival}, a rival of {god}: Death to the Infidels (p. 164), one Level once per Floor.', {
        actor: actor?.name ?? '', victim: victim?.name ?? '', god: god ?? '', rival: rival ?? ''
      }),
      buttons: [button('crawlerDeityInfidels', 'fa-arrow-up', say('COG.Deity.Obligations.AwardLevel', 'Award Level'), { 'actor-uuid': actor?.uuid ?? '' })]
    }]
  },
  devotion: {
    icon: 'fa-hands-praying',
    title: ['COG.Deity.Notice.DevotionTitle', 'Devotion'],
    rows: ({ entries = [] }, tableUuid) => entries.map(({ actor, deity, notice, missedDays }) => {
      const data = { actor: actor?.name ?? '', deity: deity?.name ?? '', days: missedDays ?? '' };
      if (notice === 'fallenDue') {
        return {
          text: say('COG.Deity.Notice.FallenDue', '{actor} has missed {days} days of offerings to {deity}: Fallen from Grace is due (p. 163).', data),
          buttons: fallenButtons(actor, deity)
        };
      }
      if (notice === 'divineDue') {
        return {
          text: say('COG.Deity.Notice.DivineDue', '{actor} has missed {days} days of offerings to {deity}: a Divine Debuff is due (p. 163).', data),
          buttons: divineButtons(actor, deity, tableUuid)
        };
      }
      return {
        text: say('COG.Deity.Notice.Lapsed', '{actor} missed an offering to {deity}: its worship benefits are withheld until the next offering (p. 163).', data),
        buttons: []
      };
    })
  }
});

/**
 * Build the card HTML for a notice.
 * @param {'smiteDue'|'boonDue'|'offense'|'devotion'|'infidels'} kind
 * @param {{ actor?: object, deity?: object, reason?: string, entries?: object[], victim?: object, god?: string, rival?: string }} ctx
 * @param {string|null} [tableUuid] the imported Table 64, when there is one
 * @returns {string|null} null for an unknown kind or a card with no rows
 */
function buildWorshipNotice(kind, ctx = {}, tableUuid = null) {
  const notice = NOTICES[kind];
  if (!notice) return null;
  const rows = notice.rows(ctx, tableUuid);
  if (!rows.length) return null;
  const body = rows.map((row) => `<div class="cog-worship-line"><div class="cog-text-muted">${escapeAttr(row.text)}</div>${row.buttons.filter(Boolean).length ? `<div class="cog-card-actions">${row.buttons.filter(Boolean).join('')}</div>` : ''}</div>`).join('');
  return `<div class="cog-chat-card cog-worship-card">
    <header class="cog-card-header"><h3><i class="fa-solid ${escapeAttr(notice.icon)}"></i> ${escapeAttr(say(notice.title[0], notice.title[1]))}</h3></header>
    <div class="cog-card-body">${body}</div>
  </div>`;
}

/**
 * Whisper a worship notice to the GMs.
 * @param {'smiteDue'|'boonDue'|'offense'|'devotion'|'infidels'} kind
 * @param {{ victim?: object, god?: string, rival?: string, actor?: object, deity?: object, reason?: string, entries?: { actor: object, deity: object, notice: string, missedDays?: number }[] }} ctx
 * @returns {Promise<ChatMessage|null>}
 */
export async function postWorshipNotice(kind, ctx = {}) {
  const needsTable = kind === 'offense' || kind === 'devotion';
  const tableUuid = needsTable ? await findBookTable(WORSHIP_TABLE_RECIPES.divineDebuffs) : null;
  const content = buildWorshipNotice(kind, ctx, tableUuid);
  if (!content || typeof globalThis.ChatMessage?.create !== 'function') return null;
  return globalThis.ChatMessage.create({ content, speaker: speakerOf(ctx.actor ?? ctx.entries?.[0]?.actor), whisper: gmWhisper() });
}
