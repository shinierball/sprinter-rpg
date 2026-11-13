/**
 * Playing to the Cameras (book p. 60 and Table 52). A crawler may add one
 * Disadvantage reason to a Check or Attack by playing to the Audience, the AI or the Sponsors. This leaf holds the
 * frozen Table 52 default, the registry reader (`CONFIG.COG.cameraAudiences`, so a module can add an audience) and the
 * pure helpers that sanitise a choice and a card record. It touches no document and rolls nothing.
 *
 * Eligible rolls (D-C2 a): skill, stat, attack, spell attack and Evade of a crawler; never a mob, never an automatic
 * roll, not the contest response. The award itself (Popularity and AI Favor deltas) is E6.10 B3b.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { firstScalar } from '../first-scalar.mjs';
import { escapeAttr } from '../escape-attr.mjs';

/** The actor flag holding the armed (one-shot) choice. */
export const CAMERA_ARMED_FLAG = 'cameraArmed';
/** The chat-message flag holding a card's camera record. */
export const CAMERAS_FLAG = 'cameras';

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
  'COG.Cameras.Settled': 'Settled: {changes} ({row})',
  'COG.Cameras.SettledNone': 'Settled ({row})',
  'COG.Cameras.Line': '{reason}: {name} {changes} ({row})',
  'COG.Cameras.LineNone': '{reason}: {name} ({row})',
  'COG.Cameras.LineText': '{text}',
  'COG.Cameras.Popularity': '{value} Popularity',
  'COG.Cameras.AiFavor': '{value} AI Favor',
  'COG.Cameras.Row1': 'Amazing Success',
  'COG.Cameras.Row2': 'Success',
  'COG.Cameras.Row3': 'Failure',
  'COG.Cameras.Row4': 'Critical Failure',
  'COG.Cameras.Pick1': 'Amazing / Crit (beat by 10+ or Natural 20)',
  'COG.Cameras.Pick2': 'Success',
  'COG.Cameras.Pick3': 'Failure',
  'COG.Cameras.Pick4': 'Crit Fail (Natural 1)',
  'COG.Cameras.PickLabel': 'GM: what was the result?',
  'COG.Cameras.Award': 'Award',
  'COG.Cameras.Withheld': 'Award {n} AI Favor (barred today)',
  'COG.Cameras.PromptTitle': '{reason}: {name} ({row}). GM choice:',
  'COG.Cameras.Chosen': 'Chosen: {choice}',
  'COG.Cameras.ChoiceLine': '{reason}: {name}, {choice}',
  'COG.Cameras.AlreadyResolved': 'This choice was already made.',
  'COG.Cameras.RowChanged': 'The result of that roll changed; this choice no longer applies.',
  'COG.Cameras.GmOnly': 'Only the GM can do this.',
  'COG.Cameras.NoActor': 'The crawler for this card was not found.',
  'COG.Cameras.Untrusted': 'This card does not belong to the crawler, so nothing was awarded.',
  'COG.Cameras.WithheldTitle': 'No AI Favor Today',
  'COG.Cameras.WithheldMessage': '{name} gets no AI Favor today. Award {n} anyway as a Rule Break?',
  'COG.Cameras.SponsorLog': 'Sponsors: {choice}'
});

/** A string by key; works without a loaded i18n catalogue (headless tests). */
export function cameraText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return (TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

const cell = (auto = {}, extra = {}) => ({ auto: { popularity: 0, aiFavor: 0, ...auto }, choices: [], text: '', ...extra });
const choice = (id, label, effect = {}) => ({ id, label, ...effect });

/**
 * Table 52. Rows: 1 Amazing/Critical Success, 2 Success, 3 Failure (Near Miss, Failure, Major Failure), 4 Critical Failure.
 * A cell is `{ auto: { popularity, aiFavor }, choices: [{ id, label, popularity?, aiFavor?, bar?, note? }], text }`.
 * Automatic amounts write at settle; choices wait for the GM; Sponsor text and notes write nothing to the actor.
 */
export const DEFAULT_CAMERA_AUDIENCES = Object.freeze({
  audience: Object.freeze({
    id: 'audience', label: 'Audience', reasonLabel: 'Playing to the Audience',
    rows: Object.freeze({
      1: cell({ popularity: 2 }),
      2: cell({ popularity: 1 }),
      3: cell({ popularity: -1 }),
      4: cell({}, { choices: [
        choice('lose', 'Lose 2 Popularity', { popularity: -2 }),
        choice('suffers', 'Gain 1 Popularity', { popularity: 1 })
      ] })
    })
  }),
  ai: Object.freeze({
    id: 'ai', label: 'AI', reasonLabel: 'Playing to the AI',
    rows: Object.freeze({
      1: cell({ aiFavor: 2 }),
      2: cell({ aiFavor: 1 }),
      3: cell({}, { choices: [
        choice('none', 'No effect'),
        choice('lose', 'Lose 1 AI Favor', { aiFavor: -1 })
      ] }),
      4: cell({ aiFavor: -2 }, { choices: [
        choice('bar', 'No AI Favor for the day', { bar: true }),
        choice('nobar', 'No bar')
      ] })
    })
  }),
  sponsors: Object.freeze({
    id: 'sponsors', label: 'Sponsors', reasonLabel: 'Playing to the Sponsors',
    rows: Object.freeze({
      1: cell({}, { text: 'A Gold or Platinum sponsor package arrives, or a keen Sponsor makes an offer for your contract' }),
      2: cell({}, { text: 'A Bronze or Silver sponsor package arrives' }),
      3: cell({}, { choices: [
        choice('none', 'No effect'),
        choice('reduced', 'The next sponsor package ships one quality grade lower', { note: 'The next sponsor package ships one quality grade lower' })
      ] }),
      4: cell({}, { choices: [
        choice('nobox', 'No sponsor package for the rest of this Floor', { note: 'No sponsor package for the rest of this Floor' }),
        choice('dropped', 'The Sponsor walks away, or a keen rival makes an offer for your contract', { note: 'The Sponsor walks away, or a keen rival makes an offer for your contract' })
      ] })
    })
  })
});

/** The audience registry in force: `CONFIG.COG.cameraAudiences` when it is a non-empty object, else the Table 52 default. */
export function cameraAudiences() {
  const registered = globalThis.CONFIG?.COG?.cameraAudiences;
  return registered && typeof registered === 'object' && !Array.isArray(registered) && Object.keys(registered).length
    ? registered
    : DEFAULT_CAMERA_AUDIENCES;
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

const ROW_OF_OUTCOME = Object.freeze({
  critical_success: 1, amazing_success: 1, success: 2, near_miss: 3, failure: 3, major_failure: 3, critical_failure: 4
});

/** The Table 52 row (1-4) of a roll outcome id; null for `pending` or anything unknown. */
export function cameraRowOf(outcomeId) {
  return ROW_OF_OUTCOME[outcomeId] ?? null;
}

/** The Table 52 cell for an audience and row, or null. */
export function cameraCell(id, row) {
  const audience = cameraAudiences()[sanitizeCameraChoice(id)];
  const found = audience?.rows?.[row];
  return found && typeof found === 'object' ? found : null;
}

const toInt = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
const toRow = (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 4 ? Number(v) : null);

/**
 * A card's camera record, sanitised; null when it holds no known choice.
 * @param {unknown} raw
 * @returns {{ choice: string, actorUuid: string, floor: number, settled: { row: number|null, popularity: number, aiFavor: number },
 *   pickedRow: number|null, prompts: Record<string, string>, withheld: { aiFavor: number }|null }|null}
 */
export function sanitizeCameraRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = sanitizeCameraChoice(raw.choice);
  if (!id) return null;
  const settled = raw.settled && typeof raw.settled === 'object' ? raw.settled : {};
  const prompts = {};
  if (raw.prompts && typeof raw.prompts === 'object' && !Array.isArray(raw.prompts)) {
    for (const [row, msgId] of Object.entries(raw.prompts)) if (toRow(row) && typeof msgId === 'string' && msgId) prompts[row] = msgId;
  }
  const withheldAi = toInt(raw.withheld?.aiFavor);
  return {
    choice: id,
    actorUuid: typeof raw.actorUuid === 'string' ? raw.actorUuid : '',
    floor: Math.max(0, toInt(raw.floor)),
    settled: { row: toRow(settled.row), popularity: toInt(settled.popularity), aiFavor: toInt(settled.aiFavor) },
    pickedRow: toRow(raw.pickedRow),
    prompts,
    withheld: withheldAi ? { aiFavor: withheldAi } : null
  };
}

/**
 * A fresh record for a card; null when there is no choice.
 * @param {string} choiceId
 * @param {{ actorUuid?: string, floor?: number }} [where]
 */
export function newCameraRecord(choiceId, { actorUuid = '', floor = 1 } = {}) {
  const id = sanitizeCameraChoice(choiceId);
  if (!id) return null;
  return {
    choice: id,
    actorUuid: String(actorUuid || ''),
    floor: Math.max(0, toInt(floor)),
    settled: { row: null, popularity: 0, aiFavor: 0 },
    pickedRow: null,
    prompts: {},
    withheld: null
  };
}


/** The one-line static note a camera card carries ("Playing to the Audience (Disadvantage)"); '' for no choice. */
function cameraNoteHtml(choiceId) {
  const reason = cameraReasonLabel(choiceId);
  return reason ? `<div class="cog-camera-note">${escapeAttr(cameraText('COG.Cameras.Note', { reason }))}</div>` : '';
}

/** The armed choice on an actor ('' when none or the flag is junk). */
export function armedCamera(actor) {
  let raw;
  try {
    raw = typeof actor?.getFlag === 'function' ? actor.getFlag(SYSTEM_ID, CAMERA_ARMED_FLAG) : actor?.flags?.[SYSTEM_ID]?.[CAMERA_ARMED_FLAG];
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
  const record = newCameraRecord(choice, { actorUuid: actor?.uuid ?? '', floor });
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
    await actor.unsetFlag(SYSTEM_ID, CAMERA_ARMED_FLAG);
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
