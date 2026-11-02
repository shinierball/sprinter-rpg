/**
 * Floor arrival chat card: one summary card per committed arrival. Every log entry shows whether it
 * was rolled (with the dice), typed, chosen or calculated, and carries the `[RULE BREAK]` badge when its Rule Break
 * was confirmed. Pure; no Foundry.
 */

import { ruleBreakBadgeHtml } from '../utils/rule-break-visibility.mjs';

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const RULE_BREAK_BADGE = ruleBreakBadgeHtml({ cls: 'cog-text-gold', style: 'font-weight: bold;' });
// The title bar is an accent fill: the badge there takes the on-fill text, not a hue.
const RULE_BREAK_BADGE_ON_FILL = ruleBreakBadgeHtml({ cls: 'cog-text-on-fill', style: 'font-weight: bold;' });

/**
 * How a log entry came about: `rolled (2d4 = 3 + 4 = 7)`, `typed (7)`, `calculated` or `chosen`.
 * @param {object} entry A FloorArrivalResult log entry
 * @returns {string}
 */
export function describeOrigin(entry) {
  if (entry?.rolled) {
    const single = Array.isArray(entry.dice) && entry.dice.length === 1 && Number(entry.dice[0]) === Number(entry.total);
    const dice = Array.isArray(entry.dice) && entry.dice.length && !single ? `${entry.dice.join(' + ')} = ` : '';
    return `rolled (${entry.formula ?? ''}: ${dice}${entry.total})`;
  }
  if (entry?.manual) return `typed (${entry.total})`;
  if (entry?.computed) return 'calculated';
  return 'chosen';
}

function entryLine(entry) {
  const change = entry.before !== undefined && entry.after !== undefined ? ` ${esc(entry.before)} &rarr; <strong>${esc(entry.after)}</strong>` : '';
  const capped = entry.capped ? ` <em>(capped${entry.overflow ? `, ${esc(entry.overflow)} over` : ''})</em>` : '';
  const note = entry.note ? ` <em class="cog-text-secondary">${esc(entry.note)}</em>` : '';
  const extra = [entry.table ? `table ${esc(entry.tableName ?? entry.table)}` : '', entry.row !== undefined ? `row ${esc(entry.row)}` : ''].filter(Boolean).join(', ');
  const narrative = entry.narrative ? `<div class="cog-text-secondary" style="font-style: italic;">${esc(entry.narrative)}</div>` : '';
  return `<li><strong>${esc(entry.label)}</strong>${change}${capped} <span class="cog-text-secondary">${esc(describeOrigin(entry))}${extra ? `, ${extra}` : ''}</span>${note}${entry.ruleBreak ? ` ${RULE_BREAK_BADGE}` : ''}${narrative}</li>`;
}

/**
 * @param {object} result FloorArrivalResult (uses `card`, `skipped`, `warnings`, `ruleBreaks`)
 * @returns {string} HTML
 */
export function buildFloorArrivalCard(result) {
  const card = result?.card ?? {};
  const sections = (card.sections ?? []).map(section => `
      <div style="margin-top: 8px;">
        <div class="cog-text-secondary" style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">${esc(section.id)}</div>
        <ul style="margin: 2px 0 0 16px; padding: 0; font-size: 12px;">${(section.entries ?? []).map(entryLine).join('')}</ul>
      </div>`).join('');
  const skipped = (result?.skipped ?? []).length
    ? `<div class="cog-text-secondary" style="margin-top: 8px; font-size: 11px;">Not simulated: ${(result.skipped).map(s => esc(s.step)).join(', ')}</div>` : '';
  const warnings = (result?.warnings ?? []).length
    ? `<div class="cog-text-secondary" style="margin-top: 8px; font-size: 11px;">${(result.warnings).map(w => esc(w.message)).join('<br/>')}</div>` : '';
  const anyBreak = (result?.ruleBreaks?.confirmed ?? []).length > 0;
  return `
    <div class="cog-chat-card cog-floor-arrival-card cog-bg-window cog-text-strong" style="border: 2px solid var(--cog-accent); border-radius: 6px; padding: 12px; font-family: 'Oswald', sans-serif;">
      <div class="cog-bg-accent-fill cog-text-on-fill" style="text-transform: uppercase; font-size: 11px; letter-spacing: 1.5px; padding: 5px 8px; border-radius: 3px; font-weight: bold; text-align: center;">
        ${esc(card.title)}${card.actorName ? `: ${esc(card.actorName)}` : ''}${anyBreak ? ` ${RULE_BREAK_BADGE_ON_FILL}` : ''}
      </div>${sections}${skipped}${warnings}
    </div>
  `;
}
