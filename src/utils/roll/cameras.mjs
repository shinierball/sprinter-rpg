/**
 * Playing to the Cameras (book p. 60 and Table 52). A crawler may add one
 * Disadvantage reason to a Check or Attack by playing to the Audience, the AI or the Sponsors. This leaf holds the
 * frozen Table 52 default, the registry reader (`CONFIG.COG.cameraAudiences`, so a module can add an audience) and the
 * pure helpers that sanitise a choice and a card record. It touches no document and rolls nothing. A registered audience's
 * `rows` are keyed by result id (`CAMERA_RESULTS`); that is registry content a module supplies, not stored data.
 *
 * Eligible rolls (D-C2 a): skill, stat, attack, spell attack and Evade of a crawler; never a mob, never an automatic
 * roll, not the contest response. The award itself (Popularity and AI Favor deltas) is E6.10 B3b.
 */
import { clearFlag, flagPath, readFlag, withFlags } from '../flags.mjs';
import { firstScalar } from '../first-scalar.mjs';
import { escapeAttr } from '../escape-attr.mjs';
import { langText } from '../lang-text.mjs';
import { effectiveFloor } from '../character/race-class-floor.mjs';
import { sponsorPlayBreaks } from '../../data/rules/sponsor-rules.mjs';
import { PLAY_SESSION_HOURS } from '../../data/rules/popularity-changes.mjs';
import { SECONDS_PER_HOUR } from '../time/day-clock.mjs';

/** The Sponsors audience's id (Playing to the Sponsors starts on the Fourth Floor, core p. 281). */
export const SPONSORS_CHOICE = 'sponsors';
/** The actor flag holding the armed (one-shot) choice. */
export const CAMERA_ARMED_FLAG = 'cameraArmed';
/** The chat-message flag holding a card's camera record. */
const CAMERAS_FLAG = 'cameras';
/** The chat-message flag on a prompt card: `{ sourceId, result, resolved }`. */
const CAMERA_PROMPT_FLAG = 'cameraPrompt';

// This module owns both keys: every other file (the award, the render, the migration) reads and writes them through these.
/** The raw `cameras` flag of a message or of plain message data. */
export const readCameraFlag = (doc) => readFlag(doc, CAMERAS_FLAG);
/** The raw `cameraPrompt` flag of a prompt card. */
export const readCameraPrompt = (doc) => readFlag(doc, CAMERA_PROMPT_FLAG);
/** The update path of a field inside the `cameras` flag. */
export const cameraFlagPath = (tail) => flagPath(`${CAMERAS_FLAG}.${tail}`);
/** The update path of a field inside the `cameraPrompt` flag. */
export const cameraPromptPath = (tail) => flagPath(`${CAMERA_PROMPT_FLAG}.${tail}`);
/** `data` with the camera record and/or the prompt record set (a key left undefined is not touched). */
export const withCameraFlags = (data, { record, prompt } = {}) => withFlags(data, {
  ...(record === undefined ? {} : { [CAMERAS_FLAG]: record }),
  ...(prompt === undefined ? {} : { [CAMERA_PROMPT_FLAG]: prompt })
});

const TEXT = Object.freeze({
  'COG.Cameras.Title': 'Playing to the Cameras',
  'COG.Cameras.None': 'None',
  'COG.Cameras.Hint': 'Adds one Disadvantage. Table 52 applies when the result is known.',
  'COG.Cameras.Note': '{reason} (Disadvantage)',
  'COG.Cameras.Armed': 'Armed for the next roll: {label}',
  'COG.Cameras.ArmLabel': 'Play to the Cameras',
  'COG.Cameras.ArmTitle': 'Choose who to play to on your next Check or Attack (adds one Disadvantage)',
  'COG.Cameras.HudTitle': 'Play to the Cameras: {label} (click to change)',
  'COG.Cameras.Awaiting': 'Awaiting the result',
  'COG.Cameras.Settled': 'Settled: {changes} ({result})',
  'COG.Cameras.SettledNone': 'Settled ({result})',
  'COG.Cameras.Line': '{reason}: {name} {changes} ({result})',
  'COG.Cameras.LineNone': '{reason}: {name} ({result})',
  'COG.Cameras.LineText': '{text}',
  'COG.Cameras.Popularity': '{value} Popularity',
  'COG.Cameras.AiFavor': '{value} AI Favor',
  'COG.Cameras.Result.amazing': 'Amazing Success',
  'COG.Cameras.Result.success': 'Standard Success',
  'COG.Cameras.Result.near-miss': 'Near Miss',
  'COG.Cameras.Result.fail': 'Standard Fail',
  'COG.Cameras.Result.major-fail': 'Major Fail',
  'COG.Cameras.Result.critical-fail': 'Critical Fail',
  'COG.Cameras.Pick.amazing': 'Amazing Success (beat by 10+) or Critical Hit (Natural 20)',
  'COG.Cameras.Pick.success': 'Standard Success',
  'COG.Cameras.Pick.near-miss': 'Near Miss (missed by 1-2)',
  'COG.Cameras.Pick.fail': 'Standard Fail (missed by 3-9)',
  'COG.Cameras.Pick.major-fail': 'Major Fail (missed by 10+)',
  'COG.Cameras.Pick.critical-fail': 'Critical Fail (Natural 1)',
  'COG.Cameras.PickLabel': 'GM: what was the result?',
  'COG.Cameras.PickTip': 'Picking Critical Fail sets the day\'s AI Favor bar; a mis-pick needs the bar cleared by hand.',
  'COG.Cameras.Closed': 'Settled on an earlier release; not settled again.',
  'COG.Cameras.LeftOpen': 'This choice was left open on an earlier release; make it by hand.',
  'COG.Cameras.ChoiceGone': 'That choice is no longer on the table; nothing was applied.',
  'COG.Cameras.Award': 'Award',
  'COG.Cameras.Withheld': 'Award {n} AI Favor (barred today)',
  'COG.Cameras.PromptTitle': '{reason}: {name} ({result}). GM choice:',
  'COG.Cameras.Chosen': 'Chosen: {choice}',
  'COG.Cameras.ChoiceLine': '{reason}: {name}, {choice}',
  'COG.Cameras.AlreadyResolved': 'This choice was already made.',
  'COG.Cameras.RowChanged': 'The result of that roll changed; this choice no longer applies.',
  'COG.Cameras.GmOnly': 'Only the GM can do this.',
  'COG.Cameras.NoActor': 'The crawler for this card was not found.',
  'COG.Cameras.Untrusted': 'This card does not belong to the crawler, so nothing was awarded.',
  'COG.Cameras.WithheldTitle': 'No AI Favor Today',
  'COG.Cameras.WithheldMessage': '{name} gets no AI Favor today. Award {n} anyway as a Rule Break?',
  'COG.Cameras.SponsorLog': 'Sponsors: {choice}',
  'COG.Cameras.Session.Reason': 'This crawler already Played to the Cameras in the last {hours} hours; the book allows it once per game session.',
  'COG.Cameras.Session.Question': 'Play to the Cameras again this session anyway as a Rule Break?'
});

/** A string by key; works without a loaded i18n catalogue (headless tests). */
export const cameraText = langText(TEXT);

/** Table 52's six rows in printed order (core p. 281); a record, a registry's `rows` and the GM's pick are keyed by these ids. */
export const CAMERA_RESULTS = Object.freeze(['amazing', 'success', 'near-miss', 'fail', 'major-fail', 'critical-fail']);

const cell = (auto = {}, extra = {}) => ({ auto: { popularity: 0, aiFavor: 0, ...auto }, choices: [], text: '', ...extra });
const choice = (id, label, effect = {}) => ({ id, label, ...effect });
/** The Sponsors column's "no Sponsor, no cost" choice (core p. 281). */
const NO_SPONSOR = () => choice('none', 'No Sponsor: no effect');

/**
 * Table 52 (core p. 281), keyed by result id; the registry (`CONFIG.COG.cameraAudiences`) takes the same keys.
 * A cell is `{ auto: { popularity, aiFavor }, bar?, choices: [{ id, label, popularity?, aiFavor?, bar?, note? }], text }`.
 * Automatic amounts write at settle; `bar` sets the day's AI Favor bar once, when the card first settles to that result;
 * choices wait for the GM; Sponsor text and notes write nothing to the actor.
 */
export const DEFAULT_CAMERA_AUDIENCES = Object.freeze({
  audience: Object.freeze({
    id: 'audience', label: 'Audience', reasonLabel: 'Playing to the Audience',
    rows: Object.freeze({
      amazing: cell({ popularity: 2 }),
      success: cell({ popularity: 1 }),
      'near-miss': cell(),
      fail: cell({ popularity: -1 }),
      'major-fail': cell({ popularity: -2 }),
      'critical-fail': cell({}, { choices: [
        choice('suffers', 'The crawler truly suffers: +1 Popularity', { popularity: 1 }),
        choice('none', 'No effect')
      ] })
    })
  }),
  ai: Object.freeze({
    id: 'ai', label: 'AI', reasonLabel: 'Playing to the AI',
    rows: Object.freeze({
      amazing: cell({ aiFavor: 2 }),
      success: cell({ aiFavor: 1 }),
      'near-miss': cell(),
      fail: cell({ aiFavor: -1 }),
      'major-fail': cell({ aiFavor: -2 }),
      'critical-fail': cell({}, { bar: true })
    })
  }),
  sponsors: Object.freeze({
    id: 'sponsors', label: 'Sponsors', reasonLabel: 'Playing to the Sponsors',
    rows: Object.freeze({
      amazing: cell({}, { text: 'A Gold or Platinum Sponsor Box arrives, or an interested Sponsor bids' }),
      success: cell({}, { text: 'A Bronze or Silver Sponsor Box arrives' }),
      'near-miss': cell(),
      fail: cell({}, { choices: [
        choice('reduced', 'The next Sponsor Box is one quality lower', { note: 'The next Sponsor Box is one quality lower' }),
        NO_SPONSOR()
      ] }),
      'major-fail': cell({}, { choices: [
        choice('nobox', 'Barred from a Sponsor Box until the next Floor', { note: 'Barred from a Sponsor Box until the next Floor' }),
        NO_SPONSOR()
      ] }),
      'critical-fail': cell({}, { choices: [
        choice('dropped', 'The Sponsor drops the crawler', { note: 'The Sponsor drops the crawler' }),
        choice('bid', 'An interested Sponsor bids', { note: 'An interested Sponsor bids' })
      ] })
    })
  })
});

const warnedAudiences = new Set();
/** Logs once per audience whose registered `rows` are still keyed 1-4 (the keys before result ids). */
function warnOldRowKeys(audiences) {
  for (const [id, audience] of Object.entries(audiences)) {
    const keys = Object.keys(audience?.rows ?? {});
    if (!keys.length || warnedAudiences.has(id) || keys.some(k => CAMERA_RESULTS.includes(k)) || !keys.some(k => /^[1-4]$/.test(k))) continue;
    warnedAudiences.add(id);
    console.warn(`Sprinter RPG | cameraAudiences.${id}.rows is keyed 1-4; Table 52 rows are keyed by result id (${CAMERA_RESULTS.join(', ')}). Its rows are ignored.`);
  }
}

/** The audience registry in force: `CONFIG.COG.cameraAudiences` when it is a non-empty object, else the Table 52 default. */
export function cameraAudiences() {
  const registered = globalThis.CONFIG?.COG?.cameraAudiences;
  if (!(registered && typeof registered === 'object' && !Array.isArray(registered) && Object.keys(registered).length)) return DEFAULT_CAMERA_AUDIENCES;
  warnOldRowKeys(registered);
  return registered;
}

/** The audiences as an ordered list (the dialog's radio group). */
export function cameraAudienceList() {
  return Object.values(cameraAudiences()).filter(a => a && typeof a.id === 'string' && a.id);
}

/**
 * A camera choice id: arrays and comma lists reduce to the first entry (CONTRIBUTING §4); an unknown id is ''.
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeCameraChoice(raw) {
  const first = firstScalar(raw);
  if (typeof first !== 'string') return '';
  const val = first.trim();
  return val && Object.hasOwn(cameraAudiences(), val) ? val : '';
}

/** "Playing to the Audience" for the Disadvantage list, '' for no or an unknown choice. */
export function cameraReasonLabel(id) {
  const audience = cameraAudiences()[sanitizeCameraChoice(id)];
  return audience ? String(audience.reasonLabel || audience.label || audience.id) : '';
}

/** The extra Disadvantage reasons a camera choice adds to the net (`getRollAdvantageState({ extraDisadvantages })`). */
export function cameraDisadvantages(id) {
  const label = cameraReasonLabel(id);
  return label ? [label] : [];
}

const RESULT_OF_OUTCOME = Object.freeze({
  critical_success: 'amazing', amazing_success: 'amazing', success: 'success', near_miss: 'near-miss', failure: 'fail',
  major_failure: 'major-fail', critical_failure: 'critical-fail'
});

/** The Table 52 result id of a roll outcome id; null for `pending` or anything unknown. */
export function cameraResultOf(outcomeId) {
  return RESULT_OF_OUTCOME[outcomeId] ?? null;
}

/** The Table 52 cell for an audience and result id, or null. */
export function cameraCell(id, result) {
  const audience = cameraAudiences()[sanitizeCameraChoice(id)];
  const found = Object.hasOwn(audience?.rows ?? {}, result) ? audience.rows[result] : null;
  return found && typeof found === 'object' ? found : null;
}

const toInt = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
const toResult = (v) => (typeof v === 'string' && CAMERA_RESULTS.includes(v) ? v : null);

/**
 * A card's camera record, sanitised; null when it holds no known choice.
 * @param {unknown} raw
 * @returns {{ choice: string, actorUuid: string, floor: number, settled: { result: string|null, popularity: number, aiFavor: number },
 *   pickedResult: string|null, resultPrompts: Record<string, string>, closed: boolean, withheld: { aiFavor: number }|null }|null}
 */
export function sanitizeCameraRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = sanitizeCameraChoice(raw.choice);
  if (!id) return null;
  const settled = raw.settled && typeof raw.settled === 'object' ? raw.settled : {};
  const resultPrompts = {};
  if (raw.resultPrompts && typeof raw.resultPrompts === 'object' && !Array.isArray(raw.resultPrompts)) {
    for (const [result, msgId] of Object.entries(raw.resultPrompts)) if (toResult(result) && typeof msgId === 'string' && msgId) resultPrompts[result] = msgId;
  }
  const withheldAi = toInt(raw.withheld?.aiFavor);
  return {
    choice: id,
    actorUuid: typeof raw.actorUuid === 'string' ? raw.actorUuid : '',
    floor: Math.max(0, toInt(raw.floor)),
    settled: { result: toResult(settled.result), popularity: toInt(settled.popularity), aiFavor: toInt(settled.aiFavor) },
    pickedResult: toResult(raw.pickedResult),
    resultPrompts,
    closed: raw.closed === true,
    withheld: withheldAi ? { aiFavor: withheldAi } : null
  };
}

/**
 * The real time of `actorUuid`'s latest Playing to the Cameras (core p. 281), from `{ timestamp, record }` pairs (a chat
 * card's time and its sanitised camera record). Another crawler's play, a record with no actor and a bad time never count.
 * @param {Array<{ timestamp?: number, record?: { actorUuid?: string }|null }>} entries
 * @param {string} actorUuid
 * @returns {number|null} milliseconds since the epoch, null when there was none
 */
function lastCameraPlayAt(entries, actorUuid) {
  if (!actorUuid) return null;
  let latest = null;
  for (const entry of entries ?? []) {
    const at = Number(entry?.timestamp);
    if (entry?.record?.actorUuid !== actorUuid || !Number.isFinite(at)) continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

/**
 * The reasons a play to the cameras now breaks the once-per-session limit (core p. 281): one when this crawler played
 * within `PLAY_SESSION_HOURS` of real time (the chat log is the memory; deleting the card forgets the play).
 * @param {object} actor
 * @param {number} [now] milliseconds since the epoch
 * @returns {string[]}
 */
export function cameraSessionBreaks(actor, now = Date.now()) {
  if (!actor?.uuid) return [];
  const entries = Array.from(globalThis.game?.messages ?? [], (m) => ({ timestamp: m?.timestamp, record: sanitizeCameraRecord(readCameraFlag(m)) }));
  const last = lastCameraPlayAt(entries, actor.uuid);
  if (last === null || now - last >= PLAY_SESSION_HOURS * SECONDS_PER_HOUR * 1000) return [];
  return [cameraText('COG.Cameras.Session.Reason', { hours: PLAY_SESSION_HOURS })];
}

/**
 * A fresh record for a card; null when there is no choice.
 * @param {string} choiceId
 * @param {{ actorUuid?: string, floor?: number, ruleBreak?: boolean }} [where] `ruleBreak` is written only when true
 */
export function newCameraRecord(choiceId, { actorUuid = '', floor = 1, ruleBreak = false } = {}) {
  const id = sanitizeCameraChoice(choiceId);
  if (!id) return null;
  return {
    choice: id,
    actorUuid: String(actorUuid || ''),
    floor: Math.max(0, toInt(floor)),
    settled: { result: null, popularity: 0, aiFavor: 0 },
    pickedResult: null,
    resultPrompts: {},
    withheld: null,
    ...(ruleBreak === true ? { ruleBreak: true } : {})
  };
}


/** The one-line static note a camera card carries ("Playing to the Audience (Disadvantage)"); '' for no choice. */
export function cameraNoteHtml(choiceId) {
  const reason = cameraReasonLabel(choiceId);
  return reason ? `<div class="cog-camera-note">${escapeAttr(cameraText('COG.Cameras.Note', { reason }))}</div>` : '';
}

/** The armed choice on an actor ('' when none or the flag is junk). */
export function armedCamera(actor) {
  let raw;
  try {
    raw = readFlag(actor, CAMERA_ARMED_FLAG);
  } catch {
    raw = undefined;
  }
  return sanitizeCameraChoice(raw);
}

/** Camera rolls are for crawlers and anything else a player rolls for: everything but a mob. */
export function camerasOffered(actor) {
  return Boolean(actor) && actor.type !== 'mob';
}

/**
 * The camera choice of one roll: `options.cameras` (a string) answers outright, else the dialog's answer, else the armed
 * choice. A mob has none. Pure: clearing the armed flag is `consumeArmedCamera`.
 * @param {object} actor
 * @param {object} [options] the roll options
 * @param {string|null} [asked] the dialog's answer (null: the dialog did not open)
 * @returns {string}
 */
export function resolveCameraChoice(actor, options = {}, asked = null) {
  if (!camerasOffered(actor)) return '';
  if (typeof options?.cameras === 'string') return sanitizeCameraChoice(options.cameras);
  if (typeof asked === 'string') return sanitizeCameraChoice(asked);
  return armedCamera(actor);
}

/**
 * What a roll adds for a camera choice: the Disadvantage reasons to net, the flavor note, the card flags.
 * @returns {{ choice: string, disadvantages: string[], noteHtml: string, flags: object }}
 */
export function cameraParts(actor, choiceId, floor = 1) {
  const choice = camerasOffered(actor) ? sanitizeCameraChoice(choiceId) : '';
  let ruleBreak = choice === SPONSORS_CHOICE && sponsorPlayBreaks(effectiveFloor(actor, floor)).length > 0;
  if (choice && cameraSessionBreaks(actor).length) ruleBreak = true;
  const record = newCameraRecord(choice, { actorUuid: actor?.uuid ?? '', floor, ruleBreak });
  return {
    choice,
    disadvantages: cameraDisadvantages(choice),
    noteHtml: cameraNoteHtml(choice),
    flags: record ? { [CAMERAS_FLAG]: record } : {}
  };
}

/** The armed choice is one-shot: clear it once a roll has gone ahead (the roller owns the actor). Never throws. */
export async function consumeArmedCamera(actor) {
  if (!armedCamera(actor)) return false;
  try {
    await clearFlag(actor, CAMERA_ARMED_FLAG);
    return true;
  } catch (err) {
    console.warn('Sprinter RPG | Could not clear the armed camera choice', err);
    return false;
  }
}

/** The next choice in the arm control's cycle: None, then each audience in registry order, then None again. */
export function nextCameraChoice(current) {
  const order = ['', ...cameraAudienceList().map(a => a.id)];
  const at = order.indexOf(sanitizeCameraChoice(current));
  return order[(at + 1) % order.length];
}

/**
 * The arm control's display state for a sheet or HUD: the armed id, its label and the tooltip.
 * @returns {{ armed: string, label: string, active: boolean, title: string }}
 */
export function cameraArmView(actor) {
  const armed = armedCamera(actor);
  const label = armed ? String(cameraAudiences()[armed]?.label || armed) : cameraText('COG.Cameras.None');
  return {
    armed,
    label,
    active: Boolean(armed),
    title: armed ? cameraText('COG.Cameras.HudTitle', { label }) : cameraText('COG.Cameras.ArmTitle')
  };
}
