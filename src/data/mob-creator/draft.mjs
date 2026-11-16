/**
 * The Mob Creator's draft: the authoring spec `buildPayload('mob', spec)` takes, the coercion of every control that writes
 * it, the readouts the stat block shows, the Rule Breaks and Fill to budget. Plain data and functions only (no window, no
 * DOM), so it runs in Node tests and sits below the layering line; the creator window (`src/apps/mob-creator-v2/`) holds
 * a draft and shows it.
 */
import { buildPayload } from '../builders/item-payload.mjs';
// The mob payload delegate registers itself when its module loads.
import { buildAttackItem } from '../builders/mob-payload.mjs';
import { getCOGStatModifier } from '../../documents/actor/actor-constants.mjs';
import { resolveHpPerBar } from '../../utils/damage/hp-per-bar.mjs';
import { normalizeBaseDamage } from '../../utils/damage/base-damage.mjs';
import { debuffIdentifier, itemIdentifier } from '../../utils/identifier.mjs';
import { isSameOwnedEntry } from '../../utils/character/owned-entry.mjs';
import { listedSkillEntries, worldSkillResolver } from '../../utils/skill/weapon-skill-options.mjs';
import { sanitizeSizeId } from '../sizes.mjs';
import { LOOT_TYPE_CHOICES } from '../../models/items/loot-model.mjs';
import { tagCatalog } from '../../utils/tag/tag-list.mjs';
import {
  bossTierRegistry,
  defaultEvadeBase,
  defaultSurpriseBase,
  hbSlots,
  mobRuleBreakReasons,
  recommendedDice,
  resolveBossTier,
  skillStartRank,
  slotPercentages,
  statBudget,
  statSpent,
  mobTotalDr
} from '../mob-creation-rules.mjs';

/** The five stats, in the order the creator lists them. */
export const MOB_STATS = Object.freeze(['str', 'dex', 'con', 'int', 'cha']);

/** The die sizes an attack's dice can be (the count and the size are two selects; a formula is edited on the attack's sheet). */
export const ATTACK_DIE_SIZES = Object.freeze(['d4', 'd6', 'd8', 'd10', 'd12', 'd20']);

/** The stat a Damage Stat select may also be: no stat at all. */
const NO_STAT = 'none';

/** The stage a Rule Break shows on: the only rule the creator enforces is the stat budget (Question 2 a). */
const RULE_BREAK_STAGE = 'stats';

/** The highest Floor of Table 51. */
const MAX_FLOOR = 18;

/** The stat base of a regular mob and of a boss (Table 50). */
const MOB_STAT_BASE = 1;
const BOSS_STAT_BASE = 5;

/**
 * Fill to budget: the stats one spare point goes to in turn, by the focus the GM picks. The same focus gives the same
 * result every time; no randomness (Question 10 a).
 */
export const FILL_FOCUSES = Object.freeze({
  even: Object.freeze(['str', 'dex', 'con', 'int', 'cha']),
  physical: Object.freeze(['str', 'str', 'con', 'dex']),
  agile: Object.freeze(['dex', 'dex', 'str', 'con']),
  caster: Object.freeze(['int', 'int', 'cha', 'con'])
});

const asInt = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const atLeast = (min, fallback) => (raw) => {
  const n = asInt(raw);
  return n === null ? fallback : Math.max(min, n);
};
/** An override number: a whole number at or above `min`, or null (= use the formula). */
const optionalInt = (min) => (raw) => {
  const n = asInt(raw);
  return n === null ? null : Math.max(min, n);
};
/** A list from stored data: the array, or the fallback when it is anything else. */
const listOf = (raw, fallback = []) => (Array.isArray(raw) ? raw : fallback);
const text = (raw) => String(raw ?? '');
const flag = (raw) => raw === true || raw === 'true';

/** The controls a draft takes, by spec path: the coercion each value goes through. Anything else is refused. */
const FIELDS = Object.freeze({
  name: text,
  creatureType: text,
  level: atLeast(1, 1),
  designFloor: (raw) => Math.min(MAX_FLOOR, atLeast(1, 1)(raw)),
  size: (raw) => sanitizeSizeId(raw) || 'tiny',
  isUnique: flag,
  isSummoned: flag,
  isMinion: flag,
  bars: optionalInt(1),
  evadeBase: optionalInt(0),
  surpriseBase: optionalInt(0),
  dr: atLeast(0, 0),
  move: atLeast(0, 0),
  step: atLeast(0, 0),
  mana: atLeast(0, 0),
  description: text,
  aiDescription: text,
  notes: text,
  ...Object.fromEntries(MOB_STATS.map((k) => [`abilities.${k}`, atLeast(1, 1)]))
});

/**
 * A blank attack row. `dice` stays null until the GM sets a count: the builder then takes Table 51's recommendation for the
 * mob's level and tier, less one for an area and one for a rider, so the count follows them.
 */
const defaultAttack = (name = '') => ({
  name,
  toHitStat: 'dex',
  dice: null,
  die: 'd6',
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
});

/** One of `allowed`, else `fallback`. */
const oneOf = (allowed, fallback) => (raw) => (allowed.includes(String(raw)) ? String(raw) : fallback);
const ON_HIT_MODES = Object.freeze(['all', 'pickOne']);

/** The controls of an attack row, by path inside the row: the coercion each value goes through. Anything else is refused. */
const ATTACK_FIELDS = Object.freeze({
  name: text,
  toHitStat: oneOf(MOB_STATS, 'dex'),
  dice: optionalInt(1),
  die: oneOf(ATTACK_DIE_SIZES, 'd6'),
  damageStat: oneOf([...MOB_STATS, NO_STAT], 'str'),
  damageType: text,
  hitDifficulty: optionalInt(0),
  rangeFeet: atLeast(0, 0),
  'area.shape': text,
  'area.radius': atLeast(0, 0),
  'area.lineLength': atLeast(0, 0),
  'area.lineWidth': atLeast(0, 0),
  'area.splash': atLeast(0, 0),
  'cooldown.value': atLeast(0, 0),
  'cooldown.unit': text,
  ignoreDR: flag,
  'onHit.debuffMode': oneOf(ON_HIT_MODES, 'all'),
  'onHit.evadeFail.degree': text,
  'onHit.evadeFail.mode': oneOf(ON_HIT_MODES, 'all'),
  'onHit.slotLoss.minSlotsLost': atLeast(1, 1),
  'onHit.slotLoss.mode': oneOf(ON_HIT_MODES, 'all'),
  'contest.hasContest': flag,
  'contest.targetStat': oneOf(MOB_STATS, 'dex'),
  'contest.customDC': atLeast(0, 0),
  'contest.onFailDebuff': (raw) => debuffIdentifier(raw),
  effects: text
});

/** The rider lists of an attack row a debuff reference can be added to, by the key the pick list uses. */
export const ATTACK_RIDER_LISTS = Object.freeze({
  onHitDebuffs: 'onHit.debuffs',
  evadeFailDebuffs: 'onHit.evadeFail.debuffs',
  slotLossDebuffs: 'onHit.slotLoss.debuffs'
});

/** The quick defensive traits a mob can be given as typed rows: no description, the builder makes the buff from the row. */
export const QUICK_TRAIT_TYPES = Object.freeze(['damageMultiplier', 'resistance', 'immunity']);

/** The name a new quick trait row starts with (human text the GM can change). */
const QUICK_TRAIT_NAMES = Object.freeze({ damageMultiplier: 'Damage Multiplier', resistance: 'Resistance', immunity: 'Immunity' });

/** A blank quick trait row. */
const defaultTrait = (type) => ({ name: QUICK_TRAIT_NAMES[type], type, damageType: 'Physical', multiplier: 2, tags: [] });

/** The controls of a quick trait row, by key: the coercion each value goes through. */
const TRAIT_FIELDS = Object.freeze({
  name: text,
  damageType: text,
  multiplier: (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 2;
  }
});

/** The embedded item types a picked or dropped document may be (everything else is refused). */
const PICKABLE_TYPES = Object.freeze(['spell', 'buff', 'debuff', 'skill', 'gear', 'loot', 'attack']);

/** The item at `path` ('a.b') inside `obj`, and the key to write. */
function holderOf(obj, path) {
  const keys = path.split('.');
  const last = keys.pop();
  return { holder: keys.reduce((o, k) => o[k], obj), last };
}

/** The controls of a typed trophy row, by key: the coercion each value goes through. Anything else is refused. */
const LOOT_FIELDS = Object.freeze({
  name: text,
  quantity: atLeast(0, 1),
  lootType: (raw) => (LOOT_TYPE_CHOICES.some((c) => c.value === String(raw)) ? String(raw) : null),
  value: atLeast(0, 0),
  description: text
});

/** The creature tags that name the sex of a crawler, not a kind of creature. */
const SEX_TAGS = Object.freeze(['creature.male', 'creature.female', 'creature.nonbinary', 'creature.sex_other']);

/** The value of the creature type select that means "no tag; the type is typed text". */
export const OTHER_CREATURE_TYPE = 'other';

/**
 * The registered `creature.*` tags that name a kind of creature, for the creature type select.
 * @returns {Array<{ id: string, label: string }>}
 */
export function creatureTypeOptions() {
  return tagCatalog()
    .filter((t) => t.namespace === 'creature' && !SEX_TAGS.includes(t.id))
    .map((t) => ({ id: t.id, label: t.label }));
}

const defaultLoot = () => ({ name: 'Monster Remains', quantity: 1, notes: 'Crafting material or trophy' });

const isBossTier = (tier) => Boolean(tier && tier !== 'none');
const statBase = (tier) => (isBossTier(tier) ? BOSS_STAT_BASE : MOB_STAT_BASE);
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

export class MobDraft {
  /**
   * @param {object} [options] starting values for the spec (a blank draft is a Level 1 Tiny mob on Floor 1)
   */
  constructor(options = {}) {
    const tier = isBossTier(options.bossTier) ? String(options.bossTier) : 'none';
    const base = statBase(tier);
    this.spec = {
      name: options.name || 'New Mob',
      level: Math.max(1, asInt(options.level) ?? 1),
      designFloor: Math.min(MAX_FLOOR, Math.max(1, asInt(options.designFloor) ?? 1)),
      bossTier: tier,
      isUnique: Boolean(options.isUnique),
      isSummoned: Boolean(options.isSummoned),
      isMinion: Boolean(options.isMinion),
      tags: listOf(options.tags).map(String),
      size: sanitizeSizeId(options.size) || 'tiny',
      creatureType: options.creatureType ?? 'Beastly',
      abilities: Object.fromEntries(MOB_STATS.map((k) => [k, Math.max(1, asInt(options.abilities?.[k]) ?? base)])),
      bars: optionalInt(1)(options.bars),
      evadeBase: optionalInt(0)(options.evadeBase),
      surpriseBase: optionalInt(0)(options.surpriseBase),
      dr: Math.max(0, asInt(options.dr) ?? 0),
      move: Math.max(0, asInt(options.move) ?? 20),
      step: Math.max(0, asInt(options.step) ?? 10),
      mana: Math.max(0, asInt(options.mana) ?? 0),
      description: options.description ?? '',
      aiDescription: options.aiDescription ?? '',
      notes: options.notes ?? '',
      attacks: listOf(options.attacks, [defaultAttack('Bite')]),
      traits: listOf(options.traits),
      spells: listOf(options.spells),
      items: listOf(options.items),
      loot: listOf(options.loot, [defaultLoot()])
    };
    /** Skills whose Rank still follows the mob's Floor and tier (the GM has not set it). */
    this.followRank = new WeakSet();
    /** A Skill added with a weapon, to the weapon item that brought it. */
    this.broughtBy = new WeakMap();
  }

  /** Whether the draft is a boss (a boss tier is picked). */
  get isBoss() {
    return isBossTier(this.spec.bossTier);
  }

  /** The stat every stat starts at (and is budgeted from): 1 for a mob, 5 for a boss. */
  get statBase() {
    return statBase(this.spec.bossTier);
  }

  /**
   * Write one control. The value is coerced by the control's path; a path the creator has no control for is refused.
   * Picking a boss tier moves every stat still at the old base to the new base (Table 50).
   * @param {string} path a key of the spec (`level`, `abilities.str`)
   * @param {*} value
   * @returns {boolean} whether the draft took it
   */
  set(path, value) {
    if (path === 'bossTier') return this.setBossTier(value);
    if (!Object.hasOwn(FIELDS, path)) return false;
    const coerced = FIELDS[path](value);
    const { holder, last } = holderOf(this.spec, path);
    holder[last] = coerced;
    if (path === 'designFloor') this.#followRanks();
    return true;
  }

  /** Pick the boss tier ('none' for a regular mob; an id the registry lacks is refused). */
  setBossTier(raw) {
    const id = String(raw ?? 'none');
    if (id !== 'none' && !Object.hasOwn(bossTierRegistry(), id)) return false;
    const from = this.statBase;
    this.spec.bossTier = id;
    const to = this.statBase;
    if (from !== to) {
      for (const k of MOB_STATS) if (this.spec.abilities[k] === from) this.spec.abilities[k] = to;
    }
    this.#followRanks();
    return true;
  }

  /** The Rank a Skill starts at on this mob (its Floor, or the boss tier's place; see `skillStartRank`). */
  get skillStartRank() {
    return skillStartRank({ floor: this.spec.designFloor, bossTier: this.isBoss ? this.spec.bossTier : null });
  }

  /** Move every Skill whose Rank the GM has not set to the starting Rank of the mob as it is now. */
  #followRanks() {
    const rank = this.skillStartRank;
    for (const item of this.spec.items) if (this.followRank.has(item)) item.system.rank = rank;
  }

  /** Move a number by `delta` (the steppers); the same coercion as `set`. */
  adjust(path, delta) {
    const current = path.startsWith('abilities.') ? this.spec.abilities[path.slice('abilities.'.length)] : this.spec[path];
    return this.set(path, (Number(current) || 0) + (Number(delta) || 0));
  }

  /** Add a tag id to the actor's tags (once); a blank one is refused. */
  addTag(raw) {
    const id = String(raw ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).join('_');
    if (!id || this.spec.tags.includes(id)) return false;
    this.spec.tags.push(id);
    return true;
  }

  removeTag(raw) {
    const needle = String(raw ?? '').trim().toLowerCase();
    const at = this.spec.tags.findIndex((t) => t.toLowerCase() === needle);
    if (at < 0) return false;
    this.spec.tags.splice(at, 1);
    return true;
  }

  /** The `creature.*` tag of the mob's type, or '' when it has none (the type is typed text). */
  get creatureTypeTag() {
    const ids = creatureTypeOptions().map((o) => o.id);
    return this.spec.tags.find((t) => ids.includes(t.toLowerCase())) ?? '';
  }

  /**
   * Choose the creature type: a registered `creature.*` tag (it replaces any type tag the mob has and its name becomes the
   * shown type) or `other` (no tag; the text a GM typed stays, a name the select set is cleared).
   * @param {string} raw a tag id or `other`
   * @returns {boolean} whether the draft took it
   */
  setCreatureType(raw) {
    const id = String(raw ?? '').trim().toLowerCase();
    const options = creatureTypeOptions();
    const chosen = options.find((o) => o.id === id);
    if (!chosen && id !== OTHER_CREATURE_TYPE) return false;
    const ids = options.map((o) => o.id);
    const current = options.find((o) => o.id === this.creatureTypeTag.toLowerCase());
    this.spec.tags = this.spec.tags.filter((t) => !ids.includes(t.toLowerCase()));
    if (chosen) {
      this.spec.tags.push(chosen.id);
      this.spec.creatureType = chosen.label;
    } else if (current && this.spec.creatureType === current.label) {
      this.spec.creatureType = '';
    }
    return true;
  }

  /** An attack row as the builder compiles it: the Attack item's creation data, the dice count included. */
  builtAttack(index, overrides = {}) {
    const row = this.spec.attacks[Number(index)];
    if (!row) return null;
    return buildAttackItem({ ...row, ...overrides }, { mobLevel: this.spec.level, isBoss: this.isBoss, defaultFloor: this.spec.designFloor });
  }

  /**
   * The dice an attack rolls: the count and size as compiled, Table 51's recommended count for this attack (less one for an
   * area and one for a rider), and whether the GM has set the count.
   * @returns {{ count: number, size: string, recommended: number, custom: boolean }|null}
   */
  attackDice(index) {
    const built = this.builtAttack(index);
    if (!built) return null;
    const count = (dice) => Number.parseInt(dice, 10) || 1;
    const recommended = count(this.builtAttack(index, { dice: null }).system.baseDamage.dice);
    return { count: count(built.system.baseDamage.dice), size: this.spec.attacks[Number(index)].die, recommended, custom: this.spec.attacks[Number(index)].dice !== null };
  }

  /** Add a blank attack row; returns its index. */
  addAttack() {
    this.spec.attacks.push(defaultAttack());
    return this.spec.attacks.length - 1;
  }

  removeAttack(index) {
    return this.#removeAt(this.spec.attacks, index);
  }

  /** Move an attack row up (-1) or down (+1) the list. */
  moveAttack(index, step) {
    const at = Number(index);
    const to = at + Math.sign(Number(step) || 0);
    const list = this.spec.attacks;
    if (!list[at] || !list[to]) return false;
    [list[at], list[to]] = [list[to], list[at]];
    return true;
  }

  /**
   * Write one control of an attack row by its path inside the row (`dice`, `area.shape`, `contest.hasContest`); the value is
   * coerced by the control. A path with no control is refused.
   */
  setAttack(index, path, value) {
    const row = this.spec.attacks[Number(index)];
    if (!row || !Object.hasOwn(ATTACK_FIELDS, path)) return false;
    const { holder, last } = holderOf(row, path);
    holder[last] = ATTACK_FIELDS[path](value);
    return true;
  }

  /** Add a debuff identifier to one of an attack's rider lists (`ATTACK_RIDER_LISTS`), once. */
  addRider(index, list, ref) {
    const target = this.#riderList(index, list);
    const id = debuffIdentifier(ref);
    if (!target || !id || target.includes(id)) return false;
    target.push(id);
    return true;
  }

  removeRider(index, list, ref) {
    const target = this.#riderList(index, list);
    const at = target ? target.indexOf(debuffIdentifier(ref)) : -1;
    if (at < 0) return false;
    target.splice(at, 1);
    return true;
  }

  #riderList(index, list) {
    const row = this.spec.attacks[Number(index)];
    if (!row || !Object.hasOwn(ATTACK_RIDER_LISTS, list)) return null;
    const { holder, last } = holderOf(row, ATTACK_RIDER_LISTS[list]);
    if (!Array.isArray(holder[last])) holder[last] = [];
    return holder[last];
  }

  #removeAt(list, index) {
    const at = Number(index);
    if (!Number.isInteger(at) || at < 0 || at >= list.length) return false;
    list.splice(at, 1);
    return true;
  }

  /**
   * Add a picked, dropped or newly made document (creation data) to the mob's embedded items. It is a copy: its `_id` is
   * dropped and its source link flags stay. A document of the same entry (same compendium source, else the same
   * identifier) as one already there is refused. A Skill starts at the mob's starting Rank and follows it until the GM sets
   * one.
   * @param {object} data creation data of an item
   * @returns {{ added: boolean, reason?: 'invalid'|'duplicate', index?: number }}
   */
  addPicked(data) {
    if (!data || typeof data !== 'object' || !PICKABLE_TYPES.includes(data.type)) return { added: false, reason: 'invalid' };
    const copy = structuredClone(data);
    delete copy._id;
    copy.system ??= {};
    if (this.spec.items.some((owned) => owned.type === copy.type && isSameOwnedEntry(owned, copy))) return { added: false, reason: 'duplicate' };
    if (copy.type === 'skill') {
      copy.system.rank = this.skillStartRank;
      this.followRank.add(copy);
    }
    this.spec.items.push(copy);
    return { added: true, index: this.spec.items.length - 1 };
  }

  /** Set an embedded item's quantity (a picked loot or gear item); a value that is not a number is 1. */
  setItemQuantity(index, raw) {
    const item = this.spec.items[Number(index)];
    if (!item || !['loot', 'gear'].includes(item.type)) return false;
    item.system.quantity = atLeast(0, 1)(raw);
    return true;
  }

  /** Add a blank typed trophy. */
  addLoot() {
    this.spec.loot.push({ name: '', quantity: 1, lootType: 'crafting', value: 0, description: '' });
  }

  /** Remove a typed trophy. */
  removeLoot(index) {
    return this.#removeAt(this.spec.loot, index);
  }

  /**
   * Write one control of a typed trophy. A path the row has no control for, or a loot type the sheet does not offer, is refused
   * (the value stays); the return says whether the row exists and the path is a control.
   */
  setLoot(index, path, value) {
    const row = this.spec.loot[Number(index)];
    const coerce = LOOT_FIELDS[path];
    if (!row || !coerce) return false;
    const next = coerce(value);
    if (next !== null) row[path] = next;
    return true;
  }

  /** Remove an embedded item; a Skill that came with a weapon goes with it. */
  removeItem(index) {
    const item = this.spec.items[Number(index)];
    if (!item || !this.#removeAt(this.spec.items, index)) return false;
    for (const skill of [...this.spec.items]) {
      if (this.broughtBy.get(skill) === item) this.#removeAt(this.spec.items, this.spec.items.indexOf(skill));
    }
    return true;
  }

  /** The quick trait rows (`QUICK_TRAIT_TYPES`) with their place in `spec.traits`. */
  quickTraits() {
    return this.spec.traits
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => QUICK_TRAIT_TYPES.includes(row?.type));
  }

  /** Add a quick trait row of a type; an unknown type is refused. Returns its index in `spec.traits`. */
  addTrait(type) {
    if (!QUICK_TRAIT_TYPES.includes(type)) return -1;
    this.spec.traits.push(defaultTrait(type));
    return this.spec.traits.length - 1;
  }

  removeTrait(index) {
    return this.#removeAt(this.spec.traits, index);
  }

  /** Write one control of a quick trait row (`name`, `damageType`, `multiplier`); anything else is refused. */
  setTrait(index, key, value) {
    const row = this.spec.traits[Number(index)];
    if (!row || !QUICK_TRAIT_TYPES.includes(row.type) || !Object.hasOwn(TRAIT_FIELDS, key)) return false;
    row[key] = TRAIT_FIELDS[key](value);
    return true;
  }

  /**
   * What the picked spells cost against the mob's Mana: the dearest spell's cost and the Mana the mob has. `short` is true
   * when that spell cannot be cast; null when the mob holds no spell.
   * @returns {{ mana: number, cost: number, short: boolean }|null}
   */
  spellMana() {
    const spells = this.spec.items.filter((i) => i.type === 'spell');
    if (!spells.length) return null;
    const cost = Math.max(...spells.map((s) => Number(s.system?.manaCost) || 0));
    return { mana: this.spec.mana, cost, short: cost > this.spec.mana };
  }

  /** Set an embedded Skill's or spell's Rank: from now on it no longer follows the Floor or the tier. */
  setItemRank(index, raw) {
    const item = this.spec.items[Number(index)];
    if (!item || !['skill', 'spell'].includes(item.type)) return false;
    item.system.rank = atLeast(0, 0)(raw);
    this.followRank.delete(item);
    return true;
  }

  /** Whether the mob's embedded items hold a Skill with this identifier. */
  ownsSkill(identifier) {
    return this.spec.items.some((i) => i.type === 'skill' && itemIdentifier(i) === identifier);
  }

  /**
   * The Skill a weapon needs to roll damage on this mob: the first Skill it lists that the catalog has (else the first it
   * lists), when it has no Base Damage of its own and the mob owns none of the Skills it lists. Null when it needs none.
   * @param {object} weapon creation data of a gear weapon
   * @returns {{ identifier: string, definition: object|null }|null} `definition` is the catalog's Skill, null when the
   *   catalog lacks it
   */
  weaponSkillNeed(weapon) {
    if (!this.#lacksDamageSource(weapon ?? {})) return null;
    const entries = listedSkillEntries(weapon?.system ?? {}, worldSkillResolver());
    return entries.find((e) => e.definition) ?? entries[0] ?? null;
  }

  /**
   * Add a picked weapon equipped (a mob attacks with the gear it holds), and with it the Skill it takes its damage from
   * when the mob has none of them (`weaponSkillNeed`): `skill` is that Skill's creation data, resolved by the caller from
   * the catalog.
   * @param {object} weapon creation data of a gear weapon
   * @param {object|null} [skill] creation data of a Skill
   * @returns {{ added: boolean, reason?: string, index?: number, skillAdded?: boolean }}
   */
  addWeapon(weapon, skill = null) {
    if (weapon?.type !== 'gear') return { added: false, reason: 'invalid' };
    const result = this.addPicked({ ...weapon, system: { ...weapon.system, equipped: true } });
    if (!result.added) return result;
    const item = this.spec.items[result.index];
    let skillAdded = false;
    if (skill?.type === 'skill') {
      const brought = this.addPicked(skill);
      if (brought.added) {
        this.broughtBy.set(this.spec.items[brought.index], item);
        skillAdded = true;
      }
    }
    return { ...result, skillAdded };
  }

  /**
   * The equipped weapons that still have no damage source on this mob: no Base Damage of their own and none of their listed
   * Skills owned. `listsNone`: it lists no Skill; `missing`: the Skills it lists that the catalog lacks.
   * @returns {{ index: number, name: string, listsNone: boolean, missing: string[] }[]}
   */
  weaponIssues() {
    const issues = [];
    this.spec.items.forEach((item, index) => {
      if (item.type !== 'gear' || !item.system?.isWeapon) return;
      if (!this.#lacksDamageSource(item)) return;
      const entries = listedSkillEntries(item.system, worldSkillResolver());
      issues.push({ index, name: item.name, listsNone: entries.length === 0, missing: entries.filter((e) => !e.definition).map((e) => e.identifier) });
    });
    return issues;
  }

  /** A weapon with no Base Damage of its own that owns none of its listed Skills (or lists none). */
  #lacksDamageSource(weapon) {
    if (normalizeBaseDamage(weapon.system?.baseDamage).dice) return false;
    const entries = listedSkillEntries(weapon.system ?? {}, worldSkillResolver());
    return !entries.some((e) => this.ownsSkill(e.identifier));
  }

  /**
   * The numbers a stat block shows, from the same rules functions the mob model and the builder call.
   * Evade and Surprise are the base (the DC is base + the Floor the mob fights on).
   */
  readouts() {
    const { level, designFloor: floor, abilities } = this.spec;
    const bossTier = this.isBoss ? this.spec.bossTier : null;
    const budget = statBudget({ level, bossTier });
    const spent = statSpent(abilities, budget.base);
    const mods = Object.fromEntries(MOB_STATS.map((k) => [k, getCOGStatModifier(abilities[k])]));

    const derivedBars = hbSlots({ level, bossTier, floor });
    const bars = this.spec.bars ?? derivedBars;
    const hpPerBar = resolveHpPerBar(0, mods.con);

    const rating = (stored, derivedBase) => {
      const base = stored ?? derivedBase;
      return { base, derived: derivedBase, custom: stored !== null && stored !== derivedBase, dc: base + floor };
    };

    return {
      isBoss: this.isBoss,
      tier: this.isBoss ? resolveBossTier(this.spec.bossTier) : null,
      level,
      floor,
      budget,
      spent,
      remaining: budget.points - spent,
      over: spent > budget.points,
      mods,
      modLabels: Object.fromEntries(MOB_STATS.map((k) => [k, signed(mods[k])])),
      bars: { derived: derivedBars, value: bars, custom: this.spec.bars !== null && this.spec.bars !== derivedBars },
      hpPerBar,
      maxHp: bars * hpPerBar,
      slotPercentages: slotPercentages(bars),
      evade: rating(this.spec.evadeBase, defaultEvadeBase(mods.dex)),
      surprise: rating(this.spec.surpriseBase, defaultSurpriseBase(mods.int)),
      dr: { base: this.spec.dr, total: mobTotalDr(this.spec.dr, floor) },
      move: this.spec.move,
      step: this.spec.step,
      recommendedDice: recommendedDice({ level, isBoss: this.isBoss })
    };
  }

  /**
   * Every rule the draft breaks: `{ stage, reason }` per Rule Break (the rail marks the stage, the footer and the Review
   * stage list the reasons). Empty when the draft follows the rules.
   * @returns {{ stage: string, reason: string }[]}
   */
  ruleBreaks() {
    const { level, bossTier, abilities } = this.spec;
    return mobRuleBreakReasons({ level, bossTier: this.isBoss ? bossTier : null, abilities }).map((reason) => ({ stage: RULE_BREAK_STAGE, reason }));
  }

  /**
   * Spend the unspent stat points, one at a time, over the focus's stats in turn. Never lowers a stat and spends nothing
   * when the budget is spent or over.
   * @param {keyof typeof FILL_FOCUSES} [focus='even']
   * @returns {number} the points spent
   */
  fillToBudget(focus = 'even') {
    const order = FILL_FOCUSES[focus] ?? FILL_FOCUSES.even;
    const left = Math.max(0, this.readouts().remaining);
    for (let i = 0; i < left; i++) this.spec.abilities[order[i % order.length]] += 1;
    return left;
  }

  /**
   * The actor creation payload.
   * @param {{ ruleBreak?: boolean, warnings?: object[] }} [options] `ruleBreak: true` records the confirmed Rule Break on the mob
   */
  compile({ ruleBreak = false, warnings } = {}) {
    const spec = { ...this.spec };
    if (ruleBreak) {
      spec.ruleBreak = true;
      const reason = this.ruleBreaks().map((b) => b.reason).join(' ');
      if (reason) spec.ruleBreakReason = reason;
    }
    return buildPayload('mob', spec, warnings ? { warnings } : {});
  }
}
