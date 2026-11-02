/**
 * "Cast Spell (0 Mana)" chat button on an item/consumable card.
 */
import { COGItem } from '../../documents/item.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';

/**
 * The spell a cast button names: the actor's item with `spellId`, else its spell with
 * `spellIdentifier`, else the catalog spell with that identifier (or id). Names are never matched.
 */
export function resolveCardSpell(actor, { spellId = '', spellIdentifier = '' } = {}) {
  const items = actor?.items;
  const byId = spellId ? (items?.get(spellId) ?? items?.find(it => it.id === spellId)) : null;
  if (byId) return byId;
  const owned = spellIdentifier ? items?.find(it => it.type === 'spell' && it.system?.identifier === spellIdentifier) : null;
  return owned || findCatalogEntry('spells', spellIdentifier) || findCatalogEntry('spells', spellId);
}

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleCastSpell(event, button, message) {
  const actorUuid = button.dataset?.actorUuid;
  const spellId = String(button.dataset?.spellId ?? '').trim();
  const spellIdentifier = String(button.dataset?.spellIdentifier ?? '').trim();
  const isFreeCast = button.dataset?.freeCast === 'true';

  let actor = resolveActorByUuid(actorUuid);
  if (!actor && canvas?.tokens?.controlled?.length) {
    actor = canvas.tokens.controlled[0]?.actor;
  }
  if (!actor) {
    ui.notifications?.warn?.('Sprinter RPG | No actor selected to cast this spell effect!');
    return;
  }

  const spell = resolveCardSpell(actor, { spellId, spellIdentifier });

  if (spell && typeof actor.rollSpell === 'function') {
    await actor.rollSpell(spell, { freeCast: isFreeCast, isItemEffect: true, isConsumable: true });
  } else if (spell) {
    await COGItem.rollSpellCard(spell, { freeCast: isFreeCast, isItemEffect: true, isConsumable: true });
  }
}
