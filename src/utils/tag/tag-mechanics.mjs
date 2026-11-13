import { getItemAllTags } from '../../documents/active-tags.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { getReachedRankBreaks } from '../skill/rank-breaks.mjs';
import { matchesTagQuery } from './tag-query.mjs';
import { hasRuleFlag, RULE_FLAGS } from './tag-behaviour.mjs';
import { VEHICLE_TAGS, OUTCOME_TAGS } from '../../data/tag-vocabulary.mjs';

export const AURA_TAGS = Object.freeze(['delivery.aura', 'shape.aura']);
const FREE_INTERRUPT_TAG = 'action.free_interrupt';
export const INTERRUPT_TAGS = Object.freeze(['action.interrupt', FREE_INTERRUPT_TAG]);
/** Mob identity: `mob.unique` marks a named one-of-a-kind boss (`MOB_BOSS_TAG` is in `data/tag-vocabulary.mjs`). */
export const MOB_UNIQUE_TAG = 'mob.unique';
export const MOB_TIER_PREFIX = 'mob.tier.';
/** The seed sex tags the Sex select writes (`src/utils/tag/sex.mjs`); the options are a registry, these are its first four. */
export const SEX_TAGS = Object.freeze({
  male: 'creature.male',
  female: 'creature.female',
  nonbinary: 'creature.nonbinary',
  other: 'creature.sex_other'
});
/** What kind of roll is being made. Moved here from roll-context.mjs so every engine module can name a check tag. */
export const CHECK_TAGS = Object.freeze({
  skill: 'check.skill',
  stat: 'check.stat',
  evade: 'check.evade',
  advancement: 'check.advancement',
  advancementFloorEnd: 'check.advancement.floor_end',
  resist: 'check.resist',
  attack: 'check.attack',
  spell: 'check.spell',
  assist: 'check.assist',
  surprise: 'check.surprise',
  crafting: 'check.crafting',
  vehicle: 'check.vehicle'
});
/** The skill kind that is a core action every crawler has (no Ranks). */
export const CORE_KIND_TAG = 'kind.core';
export { OUTCOME_TAGS, VEHICLE_TAGS };
/** Whether a tag id is one of the card outcome tags. */
export function isOutcomeTag(tag) {
  return Object.values(OUTCOME_TAGS).includes(tag);
}
/** Core action/kind vocabulary the engine classifies items by. Items carry these tags; computeDerivedTags derives them. */
export const SKILL_ROLE_TAGS = Object.freeze({
  attack: 'action.attack',
  passive: 'action.passive',
  technique: 'kind.technique',
  heal: 'action.heal'
});
/** Identity tag of an unarmed skill (displayed as an unarmed attack). */
export const UNARMED_TAG = 'weaponClass.unarmed';
/** A skill with any of these tags is a primary attack for damage purposes, with or without a weapon. */
export const PRIMARY_ATTACK_TAGS = Object.freeze([UNARMED_TAG, SKILL_ROLE_TAGS.attack]);
export const PLACED_DELIVERY_TAG = 'delivery.placed';
/** The wield situation tags the roll context rewrites for a flexible two-hander. */
export const WIELD_TAGS = Object.freeze({ oneHanded: 'wield.one_handed', twoHanded: 'wield.two_handed' });
export const OFFER_ROLES = Object.freeze({ TARGET: 'target', ALLY: 'ally', FOE: 'foe' });

/** When a trigger is offered: on an attack card (`attacked`), on an ally's d20 check card (`check`), on the assister's own turn (`turn`), or when a foe's token moves (`move`). */
export const TRIGGER_MOMENTS = Object.freeze({ attacked: 'attacked', check: 'check', turn: 'turn', move: 'move' });
/** The two ways a foe's move changes its distance to an interrupter: out of its reach (Attack of Opportunity) or into it (Zone of Control). */
export const MOVE_EVENTS = Object.freeze({ leave: 'leave', enter: 'enter' });

/** Ordered: first match is the display trigger. offerTo/requiresHit drive attack-card offers; moment says which surface offers it. */
export const INTERRUPT_TRIGGERS = Object.freeze([
  Object.freeze({ tag: 'trigger.on_attack', id: 'on_attack', offerTo: 'target', moment: 'attacked', requiresHit: false }),
  Object.freeze({ tag: 'trigger.on_damage', id: 'on_damage', offerTo: 'target', moment: 'attacked', requiresHit: true }),
  Object.freeze({ tag: 'trigger.on_foe_leave_reach', id: 'on_foe_leave_reach', offerTo: 'foe', moment: 'move', requiresHit: false, moveEvent: 'leave' }),
  Object.freeze({ tag: 'trigger.on_foe_enter_reach', id: 'on_foe_enter_reach', offerTo: 'foe', moment: 'move', requiresHit: false, moveEvent: 'enter' }),
  Object.freeze({ tag: 'trigger.on_ally_attack', id: 'on_ally_attack', offerTo: 'ally', moment: 'attacked', requiresHit: false }),
  Object.freeze({ tag: 'trigger.on_ally_hit', id: 'on_ally_hit', offerTo: 'ally', moment: 'attacked', requiresHit: true }),
  Object.freeze({ tag: 'trigger.on_ally_check', id: 'on_ally_check', offerTo: 'ally', moment: 'check', requiresHit: false }),
  Object.freeze({ tag: 'trigger.before_ally_action', id: 'before_ally_action', offerTo: 'ally', moment: 'turn', requiresHit: false, actionType: 'play' })
]);
const DEFAULT_INTERRUPT_TRIGGER = Object.freeze({ tag: null, id: 'any', label: 'Anytime', offerTo: 'target', moment: 'attacked', requiresHit: false });

/** What an interrupt does to the attack that triggered it. First match wins. */
export const INTERCEPT_MODE_TAGS = Object.freeze([
  Object.freeze({ tag: 'interrupt.redirect_attack', mode: 'redirect' }),
  Object.freeze({ tag: 'interrupt.intercept_hit', mode: 'intercept' })
]);
/** A debuff is an injury when it carries a tag in this namespace (`<ns>.minor|major|long_term`); Mend Injury removes by that tag, never a name. */
export const INJURY_NAMESPACE = 'injury';
export const NOT_VS_AREA_TAG = 'interrupt.not_vs_area';
export const INTERRUPT_RANGE_FROM = Object.freeze(['defender', 'attacker']);

/** Whether a tag set (Set or Array) contains an area shape: any tag whose definition carries the `area` flag. */
export function isAreaTagSet(tags) {
  return hasRuleFlag(tags, RULE_FLAGS.area);
}

/** The two broad skill disciplines. Every other `skillGroup.*` tag is a narrower group (strike, defensive, crafting, ...). */
export const SKILL_GROUP_TAGS = Object.freeze({ combat: 'skillGroup.combat', utility: 'skillGroup.utility' });
/** Namespace of the tags that name a weapon skill's group (Edge, Bashing, Hand to Hand, ...). */
const WEAPON_GROUP_NAMESPACE = 'weaponGroup';
const SKILL_GROUP_NAMESPACE = 'skillGroup';

/** A skill tagged `skillGroup.combat`. */
export function isCombatSkill(item) {
  return getTagsOf(item).has(SKILL_GROUP_TAGS.combat);
}

/**
 * The label a skill shows for its group: the first `weaponGroup.*` tag, else the first `skillGroup.*` tag other than combat
 * and utility, else combat, else utility. It reads each tag's registry definition (namespace and label), never the id text.
 * @param {object|Iterable<string>} source a skill (its stored `system.tags`) or a tag collection
 * @returns {string} the label, or '' when the skill has no group tag
 */
export function skillGroupLabel(source) {
  const raw = source && typeof source === 'object' && !Array.isArray(source) && !(source instanceof Set) ? source.system?.tags : source;
  const tags = raw && typeof raw[Symbol.iterator] === 'function' && typeof raw !== 'string' ? [...raw] : [];
  let weapon = null;
  let narrow = null;
  const broad = new Map();
  for (const id of tags) {
    const def = getTagDefinition(id);
    if (!def) continue;
    if (def.namespace === WEAPON_GROUP_NAMESPACE) weapon ??= def;
    else if (def.namespace === SKILL_GROUP_NAMESPACE) {
      if (id === SKILL_GROUP_TAGS.combat || id === SKILL_GROUP_TAGS.utility) broad.set(id, def);
      else narrow ??= def;
    }
  }
  const picked = weapon ?? narrow ?? broad.get(SKILL_GROUP_TAGS.combat) ?? broad.get(SKILL_GROUP_TAGS.utility);
  return picked ? String(picked.label ?? '') : '';
}

/** Passive skills have no active roll and cannot be marked for advancement: the `action.passive` tag (derived from the check type). */
export function isPassiveSkill(item) {
  return getTagsOf(item).has(SKILL_ROLE_TAGS.passive);
}

export function isAttackSkill(item) {
  return getTagsOf(item).has(SKILL_ROLE_TAGS.attack);
}

export function isTechniqueSkill(item) {
  return getTagsOf(item).has(SKILL_ROLE_TAGS.technique);
}

export function isHealingItem(item) {
  return getTagsOf(item).has(SKILL_ROLE_TAGS.heal);
}

/**
 * The "Place Area of Effect" button: an explicit area, or a sized area that is placed or has an area shape.
 * @param {object} sys item system data
 * @param {Set<string>|string[]} [tags] the item's tags
 */
export function offersAreaTemplate(sys, tags) {
  if (sys?.area?.hasArea === true) return true;
  const sized = Number(sys?.area?.radius) > 0 || Number(sys?.area?.lineLength) > 0;
  const has = (t) => (tags instanceof Set ? tags.has(t) : Array.isArray(tags) && tags.includes(t));
  return sized && (sys?.delivery === 'placed' || isAreaTagSet(tags) || has(PLACED_DELIVERY_TAG));
}

/** What a spell does, for its badge, accent and filter. First match over these tags wins; no match is `none`. */
const SPELL_ROLE_TAGS = Object.freeze([
  ['action.attack', 'attack'],
  ['action.heal', 'heal'],
  [FREE_INTERRUPT_TAG, 'free_interrupt'],
  ['action.interrupt', 'interrupt'],
  [SKILL_ROLE_TAGS.passive, 'passive']
]);

/**
 * A spell's role as a lowercase id (`attack`, `heal`, `free_interrupt`, `interrupt`, `passive`, `none`), read from its tags
 * only: the check type derives `action.attack` / `action.passive`, healing derives `action.heal`, and the interrupt tags are stored.
 * @param {object|Iterable<string>} source a spell, or a tag collection
 * @returns {string}
 */
export function spellRole(source) {
  const isDoc = source && typeof source === 'object' && typeof source[Symbol.iterator] !== 'function';
  const tags = isDoc ? getTagsOf(source) : new Set(source ?? []);
  for (const [tag, role] of SPELL_ROLE_TAGS) if (tags.has(tag)) return role;
  return 'none';
}

const SPELL_ROLE_LABELS = Object.freeze({ attack: 'Attack', heal: 'Heal', passive: 'Passive', interrupt: 'Interrupt', free_interrupt: 'Free Interrupt', none: 'Spell' });

/** The display label of a spell role (`COG.SpellRole.*`; the English wording when no translation is loaded). */
export function spellRoleLabel(role) {
  const key = `COG.SpellRole.${role}`;
  const text = globalThis.game?.i18n?.localize?.(key);
  return text && text !== key ? text : (SPELL_ROLE_LABELS[role] ?? SPELL_ROLE_LABELS.none);
}

/** How an item is used up (3.76). The `usage.*` kind tags; `usage.restorable` is a separate flag, not a kind. */
export const USAGE_KINDS = Object.freeze({
  reusable: 'usage.reusable',
  rechargeable: 'usage.rechargeable',
  consumable: 'usage.consumable'
});
/**
 * Crafting (3.15). The mode tags say which step of a craft is rolled (a check's context); `table`/`attachment` are the
 * prefixes of a crafting table's type (`crafting.table.<type>`, on `craftingTable.tableTypeTag`) and of an attachment
 * item (`crafting.attachment.<id>`) that a blueprint's `tables` query may require; `recipe` is the prefix of a locked recipe on a blueprint
 * (`crafting.recipe.<id>`, unlocked by an `unlockRecipes` craft row); `coupon` marks the loot that adds a table tier.
 */
export const CRAFT_TAGS = Object.freeze({
  modeMundane: 'crafting.mode.mundane',
  modeEnchant: 'crafting.mode.enchant',
  modeItem: 'crafting.mode.item',
  tablePrefix: 'crafting.table.',
  attachmentPrefix: 'crafting.attachment.',
  recipePrefix: 'crafting.recipe.',
  coupon: 'crafting.coupon.table'
});
/** Personal spaces: `couponRank` marks the loot spent for one Rank Up. */
export const SPACE_TAGS = Object.freeze({
  couponRank: 'space.coupon.rank'
});
/** The state of a gear item that was broken (repairable) or destroyed (permanent) by crafting or the over-enchanting hazard. */
export const ITEM_STATE_TAGS = Object.freeze({ broken: 'item.broken', destroyed: 'item.destroyed' });
/** A material that is never salvaged when a craft fails. */
export const MATERIAL_UNSALVAGEABLE_TAG = 'material.unsalvageable';

/** The tag that makes an item's junk remember what it was, so a recharge can restore it. */
const USAGE_RESTORABLE_TAG = 'usage.restorable';

/** The tag a scene carries in `flags.sprinter-rpg.tags` when it is a safe room (where loot boxes open). Not the `space.safe_room` personal space type. */
export const SAFE_ROOM_TAG = 'scene.safe_room';

/** The tags every piece of used-form junk carries (3.76 B2): a crafting reagent, the baseline Misc. Junk. */
export const JUNK_TAGS = Object.freeze(['material.crafting', 'material.misc_junk']);

/** Whether an item is used-form junk (stores `material.misc_junk`, which every piece a used-up item leaves carries). */
export function isJunkItem(item) {
  return Array.isArray(item?.system?.tags) && item.system.tags.includes('material.misc_junk');
}

/**
 * What using an item does to it: `reusable`, `rechargeable` or `consumable`, from a stored `usage.*` tag with a default
 * when none is stored. Several stored tags read as consumable, then rechargeable, then reusable. A `reusable` item with a
 * charge maximum reads as rechargeable (the charges count uses). Without a stored tag: a scratch ticket is consumable,
 * anything with `charges.max > 0` is rechargeable, other gear is reusable and other loot is consumable.
 * Reads the stored `system.tags` only, so it works on a document or on a bare spec.
 * @param {object} item an Item document or `{ type, system }`
 * @returns {'reusable'|'rechargeable'|'consumable'}
 */
export function itemUsage(item) {
  const sys = item?.system ?? {};
  const stored = new Set(Array.isArray(sys.tags) ? sys.tags : []);
  const hasCharges = Number(sys.charges?.max) > 0;
  if (stored.has(USAGE_KINDS.consumable)) return 'consumable';
  if (stored.has(USAGE_KINDS.rechargeable)) return 'rechargeable';
  if (stored.has(USAGE_KINDS.reusable)) return hasCharges ? 'rechargeable' : 'reusable';
  // A scratch ticket (`SCRATCH_LOOT_TYPE`, loot-model.mjs; not imported, the model needs Foundry's globals at load).
  if (item?.type === 'loot' && String(sys.lootType ?? '').trim() === 'scratch_ticket') return 'consumable';
  if (hasCharges) return 'rechargeable';
  return item?.type === 'gear' ? 'reusable' : 'consumable';
}

/** Whether an item stores more than one `usage.*` kind tag (the sheet warns; the reader still picks one). */
export function hasConflictingUsageTags(item) {
  const stored = new Set(Array.isArray(item?.system?.tags) ? item.system.tags : []);
  return Object.values(USAGE_KINDS).filter((t) => stored.has(t)).length > 1;
}

/** Whether an item's junk remembers it (`usage.restorable` stored on it). */
export function isRestorableUsage(item) {
  return Array.isArray(item?.system?.tags) && item.system.tags.includes(USAGE_RESTORABLE_TAG);
}

const USAGE_LABELS = Object.freeze({ reusable: 'Reusable', rechargeable: 'Rechargeable', consumable: 'Consumable' });

/** The display label of a usage kind (`COG.Usage.*`; the English wording when no translation is loaded). */
export function usageLabel(kind) {
  const key = `COG.Usage.${kind}`;
  const text = globalThis.game?.i18n?.localize?.(key);
  return text && text !== key ? text : (USAGE_LABELS[kind] ?? USAGE_LABELS.consumable);
}

/** Full tag set for an item (explicit + derived + rank-gated). */
export function getTagsOf(item) {
  if (!item) return new Set();
  const t = item.allTags;
  return t instanceof Set ? t : getItemAllTags(item);
}

/** Namespace prefix of the favored-archetype tags (`favored.mage`): the spell's Favored mechanic. */
export const FAVORED_TAG_PREFIX = 'favored.';

/**
 * Display names of the `favored.*` tags in a tag collection, from the registry label ("Favored: Mage" gives "Mage").
 * An unregistered tag shows its id's remainder.
 * @param {Iterable<string>} tags
 * @returns {string[]}
 */
export function favoredLabels(tags) {
  return [...(tags ?? [])]
    .filter((t) => typeof t === 'string' && t.startsWith(FAVORED_TAG_PREFIX))
    .map((t) => String(getTagDefinition(t)?.label ?? t.slice(FAVORED_TAG_PREFIX.length)).replace(/^Favored:\s*/, ''));
}

export function isAuraItem(item) {
  return matchesTagQuery(getTagsOf(item), { any: AURA_TAGS });
}

export function isInterruptItem(item) {
  return matchesTagQuery(getTagsOf(item), { any: INTERRUPT_TAGS });
}

export function isFreeInterruptItem(item) {
  return getTagsOf(item).has(FREE_INTERRUPT_TAG);
}

/**
 * Every trigger matched by a tag set (table order), or [DEFAULT_INTERRUPT_TRIGGER] when none match.
 * @param {Set<string>|string[]} tags
 * @returns {Array<{ tag: string|null, id: string, label: string, offerTo: string|null, requiresHit: boolean }>}
 */
export function getInterruptTriggersFromTags(tags) {
  const set = tags instanceof Set ? tags : new Set(tags || []);
  const out = [];
  for (const t of INTERRUPT_TRIGGERS) {
    if (set.has(t.tag)) out.push({ ...t, label: getTagDefinition(t.tag)?.label || t.id });
  }
  return out.length ? out : [{ ...DEFAULT_INTERRUPT_TRIGGER }];
}

export function getInterruptTriggers(item) {
  return getInterruptTriggersFromTags(getTagsOf(item));
}

/**
 * Whether any of the given trigger ids is offered on an attack card to the given role.
 * @param {string[]} triggerIds
 * @param {{ role: string, isHit: boolean }} ctx
 */
export function isOfferedOnAttack(triggerIds, { role, isHit } = {}) {
  for (const id of triggerIds || []) {
    const def = INTERRUPT_TRIGGERS.find(t => t.id === id) || (id === DEFAULT_INTERRUPT_TRIGGER.id ? DEFAULT_INTERRUPT_TRIGGER : null);
    if (!def || def.moment !== TRIGGER_MOMENTS.attacked || def.offerTo !== role) continue;
    if (def.requiresHit && !isHit) continue;
    return true;
  }
  return false;
}

/** Whether any trigger id is offered on an ally's check card (the roller's allies). */
export function isOfferedOnCheck(triggerIds) {
  for (const id of triggerIds || []) {
    const def = INTERRUPT_TRIGGERS.find(t => t.id === id);
    if (def && def.moment === TRIGGER_MOMENTS.check && def.offerTo === OFFER_ROLES.ALLY) return true;
  }
  return false;
}

/** Whether any trigger id is offered when a foe's token makes the given move event (`leave` or `enter` the interrupter's reach). */
export function isOfferedOnMove(triggerIds, { event } = {}) {
  for (const id of triggerIds || []) {
    const def = INTERRUPT_TRIGGERS.find(t => t.id === id);
    if (def && def.moment === TRIGGER_MOMENTS.move && def.offerTo === OFFER_ROLES.FOE && def.moveEvent === event) return true;
  }
  return false;
}

/** The called-assist trigger row (moment `turn`, carries `actionType`) among the given trigger ids, or null. */
export function calledAssistTrigger(triggerIds) {
  for (const id of triggerIds || []) {
    const def = INTERRUPT_TRIGGERS.find(t => t.id === id);
    if (def && def.moment === TRIGGER_MOMENTS.turn && def.actionType) return def;
  }
  return null;
}

/** Whether an item is a core action (the `kind.core` tag). */
export function isCoreSkill(item) {
  return getTagsOf(item).has(CORE_KIND_TAG);
}

/** @returns {'redirect'|'intercept'|null} */
export function getInterceptModeFromTags(tags) {
  const set = tags instanceof Set ? tags : new Set(tags || []);
  for (const m of INTERCEPT_MODE_TAGS) if (set.has(m.tag)) return m.mode;
  return null;
}

/** Reach in feet of a range-0 (touch) interrupt: one grid square. */
export const TOUCH_REACH_FEET = 5;

/**
 * Interrupt range: `feet` is the base range plus reached rank-break `interrupt.rangeBonus` (0 = touch),
 * `unlimited` is the explicit flag, and `reach` is the distance the interrupter can act across (touch counts as
 * TOUCH_REACH_FEET, so a bonus on a touch interrupt adds reach), or null when unlimited.
 * @returns {{ feet: number, from: string, unlimited: boolean, reach: number|null }}
 */
export function getInterruptRange(item) {
  const r = item?.system?.interrupt || {};
  const base = Math.max(0, Number(r.range) || 0);
  const unlimited = r.unlimited === true;
  let bonus = 0;
  if (!unlimited) {
    for (const rb of getReachedRankBreaks(item)) bonus += Number(rb.data?.interrupt?.rangeBonus) || 0;
  }
  const from = INTERRUPT_RANGE_FROM.includes(r.rangeFrom) ? r.rangeFrom : 'defender';
  const reach = unlimited ? null : (base === 0 ? TOUCH_REACH_FEET : base) + Math.max(0, bonus);
  return { feet: unlimited ? 0 : Math.max(0, base + bonus), from, unlimited, reach };
}

/** Largest "+N DR" an interrupt can add to one attack (a sanity cap on hand-entered numbers). */
const MAX_INTERRUPT_DR_BONUS = 1000;

/**
 * What an interrupt does to the one attack that triggered it, beyond moving it: "+N DR against the triggering attack"
 * (`interrupt.drBonus` plus every reached rank-break tier's) and "ignore the debuffs attached to it"
 * (`interrupt.ignoreDebuffs`, or any reached tier's). Read only when the interrupt resolves; nothing persists.
 * @param {object} item an interrupt item (skill, spell, gear, attack)
 * @returns {{ drBonus: number, ignoreDebuffs: boolean }}
 */
export function getInterruptEffects(item) {
  const r = item?.system?.interrupt || {};
  let drBonus = Math.max(0, Math.floor(Number(r.drBonus) || 0));
  let ignoreDebuffs = r.ignoreDebuffs === true;
  for (const rb of getReachedRankBreaks(item)) {
    drBonus += Math.max(0, Math.floor(Number(rb.data?.interrupt?.drBonus) || 0));
    if (rb.data?.interrupt?.ignoreDebuffs === true) ignoreDebuffs = true;
  }
  return { drBonus: Math.min(MAX_INTERRUPT_DR_BONUS, drBonus), ignoreDebuffs };
}

/** Highest reached rank break whose own tags grant action.free_interrupt (for the perk note), or null. */
export function getFreeInterruptRankBreak(item) {
  const reached = getReachedRankBreaks(item);
  for (let i = reached.length - 1; i >= 0; i--) {
    const tags = Array.isArray(reached[i].data?.tags) ? reached[i].data.tags : [];
    if (tags.includes(FREE_INTERRUPT_TAG)) return reached[i];
  }
  return null;
}
