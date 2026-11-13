/**
 * What the floor-start creator reads from a compile to judge Race and Class requirements: the crawler as the compiler sees it
 * when it takes the Race (and the Class, with the Race on), the Stat rows that want points held, the selects decorated with
 * met / unmet, and the random pick that prefers an option the crawler meets or can meet. Pure over a build; it writes nothing.
 */
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { applyKindPlan, planRaceClass, raceClassView } from '../../data/race-class-plan.mjs';
import { checkRequirements, requirementSubject } from '../../utils/character/requirements.mjs';
import { rngIndex } from '../../utils/rng.mjs';
import { RACE_CLASS_TYPES } from '../../utils/document-types.mjs';

const KINDS = RACE_CLASS_TYPES;

/**
 * The crawler a Race or Class is judged on: the one the compiler holds when it plans them, before the Race; with `raceRef`,
 * after that Race (a Class is judged on it). Null before a build has one.
 * @param {object|null} compiled the controller's build
 * @param {string} [raceRef] the picked Race's reference
 * @returns {object|null} an actor-source view
 */
export function raceClassBase(compiled, raceRef = '') {
  const base = compiled?.raceClassBase;
  if (!base) return null;
  if (!raceRef) return base;
  const plan = compiled.raceClass?.race;
  if (plan?.ref === raceRef) return applyKindPlan(raceClassView(base), plan);
  return planRaceClass(base, { race: raceRef }).view;
}

/**
 * The Stat rows of the picked Race and Class, as `planStatHolds` takes them: `base` is the Stat in the row's view without
 * the points already held for it.
 * @param {object|null} plans the build's `raceClass` (`{ race, class }` KindPlans)
 * @param {Record<string, { points: number }>} held the points held now, by Stat
 */
export function statNeedRows(plans, held) {
  return KINDS.flatMap(kind => (plans?.[kind]?.requirements ?? [])
    .filter(row => row.kind === 'stat' && row.stat && row.need !== undefined)
    .map(row => ({ stat: row.stat, need: row.need, base: row.have - (held?.[row.stat]?.points ?? 0), kind })));
}

/** One kind's judged rows, with `moved` (the points held for it) on a Stat row that has some. */
export function requirementBadges(rows, kind, held) {
  return (rows ?? []).map(row => {
    const hold = row.stat ? held?.[row.stat] : null;
    return hold?.points && hold.for.includes(kind) ? { ...row, moved: hold.points } : row;
  });
}

const markSelected = (groups, value) => groups.map(g => ({ ...g, options: g.options.map(o => ({ ...o, selected: Boolean(value) && o.value === value })) }));

/**
 * The Race and Class selects with "(n unmet)" on every option (7.38e's `getRaceClassContext`): a Race is judged on the crawler
 * before it, a Class on the crawler with the picked Race. Without a build the selects come undecorated.
 * @param {object|null} compiled the controller's build
 * @param {{ race: string, class: string }} picks
 */
export function raceClassSelects(compiled, picks) {
  const stub = (details) => ({ type: 'crawler', system: { details }, items: [] });
  const base = raceClassBase(compiled);
  if (!base) return COGRaceClassApplier.getRaceClassContext(stub({ race: picks.race, class: picks.class }));
  const cleared = (view, race = '') => ({ ...view, system: { ...view.system, details: { ...view.system?.details, race, class: '' } } });
  const race = COGRaceClassApplier.getRaceClassContext(cleared(base), { requirements: true });
  const afterRace = raceClassBase(compiled, picks.race) ?? base;
  const klass = COGRaceClassApplier.getRaceClassContext(cleared(afterRace, picks.race), { requirements: true });
  return {
    raceOptions: markSelected(race.raceOptions, picks.race),
    classOptions: markSelected(klass.classOptions, picks.class)
  };
}

/** Whether the unmet rows are all Stat minimums the spare points can cover (the larger gap per Stat, summed). */
function coverable(rows, spare) {
  const unmet = rows.filter(row => row.status === 'unmet');
  if (unmet.some(row => row.kind !== 'stat' || !row.stat)) return false;
  const gaps = {};
  for (const row of unmet) gaps[row.stat] = Math.max(gaps[row.stat] ?? 0, row.shortfall ?? 0);
  return Object.values(gaps).reduce((sum, n) => sum + n, 0) <= spare;
}

/**
 * A random entry, preferring those the crawler `view` meets or could meet by moving up to `spare` Stat points; any entry when
 * none qualifies (the Rule Break is left for Finish) or when there is no view to judge on.
 * @param {object[]} entries catalog definitions
 * @param {'race'|'class'} kind
 * @param {object|null} view the crawler the entries are judged on
 * @param {number} spare Stat points the pool has left
 * @param {{ die: Function }} rng
 */
export function pickMeetable(entries, kind, view, spare, rng) {
  let pool = entries;
  if (view) {
    const readers = requirementSubject(view);
    const fit = entries.filter(def => {
      const { met, rows } = checkRequirements(view, { ...def, type: kind }, readers);
      return met || coverable(rows, spare);
    });
    if (fit.length) pool = fit;
  }
  return pool[rngIndex(rng, pool.length)];
}
