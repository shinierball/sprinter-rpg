/**
 * Skill Advancement chat markup, built in one place (pure; no Foundry). The single-check card and the
 * grind-session block both come from here, as do the batch card and the Level award card (3.24 S7, S8).
 */

import { ruleBreakBadgeHtml } from '../utils/rule-break-visibility.mjs';
import { escapeAttr } from '../utils/escape-attr.mjs';


const RULE_BREAK_BADGE = ruleBreakBadgeHtml({ cls: 'cog-text-gold', style: 'font-weight: bold;' });

/**
 * @typedef {object} AdvancementCardData
 * @property {string} actorName
 * @property {string} skillName
 * @property {number} previousRank
 * @property {number} newRank
 * @property {number} target
 * @property {number} rollTotal
 * @property {string} [formula]
 * @property {'gain'|'fail'|'capped'|'limited'|'declined'} outcome
 * @property {boolean} [ruleBreak]
 * @property {'advantage'|'disadvantage'|'cancelled'|'normal'} [rollMode] how many d20s the roll used
 * @property {string} [note] a line under the outcome (the training room says what it cost)
 */

const ROLL_MODE_TEXT = {
  advantage: 'with Advantage',
  disadvantage: 'with Disadvantage',
  cancelled: 'Advantage and Disadvantage cancelled'
};

/** Words for a roll that was not a plain d20 (empty for a plain one), so a card says it had Advantage. */
function rollModeText(mode) {
  return ROLL_MODE_TEXT[mode] ?? '';
}

function outcomeText(d) {
  if (d.outcome === 'gain') return `Advancement Breakthrough! <strong class="cog-text-gold">Rank ${escapeAttr(d.previousRank)} &rarr; Rank ${escapeAttr(d.newRank)}</strong>`;
  if (d.outcome === 'capped') return `Passed, but <strong class="cog-text-strong">Rank ${escapeAttr(d.previousRank)}</strong> is at the Rank cap. No Rank gained.`;
  if (d.outcome === 'limited') return `Passed, but this skill does not advance this way at this Rank. No Rank gained.`;
  if (d.outcome === 'declined') return `Already ground today; no check rolled. Hours stay on the skill.`;
  return `Remains at <strong class="cog-text-strong">Rank ${escapeAttr(d.previousRank)}</strong>. Dedicated practice logged; grind again next session!`;
}

const modeNote = (mode) => (rollModeText(mode) ? ` <em class="cog-rollmode">(${escapeAttr(rollModeText(mode))})</em>` : '');

/**
 * The standalone chat card for one Skill Advancement Check.
 * @param {AdvancementCardData} d
 * @returns {string} HTML
 */
export function buildAdvancementCard(d) {
  const gained = d.outcome === 'gain';
  const border = gained ? 'var(--cog-success)' : 'var(--cog-accent)';
  const headBg = gained ? 'cog-bg-success-fill' : 'cog-bg-accent-fill';
  const blocked = d.outcome === 'capped' || d.outcome === 'limited';
  const headline = gained
    ? `<i class="fa-solid fa-graduation-cap"></i> SKILL ADVANCEMENT: ${escapeAttr(d.skillName)}!`
    : blocked
      ? `<i class="fa-solid fa-circle-minus"></i> ADVANCEMENT BLOCKED: ${escapeAttr(d.skillName)}`
      : d.outcome === 'declined'
        ? `<i class="fa-solid fa-circle-minus"></i> NO ADVANCEMENT CHECK: ${escapeAttr(d.skillName)}`
        : `<i class="fa-solid fa-circle-xmark"></i> ADVANCEMENT ATTEMPT FAILED: ${escapeAttr(d.skillName)}`;
  const rollClass = gained ? 'cog-text-success' : 'cog-text-danger';
  return `
    <div class="cog-chat-card cog-advancement-card cog-bg-window cog-text-strong" style="border: 2px solid ${border}; border-radius: 6px; padding: 12px; font-family: 'Oswald', sans-serif;">
      <div class="${headBg} cog-text-on-fill" style="text-transform: uppercase; font-size: 11px; letter-spacing: 1.5px; padding: 5px 8px; border-radius: 3px; font-weight: bold; text-align: center; margin-bottom: 8px;">
        ${headline}
      </div>
      <div class="cog-text-secondary" style="display: flex; justify-content: space-between; font-size: 11px; border-bottom: 1px solid var(--cog-panel-border); padding-bottom: 6px;">
        <span>Crawler: <strong class="cog-text-strong">${escapeAttr(d.actorName)}</strong></span>
        <span>Target: <strong class="cog-text-gold">d20 &ge; ${escapeAttr(d.target)}</strong></span>
        <span>Roll: <strong class="${rollClass}">${escapeAttr(d.rollTotal)}</strong>${rollModeText(d.rollMode) ? ` <em class="cog-rollmode">(${escapeAttr(rollModeText(d.rollMode))})</em>` : ''}</span>
      </div>
      <div class="cog-text-strong" style="margin-top: 8px; font-size: 13px; text-align: center;">
        ${outcomeText(d)}
      </div>
      ${d.note ? `<div class="cog-text-secondary" style="margin-top: 6px; font-size: 11px; text-align: center;">${escapeAttr(d.note)}</div>` : ''}
      ${d.ruleBreak ? `<div style="margin-top: 6px; font-size: 11px; text-align: center;">${RULE_BREAK_BADGE}</div>` : ''}
    </div>
  `;
}

const BATCH_TITLES = { 'two-hour': '2-Hour Skill Advancement Check', floor: 'End of Floor Skill Advancement Check' };

function batchRow(r) {
  if (r.outcome === 'new-skill') {
    return `<li><strong>${escapeAttr(r.skillName)}</strong>: untrained attempt, Rank 0 check always passes. <strong class="cog-text-gold">New skill at Rank ${escapeAttr(r.newRank)}</strong></li>`;
  }
  if (r.outcome === 'untrained-none') {
    return `<li><strong>${escapeAttr(r.skillName)}</strong>: attempted untrained. Untrained use teaches no new Skills from the Third Floor. Entries erased.</li>`;
  }
  if (r.outcome === 'capped') {
    return `<li><strong>${escapeAttr(r.skillName)}</strong>: Rank ${escapeAttr(r.previousRank)} is at the Rank cap. Skipped, mark cleared.</li>`;
  }
  if (r.outcome === 'limited') {
    return `<li><strong>${escapeAttr(r.skillName)}</strong>: does not advance by use at this Rank. Skipped, mark cleared.</li>`;
  }
  const result = r.outcome === 'gain'
    ? `<strong class="cog-text-success">gained</strong> &rarr; Rank ${escapeAttr(r.newRank)}`
    : '<strong class="cog-text-danger">failed</strong>';
  const badge = r.ruleBreak ? ` ${RULE_BREAK_BADGE}` : '';
  return `<li><strong>${escapeAttr(r.skillName)}</strong> Rank ${escapeAttr(r.previousRank)}: d20 roll ${escapeAttr(r.rollTotal)}${modeNote(r.rollMode)} vs ${escapeAttr(r.target)} ${result}${badge}</li>`;
}

/**
 * The one chat card a batch run (2-hour check or End of floor check) posts.
 * @param {object} d
 * @param {'two-hour'|'floor'} d.mode
 * @param {number|string} [d.floor]
 * @param {number|string} [d.timer] Floor clock hours remaining
 * @param {Array<object>} d.results Rows: actorName, skillName, previousRank, newRank, rollTotal, target, outcome
 *   ('gain' | 'fail' | 'capped' | 'limited' | 'new-skill'), ruleBreak
 * @returns {string} HTML
 */
export function buildAdvancementBatchCard(d) {
  const groups = new Map();
  for (const r of d.results ?? []) {
    if (!groups.has(r.actorName)) groups.set(r.actorName, []);
    groups.get(r.actorName).push(r);
  }
  const body = [...groups].map(([name, rows]) => `
      <div style="margin-top: 8px;">
        <div class="cog-text-gold" style="font-weight: bold; text-transform: uppercase; font-size: 12px;">${escapeAttr(name)}</div>
        <ul style="margin: 2px 0 0 16px; padding: 0; font-size: 12px;">${rows.map(batchRow).join('')}</ul>
      </div>`).join('');
  const context = [d.floor !== undefined && d.floor !== null ? `Floor ${escapeAttr(d.floor)}` : '', d.timer !== undefined && d.timer !== null ? `${escapeAttr(d.timer)}h on the clock` : '']
    .filter(Boolean).join(' &bull; ');
  return `
    <div class="cog-chat-card cog-advancement-card cog-bg-window cog-text-strong" style="border: 2px solid var(--cog-accent); border-radius: 6px; padding: 12px; font-family: 'Oswald', sans-serif;">
      <div class="cog-bg-accent-fill cog-text-on-fill" style="text-transform: uppercase; font-size: 11px; letter-spacing: 1.5px; padding: 5px 8px; border-radius: 3px; font-weight: bold; text-align: center;">
        <i class="fa-solid fa-graduation-cap"></i> ${escapeAttr(BATCH_TITLES[d.mode] ?? 'Skill Advancement Check')}
      </div>
      ${context ? `<div class="cog-text-secondary" style="font-size: 11px; text-align: center; margin-top: 4px;">${context}</div>` : ''}
      ${body}
    </div>
  `;
}

/**
 * The chat card for a Level award.
 * @param {object} d
 * @param {string} d.label What the award is for
 * @param {Array<{actorName: string, previousLevel: number, newLevel: number, levelsGained: number, pointsGained: number, ruleBreak?: boolean}>} d.results
 * @returns {string} HTML
 */
export function buildLevelAwardCard(d) {
  const rows = (d.results ?? []).map(r => {
    const badge = r.ruleBreak ? ` ${RULE_BREAK_BADGE}` : '';
    if (!r.levelsGained) {
      return `<li><strong>${escapeAttr(r.actorName)}</strong>: no Levels gained.${badge}</li>`;
    }
    return `<li><strong>${escapeAttr(r.actorName)}</strong>: +${escapeAttr(r.levelsGained)} Level${r.levelsGained === 1 ? '' : 's'} <strong class="cog-text-gold">(Level ${escapeAttr(r.previousLevel)} &rarr; ${escapeAttr(r.newLevel)})</strong>, ${escapeAttr(r.pointsGained)} Stat points to spend${badge}</li>`;
  }).join('');
  return `
    <div class="cog-chat-card cog-level-award-card cog-bg-window cog-text-strong" style="border: 2px solid var(--cog-success); border-radius: 6px; padding: 12px; font-family: 'Oswald', sans-serif;">
      <div class="cog-bg-success-fill cog-text-on-fill" style="text-transform: uppercase; font-size: 11px; letter-spacing: 1.5px; padding: 5px 8px; border-radius: 3px; font-weight: bold; text-align: center;">
        <i class="fa-solid fa-arrow-up-right-dots"></i> Level Award: ${escapeAttr(d.label)}
      </div>
      <ul style="margin: 8px 0 0 16px; padding: 0; font-size: 12px;">${rows}</ul>
    </div>
  `;
}
