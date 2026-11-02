/**
 * Check records and assists.
 *
 * Every d20 check card carries a record under `flags.sprinter-rpg.check`: who rolled, the unassisted total, the
 * per-target Difficulties and the assists added since (an Intervene after the roll, a Called Play written when the
 * card was made). Nothing derived is stored: every reader calls `effectiveCheck(record)` so concurrent assists
 * cannot leave a stale sum. A pure leaf: it imports only constants, the tag vocabulary, the tag query and the
 * outcome classifier, and names no tag literal.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { CHECK_TAGS, OUTCOME_TAGS, isOutcomeTag, getTagsOf, getInterruptTriggersFromTags, isOfferedOnCheck, calledAssistTrigger } from './tag-mechanics.mjs';
import { matchesTagQuery, matchesTagQueryIgnoring } from './tag-query.mjs';
import { COG_ROLL_OUTCOMES, evaluateRollOutcome, extractD20Result } from '../apps/session-manager/roll-outcomes.mjs';
import { maxOfDiceFormula } from './dice-max.mjs';

export const CHECK_RECORD_FLAG = 'check';
export const CHECK_RECORD_VERSION = 1;
export const MAX_RECORD_ASSISTS = 20;

const RECORD_KINDS = Object.freeze(['skill', 'attack', 'spell', 'evade', 'stat']);
const ASSIST_SOURCES = Object.freeze(['interrupt', 'called_play']);
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
  // An Intervene is always added to the check; a record written without the field means exactly that.
  const appliedTo = raw.appliedTo === undefined && source === 'interrupt' ? 'check' : raw.appliedTo;
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

/** The contest reference a leg roll carries ({ messageId, legId, participantId }), or null (3.45). */
function sanitizeContestRefRecord(raw) {
  if (!isPlain(raw)) return null;
  const messageId = str(raw.messageId);
  const legId = str(raw.legId);
  const participantId = str(raw.participantId);
  return messageId || legId || participantId ? { messageId, legId, participantId } : null;
}

/** A record from its stored shape; null when it is not a usable record. Assists come back as an array. */
function sanitizeRecord(raw) {
  if (!isPlain(raw) || !RECORD_KINDS.includes(raw.kind)) return null;
  const total = numOrNull(raw.total);
  if (total === null) return null;
  return {
    v: CHECK_RECORD_VERSION,
    kind: raw.kind,
    rollerUuid: str(raw.rollerUuid),
    rollerTokenId: strOrNull(raw.rollerTokenId),
    combatId: strOrNull(raw.combatId),
    round: numOrNull(raw.round),
    tags: (Array.isArray(raw.tags) ? raw.tags : []).filter((t) => typeof t === 'string' && t),
    total,
    d20: numOrNull(raw.d20),
    dc: numOrNull(raw.dc),
    targets: (Array.isArray(raw.targets) ? raw.targets : []).map(sanitizeTarget).filter(Boolean),
    hasDamage: raw.hasDamage === true,
    evade: sanitizeEvade(raw.evade),
    assists: sanitizeAssists(raw.assists),
    contest: sanitizeContestRefRecord(raw.contest)
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
 */
export function buildCheckRecord({ kind, roller, rollerTokenId = null, roll, combat = null, tags = [], targets = [], dc = null, hasDamage = false, evade = null, assists = [], contest = null } = {}) {
  const record = {
    v: CHECK_RECORD_VERSION,
    kind: RECORD_KINDS.includes(kind) ? kind : 'skill',
    rollerUuid: str(roller?.uuid),
    rollerTokenId: strOrNull(rollerTokenId),
    combatId: strOrNull(combat?.id),
    round: combat ? numOrNull(combat.round) : null,
    tags: [...new Set((Array.isArray(tags) ? tags : [...(tags ?? [])]).filter(isKnownCheckTag))],
    total: num(roll?.total),
    d20: extractD20Result(roll),
    dc: numOrNull(dc),
    targets: (Array.isArray(targets) ? targets : []).map(sanitizeTarget).filter(Boolean),
    hasDamage: hasDamage === true,
    evade: evade ? sanitizeEvade(evade) : null,
    assists: {},
    contest: sanitizeContestRefRecord(contest)
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

/**
 * The sanitised record on a chat message (assists as an array sorted by `at`), or null when it has none.
 * @param {object} message a ChatMessage (or anything with `flags`)
 */
export function readCheckRecord(message) {
  const raw = typeof message?.getFlag === 'function'
    ? message.getFlag(SYSTEM_ID, CHECK_RECORD_FLAG)
    : message?.flags?.[SYSTEM_ID]?.[CHECK_RECORD_FLAG];
  return sanitizeRecord(raw);
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

/**
 * The book's Evade result for a total against the incoming DC (E6.4/E6.5): Equal succeeds, a Natural 1 always fails
 * and doubles, a Major Fail (short by 10 or more) adds the Floor, and only the highest degree counts.
 * @returns {{ isEvaded: boolean, evadeOutcome: string, damageMultiplier: number, floorBonus: number, double: boolean, bannerText: string, bannerBg: string, bannerBorder: string }}
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
  return { isEvaded, evadeOutcome, damageMultiplier, floorBonus, double, bannerText, bannerBg, bannerBorder };
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
  const judge = (before, dc) => {
    const outcomeBefore = outcomeIdOf(rec.total + before, dc, rec.d20);
    const outcome = outcomeIdOf(rec.total + before + checkBonus, dc, rec.d20);
    return { outcomeBefore, outcome, total: rec.total + before + checkBonus };
  };
  const targets = rec.targets.map((t) => {
    const j = judge(t.bonus, t.dc);
    // A Natural 1 always misses, a Natural 20 is judged by its total (E6.5), as the attack card does.
    const isHit = t.dc !== null && rec.d20 !== 1 && j.total >= t.dc;
    return { actorId: t.actorId, actorUuid: t.actorUuid, name: t.name, dc: t.dc, total: j.total, outcome: j.outcome, outcomeBefore: j.outcomeBefore, isHit };
  });
  const single = judge(0, rec.dc);
  const outcomes = targets.length ? targets.map((t) => t.outcome) : [single.outcome];
  const outcome = rec.evade || !targets.length ? single.outcome : targets[0].outcome;
  const outcomeBefore = rec.evade || !targets.length ? single.outcomeBefore : targets[0].outcomeBefore;
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
    evade,
    conditionTags,
    assists: rec.assists,
    unresolved: rec.assists.filter((a) => a.appliedTo === 'unresolved')
  };
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
 * trigger tag gives it (`check` = offered on an ally's card, `turn` = called on the caller's turn, null = sheet only).
 * @returns {{ formula: string, when: { all: string[], any: string[], none: string[] }, valid: boolean, moment: 'check'|'turn'|null, actionType: string|null }}
 */
export function getAssistSpec(item) {
  const assist = isPlain(item?.system?.assist) ? item.system.assist : {};
  const formula = typeof assist.formula === 'string' ? assist.formula.trim() : '';
  const when = isPlain(assist.when) ? assist.when : {};
  const ids = getInterruptTriggersFromTags(getTagsOf(item)).map((t) => t.id);
  const called = calledAssistTrigger(ids);
  let moment = null;
  if (isOfferedOnCheck(ids)) moment = 'check';
  else if (called) moment = 'turn';
  return {
    formula,
    when: { all: cleanList(when.all), any: cleanList(when.any), none: cleanList(when.none) },
    valid: isValidAssistFormula(formula),
    moment,
    actionType: moment === 'turn' ? (called.actionType ?? null) : null
  };
}
