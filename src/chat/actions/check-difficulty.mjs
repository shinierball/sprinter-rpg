/**
 * The GM's Difficulty on a plain check card.
 *
 * `setCheckDifficulty` is the one write path: it puts the Difficulty on the card's check record (`dc`, each target's
 * `dc`, `difficulty`), re-judges the Called Plays and keeps the ledger entry in step. Everything that reads
 * `effectiveCheck` (degree, assists, camera award) follows with no further change. The buttons on the card
 * (`crawlerSetDifficulty`, `crawlerAskOpposed`, `crawlerClearDifficulty`) are GM only.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { readCheckRecord, effectiveCheck, calledPlayDestination, CHECK_RECORD_FLAG } from '../../utils/roll/check-assists.mjs';
import { difficultyFor, canSetDifficulty } from '../../utils/roll/check-difficulty.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { buildRollContext } from '../../utils/roll/roll-context.mjs';
import { mobDifficultyShift, MOB_QUALITIES } from '../../documents/actor/attack-targets.mjs';
import { COGSessionEngine } from '../../documents/session/session-engine.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

const STATS = Object.freeze(['str', 'dex', 'con', 'int', 'cha']);
/** The "other value" choice of the Opposed dialog: a number standing in for the Stat Mod (a Spell Rank, a size class). */
const OTHER = 'other';

/** English fallbacks of the `COG.Difficulty.Dialog.*` keys in lang/en.json (the headless test world has no i18n). */
const DIALOG_TEXT = Object.freeze({
  Title: 'Opposed Difficulty',
  Foe: 'Opposed by',
  Opposing: 'Opposing',
  Other: 'Other',
  OtherValue: 'Other value',
  Ok: 'Set'
});

function dialogText(key) {
  const full = `COG.Difficulty.Dialog.${key}`;
  try {
    const s = globalThis.game?.i18n?.localize?.(full);
    if (typeof s === 'string' && s && s !== full) return s;
  } catch {
    // fall through to the fallback
  }
  return DIALOG_TEXT[key] ?? full;
}

const notify = (level, text) => globalThis.ui?.notifications?.[level]?.(text);
const modOf = (actor, stat) => Number(actor?.system?.abilities?.[stat]?.mod) || 0;

/**
 * What one foe adds to an Opposed Difficulty: its Mod in the Stat and, for a mob, the Advantage shift of its check.
 * @returns {{ uuid: string, name: string, mod: number, shift: number }}
 */
export function foeEntryFor(foe, statKey, roller = null) {
  const stat = STATS.includes(statKey) ? statKey : '';
  const mod = stat ? modOf(foe, stat) : 0;
  let shift = 0;
  if (foe?.type === 'mob') {
    const context = buildRollContext({ actor: foe, phase: 'check', check: 'stat', stat: stat || undefined, other: roller ?? undefined });
    shift = mobDifficultyShift(foe, MOB_QUALITIES.check, { context }).shift;
  }
  return { uuid: foe?.uuid ?? '', name: foe?.name ?? '', mod, shift };
}

/** The actors that can oppose this check: the card's recorded targets, else the GM's own targets; never the roller. */
export function knownFoes(message, record = readCheckRecord(message)) {
  if (!record) return [];
  const fromCard = record.targets.map((t) => resolveActorByUuid(t.actorUuid)).filter(Boolean);
  const pool = fromCard.length ? fromCard : [...(globalThis.game?.user?.targets ?? [])].map((t) => t.actor ?? t).filter(Boolean);
  const seen = new Set();
  return pool.filter((a) => a.uuid !== record.rollerUuid && !seen.has(a.uuid) && seen.add(a.uuid));
}

const flagsOf = (message) => message?.flags?.[SYSTEM_ID] ?? {};

function messageList() {
  const m = globalThis.game?.messages;
  return m ? [...m] : [];
}

/** The check card that carries this roll id (the newest first), or null. The ledger entry stores the same id. */
export function findCheckMessageByRollId(rollId) {
  if (!rollId) return null;
  return messageList().reverse().find((m) => readCheckRecord(m)?.rollId === rollId) ?? null;
}

/** True when a damage card answers this check: the Called Plays then keep where they went. */
function damageCardAnswers(message) {
  return Boolean(message?.id) && messageList().some((m) => flagsOf(m).sourceMessageId === message.id);
}

/**
 * The Difficulty values to write: one per target (Opposed with no foe named uses each target's own Mod), else one.
 * @returns {{ difficulty: object, perTarget: Array<number|null> }|{ error: string }}
 */
function workOut(record, spec, floor, roller) {
  const stat = STATS.includes(spec.stat) ? spec.stat : (STATS.includes(record.stat) ? record.stat : '');
  if (spec.mode !== 'opposed') {
    const difficulty = difficultyFor(spec, { floor });
    return difficulty ? { difficulty, perTarget: record.targets.map(() => difficulty.value) } : { error: 'bad-spec' };
  }
  if (spec.foe) {
    const difficulty = difficultyFor({ mode: 'opposed', stat: spec.stat ?? stat, foe: spec.foe }, { floor });
    return { difficulty, perTarget: record.targets.map(() => difficulty.value) };
  }
  const foes = record.targets.length ? record.targets.map((t) => resolveActorByUuid(t.actorUuid)) : knownFoes(null, record);
  if (!foes.length || foes.every((f) => !f)) return { error: 'no-foe' };
  const entries = foes.map((f) => difficultyFor({ mode: 'opposed', stat, foe: f ? foeEntryFor(f, stat, roller) : { mod: 0 } }, { floor }));
  return { difficulty: entries[0], perTarget: record.targets.length ? entries.map((e) => e.value) : [] };
}

/**
 * Put a Difficulty on a plain check card (GM only). `spec.mode === ''` clears it.
 * @param {ChatMessage} message the check card
 * @param {{ mode?: string, value?: number, foe?: object, stat?: string }} spec see `difficultyFor`
 * @param {{ syncLedger?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, reason?: string, difficulty?: object|null }>}
 */
export async function setCheckDifficulty(message, spec, { syncLedger = true } = {}) {
  if (!globalThis.game?.user?.isGM) return { ok: false, reason: 'forbidden' };
  const record = readCheckRecord(message);
  if (!record) return { ok: false, reason: 'no-record' };
  if (!canSetDifficulty(record, flagsOf(message))) return { ok: false, reason: 'not-settable' };

  const clearing = spec?.mode === '';
  const floor = record.floor ?? getCurrentFloor();
  let difficulty = null;
  let perTarget = record.targets.map(() => null);
  if (!clearing) {
    const worked = workOut(record, spec ?? {}, floor, resolveActorByUuid(record.rollerUuid));
    if (worked.error) return { ok: false, reason: worked.error };
    difficulty = { ...worked.difficulty, standing: false, by: globalThis.game.user.id ?? '', at: Date.now() };
    perTarget = worked.perTarget;
  }
  const dc = difficulty ? difficulty.value : null;
  const targets = record.targets.map((t, i) => ({ ...t, dc: perTarget[i] ?? null }));

  const base = `flags.${SYSTEM_ID}.${CHECK_RECORD_FLAG}`;
  const update = { [`${base}.dc`]: dc, [`${base}.targets`]: targets, [`${base}.difficulty`]: difficulty };
  // Called Plays are re-judged on the unassisted roll until a damage card answers the check.
  if (!damageCardAnswers(message)) {
    for (const entry of record.assists.filter((a) => a.source === 'called_play')) {
      const first = targets[0] ?? null;
      update[`${base}.assists.${entry.id}.appliedTo`] = calledPlayDestination({
        total: record.total, d20: record.d20, dc, firstTarget: first ? { dc: first.dc, bonus: first.bonus } : null, hasDamage: record.hasDamage
      });
    }
  }
  await message.update(update);

  if (syncLedger) await syncLedgerEntry(message, difficulty);
  return { ok: true, difficulty };
}

/** Keep the ledger entry that shares this card's `rollId` in step: its Difficulty, outcome and mode. */
async function syncLedgerEntry(message, difficulty) {
  const record = readCheckRecord(message);
  if (!record?.rollId) return;
  const sessionId = COGSessionEngine.getActiveSessionId?.();
  const session = COGSessionEngine.getAllSessions?.().find((s) => s.id === sessionId);
  const entry = session?.ledger?.find((e) => e.rollId === record.rollId);
  if (!entry) return;
  const eff = effectiveCheck(record);
  await COGSessionEngine.updateLedgerEntry(session.id, entry.id, {
    targetDC: record.dc,
    outcome: difficulty && eff && !eff.pending ? eff.outcome : 'auto',
    difficultyMode: difficulty?.mode ?? ''
  });
}

/**
 * The Opposed dialog: which foe, which Stat (or an "other value"). Pre-selects the card's first known foe and the
 * Stat the check was rolled on. Resolves to a spec for `setCheckDifficulty`, or null when cancelled.
 */
export async function askOpposed(message, record = readCheckRecord(message)) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt !== 'function' || !record) return null;
  const known = knownFoes(message, record);
  const seen = new Set(known.map((a) => a.uuid));
  const others = (globalThis.canvas?.tokens?.placeables ?? []).map((t) => t.actor).filter((a) => a && a.uuid !== record.rollerUuid && !seen.has(a.uuid));
  const foes = [...known, ...others.filter((a) => !seen.has(a.uuid) && seen.add(a.uuid))];
  const rolled = STATS.includes(record.stat) ? record.stat : STATS[0];
  const foeOptions = [
    ...foes.map((a, i) => `<option value="${escapeAttr(a.uuid)}"${i === 0 ? ' selected' : ''}>${escapeAttr(a.name)}</option>`),
    `<option value="${OTHER}"${foes.length ? '' : ' selected'}>${escapeAttr(dialogText('Other'))}</option>`
  ].join('');
  const statOptions = [
    ...STATS.map((s) => `<option value="${s}"${s === rolled ? ' selected' : ''}>${s.toUpperCase()}${foes[0] ? ` ${modOf(foes[0], s) >= 0 ? '+' : ''}${modOf(foes[0], s)}` : ''}</option>`),
    `<option value="${OTHER}">${escapeAttr(dialogText('OtherValue'))}</option>`
  ].join('');
  const answer = await DialogV2.prompt({
    window: { title: dialogText('Title') },
    content: `<div class="form-group"><label>${escapeAttr(dialogText('Foe'))}<select name="foe">${foeOptions}</select></label></div>`
      + `<div class="form-group"><label>${escapeAttr(dialogText('Opposing'))}<select name="stat">${statOptions}</select></label>`
      + '<input type="number" name="value" step="1" value="0" /></div>',
    ok: {
      label: dialogText('Ok'),
      callback: (event, button) => ({ foe: button.form.elements.foe?.value ?? '', stat: button.form.elements.stat?.value ?? '', value: button.form.elements.value?.value ?? '' })
    },
    rejectClose: false
  });
  if (!answer || typeof answer !== 'object') return null;
  const foe = foes.find((a) => a.uuid === answer.foe) ?? null;
  const statChoice = STATS.includes(answer.stat) ? answer.stat : OTHER;
  const roller = resolveActorByUuid(record.rollerUuid);
  if (statChoice === OTHER) {
    const mod = Number(answer.value);
    return { mode: 'opposed', stat: OTHER, foe: { uuid: foe?.uuid ?? '', name: foe?.name ?? '', mod: Number.isFinite(mod) ? Math.trunc(mod) : 0, shift: foe ? foeEntryFor(foe, '', roller).shift : 0 } };
  }
  return { mode: 'opposed', stat: statChoice, foe: foe ? foeEntryFor(foe, statChoice, roller) : { mod: 0 } };
}

async function run(message, fn) {
  try {
    const res = await fn();
    if (!res.ok && res.reason && res.reason !== 'cancelled') notify('warn', `Sprinter RPG | ${res.reason}`);
    return res;
  } catch (err) {
    console.error('Sprinter RPG | Setting the Difficulty failed:', err);
    notify('error', `Sprinter RPG | ${err.message}`);
    return { ok: false, reason: 'error' };
  }
}

/**
 * `crawlerSetDifficulty`: a formula button (`data-mode` unopposed, stat, opposed) or the number box's Set (`typed`,
 * with the box named by `data-value-from`). Opposed with no foe known opens the dialog.
 */
export async function handleSetDifficulty(event, button, message) {
  const mode = button.dataset?.mode ?? '';
  let spec = { mode };
  if (mode === 'typed') {
    const box = button.closest?.('.cog-check-difficulty')?.querySelector?.('input[type="number"]');
    spec = { mode, value: box?.value };
  }
  return run(message, async () => {
    const res = await setCheckDifficulty(message, spec);
    if (res.reason === 'no-foe') {
      const asked = await askOpposed(message);
      return asked ? setCheckDifficulty(message, asked) : { ok: false, reason: 'cancelled' };
    }
    return res;
  });
}

/** `crawlerAskOpposed`: the caret beside the Opposed button. */
export async function handleAskOpposed(event, button, message) {
  return run(message, async () => {
    const asked = await askOpposed(message);
    return asked ? setCheckDifficulty(message, asked) : { ok: false, reason: 'cancelled' };
  });
}

/** `crawlerClearDifficulty`. */
export async function handleClearDifficulty(event, button, message) {
  return run(message, () => setCheckDifficulty(message, { mode: '' }));
}
