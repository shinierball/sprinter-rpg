import { COG_ROLL_OUTCOMES } from '../documents/session/roll-outcomes.mjs';
import { firstScalar } from '../utils/first-scalar.mjs';

/**
 * Tag vocabulary: namespaces, engine situation and outcome ids, the role-prefix helpers (`self.`, `attacker.`,
 * `subject.`) and the fixed slug-to-tag maps (stat, archetype, element, weapon group). A leaf module: it reads no
 * document and no registry, so the tag catalog, the schema models and build scripts can import it in any order.
 * Definition lookups (`getTagDefinition`, custom tags) live in `tag-definitions.mjs`; the tags a live document
 * carries come from `documents/active-tags.mjs`.
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
  race:         { label: 'Race Marker', description: 'Marks a race item (race.form: a transformation form, not a race a crawler chooses)' },
  companion:    { label: 'Companion Type', description: 'Companion and asset classification (pet, vehicle, mount)' },
  species:      { label: 'Species (Origin)', description: 'A crawler\'s origin at induction (human, animal); not a race', partyTag: true },
  mob:          { label: 'Mob & Boss Classification', description: 'Mob encounter flags and boss hierarchy', partyTag: true },
  role:         { label: 'Crew / Handler Role', description: 'Crew stations and handler roles (pilot, rider, passenger, gunner, handler)' },
  space:        { label: 'Space Classification', description: 'Personal space, safe room, bunker, and apartment types' },
  scene:        { label: 'Scene Marker', description: 'Marks a scene (Scene Config), never an item: scene.safe_room is where crawlers open loot boxes without a Rule Break' },
  upgrade:      { label: 'Space Upgrade Module', description: 'Personal space amenities, modules, and facilities' },
  id:           { label: 'Identity Tag', description: 'Stable unique item identity: id.<type>.<slug>' },
  school:       { label: 'Spell School', description: 'A spell\'s school or theme (illusion, healing, mind control); descriptive, the engine never reads it' },
  access:       { label: 'Access', description: 'Access to a club, guild or facility' },
  worship:      { label: 'Worship', description: 'Worship state and worship gifts (derived from a deity bond, or carried by boons and smites)' },
  worships:     { label: 'Worships', description: 'Worships the deity with this identifier (derived from a bond, or authored on a mob or NPC)' },
  blessed:      { label: 'Blessed By', description: 'Gear blessed by the deity with this identifier' },
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
  crafting:     { label: 'Crafting', description: 'Crafting tables and what a craft is doing: crafting.table.<type> on a table, crafting.attachment.<id> on an attachment, crafting.mode.* in a check\'s context, crafting.coupon.table on a table coupon' },
  vehicle:      { label: 'Vehicle', description: 'Vehicle rules: vehicle.skill.driving / vehicle.skill.chopper on the skills that drive, vehicle.kind.<id> derived on a vehicle, vehicle.upgrade.<id> on gear installed on one, vehicle.check.<id> and vehicle.explosion in a roll\'s context' },
  item:         { label: 'Item State', description: 'The state of an item: item.broken (repairable) or item.destroyed (permanent)' },
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
 * True when the tag sits in a party namespace (`creature.*`, `mob.*`, `species.*`): it describes a creature, and a roll only
 * ever carries a creature's tags under a role prefix (`subject.`, `attacker.`, `self.`), so a bare one never matches.
 * @param {string} tagId
 * @returns {boolean}
 */
export function isPartyTag(tagId) {
  return TAG_NAMESPACES[String(tagId).split('.')[0]]?.partyTag === true;
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
  damageEffect: 'situation.damage_effect',
  specialty: 'situation.specialty',
  intercepting: 'situation.intercepting'
});

/**
 * Context tags a roll made inside a racing or chasing contest carries (3.45, `options.contest`). Engine tags: rows may
 * test them (`checkModifiers` "+1 on chase checks"); a roll dialog never offers them.
 */
export const CONTEST_TAGS = Object.freeze({ race: 'contest.race', chase: 'contest.chase' });

/**
 * Tags the vehicle rules (3.44, `src/data/rules/vehicle-rules.mjs`) read or set. `kindPrefix`, `upgradePrefix` and
 * `checkPrefix` are prefixes: `vehicle.kind.<id>` is derived on a vehicle from its kind, `vehicle.upgrade.<id>` marks
 * gear installed on one, `vehicle.check.<id>` is in the context of a vehicle check of that kind. `skillDriving` and
 * `skillChopper` mark the skills a kind's skill query finds, so no skill is ever found by name.
 */
export const VEHICLE_TAGS = Object.freeze({
  skillDriving: 'vehicle.skill.driving',
  skillChopper: 'vehicle.skill.chopper',
  kindPrefix: 'vehicle.kind.',
  upgradePrefix: 'vehicle.upgrade.',
  checkPrefix: 'vehicle.check.',
  explosion: 'vehicle.explosion',
  check: 'check.vehicle',
  driving: 'situation.driving',
  headOn: 'situation.head_on',
  mountedOnly: 'rule.mounted_only',
  rolePrefix: 'role.',
  rolePilot: 'role.pilot'
});

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

/** Mob identity: `mob.boss` is derived on an actor from a registered `mob.tier.<id>` (`collectActorTags`). */
export const MOB_BOSS_TAG = 'mob.boss';

/** A race that is only a form an affliction changes a victim into; race pickers leave it out. */
export const FORM_RACE_TAG = 'race.form';

/** Damage type string to element tag lookup */
const DAMAGE_TYPE_TO_ELEMENT = {
  fire: 'element.fire',
  ice: 'element.ice',
  cold: 'element.ice',
  electric: 'element.electric',
  electricity: 'element.electric',
  lightning: 'element.electric',
  acid: 'element.acid',
  poison: 'element.poison',
  toxic: 'element.poison',
  force: 'element.force',
  sonic: 'element.sonic',
  holy: 'element.holy',
  radiant: 'element.holy',
  necrotic: 'element.necrotic',
  psychic: 'element.psychic',
  bludgeoning: 'element.bludgeoning',
  piercing: 'element.piercing',
  slashing: 'element.slashing',
  brimstone: 'element.brimstone'
};

/** Element tag to canonical display damage type */
const ELEMENT_TO_DAMAGE_TYPE = {
  'element.fire': 'Fire',
  'element.ice': 'Ice',
  'element.electric': 'Electric',
  'element.acid': 'Acid',
  'element.poison': 'Poison',
  'element.force': 'Force',
  'element.sonic': 'Sonic',
  'element.holy': 'Holy',
  'element.necrotic': 'Necrotic',
  'element.psychic': 'Psychic',
  'element.bludgeoning': 'Bludgeoning',
  'element.piercing': 'Piercing',
  'element.slashing': 'Slashing',
  'element.brimstone': 'Brimstone'
};

/** Stat slug to stat tag */
export const STAT_TO_TAG = {
  str: 'stat.str',
  dex: 'stat.dex',
  con: 'stat.con',
  int: 'stat.int',
  cha: 'stat.cha'
};

/** Archetype name to archetype tag */
export const ARCHETYPE_TO_TAG = {
  arcanist: 'archetype.arcanist',
  barbarian: 'archetype.barbarian',
  bard: 'archetype.bard',
  cleric: 'archetype.cleric',
  druid: 'archetype.druid',
  fighter: 'archetype.fighter',
  mage: 'archetype.mage',
  merchant: 'archetype.merchant',
  monk: 'archetype.monk',
  necromancer: 'archetype.necromancer',
  paladin: 'archetype.paladin',
  rogue: 'archetype.rogue'
};

/** Only these archetypes rise above Devotee when worshipping (core rulebook p. 163). */
export const CLERGY_ARCHETYPE_TAGS = Object.freeze([ARCHETYPE_TO_TAG.cleric, ARCHETYPE_TO_TAG.paladin]);

/** Worship tags (core rulebook pp. 163-164, 312-314). The engine derives `active` and the tier tags from a deity bond. */
export const WORSHIP_TAGS = Object.freeze({
  active: 'worship.active', boon: 'worship.boon', smite: 'worship.smite',
  benefit: 'worship.benefit', divine: 'worship.divine', fallen: 'worship.fallen'
});
export const WORSHIP_TIER_TAG_PREFIX = 'worship.tier.';
export const WORSHIPS_TAG_PREFIX = 'worships.';
export const BLESSED_TAG_PREFIX = 'blessed.';
export const TEMPLE_ACCESS_TAG_PREFIX = 'access.temple.';
/** Access to the Champions' Club (p. 164): a worshipper's standing gift carries it. */
export const CHAMPIONS_CLUB_ACCESS_TAG = 'access.club.champions';
/** Bard patronage (core rulebook pp. 145-146, 315). */
export const PATRON_TAGS = Object.freeze({ eligible: 'access.patron', required: 'rule.patron-required' });
/** The access a would-be patron needs (p. 315): the two clubs the book names (the archive's neutral ids), membership of
 *  every club (which includes both), a guild with outreach centres, and an outreach PR agent. */
export const PATRON_ACCESS_TAGS = Object.freeze([
  CHAMPIONS_CLUB_ACCESS_TAG, 'access.club.outlaws', 'access.club.all_memberships', 'access.guild.outreach', 'access.agency.outreach_pr'
]);
/** Per-god tag families: one tag per deity identifier, registered when a deity exists (`hooks/deity-tags.mjs`). */
export const DEITY_TAG_FAMILIES = Object.freeze([
  { prefix: WORSHIPS_TAG_PREFIX, namespace: 'worships', label: 'Worships' },
  { prefix: BLESSED_TAG_PREFIX, namespace: 'blessed', label: 'Blessed by' },
  { prefix: TEMPLE_ACCESS_TAG_PREFIX, namespace: 'access', label: 'Temple of' }
]);

/**
 * Convert damage type string to element tag.
 * @param {string} damageType
 * @returns {string|null}
 */
export function damageTypeToElement(damageType) {
  if (!damageType || typeof damageType !== 'string') return null;
  const key = damageType.trim().toLowerCase();
  return DAMAGE_TYPE_TO_ELEMENT[key] || null;
}

/**
 * The `element.<type>` tag id a stored element reference names: an element tag id, or (leniently) a damage type
 * name such as "Fire" or "cold". Empty string for blank or unknown values (= any damage).
 * @param {*} raw
 * @returns {string}
 */
export function normalizeElementTag(raw) {
  let val = firstScalar(raw);
  if (typeof val !== 'string') return '';
  val = val.trim();
  if (!val) return '';
  if (val.startsWith('element.')) return val;
  return damageTypeToElement(val) || '';
}

/**
 * Convert element tag to canonical damage type string.
 * @param {string} elementTag
 * @returns {string|null}
 */
export function elementToDamageType(elementTag) {
  if (!elementTag || typeof elementTag !== 'string') return null;
  return ELEMENT_TO_DAMAGE_TYPE[elementTag.trim()] || null;
}

/** The tag of a skill that attacks with a wielded weapon (every weapon entry is its own skill). */
export const WEAPON_SKILL_TAG = 'skillGroup.weapon';

/** Default thresholds for the fixed rank-break slots (used when rb.rank is unset) */
export const RANK_BREAK_THRESHOLDS = Object.freeze({ rank5: 5, rank10: 10, rank15: 15, rank20: 20 });

/**
 * The identity tag of an item of `type` with `identifier` (`id.<type>.<identifier>`), as `getItemAllTags` derives it.
 * A reference that already is an identity tag of that type is returned unchanged.
 * @param {string} type item type, e.g. 'skill'
 * @param {string} identifier
 * @returns {string} '' when the identifier is empty
 */
export function identityTag(type, identifier) {
  const id = String(identifier ?? '').trim();
  if (!id) return '';
  const prefix = ['id', type, ''].join('.');
  return id.startsWith(prefix) ? id : `${prefix}${id}`;
}
