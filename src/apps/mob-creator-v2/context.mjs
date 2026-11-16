/**
 * Template data of the new Mob Creator, from a `MobDraft`. Pure: every function reads the draft and returns plain data in
 * the shape its template takes (the shared stage rail is `templates/apps/floor-simulator/rail.hbs`), with each option list and
 * `selected` flag precomputed (GEMINI §5). The words are lang keys under `COG.MobCreator`.
 */
import { MOB_STATS } from '../../data/mob-creator/draft.mjs';
import { IDENTITY_STAGE } from './stages/identity.mjs';
import { STATS_STAGE } from './stages/stats.mjs';
import { DEFENSES_STAGE } from './stages/defenses.mjs';
import { ATTACKS_STAGE } from './stages/attacks.mjs';
import { ABILITIES_STAGE } from './stages/abilities.mjs';
import { LORE_STAGE } from './stages/lore.mjs';
import { REVIEW_STAGE } from './stages/review.mjs';
import { tr } from './words.mjs';

/** The stages in rail order. */
export const STAGES = Object.freeze([
  IDENTITY_STAGE,
  STATS_STAGE,
  DEFENSES_STAGE,
  ATTACKS_STAGE,
  ABILITIES_STAGE,
  LORE_STAGE,
  REVIEW_STAGE
]);

/** The first stage, where a new window opens. */
export const FIRST_STAGE = STAGES[0].id;

const STAGE_KEY = 'COG.MobCreator.Stage';
const stageAt = (id) => STAGES.findIndex((s) => s.id === id);

/** The id a Back or Next press goes to from `active`, or null at the ends. */
export function neighbourStage(active, step) {
  const at = stageAt(active) + step;
  return STAGES[at]?.id ?? null;
}

/** Whether `id` is a stage of the creator. */
export const isStage = (id) => stageAt(id) >= 0;

/**
 * The stage rail: one entry per stage. A stage is `break` while it holds a Rule Break, `done` once it has been visited
 * with nothing broken, else `open`.
 * @param {import('../../data/mob-creator/draft.mjs').MobDraft} draft
 * @param {{ active: string, visited: Set<string> }} state
 */
export function stageRail(draft, { active, visited }) {
  const broken = new Set(draft.ruleBreaks().map((b) => b.stage));
  return {
    empty: false,
    steps: STAGES.map(({ id }) => {
      const breaks = broken.has(id) ? draft.ruleBreaks().filter((b) => b.stage === id).length : 0;
      return {
        id, labelKey: `${STAGE_KEY}.${id}`, stage: false, active: id === active, openDice: 0,
        breaks, status: breaks ? 'break' : (visited.has(id) ? 'done' : 'open')
      };
    })
  };
}

/**
 * One stage's part: the stage id, its title key, whether it is the active one, and (for the active stage only) the stage's
 * own data, spread at the top level. An inactive stage's part renders hidden and empty.
 */
export function stagePart(draft, id, { active, rootId, fillFocus, debuffs, summaries }) {
  const stage = STAGES[stageAt(id)];
  const isActive = id === active;
  return {
    stage: id,
    titleKey: `${STAGE_KEY}.${id}`,
    active: isActive,
    ...(isActive ? stage.context(draft, { rootId, fillFocus, debuffs, summaries }) : {})
  };
}

/** The footer: the status line (Ready, or every Rule Break the draft holds) and which buttons work. */
export function stageFooter(draft, { active }) {
  const reasons = draft.ruleBreaks().map((b) => b.reason);
  return {
    reasons,
    canCreate: reasons.length === 0,
    canBack: neighbourStage(active, -1) !== null,
    canNext: neighbourStage(active, 1) !== null
  };
}

/** The live stat block on the right: the readouts of the draft, as a stat block reads them. */
export function statBlock(draft) {
  const r = draft.readouts();
  const { spec } = draft;
  return {
    name: spec.name,
    isBoss: r.isBoss,
    tierLabel: r.tier?.label ?? '',
    level: r.level,
    floor: r.floor,
    size: spec.size,
    creatureType: spec.creatureType,
    stats: MOB_STATS.map((key) => ({ key, label: tr(`COG.MobCreator.Stats.Stat.${key}`), value: spec.abilities[key], mod: r.modLabels[key] })),
    bars: r.bars,
    hpPerBar: r.hpPerBar,
    maxHp: r.maxHp,
    evade: r.evade,
    surprise: r.surprise,
    dr: r.dr,
    move: r.move,
    step: r.step,
    budget: { points: r.budget.points, spent: r.spent, remaining: r.remaining, over: r.over },
    recommendedDice: r.recommendedDice,
    attackCount: spec.attacks.length
  };
}
