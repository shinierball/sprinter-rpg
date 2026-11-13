/**
 * The patronage chat card: a short card in the `cog-chat-card` markup with a title, lines of text and a row of buttons
 * under each line. Every patronage notice (the class offer, an audition step, a gig) builds its own lines and posts them
 * here; there is no kind table. A GM button carries `data-gm-only="true"` so a player's client hides it.
 */
import { speakerOf, gmWhisper } from '../documents/actor/vehicle-drive-common.mjs';
import { ownerAndGmIds } from '../utils/owner-recipients.mjs';
import { escapeAttr } from '../utils/escape-attr.mjs';

/** One chat button. `data` keys are the attribute names after `data-` (`'actor-uuid'`), empty values are left out. */
function buttonHtml({ label, action, data = {}, gmOnly = false, icon = 'fa-arrow-right' }) {
  const attrs = Object.entries(data).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => ` data-${k}="${escapeAttr(v)}"`).join('');
  return `<button type="button" class="cog-btn" data-action="${escapeAttr(action)}"${attrs}${gmOnly ? ' data-gm-only="true"' : ''}><i class="fa-solid ${escapeAttr(icon)}"></i> ${escapeAttr(label)}</button>`;
}

/** The card's inner markup: escaped text, one button row per line that has buttons. */
function cardHtml({ title, icon = 'fa-handshake', lines = [] }) {
  const body = lines.map((line) => {
    const buttons = (line.buttons ?? []).map(buttonHtml).join('');
    return `<div class="cog-patron-line"><div class="cog-text-muted">${escapeAttr(line.text)}</div>${buttons ? `<div class="cog-card-actions">${buttons}</div>` : ''}</div>`;
  }).join('');
  return `<div class="cog-chat-card cog-patron-card">
    <header class="cog-card-header"><h3><i class="fa-solid ${escapeAttr(icon)}"></i> ${escapeAttr(title)}</h3></header>
    <div class="cog-card-body">${body}</div>
  </div>`;
}

/**
 * Post a patronage card.
 * @param {object} actor the crawler it concerns (the speaker)
 * @param {{ title: string, icon?: string, lines: { text: string, buttons?: { label: string, action: string, data?: object, gmOnly?: boolean, icon?: string }[] }[], audience?: 'gm'|'owners'|'all' }} card
 *   `audience`: the GMs (`gm`, the default), the crawler's owners and the GMs (`owners`), or everyone (`all`)
 * @returns {Promise<ChatMessage|null>} null when the card has no lines
 */
export async function postPatronCard(actor, { title, icon, lines = [], audience = 'gm' } = {}) {
  if (!lines.length || typeof globalThis.ChatMessage?.create !== 'function') return null;
  const data = { content: cardHtml({ title, icon, lines }), speaker: speakerOf(actor) };
  if (audience === 'gm') data.whisper = gmWhisper();
  else if (audience === 'owners') data.whisper = ownerAndGmIds(actor);
  return globalThis.ChatMessage.create(data);
}
