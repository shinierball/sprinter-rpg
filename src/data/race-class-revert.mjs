/**
 * Race and class revert: what `COGRaceClassApplier.removeRace` and `removeClass` do to a crawler, one function each.
 * Reverts only what the applier recorded in the actor's applied flag.
 */

import { SYSTEM_ID } from '../constants.mjs';
import { transformationOfItem } from '../utils/character/transform-rules.mjs';
import { DEFAULT_SIZE } from './sizes.mjs';
import { addAbilityDeltas, revertDrAndMovementBonuses } from './race-class-bonuses.mjs';

/**
 * The embedded skill or spell an applied-grant record points at: by the item id the applier stored, else by the
 * grant's identifier. Never by name.
 */
function findAppliedItem(actor, type, record) {
  const items = actor?.items;
  if (!items?.find) return undefined;
  if (record?.id) {
    const byId = items.find(i => i.type === type && i.id === record.id);
    if (byId) return byId;
  }
  return record?.identifier ? items.find(i => i.type === type && i.system?.identifier === record.identifier) : undefined;
}

/**
 * True for an item a race or a class created. When both grant the same skill or spell the first creates it and the other
 * adds ranks, so either one's mark means the item goes when its last rank does.
 */
function grantedByRaceOrClass(item) {
  return ['race', 'class'].includes(item?.getFlag?.(SYSTEM_ID, 'grantedBy'));
}

/** True for an item a transformation made (a form race, its traits, a created skill, an added effect): the applier leaves it alone. */
const isTransformationItem = (item) => Boolean(transformationOfItem(item));

/**
 * Option the applier puts on its own deletes of race and class items, so `onRaceClassItemDelete` stands aside for them.
 * A per-actor "busy" flag cannot do this: a user's delete of a race and a class together would see the race's revert
 * and skip the class's.
 */
export const APPLIER_DELETE_OPTION = 'cogRaceClassApplier';
const OWN_DELETE = { [APPLIER_DELETE_OPTION]: true };

/**
 * Reverses and removes the actor's current race benefits.
 *
 * @param {Actor} actor
 * @returns {Promise<boolean>}
 */
export async function removeAppliedRace(actor) {
  if (!actor) return false;

  // 1. Revert only what the applier recorded. With no flag there is nothing to revert: the
  // string and any stray race items are cleared, but a race name is never looked up and subtracted.
  const applied = actor.getFlag?.(SYSTEM_ID, 'appliedRace');
  const currentRaceName = (actor.system?.details?.race || '').trim();
  const hasRaceItem = Boolean(actor.items?.some(i => i.type === 'race' && !isTransformationItem(i)));

  if (!applied && !currentRaceName && !hasRaceItem) return false;

  const updates = {};
  updates['system.details.race'] = '';

  // 2. Revert Ability Stats
  if (applied?.stats) addAbilityDeltas(actor, updates, applied.stats, -1);

  // 3. Revert Creature Size
  if (applied?.size) {
    const orig = applied.originalSize || DEFAULT_SIZE;
    updates['system.attributes.size'] = orig;
  }

  // 4-5. Revert DR and Movement
  revertDrAndMovementBonuses(actor, updates, applied);

  // 6. Delete the buffs and debuffs this race granted (its `system.grantedEffects`, flagged grantedBy: race)
  const condIdsToDelete = [];
  if (actor.items) {
    for (const item of actor.items) {
      if (['buff', 'debuff'].includes(item.type) && item.getFlag?.(SYSTEM_ID, 'grantedBy') === 'race' && !isTransformationItem(item)) {
        if (!condIdsToDelete.includes(item.id)) condIdsToDelete.push(item.id);
      }
    }
  }
  if (condIdsToDelete.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
    await actor.deleteEmbeddedDocuments('Item', condIdsToDelete);
  }

  // 7. Revert Skills
  if (Array.isArray(applied?.skills)) {
    const itemsToDelete = [];
    for (const s of applied.skills) {
      const skillItem = findAppliedItem(actor, 'skill', s);
      if (skillItem) {
        const curRank = Number(skillItem.system?.rank) || 0;
        const remainingRank = curRank - (Number(s.rank) || 0);

        if (remainingRank > 0) {
          // Keep the skill with remaining non-item ranks!
          if (typeof skillItem.update === 'function') {
            await skillItem.update({ 'system.rank': remainingRank });
          }
        } else {
          // No non-item ranks remain: delete if granted by race or 0
          const wasCreated = s.createdByRace || grantedByRaceOrClass(skillItem);
          if (wasCreated && typeof actor.deleteEmbeddedDocuments === 'function') {
            itemsToDelete.push(skillItem.id);
          } else if (typeof skillItem.update === 'function') {
            await skillItem.update({ 'system.rank': Math.max(0, remainingRank) });
          }
        }
      }
    }
    if (itemsToDelete.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
      await actor.deleteEmbeddedDocuments('Item', itemsToDelete);
    }
  }

  // 8. Revert Spells
  if (Array.isArray(applied?.spells)) {
    const spellsToDelete = [];
    for (const sp of applied.spells) {
      const spellItem = findAppliedItem(actor, 'spell', sp);
      if (spellItem) {
        const curRank = Number(spellItem.system?.rank) || 0;
        const remainingRank = curRank - (Number(sp.rank) || 0);
        if (remainingRank > 0) {
          if (typeof spellItem.update === 'function') {
            await spellItem.update({ 'system.rank': remainingRank });
          }
        } else {
          const wasCreated = sp.createdByRace || grantedByRaceOrClass(spellItem);
          if (wasCreated && typeof actor.deleteEmbeddedDocuments === 'function') {
            spellsToDelete.push(spellItem.id);
          } else if (typeof spellItem.update === 'function') {
            await spellItem.update({ 'system.rank': Math.max(0, remainingRank) });
          }
        }
      }
    }
    if (spellsToDelete.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
      await actor.deleteEmbeddedDocuments('Item', spellsToDelete);
    }
  }

  // 9. Delete embedded Race Item documents
  const raceItems = actor.items?.filter(i => i.type === 'race' && !isTransformationItem(i)) || [];
  if (raceItems.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
    await actor.deleteEmbeddedDocuments('Item', raceItems.map(i => i.id), OWN_DELETE);
  }

  // 10. Clear flag
  if (typeof actor.unsetFlag === 'function') {
    await actor.unsetFlag(SYSTEM_ID, 'appliedRace');
  }

  // 11. Commit actor updates
  if (Object.keys(updates).length > 0 && typeof actor.update === 'function') {
    await actor.update(updates);
  }

  return true;
}

/**
 * Reverses and removes the actor's current class benefits.
 *
 * @param {Actor} actor
 * @returns {Promise<boolean>}
 */
export async function removeAppliedClass(actor) {
  if (!actor) return false;

  // 1. Revert only what the applier recorded; with no flag only the string and stray class items go.
  const applied = actor.getFlag?.(SYSTEM_ID, 'appliedClass');
  const currentClassName = (actor.system?.details?.class || '').trim();
  const hasClassItem = Boolean(actor.items?.some(i => i.type === 'class'));

  if (!applied && !currentClassName && !hasClassItem) return false;

  const updates = {};
  updates['system.details.class'] = '';

  // 2. Revert Ability Stats
  if (applied?.stats) addAbilityDeltas(actor, updates, applied.stats, -1);

  // 3-4. Revert DR and Movement
  revertDrAndMovementBonuses(actor, updates, applied);

  // 5. Delete the buffs and debuffs this class granted (its `system.grantedEffects`, flagged grantedBy: class)
  const condIdsToDelete = [];
  if (actor.items) {
    for (const item of actor.items) {
      if (['buff', 'debuff'].includes(item.type) && item.getFlag?.(SYSTEM_ID, 'grantedBy') === 'class') {
        if (!condIdsToDelete.includes(item.id)) condIdsToDelete.push(item.id);
      }
    }
  }
  if (condIdsToDelete.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
    await actor.deleteEmbeddedDocuments('Item', condIdsToDelete);
  }

  // 6. Revert Skills
  if (Array.isArray(applied?.skills)) {
    const itemsToDelete = [];
    for (const s of applied.skills) {
      const skillItem = findAppliedItem(actor, 'skill', s);
      if (skillItem) {
        const curRank = Number(skillItem.system?.rank) || 0;
        const remainingRank = curRank - (Number(s.rank) || 0);

        if (remainingRank > 0) {
          // Keep skill with non-item ranks intact!
          if (typeof skillItem.update === 'function') {
            await skillItem.update({ 'system.rank': remainingRank });
          }
        } else {
          // No non-item ranks remain: delete if granted by class or 0
          const wasCreated = s.createdByClass || grantedByRaceOrClass(skillItem);
          if (wasCreated && typeof actor.deleteEmbeddedDocuments === 'function') {
            itemsToDelete.push(skillItem.id);
          } else if (typeof skillItem.update === 'function') {
            await skillItem.update({ 'system.rank': Math.max(0, remainingRank) });
          }
        }
      }
    }
    if (itemsToDelete.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
      await actor.deleteEmbeddedDocuments('Item', itemsToDelete);
    }
  }

  // 7. Revert Spells
  if (Array.isArray(applied?.spells)) {
    const spellsToDelete = [];
    for (const sp of applied.spells) {
      const spellItem = findAppliedItem(actor, 'spell', sp);
      if (spellItem) {
        const curRank = Number(spellItem.system?.rank) || 0;
        const remainingRank = curRank - (Number(sp.rank) || 0);
        if (remainingRank > 0) {
          if (typeof spellItem.update === 'function') {
            await spellItem.update({ 'system.rank': remainingRank });
          }
        } else {
          const wasCreated = sp.createdByClass || grantedByRaceOrClass(spellItem);
          if (wasCreated && typeof actor.deleteEmbeddedDocuments === 'function') {
            spellsToDelete.push(spellItem.id);
          } else if (typeof spellItem.update === 'function') {
            await spellItem.update({ 'system.rank': Math.max(0, remainingRank) });
          }
        }
      }
    }
    if (spellsToDelete.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
      await actor.deleteEmbeddedDocuments('Item', spellsToDelete);
    }
  }

  // 8. Delete embedded Class Item documents
  const classItems = actor.items?.filter(i => i.type === 'class') || [];
  if (classItems.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
    await actor.deleteEmbeddedDocuments('Item', classItems.map(i => i.id), OWN_DELETE);
  }

  // 9. Clear flag
  if (typeof actor.unsetFlag === 'function') {
    await actor.unsetFlag(SYSTEM_ID, 'appliedClass');
  }

  // 10. Commit actor updates
  if (Object.keys(updates).length > 0 && typeof actor.update === 'function') {
    await actor.update(updates);
  }

  return true;
}
