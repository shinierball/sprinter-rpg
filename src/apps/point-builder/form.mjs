/**
 * The Race and Class Creators' form as data (`POINT_BUY_FORM`), the inline-row field parsers and the generated row actions.
 */

import { DEFAULT_RANK_BONUS_COST } from '../../data/rules/point-buy-budget.mjs';
import { SPEC_GRANT_LISTS } from '../perk-rows-host.mjs';

const nonNegative = (raw) => Math.max(0, Number(raw) || 0);

/**
 * The inline-row fields that need coercion, keyed by field name (the `data-row-field` value). Checkboxes arrive as
 * booleans. Every other field is a string field.
 */
export const POINT_BUY_FIELD_PARSERS = Object.freeze({
  rank: (raw) => Math.max(0, Math.trunc(Number(raw)) || 1),
  cost: nonNegative,
  extraPoints: nonNegative,
  isPassive: Boolean
});

/** Fields stored as typed or picked text. */
const POINT_BUY_STRING_FIELDS = Object.freeze(['identifier', 'name', 'description', 'tier']);

/** Every `data-row-field` the point-buy rows may carry. */
export const POINT_BUY_ROW_FIELDS = Object.freeze([...Object.keys(POINT_BUY_FIELD_PARSERS), ...POINT_BUY_STRING_FIELDS]);

/** Fields whose change alters the ledger (or the layout around the row): they re-render the build and the receipt. */
export const LEDGER_FIELDS = new Set(['rank', 'cost', 'extraPoints', 'isPassive', 'tier', 'identifier']);

const rowSelector = (key) => `.cog-pb-row[data-row="${key}"]`;
const rowForm = (key, noun, extra = {}) => Object.freeze({
  item: rowSelector(key),
  field: 'data-row-field',
  add: `add${noun}Row`,
  remove: `remove${noun}Row`,
  ...extra
});
const COPIED_EFFECT = Object.freeze({ by: 'identifier', keys: Object.freeze(['name', 'img', 'system']) });

/**
 * The Race and Class Creators' form as data, in the shape of `MOB_CREATOR_FORM`: `state` is the object
 * every `data-row-field` path is relative to, `rows` the repeating inline rows (`item` the row element carrying
 * `data-row` and `data-index`, `field` the attribute whose value names the row's spec field, `add` and `remove` the
 * action names), `copied` what a catalog pick copies into a row, and `catalogs` the checkbox lists with their actions.
 */
export const POINT_BUY_FORM = Object.freeze({
  state: (app) => app.spec,
  rows: Object.freeze({
    skills: rowForm('skills', 'Skill'),
    spells: rowForm('spells', 'Spell'),
    buffs: rowForm('buffs', 'Buff', { copied: COPIED_EFFECT }),
    debuffs: rowForm('debuffs', 'Debuff', { copied: COPIED_EFFECT }),
    customBenefits: rowForm('customBenefits', 'CustomBenefit'),
    customDetriments: rowForm('customDetriments', 'CustomDetriment'),
    statPools: rowForm('statPools', 'StatPool'),
    rankBonuses: rowForm('rankBonuses', 'RankBonus')
  }),
  // The pick list and the tag query inside a spec grant row (D4, D5): `row` is the list, `path` the field of the row.
  pickLists: Object.freeze({ grantOptions: Object.freeze({ row: 'statPools', path: 'options' }) }),
  queries: Object.freeze({ rankBonuses: 'query' }),
  catalogs: Object.freeze({
    selectedBenefits: Object.freeze({ toggle: 'toggleBenefit', text: 'setCatalogText' }),
    selectedDetriments: Object.freeze({ toggle: 'toggleDetriment', text: 'setCatalogText' })
  }),
  // Each custom perk's Mechanics rows editor (D5): `open` toggles it, `scope` is its form, `prefix` roots its input names.
  // `grantLists` are the stat pool and rank bonus lists: one rows form each, with no perk index.
  perkRows: Object.freeze({
    lists: Object.freeze(['customBenefits', 'customDetriments']),
    grantLists: Object.freeze(Object.keys(SPEC_GRANT_LISTS)),
    open: 'togglePerkRows', scope: '.cog-perk-rows-form, .cog-spec-grants-form', prefix: 'perkRows'
  })
});

/** What Add pushes for each row kind: a blank row, filled in place. */
const ROW_ADDERS = Object.freeze({
  skills: (app) => app.addSkill({ name: '' }),
  spells: (app) => app.addSpell({ name: '' }),
  buffs: (app) => app.addBuff({ name: '' }),
  debuffs: (app) => app.addDebuff({ name: '' }),
  customBenefits: (app) => app.spec.customBenefits.push({ name: '', cost: 1 }),
  customDetriments: (app) => app.spec.customDetriments.push({ name: '', extraPoints: 1 }),
  statPools: (app) => app.spec.statPools.push({ value: 1, options: [] }),
  rankBonuses: (app) => app.spec.rankBonuses.push({ value: 1, cost: DEFAULT_RANK_BONUS_COST })
});

/** The Add and Remove actions of every row in `POINT_BUY_FORM.rows`, generated from the descriptor. */
export function rowActions() {
  const actions = {};
  for (const [key, form] of Object.entries(POINT_BUY_FORM.rows)) {
    actions[form.add] = async function addRow() {
      ROW_ADDERS[key](this);
      await this._refreshBuild();
    };
    actions[form.remove] = async function removeRow(event, target) {
      this.removeRow(key, Number(target.dataset.index));
      await this._refreshBuild();
    };
  }
  return actions;
}

/** Spec props a pill button group may set through `setProp`. */
export const POINT_BUY_PILL_PROPS = ['size', 'heritage'];
