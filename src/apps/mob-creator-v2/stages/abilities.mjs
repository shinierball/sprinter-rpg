/**
 * The Abilities stage: the buffs, spells and Skills a mob holds (picked from the catalogs, dropped or made as world items first;
 * each a copy in `spec.items`), the quick defensive traits (a resistance, an immunity or a damage multiplier) and the Mana the
 * mob has for its spells.
 */
import { QUICK_TRAIT_TYPES } from '../../../data/mob-creator/draft.mjs';
import { describeItem, summaryText } from '../../../utils/item-describer/index.mjs';
import { sourceBadge } from '../../../utils/content-source.mjs';
import { readControl } from '../../crawler-creator/stage-context.mjs';
import { damageTypeOptions, MAX_RANK, numberOptions, range } from './attacks.mjs';
import { createNew, openPicker } from '../picks.mjs';
import { MOB_CREATOR_V2_FORM } from '../form.mjs';
import { tr } from '../words.mjs';

const WORDS = 'COG.MobCreator.Abilities';

/** The embedded item types the stage lists as abilities (a buff, or a debuff a drop brought). */
const ABILITY_TYPES = Object.freeze(['buff', 'debuff']);

/** The quick trait buttons, by type: the lang key of each. */
const QUICK_ADD_KEYS = Object.freeze({ damageMultiplier: 'AddMultiplier', resistance: 'AddResistance', immunity: 'AddImmunity' });

/** The index of the trait row a control belongs to (`data-index` on the row). */
const traitIndex = (target) => Number(target?.closest?.(MOB_CREATOR_V2_FORM.rows.traits.card)?.dataset?.index);

/**
 * What each embedded item does, from the shared describer, by index in `spec.items` (the describer is async, so the window
 * reads it before it prepares the stage).
 * @param {import('../../../data/mob-creator/draft.mjs').MobDraft} draft
 * @returns {Promise<string[]>}
 */
export function abilitySummaries(draft) {
  return Promise.all(draft.spec.items.map(async (item) => {
    try {
      return summaryText(await describeItem(item));
    } catch (err) {
      console.warn('Sprinter RPG | The Mob Creator could not describe an item:', err);
      return '';
    }
  }));
}

/** The row of an embedded item. */
function itemRow(draft, item, index, summaries) {
  const ranked = item.type === 'skill' || item.type === 'spell';
  const weapon = draft.broughtBy.get(item);
  return {
    index,
    name: item.name,
    img: item.img,
    badge: sourceBadge(item),
    readsAs: summaries[index] ?? '',
    ranked,
    rankOptions: ranked ? numberOptions(range(0, MAX_RANK), Number(item.system?.rank) || 0) : [],
    follows: draft.followRank.has(item),
    brought: weapon ? tr(`${WORDS}.BroughtBy`, { weapon: weapon.name }) : ''
  };
}

const rowsOf = (draft, summaries, match) => draft.spec.items
  .map((item, index) => ({ item, index }))
  .filter(({ item }) => match(item))
  .map(({ item, index }) => itemRow(draft, item, index, summaries));

/** One list of the stage: its title, its two buttons (Add opens the catalog, New the setup page) and its rows. */
const group = (id, title, add, create, addAction, newAction, rows) => ({
  id, title: tr(`${WORDS}.${title}`), addLabel: tr(`${WORDS}.${add}`), create: tr(`${WORDS}.${create}`), addAction, newAction, rows
});

export const ABILITIES_STAGE = Object.freeze({
  id: 'abilities',
  /**
   * @param {import('../../../data/mob-creator/draft.mjs').MobDraft} draft
   * @param {{ rootId: string, summaries?: string[] }} options `summaries`: `abilitySummaries(draft)`
   */
  context(draft, { rootId, summaries = [] }) {
    const mana = draft.spellMana();
    return {
      rootId,
      guidance: tr(`${WORDS}.Guidance`, { rank: draft.skillStartRank }),
      groups: [
        group('abilities', 'Abilities', 'AddAbility', 'NewAbility', 'addAbility', 'newAbility', rowsOf(draft, summaries, (i) => ABILITY_TYPES.includes(i.type))),
        group('spells', 'Spells', 'AddSpell', 'NewSpell', 'addSpell', 'newSpell', rowsOf(draft, summaries, (i) => i.type === 'spell')),
        group('skills', 'Skills', 'AddSkill', 'NewSkill', 'addSkill', 'newSkill', rowsOf(draft, summaries, (i) => i.type === 'skill'))
      ],
      traits: draft.quickTraits().map(({ row, index }) => ({
        index,
        name: row.name,
        isMultiplier: row.type === 'damageMultiplier',
        multiplier: row.multiplier,
        damageTypeOptions: damageTypeOptions(row.damageType)
      })),
      quickButtons: QUICK_TRAIT_TYPES.map((type) => ({ type, label: tr(`${WORDS}.${QUICK_ADD_KEYS[type]}`) })),
      mana: mana && { value: draft.spec.mana, note: mana.short ? tr(`${WORDS}.ManaShort`, { cost: mana.cost, mana: mana.mana }) : '' }
    };
  },
  actions: {
    addAbility() {
      return openPicker('buff', this.draft, () => this.render({ parts: this._parts() }));
    },
    addSpell() {
      return openPicker('spell', this.draft, () => this.render({ parts: this._parts() }));
    },
    addSkill() {
      return openPicker('skill', this.draft, () => this.render({ parts: this._parts() }));
    },
    newAbility() {
      return createNew('buff', this.draft, () => this.render({ parts: this._parts() }));
    },
    newSpell() {
      return createNew('spell', this.draft, () => this.render({ parts: this._parts() }));
    },
    newSkill() {
      return createNew('skill', this.draft, () => this.render({ parts: this._parts() }));
    },
    async addTrait(event, target) {
      if (this.draft.addTrait(target.dataset.type) < 0) return;
      await this.render({ parts: this._parts() });
    },
    async removeTrait(event, target) {
      if (!this.draft.removeTrait(traitIndex(target))) return;
      await this.render({ parts: this._parts() });
    },
    /** One control of a quick trait row: `data-path` is its key. */
    async setTraitField(event, target) {
      if (!this.draft.setTrait(traitIndex(target), target.dataset.path, readControl(target))) return;
      await this.render({ parts: target.dataset.path === 'name' ? ['preview'] : this._parts() });
    }
  }
});
