/**
 * The contested-check data of a skill, spell or attack and the chat blocks that show it: the DC (or opposed score), the
 * fail debuff and its duration, and the Roll Contest button the defender's client answers (`rollContestResponse`).
 */
import { getCOGStatModifier } from './actor-constants.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { resolveReachedRankBreaks } from '../../utils/skill/rank-breaks.mjs';
import { rankBreakConditionRounds } from '../../utils/time/durations.mjs';
import { mobAttackText } from '../../utils/combat/declared-attacks.mjs';
import { getAttackDifficultyState } from './attack-targets.mjs';

/**
 * Evaluate contested/opposed check parameters and DC for an item (spell or skill)
 * @param {COGItem} item
 * @param {object} [options={}]
 * @returns {object|null}
 */
export function getContestData(actor, item, options = {}) {
  const sys = item?.system || {};
  const contest = sys.contest || {};
  if (!contest.hasContest) return null;

  const contestType = (contest.contestType || 'dc').toLowerCase().trim();
  const targetStat = (contest.targetStat || 'dex').toLowerCase().trim();
  const targetSkill = (contest.targetSkill || '').trim();

  // Initiator rank & stat
  const isAttackItem = item.type === 'attack';
  const rank = Math.max(
    Number(isAttackItem ? sys.toHitRank : (item.modifiedRank ?? sys.modifiedRank ?? item.effectiveRank ?? sys.rank)) || 0,
    1
  );
  const statKey = ((isAttackItem ? sys.toHitStat : sys.stat) || 'int').toLowerCase().trim();
  let statMod = Number(actor.system?.abilities?.[statKey]?.mod);
  if (Number.isNaN(statMod) || statMod === undefined) {
    const statVal = Number(actor.system?.abilities?.[statKey]?.value ?? 10);
    statMod = getCOGStatModifier(statVal);
  }
  statMod = Math.max(0, statMod);

  // Cumulative rank break bonuses
  const resolvedBreaks = resolveReachedRankBreaks(item, rank);
  const dcBonus = resolvedBreaks.contest.dcBonus || 0;
  const upgradedFailDebuff = (resolvedBreaks.contest.onFailDebuff || '').trim();

  // A reached DC bonus raises the DC whether it is calculated or a custom value.
  const customDC = Number(contest.customDC) || 0;
  let calculatedDC = customDC > 0 ? customDC + dcBonus : Math.max(10, 10 + rank + statMod + dcBonus);
  // A mob attack's Difficulty is N+F like its to-hit (3.48 section 3.3): the Floor is added. Attack items only.
  if (isAttackItem && actor.type === 'mob') {
    const floor = Number(options.floor ?? getCurrentFloor()) || 0;
    // The stat-block number: the card adds the mob's Action shift once (renderAttackContestBlock, E6.10 D-M4).
    const state = customDC > 0 ? null : getAttackDifficultyState(actor, item, floor);
    calculatedDC = state ? state.base + state.floor + dcBonus : customDC + dcBonus + floor;
  }

  const onFailDebuff = upgradedFailDebuff || (contest.onFailDebuff || '').trim();
  // The reached breaks' durationBonus makes the fail debuff last (structured rounds + bonus) rounds (Q-B3, 3.10).
  // Resolved here, at the contest's rank: the save is rolled on the defender's client, so the number rides on the card.
  const durationRounds = onFailDebuff ? rankBreakConditionRounds(item, rank) : 0;
  const onFailNotes = (contest.onFailNotes || '').trim();
  const onSuccessNotes = (contest.onSuccessNotes || '').trim();

  return {
    hasContest: true,
    contestType,
    targetStat,
    targetSkill,
    rank,
    statKey,
    statMod,
    dcBonus,
    dc: calculatedDC,
    customDC,
    onFailDebuff,
    durationRounds,
    onFailNotes,
    onSuccessNotes
  };
}

/**
 * The contest block of an attack card (3.48-9). Mobs never roll: when every target is a mob the card shows the
 * save's DC for the GM to adjudicate instead of a roll button; otherwise the button's handler skips mob defenders.
 * @param {COGItem} attackItem
 * @param {Array<{actor?: Actor}>} [targetResults]
 * @param {number} [initiatorTotal] the attack total an opposed contest compares against
 * @param {{ shift?: number, label?: string|null }} [opts] a mob's +/-5 net Advantage on its Action, added to a numeric save Difficulty
 * @returns {string}
 */
export function renderAttackContestBlock(actor, attackItem, targetResults = [], initiatorTotal = 10, { shift = 0, label = null } = {}) {
  const baseData = getContestData(actor, attackItem);
  if (!baseData) return '';
  const shifted = Number(shift) || 0;
  const contestData = shifted !== 0 && Number.isFinite(Number(baseData.dc)) ? { ...baseData, dc: Number(baseData.dc) + shifted } : baseData;
  const shiftNote = shifted !== 0 && contestData !== baseData
    ? ` ${mobAttackText('COG.MobAttack.SaveShift', { sign: shifted > 0 ? '+' : '\u2212', n: Math.abs(shifted), label: label ?? mobAttackText('COG.MobAttack.FlatLabel') })}.`
    : '';
  const actors = targetResults.map(tr => tr.actor).filter(Boolean);
  if (actors.length > 0 && actors.every(a => a.type === 'mob')) {
    const stat = contestData.targetStat.toUpperCase();
    const dcText = contestData.contestType === 'opposed' ? `opposed vs ${initiatorTotal}` : `DC ${contestData.dc}`;
    return `<div class="cog-contested-challenge cog-text-muted" style="margin: 6px 0; font-size: 11px;"><i class="fa-solid fa-scale-balanced"></i> ${stat} check, ${dcText}.${shiftNote} Mobs do not roll: the GM adjudicates the save.</div>`;
  }
  const challengeHtml = renderContestChallengeBlock(actor, attackItem, contestData, initiatorTotal)
    .replace('data-action="crawlerRollContest"', 'data-action="crawlerRollContest" data-no-mob-roll="1"');
  return shiftNote ? `${challengeHtml}<div class="cog-contest-dc-shift cog-text-muted" style="font-size: 10px;">${shiftNote.trim()}</div>` : challengeHtml;
}

/**
 * Render interactive contested challenge HTML block for chat cards
 * @param {COGItem} item
 * @param {object} contestData
 * @param {number} [initiatorTotal=10]
 * @returns {string}
 */
export function renderContestChallengeBlock(actor, item, contestData, initiatorTotal = 10) {
  if (!contestData || !contestData.hasContest) return '';
  const isOpposed = contestData.contestType === 'opposed';
  const targetLabel = contestData.targetSkill
    ? `${findCatalogEntry('skills', contestData.targetSkill)?.name || contestData.targetSkill} (${contestData.targetStat.toUpperCase()})`
    : `${contestData.targetStat.toUpperCase()} Check`;
  const thresholdLabel = isOpposed
    ? `Opposed vs Initiator Roll (${initiatorTotal})`
    : `DC ${contestData.dc}`;

  const failRounds = Math.max(0, Math.floor(Number(contestData.durationRounds) || 0));
  const failDebuffHtml = contestData.onFailDebuff
    ? `<div class="cog-text-accent" style="font-size: 11px; margin-top: 2px;"><i class="fa-solid fa-skull"></i> <strong>On Failure:</strong> Inflicts <strong>[${contestData.onFailDebuff}]</strong>${failRounds > 0 ? ` for ${failRounds} rounds` : ''}</div>`
    : '';
  const failNotesHtml = contestData.onFailNotes
    ? `<div class="cog-text-accent-strong" style="font-size: 11px; margin-top: 2px;"><em>Failure: ${contestData.onFailNotes}</em></div>`
    : '';
  const successNotesHtml = contestData.onSuccessNotes
    ? `<div class="cog-text-success" style="font-size: 11px; margin-top: 2px;"><em>Success: ${contestData.onSuccessNotes}</em></div>`
    : '';

  return `
    <div class="cog-contested-challenge cog-bg-magic-tint cog-text-magic" style="margin: 8px 0; padding: 8px 10px; border: 2px solid var(--cog-magic); border-radius: 4px; font-size: 12px; font-family: var(--font-primary, sans-serif);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; border-bottom: 1px dashed var(--cog-border-muted); padding-bottom: 4px;">
        <div class="cog-text-magic" style="font-weight: bold; font-size: 12px; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-scale-balanced"></i> ${isOpposed ? 'OPPOSED CONTEST' : 'CONTESTED CHECK'}
        </div>
        <span class="cog-bg-magic-fill cog-text-on-fill" style="font-weight: bold; font-size: 10px; padding: 2px 6px; border-radius: 3px; text-transform: uppercase;">
          ${thresholdLabel}
        </span>
      </div>
      <div class="cog-text" style="font-size: 11px; margin-top: 2px;">
        Opposing Roll: <strong>${targetLabel}</strong>
        ${isOpposed ? ` • Initiator Score: <strong>${initiatorTotal}</strong>` : ` • Challenge DC: <strong>${contestData.dc}</strong>`}
      </div>
      ${failDebuffHtml}
      ${failNotesHtml}
      ${successNotesHtml}
      <button type="button" class="cog-btn cog-roll-contest-btn cog-bg-magic-fill cog-text-on-fill" data-action="crawlerRollContest"
        data-initiator-uuid="${actor.uuid}"
        data-initiator-name="${encodeURIComponent(actor.name)}"
        data-item-name="${encodeURIComponent(item?.name || 'Ability')}"
        data-item-id="${item?.id || item?._id || ''}"
        data-contest-type="${contestData.contestType}"
        data-target-stat="${contestData.targetStat}"
        data-target-skill="${encodeURIComponent(contestData.targetSkill || '')}"
        data-dc="${contestData.dc}"
        data-initiator-total="${initiatorTotal}"
        data-on-fail-debuff="${encodeURIComponent(contestData.onFailDebuff || '')}"
        data-source-rank="${Number(contestData.rank) || 0}"
        data-duration-rounds="${failRounds}"
        data-on-fail-notes="${encodeURIComponent(contestData.onFailNotes || '')}"
        data-on-success-notes="${encodeURIComponent(contestData.onSuccessNotes || '')}"
        style="width: 100%; margin-top: 6px; border: 1px solid var(--cog-magic-fill); border-radius: 3px; padding: 5px; font-size: 11px; cursor: pointer; font-weight: bold; font-family: var(--font-primary, sans-serif); display: flex; align-items: center; justify-content: center; gap: 6px;">
        <i class="fa-solid fa-dice-d20"></i> Roll Opposed Contest (${targetLabel})
      </button>
    </div>
  `;
}
