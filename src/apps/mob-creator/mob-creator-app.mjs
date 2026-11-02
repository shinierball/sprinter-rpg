/**
 * Sprinter RPG — Standalone Mob Creator & Boss Balancer Studio (ApplicationV2)
 *
 * Implements pure builder UI architecture for mob drafting and live sheet tuning:
 * - Table 50 Stat Budgeting with permissive over-budget warnings (no hard blocking).
 * - Table 50 Boss Tier scaling (Neighborhood to Dungeon Boss) and dynamic HB slots.
 * - Table 51 Damage Dice recommendations with advancement for bosses.
 * - Live stat block preview in the familiar stat block layout.
 * - Supports both Standalone Creation Mode (draft from scratch) and Rebalance Mode ({ actor }).
 * - Safe from Form Harvester array corruption (no duplicate name paths, uses data-prop).
 */

import { COGToolApp } from '../tool-app.mjs';
import { normalizeBaseDamage } from '../../utils/base-damage.mjs';
import {
  BOSS_TIERS,
  hbSlots,
  recommendedDice,
  statBudget,
  statSpent,
  resolveBossTier
} from '../../data/mob-creation-rules.mjs';
import { getCOGStatModifier } from '../../documents/actor/actor-constants.mjs';
import {
  buildAttackItem,
  MOB_TRAIT_TYPES
} from './build.mjs';
import { buildPayload } from '../../data/builders/item-payload.mjs';
import { debuffIdentifier } from '../../utils/identifier.mjs';
import { describeAttackMechanics } from '../../utils/attack-mechanics.mjs';
import { conditionLabel } from '../../documents/actor/condition-data.mjs';
import { listAreaShapes } from '../../utils/area-geometry.mjs';
import { buildOnHitDebuffPicker } from '../../sheets/item/context-on-hit.mjs';
import { buildPickList } from '../../sheets/item/context-pick-list.mjs';
import { unitOptions } from '../../sheets/item/context-timing.mjs';
import { slugifyIdentifier } from '../../utils/identifier.mjs';
import { COG_TAGS } from '../../data/tags.mjs';
import { COG_DAMAGE_TYPES } from '../../data/buffs.mjs';
import { ABILITIES, choiceOptions } from '../../sheets/item/options.mjs';
import { checkTypeOptions } from '../../data/rules/check-types.mjs';
import { COGTagManager } from '../tag-manager.mjs';
import { SYSTEM_PATH } from '../../constants.mjs';
import { sanitizeSizeId, sizeName, sizeOptions as buildSizeOptions } from '../../data/sizes.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/mob-creator`;

/** A typed tag id: trimmed, lower-cased, spaces to underscores. Dots stay (tags are namespaced, unlike debuff identifiers). */
function normalizeTag(text) {
  return String(text ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).join('_');
}

/**
 * The rider lists the creator's pick-list controls may edit, by the `data-list` key the shared `pick-list.hbs` partial
 * writes on its chips, options and buttons. `row` names the `MOB_CREATOR_FORM.rows` key the list lives in (`null` for the
 * actor level) and `path` is the array inside that row (or inside the authoring state) of the spec.
 */
const PICK_LISTS = Object.freeze({
  onHitDebuffs: Object.freeze({ row: 'attacks', path: 'onHit.debuffs' }),
  evadeFailDebuffs: Object.freeze({ row: 'attacks', path: 'onHit.evadeFail.debuffs' }),
  slotLossDebuffs: Object.freeze({ row: 'attacks', path: 'onHit.slotLoss.debuffs' }),
  actorTags: Object.freeze({ row: null, path: 'tags', normalize: normalizeTag }),
  traitTags: Object.freeze({ row: 'traits', path: 'tags', normalize: normalizeTag })
});

/**
 * The creator's repeating rows and pick lists as data, which its own handlers read their selectors from. `item` is the
 * row element (carrying `data-index`), `field` the attribute whose value names the row's spec path, `add` and `remove`
 * the action names. Tests drive the rendered form from this instead of a hand list.
 */
export const MOB_CREATOR_FORM = Object.freeze({
  state: (app) => app.mobState,
  rows: Object.freeze({
    attacks: Object.freeze({ item: '.attack-builder-item', field: 'data-attack-field', add: 'addAttack', remove: 'removeAttack' }),
    traits: Object.freeze({ item: '.trait-builder-item', field: 'data-trait-field', add: 'addCustomTrait', remove: 'removeTrait' }),
    spells: Object.freeze({ item: '.spell-builder-item', field: 'data-spell-field', add: 'addSpell', remove: 'removeSpell' }),
    loot: Object.freeze({ item: '.loot-builder-item', field: 'data-loot-field', add: 'addLoot', remove: 'removeLoot' })
  }),
  pickLists: PICK_LISTS
});

/** A path inside an attack's `contest` block. Built, not quoted: `contest` is also a tag namespace, and these are spec paths. */
const CONTEST_PATH = (key) => `contest.${key}`;

const nonNegFeet = (raw) => Math.max(0, Math.trunc(Number(raw)) || 0);

/**
 * Attack controls whose raw value needs coercion, keyed by the spec path the control writes. Checkboxes write
 * `target.checked`; any other path is written as the raw string.
 */
export const ATTACK_FIELD_PARSERS = Object.freeze({
  hitDifficulty: (raw) => {
    const n = raw === '' ? null : Number(raw);
    return n === null || !Number.isFinite(n) ? null : Math.max(0, Math.trunc(n));
  },
  rangeFeet: nonNegFeet,
  'area.radius': nonNegFeet,
  'area.lineLength': nonNegFeet,
  'area.lineWidth': nonNegFeet,
  'area.splash': nonNegFeet,
  'cooldown.value': nonNegFeet,
  'onHit.slotLoss.minSlotsLost': (raw) => Math.max(1, Math.trunc(Number(raw)) || 1),
  [CONTEST_PATH('customDC')]: nonNegFeet,
  [CONTEST_PATH('onFailDebuff')]: (raw) => debuffIdentifier(raw)
});

/** Attack fields whose change re-renders the body (the size inputs, the pickers and the Reads-as line follow them). */
const ATTACK_LAYOUT_FIELDS = new Set([
  'hitDifficulty', 'rangeFeet', 'area.shape', 'area.radius', 'area.lineLength', 'area.lineWidth', 'area.splash',
  'cooldown.value', 'cooldown.unit', 'onHit.evadeFail.degree', 'onHit.slotLoss.minSlotsLost', 'onHit.debuffMode',
  'onHit.evadeFail.mode', 'onHit.slotLoss.mode', ...['hasContest', 'targetStat', 'customDC', 'onFailDebuff'].map(CONTEST_PATH)
]);

/** The spec fields stored as booleans (written from `target.checked`). */
const isCheckbox = (target) => target?.type === 'checkbox';

/** The list array at `path` inside an attack row, created when missing. */
function listAt(atk, path) {
  const keys = path.split('.');
  const last = keys.pop();
  const holder = keys.reduce((o, k) => (o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}), atk);
  if (!Array.isArray(holder[last])) holder[last] = [];
  return holder[last];
}

/** Layout-affecting fields: committing one of these re-renders the header badges and the active tab. */
const isLayoutProp = (prop) => prop === 'bossTier' || prop === 'level' || prop === 'designFloor' || prop.startsWith('abilities.');

/** Labels of the trait types (`MOB_TRAIT_TYPES`, the builder's own branches). */
const TRAIT_TYPE_LABELS = Object.freeze({
  damageMultiplier: 'Damage Multiplier',
  aura: 'Aura',
  hot: 'Heal-Over-Time',
  resistance: 'Resistance',
  immunity: 'Immunity',
  custom: 'Custom (tags and text)'
});

/** The trait types whose builder branch reads `damageType`, and the one that reads `multiplier`. */
const DAMAGE_TYPE_TRAITS = new Set(['damageMultiplier', 'resistance', 'immunity']);

/** A blank spell row: the values `buildSpellItem` defaults to, so an untouched row builds the default spell. */
const blankSpell = () => ({
  name: '', checkType: 'attack', manaCost: 5, range: '30 feet', rank: 1, stat: 'int', baseDamage: { dice: '', stat: '', damageType: '' }, description: ''
});

/** Spell fields stored as numbers, with the floor and the fallback a blank or non-numeric entry gets. */
const SPELL_NUMBER_FIELDS = Object.freeze({ manaCost: { min: 0, fallback: 5 }, rank: { min: 1, fallback: 1 } });

/** A blank trait row: the generic type, nothing filled in. */
const blankTrait = () => ({ name: '', type: 'custom', damageType: 'Physical', multiplier: 2, description: '', tags: [] });

/** Presets are rows of a builder type (the builder makes the multiply row, the aura tags or the heal-over-time tag); they carry no tags of their own. */
const TRAIT_PRESETS = {
  damage_multiplier: { ...blankTrait(), name: 'Damage Multiplier', type: 'damageMultiplier' },
  aura_buff: { ...blankTrait(), name: 'Aura', type: 'aura', description: 'Aura emanation radiating damage or debuff to adjacent combatants.' },
  hot_buff: { ...blankTrait(), name: 'Heal-Over-Time (Regeneration)', type: 'hot', description: 'Restores HP or health bar at the start of each combat turn.' }
};

export class COGMobCreatorApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-mob-creator',
    classes: ['cog-mob-creator-app'],
    window: { title: 'Sprinter RPG — Mob Creator & Boss Balancer', icon: 'fa-solid fa-skull-crossbones', resizable: true },
    position: { width: 900, height: 780 },
    actions: {
      setTab: COGMobCreatorApp.#onSetTab,
      setProp: COGMobCreatorApp.#onSetProp,
      commitProp: COGMobCreatorApp.#onCommitProp,
      setAttackField: COGMobCreatorApp.#onSetAttackField,
      addPick: COGMobCreatorApp.#onAddPick,
      addCustomPick: COGMobCreatorApp.#onAddCustomPick,
      removePick: COGMobCreatorApp.#onRemovePick,
      addAttack: COGMobCreatorApp.#onAddAttack,
      removeAttack: COGMobCreatorApp.#onRemoveAttack,
      openTagManager: COGMobCreatorApp.#onOpenTagManager,
      addTraitPreset: COGMobCreatorApp.#onAddTraitPreset,
      addCustomTrait: COGMobCreatorApp.#onAddCustomTrait,
      setTraitField: COGMobCreatorApp.#onSetTraitField,
      removeTrait: COGMobCreatorApp.#onRemoveTrait,
      setSpellField: COGMobCreatorApp.#onSetSpellField,
      addSpell: COGMobCreatorApp.#onAddSpell,
      removeSpell: COGMobCreatorApp.#onRemoveSpell,
      setLootField: COGMobCreatorApp.#onSetLootField,
      addLoot: COGMobCreatorApp.#onAddLoot,
      removeLoot: COGMobCreatorApp.#onRemoveLoot,
      createMob: COGMobCreatorApp.#onCreateMob
    }
  };

  // The tabs are `{{#if}}` panes of the `body` part, so a tab switch re-renders `nav` and `body`.
  static PARTS = {
    header: { template: `${TPL}/header.hbs` },
    nav: { template: `${TPL}/nav.hbs` },
    body: { template: `${TPL}/body.hbs`, scrollable: [''] },
    footer: { template: `${TPL}/footer.hbs` }
  };

  constructor(options = {}) {
    super(options);

    this.activeTab = options.activeTab || 'identity';
    this.mobState = this._createInitialState(options);
  }

  /**
   * Mob Creator is strictly Create-Only (Decision D6-A).
   * @type {boolean}
   */
  get isTuning() {
    return false;
  }

  /**
   * Generates initial authoring state for Mob creation.
   * Strictly Create-Only architecture (D6-A).
   * @param {object} [options={}]
   * @returns {object}
   * @protected
   */
  _createInitialState(options = {}) {
    return {
      name: options.name || 'New Mob',
      level: options.level || 1,
      designFloor: options.designFloor || 1,
      bossTier: options.bossTier || 'none',
      isUnique: Boolean(options.isUnique),
      isSummoned: Boolean(options.isSummoned),
      isMinion: Boolean(options.isMinion),
      tags: Array.isArray(options.tags) ? [...options.tags] : [],
      size: sanitizeSizeId(options.size) || 'tiny',
      creatureType: options.creatureType || 'Beastly',
      abilities: {
        str: options.abilities?.str || 1,
        dex: options.abilities?.dex || 1,
        con: options.abilities?.con || 1,
        int: options.abilities?.int || 1,
        cha: options.abilities?.cha || 1
      },
      bars: options.bars ?? null,
      evadeBase: options.evadeBase ?? null,
      surpriseBase: options.surpriseBase ?? null,
      dr: options.dr || 0,
      move: options.move || 20,
      step: options.step || 10,
      description: options.description || '',
      aiDescription: options.aiDescription || '',
      notes: options.notes || '',
      attacks: options.attacks ? options.attacks.map((a) => this._attackState(a)) : [this._defaultAttack()],
      traits: options.traits || [],
      spells: options.spells || [],
      loot: options.loot || [this._defaultLoot()]
    };
  }

  _defaultAttack() {
    return {
      name: 'Bite',
      toHitStat: 'dex',
      damageDice: '1d6',
      damageStat: 'str',
      damageType: 'Physical',
      hitDifficulty: null,
      rangeFeet: 0,
      area: { shape: '', radius: 0, lineLength: 0, lineWidth: 5, splash: 0 },
      cooldown: { value: 0, unit: '' },
      ignoreDR: false,
      onHit: {
        debuffs: [],
        debuffMode: 'all',
        evadeFail: { degree: 'major_fail', debuffs: [], mode: 'all' },
        slotLoss: { minSlotsLost: 1, debuffs: [], mode: 'all' }
      },
      contest: { hasContest: false, targetStat: 'dex', customDC: 0, onFailDebuff: '' },
      effects: ''
    };
  }

  /** A creator attack row: the given spec filled out with the defaults, so every control has a place to write. */
  _attackState(spec = {}) {
    const def = this._defaultAttack();
    const obj = (v) => (v && typeof v === 'object' ? v : {});
    const onHit = obj(spec.onHit);
    const ids = (list) => (Array.isArray(list) ? list.map(debuffIdentifier).filter(Boolean) : []);
    return {
      ...def,
      ...spec,
      area: { ...def.area, ...obj(spec.area) },
      cooldown: { ...def.cooldown, ...obj(spec.cooldown) },
      contest: { ...def.contest, ...obj(spec.contest), onFailDebuff: debuffIdentifier(obj(spec.contest).onFailDebuff) },
      onHit: {
        ...def.onHit,
        ...onHit,
        debuffs: ids(onHit.debuffs),
        evadeFail: { ...def.onHit.evadeFail, ...obj(onHit.evadeFail), debuffs: ids(obj(onHit.evadeFail).debuffs) },
        slotLoss: { ...def.onHit.slotLoss, ...obj(onHit.slotLoss), debuffs: ids(obj(onHit.slotLoss).debuffs) }
      }
    };
  }

  /**
   * The per-row view of an attack: shape and cooldown selects, the three rider pickers and the Reads-as line.
   * Computed from a copy, so nothing here leaks into the authoring state the builder compiles.
   * @protected
   */
  _attackRowView(atk, { availableDebuffs, evadeDC, mobLevel, isBoss, defaultFloor }) {
    const shapes = listAreaShapes();
    const shapeId = String(atk.area?.shape ?? '');
    const active = shapes.find((sh) => sh.id === shapeId);
    const onHit = atk.onHit ?? {};
    const built = buildAttackItem(atk, { mobLevel, isBoss, defaultFloor });
    return {
      hitPlaceholder: evadeDC,
      shapeOptions: [
        { value: '', label: 'None (Single Target)', selected: !active },
        ...shapes.map((sh) => ({ value: sh.id, label: sh.label, selected: sh.id === shapeId }))
      ],
      hasShape: Boolean(active),
      showRadius: Boolean(active) && active.size !== 'length',
      showLength: Boolean(active) && active.size === 'length',
      cooldownUnits: unitOptions('cooldown', String(atk.cooldown?.unit ?? '')),
      riders: buildOnHitDebuffPicker(onHit, availableDebuffs),
      readsAs: describeAttackMechanics(built.system, { labelOf: conditionLabel }).text
    };
  }

  _defaultLoot() {
    return {
      name: 'Monster Remains',
      quantity: 1,
      notes: 'Crafting material or trophy'
    };
  }

  /**
   * Prepare template data with precomputed options, stat modifiers, and Table 50/51 budgets.
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);
    const isBoss = Boolean(this.mobState.bossTier && this.mobState.bossTier !== 'none');
    const tierInfo = isBoss ? resolveBossTier(this.mobState.bossTier) : null;

    // Stat budget calculations
    const budget = statBudget({ level: this.mobState.level, bossTier: this.mobState.bossTier });
    const spent = statSpent(this.mobState.abilities, budget.base);
    const remaining = budget.points - spent;
    const overBudget = spent > budget.points;

    // Ability modifiers formatted
    const statMods = {};
    for (const [k, v] of Object.entries(this.mobState.abilities)) {
      const m = getCOGStatModifier(v);
      statMods[k] = m >= 0 ? `+${m}` : `${m}`;
    }

    // Defenses & Health Bars
    const conMod = Math.max(1, getCOGStatModifier(this.mobState.abilities.con));
    const hbSlotsBase = hbSlots({
      level: this.mobState.level,
      bossTier: this.mobState.bossTier,
      floor: this.mobState.designFloor
    });
    const effectiveBars = (this.mobState.bars !== null && this.mobState.bars !== undefined && this.mobState.bars !== '')
      ? Number(this.mobState.bars)
      : hbSlotsBase;
    const maxHp = effectiveBars * conMod;

    const defaultEvadeBase = 10 + getCOGStatModifier(this.mobState.abilities.dex);
    const defaultSurpriseBase = 10 + getCOGStatModifier(this.mobState.abilities.int);
    const evadeBaseVal = (this.mobState.evadeBase !== null && this.mobState.evadeBase !== undefined && this.mobState.evadeBase !== '')
      ? Number(this.mobState.evadeBase)
      : defaultEvadeBase;
    const surpriseBaseVal = (this.mobState.surpriseBase !== null && this.mobState.surpriseBase !== undefined && this.mobState.surpriseBase !== '')
      ? Number(this.mobState.surpriseBase)
      : defaultSurpriseBase;

    const effectiveEvadeDC = `${evadeBaseVal}+F`;
    const effectiveSurpriseDC = `${surpriseBaseVal}+F`;

    // Table 51 recommendation
    const recommendedDiceCount = recommendedDice({
      level: this.mobState.level,
      isBoss,
      area: false,
      rider: false
    });

    // Options dropdowns with precalculated selected booleans
    const bossTierRegistry = CONFIG.COG?.bossTiers || BOSS_TIERS;
    const bossTierOptions = [
      { value: 'none', label: 'None (Regular Mob)', selected: this.mobState.bossTier === 'none' }
    ];
    for (const [tKey, tDef] of Object.entries(bossTierRegistry)) {
      bossTierOptions.push({
        value: tKey,
        label: `${tDef.label} (Base 5, +${tDef.statsPerLevel} pts/lvl, ${tDef.hbBase}+F Bars)`,
        selected: this.mobState.bossTier === tKey
      });
    }

    const sizeOptions = buildSizeOptions(this.mobState.size || 'tiny');

    // Damage type options (Physical + 13 canonical damage types)
    const damageTypeOptions = [
      { value: 'Physical', label: 'Physical' },
      ...COG_DAMAGE_TYPES.map(dt => ({ value: dt, label: dt }))
    ];

    // Actor tags: every registered tag, labelled; a custom entry covers the rest.
    const tagEntries = COG_TAGS.map((t) => ({ value: t.id, label: `${t.label} (${t.id})` })).sort((a, b) => a.label.localeCompare(b.label));
    const actorTagsPicker = buildPickList({
      label: 'Actor Tags',
      icon: 'fa-tags',
      emptyText: 'No extra tags. Boss tier, unique, summoned and minion add their own.',
      choose: 'Add a registered tag...',
      placeholder: 'Custom tag id, e.g. creature.rat_kin',
      inputId: `${context.rootId}-actor-tags-custom`,
      lists: [{ list: 'actorTags', stored: this.mobState.tags, entries: tagEntries, customLabel: 'Add Tag' }]
    });

    // Canonical condition tags sorted alphabetically by label
    const conditionTags = COG_TAGS.filter(t => t.namespace === 'condition');
    const conditionOptions = conditionTags.map(t => ({
      value: t.id,
      identifier: debuffIdentifier(t.id),
      label: `${t.label} (${t.id})`
    })).sort((a, b) => a.label.localeCompare(b.label));

    // Per-row views (pickers, selects, Reads-as); the authoring state itself is left untouched.
    const attackRows = (this.mobState.attacks || []).map((atk) => ({
      ...atk,
      view: this._attackRowView(atk, {
        availableDebuffs: conditionTags.map((t) => ({ id: t.id, name: t.label, system: { identifier: debuffIdentifier(t.id) } })),
        evadeDC: effectiveEvadeDC,
        mobLevel: Math.max(1, Number(this.mobState.level) || 1),
        isBoss,
        defaultFloor: Number(this.mobState.designFloor) || 1
      })
    }));

    const traitRows = (this.mobState.traits || []).map((tr, i) => ({
      ...tr,
      view: {
        typeOptions: MOB_TRAIT_TYPES.map((value) => ({ value, label: TRAIT_TYPE_LABELS[value] ?? value, selected: tr.type === value })),
        showDamageType: DAMAGE_TYPE_TRAITS.has(tr.type),
        showMultiplier: tr.type === 'damageMultiplier',
        showTags: tr.type === 'custom',
        damageTypeOptions: damageTypeOptions.map((o) => ({ ...o, selected: (tr.damageType || 'Physical') === o.value })),
        multiplier: tr.multiplier ?? 2,
        tagsPicker: buildPickList({
          label: 'Tags',
          icon: 'fa-tags',
          emptyText: 'No tags.',
          choose: 'Add a registered tag...',
          placeholder: 'Custom tag id, e.g. element.fire',
          inputId: `${context.rootId}-trait-${i}-tags-custom`,
          lists: [{ list: 'traitTags', stored: tr.tags, entries: tagEntries, customLabel: 'Add Tag' }]
        })
      }
    }));

    const spellRows = (this.mobState.spells || []).map((sp) => {
      const base = normalizeBaseDamage(sp.baseDamage);
      return {
        ...sp,
        baseDamage: base,
        view: {
          checkTypeOptions: checkTypeOptions(sp.checkType),
          statOptions: Object.entries(ABILITIES).map(([value, label]) => ({ value, label, selected: String(sp.stat).toLowerCase() === value })),
          baseStatOptions: [
            { value: '', label: 'Spell stat' },
            ...Object.entries(ABILITIES).map(([value, label]) => ({ value, label })),
            { value: 'none', label: 'None' }
          ].map((o) => ({ ...o, selected: o.value === base.stat })),
          damageTypeOptions: [{ value: '', label: 'None', selected: !base.damageType }, ...choiceOptions(COG_DAMAGE_TYPES, base.damageType).map((o) => ({ ...o, selected: o.selected && !!base.damageType }))]
        }
      };
    });

    return Object.assign(context, {
      traitRows,
      spellRows,
      isTuning: false,
      actorName: this.mobState.name,
      activeTab: this.activeTab,
      state: this.mobState,
      attackRows,
      actorTagsPicker,
      mobState: this.mobState,
      isBoss,
      tierInfo,
      budget,
      spent,
      remaining,
      overBudget,
      statMods,
      conMod,
      hbSlotsBase,
      effectiveBars,
      maxHp,
      defaultEvadeBase,
      defaultSurpriseBase,
      evadeBaseVal,
      surpriseBaseVal,
      effectiveEvadeDC,
      effectiveSurpriseDC,
      recommendedDiceCount,
      bossTierOptions,
      sizeOptions,
      sizeName: sizeName(this.mobState.size || 'tiny'),
      damageTypeOptions,
      conditionOptions
    });
  }

  /** Index of the repeating row (`data-index`) that holds a control. */
  static #rowIndex(target, selector) {
    return Number(target.closest(selector)?.getAttribute('data-index'));
  }

  /** Write a `data-prop` control into the authoring state. */
  #writeProp(target) {
    const prop = target.getAttribute('data-prop');
    if (!prop) return null;

    let val = target.value;
    if (target.type === 'checkbox') {
      val = target.checked;
    } else if (target.type === 'number') {
      val = val === '' ? null : Number(val);
    }

    foundry.utils.setProperty(this.mobState, prop, val);
    return { prop, val };
  }

  static async #onSetTab(event, target) {
    const tab = target.dataset.tab;
    if (!tab) return;
    this.activeTab = tab;
    await this.render({ parts: ['nav', 'body'] });
  }

  /** Typing: keep state current without replacing the input under the caret. */
  static #onSetProp(event, target) {
    this.#writeProp(target);
  }

  /** Commit (change/blur/select): fields that alter formulas or layout re-render the header and active tab. */
  static async #onCommitProp(event, target) {
    const written = this.#writeProp(target);
    if (!written || !isLayoutProp(written.prop)) return;

    // Switching to a boss tier moves untouched base stats from 1 to 5 (and back).
    if (written.prop === 'bossTier') {
      const isBoss = written.val && written.val !== 'none';
      const targetBase = isBoss ? 5 : 1;
      for (const k of ['str', 'dex', 'con', 'int', 'cha']) {
        if (this.mobState.abilities[k] === 1 && targetBase === 5) {
          this.mobState.abilities[k] = 5;
        } else if (this.mobState.abilities[k] === 5 && targetBase === 1) {
          this.mobState.abilities[k] = 1;
        }
      }
    }
    await this.render({ parts: ['header', 'body'] });
  }

  static async #onSetAttackField(event, target) {
    const field = target.getAttribute(MOB_CREATOR_FORM.rows.attacks.field);
    const atk = this.mobState.attacks[COGMobCreatorApp.#rowIndex(target, MOB_CREATOR_FORM.rows.attacks.item)];
    if (!field || !atk) return;

    atk.area = atk.area || {};
    atk.cooldown = atk.cooldown || {};
    atk.onHit = atk.onHit || {};
    atk.onHit.evadeFail = atk.onHit.evadeFail || {};
    atk.onHit.slotLoss = atk.onHit.slotLoss || {};
    if (field.startsWith(CONTEST_PATH(''))) {
      atk.contest = atk.contest || { hasContest: false, targetStat: 'dex', customDC: 0, onFailDebuff: '' };
    }

    const parse = Object.hasOwn(ATTACK_FIELD_PARSERS, field) ? ATTACK_FIELD_PARSERS[field] : null;
    const value = isCheckbox(target) ? target.checked : parse ? parse(target.value) : target.value;
    foundry.utils.setProperty(atk, field, value);

    // A committed structural edit refreshes the size inputs, the pickers and the Reads-as line (typing never does).
    if (event?.type === 'change' && ATTACK_LAYOUT_FIELDS.has(field)) await this.render({ parts: ['body'] });
  }

  /** The holder (a row, or the actor-level state when `row` is null) and `PICK_LISTS` entry a pick-list control belongs to. */
  static #pickTarget(app, target, key) {
    const def = Object.hasOwn(PICK_LISTS, String(key ?? '')) ? PICK_LISTS[key] : null;
    if (!def) return null;
    if (def.row === null) return { atk: app.mobState, def };
    const form = MOB_CREATOR_FORM.rows[def.row];
    const atk = app.mobState[def.row]?.[COGMobCreatorApp.#rowIndex(target, form.item)];
    return atk ? { atk, def } : null;
  }

  /** Append `value` to a row's list unless it is already there (case-insensitive). */
  static #addRef(list, value) {
    const clean = String(value ?? '').trim();
    if (!clean || list.some((v) => String(v).toLowerCase() === clean.toLowerCase())) return false;
    list.push(clean);
    return true;
  }

  /** Change action on a rider list's unnamed Add select; the chosen option's `data-list` names the list. */
  static async #onAddPick(event, target) {
    const option = target?.selectedOptions?.[0] ?? [...(target?.querySelectorAll?.('option') ?? [])].find((o) => o.selected);
    const hit = COGMobCreatorApp.#pickTarget(this, target, option?.dataset?.list);
    if (!hit || !COGMobCreatorApp.#addRef(listAt(hit.atk, hit.def.path), option?.value)) return;
    await this.render({ parts: ['body'] });
  }

  /** Button (`data-list`) next to the unnamed text input inside `[data-custom-entry]`. */
  static async #onAddCustomPick(event, target) {
    const hit = COGMobCreatorApp.#pickTarget(this, target, target?.dataset?.list);
    const input = target?.closest?.('[data-custom-entry]')?.querySelector('input');
    if (!hit || !input) return;
    if (!COGMobCreatorApp.#addRef(listAt(hit.atk, hit.def.path), (hit.def.normalize ?? slugifyIdentifier)(input.value))) return;
    input.value = '';
    await this.render({ parts: ['body'] });
  }

  /** The chip's remove link (`data-list`, `data-value`). */
  static async #onRemovePick(event, target) {
    const hit = COGMobCreatorApp.#pickTarget(this, target, target?.dataset?.list);
    if (!hit) return;
    const needle = String(target.dataset.value ?? '').trim().toLowerCase();
    const list = listAt(hit.atk, hit.def.path);
    const kept = list.filter((v) => String(v).toLowerCase() !== needle);
    list.splice(0, list.length, ...kept);
    await this.render({ parts: ['body'] });
  }

  static async #onAddAttack() {
    this.mobState.attacks.push(this._defaultAttack());
    await this.render({ parts: ['nav', 'body'] });
  }

  static async #onRemoveAttack(event, target) {
    const idx = Number(target.dataset.index);
    if (isNaN(idx) || idx < 0 || idx >= this.mobState.attacks.length) return;
    this.mobState.attacks.splice(idx, 1);
    await this.render({ parts: ['nav', 'body'] });
  }

  /** Open the Tag Manager to explore canonical conditions and custom tags. */
  static async #onOpenTagManager() {
    await COGTagManager.open();
  }

  static async #onAddTraitPreset() {
    const presetId = this.element?.querySelector?.('.trait-preset-select')?.value;
    this.mobState.traits.push(structuredClone(TRAIT_PRESETS[presetId] ?? blankTrait()));
    await this.render({ parts: ['nav', 'body'] });
  }

  static async #onAddCustomTrait() {
    this.mobState.traits.push(blankTrait());
    await this.render({ parts: ['nav', 'body'] });
  }

  /** The trait row's control writes the spec field it is named for; a type change re-renders (its controls differ). */
  static async #onSetTraitField(event, target) {
    const field = target.getAttribute(MOB_CREATOR_FORM.rows.traits.field);
    const tr = this.mobState.traits[COGMobCreatorApp.#rowIndex(target, MOB_CREATOR_FORM.rows.traits.item)];
    if (!field || !tr) return;
    tr[field] = field === 'multiplier' ? (Number.isFinite(Number(target.value)) && target.value !== '' ? Number(target.value) : 2) : target.value;
    if (event?.type === 'change' && field === 'type') await this.render({ parts: ['body'] });
  }

  static async #onRemoveTrait(event, target) {
    const idx = Number(target.dataset.index);
    if (isNaN(idx) || idx < 0 || idx >= this.mobState.traits.length) return;
    this.mobState.traits.splice(idx, 1);
    await this.render({ parts: ['nav', 'body'] });
  }

  /** The spell row's control writes the spec field it is named for; numbers are coerced, never blocked. */
  static #onSetSpellField(event, target) {
    const form = MOB_CREATOR_FORM.rows.spells;
    const field = target.getAttribute(form.field);
    const sp = this.mobState.spells[COGMobCreatorApp.#rowIndex(target, form.item)];
    if (!field || !sp) return;
    const num = SPELL_NUMBER_FIELDS[field];
    if (num) {
      const n = Math.trunc(Number(target.value));
      sp[field] = target.value !== '' && Number.isFinite(n) ? Math.max(num.min, n) : num.fallback;
    } else {
      // `baseDamage.dice`, `.stat` and `.damageType` are paths into the row's structured Base Damage.
      if (field.startsWith('baseDamage.')) sp.baseDamage = normalizeBaseDamage(sp.baseDamage);
      foundry.utils.setProperty(sp, field, target.value);
    }
  }

  static async #onAddSpell() {
    this.mobState.spells.push(blankSpell());
    await this.render({ parts: ['nav', 'body'] });
  }

  static async #onRemoveSpell(event, target) {
    const idx = Number(target.dataset.index);
    if (isNaN(idx) || idx < 0 || idx >= this.mobState.spells.length) return;
    this.mobState.spells.splice(idx, 1);
    await this.render({ parts: ['nav', 'body'] });
  }

  static #onSetLootField(event, target) {
    const field = target.getAttribute(MOB_CREATOR_FORM.rows.loot.field);
    const lt = this.mobState.loot[COGMobCreatorApp.#rowIndex(target, MOB_CREATOR_FORM.rows.loot.item)];
    if (!field || !lt) return;
    if (field === 'quantity') {
      lt.quantity = Math.max(1, Number(target.value) || 1);
    } else {
      lt[field] = target.value;
    }
  }

  static async #onAddLoot() {
    this.mobState.loot.push(this._defaultLoot());
    await this.render({ parts: ['nav', 'body'] });
  }

  static async #onRemoveLoot(event, target) {
    const idx = Number(target.dataset.index);
    if (isNaN(idx) || idx < 0 || idx >= this.mobState.loot.length) return;
    this.mobState.loot.splice(idx, 1);
    await this.render({ parts: ['nav', 'body'] });
  }

  static async #onCreateMob() {
    await this.saveMob();
  }

  /**
   * Compiles the authoring state into an Actor document payload and creates the unlinked actor.
   */
  async createMob() {
    try {
      const warnings = [];
      const payload = buildPayload('mob', this.mobState, { warnings });
      for (const w of warnings) globalThis.ui?.notifications?.warn?.(`${w.path}: ${w.message}`);
      const actor = await Actor.create(payload);
      if (globalThis.ui?.notifications) {
        ui.notifications.info(`Successfully created Mob: ${actor.name}`);
      }
      if (typeof actor.sheet?.render === 'function') {
        actor.sheet.render({ force: true });
      }
      this.close();
      return actor;
    } catch (err) {
      console.error('Failed to create mob actor:', err);
      if (globalThis.ui?.notifications) {
        ui.notifications.error(`Mob creation failed: ${err.message}`);
      }
      throw err;
    }
  }

  /**
   * Create-Only builder: saveMob always creates a new Actor (Decision D6-A).
   */
  async saveMob() {
    return this.createMob();
  }
}
