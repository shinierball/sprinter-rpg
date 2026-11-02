import { COG_ROLL_OUTCOMES } from '../apps/session-manager/roll-outcomes.mjs';

/**
 * Tag vocabulary: namespaces, engine situation and outcome ids, and the role-prefix helpers (`self.`, `attacker.`,
 * `subject.`). A leaf module so the tag catalog can use it; import through `tags.mjs`.
 */

export const TAG_NAMESPACES = {
  kind:         { label: 'Kind', description: 'Core item or document classification' },
  action:       { label: 'Action Type', description: 'Action classification for skills and spells' },
  element:      { label: 'Damage / Element', description: 'Damage and energy types' },
  shape:        { label: 'Area / Delivery', description: 'Targeting shape or delivery mode' },
  delivery:     { label: 'Delivery Mode', description: 'Targeting and delivery mechanism (placed, aura, self, target)' },
  duration:     { label: 'Duration Type', description: 'Duration type (instant, rounds, minutes, hours, combat, permanent)' },
  target:       { label: 'Target Filter', description: 'Target filtering (allies, enemies, all, self)' },
  stat:         { label: 'Governing Stat', description: 'Core crawler attribute' },
  archetype:    { label: 'Class Archetype', description: 'Base class archetype from rulebook' },
  favored:      { label: 'Favored Archetype', description: 'Favored class archetype for spells', references: 'archetype' },
  weapon:       { label: 'Weapon Type', description: 'Specific weapon family' },
  weaponClass:  { label: 'Weapon Category', description: 'Melee, ranged, natural, unarmed' },
  weaponGroup:  { label: 'Weapon Group', description: 'Weapon group category (power, edge, bashing, reach, ranged, hand to hand, utility, exotic)' },
  weaponProp:   { label: 'Weapon Property', description: 'Weapon handling properties (two-handed, reach, etc.)' },
  wield:        { label: 'Wielding', description: 'Weapon wielding mode (one_handed, two_handed)' },
  skillGroup:   { label: 'Skill Discipline', description: 'Discipline grouping for skills' },
  technique:    { label: 'Combat Technique Target', description: 'Skill targeted by combat techniques' },
  contest:      { label: 'Contest / Opposed Check', description: 'Contested check against target stat or skill' },
  rule:         { label: 'Special Rule Flag', description: 'Engine mechanics and overrides' },
  resource:     { label: 'Resource Type', description: 'Character resource pools (mana, health bars, temporary bars)' },
  interrupt:    { label: 'Interrupt Effect', description: 'What an interrupt does to the attack that triggered it' },
  trigger:      { label: 'Condition Trigger', description: 'Triggers on critical hit, fumble, or combat condition' },
  condition:    { label: 'Status Condition / Debuff', description: 'Condition and status effect classification' },
  injury:       { label: 'Injury Severity', description: 'Marks a debuff as an injury and its severity (minor, major, long_term); what Mend Injury removes' },
  heritage:     { label: 'Race Heritage', description: 'Where a race comes from (earth, alien, pet); derived from the race, never stored on an item' },
  companion:    { label: 'Companion Type', description: 'Companion and asset classification (pet, vehicle, mount)' },
  species:      { label: 'Species (Origin)', description: 'A crawler\'s origin at induction (human, animal); not a race', partyTag: true },
  mob:          { label: 'Mob & Boss Classification', description: 'Mob encounter flags and boss hierarchy', partyTag: true },
  role:         { label: 'Crew / Handler Role', description: 'Crew stations and handler roles (pilot, rider, passenger, gunner, handler)' },
  space:        { label: 'Space Classification', description: 'Personal space, safe room, bunker, and apartment types' },
  upgrade:      { label: 'Space Upgrade Module', description: 'Personal space amenities, modules, and facilities' },
  id:           { label: 'Identity Tag', description: 'Stable unique item identity: id.<type>.<slug>' },
  school:       { label: 'Spell School', description: 'A spell\'s school or theme (illusion, healing, mind control); descriptive, the engine never reads it' },
  access:       { label: 'Access', description: 'Access to a club, guild or facility (descriptive, adjudicated by the GM)' },
  outcome:      { label: 'Roll Outcome', description: 'The degree of a d20 check against its Difficulty (near_miss, failure, success...); card condition tags only, never carried by items' },
  check:        { label: 'Check Type', description: 'What kind of roll is being made (skill, stat, evade, advancement, resist)' },
  situation:    { label: 'Situation', description: 'Circumstance the engine cannot observe; offered as a roll-dialog toggle when a row on the actor references it' },
  creature:     { label: 'Creature Type', description: 'Creature kind of a crawler or mob (dog, beast, elf), matched against attackers and targets', partyTag: true, identity: true },
  self:         { label: 'Self Tag', description: 'A tag on the row owner itself: self.<any registered tag> (self.condition.fatigued)' },
  attacker:     { label: 'Attacker Tag', description: 'A tag on the attacker in a damage or defense condition: attacker.<any registered tag> (attacker.creature.dog)' },
  subject:      { label: 'Other Party Tag', description: 'A tag on the party the owner acts on (target of a check, attack or damage, or the creature a kill trigger killed): subject.<any registered tag> (subject.creature.elf), filled from the targeted token or a roll-dialog toggle' },
  sense:        { label: 'Sense', description: 'Senses such as darkvision or water breathing (descriptive or derived)' },
  use:          { label: 'Row Use', description: 'A per-roll toggle that spends a limited roll row (use.<row key>, once per floor); set by the roll dialog, never carried by items' },
  usage:        { label: 'Item Usage', description: 'How an item is used up: reusable, rechargeable or consumable (read by the use gate)' },
  material:     { label: 'Crafting Material', description: 'Crafting reagents on loot (material.crafting, material.misc_junk); what a used-up consumable leaves behind carries them' },
  custom:       { label: 'Custom User Tag', description: 'User-created tags' }
};

/**
 * A namespace flagged `identity: true` holds tags that say what an actor IS (`creature.*`). The owner of an actor may
 * edit those on its live sheet; every other `system.tags` edit is GM-only. A module sets the flag when it registers
 * its namespace (`contentRegistry.registerTagNamespace(key, { label, description, identity: true })`).
 * @param {string} namespace
 * @returns {boolean}
 */
export function isIdentityNamespace(namespace) {
  return TAG_NAMESPACES[namespace]?.identity === true;
}

/**
 * True when the tag sits in an identity namespace (see `isIdentityNamespace`).
 * @param {string} tagId e.g. `creature.female`
 * @returns {boolean}
 */
export function isIdentityTag(tagId) {
  const id = typeof tagId === 'string' ? tagId.trim() : '';
  return id.includes('.') && isIdentityNamespace(id.slice(0, id.indexOf('.')));
}

/** Prefix of the descriptive `school.*` spell tags (3.58 D6b). Only the catalog, the cast-card line and the Spell Manager search read it. */
export const SCHOOL_TAG_PREFIX = 'school.';

/** A ticked `use.<row key>` toggle spends a `usesPer: 'floor'` row for this roll (3.12c). */
export const USE_TAG_PREFIX = 'use.';
export const useTagFor = (rowKey) => `${USE_TAG_PREFIX}${rowKey}`;

/** Skills for getting about (Climbing, Jumping, Running, Swimming ...); the contest tracker's skill picker lists them first. */
export const MOVEMENT_SKILL_TAG = 'skillGroup.movement';

/** Role namespaces that wrap another tag: `attacker.creature.dog` is the attacker's `creature.dog`. */
/** Tags the animal-skill lockout reads; engine code imports these instead of quoting the strings. */
export const ANIMAL_TAGS = Object.freeze({ origin: 'species.animal', creature: 'creature.animal', skill: 'skillGroup.animal' });

export const ROLE_TAG_PREFIXES = Object.freeze(['self', 'attacker', 'subject']);

/**
 * `situation.*` tags the engine sets itself (`buildRollContext`). Rows may test them; a roll dialog never offers
 * them and a ticked toggle for one is dropped.
 */
export const ENGINE_SITUATIONS = Object.freeze({
  inCombat: 'situation.in_combat',
  disadvantaged: 'situation.disadvantaged',
  criticalHit: 'situation.critical_hit',
  amazingSuccess: 'situation.amazing_success',
  damageEffect: 'situation.damage_effect'
});

/**
 * Context tags a roll made inside a racing or chasing contest carries (3.45, `options.contest`). Engine tags: rows may
 * test them (`checkModifiers` "+1 on chase checks"); a roll dialog never offers them.
 */
export const CONTEST_TAGS = Object.freeze({ race: 'contest.race', chase: 'contest.chase' });

/** Card outcome condition tags, one per `COG_ROLL_OUTCOMES` id (pending excluded): `outcome.<id>`. */
export const OUTCOME_TAGS = Object.freeze(Object.fromEntries(
  Object.values(COG_ROLL_OUTCOMES).filter((id) => id !== COG_ROLL_OUTCOMES.PENDING).map((id) => [id, `outcome.${id}`])));

/** The `situation.*` `buildRollContext` adds when the roll's actor and its other party are the same size (a roll may also tick it by hand). */
export const SAME_SIZE_SITUATION = 'situation.same_size';

/**
 * Health fraction steps (percent). An actor at or below N% of its Hit Points carries `resource.health_<N>`, for every N
 * in the table that it is at or below (cumulative). Rows read it as `subject.resource.health_20` ("the target is at
 * or under a fifth of its Health"): the click batch captures it per target at apply, like every other `subject.*` tag.
 */
export const HEALTH_FRACTION_STEPS = Object.freeze([10, 20, 30, 40, 80]);

/** The tag for "at or below `percent`% Health". */
export function healthFractionTag(percent) {
  return `resource.health_${percent}`;
}

/**
 * The health fraction tags an actor carries now (derived `attributes.hp`; none when it has no Hit Points).
 * @param {object|null} actor
 * @returns {string[]}
 */
export function healthFractionTags(actor) {
  const hp = actor?.system?.attributes?.hp;
  const max = Number(hp?.max);
  const value = Number(hp?.value);
  if (!(max > 0) || !Number.isFinite(value)) return [];
  const fraction = value / max;
  return HEALTH_FRACTION_STEPS.filter(n => fraction <= n / 100).map(healthFractionTag);
}

/** Aiming's rows fire on a ranged attack whose roll ticked the Aiming toggle (ranged gear derives `weaponGroup.ranged`). */
export const AIMING_CONDITION = Object.freeze({ all: ['situation.aiming'], any: ['weaponClass.ranged', 'weaponGroup.ranged'] });

/** The one place a tag on the ROW OWNER is spelled for a row's condition: `self.condition.fatigued`. */
export function selfTag(tag) {
  return `self.${tag}`;
}

/**
 * The one place a tag on the ATTACKER is spelled for a condition's context. The defender's own tags stay unprefixed,
 * so `creature.beast` means "I am a beast" and `attacker.creature.beast` means "the one hitting me is".
 * @param {string} tag e.g. `creature.dog`
 */
export function attackerTag(tag) {
  return `attacker.${tag}`;
}

/**
 * A tag whose truth can change between the damage roll and an apply: the other party's tags, the
 * Critical Hit and `situation.same_size` (the attacker's size against that target's). A damage row whose condition mentions one is a target row, evaluated per target.
 * @param {string} tag
 * @returns {boolean}
 */
export function isTargetSensitiveTag(tag) {
  if (splitRoleTag(tag)?.role === 'subject') return true;
  const t = typeof tag === 'string' ? tag.trim() : '';
  return t === ENGINE_SITUATIONS.criticalHit || t === ENGINE_SITUATIONS.amazingSuccess || t === SAME_SIZE_SITUATION;
}

/** The one place a tag on the OTHER PARTY of a check (the targeted creature) is spelled for a row's condition. */
export function subjectTag(tag) {
  return `subject.${tag}`;
}

/**
 * The one place the row editor spells a role-prefixed tag. `role` is 'self', 'subject' or 'attacker'; anything else
 * (the "action" role, unprefixed) returns the tag as is.
 * @param {string} role
 * @param {string} tag
 */
export function roleTag(role, tag) {
  if (role === 'self') return selfTag(tag);
  if (role === 'subject') return subjectTag(tag);
  if (role === 'attacker') return attackerTag(tag);
  return tag;
}


/**
 * Split a role-prefixed tag into its role and the wrapped tag, or null when `tagId` is not role-prefixed.
 * @param {string} tagId
 * @returns {{ role: string, tag: string }|null}
 */
export function splitRoleTag(tagId) {
  if (typeof tagId !== 'string') return null;
  const id = tagId.trim();
  for (const role of ROLE_TAG_PREFIXES) {
    if (id.startsWith(`${role}.`) && id.length > role.length + 1) return { role, tag: id.slice(role.length + 1) };
  }
  return null;
}
