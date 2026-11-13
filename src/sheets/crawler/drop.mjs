/**
 * Item and actor drops onto the crawler sheet.
 *
 * Items: race/class apply, a deity is learned of and a patron added as a prospect, drops onto a hotlist or external buff slot
 * assign the slot, owned items re-sort, spells are unique per actor (rank raised instead),
 * loot stacks by entry, everything else is created with its source recorded in system flags. "The same entry" is
 * the same compendium source or `system.identifier` (`isSameOwnedEntry`); names never match.
 * Actors: on a crawler, pets and vehicles bond and a personal space links.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { isSameOwnedEntry } from '../../utils/character/owned-entry.mjs';
import { transformationOfItem } from '../../utils/character/overlay-state.mjs';
import { addKnownDeity } from '../../documents/actor/worship.mjs';
import { addPatronProspect } from '../../documents/actor/patronage.mjs';

/** Drop target attribute values (`data-drop-target`) and the actor field each slot writes. */
const SLOT_DROP_TARGETS = Object.freeze({
  hotlist: { path: 'system.hotlist', accepts: () => true, sameKind: (a, b) => a.type === b.type },
  externalBuff: { path: 'system.attributes.externalBuffs', accepts: (item) => item.type === 'buff', sameKind: (a, b) => b.type === 'buff' }
});

export function isOwnedBy(item, actor) {
  return item.parent === actor || Boolean(item.parent?.uuid && item.parent.uuid === actor.uuid);
}

/** The `{ kind, slot }` slot a drop event landed on, or null. */
function dropSlot(event) {
  const el = event?.target?.closest?.('[data-drop-target]');
  const kind = el?.dataset?.dropTarget;
  const slot = el?.dataset?.slot;
  return SLOT_DROP_TARGETS[kind] && slot ? { kind, slot } : null;
}

/** Creation data for a dropped item, with its origin recorded for spell idempotence. */
export function dropCreateData(item) {
  const data = item.toObject();
  if (item.uuid) {
    data.flags ??= {};
    data.flags[SYSTEM_ID] = { ...(data.flags[SYSTEM_ID] ?? {}), compendiumId: item.id, sourceUuid: item.uuid };
  }
  return data;
}

async function createDropped(sheet, item, event) {
  const created = await sheet._onDropItemCreate(dropCreateData(item), event);
  return Array.isArray(created) ? created[0] : created;
}

/** Assign a dropped item to a hotlist / buff slot, embedding it first when the actor lacks it. */
async function dropOnSlot(sheet, event, item, { kind, slot }) {
  const actor = sheet.actor;
  const cfg = SLOT_DROP_TARGETS[kind];
  const field = `${cfg.path}.${slot}`;
  if (isOwnedBy(item, actor)) {
    await actor.update({ [field]: item.id });
    return item;
  }
  const existing = actor.items.find(i => i.id === item.id || (cfg.sameKind(item, i) && isSameOwnedEntry(i, dropCreateData(item))));
  if (existing) {
    await actor.update({ [field]: existing.id });
    return existing;
  }
  const created = await createDropped(sheet, item, event);
  if (created?.id) await actor.update({ [field]: created.id });
  return created;
}

/** An owned item of the same type that is the same entry (compendium source or identifier) as the dropped one. */
function ownedEntry(actor, item) {
  const data = dropCreateData(item);
  return actor.items.find(i => i.type === item.type && isSameOwnedEntry(i, data)) ?? null;
}

/**
 * Crawler-specific handling of a dropped Item document. Returns `undefined` when the drop
 * should fall through to the base behaviour (sort an owned item, create anything else).
 * @param {COGCrawlerSheet} sheet
 * @param {DragEvent} event
 * @param {Item} item
 */
export async function dropItem(sheet, event, item) {
  const actor = sheet.actor;
  const interactive = typeof document !== 'undefined';

  // A form race an affliction embeds is the affliction's, not a race to apply (D4)
  if (item.type === 'race' && !transformationOfItem(item)) {
    await actor.applyRace(item, { interactive });
    return item;
  }
  if (item.type === 'class') {
    await actor.applyClass(item, { interactive });
    return item;
  }
  if (item.type === 'patron' && !isOwnedBy(item, actor)) {
    await addPatronProspect(actor, item);
    return item;
  }
  if (item.type === 'deity') {
    if (!isOwnedBy(item, actor)) {
      await addKnownDeity(actor, item, { via: globalThis.game?.user?.isGM ? 'gm' : 'seen' });
      return item;
    }
  }

  const slot = dropSlot(event);
  if (slot && SLOT_DROP_TARGETS[slot.kind].accepts(item)) return dropOnSlot(sheet, event, item, slot);

  // Owned items dropped elsewhere on the sheet only re-sort.
  if (isOwnedBy(item, actor)) return sheet._onSortItem(event, item);

  if (item.type === 'spell') {
    const existing = ownedEntry(actor, item);
    if (existing) {
      const incoming = Number(item.system?.rank) || 1;
      if (incoming > (Number(existing.system?.rank) || 1)) await existing.update({ 'system.rank': incoming });
      ui.notifications?.info(`${actor.name} already knows "${existing.name}".`);
      return existing;
    }
  }

  if (item.type === 'loot') {
    const existing = ownedEntry(actor, item);
    if (existing) {
      const addQty = Number(item.system?.quantity) || 1;
      const total = (Number(existing.system?.quantity) || 1) + addQty;
      await existing.update({ 'system.quantity': total });
      ui.notifications?.info(`Added ${addQty}x "${item.name}" (total: ${total}).`);
      return existing;
    }
  }

  return createDropped(sheet, item, event);
}

/**
 * A dropped Actor on a crawler sheet: bond a pet or vehicle, or link a personal space. Pet and mercenary sheets
 * ignore actor drops (a pet must not bond a vehicle or another pet). Other actor types are ignored.
 * @returns {Promise<Actor|null>}
 */
export async function dropActor(sheet, event, dropped) {
  const actor = sheet.actor;
  if (actor.type !== 'crawler') return null;
  if (dropped.type === 'pet' || dropped.type === 'mount_vehicle') {
    await actor.bondCompanion(dropped);
  } else if (dropped.type === 'personal_space') {
    await actor.linkPersonalSpace(dropped);
  } else {
    return null;
  }
  await sheet.render();
  return dropped;
}
