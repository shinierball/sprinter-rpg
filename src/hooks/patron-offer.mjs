/**
 * The class-selection offer starts here (core rulebook pp. 146, 315). A class tagged `rule.patron-required` must choose
 * a patron from the GM's offer. The active GM is told, once, when such a class lands on a crawler, whether through the
 * class applier, a drop, a plan write (`createItem`) or the Crawler Creator (`createActor`). Nothing is blocked.
 */
import { isActiveGM } from '../utils/gm-relay.mjs';
import { PATRON_TAGS } from '../data/tag-vocabulary.mjs';
import { activePatrons } from '../utils/patron/patronage-state.mjs';
import { postPatronCard } from '../chat/patron-card.mjs';
import { say } from '../documents/actor/vehicle-drive-common.mjs';

/** A class and its crawler arrive through two hooks in one creation; the offer is announced once per crawler in this window. */
const ANNOUNCE_WINDOW_MS = 5000;
const announced = new Map();

const requiresPatron = (item) => item?.type === 'class' && Array.from(item.system?.tags ?? []).includes(PATRON_TAGS.required);

/** Whisper the GM that a crawler must choose a patron, unless it has one or was just announced. */
async function announce(actor) {
  if (actor?.type !== 'crawler' || activePatrons(actor.items).length) return null;
  const at = Date.now();
  if (at - (announced.get(actor.uuid) ?? -Infinity) < ANNOUNCE_WINDOW_MS) return null;
  announced.set(actor.uuid, at);
  return postPatronCard(actor, {
    title: say('COG.Patron.Offer.Title', 'Patron'),
    lines: [{
      text: say('COG.Patron.Offer.Must', '{actor} must choose a patron (p. 146). Offer two or three.', { actor: actor.name }),
      buttons: [{ label: say('COG.Patron.Offer.Button', 'Offer patrons'), action: 'crawlerPatronOffer', data: { 'actor-uuid': actor.uuid }, gmOnly: true, icon: 'fa-handshake' }]
    }],
    audience: 'gm'
  });
}

const onItemCreated = (item) => (isActiveGM() && requiresPatron(item) ? announce(item.parent) : null);
const onActorCreated = (actor) => (isActiveGM() && Array.from(actor?.items ?? []).some(requiresPatron) ? announce(actor) : null);

let registered = false;
/** Once, from the ready hook. A `createItem` / `createActor` listener returns nothing. */
export function registerPatronOfferHooks() {
  if (registered) return;
  registered = true;
  globalThis.Hooks?.on?.('createItem', (item) => { onItemCreated(item); });
  globalThis.Hooks?.on?.('createActor', (actor) => { onActorCreated(actor); });
}
