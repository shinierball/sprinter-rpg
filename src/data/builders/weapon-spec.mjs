/**
 * src/data/builders/weapon-spec.mjs
 * Pure helpers for the advanced weapon builder. The draft is a gear payload spec (`{ name, img, system: { isWeapon, ... } }`),
 * the shape the example specs and `essentialsFor('weapon').toSpec` use, so `buildPayload('weapon', draft)` stays the
 * one compiler. This file only holds what the builder window needs around it: the pages, the starting draft and the
 * Rank readout, which reads the damage engine's own scaling (`scaleWeaponBase`).
 */
import { RANK_BREAK_THRESHOLDS } from '../tag-vocabulary.mjs';
import { getGrantedRankDamageDie } from '../rank-dice.mjs';
import { baseDamageText } from '../../utils/damage/base-damage.mjs';
import { scaleWeaponBase } from '../../utils/damage/weapon-base-scaling.mjs';
import { listedSkillEntries } from '../../utils/skill/weapon-skill-options.mjs';

/** The Ranks the readout shows: untrained, the first break and the second. */
const READOUT_RANKS = Object.freeze([0, RANK_BREAK_THRESHOLDS.rank5, RANK_BREAK_THRESHOLDS.rank10]);

/** The builder's pages in order: `{ id, icon }`; each page's words are `COG.WeaponBuilder.Step.<id>`. */
export const WEAPON_BUILDER_STEPS = Object.freeze([
  { id: 'basics', icon: 'fa-pen' },
  { id: 'skills', icon: 'fa-graduation-cap' },
  { id: 'type', icon: 'fa-tag' },
  { id: 'damage', icon: 'fa-burst' },
  { id: 'extras', icon: 'fa-wand-magic-sparkles' },
  { id: 'review', icon: 'fa-clipboard-check' }
]);

/**
 * A new weapon draft: a gear spec with `isWeapon`, the hands slot and empty Skill and tag lists, with the seed (for
 * instance the setup modal's answers as a spec) laid over it. The seed's own `system` keys win.
 * @param {object} [seed] a partial gear spec
 * @returns {object}
 */
export function startWeaponDraft(seed = {}) {
  const system = { isWeapon: true, slot: 'hands', associatedSkills: [], tags: [], ...(seed?.system ?? {}) };
  return { ...seed, type: 'gear', system };
}

/**
 * What the weapon rolls at each Rank, from the first Skill it lists that this world has (or the weapon's own override
 * with no Skill). Bonus damage rows are not included: they are added on top and do not grow with Rank.
 * @param {object} weaponSystem the draft's `system`
 * @param {{ find?: Function, list?: Function }} resolver the catalogs
 * @param {number[]} [ranks]
 * @returns {Array<{ rank: number, untrained: boolean, text: string }>}
 */
export function rankReadout(weaponSystem, resolver, ranks = READOUT_RANKS) {
  const found = listedSkillEntries(weaponSystem, resolver).find((entry) => entry.inWorld);
  const skill = found?.definition?.system ?? null;
  return ranks.map((rank) => {
    const scaled = scaleWeaponBase({ skill, weapon: weaponSystem, rank });
    const lines = [baseDamageText({ ...scaled.base, dice: scaled.dice }, skill?.stat)];
    for (const extra of scaled.offSize) lines.push(extra.dice);
    if (rank > 0) {
      const die = getGrantedRankDamageDie(rank, scaled.rankDieGrants);
      if (die.dice || die.value) lines.push(String(die.dice || die.value));
    }
    return { rank, untrained: rank === 0, text: lines.filter(Boolean).join(' + ') };
  });
}
