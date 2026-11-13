/**
 * Kill credit: the boss star or Player Killer skull, the kill Popularity and the patron death notice a lethal hit earns
 * its attacker. The damage pipeline pays them at once for a victim that dies at 0%. A crawler or mercenary who is put at
 * 0 is only Dying; `die` (dying.mjs) calls `creditDeferredKill` when the victim actually dies, with the hit that took the
 * last slot (rulebook p. 87: only the killing blow earns the skull, and only if the victim is let die).
 */
import { bossTierFromTags } from '../../data/mob-creation-rules.mjs';
import { buildKillContext, killContextRecordOf } from '../../utils/roll/roll-context.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { findDamageUndoRecord, markDamageUndoLethal } from '../../utils/damage/damage-undo.mjs';
import { promptInfidelsLevel } from './worship-obligations.mjs';
import { noticePatronDeath } from './patron-notices.mjs';

/**
 * Award a boss star or crawler skull on lethal damage. Never throws.
 * @param {Actor} targetActor
 * @param {Actor|null} attackerActor
 * @param {{ isLethal: boolean, appId: string, attackTags: string[], combat: Combat|null }} state
 * @returns {Promise<'boss'|'crawler'|null>} the trophy awarded
 */
export async function creditKill(targetActor, attackerActor, { isLethal, appId, attackTags, combat }) {
  let killTrophy = null;

  // Award boss star or crawler skull on lethal damage
  if (isLethal && attackerActor && attackerActor.type === 'crawler') {
    try {
      if (targetActor.type === 'mob') {
        // Boss by registry (CONFIG.COG.bossTiers): only a registered boss tier earns a star
        const rawTags = targetActor.allTags || (targetActor.system?.tagSet
          ? Array.from(targetActor.system.tagSet)
          : (Array.isArray(targetActor.system?.tags)
            ? targetActor.system.tags
            : (Array.isArray(targetActor.tags) ? targetActor.tags : [])));
        const tier = bossTierFromTags(rawTags);
        const isBoss = tier !== 'none';

        if (isBoss && typeof attackerActor.recordBossKill === 'function') {
          await attackerActor.recordBossKill({
            name: targetActor.name || 'Unnamed Boss',
            tier: tier || 'bronze',
            floor: targetActor.system?.details?.floor || '',
            applicationId: appId,
            victimUuid: targetActor.uuid ?? ''
          });
          killTrophy = 'boss';
        }
      } else if (targetActor.type === 'crawler' && targetActor.id !== attackerActor.id) {
        if (typeof attackerActor.recordCrawlerKill === 'function') {
          await attackerActor.recordCrawlerKill({
            name: targetActor.name || 'Rival Crawler',
            crawlerNumber: targetActor.system?.details?.crawlerNumber || '',
            floor: targetActor.system?.details?.floor || '',
            applicationId: appId,
            victimUuid: targetActor.uuid ?? ''
          });
          killTrophy = 'crawler';
        }
      }
    } catch (err) {
      console.error('Sprinter RPG | Error recording kill trophy:', err);
    }
  }

  return killTrophy;
}

/**
 * The killer's kill popularity (popularityTriggers rows on a kill: the per-target popularity context; the victim is the
 * subject). Runs after the undo record is stored: a client that cannot write the killer asks the GM, who checks that
 * record (3.56e). Never throws.
 */
export async function awardKillPopularity(targetActor, attackerActor, { isLethal, appId, attackTags, combat }) {
  if (!(isLethal && attackerActor && attackerActor.uuid !== targetActor.uuid && typeof attackerActor.awardPopularity === 'function')) return;
  try {
    const context = buildKillContext({ attacker: attackerActor, victim: targetActor, attackTags });
    await attackerActor.awardPopularity('kill', {
      context,
      combatId: combat?.started ? combat.id : '',
      application: { victimUuid: targetActor.uuid ?? '', applicationId: appId }
    });
    await promptInfidelsLevel(targetActor, attackerActor);
  } catch (err) {
    console.error('Sprinter RPG | Error awarding kill popularity:', err);
  }
}

/** The kill context kept on a lethal application's record (null when it is not a kill by another actor). */
export function killContextFor(isLethal, targetActor, attackerActor, attackTags) {
  if (!(isLethal && attackerActor && attackerActor.uuid !== targetActor.uuid)) return null;
  return killContextRecordOf(buildKillContext({ attacker: attackerActor, victim: targetActor, attackTags }));
}

/**
 * Pay the kill a Dying victim's death earns the attacker who took the last slot. Nothing when no attacker is remembered
 * or the attacker is gone. The downing application's undo record is marked lethal first (with its kill context): the GM
 * check on a non-owner's Popularity request rebuilds the context from that record. An undone or rotated-out record pays
 * nothing.
 * @param {Actor} victim the actor that just died
 * @param {{ attackerUuid?: string|null, applicationId?: string, attackTags?: string[], combatId?: string }|null} downedBy
 * @returns {Promise<'paid'|'none'|'no-record'>} `'no-record'` when the GM must award it by hand
 */
export async function creditDeferredKill(victim, downedBy) {
  if (!downedBy?.attackerUuid || !downedBy.applicationId) return 'none';
  const attacker = resolveActorByUuid(downedBy.attackerUuid);
  if (!attacker) return 'none';
  const record = findDamageUndoRecord(victim, downedBy.applicationId);
  if (!record) return 'no-record';
  if (record.undoneAt) return 'none';
  const attackTags = Array.isArray(downedBy.attackTags) ? downedBy.attackTags : [];
  const appId = downedBy.applicationId;
  await markDamageUndoLethal(victim, appId, { killContext: killContextFor(true, victim, attacker, attackTags) });
  const combat = downedBy.combatId ? (globalThis.game?.combats?.get?.(downedBy.combatId) ?? null) : null;
  const state = { isLethal: true, appId, attackTags, combat };
  const killTrophy = await creditKill(victim, attacker, state);
  if (killTrophy) await markDamageUndoLethal(victim, appId, { killTrophy });
  await awardKillPopularity(victim, attacker, state);
  await noticePatronDeath(victim, attacker, { isLethal: true });
  return 'paid';
}
