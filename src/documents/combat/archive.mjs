/**
 * Archived combats: the encounter record built when a combat ends (metadata, combatants, round history, metrics)
 * and the `archivedCombats` world setting that keeps them.
 */

import { SYSTEM_ID } from '../../constants.mjs';
import { isMobCombatant } from './combatants.mjs';
import { COG_ACTION_TYPES } from './action-ledger.mjs';

/**
 * Snapshot and archive a combat encounter to permanent world storage.
 * Preserves encounter metadata, combatants, round history, and AI metrics.
 * @param {object} combat
 * @returns {Promise<object>} The archived encounter record
 */
export async function archiveCombat(combat) {
  await combat.snapshotRoundActions(combat.round || 1);

  const metrics = combat.getFlag(SYSTEM_ID, 'metrics') || {};
  const roundHistory = combat.getFlag(SYSTEM_ID, 'roundHistory') || {};
  const scene = combat.scene || (globalThis.game?.scenes?.get ? globalThis.game.scenes.get(combat.sceneId) : null);

  const combatantsData = Array.from(combat.combatants || []).map(c => {
    const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
    const isMob = isMobCombatant(c);
    const actorMetrics = metrics[c.actorId] || {};

    // Tally action counts across all rounds in roundHistory
    const actionCategories = { damage: 0, tactical: 0, defensive: 0, buff: 0, utility: 0 };
    for (const roundData of Object.values(roundHistory)) {
      const rAct = roundData?.[c.id];
      if (rAct?.slots && Array.isArray(rAct.slots)) {
        for (const s of rAct.slots) {
          if (!s) continue;
          const cat = s.category || COG_ACTION_TYPES[s.type]?.category || (s.isAttack ? 'damage' : 'utility');
          if (actionCategories[cat] !== undefined) {
            actionCategories[cat]++;
          } else {
            actionCategories.utility++;
          }
        }
      }
    }

    return {
      id: c.id,
      name: c.name,
      actorId: c.actorId,
      img: c.img || actor?.img || 'icons/svg/mystery-man.svg',
      type: actor?.type || (isMob ? 'npc' : 'crawler'),
      isMob,
      isDefeated: Boolean(c.isDefeated),
      level: Number(actor?.system?.details?.level) || 1,
      xpValue: Number(actor?.system?.details?.xpValue) || 0,
      hp: actor?.system?.attributes?.hp?.value ?? null,
      maxHp: actor?.system?.attributes?.hp?.max ?? null,
      actions: combat.getCombatantActions(c),
      damageDealt: actorMetrics.totalDamage || 0,
      damageTaken: actorMetrics.damageTaken || 0,
      actionCategories,
      highestHit: actorMetrics.highestHit || 0,
      kills: actorMetrics.kills || 0
    };
  });

  const archiveRecord = {
    id: combat.id || ('archived-' + Date.now()),
    name: combat.name || (scene ? `${scene.name} Encounter` : 'Dungeon Encounter'),
    timestamp: Date.now(),
    dateString: new Date().toLocaleString(),
    sceneId: combat.sceneId || null,
    sceneName: scene?.name || 'Unknown Scene',
    totalRounds: Math.max(1, combat.round || 1),
    isSurpriseRound: combat.isSurpriseRound,
    combatants: combatantsData,
    roundHistory,
    metrics: {
      ...metrics,
      totalDamageDealt: metrics.totalDamageDealt || 0,
      mvp: metrics.mvp || null,
      awards: metrics.awards || [],
      events: metrics.events || []
    }
  };

  await saveArchivedCombat(archiveRecord);
  return archiveRecord;
}

/**
 * Retrieve all permanently archived combats from world storage.
 * @returns {Array<object>}
 */
export function getArchivedCombats() {
  try {
    return globalThis.game?.settings?.get?.(SYSTEM_ID, 'archivedCombats') || [];
  } catch {
    return [];
  }
}

/**
 * Save or update an archived combat record in world storage.
 * @param {object} record
 * @returns {Promise<Array<object>>}
 */
export async function saveArchivedCombat(record) {
  if (!globalThis.game?.settings) return [];
  const existing = getArchivedCombats();
  const updated = [record, ...existing.filter(e => e.id !== record.id)];
  if (!globalThis.game?.user || globalThis.game.user.isGM !== false) {
    await globalThis.game.settings.set(SYSTEM_ID, 'archivedCombats', updated);
  }
  return updated;
}

/**
 * Delete an archived combat record by ID.
 * @param {string} id
 * @returns {Promise<Array<object>>}
 */
export async function deleteArchivedCombat(id) {
  if (!globalThis.game?.settings) return [];
  const existing = getArchivedCombats();
  const updated = existing.filter(e => e.id !== id);
  if (!globalThis.game?.user || globalThis.game.user.isGM !== false) {
    await globalThis.game.settings.set(SYSTEM_ID, 'archivedCombats', updated);
  }
  return updated;
}

/**
 * Clear all archived combats.
 * @returns {Promise<Array<object>>}
 */
export async function clearArchivedCombats() {
  if (!globalThis.game?.settings) return [];
  if (!globalThis.game?.user || globalThis.game.user.isGM !== false) {
    await globalThis.game.settings.set(SYSTEM_ID, 'archivedCombats', []);
  }
  return [];
}
