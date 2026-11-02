/**
 * Renders one row per damage application (with an Undo button) into a damage card.
 * Markup is built with createElement/textContent: targetName is user text and never goes through innerHTML.
 */
import { getDamageApplications } from '../damage-applications.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';

/**
 * @param {HTMLElement} root the rendered message element
 * @param {ChatMessage} message
 */
export function renderDamageApplications(root, message) {
  const entries = getDamageApplications(message);
  if (!entries.length) return;
  const card = root.querySelector('.cog-damage-card, .cog-chat-card') ?? root.querySelector('.message-content');
  if (!card) return;
  card.querySelectorAll('.cog-damage-applications').forEach(el => el.remove());

  const doc = root.ownerDocument;
  const isGM = Boolean(globalThis.game?.user?.isGM);
  const wrap = doc.createElement('div');
  wrap.className = 'cog-damage-applications';

  for (const e of entries) {
    const row = doc.createElement('div');
    row.className = 'cog-damage-application';
    if (e.undone) row.classList.add('is-undone');
    row.dataset.applicationId = e.applicationId;

    const name = doc.createElement('span');
    name.className = 'cog-damage-application-target';
    name.textContent = e.targetName;
    const amount = doc.createElement('span');
    amount.className = 'cog-damage-application-amount';
    amount.textContent = `${e.actualDamage} dmg`;
    row.append(name, amount);

    if (e.undone) {
      const badge = doc.createElement('span');
      badge.className = 'cog-state-badge cog-badge-undone';
      badge.textContent = '[UNDONE]';
      row.append(badge);
    } else if (isGM || resolveActorByUuid(e.targetUuid)?.isOwner === true) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'cog-undo-damage';
      button.dataset.action = 'crawlerUndoDamage';
      button.dataset.applicationId = e.applicationId;
      button.dataset.targetUuid = e.targetUuid;
      const icon = doc.createElement('i');
      icon.className = 'fa-solid fa-rotate-left';
      button.append(icon, ' Undo');
      row.append(button);
    }
    wrap.append(row);
    if (e.lines.length) {
      // Breakdown lines hold row labels (user text): textContent only
      const list = doc.createElement('ul');
      list.className = 'cog-damage-application-lines';
      for (const line of e.lines) {
        const item = doc.createElement('li');
        item.className = `cog-damage-application-line cog-line-${line.stage}`;
        item.textContent = line.text;
        list.append(item);
      }
      wrap.append(list);
    }
  }
  card.append(wrap);
}
