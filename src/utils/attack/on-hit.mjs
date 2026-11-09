/**
 * The shared "On Hit" block (attack, gear, skill, spell): what a damaging hit does to its target after the damage.
 * 3.13-1 carries the debuff part; 3.13-2 adds lifesteal (heal the attacker) and dispel (suspend the target's Buffs);
 * 3.48-4a makes the debuff part three lists (any hit, Evade fail, slot loss), each `all` or `pickOne`.
 */
import { resolveReachedRankBreaks } from '../skill/rank-breaks.mjs';
import { EVADE_FAIL_DEGREES } from './evade-degrees.mjs';

const clean = (v) => {
  let val = v ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  return typeof val === 'string' ? val.trim() : '';
};

const wholeNumber = (v, min = 0) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, n) : min;
};

const cleanList = (list) => (Array.isArray(list) ? list.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()) : []);

/** A tag query with only well-formed buckets. */
function cleanQuery(query) {
  return { all: cleanList(query?.all), any: cleanList(query?.any), none: cleanList(query?.none) };
}

/** Debuff refs of one list, cleaned and unique. */
function refsOf(list) {
  const out = [];
  for (const entry of (Array.isArray(list) ? list : [])) {
    const ref = clean(entry);
    if (ref && !out.includes(ref)) out.push(ref);
  }
  return out;
}

const modeOf = (raw) => (clean(raw) === 'pickOne' ? 'pickOne' : 'all');

const gateOf = (raw) => {
  const degree = clean(raw);
  return EVADE_FAIL_DEGREES.includes(degree) ? degree : 'major_fail';
};

/**
 * What the sources' `onHit` blocks do to a target.
 * @param {{ sources: Array<{ item: object, rank?: number }> }} args `rank` is the source's own Rank (the matched
 *   weapon skill's for an attack or gear); each part is skipped when its own `minRank` is above it.
 * @returns {{ debuffs: string[], debuffPick: Array<{ label: string, refs: string[] }>,
 *   evadeFail: Array<{ ref: string, degree: string, mode: 'all'|'pickOne', group: string }>,
 *   slotLoss: Array<{ ref: string, minSlotsLost: number, mode: 'all'|'pickOne', group: string }>,
 *   lifesteal: Array<{ label: string, minSlotsLost: number, heal: number }>,
 *   dispel: Array<{ label: string, count: number, query: object }> }} in source order.
 *   - `debuffs`: the any-hit refs of `all`-mode lists (`getItemInflictedConditions` and the Inflict buttons read this alone).
 *   - `debuffPick`: one entry per `pickOne` any-hit list.
 *   - `evadeFail` and `slotLoss`: one entry per ref. A `pickOne` list's entries share a non-empty `group`: the applier
 *     picks one ref per group; `all` entries have an empty group and all apply.
 */
export function collectOnHitEffects({ sources = [] } = {}) {
  const debuffs = [];
  const debuffPick = [];
  const evadeFail = [];
  const slotLoss = [];
  const lifesteal = [];
  const dispel = [];
  const seen = new Set();
  let index = 0;
  for (const { item, rank } of sources) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    const group = `s${index++}`;
    const sourceRank = Number(rank) || 0;
    const block = item.system?.onHit;

    if (sourceRank >= (Number(block?.debuffMinRank) || 0)) {
      const refs = refsOf(block?.debuffs);
      if (modeOf(block?.debuffMode) === 'pickOne') {
        if (refs.length) debuffPick.push({ label: item.name ?? '', refs });
      } else {
        for (const ref of refs) if (!debuffs.includes(ref)) debuffs.push(ref);
      }

      const fail = block?.evadeFail;
      const failMode = modeOf(fail?.mode);
      const degree = gateOf(fail?.degree);
      for (const ref of refsOf(fail?.debuffs)) {
        if (failMode === 'all' && evadeFail.some(e => e.group === '' && e.ref === ref && e.degree === degree)) continue;
        evadeFail.push({ ref, degree, mode: failMode, group: failMode === 'pickOne' ? group : '' });
      }

      const loss = block?.slotLoss;
      const lossMode = modeOf(loss?.mode);
      const minSlotsLost = wholeNumber(loss?.minSlotsLost, 1) || 1;
      for (const ref of refsOf(loss?.debuffs)) {
        if (lossMode === 'all' && slotLoss.some(e => e.group === '' && e.ref === ref && e.minSlotsLost === minSlotsLost)) continue;
        slotLoss.push({ ref, minSlotsLost, mode: lossMode, group: lossMode === 'pickOne' ? group : '' });
      }
    }

    const steal = block?.lifesteal;
    const baseHeal = wholeNumber(steal?.heal);
    if (baseHeal > 0 && sourceRank >= wholeNumber(steal?.minRank)) {
      const bonus = wholeNumber(resolveReachedRankBreaks(item, sourceRank).onHit?.healBonus);
      lifesteal.push({ label: item.name ?? '', minSlotsLost: wholeNumber(steal?.minSlotsLost, 1) || 1, heal: baseHeal + bonus });
    }

    const purge = block?.dispel;
    if (purge?.enabled === true && sourceRank >= wholeNumber(purge?.minRank)) {
      dispel.push({ label: item.name ?? '', count: wholeNumber(purge?.count), query: cleanQuery(purge?.query) });
    }
  }
  return { debuffs, debuffPick, evadeFail, slotLoss, lifesteal, dispel };
}

/** True when any of the block's three debuff lists names a debuff (any Rank): derived `trigger.on_hit`, sheet "configured" flags. */
export function hasOnHitDebuff(system) {
  const block = system?.onHit;
  return refsOf(block?.debuffs).length > 0 || refsOf(block?.evadeFail?.debuffs).length > 0 || refsOf(block?.slotLoss?.debuffs).length > 0;
}

/** True when the block heals the attacker (any Rank): derived `rule.lifesteal`. */
export function hasLifesteal(system) {
  return wholeNumber(system?.onHit?.lifesteal?.heal) > 0;
}

/** True when the block dispels (any Rank): derived `action.dispel`. */
export function hasDispel(system) {
  return system?.onHit?.dispel?.enabled === true;
}

/** True when the block holds anything (sheet "configured" flag). */
export function hasOnHitEffect(system) {
  return hasOnHitDebuff(system) || hasLifesteal(system) || hasDispel(system);
}

/** JSON for a single-quoted `data-*` attribute: an apostrophe in a name must not end the attribute. */
const attrJson = (value) => JSON.stringify(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll("'", '&#39;');

/**
 * The damage card attributes for the lifesteal, dispel and gated-debuff parts (empty string when there are none).
 * @param {object} effects from `collectOnHitEffects`
 * @returns {string} ` data-lifesteal='...' data-dispel='...' data-debuff-pick='...' data-evade-fail='...' data-slot-loss='...'`
 */
export function onHitCardAttrs(effects) {
  let out = '';
  if (effects?.lifesteal?.length) out += `\n      data-lifesteal='${attrJson(effects.lifesteal)}'`;
  if (effects?.dispel?.length) out += `\n      data-dispel='${attrJson(effects.dispel)}'`;
  if (effects?.debuffPick?.length) out += `\n      data-debuff-pick='${attrJson(effects.debuffPick)}'`;
  if (effects?.evadeFail?.length) out += `\n      data-evade-fail='${attrJson(effects.evadeFail)}'`;
  if (effects?.slotLoss?.length) out += `\n      data-slot-loss='${attrJson(effects.slotLoss)}'`;
  return out;
}

function readList(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * Read the card's on-hit attributes defensively (CONTRIBUTING §4): arrays only, numbers clamped, degrees validated.
 * A bare string Evade-fail or slot-loss entry means `all` mode with the default gate (`major_fail` / 1 slot).
 * @param {DOMStringMap|object} dataset the card's `dataset`
 * @returns {{ lifesteal: Array<{ label: string, minSlotsLost: number, heal: number }>,
 *   dispel: Array<{ label: string, count: number, query: object }>,
 *   debuffPick: Array<{ label: string, refs: string[] }>,
 *   evadeFail: Array<{ ref: string, degree: string, mode: string, group: string }>,
 *   slotLoss: Array<{ ref: string, minSlotsLost: number, mode: string, group: string }> }}
 */
export function parseOnHitCard(dataset) {
  const lifesteal = readList(dataset?.lifesteal)
    .filter(e => e && typeof e === 'object')
    .map(e => ({ label: clean(e.label), minSlotsLost: wholeNumber(e.minSlotsLost, 1) || 1, heal: wholeNumber(e.heal) }))
    .filter(e => e.heal > 0);
  const dispel = readList(dataset?.dispel)
    .filter(e => e && typeof e === 'object')
    .map(e => ({ label: clean(e.label), count: wholeNumber(e.count), query: cleanQuery(e.query) }));
  const debuffPick = readList(dataset?.debuffPick)
    .filter(e => e && typeof e === 'object')
    .map(e => ({ label: clean(e.label), refs: refsOf(e.refs) }))
    .filter(e => e.refs.length > 0);
  const entries = (raw) => readList(raw)
    .map(e => (typeof e === 'string' ? { ref: e } : e))
    .filter(e => e && typeof e === 'object' && clean(e.ref))
    .map(e => ({
      ref: clean(e.ref), mode: modeOf(e.mode), group: clean(e.group),
      degree: gateOf(e.degree), minSlotsLost: wholeNumber(e.minSlotsLost, 1) || 1
    }));
  const evadeFail = entries(dataset?.evadeFail).map(({ ref, degree, mode, group }) => ({ ref, degree, mode, group }));
  const slotLoss = entries(dataset?.slotLoss).map(({ ref, minSlotsLost, mode, group }) => ({ ref, minSlotsLost, mode, group }));
  return { lifesteal, dispel, debuffPick, evadeFail, slotLoss };
}
