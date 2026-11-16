/**
 * Render-time line on an Evade card (core pp. 79-80): the Injury a Major Fail or Natural 1 earns after the fight and the
 * Advantage a Natural 20 or Amazing Success gives against that mob. Drawn from the card's own record every time it renders,
 * so a reroll or an assist moves it on every client. Built with createElement and textContent, so a name never goes
 * through innerHTML.
 */
import { readEvadeRecord } from '../../utils/attack/evade-link.mjs';
import { attackerUuidOf } from '../../utils/combat/card-flags.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { evadeAftermathText } from '../../documents/actor/evade-aftermath.mjs';

const CLASS = 'cog-evade-aftermath';
const KEY = 'COG.EvadeAftermath';

function line(doc, text) {
  const node = doc.createElement('p');
  node.className = `${CLASS}__line`;
  node.textContent = text;
  return node;
}

/**
 * Add the aftermath line to a rendered Evade card (nothing for any other card).
 * @param {HTMLElement} root the rendered message element
 * @param {ChatMessage} message
 */
export function renderEvadeAftermath(root, message) {
  const host = root?.querySelector?.('.message-content') ?? root;
  if (!host?.ownerDocument) return;
  host.querySelector?.(`.${CLASS}`)?.remove?.();
  const record = readEvadeRecord(message);
  if (!record) return;
  const { injury, advantage } = record.aftermath;
  if (!injury && !advantage) return;
  const doc = host.ownerDocument;
  const block = doc.createElement('div');
  block.className = CLASS;
  if (injury) {
    const noCombat = record.combatId ? '' : evadeAftermathText(`${KEY}.NoCombat`);
    block.append(line(doc, evadeAftermathText(`${KEY}.${injury === 'major' ? 'LineMajor' : 'LineMinor'}`) + noCombat));
  }
  if (advantage && record.combatId) {
    const attackCard = globalThis.game?.messages?.get?.(record.attackMessageId) ?? null;
    const attackerUuid = attackCard ? attackerUuidOf(attackCard) : null;
    if (attackerUuid) {
      const name = resolveActorByUuid(attackerUuid)?.name || evadeAftermathText(`${KEY}.ThisMob`);
      block.append(line(doc, evadeAftermathText(`${KEY}.LineAdvantage`, { mob: name })));
    }
  }
  if (!block.childNodes.length) return;
  const banner = host.querySelector?.('.cog-evade-result-banner');
  if (banner?.after) banner.after(block);
  else host.append(block);
}
