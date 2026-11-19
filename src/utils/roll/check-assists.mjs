/**
 * Check records and assists.
 *
 * Every d20 check card carries a record under `flags.sprinter-rpg.check`: who rolled, the unassisted total, the
 * per-target Difficulties and the assists added since (an Intervene after the roll, a Called Play written when the
 * card was made). Nothing derived is stored: every reader calls `effectiveCheck(record)` so concurrent assists
 * cannot leave a stale sum. A pure leaf: it imports only constants, the tag vocabulary, the tag query and the
 * outcome classifier, and names no tag literal.
 */
import { flagPath, readFlag } from '../flags.mjs';
import { CHECK_TAGS, OUTCOME_TAGS, isOutcomeTag, getTagsOf, getInterruptTriggersFromTags, isOfferedOnCheck, isOfferedBeforeCheck, calledAssistTrigger } from '../tag/tag-mechanics.mjs';
import { matchesTagQuery, matchesTagQueryIgnoring } from '../tag/tag-query.mjs';
import { COG_ROLL_OUTCOMES, attackHits, evaluateRollOutcome, extractD20Result, shiftDegree } from '../../documents/session/roll-outcomes.mjs';
import { maxOfDiceFormula } from './dice-max.mjs';
import { sanitizePatronCheckRef } from '../patron/patron-check-ref.mjs';
import { sanitizePetCheckRef } from '../pet/pet-check-ref.mjs';
import { DIFFICULTY_MODES } from '../../data/rules/difficulty-rules.mjs';
import { sanitizePartyCheckRef } from './party-ref.mjs';

export const CHECK_RECORD_FLAG = 'check';
const CHECK_RECORD_VERSION = 1;
export const MAX_RECORD_ASSISTS = 20;
export const MAX_RECORD_REROLLS = 5;
const MAX_RECORD_SHIFTS = 10;
const MAX_RECORD_OFFERS_USED = 20;
const MAX_CONTEXT_TAGS = 120;

const RECORD_KINDS = Object.freeze(['skill', 'attack', 'spell', 'evade', 'stat']);
const ASSIST_SOURCES = Object.freeze(['interrupt', 'called_play', 'help']);
const REROLL_SOURCES = Object.freeze(['ai_favor', 'row']);
const APPLIED_TO = Object.freeze(['check', 'damage', 'none', 'unresolved']);
const SUCCESS_OUTCOMES = Object.freeze([COG_ROLL_OUTCOMES.SUCCESS, COG_ROLL_OUTCOMES.AMAZING_SUCCESS, COG_ROLL_OUTCOMES.CRITICAL_SUCCESS]);
// Built on first use: this module sits on an import cycle with tag-mechanics.mjs, so CHECK_TAGS may not be
// initialised yet when this file is evaluated (tests/structural/entry-import-order.test.mjs).
let knownCheckTags = null;
const isKnownCheckTag = (t) => (knownCheckTags ??= new Set(Object.values(CHECK_TAGS))).has(t);

// -- Sanitisers (never trust a stored shape) ------------------------------------------------------------------

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOrNull = (v) => (typeof v === 'string' && v ? v : null);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One assist entry, or null when it is unusable (no finite amount, unknown source or `appliedTo`). */
function sanitizeAssist(raw, fallbackId = '') {
  if (!isPlain(raw)) return null;
  const source = ASSIST_SOURCES.includes(raw.source) ? raw.source : null;
  if (!source) return null;
  const amount = typeof raw.amount === 'number' ? raw.amount : Number(raw.amount);
  if (!Number.isFinite(amount)) return null;
  // An Intervene and a Help die are always added to the check; a record written without the field means exactly that.
  const appliedTo = raw.appliedTo === undefined && (source === 'interrupt' || source === 'help') ? 'check' : raw.appliedTo;
  if (!APPLIED_TO.includes(appliedTo)) return null;
  const id = str(raw.id) || fallbackId;
  if (!id) return null;
  return {
    id,
    at: num(raw.at),
    source,
    fromUuid: str(raw.fromUuid),
    fromName: str(raw.fromName),
    skillName: str(raw.skillName),
    // A formula is kept for display when present; a stored amount (rolled at call time) is the truth.
    formula: str(raw.formula),
    amount,
    appliedTo,
    messageId: strOrNull(raw.messageId),
    rollMessageId: strOrNull(raw.rollMessageId),
    rollIndex: numOrNull(raw.rollIndex),
    calledPlayId: strOrNull(raw.calledPlayId),
    proposal: str(raw.proposal)
  };
}

/** Assists from an object keyed by id (the flag shape, dotted writes) or an array; sorted by `at`, at most MAX_RECORD_ASSISTS. */
function sanitizeAssists(raw) {
  const pairs = Array.isArray(raw)
    ? raw.map((entry, i) => [isPlain(entry) ? entry.id : '', entry, `assist-${i}`])
    : (isPlain(raw) ? Object.entries(raw).map(([key, entry]) => [key, entry, key]) : []);
  const out = [];
  for (const [, entry, fallbackId] of pairs) {
    const clean = sanitizeAssist(entry, fallbackId);
    if (clean) out.push(clean);
  }
  out.sort((a, b) => (a.at - b.at) || a.id.localeCompare(b.id));
  return out.slice(0, MAX_RECORD_ASSISTS);
}

/** One reroll entry, or null when it is unusable (no finite total, unknown source). `total` is the whole new total, `d20` the new kept face. */
function sanitizeReroll(raw, fallbackId = '') {
  if (!isPlain(raw)) return null;
  const total = numOrNull(raw.total);
  if (total === null) return null;
  const source = REROLL_SOURCES.includes(raw.source) ? raw.source : null;
  if (!source) return null;
  const id = str(raw.id) || fallbackId;
  if (!id) return null;
  return {
    id,
    at: num(raw.at),
    source,
    rowKey: str(raw.rowKey),
    byName: str(raw.byName),
    d20: numOrNull(raw.d20),
    total,
    messageId: strOrNull(raw.messageId),
    ruleBreak: raw.ruleBreak === true,
    reasons: (Array.isArray(raw.reasons) ? raw.reasons : []).filter((r) => typeof r === 'string' && r).slice(0, 8)
  };
}

/** Rerolls from an object keyed by id (the flag shape, dotted writes) or an array; sorted by `at`, at most MAX_RECORD_REROLLS. */
function sanitizeRerolls(raw) {
  const pairs = Array.isArray(raw)
    ? raw.map((entry, i) => [entry, isPlain(entry) && entry.id ? entry.id : `reroll-${i}`])
    : (isPlain(raw) ? Object.entries(raw).map(([key, entry]) => [entry, key]) : []);
  const out = [];
  for (const [entry, fallbackId] of pairs) {
    const clean = sanitizeReroll(entry, fallbackId);
    if (clean) out.push(clean);
  }
  out.sort((a, b) => (a.at - b.at) || a.id.localeCompare(b.id));
  return out.slice(0, MAX_RECORD_REROLLS);
}

/** A shift list: plain objects with a row key, `{ rowKey, steps, failOnly }`, at most MAX_RECORD_SHIFTS. */
function sanitizeShifts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => isPlain(s) && typeof s.rowKey === 'string' && s.rowKey)
    .map((s) => ({ rowKey: s.rowKey.slice(0, 200), steps: Math.max(1, Math.trunc(Number(s.steps)) || 1), failOnly: s.failOnly !== false }))
    .slice(0, MAX_RECORD_SHIFTS);
}

/** The shifts applied to a degree, in order. A pending degree is never shifted. */
function applyShifts(outcome, shifts) {
  if (outcome === COG_ROLL_OUTCOMES.PENDING) return outcome;
  let id = outcome;
  for (const s of shifts) id = shiftDegree(id, s.steps, { failOnly: s.failOnly });
  return id;
}

function sanitizeTarget(raw) {
  if (!isPlain(raw)) return null;
  return {
    actorId: str(raw.actorId),
    actorUuid: str(raw.actorUuid),
    name: str(raw.name),
    dc: numOrNull(raw.dc),
    bonus: num(raw.bonus)
  };
}

function sanitizeEvade(raw) {
  if (!isPlain(raw)) return null;
  return {
    isArea: raw.isArea === true,
    areaOutcome: ['full', 'half', 'none'].includes(raw.areaOutcome) ? raw.areaOutcome : 'half',
    floor: Math.max(0, num(raw.floor))
  };
}

/** How the card's Difficulty was reached (the GM's set or a standing stamp), or null when none was recorded. */
function sanitizeDifficulty(raw) {
  if (!isPlain(raw) || !DIFFICULTY_MODES.includes(raw.mode)) return null;
  const value = numOrNull(raw.value);
  if (value === null) return null;
  return {
    mode: raw.mode,
    value: Math.max(0, value),
    floor: Math.max(0, num(raw.floor)),
    foeUuid: str(raw.foeUuid),
    foeName: str(raw.foeName),
    stat: str(raw.stat),
    mod: num(raw.mod),
    shift: num(raw.shift),
    standing: raw.standing === true,
    by: str(raw.by),
    at: num(raw.at)
  };
}

/** The contest reference a leg roll carries ({ messageId, legId, participantId }), or null (3.45). */
function sanitizeContestRefRecord(raw) {
  if (!isPlain(raw)) return null;
  const messageId = str(raw.messageId);
  const legId = str(raw.legId);
  const participantId = str(raw.participantId);
  return messageId || legId || participantId ? { messageId, legId, participantId } : null;
}

/** The vehicle reference a vehicle check carries (3.44d), or null. The outcome is never stored: `effectiveCheck` derives it. */
function sanitizeVehicleRefRecord(raw) {
  if (!isPlain(raw)) return null;
  const vehicleUuid = str(raw.vehicleUuid);
  const kind = str(raw.kind);
  if (!vehicleUuid || !kind) return null;
  return {
    vehicleUuid,
    kind,
    dc: numOrNull(raw.dc),
    skill: str(raw.skill),
    stat: str(raw.stat),
    advantage: raw.advantage === true,
    rerollOf: str(raw.rerollOf),
    rerollKey: str(raw.rerollKey),
    targetUuids: (Array.isArray(raw.targetUuids) ? raw.targetUuids : []).filter((t) => typeof t === 'string' && t).slice(0, 20),
    headOn: raw.headOn === true
  };
}

/** The roll's whole context tags kept on a plain check card (`situation.*`, `subject.*`, `id.*`): strings only, at most `MAX_CONTEXT_TAGS`. */
function sanitizeContextTags(raw) {
  return [...new Set(Array.isArray(raw) ? raw.filter((t) => typeof t === 'string' && t) : [])].slice(0, MAX_CONTEXT_TAGS);
}

/** A record from its stored shape; null when it is not a usable record. Assists come back as an array. */
function sanitizeRecord(raw) {
  if (!isPlain(raw) || !RECORD_KINDS.includes(raw.kind)) return null;
  const rolledTotal = numOrNull(raw.total);
  if (rolledTotal === null) return null;
  const rolledD20 = numOrNull(raw.d20);
  const rerolls = sanitizeRerolls(raw.rerolls);
  // The current roll is the last reroll's; the stored `total` and `d20` are never overwritten (`rolled` keeps them).
  const current = rerolls.length ? rerolls[rerolls.length - 1] : null;
  return {
    v: CHECK_RECORD_VERSION,
    kind: raw.kind,
    rollerUuid: str(raw.rollerUuid),
    rollerTokenId: strOrNull(raw.rollerTokenId),
    combatId: strOrNull(raw.combatId),
    round: numOrNull(raw.round),
    tags: (Array.isArray(raw.tags) ? raw.tags : []).filter((t) => typeof t === 'string' && t),
    ...(Array.isArray(raw.contextTags) && raw.contextTags.length ? { contextTags: sanitizeContextTags(raw.contextTags) } : {}),
    total: current ? current.total : rolledTotal,
    d20: current ? current.d20 : rolledD20,
    rolled: { total: rolledTotal, d20: rolledD20 },
    itemUuid: str(raw.itemUuid),
    rerolls,
    shifts: sanitizeShifts(raw.shifts),
    offersUsed: (Array.isArray(raw.offersUsed) ? raw.offersUsed : []).filter((k) => typeof k === 'string' && k).slice(0, MAX_RECORD_OFFERS_USED),
    dc: numOrNull(raw.dc),
    rollId: str(raw.rollId),
    stat: str(raw.stat),
    floor: numOrNull(raw.floor),
    difficulty: sanitizeDifficulty(raw.difficulty),
    targets: (Array.isArray(raw.targets) ? raw.targets : []).map(sanitizeTarget).filter(Boolean),
    hasDamage: raw.hasDamage === true,
    evade: sanitizeEvade(raw.evade),
    assists: sanitizeAssists(raw.assists),
    contest: sanitizeContestRefRecord(raw.contest),
    party: sanitizePartyCheckRef(raw.party),
    vehicle: sanitizeVehicleRefRecord(raw.vehicle),
    patron: sanitizePatronCheckRef(raw.patron),
    pet: sanitizePetCheckRef(raw.pet),
    ...(raw.statOnly === true ? { statOnly: true } : {})
  };
}

// -- Writing and reading the record ---------------------------------------------------------------------------

/**
 * The record a check card stores under `flags.sprinter-rpg.check`. `assists` is an array of entries (a Called Play
 * written with the card); the stored form is an object keyed by id so later assists land with dotted updates.
 * @param {object} p
 * @param {'skill'|'attack'|'spell'|'evade'|'stat'} p.kind
 * @param {object} p.roller the rolling actor
 * @param {string|null} [p.rollerTokenId]
 * @param {object} p.roll the evaluated d20 roll (before assists)
 * @param {{ id?: string, round?: number }|null} [p.combat] the combat the roller fights in, else null
 * @param {string[]} [p.tags] the roll context's check tags; anything else is dropped
 * @param {Array<{ actorId?: string, actorUuid?: string, name?: string, dc?: number|null, bonus?: number }>} [p.targets]
 * @param {number|null} [p.dc] single-DC cards (the Evade's target DC)
 * @param {boolean} [p.hasDamage]
 * @param {{ isArea?: boolean, areaOutcome?: string, floor?: number }|null} [p.evade]
 * @param {object[]} [p.assists]
 * @param {{ messageId?: string, legId?: string, participantId?: string }|null} [p.contest] the race or chase leg this check was rolled for (3.45)
 * @param {{ messageId?: string, participantId?: string }|null} [p.party] the party check card this check was rolled for
 * @param {{ vehicleUuid?: string, kind?: string, dc?: number|null, skill?: string, stat?: string, advantage?: boolean, rerollOf?: string, rerollKey?: string }|null} [p.vehicle] the vehicle this check was rolled for (3.44d)
 * @param {{ kind?: string, itemId?: string, skill?: string, rank?: number, dc?: number|null }|null} [p.patron] the patron item this check was rolled for, an audition or a gig (pp. 315-316)
 * @param {string} [p.itemUuid] the skill, weapon or spell rolled; '' for a stat check or an Evade
 * @param {string} [p.rollId] links the ledger entry to this card
 * @param {string} [p.stat] the Stat rolled (`str` ...), '' when none
 * @param {number|null} [p.floor] the Floor when the check was rolled
 * @param {object|null} [p.difficulty] how `dc` was reached (see `sanitizeDifficulty`)
 * @param {boolean} [p.statOnly] a skill card rolled as a Stat Check (no Rank): the kind stays `skill`, this marks it
 * @param {Iterable<string>} [p.contextTags] the roll's whole context tags (kept on a skill or Stat card only)
 */
export function buildCheckRecord({ kind, roller, rollerTokenId = null, roll, combat = null, tags = [], targets = [], dc = null, hasDamage = false, evade = null, assists = [], contest = null, party = null, vehicle = null, patron = null, pet = null, itemUuid = '', rollId = '', stat = '', floor = null, difficulty = null, statOnly = false, contextTags = [] } = {}) {
  const contextTagsKept = kind === 'skill' || kind === 'stat' ? sanitizeContextTags([...(contextTags ?? [])]) : [];
  const record = {
    v: CHECK_RECORD_VERSION,
    kind: RECORD_KINDS.includes(kind) ? kind : 'skill',
    rollerUuid: str(roller?.uuid),
    rollerTokenId: strOrNull(rollerTokenId),
    combatId: strOrNull(combat?.id),
    round: combat ? numOrNull(combat.round) : null,
    tags: [...new Set((Array.isArray(tags) ? tags : [...(tags ?? [])]).filter(isKnownCheckTag))],
    // The roll's whole context, kept only for a plain check card: the GM may set its Difficulty after the roll (`setCheckDifficulty`)
    // and a Popularity trigger then judges the degree on the roll's tags
    ...(contextTagsKept.length ? { contextTags: contextTagsKept } : {}),
    total: num(roll?.total),
    d20: extractD20Result(roll),
    itemUuid: str(itemUuid),
    rerolls: {},
    shifts: [],
    offersUsed: [],
    dc: numOrNull(dc),
    rollId: str(rollId),
    stat: str(stat),
    floor: numOrNull(floor),
    difficulty: sanitizeDifficulty(difficulty),
    targets: (Array.isArray(targets) ? targets : []).map(sanitizeTarget).filter(Boolean),
    hasDamage: hasDamage === true,
    evade: evade ? sanitizeEvade(evade) : null,
    assists: {},
    contest: sanitizeContestRefRecord(contest),
    party: sanitizePartyCheckRef(party),
    vehicle: sanitizeVehicleRefRecord(vehicle),
    patron: sanitizePatronCheckRef(patron),
    pet: sanitizePetCheckRef(pet),
    ...(statOnly === true ? { statOnly: true } : {})
  };
  for (const entry of sanitizeAssists(assists)) record.assists[entry.id] = entry;
  return record;
}

/**
 * The running combat and round when `actor` is one of its combatants, else null (the record then carries no combat).
 * @param {object} actor
 * @returns {{ id: string, round: number }|null}
 */
export function combatRefFor(actor) {
  const combat = globalThis.game?.combat;
  if (!combat?.id || !actor?.id) return null;
  const list = Array.isArray(combat.combatants) ? combat.combatants : Array.from(combat.combatants?.values?.() ?? combat.combatants ?? []);
  return list.some((c) => c?.actorId === actor.id) ? { id: combat.id, round: Number(combat.round) || 0 } : null;
}

/** The id of the roller's token on the canvas, or null (a sidebar actor, a token-less roll). */
export function rollerTokenIdOf(actor) {
  const id = actor?.token?.id ?? actor?.getActiveTokens?.()?.[0]?.id ?? null;
  return typeof id === 'string' && id ? id : null;
}

/** The update path of the check record, or of one part of it (`checkRecordPath('assists.<id>.appliedTo')`). */
export const checkRecordPath = (part) => flagPath(part ? `${CHECK_RECORD_FLAG}.${part}` : CHECK_RECORD_FLAG);

/**
 * The sanitised record on a chat message (assists as an array sorted by `at`), or null when it has none.
 * @param {object} message a ChatMessage (or anything with `flags`)
 */
export function readCheckRecord(message) {
  return sanitizeRecord(readFlag(message, CHECK_RECORD_FLAG));
}

// -- Outcomes -------------------------------------------------------------------------------------------------

/** The degree of a d20 total against a Difficulty. `pending` without a DC, unless the face is a Natural 1 or 20. */
export function outcomeIdOf(total, dc, d20) {
  return evaluateRollOutcome({ total, d20Result: d20, targetDC: dc });
}

export function isSuccessOutcome(outcomeId) {
  return SUCCESS_OUTCOMES.includes(outcomeId);
}

// -- Evade ----------------------------------------------------------------------------------------------------

/** What an Evade earns besides its damage (pp. 79-80): the Injury after combat and the Advantage it gives. */
const EVADE_AFTERMATH = Object.freeze({
  [COG_ROLL_OUTCOMES.CRITICAL_FAILURE]: { injury: 'major', advantage: null },
  [COG_ROLL_OUTCOMES.MAJOR_FAILURE]: { injury: 'minor', advantage: null },
  [COG_ROLL_OUTCOMES.AMAZING_SUCCESS]: { injury: null, advantage: 'amazing' },
  [COG_ROLL_OUTCOMES.CRITICAL_SUCCESS]: { injury: null, advantage: 'natural_20' }
});

/**
 * The aftermath of an Evade, from the system's one degree ladder, so only the highest degree counts (p. 80): a Natural 1 is a
 * Major Injury and never also a Minor one; a Natural 20 gives Advantage whatever the total. No Difficulty, no degree.
 * @returns {{ injury: 'minor'|'major'|null, advantage: 'natural_20'|'amazing'|null }}
 */
export function evadeAftermath({ total, dc, d20 = null } = {}) {
  const none = { injury: null, advantage: null };
  if (dc === null || dc === undefined || dc === '' || !Number.isFinite(Number(dc)) || !Number.isFinite(Number(total))) return none;
  return { ...none, ...EVADE_AFTERMATH[outcomeIdOf(Number(total), Number(dc), d20)] };
}

/**
 * The book's Evade result for a total against the incoming DC (E6.4/E6.5): Equal succeeds, a Natural 1 always fails
 * and doubles, a Major Fail (short by 10 or more) adds the Floor, and only the highest degree counts.
 * @returns {{ isEvaded: boolean, evadeOutcome: string, damageMultiplier: number, floorBonus: number, double: boolean, aftermath: { injury: string|null, advantage: string|null }, bannerText: string, bannerBg: string, bannerBorder: string }}
 */
export function classifyEvade({ total, dc, d20 = null, isArea = false, areaOutcome = 'half', floor = 0 } = {}) {
  const naturalOne = d20 === 1;
  const isEvaded = !naturalOne && total >= dc;
  let evadeOutcome;
  let damageMultiplier = 1;
  let floorBonus = 0;
  let double = false;
  let bannerText;
  let bannerBg;
  let bannerBorder;
  if (isEvaded) {
    if (isArea && areaOutcome === 'half') {
      evadeOutcome = 'area_half';
      damageMultiplier = 0.5;
      bannerText = 'EVADED AREA ATTACK! (TAKES 50% DAMAGE)';
      bannerBg = 'var(--cog-warning-fill)';
      bannerBorder = 'var(--cog-warning-fill)';
    } else if (isArea && areaOutcome === 'none') {
      evadeOutcome = 'area_none';
      damageMultiplier = 1;
      bannerText = 'EVADED — AREA DAMAGE STILL APPLIES';
      bannerBg = 'var(--cog-warning-fill)';
      bannerBorder = 'var(--cog-warning-fill)';
    } else {
      evadeOutcome = 'avoided';
      damageMultiplier = 0;
      bannerText = isArea && areaOutcome === 'full'
        ? 'SUCCESSFULLY EVADED AREA ATTACK! (0 DAMAGE TAKEN — FULL EVASION)'
        : 'SUCCESSFULLY EVADED!';
      bannerBg = 'var(--cog-success-fill)';
      bannerBorder = 'var(--cog-success-fill)';
    }
  } else {
    evadeOutcome = 'hit';
    double = naturalOne;
    if (!double && dc - total >= 10) floorBonus = Math.max(0, Math.floor(Number(floor) || 0));
    bannerText = 'EVADE FAILED — HIT TAKEN!';
    if (floorBonus > 0) bannerText += ` MAJOR FAIL: +${floorBonus} DAMAGE (FLOOR)`;
    if (double) bannerText += ' CRITICAL FAIL: DOUBLE DAMAGE';
    bannerBg = 'var(--cog-accent-fill)';
    bannerBorder = 'var(--cog-accent-strong-fill)';
  }
  return { isEvaded, evadeOutcome, damageMultiplier, floorBonus, double, aftermath: evadeAftermath({ total, dc, d20 }), bannerText, bannerBg, bannerBorder };
}

// -- The effective check --------------------------------------------------------------------------------------

function sumApplied(assists, where) {
  return assists.reduce((sum, a) => (a.appliedTo === where ? sum + a.amount : sum), 0);
}

/**
 * Everything a reader needs from a record, derived from the unassisted roll plus the assists. Order of writes never
 * matters. `pending` is true when a Difficulty is missing for any target or the single check (the GM names it aloud).
 * @param {object} record a stored or sanitised record
 */
export function effectiveCheck(record) {
  const rec = sanitizeRecord(record);
  if (!rec) return null;
  const checkBonus = sumApplied(rec.assists, 'check');
  const damageBonus = sumApplied(rec.assists, 'damage');
  const total = rec.total + checkBonus;
  // `outcomeRolled` is the degree the roll earned; `outcomeBefore` and `outcome` carry the card's degree shifts (a shift never
  // changes a total or `isHit`).
  const judge = (before, dc) => {
    const outcomeRolled = outcomeIdOf(rec.total + before + checkBonus, dc, rec.d20);
    const outcomeBefore = applyShifts(outcomeIdOf(rec.total + before, dc, rec.d20), rec.shifts);
    const outcome = applyShifts(outcomeRolled, rec.shifts);
    return { outcomeRolled, outcomeBefore, outcome, total: rec.total + before + checkBonus };
  };
  const targets = rec.targets.map((t) => {
    const j = judge(t.bonus, t.dc);
    // A Natural 1 always misses and a Natural 20 always hits, as the attack card does.
    const isHit = t.dc !== null && attackHits(j.total, t.dc, rec.d20);
    return { actorId: t.actorId, actorUuid: t.actorUuid, name: t.name, dc: t.dc, total: j.total, outcome: j.outcome, outcomeBefore: j.outcomeBefore, outcomeRolled: j.outcomeRolled, isHit };
  });
  const single = judge(0, rec.dc);
  const outcomes = targets.length ? targets.map((t) => t.outcome) : [single.outcome];
  const outcome = rec.evade || !targets.length ? single.outcome : targets[0].outcome;
  const outcomeBefore = rec.evade || !targets.length ? single.outcomeBefore : targets[0].outcomeBefore;
  const outcomeRolled = rec.evade || !targets.length ? single.outcomeRolled : targets[0].outcomeRolled;
  const pending = outcomes.includes(COG_ROLL_OUTCOMES.PENDING);
  const conditionTags = new Set(rec.tags);
  for (const o of outcomes) if (OUTCOME_TAGS[o]) conditionTags.add(OUTCOME_TAGS[o]);
  let evade = null;
  if (rec.evade && rec.dc !== null) evade = classifyEvade({ total, dc: rec.dc, d20: rec.d20, ...rec.evade });
  return {
    checkBonus,
    damageBonus,
    total,
    pending,
    targets,
    outcomes,
    outcome,
    outcomeBefore,
    outcomeRolled,
    rerolled: rec.rerolls.length > 0,
    shifts: rec.shifts,
    evade,
    conditionTags,
    assists: rec.assists,
    unresolved: rec.assists.filter((a) => a.appliedTo === 'unresolved')
  };
}

/** The card's check record when it is an attack, spell or skill roll that carries a d20 (what a reroll can change), else null. */
export function attackRecordOf(message) {
  const record = readCheckRecord(message);
  return record && ['attack', 'spell', 'skill'].includes(record.kind) && record.d20 !== null ? record : null;
}

/**
 * The attack total a defender's roll answers, read from the card's check record (a reroll or an assist changes it after
 * the card's buttons were written): the defender's own row when the record has one, else the whole check's total. Null
 * when the card has no `attackRecordOf`.
 * @param {object} message the attack card
 * @param {string|null} [defenderUuid]
 * @returns {number|null}
 */
export function recordAttackTotal(message, defenderUuid = null) {
  const record = attackRecordOf(message);
  if (!record) return null;
  const eff = effectiveCheck(record);
  const row = defenderUuid ? eff.targets.find(t => t.actorUuid === defenderUuid) : null;
  return row ? row.total : eff.total;
}

/**
 * Where a Called Play's bonus goes, judged on the UNASSISTED roll against the first target (D6, D6.2, D14 a).
 * A failure (a Natural 1 included) puts it on the check; a success puts it on the damage roll when the card has
 * damage, else nowhere; a roll with no Difficulty (and no Natural 1 or 20) is left for the GM (`unresolved`).
 * @param {object} p
 * @param {number} p.total the unassisted d20 total (the card's `total`)
 * @param {number|null} [p.d20] the kept face
 * @param {number|null} [p.dc] a single-DC card's Difficulty
 * @param {{ dc?: number|null, bonus?: number }|null} [p.firstTarget] the first target's Difficulty and per-target bonus
 * @param {boolean} [p.hasDamage]
 * @returns {'check'|'damage'|'none'|'unresolved'}
 */
export function calledPlayDestination({ total, d20 = null, dc = null, firstTarget = null, hasDamage = false } = {}) {
  const target = isPlain(firstTarget) ? firstTarget : null;
  const targetDc = numOrNull(target?.dc) ?? numOrNull(dc);
  const face = numOrNull(d20);
  let succeeded;
  if (face === 1) succeeded = false;
  else if (targetDc === null) {
    if (face !== 20) return 'unresolved';
    succeeded = true;
  } else succeeded = num(total) + num(target?.bonus) >= targetDc;
  if (!succeeded) return 'check';
  return hasDamage === true ? 'damage' : 'none';
}

/**
 * Whether an assist skill with this `when` query is offered on a card, and whether it deserves the highlight.
 * A card with no Difficulty is pending: its outcome tags are unknown, so a query listing one passes (the GM adjudicates).
 * The highlight is a presentation hint: some target's effective outcome is a Near Miss.
 * @param {{ all?: string[], any?: string[], none?: string[] }|null} when
 * @param {object} eff an `effectiveCheck` result
 * @returns {{ show: boolean, highlight: boolean }}
 */
export function assistOfferMatches(when, eff) {
  if (!eff) return { show: false, highlight: false };
  const show = eff.pending
    ? matchesTagQueryIgnoring(eff.conditionTags, when, isOutcomeTag)
    : matchesTagQuery(eff.conditionTags, when);
  const highlight = show && eff.outcomes.includes(COG_ROLL_OUTCOMES.NEAR_MISS);
  return { show, highlight };
}

/** The flat damage parts a card's damage roll adds: one per `damage` assist, typed by the roll's main part at roll time. */
export function damageBonusParts(record) {
  const rec = sanitizeRecord(record);
  if (!rec) return [];
  return rec.assists
    .filter((a) => a.appliedTo === 'damage')
    .map((a) => ({
      value: a.amount,
      source: a.source === 'called_play' ? `Called Play (${a.fromName})` : `${a.skillName || 'Assist'} (${a.fromName})`
    }));
}

/**
 * The flat damage parts a damage roll adds from the check card it answers: one per `damage` assist on the card
 * `sourceMessageId`, typed like the roll's first damage part. Empty without a card, a record or such an assist.
 * @param {string|null|undefined} sourceMessageId
 * @param {string} type the first damage part's type
 * @returns {Array<{ id: string, type: string, dice: string, stat: string, statMod: number, value: number, source: string }>}
 */
export function sourceDamageBonusParts(sourceMessageId, type) {
  if (typeof sourceMessageId !== 'string' || !sourceMessageId) return [];
  const message = globalThis.game?.messages?.get?.(sourceMessageId);
  const record = message ? readCheckRecord(message) : null;
  if (!record) return [];
  return damageBonusParts(record).map((p, i) => ({
    id: `assist-damage-${sourceMessageId}-${i}`,
    type,
    dice: '',
    stat: '',
    statMod: 0,
    value: p.value,
    source: p.source
  }));
}

// -- The skill's assist data ----------------------------------------------------------------------------------

/** Whether a string is a roll formula an assist can roll: non-empty and valid for Foundry's `Roll.validate`. */
export function isValidAssistFormula(formula) {
  const text = typeof formula === 'string' ? formula.trim() : '';
  if (!text) return false;
  const RollClass = globalThis.Roll;
  if (typeof RollClass?.validate === 'function') return RollClass.validate(text) !== false;
  return maxOfDiceFormula(text) !== null;
}

const cleanList = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()) : []);

/**
 * What a skill says about being an assist: its dice, its offer query, whether the dice are usable, and the moment its
 * trigger tag gives it (`check` = offered on an ally's card, `before_check` = offered in an ally's pre-roll dialog,
 * `turn` = called on the caller's turn, null = sheet only). `untrainedFormula` is what a helper without Ranks rolls instead.
 * @returns {{ formula: string, untrainedFormula: string, untrainedValid: boolean, when: { all: string[], any: string[], none: string[] }, valid: boolean, moment: 'check'|'before_check'|'turn'|null, actionType: string|null }}
 */
export function getAssistSpec(item) {
  const assist = isPlain(item?.system?.assist) ? item.system.assist : {};
  const formula = typeof assist.formula === 'string' ? assist.formula.trim() : '';
  const untrainedFormula = typeof assist.untrainedFormula === 'string' ? assist.untrainedFormula.trim() : '';
  const when = isPlain(assist.when) ? assist.when : {};
  const ids = getInterruptTriggersFromTags(getTagsOf(item)).map((t) => t.id);
  const called = calledAssistTrigger(ids);
  let moment = null;
  if (isOfferedOnCheck(ids)) moment = 'check';
  else if (isOfferedBeforeCheck(ids)) moment = 'before_check';
  else if (called) moment = 'turn';
  return {
    formula,
    untrainedFormula,
    untrainedValid: !untrainedFormula || isValidAssistFormula(untrainedFormula),
    when: { all: cleanList(when.all), any: cleanList(when.any), none: cleanList(when.none) },
    valid: isValidAssistFormula(formula),
    moment,
    actionType: moment === 'turn' ? (called.actionType ?? null) : null
  };
}
