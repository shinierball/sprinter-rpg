/**
 * The Popularity checklist's pure half: which cells a moment lists, which are already paid this period, what a
 * selection projects to, which Rule Breaks it needs, and the record of one Apply (and its undo). No document, setting
 * or clock reads: the caller passes facts, the applied records and the time.
 *
 * `selection` is `{ entries: [{ actorId, changeId, label, delta }] }`, the ticked cells and the GM's "Other" rows
 * (`changeId` ''). A record is `{ id, moment, period: { sessionId, day, floor }, at, worldTime, by, entries, boxes,
 * undoneAt }`.
 */
import { popularityChangesFor, milestonesCrossed, FAN_BOX_DAY_JUMP, POPULARITY_SESSION_HOURS } from '../../data/rules/popularity-changes.mjs';
import { popularityActive } from './popularity.mjs';
import { SECONDS_PER_HOUR } from '../time/timing.mjs';

/** The most Apply records the setting keeps; the oldest are dropped. */
const POPULARITY_CHECK_HISTORY = 60;

const KEY = 'COG.PopularityChecklist.Hint';
const TEXT = {
  [`${KEY}.DayJump`]: 'Gained {gain} Popularity in a day',
  [`${KEY}.BoxThisFloor`]: 'Already had a Fan Box on this floor'
};

function text(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return TEXT[key].replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

const finite = (value) => (value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
const live = (records) => (Array.isArray(records) ? records : []).filter((r) => r && !r.undoneAt);

/** Whether a not-undone record already paid `changeId` to `actorId` for this definition's period. */
function usedThisPeriod(def, actorId, { floor, now, applied }) {
  const window = POPULARITY_SESSION_HOURS * SECONDS_PER_HOUR * 1000;
  return live(applied).some((record) => {
    if (!(record.entries ?? []).some((e) => e.actorId === actorId && e.changeId === def.id)) return false;
    if (def.oncePer === 'floor') return finite(record.period?.floor) === floor;
    if (def.oncePer === 'day') return finite(record.period?.day) === finite(now?.day);
    return finite(now?.real) !== null && finite(record.at) !== null && now.real - record.at < window;
  });
}

/**
 * The grid one moment shows: a row per registered change, a cell per crawler. A cell is pre-ticked from the change's
 * `pretick` unless its period is already paid (`usedThisPeriod`); on the First Floor nothing is pre-ticked.
 * @param {object} p
 * @param {string} p.moment 'session' | 'day' | 'floor'
 * @param {number} p.floor the floor the check is for
 * @param {object[]} p.facts one per crawler (see data/rules/popularity-changes.mjs)
 * @param {object[]} p.applied the applied records (undone ones are ignored)
 * @param {{ real: number, day: number }} p.now real time (ms) and the dungeon day the check is for
 * @param {object[]} [p.defs] the changes to list; the live registry's by default
 * @returns {{ rows: object[], gated: boolean }}
 */
export function planChecklist({ moment, floor, facts, applied, now, defs }) {
  const at = finite(floor) ?? 1;
  const gated = !popularityActive(at);
  const list = defs ?? popularityChangesFor(moment, at);
  const rows = list.map((def) => ({
    changeId: def.id,
    label: def.label,
    value: def.value,
    cells: (facts ?? []).map((fact) => {
      const used = usedThisPeriod(def, fact.actorId, { floor: at, now, applied });
      const pre = typeof def.pretick === 'function' ? def.pretick(fact) : { ticked: false, hint: '' };
      return { actorId: fact.actorId, ticked: !gated && !used && Boolean(pre?.ticked), hint: pre?.hint ?? '', amount: def.value, usedThisPeriod: used };
    })
  }));
  return { rows, gated };
}

/**
 * Each crawler's Popularity after the selection.
 * @returns {Record<string, number>}
 */
export function projectPopularity(facts, selection) {
  const out = {};
  for (const fact of facts ?? []) out[fact.actorId] = Number(fact.popularity) || 0;
  for (const entry of selection?.entries ?? []) {
    if (entry.actorId in out) out[entry.actorId] += finite(entry.delta) ?? 0;
  }
  return out;
}

/**
 * The Fan Box offers of the Day moment: a crawler who gained `FAN_BOX_DAY_JUMP` or more in the ended day (core p. 280).
 * One who already has a Fan Box for this floor is offered unticked, with a hint. Milestones are not offered here; the
 * GM alert covers them.
 * @param {{ moment: string, floor: number, facts: object[], fanBoxes?: { lastFloor?: Record<string, number> } }} p
 * @returns {Array<{ actorId: string, reason: string, ticked: boolean, hint: string }>}
 */
export function fanBoxOffers({ moment, floor, facts, fanBoxes }) {
  if (moment !== 'day') return [];
  const offers = [];
  for (const fact of facts ?? []) {
    const gain = finite(fact.dayGain);
    if (gain === null || gain < FAN_BOX_DAY_JUMP) continue;
    const had = finite(fanBoxes?.lastFloor?.[fact.actorId]) === finite(floor);
    offers.push({ actorId: fact.actorId, reason: 'day-jump', ticked: !had, hint: had ? text(`${KEY}.BoxThisFloor`) : text(`${KEY}.DayJump`, { gain }) });
  }
  return offers;
}

/**
 * The milestones a projected value would carry each crawler across, for the window's "crosses 50" hint.
 * @param {{ before: Record<string, number>, projected: Record<string, number>, rule?: object }} p
 * @returns {Record<string, number[]>} only crawlers that cross one
 */
export function milestoneHints({ before, projected, rule }) {
  const out = {};
  for (const actorId of Object.keys(projected ?? {})) {
    const crossed = milestonesCrossed(before?.[actorId], projected[actorId], rule);
    if (crossed.length) out[actorId] = crossed;
  }
  return out;
}

/**
 * The Rule Breaks a selection needs (Directive 2: asked, never blocking): a cell ticked again inside its period, and
 * anything at all on the First Floor.
 * @returns {Array<{ actorId: string, changeId: string, why: 'used' | 'first-floor' }>}
 */
export function checklistRuleBreaks(plan, selection) {
  const used = new Set();
  for (const row of plan?.rows ?? []) for (const cell of row.cells) if (cell.usedThisPeriod) used.add(`${cell.actorId}:${row.changeId}`);
  const out = [];
  for (const { actorId, changeId } of selection?.entries ?? []) {
    if (plan?.gated) out.push({ actorId, changeId, why: 'first-floor' });
    else if (changeId && used.has(`${actorId}:${changeId}`)) out.push({ actorId, changeId, why: 'used' });
  }
  return out;
}

/**
 * The stored record of one Apply. Entries with a Rule Break carry `ruleBreak: true`.
 * @param {object} p
 * @param {string} p.moment
 * @param {{ sessionId: string, day: number, floor: number }} p.period
 * @param {{ entries: object[] }} p.selection
 * @param {Array<{ actorId: string, tier: string, reason: string }>} p.boxes
 * @param {Array<{ actorId: string, changeId: string }>} p.ruleBreaks the ones the GM confirmed
 * @param {string} p.by user id
 * @param {number} p.at Date.now()
 * @param {number} p.worldTime world seconds
 */
export function buildCheckRecord({ moment, period, selection, boxes, ruleBreaks, by, at, worldTime }) {
  const broken = new Set((ruleBreaks ?? []).map((r) => `${r.actorId}:${r.changeId}`));
  return {
    id: `check-${at}-${Math.random().toString(36).substring(2, 7)}`,
    moment,
    period: { sessionId: period?.sessionId ?? '', day: finite(period?.day) ?? 0, floor: finite(period?.floor) ?? 0 },
    at,
    worldTime,
    by,
    entries: (selection?.entries ?? []).map((e) => ({
      actorId: e.actorId,
      changeId: e.changeId ?? '',
      label: String(e.label ?? ''),
      delta: finite(e.delta) ?? 0,
      ruleBreak: broken.has(`${e.actorId}:${e.changeId ?? ''}`)
    })),
    boxes: (boxes ?? []).map((b) => ({ actorId: b.actorId, tier: b.tier, reason: b.reason })),
    undoneAt: null
  };
}

/**
 * The writes that take a record back: the opposite amount per crawler, summed (a crawler whose lines cancel is skipped).
 * @returns {Array<{ actorId: string, delta: number }>}
 */
export function undoEntries(record) {
  const sums = new Map();
  for (const e of record?.entries ?? []) sums.set(e.actorId, (sums.get(e.actorId) ?? 0) + (finite(e.delta) ?? 0));
  return [...sums].filter(([, sum]) => sum !== 0).map(([actorId, sum]) => ({ actorId, delta: -sum }));
}

/**
 * The crawlers an undo takes back below a milestone, worked out from the numbers alone (the Undo card's line): each
 * crawler's value just before the undo, less what the record added, against the milestones between the two.
 * @param {object} record an applied record
 * @param {Record<string, number>} valuesBefore each crawler's Popularity just before the undo
 * @param {{ list: number[], factor: number }} [rule] the live `CONFIG.COG.fanBoxMilestones` by default
 * @returns {Array<{ actorId: string, milestones: number[] }>}
 */
export function uncrossedByUndo(record, valuesBefore, rule) {
  const out = [];
  for (const { actorId, delta } of undoEntries(record)) {
    const before = finite(valuesBefore?.[actorId]);
    if (before === null) continue;
    const milestones = milestonesCrossed(before + delta, before, rule);
    if (milestones.length) out.push({ actorId, milestones });
  }
  return out;
}

/** The setting's state with one more record, the oldest dropped past the cap. */
export function appendApplied(state, record) {
  const applied = [...(Array.isArray(state?.applied) ? state.applied : []), record].slice(-POPULARITY_CHECK_HISTORY);
  return { ...state, applied };
}

/**
 * Which moments the GM should be offered a checklist for (the badges on the Session Manager buttons and the due card):
 * a floor was left and has no applied Floor record; a dungeon day ended and has no applied Day record; the active session
 * has run `POPULARITY_SESSION_HOURS` of real time since its last applied Session record (or since it was created).
 * @param {object} p
 * @param {object[]} p.applied the applied records (undone ones are ignored)
 * @param {{ createdAt?: number }|null} p.activeSession
 * @param {number} p.real real time now (ms)
 * @param {number|null} p.endedDay the newest dungeon day a crawler's baseline closed, else null
 * @param {{ floor: number }|null} p.floorExit the floor-exit snapshot
 * @returns {{ session: boolean, day: boolean, floor: boolean }}
 */
export function dueMoments({ applied, activeSession, real, endedDay, floorExit }) {
  const records = live(applied);
  const floorLeft = finite(floorExit?.floor);
  const day = finite(endedDay);
  let session = false;
  if (activeSession) {
    const last = records.filter((r) => r.moment === 'session' && r.period?.sessionId === activeSession.id).reduce((m, r) => Math.max(m, finite(r.at) ?? 0), 0);
    const since = Math.max(last, finite(activeSession.createdAt) ?? 0);
    session = finite(real) !== null && real - since >= POPULARITY_SESSION_HOURS * SECONDS_PER_HOUR * 1000;
  }
  return {
    session,
    day: day !== null && !records.some((r) => r.moment === 'day' && finite(r.period?.day) === day),
    floor: floorLeft !== null && !records.some((r) => r.moment === 'floor' && finite(r.period?.floor) === floorLeft)
  };
}
