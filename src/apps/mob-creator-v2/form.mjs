/**
 * The new Mob Creator's form as data: the selectors and action names its stages' handlers read, and the same description the
 * replay harness (`tests/helpers/creator-replay.mjs`) drives the rendered window from, so a control that moves is moved in one
 * place. `card` is the element carrying a row's `data-index`; `field` the `data-change-action` of its controls (the control's
 * `data-path` names the spec path inside the row); `add` and `remove` the action names of its buttons.
 */
import { ATTACK_RIDER_LISTS } from '../../data/mob-creator/draft.mjs';

/** The item types each catalog picker adds, and the button (action name) that opens it. */
const PICKERS = Object.freeze({
  spell: Object.freeze({ open: 'addSpell', types: Object.freeze(['spell']) }),
  buff: Object.freeze({ open: 'addAbility', types: Object.freeze(['buff', 'debuff']) }),
  skill: Object.freeze({ open: 'addSkill', types: Object.freeze(['skill']) }),
  weapon: Object.freeze({ open: 'addWeapon', types: Object.freeze(['gear']), weapon: true }),
  item: Object.freeze({ open: 'addLootItem', types: Object.freeze(['gear', 'loot']), weapon: false })
});

export const MOB_CREATOR_V2_FORM = Object.freeze({
  /** The authoring state the controls write (the draft's spec). */
  state: (app) => app.draft.spec,
  /** The rail button of a stage. */
  stageButton: (id) => `[data-action="goStep"][data-step="${id}"]`,
  /** A control of the actor itself: a text, number, select or checkbox with the spec path in `data-path`. */
  field: '[data-change-action="setField"]',
  /** The stat steppers: `data-path` and `data-delta`. */
  stepper: '[data-action="adjustStat"]',
  /** The creature type select (a registered `creature.*` tag, or Other). */
  creatureType: '[data-creature-type]',
  /** Spec paths a control derives rather than takes: the creature type select writes the shown type with the tag. */
  derived: Object.freeze(['creatureType']),
  /** The pick list of the actor's tags (`data-list`), and the pick list of each rider path of an attack row. */
  tagList: 'actorTags',
  riderLists: Object.freeze(Object.fromEntries(Object.entries(ATTACK_RIDER_LISTS).map(([list, path]) => [path, list]))),
  rows: Object.freeze({
    attacks: Object.freeze({ card: '[data-attack-card]', field: 'setAttackField', add: 'addAttack', remove: 'removeAttack' }),
    traits: Object.freeze({ card: '[data-trait-row]', field: 'setTraitField', add: 'addTrait', remove: 'removeTrait' }),
    loot: Object.freeze({ card: '[data-loot-card]', field: 'setLootField', add: 'addLoot', remove: 'removeLoot' })
  }),
  /** The embedded documents: one card per item (its Rank select and its quantity box), picked through a catalog manager. */
  items: Object.freeze({
    card: '[data-item-card]',
    rank: 'setItemRank',
    quantity: 'setItemQuantity',
    heldCard: '[data-held-loot]',
    pickers: PICKERS
  }),
  /** The picker that adds a document of this creation data (a weapon has its own button; other gear and loot share one). */
  pickerFor(data) {
    const isWeapon = Boolean(data?.system?.isWeapon);
    return Object.entries(PICKERS).find(([, p]) => p.types.includes(data?.type) && (p.weapon === undefined || p.weapon === isWeapon))?.[0] ?? null;
  }
});
