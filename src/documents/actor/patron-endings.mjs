/**
 * The ways a patronage ends (core rulebook p. 316), as plain functions over a crawler and its embedded patron or deity
 * item: a patron quits (the showrunners are owed a fee, and the Bard may transfer to another patron), a patron dies (the
 * Bard killed them, or someone else did and becomes the patron), or a god ends it. The GM presses every one.
 */
import { say } from './vehicle-drive-common.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { itemIdentifier, slugifyIdentifier } from '../../utils/identifier.mjs';
import { TERMINATION_FEE_PERCENT, terminationFee } from '../../utils/patron/endings.mjs';
import { freshPatronage, patronageOf } from '../../utils/patron/patronage-state.mjs';
import { patronProfileOf } from '../../utils/patron/patron-profile.mjs';
import { postPatronCard } from '../../chat/patron-card.mjs';
import { addPatronProspect, becomePatron, endPatronage } from './patronage.mjs';
import { isRankedItem } from '../../utils/document-types.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

let transferOpener = null;

/**
 * Register the function that opens the patron picker for a transfer (the picker module calls this when it loads). Null clears it.
 * @param {((actor: object, fromItem: object) => unknown)|null} fn
 */
export function setPatronTransferOpener(fn) {
  transferOpener = typeof fn === 'function' ? fn : null;
}

/**
 * Open the picker so the GM may choose the patron a Bard transfers to. GM only.
 * @returns {unknown} whatever the picker returns, or null when nothing opened
 */
export function openPatronTransfer(actor, fromItem) {
  if (!globalThis.game?.user?.isGM || !actor || !transferOpener) return null;
  return transferOpener(actor, fromItem);
}

/**
 * A patron quits (p. 316): the patronage becomes `former`/`quit` and the GM gets the termination fee line (half of what the
 * patron earned from the Bard, rounded down) with a [Transfer] button.
 * @param {object} actor
 * @param {object} item an embedded patron item
 */
export async function quitPatronage(actor, item) {
  const result = await endPatronage(actor, item, { endedBy: 'quit' });
  if (!result.ok) return result;
  const earned = patronageOf(item).earned;
  const fee = terminationFee(earned);
  await postPatronCard(actor, {
    title: say('COG.Patron.Ending.QuitTitle', '{patron} quits', { patron: item.name }),
    icon: 'fa-door-open',
    lines: [{
      text: say('COG.Patron.Ending.Fee', 'Termination fee owed to the showrunners: {fee} gold ({percent}% of {earned})', { fee, percent: TERMINATION_FEE_PERCENT, earned }),
      buttons: [{
        label: say('COG.Patron.Ending.Transfer', 'Transfer'), action: 'crawlerPatronTransfer',
        data: { 'actor-uuid': actor.uuid, 'item-id': item.id }, gmOnly: true, icon: 'fa-right-left'
      }]
    }],
    audience: 'gm'
  });
  return { ...result, fee };
}

/**
 * Move the Bard to another patron after the last one quit (p. 316): the new patron is embedded and made active `via:
 * 'transfer'`, which asks the criteria as a direct choice does.
 * @param {object} actor
 * @param {object} fromItem the patron that quit
 * @param {object} newDoc the chosen patron (a world, pack or catalog document)
 */
export async function transferPatronage(actor, fromItem, newDoc) {
  const chosen = await addPatronProspect(actor, newDoc);
  if (!chosen) return { ok: false, ruleBreak: false, reason: 'no-patron' };
  if (chosen.id === fromItem?.id) return { ok: false, ruleBreak: false, reason: 'same-patron' };
  return becomePatron(actor, chosen, { via: 'transfer' });
}

/** The creation data for a patron item made from an actor: name, image, a link, the Skills and Spells it owns. */
function patronFromActor(killer) {
  const known = Array.from(killer.items ?? []).filter(isRankedItem).map(itemIdentifier);
  return {
    name: killer.name,
    type: 'patron',
    img: killer.img,
    system: {
      identifier: slugifyIdentifier(killer.name),
      actorUuid: killer.uuid,
      skills: [...new Set(known)],
      messaging: killer.type === 'crawler' ? 'hud' : 'fairy',
      patronage: freshPatronage('prospect')
    }
  };
}

/** The Bard's choice: the Bard, or one of the world's other actors. Resolves an actor uuid, or '' when closed. */
async function askKiller(actor, item) {
  const Dialog = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof Dialog?.prompt !== 'function') return '';
  const linked = patronProfileOf(item).actorUuid;
  const others = Array.from(globalThis.game?.actors ?? []).filter((a) => a?.uuid && a.uuid !== actor.uuid && a.uuid !== linked);
  const option = (uuid, label) => `<option value="${escapeAttr(uuid)}">${escapeAttr(label)}</option>`;
  const content = `<p>${escapeAttr(say('COG.Patron.Ending.WhoKilled', 'Who killed them?'))}</p>
    <select name="killer">${option(actor.uuid, actor.name)}${others.map((a) => option(a.uuid, a.name)).join('')}</select>`;
  try {
    const picked = await Dialog.prompt({
      window: { title: say('COG.Patron.Ending.WhoKilledTitle', '{patron} died', { patron: item.name }) },
      content,
      ok: { label: say('COG.Patron.Ending.Confirm', 'Confirm'), callback: (event, button) => String(firstScalar(button.form?.elements?.killer?.value, '')) },
      rejectClose: false
    });
    return typeof picked === 'string' ? picked : '';
  } catch {
    return '';
  }
}

/**
 * A patron died (p. 316). When `killerUuid` is the Bard the patronage ends `murdered` (it bans a new patron this Floor and
 * makes the next audition start Opposed). When it is someone else the patronage ends `died` and the killer becomes the
 * patron, active `via: 'killer'`, with no criteria asked. Without a `killerUuid` the GM is asked who killed them.
 * @param {object} actor the Bard
 * @param {object} item the embedded patron item
 * @param {{ killerUuid?: string }} [p]
 */
export async function patronDied(actor, item, { killerUuid = '' } = {}) {
  const uuid = killerUuid || await askKiller(actor, item);
  if (!uuid) return { ok: false, ruleBreak: false, reason: 'cancelled' };
  if (uuid === actor.uuid) return endPatronage(actor, item, { endedBy: 'murdered' });
  const killer = await globalThis.fromUuid?.(uuid);
  const ended = await endPatronage(actor, item, { endedBy: 'died' });
  if (!killer || !ended.ok) return ended;
  const existing = Array.from(actor.items ?? []).find((i) => i.type === 'patron' && patronProfileOf(i).actorUuid === killer.uuid);
  const created = existing ?? await addPatronProspect(actor, patronFromActor(killer));
  if (!created) return ended;
  return becomePatron(actor, created, { via: 'killer', gated: true });
}

/**
 * A god ends its patronage (p. 316; its worshipper turned to a rival, or it simply tires of the Bard). The reason is for the card.
 * @param {object} actor
 * @param {object} deityItem
 * @param {string} [reason]
 */
export async function endDeityPatronage(actor, deityItem, reason = '') {
  const result = await endPatronage(actor, deityItem, { endedBy: 'ended' });
  if (!result.ok) return result;
  const why = String(firstScalar(reason, '') ?? '').trim();
  await postPatronCard(actor, {
    title: say('COG.Patron.Ending.EndedTitle', '{patron} ends the patronage', { patron: deityItem.name }),
    icon: 'fa-ban',
    lines: [{ text: why
      ? say('COG.Patron.Ending.EndedWhy', '{patron} is no longer {actor}\'s patron: {reason}', { patron: deityItem.name, actor: actor.name, reason: why })
      : say('COG.Patron.Ending.Ended', '{patron} is no longer {actor}\'s patron', { patron: deityItem.name, actor: actor.name }) }],
    audience: 'owners'
  });
  return result;
}
