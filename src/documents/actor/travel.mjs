/**
 * Long travel days (core p. 71): a day's travel is 10 hours of the 30-hour day, and every further 2 hours each crawler makes an
 * Unopposed Fatigue check or gains a level of Fatigue. The GM's Travel control moves the clock, keeps the day's hours in the
 * hidden `travelLog` setting and, for each tracked living crawler, rolls the `fatigueCheck` rule skill (as the grind does) against
 * the Unopposed Difficulty. One summary card reports it. Not a Rule Break: the book permits pressing on at a cost.
 */
import { COGSessionEngine } from '../session/session-engine.mjs';
import { advanceDungeonTime } from './dungeon-time.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { rollFatigueCheck } from './actor-skills.mjs';
import { applyCondition } from './actor-conditions.mjs';
import { isDead } from './dying.mjs';
import { unopposedDifficulty } from '../../data/rules/difficulty-rules.mjs';
import { PRESS_ON_HOURS, TRAVEL_DAY_HOURS, pressOnChecks, travelPaceLine } from '../../data/rules/travel-pace.mjs';
import { setTravelHours, travelHoursOn, travelPace } from '../../utils/exploring/exploring-settings.mjs';
import { dayIndex, SECONDS_PER_HOUR } from '../../utils/time/timing.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { langText } from '../../utils/lang-text.mjs';

/** The `COG.LongTravel.*` text, with English fallbacks for a headless run. The HUD reads its labels through it too. */
export const longTravelText = langText({
  'COG.LongTravel.Label': 'Travel hours',
  'COG.LongTravel.Button': 'Travel',
  'COG.LongTravel.Today': '{hours} hours travelled today',
  'COG.LongTravel.Title': 'Travelling',
  'COG.LongTravel.Summary': 'The party travelled {hours} hours; {today} hours today.',
  'COG.LongTravel.NoCheck': 'A day\'s travel is {free} hours. Every further {every} hours each crawler makes a Fatigue check.',
  'COG.LongTravel.Check': '{name}: Fatigue check {total} against {dc}: {result}',
  'COG.LongTravel.Passed': 'holds',
  'COG.LongTravel.Failed': 'gains Fatigued'
});

function summaryCardHtml({ hours, today, pace, rows }) {
  const lines = rows.length
    ? rows.map((row) => `<li>${escapeAttr(longTravelText('COG.LongTravel.Check', {
      name: row.name,
      total: row.total,
      dc: row.dc,
      result: longTravelText(row.passed ? 'COG.LongTravel.Passed' : 'COG.LongTravel.Failed')
    }))}</li>`).join('')
    : `<li>${escapeAttr(longTravelText('COG.LongTravel.NoCheck', { free: TRAVEL_DAY_HOURS, every: PRESS_ON_HOURS }))}</li>`;
  const paceLine = travelPaceLine(pace);
  return `<div class="cog-chat-card cog-travel-card cog-bg-window cog-text-strong">
    <div class="cog-bg-grad-accent-warning cog-text-on-fill"><i class="fa-solid fa-person-walking"></i> ${escapeAttr(longTravelText('COG.LongTravel.Title'))}</div>
    <p>${escapeAttr(longTravelText('COG.LongTravel.Summary', { hours, today }))}</p>
    ${paceLine ? `<p>${escapeAttr(paceLine)}</p>` : ''}
    <ul>${lines}</ul>
  </div>`;
}

/**
 * Travel for `hours`: move the clock, add the hours to today's log, and roll each owed Fatigue check for every tracked living
 * crawler. GM only. A day is the dungeon day the stretch starts in (30 hours, not 24).
 * @param {number|string} hours more than 0
 * @returns {Promise<{ today: number, due: number, results: Array<{ name: string, total: number, dc: number, passed: boolean }> }|null>}
 *   null when the user is not the GM or the hours are not a positive number
 */
export async function travelHours(hours) {
  if (!globalThis.game?.user?.isGM) return null;
  const travelled = Number(firstScalar(hours, 0));
  if (!Number.isFinite(travelled) || travelled <= 0) return null;
  const day = dayIndex(globalThis.game.time?.worldTime);
  const before = travelHoursOn(day);
  const after = before + travelled;
  await advanceDungeonTime(travelled * SECONDS_PER_HOUR);
  await setTravelHours(day, after);
  const due = pressOnChecks(before, after);
  const dc = unopposedDifficulty({ floor: getCurrentFloor() });
  const results = [];
  const crawlers = COGSessionEngine.getPartyCrawlers({ trackedOnly: true }).filter((crawler) => !isDead(crawler));
  for (const crawler of crawlers) {
    for (let n = 0; n < due; n++) {
      const { total, passed } = await rollFatigueCheck(crawler, dc);
      if (!passed) await applyCondition(crawler, 'fatigued');
      results.push({ name: crawler.name ?? '', total, dc, passed });
    }
  }
  const content = summaryCardHtml({ hours: travelled, today: after, pace: travelPace(), rows: results });
  await globalThis.ChatMessage.create({ content });
  return { today: after, due, results };
}
