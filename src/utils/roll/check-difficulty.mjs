/**
 * Difficulty on a plain check card, pure of documents: work the number out from the book formulas, say what a
 * card may be given, and write the card line. The record fields are in `check-assists.mjs`; the GM's write path is
 * `src/chat/actions/check-difficulty.mjs`.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { langText } from '../lang-text.mjs';
import { DIFFICULTY_MODES, wholeOrZero, escalatingTiers, opposedDifficulty, unopposedDifficulty, statCheckDifficulty } from '../../data/rules/difficulty-rules.mjs';

/** English fallbacks of the `COG.Difficulty.*` keys in lang/en.json (the headless test world has no i18n). */
const TEXT = Object.freeze({
  Line: 'Difficulty {dc}',
  Unopposed: 'Unopposed',
  StatCheck: 'Stat Check',
  Opposed: 'Opposed',
  Typed: 'set by the GM',
  Escalating: 'Escalating {tiers}',
  ButtonEscalating: 'Escalating…',
  Reached: 'Reached {tiers}',
  ReachedNone: 'Reached none',
  EscalatingTitle: 'Escalating Difficulty',
  EscalatingTier: 'Tier {n}',
  EscalatingOk: 'Set',
  FormulaUnopposed: '10 + 2 × Floor {floor}',
  FormulaStat: '10 + Floor {floor}',
  FormulaOpposed: '10 + {foe} {stat} {mod} + Floor {floor}',
  FormulaOpposedNoFoe: '10 + {mod} + Floor {floor}',
  ShiftAdvantage: '+ {shift} Advantage',
  ShiftDisadvantage: '- {shift} Disadvantage',
  FlatPenalty: '- {flat} Check penalty',
  FlatBonus: '+ {flat} Check bonus',
  NotSet: 'Difficulty not set',
  Standing: 'Standing',
  Change: 'Change Difficulty',
  Set: 'Set',
  Clear: 'Clear',
  ButtonUnopposed: 'Unopposed {dc}',
  ButtonStat: 'Stat Check {dc}',
  ButtonOpposed: 'Opposed {dc} ({foe}, {stat})',
  ButtonOpposedAsk: 'Opposed…',
  ChangeOpposed: 'Choose the foe and Stat',
  NumberLabel: 'Difficulty',
  StandingCount: '{n} cards',
  StandingTitle: 'Standing Difficulty',
  StandingNone: 'None',
  StandingNumber: 'Number',
  LedgerHint: 'That roll\'s chat card is no longer available to set a Difficulty on.'
});

const difficultyLang = langText(Object.fromEntries(Object.entries(TEXT).map(([k, v]) => [`COG.Difficulty.${k}`, v])));

/** `COG.Difficulty.<key>` through `game.i18n` when it knows the key, else the English fallback. */
export const difficultyText = (key, data = {}) => difficultyLang(`COG.Difficulty.${key}`, data);

/** "Reached 12 and 17", or "Reached none": which tiers of an escalating Difficulty the total reached (numbers only). */
export function reachedLineText(reached) {
  if (!reached.length) return difficultyText('ReachedNone');
  const last = reached[reached.length - 1];
  const list = reached.length > 1 ? `${reached.slice(0, -1).join(', ')} and ${last}` : String(last);
  return difficultyText('Reached', { tiers: list });
}

/** A fresh id that links a ledger entry to its chat card (the same id is stored on both). */
export function newRollId() {
  return globalThis.foundry?.utils?.randomID?.(16) ?? `roll-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The Difficulty a spec gives on a Floor, with how it was reached; null for an unknown mode or a typed value that is
 * not a number.
 * @param {{ mode?: string, value?: number, foe?: { uuid?: string, name?: string, mod?: number, shift?: number, flat?: number }, stat?: string }|null} spec
 * @param {{ floor?: number }} [ctx]
 * @returns {{ mode: string, value: number, floor: number, foeUuid: string, foeName: string, stat: string, mod: number, shift: number, flat: number, tiers?: number[] }|null}
 */
export function difficultyFor(spec, { floor = 0 } = {}) {
  const mode = spec?.mode;
  if (!DIFFICULTY_MODES.includes(mode)) return null;
  const fl = Math.max(0, wholeOrZero(floor));
  const base = { mode, floor: fl, foeUuid: '', foeName: '', stat: '', mod: 0, shift: 0, flat: 0 };
  if (mode === 'typed') {
    const tiers = escalatingTiers(spec.tiers);
    if (tiers.length) return { ...base, value: tiers[0], tiers };
    const v = spec.value;
    if (v === null || v === '' || v === undefined || !Number.isFinite(Number(v))) return null;
    return { ...base, value: Math.max(0, wholeOrZero(v)) };
  }
  if (mode === 'unopposed') return { ...base, value: unopposedDifficulty({ floor: fl }) };
  if (mode === 'stat') return { ...base, value: statCheckDifficulty({ floor: fl }) };
  const foe = spec.foe ?? {};
  const mod = wholeOrZero(foe.mod);
  const shift = wholeOrZero(foe.shift);
  const flat = wholeOrZero(foe.flat);
  return {
    ...base,
    mod,
    shift,
    flat,
    foeUuid: typeof foe.uuid === 'string' ? foe.uuid : '',
    foeName: typeof foe.name === 'string' ? foe.name : '',
    stat: typeof spec.stat === 'string' ? spec.stat : '',
    value: opposedDifficulty({ mod, floor: fl, shift, flat })
  };
}

/** The formula button a card puts first: a stat card (or a Stat Check skill's) a Stat Check, a skill card Opposed when it has a target, else Unopposed. */
export function defaultModeFor(record) {
  if (record?.kind === 'stat' || record?.statOnly === true) return 'stat';
  return Array.isArray(record?.targets) && record.targets.length ? 'opposed' : 'unopposed';
}

/** Whether the GM may put a Difficulty on this card: not a contest leg, a party check member, vehicle, patron, pet or Evade card, nor a crafting check (`craftGrade` is the card's crafting grade, `craftGradeOf(message)`). */
export function canSetDifficulty(record, craftGrade = null) {
  if (!record || !['skill', 'stat', 'attack', 'spell'].includes(record.kind)) return false;
  if (record.contest || record.party || record.vehicle || record.patron || record.pet || record.evade) return false;
  return !craftGrade;
}

/** Whether the card offers the three formula buttons (an attack's real Difficulty is a target's Evade: number box only). */
export function offersFormulas(record) {
  return record?.kind === 'skill' || record?.kind === 'stat';
}

/** The card line: "Difficulty 16 · Unopposed (10 + 2 × Floor 3)". */
export function difficultyLineText(difficulty) {
  if (!difficulty) return '';
  const head = difficultyText('Line', { dc: difficulty.value });
  const floor = difficulty.floor;
  if (difficulty.mode === 'typed') {
    const tiers = escalatingTiers(difficulty.tiers);
    return tiers.length ? `${head} · ${difficultyText('Escalating', { tiers: tiers.join(' / ') })}` : `${head} · ${difficultyText('Typed')}`;
  }
  if (difficulty.mode === 'unopposed') return `${head} · ${difficultyText('Unopposed')} (${difficultyText('FormulaUnopposed', { floor })})`;
  if (difficulty.mode === 'stat') return `${head} · ${difficultyText('StatCheck')} (${difficultyText('FormulaStat', { floor })})`;
  const mod = difficulty.mod >= 0 ? `+${difficulty.mod}` : `${difficulty.mod}`;
  const stat = String(difficulty.stat || '').toUpperCase();
  let formula = difficulty.foeName
    ? difficultyText('FormulaOpposed', { foe: difficulty.foeName, stat, mod, floor })
    : difficultyText('FormulaOpposedNoFoe', { mod, floor });
  formula = formula.replace('  ', ' ');
  if (difficulty.shift) {
    formula += ` ${difficulty.shift > 0 ? difficultyText('ShiftAdvantage', { shift: difficulty.shift }) : difficultyText('ShiftDisadvantage', { shift: Math.abs(difficulty.shift) })}`;
  }
  if (difficulty.flat) {
    formula += ` ${difficulty.flat > 0 ? difficultyText('FlatBonus', { flat: difficulty.flat }) : difficultyText('FlatPenalty', { flat: Math.abs(difficulty.flat) })}`;
  }
  return `${head} · ${difficultyText('Opposed')} (${formula})`;
}

/** The world setting that holds the standing Difficulty. */
export const STANDING_DIFFICULTY_SETTING = 'standingDifficulty';
const STANDING_KINDS = Object.freeze(['skill', 'stat']);
const STANDING_BLOCKED_ROLLERS = Object.freeze(['mob', 'vehicle']);
const LABEL_MAX = 80;

/** The standing Difficulty the GM put up, cleaned, or null when none is up. */
export function readStandingDifficulty() {
  let raw;
  try {
    raw = globalThis.game?.settings?.get?.(SYSTEM_ID, STANDING_DIFFICULTY_SETTING);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || !DIFFICULTY_MODES.includes(raw.mode)) return null;
  const str = (v) => (typeof v === 'string' ? v : '');
  return {
    mode: raw.mode,
    value: wholeOrZero(raw.value),
    foeUuid: str(raw.foeUuid),
    foeName: str(raw.foeName),
    stat: str(raw.stat),
    mod: wholeOrZero(raw.mod),
    label: str(raw.label).slice(0, LABEL_MAX),
    setAt: wholeOrZero(raw.setAt),
    stamped: Math.max(0, wholeOrZero(raw.stamped))
  };
}

/** The standing Difficulty a roll takes, or null: a plain skill or stat check by a non-mob, non-vehicle roller with no Difficulty of its own. */
function standingDifficultyFor({ kind, rollerType, hasOwnDc = false } = {}) {
  if (!STANDING_KINDS.includes(kind) || STANDING_BLOCKED_ROLLERS.includes(rollerType) || hasOwnDc) return null;
  return readStandingDifficulty();
}

/**
 * What a roll born under the standing Difficulty is given: the `difficulty` record (flagged `standing`) and its number,
 * worked out on the Floor of the roll (an Opposed one adds the stored Mod to that Floor, and the foe's Advantage shift and flat modifier as they are
 * now: `foeEffect(standing)` reads them as `{ shift, flat }`, 0 when absent or it throws), or null when none applies.
 * @returns {{ difficulty: object, dc: number }|null}
 */
export function standingStampFor({ kind, rollerType, hasOwnDc = false, floor = 0, foeEffect = null } = {}) {
  const standing = standingDifficultyFor({ kind, rollerType, hasOwnDc });
  if (!standing) return null;
  let shift = 0;
  let flat = 0;
  if (standing.mode === 'opposed' && typeof foeEffect === 'function') {
    try {
      const effect = foeEffect(standing);
      shift = wholeOrZero(effect?.shift);
      flat = wholeOrZero(effect?.flat);
    } catch {
      shift = 0;
      flat = 0;
    }
  }
  const worked = difficultyFor({ mode: standing.mode, value: standing.value, stat: standing.stat, foe: { uuid: standing.foeUuid, name: standing.foeName, mod: standing.mod, shift, flat } }, { floor });
  if (!worked) return null;
  return { difficulty: { ...worked, standing: true, by: globalThis.game?.user?.id ?? '', at: Date.now() }, dc: worked.value };
}

/**
 * What a roll asked to be born with a Difficulty is given (`options.difficulty`, a spec as `difficultyFor` reads it: an
 * after-kill check asks for Unopposed): the `difficulty` record and its number on the Floor of the roll, or null for no spec
 * or one that works out to nothing. Not flagged `standing`.
 * @returns {{ difficulty: object, dc: number }|null}
 */
export function requestedStampFor(spec, { floor = 0 } = {}) {
  const worked = spec && typeof spec === 'object' ? difficultyFor(spec, { floor }) : null;
  if (!worked) return null;
  return { difficulty: { ...worked, standing: false, by: globalThis.game?.user?.id ?? '', at: Date.now() }, dc: worked.value };
}

/** Count one more card under the standing Difficulty (a display number: only a GM's client writes it). */
export async function noteStandingStamp() {
  if (!globalThis.game?.user?.isGM) return;
  const standing = readStandingDifficulty();
  if (!standing) return;
  try {
    await globalThis.game.settings.set(SYSTEM_ID, STANDING_DIFFICULTY_SETTING, { ...standing, stamped: standing.stamped + 1 });
  } catch {
    // the count is cosmetic
  }
}

/** The strip's current line: "Standing: Unopposed · 3 cards" (or the typed label), '' when none is up. */
export function standingLineText(standing) {
  if (!standing) return '';
  const names = { unopposed: 'Unopposed', stat: 'StatCheck', opposed: 'Opposed' };
  const what = standing.mode === 'typed' ? `${difficultyText('Line', { dc: standing.value })}` : difficultyText(names[standing.mode]);
  const parts = [`${difficultyText('Standing')}: ${standing.label || what}`, difficultyText('StandingCount', { n: standing.stamped })];
  return parts.join(' · ');
}
