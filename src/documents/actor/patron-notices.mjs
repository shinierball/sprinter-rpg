/**
 * The two GM notices a patronage ending can start (core rulebook p. 316): a patron's actor died, and the crawler
 * started worshipping a rival of the god who is their patron. Each only posts a card; the buttons on it call the endings
 * (`patron-endings.mjs`). Kept apart from them so the damage pipeline and the worship engine can call these without
 * importing the patronage engine, which imports the worship engine.
 */
import { activePatrons } from '../../utils/patron/patronage-state.mjs';
import { patronProfileOf } from '../../utils/patron/patron-profile.mjs';
import { areRivals, rivalsLookup } from '../../utils/deity/rivals.mjs';
import { deityIdOf } from '../../utils/deity/worship-state.mjs';
import { deityRecords } from '../../utils/deity/deity-names.mjs';
import { postPatronCard } from '../../chat/patron-card.mjs';
import { say } from './vehicle-drive-common.mjs';
import { baseActorOf } from './token-base-actor.mjs';

const playerCrawlers = () => Array.from(globalThis.game?.actors ?? []).filter((a) => a?.type === 'crawler' && a.hasPlayerOwner === true);

/**
 * A lethal hit on an actor who is a crawler's active patron (a patron item whose `actorUuid` is the victim's) tells the GM
 * once per such crawler, with the two ways it can have happened: the Bard killed them, or the killer becomes the patron.
 * Nothing is asked and nothing changes until the GM presses a button.
 * @param {object} victim the actor that took the hit
 * @param {object|null} killer the attacker, when known
 * @param {{ isLethal?: boolean }} [p]
 */
export async function noticePatronDeath(victim, killer, { isLethal = false } = {}) {
  if (!isLethal || !victim?.uuid) return;
  // An unlinked token's actor has its own uuid; the patron item holds the world actor's.
  const victimUuids = [victim.uuid, baseActorOf(victim)?.uuid].filter(Boolean);
  for (const crawler of playerCrawlers()) {
    const patrons = activePatrons(crawler.items).filter((i) => i.type === 'patron' && victimUuids.includes(patronProfileOf(i).actorUuid));
    for (const item of patrons) {
      const data = { 'actor-uuid': crawler.uuid, 'item-id': item.id };
      const buttons = [{
        label: say('COG.Patron.Ending.BardKilled', 'The Bard killed them'), action: 'crawlerPatronDeath',
        data: { ...data, 'killer-uuid': crawler.uuid }, gmOnly: true, icon: 'fa-skull'
      }];
      if (killer?.uuid && killer.uuid !== crawler.uuid) {
        buttons.push({
          label: say('COG.Patron.Ending.KillerPatron', 'Killer becomes patron'), action: 'crawlerPatronDeath',
          data: { ...data, 'killer-uuid': killer.uuid }, gmOnly: true, icon: 'fa-handshake'
        });
      }
      await postPatronCard(crawler, {
        title: say('COG.Patron.Ending.DeathTitle', 'A patron has died'),
        icon: 'fa-skull',
        lines: [{ text: say('COG.Patron.Ending.DeathLine', '{patron}, {actor}\'s patron, was killed (p. 316). Who killed them?', { patron: item.name, actor: crawler.name }), buttons }],
        audience: 'gm'
      });
    }
  }
}

/**
 * A crawler whose patron is a god and who has just started worshipping a rival of that god: the GM may end the patronage
 * (p. 316). One card per such patron.
 * @param {object} actor
 * @param {object} deityItem the god just worshipped
 */
export async function noticeRivalPatron(actor, deityItem) {
  const rivalsOf = rivalsLookup(deityRecords([actor]));
  const god = deityIdOf(deityItem);
  const rivalPatrons = activePatrons(actor?.items).filter((i) => i.type === 'deity' && i.id !== deityItem.id && areRivals(deityIdOf(i), god, rivalsOf));
  for (const patron of rivalPatrons) {
    await postPatronCard(actor, {
      title: say('COG.Patron.Ending.RivalTitle', 'Rival worship'),
      icon: 'fa-hands-praying',
      lines: [{
        text: say('COG.Patron.Ending.RivalLine', '{actor} now worships {god}, a rival of their patron {patron} (p. 316).', { actor: actor.name, god: deityItem.name, patron: patron.name }),
        buttons: [{
          label: say('COG.Patron.Ending.EndPatronage', 'End patronage'), action: 'crawlerPatronEndDeity',
          data: { 'actor-uuid': actor.uuid, 'item-id': patron.id, reason: say('COG.Patron.Ending.RivalReason', 'rival worship') }, gmOnly: true, icon: 'fa-ban'
        }]
      }],
      audience: 'gm'
    });
  }
}
