import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { getCOGStatModifier } from './actor-constants.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { cardSummary, OMIT_ALL } from '../../utils/item-describer/card-summary.mjs';
import { collectCheckToHit } from '../../utils/attack/per-target-to-hit.mjs';
import { buildRollContext, extendContext, resolveSituations } from '../../utils/roll/roll-context.mjs';
import { getRollAdvantageState } from './combat-rolls.mjs';
import { findConditionEntry } from '../../content/catalog-lookup.mjs';
import { incomingEffectTags } from '../../utils/effects/incoming-effect.mjs';
import { effectImmunityFor, immuneText } from '../../utils/effects/effect-immunity.mjs';
import { getSkillByIdentifier } from './actor-skills.mjs';
import { settleAfterCheck } from './condition-expiry.mjs';
import { trustedHtml } from '../../utils/escape-attr.mjs';

/**
 * Roll a defensive response to a contested check or opposed check
 * @param {object} params
 * @returns {Promise<ChatMessage>}
 */
export async function rollContestResponse(actor, params = {}) {
  const {
    initiatorId = '',
    initiatorName = 'Initiator',
    itemName = 'Ability',
    itemId = '',
    contestType = 'dc',
    targetStat = 'dex',
    targetSkill = '',
    dc = 10,
    initiatorTotal = 10,
    onFailDebuff = '',
    conditionTag = '',
    sourceRank = 0,
    durationRounds = 0,
    onFailNotes = '',
    onSuccessNotes = '',
    options = {}
  } = params;

  const statKey = (targetStat || 'dex').toLowerCase().trim();
  let statMod = Number(actor.system?.abilities?.[statKey]?.mod);
  if (Number.isNaN(statMod) || statMod === undefined) {
    const statVal = Number(actor.system?.abilities?.[statKey]?.value ?? 10);
    statMod = getCOGStatModifier(statVal);
  }
  statMod = Math.max(0, statMod);
  const statName = statKey.toUpperCase();

  // Check if defender has the requested opposing skill
  let skillRank = 0;
  let usingSkill = false;
  let matchedSkill = null;
  if (targetSkill && typeof targetSkill === 'string') {
    // `contest.targetSkill` is a skill identifier; the defender's owned skill with it is used.
    matchedSkill = getSkillByIdentifier(actor, decodeURIComponent(targetSkill));
    if (matchedSkill) {
      usingSkill = true;
      skillRank = Number(matchedSkill.modifiedRank ?? matchedSkill.system?.modifiedRank ?? matchedSkill.system?.rank) || 0;
      const skillStat = (matchedSkill.system?.stat || statKey).toLowerCase().trim();
      let skillStatMod = Number(actor.system?.abilities?.[skillStat]?.mod);
      if (!Number.isNaN(skillStatMod) && skillStatMod !== undefined) {
        statMod = Math.max(0, skillStatMod);
      }
    }
  }

  const isOpposed = contestType === 'opposed';
  const targetThreshold = Number(params.targetDC ?? (isOpposed ? Number(initiatorTotal) : Number(dc))) || 10;

  // Roll evaluation: if using skill, 1d20 + rank + statMod; otherwise 1d20 + statMod
  const totalBonus = usingSkill ? (skillRank + statMod) : statMod;
  // Like rollSkill: the initiator is the check's subject, so `subject.*` conditions and target-side scales judge against them.
  const initiator = params.initiator ?? (initiatorId ? game?.actors?.get?.(initiatorId) : null) ?? null;
  const targetActors = initiator ? [initiator] : [];

  const debuffToInflict = params.conditionTag || conditionTag || onFailDebuff || params.onFailDebuff || '';
  const cleanDebuff = debuffToInflict ? decodeURIComponent(debuffToInflict) : '';
  const cleanInitiatorName = decodeURIComponent(initiatorName || 'Initiator');
  const cleanItemName = decodeURIComponent(itemName || 'Ability');

  // What the incoming effect carries: the initiating item's and the fail Debuff's tags (effect namespaces only).
  const incomingItem = itemId ? (initiator?.items?.get(itemId) ?? null) : null;
  const incoming = incomingEffectTags({ item: incomingItem, debuff: cleanDebuff ? (findConditionEntry('debuffs', cleanDebuff) ?? cleanDebuff) : null });

  // An immune defender makes no check and no Debuff lands.
  const immunity = effectImmunityFor(actor, incoming, { other: initiator });
  if (immunity.immune) {
    const sources = immunity.sources.join(', ');
    const msg = await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: actor }),
      content: `<div class="cog-chat-card cog-contest-result-card cog-bg-surface"><strong>${actor.name}</strong>: ${immuneText('Card', { sources }, `Immune (${sources})`)}<div class="cog-text-muted" style="font-size: 11px;">${immuneText('CardNote', { actor: actor.name, item: cleanItemName }, `${actor.name} is immune to ${cleanItemName}'s effect.`)}</div></div>`,
      flags: { [SYSTEM_ID]: { isContestRoll: true, isContestSuccess: true, defenderId: actor.id, initiatorId, immune: true, sourceRank: Number(sourceRank) || 0 } }
    });
    if (msg) { msg.isSuccess = true; msg.success = true; }
    return msg;
  }

  // A contest response is the defender's resistance check against the incoming effect (`check.resist` + its tags).
  const baseContext = buildRollContext({
    actor: actor, phase: 'check', item: matchedSkill, check: [usingSkill ? 'skill' : 'stat', 'resist'], stat: statKey, tags: incoming, other: initiator ?? undefined
  });
  const situations = await resolveSituations(actor, baseContext, options, { isAttack: false });
  const situationContext = extendContext(baseContext, { situations });
  const advState = getRollAdvantageState(actor, { rollType: usingSkill ? 'skill' : 'stat', stat: statKey, item: matchedSkill, rollContext: situationContext, options });
  const rollContext = extendContext(situationContext, { disadvantaged: advState.mode === 'disadvantage' });
  const { mods: checkMods } = collectCheckToHit(actor, rollContext, { keys: ['checkModifiers'], targetActors });
  const extraDice = checkMods.diceParts.length > 0 ? ` + ${checkMods.diceParts.join(' + ')}` : '';
  const rollBonus = totalBonus + checkMods.flatBonus;
  const formula = `${advState.formula || '1d20'} + ${rollBonus}${extraDice}`;
  const roll = await new Roll(formula, { rank: skillRank, mod: statMod }).evaluate();
  // A response is a reactive resist check, not an Action: it ends a `next_check` debuff only. It does not report to the session ledger.
  await settleAfterCheck(actor, { spendsAction: false });
  const modDesc = checkMods.breakdown.length > 0 ? ` [${checkMods.breakdown.join(', ')}]` : '';

  const isSuccess = roll.total >= targetThreshold;
  const diff = roll.total - targetThreshold;

  const outcomeBadge = isSuccess
    ? `<span class="cog-contest-result-badge cog-bg-success-fill cog-text-on-fill">SUCCESS (${roll.total} vs ${targetThreshold})</span>`
    : `<span class="cog-contest-result-badge cog-bg-accent-fill cog-text-on-fill">FAILED (${roll.total} vs ${targetThreshold})</span>`;

  const rollHtml = typeof roll.render === 'function' ? trustedHtml(await roll.render()) : '';

  const cleanFailNotes = onFailNotes ? decodeURIComponent(onFailNotes) : '';
  const cleanSuccessNotes = onSuccessNotes ? decodeURIComponent(onSuccessNotes) : '';
  // The initiator's reached rank breaks' duration bonus, resolved when the contest was rolled (getContestData).
  const conditionRounds = Math.max(0, Math.floor(Number(durationRounds) || 0));
  let debuffButtonHtml = '';
  if (!isSuccess && cleanDebuff) {
    if (typeof actor.applyCondition === 'function') {
      await actor.applyCondition(cleanDebuff, { source: cleanItemName, durationRounds: conditionRounds });
    }
    const tagDef = getTagDefinition(cleanDebuff);
    const tagLabel = tagDef?.label || cleanDebuff;
    debuffButtonHtml = `
      <div style="margin-top: 6px;">
        <div class="cog-text-accent" style="font-size: 11px; font-weight: bold; margin-bottom: 3px;">
          <i class="fa-solid fa-skull"></i> Inflicted [${tagLabel}] on ${actor.name}${conditionRounds > 0 ? ` for ${conditionRounds} rounds` : ''}!
        </div>
        <button type="button" class="cog-apply-condition-btn cog-apply-debuff-btn cog-bg-accent-fill cog-text-on-fill" data-action="crawlerApplyCondition" data-condition-tag="${cleanDebuff}" data-debuff-name="${tagLabel}" data-target-uuid="${actor.uuid}" data-duration-rounds="${conditionRounds}" style="width: 100%; border: 1px solid var(--cog-accent-strong-fill); border-radius: 3px; padding: 4px; font-size: 11px; cursor: pointer; font-weight: bold; font-family: var(--font-primary, sans-serif);">
          <i class="fa-solid fa-skull"></i> Re-Apply [${tagLabel}] to ${actor.name}
        </button>
      </div>
    `;
  }

  // What the fumble debuff does: the debuff is applied above, so it has happened.
  const effectSummaryHtml = cleanDebuff && !isSuccess
    ? await cardSummary(null, OMIT_ALL, { actor: actor, effects: [{ kind: 'debuffs', ref: cleanDebuff }] })
    : '';
  const cardContent = `
    <div class="cog-chat-card cog-contest-result-card cog-bg-surface" style="font-family: var(--font-primary, sans-serif); border: 2px solid ${isSuccess ? 'var(--cog-success)' : 'var(--cog-accent)'}; border-radius: 4px; padding: 8px;">
      <div class="cog-contest-result-header">
        <div class="cog-contest-result-title">
          <strong class="cog-text" style="font-size: 13px;">${actor.name}</strong>
          <div class="cog-text-muted" style="font-size: 11px;">
            Contest Response vs <strong>${cleanInitiatorName}</strong>'s <em>${cleanItemName}</em>
          </div>
        </div>
        <div>${outcomeBadge}</div>
      </div>
      <div class="cog-text-secondary" style="font-size: 11px; margin-bottom: 6px;">
        Rolled: <strong>${usingSkill ? `${matchedSkill.name} (${statName})` : `${statName} Check`}</strong> (${formula}${modDesc} = <strong>${roll.total}</strong>) vs Target <strong>${targetThreshold}</strong> (Diff: <strong>${diff >= 0 ? `+${diff}` : diff}</strong>)
      </div>
      ${rollHtml}
      ${!isSuccess && cleanFailNotes ? `<div class="cog-text-accent cog-bg-warning-tint" style="margin-top: 4px; font-size: 11px; padding: 4px 6px; border-radius: 3px;"><strong>Consequence:</strong> ${cleanFailNotes}</div>` : ''}
      ${isSuccess && cleanSuccessNotes ? `<div class="cog-text-success cog-bg-success-tint" style="margin-top: 4px; font-size: 11px; padding: 4px 6px; border-radius: 3px;"><strong>Success:</strong> ${cleanSuccessNotes}</div>` : ''}
      ${debuffButtonHtml}
      ${effectSummaryHtml}
    </div>
  `;

  const msg = await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: actor }),
    flavor: `<strong>${actor.name}</strong>: ${usingSkill ? matchedSkill.name : statName} Contest Roll vs ${cleanInitiatorName}`,
    content: cardContent,
    flags: {
      [SYSTEM_ID]: {
        isContestRoll: true,
        isContestSuccess: isSuccess,
        defenderId: actor.id,
        initiatorId,
        targetThreshold,
        rollTotal: roll.total,
        diff,
        sourceRank: Number(sourceRank) || 0,
        conditionRounds
      }
    }
  });

  if (msg) {
    msg.isSuccess = isSuccess;
    msg.success = isSuccess;
  }
  return msg;
}
