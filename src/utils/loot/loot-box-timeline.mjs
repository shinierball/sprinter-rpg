/**
 * The Loot Box Showcase timeline (7.3e; the loot box spec, D9). Pure: no Foundry, no timers, no DOM.
 *
 * `planShowTimeline(boxes, { motion, speed })` turns the boxes of a reveal view into the steps the show window plays:
 * per box `arrive`, `shake`, `burst`, one `deal` per prize (in row order), `hold`; then one `summary` step. The window
 * awaits each step's `ms` with an abortable timer; Skip box jumps to the box's `hold`, Skip to summary to the last step.
 * The steps are the same for every motion and speed, only their durations change, so a speed change mid-show keeps the
 * step index. `summary` motion plans the summary step alone.
 */
import { firstScalar } from '../first-scalar.mjs';

/** The `lootBoxShow` client setting's values: the full show, the reduced-motion show, straight to the summary. */
const LOOT_BOX_SHOW_MOTIONS = Object.freeze(['full', 'reduced', 'summary']);
/** The default `lootBoxShow` value. */
const DEFAULT_LOOT_BOX_SHOW_MOTION = 'full';
/** The playback speeds the Speed control toggles between. */
export const LOOT_BOX_SHOW_SPEEDS = Object.freeze([1, 2]);

/** The phase of the closing step. */
const LOOT_BOX_SUMMARY_PHASE = 'summary';

/**
 * Step durations at 1x, in ms. `shakePerLevel` is added per tier level (a box's index in the tier order), so the wobble of
 * a higher tier lasts longer. Reduced motion has no wobble and short fades. Every value is even, so 2x stays whole.
 */
export const LOOT_BOX_SHOW_DURATIONS = Object.freeze({
  full: Object.freeze({ arrive: 700, shake: 900, shakePerLevel: 150, burst: 800, deal: 650, hold: 1400 }),
  reduced: Object.freeze({ arrive: 300, shake: 0, shakePerLevel: 0, burst: 300, deal: 400, hold: 1000 })
});

/** The six seeded opening effects (each a `cog-lootbox-fx-<fx>` class in cog.css). */
export const LOOT_BOX_FX = Object.freeze(['pop', 'shine', 'sparkle', 'beam', 'flare', 'nova']);
/** The effect an unknown one plays as. */
const FALLBACK_LOOT_BOX_FX = 'pop';

/**
 * The effect a tier's `fx` plays as: itself when known (seeded, or listed in `known`, e.g. `CONFIG.COG.lootBoxFx` with a
 * module's own), else `pop`.
 * @param {*} fx
 * @param {Iterable<string>} [known]
 * @returns {string}
 */
export function resolveLootBoxFx(fx, known = LOOT_BOX_FX) {
  const id = String(firstScalar(fx) ?? '').trim().toLowerCase();
  const list = new Set([...LOOT_BOX_FX, ...Array.from(known ?? []).map((k) => String(k).trim().toLowerCase())]);
  return id && list.has(id) ? id : FALLBACK_LOOT_BOX_FX;
}

/** A `lootBoxShow` value, sanitized ('full' when unknown). */
export function normalizeShowMotion(raw) {
  const id = String(firstScalar(raw) ?? '').trim().toLowerCase();
  return LOOT_BOX_SHOW_MOTIONS.includes(id) ? id : DEFAULT_LOOT_BOX_SHOW_MOTION;
}

/** A playback speed, sanitized (1 when unknown). */
export function normalizeShowSpeed(raw) {
  const n = Number(firstScalar(raw));
  return LOOT_BOX_SHOW_SPEEDS.includes(n) ? n : 1;
}

/**
 * The motion the show plays at: the client setting, with the OS "reduce motion" preference turning `full` into
 * `reduced`. `summary` always wins.
 * @param {*} setting the `lootBoxShow` value
 * @param {boolean} [prefersReduced] `(prefers-reduced-motion: reduce)` matches
 */
export function effectiveShowMotion(setting, prefersReduced = false) {
  const motion = normalizeShowMotion(setting);
  return motion === 'full' && prefersReduced === true ? 'reduced' : motion;
}

const level = (box) => Math.max(0, Math.trunc(Number(box?.level)) || 0);
const prizeCount = (box) => (Array.isArray(box?.prizes) ? box.prizes.length : 0);

/**
 * Plan the show.
 * @param {Array<{ prizes?: object[], level?: number }>} boxes the reveal view's boxes, in open order; `level` is the
 *   tier's index in the tier order (the wobble grows with it)
 * @param {{ motion?: string, speed?: number }} [opts]
 * @returns {Array<{ boxIndex: number|null, phase: string, prizeIndex?: number, ms: number }>}
 */
export function planShowTimeline(boxes, { motion = DEFAULT_LOOT_BOX_SHOW_MOTION, speed = 1 } = {}) {
  const mode = normalizeShowMotion(motion);
  const summary = { boxIndex: null, phase: LOOT_BOX_SUMMARY_PHASE, ms: 0 };
  if (mode === 'summary') return [summary];
  const d = LOOT_BOX_SHOW_DURATIONS[mode];
  const rate = normalizeShowSpeed(speed);
  const ms = (n) => Math.round(n / rate);
  const steps = [];
  Array.from(boxes ?? []).forEach((box, boxIndex) => {
    steps.push({ boxIndex, phase: 'arrive', ms: ms(d.arrive) });
    steps.push({ boxIndex, phase: 'shake', ms: ms(d.shake + d.shakePerLevel * level(box)) });
    steps.push({ boxIndex, phase: 'burst', ms: ms(d.burst) });
    for (let prizeIndex = 0; prizeIndex < prizeCount(box); prizeIndex += 1) {
      steps.push({ boxIndex, phase: 'deal', prizeIndex, ms: ms(d.deal) });
    }
    steps.push({ boxIndex, phase: 'hold', ms: ms(d.hold) });
  });
  steps.push(summary);
  return steps;
}

/** The index of the summary step (the last). */
export function summaryStepIndex(timeline) {
  return Math.max(0, (timeline?.length ?? 1) - 1);
}

/**
 * Skip box: the index of the `hold` step of the box the step at `index` belongs to (every prize shown at once). At a
 * `hold` it is the next box's first step; at the summary it stays.
 * @param {object[]} timeline
 * @param {number} index
 */
export function skipBoxStepIndex(timeline, index) {
  const steps = Array.isArray(timeline) ? timeline : [];
  const at = Math.min(Math.max(0, Math.trunc(Number(index)) || 0), summaryStepIndex(steps));
  const step = steps[at];
  if (!step || step.phase === LOOT_BOX_SUMMARY_PHASE) return at;
  if (step.phase === 'hold') return at + 1;
  const hold = steps.findIndex((s, i) => i > at && s.boxIndex === step.boxIndex && s.phase === 'hold');
  return hold === -1 ? summaryStepIndex(steps) : hold;
}

/**
 * What the stage shows at a step: the box on stage, its phase, whether the lid is off and how many of its prizes are
 * out. Earlier boxes count as opened (the rail marks them).
 * @param {object[]} timeline
 * @param {number} index
 * @returns {{ boxIndex: number|null, phase: string, opened: boolean, dealt: number, summary: boolean }}
 */
export function stageAt(timeline, index) {
  const steps = Array.isArray(timeline) ? timeline : [];
  const step = steps[Math.min(Math.max(0, Math.trunc(Number(index)) || 0), summaryStepIndex(steps))];
  if (!step || step.phase === LOOT_BOX_SUMMARY_PHASE) return { boxIndex: null, phase: LOOT_BOX_SUMMARY_PHASE, opened: true, dealt: 0, summary: true };
  const deals = steps.filter((s) => s.boxIndex === step.boxIndex && s.phase === 'deal').length;
  let dealt = 0;
  if (step.phase === 'deal') dealt = step.prizeIndex + 1;
  else if (step.phase === 'hold') dealt = deals;
  return { boxIndex: step.boxIndex, phase: step.phase, opened: step.phase !== 'arrive' && step.phase !== 'shake', dealt, summary: false };
}
