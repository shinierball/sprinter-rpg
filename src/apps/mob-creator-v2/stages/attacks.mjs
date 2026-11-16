/**
 * The Attacks stage: the mob's own attack cards (selects and numbers, with the dice as a count and a size), the weapons it
 * holds (each with the Skill it rolls from and what the mob rolls with it), and the attacks dropped from other mobs.
 */
import { ATTACK_DIE_SIZES } from '../../../data/mob-creator/draft.mjs';
import { getAvailableDebuffs } from '../../../sheets/item/catalogs.mjs';
import { buildOnHitDebuffPicker } from '../../../sheets/item/context-on-hit.mjs';
import { unitOptions } from '../../../sheets/item/context-timing.mjs';
import { identifierEntries } from '../../../sheets/item/context-pick-list.mjs';
import { COG_DAMAGE_TYPES } from '../../../data/damage-types.mjs';
import { choiceOptions, statOptions } from '../../../utils/ui/field-options.mjs';
import { listAreaShapes } from '../../../utils/area/area-geometry.mjs';
import { describeAttackMechanics } from '../../../utils/attack/attack-mechanics.mjs';
import { conditionLabel } from '../../../documents/actor/condition-data.mjs';
import { buildWeaponAttackProfile } from '../../../documents/actor/combat-attack-profiles.mjs';
import { getAttackDifficultyState } from '../../../documents/actor/attack-targets.mjs';
import { sourceBadge } from '../../../utils/content-source.mjs';
import { readControl } from '../../crawler-creator/stage-context.mjs';
import { createNew, openPicker } from '../picks.mjs';
import { MOB_CREATOR_V2_FORM } from '../form.mjs';
import { tr } from '../words.mjs';

const WORDS = 'COG.MobCreator.Attacks';

/** The dice counts and Ranks the selects offer (a count or Rank outside them is kept as the current choice). */
const MAX_DICE = 20;
export const MAX_RANK = 20;
export const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
export const numberOptions = (values, current) => {
  const all = values.includes(current) ? values : [...values, current].sort((a, b) => a - b);
  return all.map((value) => ({ value, label: String(value), selected: value === current }));
};

export const damageTypeOptions = (current) => choiceOptions(['Physical', ...COG_DAMAGE_TYPES], current);

/** The index of the attack card or item row a control belongs to (`data-index` on the card). */
const rowIndex = (target, selector) => Number(target?.closest?.(selector)?.dataset?.index);

/** The debuffs a rider or a save can name, as the attack sheet offers them (the catalog's and the world's). */
export const debuffChoices = () => getAvailableDebuffs();

/** The rider picker's custom entry gets an id, as every text control of the creator has one. */
const withInputId = (riders, inputId) => ({ ...riders, picker: { ...riders.picker, inputId } });

function attackCard(draft, row, index, { debuffs, evadeBase, rootId }) {
  const dice = draft.attackDice(index);
  const shapes = listAreaShapes();
  const shape = shapes.find((s) => s.id === row.area.shape);
  const built = draft.builtAttack(index);
  return {
    index,
    number: index + 1,
    name: row.name,
    canMoveUp: index > 0,
    canMoveDown: index < draft.spec.attacks.length - 1,
    toHitStatOptions: statOptions(row.toHitStat),
    damageStatOptions: [...statOptions(row.damageStat), { value: 'none', label: tr(`${WORDS}.NoStat`), selected: row.damageStat === 'none' }],
    damageTypeOptions: damageTypeOptions(row.damageType),
    countOptions: [
      { value: '', label: tr(`${WORDS}.Recommended`, { count: dice.recommended }), selected: !dice.custom },
      ...numberOptions(range(1, MAX_DICE), dice.count).map((o) => ({ ...o, selected: dice.custom && o.selected }))
    ],
    dieOptions: ATTACK_DIE_SIZES.map((value) => ({ value, label: value, selected: value === row.die })),
    dice: { ...dice, hint: tr(`${WORDS}.DiceHint`, { count: dice.recommended }) },
    hitDifficulty: row.hitDifficulty ?? '',
    hitPlaceholder: evadeBase,
    rangeFeet: row.rangeFeet,
    cooldownValue: row.cooldown.value,
    cooldownUnits: unitOptions('cooldown', String(row.cooldown.unit ?? '')),
    shapeOptions: [
      { value: '', label: tr(`${WORDS}.NoShape`), selected: !shape },
      ...shapes.map((s) => ({ value: s.id, label: s.label, selected: s.id === row.area.shape }))
    ],
    hasShape: Boolean(shape),
    showRadius: Boolean(shape) && shape.size !== 'length',
    showLength: Boolean(shape) && shape.size === 'length',
    area: row.area,
    ignoreDR: row.ignoreDR,
    riders: withInputId(buildOnHitDebuffPicker(row.onHit, debuffs), `${rootId}-attack-${index}-rider-custom`),
    contest: {
      has: row.contest.hasContest,
      statOptions: statOptions(row.contest.targetStat),
      customDC: row.contest.customDC,
      debuffOptions: [
        { value: '', label: tr(`${WORDS}.NoDebuff`), selected: !row.contest.onFailDebuff },
        ...identifierEntries(debuffs).map((e) => ({ ...e, selected: e.value === row.contest.onFailDebuff }))
      ]
    },
    readsAs: describeAttackMechanics(built.system, { labelOf: conditionLabel }).text,
    effects: row.effects
  };
}

/**
 * What the mob rolls with a held weapon, read from an unsaved mob the way its sheet would read it (the sheet's own attack
 * profile), and the Difficulty it rolls against: the mob's Evade base plus the Floor it is made for.
 * @param {import('../../../data/mob-creator/draft.mjs').MobDraft} draft
 * @param {number} itemIndex the weapon's index in `spec.items`
 * @returns {{ damage: string, bonus: string, difficulty: number }|null}
 */
function weaponProfile(draft, itemIndex) {
  const ActorClass = globalThis.CONFIG?.Actor?.documentClass;
  if (typeof ActorClass !== 'function') return null;
  try {
    const payload = draft.compile();
    const actor = new ActorClass(structuredClone(payload));
    actor.prepareData?.();
    const at = payload.items.length - draft.spec.items.length + itemIndex;
    const item = [...actor.items][at];
    if (!item) return null;
    const profile = buildWeaponAttackProfile(actor, item);
    return { damage: profile.displayDamage, bonus: profile.displayDmgMod, difficulty: getAttackDifficultyState(actor, item, draft.spec.designFloor).dc };
  } catch (err) {
    console.warn('Sprinter RPG | The Mob Creator could not read a weapon\'s attack profile:', err);
    return null;
  }
}

/** The sentence for an equipped weapon with no damage source (`MobDraft.weaponIssues`): the Review stage and the weapon card. */
export function weaponWarning(issue) {
  const key = issue.listsNone ? 'WeaponListsNone' : issue.missing.length ? 'WeaponSkillMissing' : 'WeaponNoSkill';
  return tr(`${WORDS}.${key}`, { name: issue.name, skills: issue.missing.join(', ') });
}

function weaponCards(draft) {
  const issues = new Map(draft.weaponIssues().map((i) => [i.index, i]));
  const cards = [];
  draft.spec.items.forEach((item, index) => {
    if (item.type !== 'gear' || !item.system?.isWeapon) return;
    const profile = weaponProfile(draft, index);
    const brought = draft.spec.items
      .map((skill, skillIndex) => ({ skill, skillIndex }))
      .filter(({ skill }) => draft.broughtBy.get(skill) === item)
      .map(({ skill, skillIndex }) => ({
        index: skillIndex,
        name: skill.name,
        rankOptions: numberOptions(range(0, MAX_RANK), Number(skill.system?.rank) || 0),
        follows: draft.followRank.has(skill)
      }));
    const issue = issues.get(index);
    cards.push({
      index,
      name: item.name,
      img: item.img,
      badge: sourceBadge(item),
      skills: brought,
      rolls: profile ? tr(`${WORDS}.Rolls`, { damage: profile.damage || '-', bonus: profile.bonus, difficulty: profile.difficulty }) : '',
      warning: issue ? weaponWarning(issue) : ''
    });
  });
  return cards;
}

const droppedAttacks = (draft) => draft.spec.items
  .map((item, index) => ({ item, index }))
  .filter(({ item }) => item.type === 'attack')
  .map(({ item, index }) => ({ index, name: item.name, img: item.img, badge: sourceBadge(item), readsAs: describeAttackMechanics(item.system, { labelOf: conditionLabel }).text }));

export const ATTACKS_STAGE = Object.freeze({
  id: 'attacks',
  /**
   * @param {import('../../../data/mob-creator/draft.mjs').MobDraft} draft
   * @param {{ rootId: string, debuffs?: object[] }} options `debuffs`: the debuffs a rider can name
   */
  context(draft, { rootId, debuffs = [] }) {
    const r = draft.readouts();
    const evadeBase = r.evade.base;
    return {
      rootId,
      guidance: tr(`${WORDS}.Guidance`, { level: r.level, kind: tr(`${WORDS}.${r.isBoss ? 'KindBoss' : 'KindMob'}`), dice: r.recommendedDice }),
      attacks: draft.spec.attacks.map((row, index) => attackCard(draft, row, index, { debuffs, evadeBase, rootId })),
      weapons: weaponCards(draft),
      dropped: droppedAttacks(draft)
    };
  },
  actions: {
    async addAttack() {
      this.draft.addAttack();
      await this.render({ parts: this._parts() });
    },
    async removeAttack(event, target) {
      if (!this.draft.removeAttack(rowIndex(target, MOB_CREATOR_V2_FORM.rows.attacks.card))) return;
      await this.render({ parts: this._parts() });
    },
    async moveAttack(event, target) {
      if (!this.draft.moveAttack(rowIndex(target, MOB_CREATOR_V2_FORM.rows.attacks.card), Number(target.dataset.step))) return;
      await this.render({ parts: this._parts() });
    },
    /** One control of an attack card: `data-path` inside the attack, `data-type` for its conversion. */
    async setAttackField(event, target) {
      const value = target.type === 'checkbox' ? target.checked : readControl(target);
      if (!this.draft.setAttack(rowIndex(target, MOB_CREATOR_V2_FORM.rows.attacks.card), target.dataset.path, value)) return;
      // A typed name keeps the card (and the caret) where it is.
      await this.render({ parts: target.dataset.path === 'name' ? ['preview'] : this._parts() });
    },
    /** A held item's Skill Rank (a weapon's Skill): the Rank no longer follows the Floor or the tier. */
    async setItemRank(event, target) {
      if (!this.draft.setItemRank(Number(target.dataset.index), readControl(target))) return;
      await this.render({ parts: this._parts() });
    },
    async removeItem(event, target) {
      if (!this.draft.removeItem(Number(target.dataset.index))) return;
      await this.render({ parts: this._parts() });
    },
    addWeapon() {
      return openPicker('weapon', this.draft, () => this.render({ parts: this._parts() }));
    },
    newWeapon() {
      return createNew('weapon', this.draft, () => this.render({ parts: this._parts() }));
    }
  }
});
