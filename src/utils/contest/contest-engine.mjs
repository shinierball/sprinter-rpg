/**
 * src/utils/contest/contest-engine.mjs
 * Pure rules for racing and chasing contests (Core Rulebook pp. 74-75). No Foundry
 * globals, no I/O. The app, the chat card and the tests share these functions.
 *
 * State (v1) is a plain object stored on the contest's chat message; `sanitizeContest` rebuilds a valid one from
 * anything (CONTRIBUTING §4). Placements, Ground and who is out are derived here and never stored. Nothing throws or
 * blocks (CONTRIBUTING rule 2): a missing result counts as nothing, and the caller asks for a Rule Break where it matters.
 *
 * Rulings used where the book is silent (design doc section 1.4):
 * - G2 shared places use competition ranking (1, 2, 2, 4).
 * - G12 a racer with no result in a closed leg is placed after every racer who has one (sharing that place).
 * - A chaser with no result in a closed leg gains no Ground that leg.
 * - G5 the p. 60 degree bands are used everywhere (a chase example's "Near Miss" 4 short is a Failure).
 */
import { evaluateRollOutcome, COG_ROLL_OUTCOMES } from '../../apps/session-manager/roll-outcomes.mjs';
import { CHASE_GROUND, CONTEST_KINDS, contestKindInfo, sanitizeContestKind } from '../../data/rules/contest-rules.mjs';

export const CONTEST_STATE_VERSION = 1;
export const DEFAULT_CATCH_THRESHOLD = 4;
export const DEFAULT_LOSE_THRESHOLD = -4;
const STATUSES = Object.freeze(['setup', 'leg', 'done']);
const LEG_STATUSES = Object.freeze(['pending', 'open', 'closed']);
const MODES = Object.freeze(['roll', 'fixed']);
const MOVE_MODES = Object.freeze(['move', 'swim', 'climb', 'fly']);
const SOURCES = Object.freeze(['roll', 'fixed', 'gm']);
const OUT_REASONS = Object.freeze(['critFail', 'lost', 'caught', 'dropped']);
const STATS = Object.freeze(['str', 'dex', 'con', 'int', 'cha']);
const MAX_TEXT = 120;

/** First entry of an array, first item of a comma string, trimmed; anything else is ''. */
function firstString(raw) {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  if (typeof val !== 'string') return '';
  if (val.includes(',')) val = val.split(',')[0];
  return val.trim();
}

const text = (raw) => (typeof raw === 'string' ? raw.trim().slice(0, MAX_TEXT) : '');
const finite = (raw, fallback = 0) => {
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};
const oneOf = (raw, allowed, fallback) => {
  const v = firstString(raw);
  return allowed.includes(v) ? v : fallback;
};
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The Move Rate Modifier: Move divided by 10, rounded down; never negative. */
export function moveRateMod(move) {
  return Math.floor(Math.max(0, finite(move)) / 10);
}

/**
 * The fixed result an NPC or mob takes each leg: `10 + Stat Mod + Floor + Move Rate Modifier`, plus `adjust` (the
 * Debuff shift and flat check rows, or a GM tweak). `parts` lists every term for the card.
 * @returns {{ total: number, parts: Array<{ key: string, value: number }> }}
 */
export function fixedResult({ statMod = 0, floor = 0, moveMod = 0, adjust = 0 } = {}) {
  const parts = [
    { key: 'base', value: 10 },
    { key: 'stat', value: finite(statMod) },
    { key: 'floor', value: finite(floor) },
    { key: 'move', value: finite(moveMod) },
    { key: 'adjust', value: finite(adjust) }
  ];
  return { total: parts.reduce((sum, p) => sum + p.value, 0), parts };
}

/**
 * Move for a participant on a leg. `resolve(uuid)` returns an actor-like document (or null); it is injected so this
 * stays Foundry-free. With a vehicle the vehicle's Move is used. Otherwise the leg's `moveMode` speed is read, falling
 * back to `speed.move` when it is missing or zero. `baseMove` is always the participant's own `speed.move` (tie-breaks).
 * @returns {{ move: number, baseMove: number, source: 'vehicle'|'actor'|'swim'|'climb'|'fly'|'none' }}
 */
export function contestMoveOf(participant, leg, resolve) {
  const lookup = (uuid) => {
    if (typeof resolve !== 'function' || typeof uuid !== 'string' || !uuid) return null;
    try { return resolve(uuid) ?? null; } catch { return null; }
  };
  const own = lookup(participant?.actorUuid);
  const speed = own?.system?.attributes?.speed;
  const baseMove = Math.max(0, finite(speed?.move));
  const vehicle = lookup(participant?.vehicleUuid);
  if (vehicle) {
    const vMove = finite(vehicle.system?.attributes?.speed?.move, finite(vehicle.system?.attributes?.move, 0));
    return { move: Math.max(0, vMove), baseMove, source: 'vehicle' };
  }
  if (!own) return { move: 0, baseMove: 0, source: 'none' };
  const mode = oneOf(leg?.moveMode, MOVE_MODES, 'move');
  const modeMove = mode === 'move' ? 0 : finite(speed?.[mode]);
  if (modeMove > 0) return { move: modeMove, baseMove, source: mode };
  return { move: baseMove, baseMove, source: 'actor' };
}

// ---------------------------------------------------------------------------------------------------------------
// State sanitiser

function sanitizeLeg(raw, index, usedIds) {
  const src = isObject(raw) ? raw : {};
  let id = text(typeof src.id === 'string' ? src.id : '') || `leg-${index + 1}`;
  while (usedIds.has(id)) id = `${id}-${index + 1}`;
  usedIds.add(id);
  const check = isObject(src.check) ? src.check : {};
  const skill = firstString(check.skill);
  return {
    id,
    label: text(src.label) || `Leg ${index + 1}`,
    check: { skill: skill || null, stat: oneOf(check.stat, STATS, 'str') },
    moveMode: oneOf(src.moveMode, MOVE_MODES, 'move'),
    status: oneOf(src.status, LEG_STATUSES, 'pending')
  };
}

function sanitizeParticipant(raw, index, usedIds, kindRoles, legIds) {
  const src = isObject(raw) ? raw : {};
  let id = text(typeof src.id === 'string' ? src.id : '') || `p-${index + 1}`;
  while (usedIds.has(id)) id = `${id}-${index + 1}`;
  usedIds.add(id);
  let out = null;
  if (isObject(src.out)) {
    const leg = firstString(src.out.leg);
    out = { leg: legIds.has(leg) ? leg : null, reason: oneOf(src.out.reason, OUT_REASONS, 'dropped') };
  }
  return {
    id,
    actorUuid: firstString(src.actorUuid),
    tokenId: firstString(src.tokenId),
    name: text(src.name) || 'Participant',
    role: oneOf(src.role, kindRoles, kindRoles[0]),
    mode: oneOf(src.mode, MODES, 'roll'),
    vehicleUuid: firstString(src.vehicleUuid) || null,
    skillOverrides: sanitizeSkillMap(src.skillOverrides, legIds),
    skillProposals: sanitizeSkillMap(src.skillProposals, legIds),
    out
  };
}

/** `{ [legId]: skill identifier }` for known legs only; blank or non-string skills are dropped. */
function sanitizeSkillMap(raw, legIds) {
  const clean = {};
  if (!isObject(raw)) return clean;
  for (const legId of legIds) {
    const skill = firstString(raw[legId]).slice(0, MAX_TEXT);
    if (skill) clean[legId] = skill;
  }
  return clean;
}

/**
 * The skill a participant rolls on a leg (D3): the GM-accepted override for that leg, else the leg's own skill.
 * A bare-stat leg without an override gives `skill: null`. Rolling anything else is a Rule Break.
 * @returns {{ skill: string|null, overridden: boolean }}
 */
export function participantLegSkill(participant, leg) {
  const override = firstString(participant?.skillOverrides?.[leg?.id]);
  if (override) return { skill: override, overridden: true };
  return { skill: leg?.check?.skill ?? null, overridden: false };
}

function sanitizeResult(raw) {
  if (!isObject(raw)) return null;
  const total = Number(raw.total);
  if (raw.total === null || raw.total === '' || typeof raw.total === 'boolean' || !Number.isFinite(total)) return null;
  const d20 = Number(raw.d20);
  const hasD20 = raw.d20 !== null && raw.d20 !== undefined && raw.d20 !== '' && Number.isInteger(d20) && d20 >= 1 && d20 <= 20;
  return {
    total,
    d20: hasD20 ? d20 : null,
    source: oneOf(raw.source, SOURCES, 'roll'),
    messageId: firstString(raw.messageId) || null,
    ruleBreak: raw.ruleBreak === true,
    note: text(raw.note)
  };
}

/**
 * A valid v1 contest state from anything. Unknown kinds fall back to the default kind, ids are made unique, results for
 * unknown legs or participants are dropped, a bad result is dropped, and a participant role the kind does not allow
 * becomes the kind's default role.
 */
export function sanitizeContest(raw) {
  const src = isObject(raw) ? raw : {};
  const kind = sanitizeContestKind(src.kind);
  const kindRoles = contestKindInfo(kind).roles;
  const legIds = new Set();
  const legs = (Array.isArray(src.legs) ? src.legs : []).map((l, i) => sanitizeLeg(l, i, legIds));
  const pIds = new Set();
  const legIdSet = new Set(legs.map((l) => l.id));
  const participants = (Array.isArray(src.participants) ? src.participants : [])
    .map((p, i) => sanitizeParticipant(p, i, pIds, kindRoles, legIdSet));
  const thr = isObject(src.thresholds) ? src.thresholds : {};
  const catchAt = Math.trunc(finite(thr.catch, DEFAULT_CATCH_THRESHOLD));
  const loseAt = Math.trunc(finite(thr.lose, DEFAULT_LOSE_THRESHOLD));
  const results = {};
  if (isObject(src.results)) {
    for (const legId of legIdSet) {
      const row = src.results[legId];
      if (!isObject(row)) continue;
      const clean = {};
      for (const pId of pIds) {
        const r = sanitizeResult(row[pId]);
        if (r) clean[pId] = r;
      }
      if (Object.keys(clean).length) results[legId] = clean;
    }
  }
  return {
    v: CONTEST_STATE_VERSION,
    kind,
    status: oneOf(src.status, STATUSES, 'setup'),
    floor: Math.max(0, Math.trunc(finite(src.floor, 0))),
    thresholds: { catch: catchAt >= 1 ? catchAt : DEFAULT_CATCH_THRESHOLD, lose: loseAt <= -1 ? loseAt : DEFAULT_LOSE_THRESHOLD },
    legs,
    participants,
    results
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Race

/**
 * Place one leg. Highest total is 1st; a tie goes to the higher base Move; equal on both shares the place with
 * competition numbering (1, 2, 2, 4). Rows without a finite total are left out.
 * @param {Array<{ id: string, total: number, baseMove?: number }>} rows
 * @returns {Record<string, number>} participant id -> place
 */
export function placeLeg(rows) {
  const list = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.id === 'string' && r.total !== null && r.total !== '' && Number.isFinite(Number(r.total)))
    .map((r) => ({ id: r.id, total: Number(r.total), baseMove: finite(r.baseMove) }));
  list.sort((a, b) => b.total - a.total || b.baseMove - a.baseMove);
  const places = {};
  list.forEach((row, i) => {
    const prev = list[i - 1];
    places[row.id] = prev && prev.total === row.total && prev.baseMove === row.baseMove ? places[prev.id] : i + 1;
  });
  return places;
}

/** Racers of a state (the kind's first role), in listed order. */
const racersOf = (state) => state.participants.filter((p) => p.role === CONTEST_KINDS.race?.roles?.[0]);

/**
 * Race standings from the closed legs.
 * Each racer's placements are summed; the lowest sum wins, then the better placement in the last closed leg, then it
 * stays a tie. A racer who has dropped out (stored `out`) is placed last from the leg they left.
 * @param {object} rawState
 * @param {(uuid: string) => object|null} [resolve] injected actor lookup (base Move for tie-breaks)
 * @returns {{ legs: Array<{ id: string, places: Record<string, number> }>, rows: Array<{ id: string, places: Array<number|null>, sum: number, rank: number }>, winners: string[], tied: boolean, complete: boolean }}
 */
export function raceStandings(rawState, resolve) {
  const state = sanitizeContest(rawState);
  const racers = racersOf(state);
  const closed = state.legs.filter((l) => l.status === 'closed');
  const legPlaces = closed.map((leg) => {
    const rows = [];
    for (const p of racers) {
      if (isOutFrom(state, p, leg)) continue;
      const r = state.results[leg.id]?.[p.id];
      if (r) rows.push({ id: p.id, total: r.total, baseMove: contestMoveOf(p, leg, resolve).baseMove });
    }
    const places = placeLeg(rows);
    const placed = Object.keys(places).length;
    for (const p of racers) if (!(p.id in places)) places[p.id] = placed + 1; // G12 / no result: after everyone who has one
    return { id: leg.id, places };
  });
  const rows = racers.map((p) => {
    const places = legPlaces.map((l) => l.places[p.id] ?? null);
    return { id: p.id, places, sum: places.reduce((s, n) => s + (n ?? 0), 0), rank: 0 };
  });
  const last = legPlaces.length - 1;
  const finalPlace = (row) => (last >= 0 ? row.places[last] ?? Infinity : 0);
  rows.sort((a, b) => a.sum - b.sum || finalPlace(a) - finalPlace(b));
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    row.rank = prev && prev.sum === row.sum && finalPlace(prev) === finalPlace(row) ? prev.rank : i + 1;
  });
  const winners = closed.length ? rows.filter((r) => r.rank === 1).map((r) => r.id) : [];
  return {
    legs: legPlaces,
    rows,
    winners,
    tied: winners.length > 1,
    complete: racers.length > 0 && state.legs.length > 0 && closed.length === state.legs.length
  };
}

/** Whether a stored drop-out removes `participant` from `leg` (the leg they left and every later one). */
function isOutFrom(state, participant, leg) {
  const out = participant.out;
  if (!out) return false;
  if (!out.leg) return true;
  const from = state.legs.findIndex((l) => l.id === out.leg);
  return state.legs.findIndex((l) => l.id === leg.id) >= from;
}

// ---------------------------------------------------------------------------------------------------------------
// Chase

/**
 * One chaser's leg: the degree against the quarry's value (p. 60 bands; a null `d20` is margin-only, so a fixed result
 * never crits) and the Ground it is worth from `CONFIG.COG.chaseGround`.
 * @returns {{ degree: string, ground: number, out: boolean }}
 */
export function chaseLeg(total, d20, quarryValue) {
  const die = d20 === null || d20 === undefined || d20 === '' ? null : Number(d20);
  const degree = evaluateRollOutcome({ total: Number(total), d20Result: Number.isFinite(die) ? die : null, targetDC: quarryValue });
  const def = CHASE_GROUND[degree];
  if (!def) return { degree, ground: 0, out: false };
  return { degree, ground: def.out ? 0 : def.ground, out: def.out === true };
}

/**
 * A fixed chaser against a rolling quarry (design Q1): the quarry rolled once, the chaser's fixed result is the
 * Difficulty, and the chaser's Ground mirrors the quarry's degree. A quarry Critical Failure costs the chaser the
 * Major Failure amount in Ground (it gains, never exits).
 */
function mirrorLeg(quarry, chaserValue) {
  const q = chaseLeg(quarry.total, quarry.d20, chaserValue);
  const def = CHASE_GROUND[q.degree];
  if (q.out) return { degree: q.degree, ground: Math.abs(CHASE_GROUND[COG_ROLL_OUTCOMES.MAJOR_FAILURE]?.ground ?? 2), out: false };
  return { degree: q.degree, ground: -(def?.ground ?? 0), out: false };
}

/**
 * Chase status from the closed legs.
 * Per chaser: Ground accumulates leg by leg; a Critical Failure puts them out; reaching `thresholds.catch` catches the
 * quarry early; reaching `thresholds.lose` loses it (out). Once resolved a chaser takes no more legs. The chase is
 * finished when every leg is closed, no chaser is still running, or the status is 'done'. At that point a running
 * chaser with Ground of 1 or more has caught the quarry, 0 or less has not. `order` ranks those who caught it:
 * highest Ground, then higher base Move.
 * @param {object} rawState
 * @param {(uuid: string) => object|null} [resolve]
 * @returns {{ quarryId: string|null, chasers: Array<object>, finished: boolean, order: string[] }}
 */
export function chaseStatus(rawState, resolve) {
  const state = sanitizeContest(rawState);
  const chaserRole = CONTEST_KINDS.chase?.roles?.[0];
  const quarryRole = CONTEST_KINDS.chase?.roles?.[1];
  const quarry = state.participants.find((p) => p.role === quarryRole) ?? null; // G16: the first quarry
  const chasers = state.participants.filter((p) => p.role === chaserRole);
  const closed = state.legs.filter((l) => l.status === 'closed');

  const rows = chasers.map((p) => {
    const row = { id: p.id, ground: 0, state: 'active', outLeg: null, outReason: null, legs: [], baseMove: 0 };
    row.baseMove = contestMoveOf(p, null, resolve).baseMove;
    for (const leg of closed) {
      if (row.state !== 'active') break;
      if (isOutFrom(state, p, leg)) {
        row.state = 'out'; row.outLeg = leg.id; row.outReason = p.out.reason;
        break;
      }
      const mine = state.results[leg.id]?.[p.id];
      const theirs = quarry ? state.results[leg.id]?.[quarry.id] : null;
      if (!mine || !theirs) { row.legs.push({ legId: leg.id, degree: null, ground: 0, total: mine?.total ?? null, missing: true }); continue; }
      const step = p.mode === 'fixed' && quarry.mode !== 'fixed' ? mirrorLeg(theirs, mine.total) : chaseLeg(mine.total, mine.d20, theirs.total);
      row.legs.push({ legId: leg.id, degree: step.degree, ground: step.ground, total: mine.total, quarry: theirs.total });
      row.ground += step.ground;
      if (step.out) { row.state = 'out'; row.outLeg = leg.id; row.outReason = 'critFail'; }
      else if (row.ground >= state.thresholds.catch) { row.state = 'caught'; row.outLeg = leg.id; row.outReason = 'caught'; }
      else if (row.ground <= state.thresholds.lose) { row.state = 'out'; row.outLeg = leg.id; row.outReason = 'lost'; }
    }
    return row;
  });

  const running = rows.some((r) => r.state === 'active');
  const finished = rows.length > 0 && (state.status === 'done' || !running || (state.legs.length > 0 && closed.length === state.legs.length));
  if (finished) {
    for (const r of rows) {
      if (r.state !== 'active') continue;
      r.state = r.ground >= 1 ? 'caught' : 'escaped';
    }
  }
  const order = rows
    .filter((r) => r.state === 'caught')
    .sort((a, b) => b.ground - a.ground || b.baseMove - a.baseMove)
    .map((r) => r.id);
  return { quarryId: quarry?.id ?? null, chasers: rows, finished, order };
}
