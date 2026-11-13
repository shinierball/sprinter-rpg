/**
 * The patron block on a rendered skill check card (core rulebook pp. 315-316): a card rolled for a patron (an audition
 * check, later a gig) names the patron and offers the button that applies it. The card's own content is never rewritten,
 * so the block shows the state at render time (an applied step, a paid gig).
 */
import { readCheckRecord, effectiveCheck } from '../../utils/roll/check-assists.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { GIG_PAID_FLAG } from '../../documents/actor/patron-gig.mjs';
import { patronageOf } from '../../utils/patron/patronage-state.mjs';
import { say } from '../../documents/actor/vehicle-drive-common.mjs';

const text = (key, fallback, data) => say(`COG.Patron.Audition.Check.${key}`, fallback, data);
const attitudeName = (attitude) => say(`COG.Patron.Audition.Attitude.${attitude}`, String(attitude).charAt(0).toUpperCase() + String(attitude).slice(1));

function el(doc, tag, className, content) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

/** The audition branch: the patron, then [Apply to audition] or the applied line. */
function auditionBlock(doc, block, message, record, actor, item) {
  const user = globalThis.game?.user;
  block.append(el(doc, 'p', 'cog-patron-check__who', text('Who', 'Audition for {patron}', { patron: item.name })));
  const patronage = patronageOf(item);
  const applied = patronage.audition.checks.find((c) => c.messageId === message.id);
  if (applied) {
    block.append(el(doc, 'p', 'cog-patron-check__applied', text('Applied', 'Applied: {from} -> {to}', { from: attitudeName(applied.from), to: attitudeName(applied.to) })));
    return;
  }
  const mine = Boolean(user?.isGM || actor.testUserPermission?.(user, 'OWNER'));
  if (!user?.isGM && effectiveCheck(record).pending && patronage.audition.dc === null) {
    block.append(el(doc, 'p', 'cog-patron-check__waiting', text('Waiting', 'Waiting for the GM to set the Difficulty')));
    return;
  }
  if (mine && patronage.status === 'auditioning') {
    const button = el(doc, 'button', 'cog-patron-check__btn', text('Apply', 'Apply to audition'));
    button.type = 'button';
    button.dataset.action = 'crawlerPatronAudition';
    block.append(button);
  }
}

/** The gig branch: the patron and the hour spent, then [Pay gig] (GM) until paid, then the paid line. */
function gigBlock(doc, block, message, item) {
  const gig = (key, fallback, data) => say(`COG.Patron.Gig.Check.${key}`, fallback, data);
  block.append(el(doc, 'p', 'cog-patron-check__who', gig('Who', 'Gig for {patron}: 1 hour', { patron: item.name })));
  const paid = message.flags?.[SYSTEM_ID]?.[GIG_PAID_FLAG];
  if (paid) {
    block.append(el(doc, 'p', 'cog-patron-check__applied', gig('Paid', 'Paid: {net} gold', { net: Number(paid.net) || 0 })));
    return;
  }
  if (globalThis.game?.user?.isGM) {
    const button = el(doc, 'button', 'cog-patron-check__btn', gig('Pay', 'Pay gig'));
    button.type = 'button';
    button.dataset.action = 'crawlerPatronGig';
    button.dataset.gmOnly = 'true';
    block.append(button);
  }
}

/**
 * Add the patron block to a rendered check card (nothing for any other card).
 * @param {HTMLElement} root the rendered message element
 * @param {ChatMessage} message
 */
export function renderPatronCheck(root, message) {
  const record = readCheckRecord(message);
  const ref = record?.patron;
  const host = root?.querySelector?.('.message-content') ?? root;
  if (!ref || !host?.ownerDocument) return;
  host.querySelector?.('.cog-patron-check')?.remove?.();
  const actor = globalThis.fromUuidSync?.(record.rollerUuid) ?? null;
  const item = actor?.items.get(ref.itemId) ?? null;
  if (!actor || !item) return;
  const doc = host.ownerDocument;
  const block = el(doc, 'div', 'cog-patron-check');
  block.dataset.patronKind = ref.kind;
  if (ref.kind === 'audition') auditionBlock(doc, block, message, record, actor, item);
  else if (ref.kind === 'gig') gigBlock(doc, block, message, item);
  if (block.childNodes.length) host.append(block);
}
