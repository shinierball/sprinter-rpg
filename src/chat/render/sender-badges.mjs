/**
 * Render-time work: enhance the message sender with Crawler Trophy Badges (Boss Stars & Skulls).
 */
import { resolveSpeakerActor } from '../../utils/actor-uuid.mjs';

/**
 * @param {HTMLElement} root the rendered message element
 * @param {ChatMessage} message
 */
export function addSenderBadges(root, message) {
  try {
    const speakerActor = resolveSpeakerActor(message?.speaker);
    if (speakerActor && typeof speakerActor.getBadgeSummary === 'function') {
      const badges = speakerActor.getBadgeSummary();
      if (badges.hasBadges) {
        const senderElems = Array.from(root.querySelectorAll('.message-sender, .message-header .sender'));
        for (const senderEl of senderElems) {
          if (senderEl && !senderEl.querySelector?.('.cog-badge-strip') && !senderEl.dataset?.cogBadges) {
            if (senderEl.dataset) senderEl.dataset.cogBadges = 'true';
            const badgeSpan = (typeof document !== 'undefined' && typeof document.createElement === 'function')
              ? document.createElement('span')
              : { className: 'cog-sender-badges', innerHTML: ' ' + badges.html };
            if (badgeSpan) {
              badgeSpan.className = 'cog-sender-badges';
              badgeSpan.innerHTML = ' ' + badges.html;
              if (typeof senderEl.appendChild === 'function') {
                senderEl.appendChild(badgeSpan);
              } else if (typeof $ !== 'undefined') {
                $(senderEl).append(` <span class="cog-sender-badges">${badges.html}</span>`);
              }
            } else if (typeof $ !== 'undefined') {
              $(senderEl).append(` <span class="cog-sender-badges">${badges.html}</span>`);
            }
          }
        }
      }
    }
  } catch (err) {
    // Graceful fallback
  }
}
