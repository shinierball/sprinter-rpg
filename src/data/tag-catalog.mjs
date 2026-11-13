import { COG_OUTCOME_CONFIG } from '../documents/session/roll-outcomes.mjs';
import {
  AIMING_CONDITION, CONTEST_TAGS, ENGINE_SITUATIONS, HEALTH_FRACTION_STEPS, healthFractionTag, OUTCOME_TAGS, SAME_SIZE_SITUATION, VEHICLE_TAGS,
  PATRON_ACCESS_TAGS, PATRON_TAGS, WORSHIP_TAGS, WORSHIP_TIER_TAG_PREFIX
} from './tag-vocabulary.mjs';

/** Label and text of each access a would-be patron may hold, by tag id (`PATRON_ACCESS_TAGS`, core rulebook p. 315). */
const PATRON_ACCESS_DEFINITIONS = Object.freeze({
  'access.club.champions': { label: 'Access: Champions\' Club', description: 'Access to the champions\' club.' },
  'access.club.outlaws': { label: 'Access: Outlaws\' Club', description: 'Access to the outlaws\' club.' },
  'access.club.all_memberships': { label: 'Access: All Membership Clubs', description: 'Gets into every club that sells memberships, whether or not you hold one.' },
  'access.guild.outreach': { label: 'Access: Guild Outreach Centre', description: 'Belongs to, or can use, a guild with outreach centres.' },
  'access.agency.outreach_pr': { label: 'Access: Outreach PR Agent', description: 'Has a crawler outreach PR agent.' }
});

/** Spell schools (3.58 D6b), id suffix and label. Descriptive: the GM adjudicates, no mechanic reads them. */
const SPELL_SCHOOLS = Object.freeze([
  ['healing', 'Healing'], ['mind_control', 'Mind Control'], ['buff', 'Buff'], ['debuff', 'Debuff'], ['entangle', 'Entangle'],
  ['illusion', 'Illusion'], ['shield', 'Shield'], ['detection', 'Detection'], ['protection', 'Protection'], ['teleportation', 'Teleportation'],
  ['reanimation', 'Reanimation'], ['force_field', 'Force Field'], ['illumination', 'Illumination'], ['detonation', 'Detonation'],
  ['utility', 'Utility'], ['defense', 'Defense']
]);

/** One school tag; the description's "a"/"an" follows the first letter of the school's name. */
function schoolTag([suffix, label]) {
  const name = label.toLowerCase();
  const article = 'aeiou'.includes(name[0]) ? 'An' : 'A';
  return { id: `school.${suffix}`, label, namespace: 'school', description: `${article} ${name} spell. A label for the table; the system does not apply it.`, descriptive: true };
}

/**
 * The built-in tag definitions. Data only; lookups and registration live in `tag-definitions.mjs`.
 */
export const COG_TAGS = [
  // --- Kinds ---
  { id: 'kind.spell', label: 'Spell', namespace: 'kind', description: 'Derived on every spell item from its type, so a tag query can name spells.' },
  { id: 'kind.skill', label: 'Skill', namespace: 'kind', description: 'Derived on every Skill item from its type, so a tag query can name Skills.' },
  { id: 'kind.attack', label: 'Attack', namespace: 'kind', description: 'Derived on every attack item from its type. An attack item is a strike with its own damage, kept apart from Skills and gear.' },
  { id: 'kind.weapon', label: 'Weapon', namespace: 'kind', description: 'Derived on gear that is a weapon: its isWeapon flag is set, or its gear category is weapon.' },
  { id: 'kind.armor', label: 'Armor', namespace: 'kind', description: 'Armour gear. Nothing derives it: it is stored on the armour, and a crafting blueprint can name it as a target.' },
  { id: 'kind.gear', label: 'Gear', namespace: 'kind', description: 'Derived on every gear item from its type, so a tag query can name gear.' },
  { id: 'kind.loot', label: 'Loot', namespace: 'kind', description: 'Derived on every loot item from its type. Its usage tags (usage.*) say whether it is used up.' },
  { id: 'kind.class', label: 'Class', namespace: 'kind', description: 'Derived on every class item from its type, so a tag query can name a class.' },
  { id: 'kind.race', label: 'Race', namespace: 'kind', description: 'Derived on every race item from its type, so a tag query can name a race.' },
  { id: 'kind.deity', label: 'Deity', namespace: 'kind', description: 'Derived on every deity item from its type, so a tag query can name a deity.' },
  { id: 'kind.buff', label: 'Buff', namespace: 'kind', description: 'Derived on every buff item from its type, so a tag query can name buffs.' },
  { id: 'kind.debuff', label: 'Debuff', namespace: 'kind', description: 'Derived on every debuff item from its type, so a tag query can name debuffs.' },
  { id: 'kind.achievement', label: 'Achievement', namespace: 'kind', description: 'Derived on every achievement item from its type, so a tag query can name achievements.' },
  { id: 'kind.pet', label: 'Pet Companion', namespace: 'kind', description: 'Derived on every pet actor from its type, so a tag query can name Pet Companions.' },
  { id: 'kind.vehicle', label: 'Vehicle', namespace: 'kind', description: 'Names a vehicle. Nothing derives it and no reader uses it yet: a vehicle is the mount or vehicle actor (kind.mount_vehicle).' },
  { id: 'kind.mount', label: 'Mount', namespace: 'kind', description: 'Names a mount. Nothing derives it from a type: it is stored by hand on a companion that is a mount.' },
  { id: 'kind.personal_space', label: 'Personal Space', namespace: 'kind', description: 'Derived on every Personal Space actor from its type. Its space type tag is derived with it.' },
  { id: 'kind.patron', label: 'Patron', namespace: 'kind', description: 'Derived on every patron item from its type, so a tag query can name patrons. A patron never adds tags or rows to the crawler that holds it.' },
  { id: 'kind.sponsor', label: 'Sponsor', namespace: 'kind', description: 'Derived on every sponsor item from its type, so a tag query can name sponsors. A sponsor held by a crawler is an identity carrier: it adds this tag and no bonuses.' },
  { id: 'kind.space_upgrade', label: 'Space Upgrade (item type)', namespace: 'kind', description: 'Derived on every Personal Space upgrade item from its type, beside kind.upgrade.' },
  { id: 'kind.upgrade', label: 'Space Upgrade', namespace: 'kind', description: 'Derived on a Personal Space upgrade item. Its upgrade type tag is derived with it.' },
  { id: 'kind.technique', label: 'Combat Technique', namespace: 'kind', description: 'Derived on a Skill that is a Combat Technique (it modifies attacks). A technique is never the Skill an attack is matched to.' },
  { id: 'kind.core', label: 'Core Action', namespace: 'kind', description: 'A core action that every crawler has (Intervene, Call a Play). It has no Ranks and is stored on the Skill, not derived.', flags: ['no-ranks'] },
  // Derived from the actor type (`collectActorTags`, documents/active-tags.mjs); registered so tag pickers can offer them.
  { id: 'kind.crawler', label: 'Crawler', namespace: 'kind', description: 'Derived on every crawler actor from its type, so a tag query can name crawlers.' },
  { id: 'kind.mob', label: 'Mob', namespace: 'kind', description: 'Derived on every mob actor from its type, so a tag query can name mobs.' },
  { id: 'kind.npc', label: 'NPC / Creature', namespace: 'kind', description: 'Derived on every NPC or creature actor from its type, so a tag query can name NPCs.' },
  { id: 'kind.mercenary', label: 'Mercenary', namespace: 'kind', description: 'Derived on every mercenary actor from its type, so a tag query can name mercenaries.' },
  { id: 'kind.mount_vehicle', label: 'Mount / Vehicle', namespace: 'kind', description: 'Derived on every mount or vehicle actor from its type.' },
  { id: 'kind.marker', label: 'Light Marker', namespace: 'kind', description: 'Derived on every light marker actor from its type.' },

  // --- Spaces & Safe Rooms ---
  { id: 'space.single_room', label: 'Single-Room Safe Room', namespace: 'space' },
  { id: 'space.apartment', label: '1-Bedroom Apartment', namespace: 'space' },
  { id: 'space.bunker', label: 'Reinforced Bunker', namespace: 'space' },
  { id: 'space.suite', label: 'Penthouse Sponsor Suite', namespace: 'space' },
  { id: 'space.guild_hall', label: 'Guild Safe House', namespace: 'space' },
  { id: 'space.safe_room', label: 'Certified Safe Room', namespace: 'space' },
  { id: 'space.coupon.rank', label: 'Personal Space Coupon', namespace: 'space', description: 'Loot spent for one Rank Up of a personal space.' },
  { id: 'scene.safe_room', label: 'Safe Room Scene', namespace: 'scene', description: 'A scene where crawlers open loot boxes without a Rule Break. Set by the Safe Room checkbox in Scene Config.' },

  // --- Space Upgrades ---
  { id: 'upgrade.rest', label: 'Rest & Recovery Upgrade', namespace: 'upgrade' },
  { id: 'upgrade.training', label: 'Skill & Spell Training Upgrade', namespace: 'upgrade' },
  { id: 'upgrade.quest_board', label: 'Job & Quest Terminal', namespace: 'upgrade' },
  { id: 'upgrade.comms', label: 'Outside World Broadcast & Comms', namespace: 'upgrade' },
  { id: 'upgrade.defense', label: 'Security & Blast Doors', namespace: 'upgrade' },
  { id: 'upgrade.stash_expansion', label: 'Stash & Vault Storage Expansion', namespace: 'upgrade' },
  { id: 'upgrade.crafting_table', label: 'Crafting Table', namespace: 'upgrade' },
  { id: 'upgrade.studio', label: 'Studio', namespace: 'upgrade', description: 'An upgrade bought for one table type (system.studio.tableTypeTag): its crafting rows apply to a craft that uses a table of that type. It takes no table space and wants a space of rank 2 or more.' },

  // --- Companions & Assets ---
  // Derived from a race's heritage (D8, never stored); descriptive: a class may require one, nothing else reads it.
  { id: 'heritage.earth', label: 'Earth Heritage', namespace: 'heritage', description: 'The race comes from Earth.', descriptive: true },
  { id: 'heritage.alien', label: 'Alien Heritage', namespace: 'heritage', description: 'The race comes from another world.', descriptive: true },
  { id: 'heritage.pet', label: 'Pet Heritage', namespace: 'heritage', description: 'The race is a pet or companion race (the engine reads companion.pet for that).', descriptive: true },
  { id: 'race.form', label: 'Transformation Form', namespace: 'race', description: 'The race is only a form an affliction changes a victim into. Race pickers leave it out; applying it by hand still works.' },
  { id: 'companion.pet', label: 'Pet Companion', namespace: 'companion' },
  { id: 'companion.vehicle', label: 'Vehicle', namespace: 'companion' },
  { id: 'companion.mount', label: 'Mount / Beast of Burden', namespace: 'companion', flags: ['mount'] },

  // --- Species (a crawler's origin at induction, written by the crawler creator; not a race) ---
  { id: 'species.human', label: 'Human Crawler', namespace: 'species' },
  { id: 'species.animal', label: 'Animal Crawler', namespace: 'species' },
  { id: 'species.crawler', label: 'Generic Crawler', namespace: 'species' },

  // --- Crew & Handler Roles ---
  { id: 'role.pilot', label: 'Pilot / Driver', namespace: 'role' },
  { id: 'role.rider', label: 'Rider / Mounted', namespace: 'role', flags: ['mount'] },
  { id: 'role.passenger', label: 'Passenger', namespace: 'role' },
  { id: 'role.gunner', label: 'Gunner / Operator', namespace: 'role' },
  { id: 'role.handler', label: 'Pet Handler', namespace: 'role' },
  // Mercenary combat roles (descriptive: the bundled mercenaries label their gear and skills with them).
  { id: 'role.tank', label: 'Tank', namespace: 'role', description: 'A mercenary who holds the front line and draws attacks.', descriptive: true },
  { id: 'role.healer', label: 'Healer', namespace: 'role', description: 'A mercenary who heals and supports allies.', descriptive: true },
  { id: 'role.scout', label: 'Scout', namespace: 'role', description: 'A mercenary who scouts ahead and strikes from range or stealth.', descriptive: true },
  { id: 'role.dps', label: 'Damage Dealer', namespace: 'role', description: 'A mercenary whose job is dealing damage.', descriptive: true },

  // Spell schools (3.58 D6b): the labels spells carried in `damageType` and the old spell type. Descriptive: the GM adjudicates, no mechanic reads them.
  ...SPELL_SCHOOLS.map(schoolTag),

  // Descriptive point-build tags (3.6a R2): the core benefits and detriments carry them; no engine reader. The bundled provider restyles them.
  // --- Worship (derived from a deity bond; carried by boons and smites) ---
  { id: WORSHIP_TAGS.active, label: 'Worshipping', namespace: 'worship', description: 'Derived on an actor that worships a deity.' },
  { id: `${WORSHIP_TIER_TAG_PREFIX}1`, label: 'Worship Tier: Acolyte', namespace: 'worship', description: 'Derived on an actor that worships at the Acolyte tier.' },
  { id: `${WORSHIP_TIER_TAG_PREFIX}2`, label: 'Worship Tier: Devotee', namespace: 'worship', description: 'Derived on an actor that worships at the Devotee tier.' },
  { id: `${WORSHIP_TIER_TAG_PREFIX}3`, label: 'Worship Tier: Zealot', namespace: 'worship', description: 'Derived on an actor that worships at the Zealot tier.' },
  { id: WORSHIP_TAGS.boon, label: 'Divine Boon', namespace: 'worship', description: 'Marks a buff as a boon from a deity.' },
  { id: WORSHIP_TAGS.smite, label: 'Divine Smite', namespace: 'worship', description: 'Marks a debuff as a smite from a deity.' },
  { id: WORSHIP_TAGS.benefit, label: 'Worship Benefit', namespace: 'worship', description: 'Marks a buff as a benefit of worship (a tier gift or the signature gift); a deity\'s debuff can suppress it.' },
  { id: WORSHIP_TAGS.divine, label: 'Divine Debuff', namespace: 'worship', qualifiesName: true, description: 'Marks a debuff a deity lays on a worshipper who missed offerings.' },
  { id: WORSHIP_TAGS.fallen, label: 'Fallen Worshipper', namespace: 'worship', description: 'Marks a debuff laid on a worshipper who missed too many offerings.' },
  { id: 'access.saferoom.free_room', label: 'Free Safe Room Lodging', namespace: 'access', description: 'Gets a private room in any safe room without paying for it.', descriptive: true },
  { id: 'access.guild.weapon_training', label: 'Guild Access: Weapon Training', namespace: 'access', description: 'May use any guild that teaches weapon skills, on every floor.', descriptive: true },
  { id: 'rule.store_discount', label: 'Trade Perk', namespace: 'rule', description: 'Pays less at shops, earns more when selling, or collects extra bank interest (the item description says which, and how much).', descriptive: true },
  { id: 'rule.kill_bounty', label: 'Kill Bounty', namespace: 'rule', description: 'A mob slain in the way the item names drops bonus gold equal to the Floor Number (the item description names the way).', descriptive: true },
  { id: 'rule.flight_limited', label: 'Limited Flight', namespace: 'rule', description: 'Flies only within a limit per scene, such as time, distance or gliding (the item description says which). The Fly speed is a structured value; the GM enforces the limit.', descriptive: true },
  { id: 'rule.no_breath', label: 'Does Not Breathe', namespace: 'rule', description: 'Has no need for air at all.', descriptive: true },
  { id: 'rule.limb_regeneration', label: 'Limb Regrowth', namespace: 'rule', description: 'One missing limb grows back completely over a span of 12 days, shortened by a number of days equal to the Con Mod.', descriptive: true },
  { id: 'rule.immunity_disease', label: 'Immune to Disease', namespace: 'rule', description: 'Cannot catch or suffer from any disease.', descriptive: true },
  { id: 'sense.water_breathing', label: 'Water Breathing', namespace: 'sense', description: 'Breathes water as easily as air.', descriptive: true },

  // --- Actions ---
  { id: 'action.attack', label: 'Attack', namespace: 'action' },
  { id: 'action.heal', label: 'Heal', namespace: 'action' },
  { id: 'action.restore', label: 'Restore / Refill', namespace: 'action' },
  { id: 'action.passive', label: 'Passive', namespace: 'action' },
  { id: 'action.interrupt', label: 'Interrupt', namespace: 'action' },
  { id: 'action.free_interrupt', label: 'Free Interrupt (0 Actions)', namespace: 'action' },
  { id: 'action.hot', label: 'Heal Over Time (HoT)', namespace: 'action' },
  { id: 'action.cleanse', label: 'Cleanse Debuff', namespace: 'action' },
  { id: 'action.armor_piercing', label: 'Armor Piercing', namespace: 'action', flags: ['ignores-dr'] },
  { id: 'action.ignore_dr', label: 'Ignore Damage Resistance', namespace: 'action', flags: ['ignores-dr'] },
  { id: 'action.contested', label: 'Contested Check', namespace: 'action' },
  { id: 'action.opposed', label: 'Opposed Contest', namespace: 'action' },
  { id: 'action.inflict_debuff', label: 'Inflict Debuff / Condition', namespace: 'action' },
  { id: 'action.summon', label: 'Summon Minion / Companion', namespace: 'action', description: 'Descriptive: the GM rules on the summoned creature; the system does not create it.', descriptive: true },
  { id: 'action.displacement', label: 'Forced Movement / Knockback', namespace: 'action', description: 'Descriptive: the GM moves the target; the system applies no forced movement.', descriptive: true },
  { id: 'action.teleport', label: 'Teleportation', namespace: 'action', description: 'Descriptive: the GM moves the creature; the system does not teleport tokens.', descriptive: true },
  { id: 'action.drain', label: 'Life Drain / Siphon', namespace: 'action', description: 'Descriptive: the GM rules on the drain; use a Life Drain heal on the hit for the structured version.', descriptive: true },
  { id: 'action.dispel', label: 'Dispel / Purge Buffs', namespace: 'action' },

  // --- Item usage (3.76): how an item is used up. Read by itemUsage() in tag-mechanics.mjs. ---
  { id: 'usage.reusable', label: 'Reusable', namespace: 'usage', description: 'Using it changes nothing: no quantity, no charges. Gear is reusable unless it has charges.' },
  { id: 'usage.rechargeable', label: 'Rechargeable', namespace: 'usage', description: 'Each use spends a charge. At 0 charges it still works as a Rule Break, and something can recharge it. Anything with a maximum charge count is rechargeable unless tagged otherwise.' },
  { id: 'usage.consumable', label: 'Consumable', namespace: 'usage', description: 'Each use spends one unit (or one charge). Loot is consumable unless it has charges.' },

  { id: 'usage.restorable', label: 'Restorable', namespace: 'usage', description: 'The junk it leaves when used up remembers what it was, shows it, and stacks only with junk of the same origin. Only such junk can be restored by a recharge.' },
  // --- Crafting materials (3.76 B2; the crafting rules, row 3.15, read them): what a used-up consumable leaves behind. ---
  { id: 'material.crafting', label: 'Crafting Material', namespace: 'material', description: 'Loot that crafting can use as a reagent.' },
  { id: 'material.misc_junk', label: 'Misc. Junk', namespace: 'material', description: 'The baseline crafting reagent: broken, empty or burnt leftovers.' },

  // --- Crafting (3.15): tables, coupons, the step being rolled, material and item state. ---
  { id: 'crafting.table.alchemist', label: 'Alchemy Table', namespace: 'crafting', description: 'A crafting table for potions and reagents.' },
  { id: 'crafting.table.arcanist', label: 'Arcanist Table', namespace: 'crafting', description: 'A crafting table for scrolls and magical work.' },
  { id: 'crafting.table.blacksmith', label: 'Smithing Table', namespace: 'crafting', description: 'A crafting table for weapons and armor.' },
  { id: 'crafting.table.tattoo', label: 'Tattoo Table', namespace: 'crafting', description: 'A crafting table for tattoos.' },
  { id: 'crafting.table.makeup', label: 'Makeup Table', namespace: 'crafting', description: 'A crafting table for makeup and cosmetics.' },
  { id: 'crafting.table.tinkerer', label: 'Workbench', namespace: 'crafting', description: 'A crafting table for gadgets and mechanisms.' },
  { id: 'crafting.table.props', label: 'Prop Shop Table', namespace: 'crafting', description: 'A crafting table for props and costumes.' },
  { id: 'crafting.coupon.table', label: 'Table Upgrade Coupon', namespace: 'crafting', description: 'Loot that adds one tier to a crafting table when applied.' },
  { id: 'crafting.mode.mundane', label: 'Crafting a Plain Item', namespace: 'crafting', engine: true, description: 'Set by the engine on the check that builds the base item.' },
  { id: 'crafting.mode.enchant', label: 'Crafting an Enchantment', namespace: 'crafting', engine: true, description: 'Set by the engine on a check that applies an enchantment to an item.' },
  { id: 'crafting.mode.item', label: 'Crafting an Item', namespace: 'crafting', engine: true, description: 'Set by the engine on a check made for a blueprint that makes a new item.' },
  { id: 'material.unsalvageable', label: 'Unsalvageable Material', namespace: 'material', description: 'A crafting material that is never given back when a craft fails.' },
  { id: 'item.broken', label: 'Broken', namespace: 'item', description: 'The item is broken. It can be repaired.' },
  { id: 'item.destroyed', label: 'Destroyed', namespace: 'item', description: 'The item is destroyed and cannot be repaired.' },
  { id: 'item.trap', label: 'Trap', namespace: 'item', description: 'A trap. Crafting rows may test it on the item being made.' },
  { id: 'item.explosive', label: 'Explosive', namespace: 'item', description: 'An explosive device. Crafting rows may test it on the item being made.' },

  // --- Vehicles (3.44; the vehicle rules read them: src/data/rules/vehicle-rules.mjs) ---
  { id: VEHICLE_TAGS.skillDriving, label: 'Drives Wheeled Vehicles', namespace: 'vehicle', description: 'A skill that drives vehicles with three or more wheels or tracks. A vehicle kind finds its driving skill by this tag.' },
  { id: VEHICLE_TAGS.skillChopper, label: 'Drives Two-Wheeled Vehicles', namespace: 'vehicle', description: 'A skill that drives motorcycles and the like. A vehicle kind finds its driving skill by this tag.' },
  { id: `${VEHICLE_TAGS.kindPrefix}wheeled`, label: 'Wheeled Vehicle', namespace: 'vehicle', engine: true, description: 'Derived on a vehicle of this kind.' },
  { id: `${VEHICLE_TAGS.kindPrefix}two_wheeled`, label: 'Two-Wheeled Vehicle', namespace: 'vehicle', engine: true, description: 'Derived on a vehicle of this kind.' },
  { id: `${VEHICLE_TAGS.kindPrefix}other`, label: 'Other Vehicle', namespace: 'vehicle', engine: true, description: 'Derived on a vehicle of this kind.' },
  { id: `${VEHICLE_TAGS.upgradePrefix}armor`, label: 'Vehicle Armor', namespace: 'vehicle', description: 'Gear installed on a vehicle as armor.' },
  { id: `${VEHICLE_TAGS.upgradePrefix}mounted_weapon`, label: 'Vehicle Mounted Weapon', namespace: 'vehicle', description: 'Gear installed on a vehicle as a mounted weapon.' },
  { id: `${VEHICLE_TAGS.upgradePrefix}speed`, label: 'Vehicle Speed Upgrade', namespace: 'vehicle', description: 'Gear installed on a vehicle to make it faster.' },
  { id: `${VEHICLE_TAGS.upgradePrefix}magic`, label: 'Vehicle Magic Upgrade', namespace: 'vehicle', description: 'Gear installed on a vehicle that works magic on its driving.' },
  { id: `${VEHICLE_TAGS.upgradePrefix}style`, label: 'Vehicle Style Upgrade', namespace: 'vehicle', description: 'Gear installed on a vehicle for show.' },
  { id: `${VEHICLE_TAGS.checkPrefix}performance`, label: 'Vehicle Performance Check', namespace: 'vehicle', engine: true, description: 'Set by the engine on a driving check that decides how the vehicle performs this round.' },
  { id: `${VEHICLE_TAGS.checkPrefix}decelerate`, label: 'Vehicle Deceleration Check', namespace: 'vehicle', engine: true, description: 'Set by the engine on a check to stop the vehicle where the driver wants.' },
  { id: `${VEHICLE_TAGS.checkPrefix}ram`, label: 'Vehicle Ram', namespace: 'vehicle', engine: true, description: 'Set by the engine on a ram, its damage and the Evade against it.' },
  { id: `${VEHICLE_TAGS.checkPrefix}board`, label: 'Vehicle Boarding Check', namespace: 'vehicle', engine: true, description: 'Set by the engine on the Dex check to board a moving vehicle.' },
  { id: `${VEHICLE_TAGS.checkPrefix}contest`, label: 'Vehicle Contest Leg', namespace: 'vehicle', engine: true, description: 'Set by the engine on a race or chase leg driven in a vehicle.' },
  { id: `${VEHICLE_TAGS.checkPrefix}weapon`, label: 'Vehicle Weapon Shot', namespace: 'vehicle', engine: true, description: 'Set by the engine on an attack with a vehicle-mounted weapon.' },
  { id: `${VEHICLE_TAGS.checkPrefix}evade`, label: 'Vehicle Evade', namespace: 'vehicle', engine: true, description: 'Set by the engine on a driver\'s check to dodge an attack on the vehicle.' },
  { id: VEHICLE_TAGS.explosion, label: 'Vehicle Explosion', namespace: 'vehicle', engine: true, description: 'Set by the engine on the damage of an exploding vehicle; the vehicle\'s DR does not protect against it.' },
  { id: VEHICLE_TAGS.driving, label: 'Driving a Moving Vehicle', namespace: 'situation', engine: true, description: 'Set by the engine on the rolls of a vehicle\'s driver while it moves.' },
  { id: VEHICLE_TAGS.headOn, label: 'Head-On or From Behind', namespace: 'situation', description: 'The attack or Evade is straight ahead of or behind a vehicle, so its speed does not count.' },
  { id: VEHICLE_TAGS.mountedOnly, label: 'Mounted Use Only', namespace: 'rule', flags: ['mounted-only'], description: 'A weapon made for use while mounted or driving; a driver uses it without Disadvantage.' },

  // --- Contests ---
  { id: CONTEST_TAGS.race, label: 'Race Check', namespace: 'contest', engine: true, description: 'Set by the engine on a check made for a leg of a race.' },
  { id: CONTEST_TAGS.chase, label: 'Chase Check', namespace: 'contest', engine: true, description: 'Set by the engine on a check made for a leg of a chase.' },
  { id: 'contest.dc', label: 'DC Challenge', namespace: 'contest' },
  { id: 'contest.opposed', label: 'Opposed Roll', namespace: 'contest' },
  { id: 'contest.str', label: 'vs Strength', namespace: 'contest' },
  { id: 'contest.dex', label: 'vs Dexterity', namespace: 'contest' },
  { id: 'contest.con', label: 'vs Constitution', namespace: 'contest' },
  { id: 'contest.int', label: 'vs Intelligence', namespace: 'contest' },
  { id: 'contest.cha', label: 'vs Charisma', namespace: 'contest' },

  // --- Resources ---
  { id: 'resource.mana', label: 'Mana Points', namespace: 'resource' },
  { id: 'resource.hp-bars', label: 'Health Bars', namespace: 'resource' },
  { id: 'resource.temp-bars', label: 'Temporary Health Bars', namespace: 'resource' },
  // Derived per actor from its Hit Points (healthFractionTags); read as subject.resource.health_N for a target
  ...HEALTH_FRACTION_STEPS.map(n => ({ id: healthFractionTag(n), label: `At ${n}% Health Bar or Less`, namespace: 'resource' })),

  // --- Damage / Elements ---
  { id: 'element.fire', label: 'Fire', namespace: 'element' },
  { id: 'element.ice', label: 'Ice', namespace: 'element' },
  { id: 'element.electric', label: 'Electric', namespace: 'element' },
  { id: 'element.acid', label: 'Acid', namespace: 'element' },
  { id: 'element.poison', label: 'Poison', namespace: 'element' },
  { id: 'element.force', label: 'Force', namespace: 'element' },
  { id: 'element.sonic', label: 'Sonic', namespace: 'element' },
  { id: 'element.holy', label: 'Holy', namespace: 'element' },
  { id: 'element.necrotic', label: 'Necrotic', namespace: 'element' },
  { id: 'element.psychic', label: 'Psychic', namespace: 'element' },
  { id: 'element.bludgeoning', label: 'Bludgeoning', namespace: 'element' },
  { id: 'element.piercing', label: 'Piercing', namespace: 'element' },
  { id: 'element.slashing', label: 'Slashing', namespace: 'element' },
  { id: 'element.brimstone', label: 'Brimstone', namespace: 'element' },

  // --- Area / Shapes ---
  { id: 'shape.aoe', label: 'Area of Effect', namespace: 'shape', flags: ['area'] },
  // The `area` block is the shape's geometry: `anchor` caster|point, `size` radius|length (which item fields size
  // it), `region` the Foundry Region shape builder key, `defaults` the fixed numbers (cone angle, line width). The
  // `area` flag is separate: it marks an attack-area (Evade, templates); `shape.wall` has geometry but not the flag.
  { id: 'shape.burst', label: 'Burst', namespace: 'shape', flags: ['area'], area: { anchor: 'caster', size: 'radius', region: 'burst', defaults: {} } },
  { id: 'shape.blast', label: 'Blast', namespace: 'shape', flags: ['area'], area: { anchor: 'point', size: 'radius', region: 'circle', defaults: {} } },
  { id: 'shape.cone', label: 'Cone', namespace: 'shape', flags: ['area'], area: { anchor: 'caster', size: 'radius', region: 'cone', defaults: { angle: 60 } } },
  { id: 'shape.line', label: 'Line', namespace: 'shape', flags: ['area'], area: { anchor: 'caster', size: 'length', region: 'line', defaults: { width: 5 } } },
  { id: 'shape.wall', label: 'Wall / Linear Barrier', namespace: 'shape', area: { anchor: 'point', size: 'length', region: 'line', defaults: { width: 5 } } },
  { id: 'shape.rect', label: 'Rectangle', namespace: 'shape', flags: ['area'], area: { anchor: 'point', size: 'length', region: 'rectangle', defaults: { width: 5 } } },
  { id: 'shape.splash', label: 'Splash', namespace: 'shape', flags: ['area'] },
  { id: 'shape.single', label: 'Single Target', namespace: 'shape' },
  { id: 'shape.aura', label: 'Aura', namespace: 'shape' },

  // --- Delivery Modes ---
  { id: 'delivery.placed', label: 'Placed Area', namespace: 'delivery' },
  { id: 'delivery.aura', label: 'Aura (Token Follower)', namespace: 'delivery' },
  { id: 'delivery.self', label: 'Self', namespace: 'delivery' },
  { id: 'delivery.target', label: 'Target Creature', namespace: 'delivery' },
  { id: 'delivery.burst', label: 'Burst', namespace: 'delivery' },

  // --- Duration Types ---
  { id: 'duration.instant', label: 'Instantaneous', namespace: 'duration' },
  { id: 'duration.rounds', label: 'Combat Rounds', namespace: 'duration' },
  { id: 'duration.minutes', label: 'Minutes', namespace: 'duration' },
  { id: 'duration.hours', label: 'Hours', namespace: 'duration' },
  { id: 'duration.next_check', label: 'Until the next Check', namespace: 'duration' },
  { id: 'duration.next_action', label: 'Until the next Action', namespace: 'duration' },
  { id: 'duration.combat', label: 'Until End of Combat', namespace: 'duration' },
  { id: 'duration.until_healed', label: 'Until healed', namespace: 'duration' },
  { id: 'duration.permanent', label: 'Permanent / Sustained', namespace: 'duration' },
  { id: 'duration.short_rest', label: 'Until a short rest', namespace: 'duration' },
  { id: 'duration.long_rest', label: 'Until a long rest', namespace: 'duration' },
  { id: 'duration.full_day_rest', label: "Until a full day's rest", namespace: 'duration' },

  // --- Target Filters ---
  { id: 'target.allies', label: 'Allies', namespace: 'target' },
  { id: 'target.enemies', label: 'Enemies', namespace: 'target' },
  { id: 'target.all', label: 'All Targets', namespace: 'target' },
  { id: 'target.self', label: 'Self Only', namespace: 'target' },
  { id: 'target.pet', label: 'Pet Target', namespace: 'target' },
  { id: 'target.mount', label: 'Mount Target', namespace: 'target' },
  { id: 'target.vehicle', label: 'Vehicle Target', namespace: 'target' },

  // --- Governing Stats ---
  { id: 'stat.str', label: 'Strength', namespace: 'stat' },
  { id: 'stat.dex', label: 'Dexterity', namespace: 'stat' },
  { id: 'stat.con', label: 'Constitution', namespace: 'stat' },
  { id: 'stat.int', label: 'Intelligence', namespace: 'stat' },
  { id: 'stat.cha', label: 'Charisma', namespace: 'stat' },

  // --- Class Archetypes ---
  { id: 'archetype.arcanist', label: 'Arcanist', namespace: 'archetype' },
  { id: 'archetype.barbarian', label: 'Barbarian', namespace: 'archetype' },
  { id: 'archetype.bard', label: 'Bard', namespace: 'archetype' },
  { id: 'archetype.cleric', label: 'Cleric', namespace: 'archetype' },
  { id: 'archetype.druid', label: 'Druid', namespace: 'archetype' },
  { id: 'archetype.fighter', label: 'Fighter', namespace: 'archetype' },
  { id: 'archetype.mage', label: 'Mage', namespace: 'archetype' },
  { id: 'archetype.merchant', label: 'Merchant', namespace: 'archetype' },
  { id: 'archetype.monk', label: 'Monk', namespace: 'archetype' },
  { id: 'archetype.necromancer', label: 'Necromancer', namespace: 'archetype' },
  { id: 'archetype.paladin', label: 'Paladin', namespace: 'archetype' },
  { id: 'archetype.rogue', label: 'Rogue', namespace: 'archetype' },

  // --- Favored Archetypes (references archetype.<name>) ---
  { id: 'favored.mage', label: 'Favored: Mage', namespace: 'favored', references: 'archetype.mage' },
  { id: 'favored.bard', label: 'Favored: Bard', namespace: 'favored', references: 'archetype.bard' },
  { id: 'favored.cleric', label: 'Favored: Cleric', namespace: 'favored', references: 'archetype.cleric' },
  { id: 'favored.paladin', label: 'Favored: Paladin', namespace: 'favored', references: 'archetype.paladin' },
  { id: 'favored.druid', label: 'Favored: Druid', namespace: 'favored', references: 'archetype.druid' },
  { id: 'favored.necromancer', label: 'Favored: Necromancer', namespace: 'favored', references: 'archetype.necromancer' },

  // --- Conditions / Debuffs ---
  { id: 'condition.burned', label: 'Burned', namespace: 'condition' },
  { id: 'condition.shocked', label: 'Shocked', namespace: 'condition' },
  { id: 'condition.poisoned', label: 'Poisoned', namespace: 'condition' },
  { id: 'condition.held', label: 'Held', namespace: 'condition' },
  { id: 'condition.stunned', label: 'Stunned', namespace: 'condition' },
  { id: 'condition.woozy', label: 'Woozy', namespace: 'condition' },
  { id: 'condition.queasy', label: 'Queasy', namespace: 'condition' },
  { id: 'condition.stiff_legs', label: 'Stiff Legs', namespace: 'condition' },
  { id: 'condition.sore_as_shit', label: 'Sore as Shit', namespace: 'condition' },
  { id: 'condition.muted', label: 'Muted', namespace: 'condition' },
  { id: 'condition.minor_injury', label: 'Minor Injury', namespace: 'condition' },
  { id: 'condition.major_injury', label: 'Major Injury', namespace: 'condition' },
  { id: 'condition.blinded', label: 'Blinded', namespace: 'condition' },
  { id: 'condition.blood_trail', label: 'Blood Trail', namespace: 'condition' },
  { id: 'condition.drowning', label: 'Drowning', namespace: 'condition' },
  { id: 'condition.dying', label: 'Dying', namespace: 'condition', flags: ['no-actions'] },
  { id: 'condition.dead', label: 'Dead', namespace: 'condition', flags: ['no-actions'] },
  { id: 'condition.enraged', label: 'Enraged', namespace: 'condition' },
  { id: 'condition.fatigued', label: 'Fatigued', namespace: 'condition' },
  { id: 'condition.paralyzed', label: 'Paralyzed', namespace: 'condition', flags: ['no-actions'] },
  { id: 'condition.sepsis', label: 'Sepsis', namespace: 'condition' },
  { id: 'condition.shit_faced', label: 'Shit-Faced', namespace: 'condition' },
  { id: 'condition.staggered', label: 'Staggered', namespace: 'condition' },
  { id: 'condition.take_down', label: 'Take Down', namespace: 'condition' },
  { id: 'condition.terrified', label: 'Terrified', namespace: 'condition' },
  { id: 'condition.charmed', label: 'Charmed', namespace: 'condition' },
  { id: 'condition.asleep', label: 'Asleep', namespace: 'condition' },
  { id: 'condition.fear', label: 'Fear', namespace: 'condition' },
  { id: 'condition.possession', label: 'Possession', namespace: 'condition', description: 'A possession effect (a spirit taking hold of the target); rows test it on the defender\'s check.' },
  { id: 'injury.minor', label: 'Minor Injury', namespace: 'injury' },
  { id: 'injury.major', label: 'Major Injury', namespace: 'injury' },
  { id: 'injury.long_term', label: 'Long-Term Injury', namespace: 'injury' },

  // --- Weapon Types ---
  { id: 'weapon.axe', label: 'Axe', namespace: 'weapon', description: 'Axe weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.bow', label: 'Bow', namespace: 'weapon', description: 'Bow weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.club', label: 'Club', namespace: 'weapon', description: 'Club weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.crossbow', label: 'Crossbow', namespace: 'weapon', description: 'Crossbow weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.dagger', label: 'Dagger', namespace: 'weapon', description: 'Dagger weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.handgun', label: 'Handgun', namespace: 'weapon', description: 'Handgun weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.herding_weapon', label: 'Herding Weapon', namespace: 'weapon', description: 'Herding Weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.herding_tools', label: 'Herding Tools', namespace: 'weapon', description: 'Herding Tools type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.improvised', label: 'Improvised Weapon', namespace: 'weapon', description: 'Improvised Weapon type: whatever is to hand. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.javelin', label: 'Javelin', namespace: 'weapon', description: 'Javelin weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.lance', label: 'Lance', namespace: 'weapon', description: 'Lance weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.longsword', label: 'Longsword', namespace: 'weapon', description: 'Longsword weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.polearm', label: 'Polearm', namespace: 'weapon', description: 'Polearm weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.quarterstaff', label: 'Quarterstaff', namespace: 'weapon', description: 'Quarterstaff weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.rapier', label: 'Rapier', namespace: 'weapon', description: 'Rapier weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.shotgun', label: 'Shotgun', namespace: 'weapon', description: 'Shotgun weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.shuriken', label: 'Shuriken', namespace: 'weapon', description: 'Shuriken weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.slingshot', label: 'Slingshot', namespace: 'weapon', description: 'Slingshot weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },
  { id: 'weapon.warhammer', label: 'Warhammer', namespace: 'weapon', description: 'Warhammer weapon type. A weapon of this type and the Skill that uses it share the tag, which is how the system finds that Skill for the weapon.' },

  // --- Weapon Categories ---
  { id: 'weaponClass.melee', label: 'Melee Weapon', namespace: 'weaponClass', description: 'Melee weapon category: a weapon held and used in close combat. A race or class choice that asks for a melee weapon reads this tag.' },
  { id: 'weaponClass.ranged', label: 'Ranged Weapon', namespace: 'weaponClass', description: 'Ranged weapon category. Aiming reads this tag (with weaponGroup.ranged), so a ranged attack counts for Aiming.' },
  { id: 'weaponClass.natural', label: 'Natural Attack', namespace: 'weaponClass', description: 'Natural attack category: a bite, claw or other body attack. It occupies no hand, so it takes no wield mode (the no-hands flag).', flags: ['no-hands'] },
  { id: 'weaponClass.unarmed', label: 'Unarmed Attack', namespace: 'weaponClass', description: 'Unarmed attack category: a strike with no weapon in hand. It occupies no hand, and a Skill carrying it is listed as an unarmed attack.', flags: ['no-hands'] },

  // --- Weapon Properties ---
  { id: 'weaponProp.reach', label: 'Reach', namespace: 'weaponProp', description: 'Descriptive: the weapon has reach; the GM checks it when a rule asks for a Reach weapon.', descriptive: true },
  { id: 'weaponProp.thrown', label: 'Thrown', namespace: 'weaponProp', description: 'Descriptive: the weapon can be thrown; the GM rules on throwing.', descriptive: true },

  // --- Weapon Groups ---
  { id: 'weaponGroup.power', label: 'Power Weapons', namespace: 'weaponGroup', description: 'Power Weapons group: a weapon and a Skill that share it match each other, and a Skill shows the group as its label.' },
  { id: 'weaponGroup.edge', label: 'Edge', namespace: 'weaponGroup', description: 'Edge group: a weapon and a Skill that share it match each other, and a Skill shows the group as its label. The Edge race and class choices ask for it.' },
  { id: 'weaponGroup.bashing', label: 'Bashing', namespace: 'weaponGroup', description: 'Bashing group: a weapon and a Skill that share it match each other, and a Skill shows the group as its label.' },
  { id: 'weaponGroup.reach', label: 'Reach', namespace: 'weaponGroup', description: 'Reach group: a weapon and a Skill that share it match each other, and a Skill shows the group as its label. The Reach race and class choices ask for it.' },
  { id: 'weaponGroup.ranged', label: 'Ranged', namespace: 'weaponGroup', description: 'Ranged group: a weapon and a Skill that share it match each other, and a Skill shows the group as its label. Aiming also reads it, as it reads weaponClass.ranged.' },
  { id: 'weaponGroup.hand_to_hand', label: 'Hand to Hand', namespace: 'weaponGroup', description: 'Hand to Hand group: a weapon and a Skill that share it match each other, and a Skill shows the group as its label.' },
  { id: 'weaponGroup.utility', label: 'Utility', namespace: 'weaponGroup', description: 'Utility group: a weapon and a Skill that share it match each other, and a Skill shows the group as its label.' },
  { id: 'weaponGroup.exotic', label: 'Exotic', namespace: 'weaponGroup', description: 'Exotic group: a weapon and a Skill that share it match each other, and a Skill shows the group as its label.' },

  // --- Wielding ---
  { id: 'wield.one_handed', label: 'One-Handed', namespace: 'wield' },
  { id: 'wield.two_handed', label: 'Two-Handed', namespace: 'wield' },

  // --- Skill Disciplines ---
  { id: 'skillGroup.animal', label: 'Animal Skill', namespace: 'skillGroup', description: 'An animal crawler or pet skill (Bite, Back Claw, Slice Attack). A crawler with an animal origin and a race that is not an animal cannot use it (Rule Break).' },
  { id: 'skillGroup.combat', label: 'Combat Skill', namespace: 'skillGroup' },
  { id: 'skillGroup.strike', label: 'Strike', namespace: 'skillGroup', description: 'A natural or improvised strike: a bite, claw, kick or slap. Not a weapon skill.', descriptive: true },
  { id: 'skillGroup.defensive', label: 'Defensive Skill', namespace: 'skillGroup', description: 'A skill used to avoid, block or absorb harm.', descriptive: true },
  { id: 'skillGroup.crafting', label: 'Crafting Skill', namespace: 'skillGroup' },
  { id: 'skillGroup.knowledge', label: 'Knowledge Skill', namespace: 'skillGroup' },
  { id: 'skillGroup.social', label: 'Social Skill', namespace: 'skillGroup' },
  { id: 'skillGroup.survival', label: 'Survival Skill', namespace: 'skillGroup' },
  { id: 'skillGroup.utility', label: 'Utility Skill', namespace: 'skillGroup' },
  { id: 'skillGroup.movement', label: 'Movement Skill', namespace: 'skillGroup' },
  { id: 'skillGroup.trap', label: 'Trap Skill', namespace: 'skillGroup' },
  { id: 'skillGroup.explosive', label: 'Explosive Skill', namespace: 'skillGroup' },
  { id: 'skillGroup.weapon', label: 'Weapon Skill', namespace: 'skillGroup', description: 'A skill that attacks with a wielded weapon (Club, Dagger, Bow, ...). Not Hand-to-Hand, Strike or pet skills.' },

  // --- Check types (context tags set by the roll paths) ---
  { id: 'check.skill', label: 'Skill Check', namespace: 'check' },
  { id: 'check.stat', label: 'Stat Check', namespace: 'check' },
  { id: 'check.evade', label: 'Evade Check', namespace: 'check' },
  { id: 'check.advancement', label: 'Skill Advancement Check', namespace: 'check' },
  { id: 'check.resist', label: 'Resistance Check', namespace: 'check' },
  { id: 'check.advancement.floor_end', label: 'End of Floor Advancement Check', namespace: 'check' },
  { id: 'check.attack', label: 'Attack Roll', namespace: 'check' },
  { id: 'check.spell', label: 'Spell Cast Roll', namespace: 'check' },
  { id: 'check.assist', label: 'Assist Roll', namespace: 'check' },
  { id: 'check.surprise', label: 'Surprise Check', namespace: 'check' },
  { id: VEHICLE_TAGS.check, label: 'Vehicle Check', namespace: 'check' },
  { id: 'check.crafting', label: 'Crafting Check', namespace: 'check', description: 'Set by the engine on a check made for a crafting step.' },

  // --- Roll outcomes (card condition tags; ids are the COG_ROLL_OUTCOMES keys) ---
  ...Object.entries(OUTCOME_TAGS)
    .map(([key, id]) => ({ id, label: COG_OUTCOME_CONFIG[key].label, namespace: 'outcome' })),

  // --- Situations (roll-dialog toggles) ---
  { id: ENGINE_SITUATIONS.intercepting, label: 'Catching a hit', namespace: 'situation', engine: true, description: 'Set on the defence of a hit the actor took for an ally (Catcher).' },
  { id: 'situation.aiming', label: 'Aiming', namespace: 'situation', flags: ['maneuver'] },
  { id: 'situation.used_tactics', label: 'Used Tactics this combat', namespace: 'situation' },
  // Set by buildRollContext when the roll's actor and its other party are the same size; tickable when no target stands behind the roll (permissive)
  { id: SAME_SIZE_SITUATION, label: 'Same Size as the Target', namespace: 'situation' },
  { id: 'situation.night', label: 'At Night', namespace: 'situation' },
  { id: 'situation.day', label: 'In Daylight', namespace: 'situation' },
  { id: 'situation.natural_environment', label: 'In a Natural Environment', namespace: 'situation' },
  { id: 'situation.outdoors', label: 'Outdoors', namespace: 'situation' },
  { id: 'situation.surprise_round', label: 'Surprise Round', namespace: 'situation' },
  { id: 'situation.in_combat', label: 'In Combat', namespace: 'situation', engine: true },
  { id: 'situation.disadvantaged', label: 'Disadvantaged', namespace: 'situation', engine: true },
  { id: 'situation.critical_hit', label: 'Critical Hit', namespace: 'situation', engine: true },
  { id: 'situation.damage_effect', label: 'Damage Effect Used', namespace: 'situation', engine: true },
  {
    id: 'situation.specialty', label: 'Your Specialty', namespace: 'situation', engine: true,
    description: "Set by the engine when the item being made, or the target, carries the rolling skill's chosen specialty."
  },
  {
    id: 'situation.amazing_success', label: 'Amazing Success (this target)', namespace: 'situation', engine: true,
    description: "Set by the engine for a target the attack beat by 10 or more. Not set on a Natural 20; a Critical Hit supersedes it. For 'Amazing Success or better' use any of this and Critical Hit."
  },
  { id: 'situation.after_full_meal', label: 'After a Full Meal', namespace: 'situation' },
  { id: 'situation.no_talking', label: 'No Talking Needed', namespace: 'situation' },
  { id: 'situation.higher_ground', label: 'From Higher Ground', namespace: 'situation' },
  { id: 'situation.hostile', label: 'Hostile Situation', namespace: 'situation' },
  { id: 'situation.earth_involved', label: 'Earth Involved', namespace: 'situation' },
  { id: 'situation.physically_menacing', label: 'Physically Menacing', namespace: 'situation' },
  { id: 'situation.observing_far', label: 'Observing Something Far Away', namespace: 'situation' },
  { id: 'situation.fine_manipulation', label: 'Fine Manipulation or Motor Coordination', namespace: 'situation' },
  { id: 'situation.hunger_thirst', label: 'Resisting Hunger or Thirst', namespace: 'situation' },

  // --- Creature types ---
  { id: 'creature.animal', label: 'Animal', namespace: 'creature', description: 'An animal race, polymorph or buff. Animal crawlers who hold a race without this tag cannot use their animal skills (skillGroup.animal).' },
  { id: 'creature.dog', label: 'Dog', namespace: 'creature' },
  { id: 'creature.beast', label: 'Beast', namespace: 'creature' },
  { id: 'creature.feline', label: 'Feline', namespace: 'creature' },
  { id: 'creature.elf', label: 'Elf', namespace: 'creature' },
  { id: 'creature.fairy', label: 'Fairy', namespace: 'creature' },
  { id: 'creature.dwarf', label: 'Dwarf', namespace: 'creature' },
  { id: 'creature.rat_kin', label: 'Rat-Kin', namespace: 'creature' },
  { id: 'creature.troll', label: 'Troll', namespace: 'creature' },
  { id: 'creature.undead', label: 'Undead', namespace: 'creature' },
  { id: 'creature.elemental', label: 'Elemental', namespace: 'creature' },
  { id: 'creature.male', label: 'Male', namespace: 'creature' },
  { id: 'creature.female', label: 'Female', namespace: 'creature' },
  { id: 'creature.nonbinary', label: 'Non-binary', namespace: 'creature' },
  { id: 'creature.sex_other', label: 'Other', namespace: 'creature' },

  // --- Combat Technique Targets ---
  { id: 'technique.wrestling', label: 'Wrestling Technique', namespace: 'technique', references: 'id.skill.dccskl0000000015' },
  { id: 'technique.pugilism', label: 'Pugilism Technique', namespace: 'technique', references: 'id.skill.pugilism' },
  { id: 'technique.headbutt', label: 'Headbutt Technique', namespace: 'technique', references: 'id.skill.dccskl0000000012' },
  { id: 'technique.foot_soldier', label: 'Foot Soldier Technique', namespace: 'technique', references: 'id.skill.foot-soldier' },

  // --- Engine Rule Overrides ---
  { id: 'rule.no-damage-effects', label: 'Cannot Take Damage Effects', namespace: 'rule', flags: ['no-damage-effects'] },
  { id: 'rule.no-actions', label: 'Cannot Take Actions', namespace: 'rule', flags: ['no-actions'], description: 'The bearer cannot take Actions; an Action asks a Rule Break first.' },
  { id: 'rule.forfeit-action', label: 'Forfeits the Next Action', namespace: 'rule', flags: ['forfeits-action'], description: 'The bearer loses the next Action; a slot is recorded and the debuff ends. Acting first asks a Rule Break.' },
  { id: 'rule.no-healing', label: 'Cannot Be Healed', namespace: 'rule', flags: ['no-healing'], description: 'The bearer cannot be healed; a heal asks a Rule Break first.' },
  { id: 'rule.requires-weapon', label: 'Requires Equipped Weapon', namespace: 'rule', flags: ['requires-weapon'] },
  { id: 'rule.no-standalone-attack', label: 'No Standalone Attack', namespace: 'rule', flags: ['no-standalone-attack'] },
  { id: 'rule.mind-control', label: 'Mind Control', namespace: 'rule', description: 'Descriptive: the GM adjudicates control of the target.', descriptive: true },
  { id: 'rule.temp-health-bars', label: 'Temporary Health Bars', namespace: 'rule' },
  { id: 'rule.emits-light', label: 'Emits Light', namespace: 'rule', flags: ['emits-light'] },
  { id: 'rule.causes-darkness', label: 'Causes Darkness', namespace: 'rule', description: 'Descriptive: the GM adjudicates the darkness it causes.', descriptive: true },
  { id: 'rule.depletes-on-empty', label: 'Depletes When Empty', namespace: 'rule', description: 'Descriptive: the GM adjudicates what happens when the item runs empty.', descriptive: true },
  { id: 'rule.summon', label: 'Summoning / Minion Creation', namespace: 'rule', description: 'Descriptive: the GM adjudicates the summoned creatures.', descriptive: true },
  { id: 'rule.hazard', label: 'Terrain Hazard', namespace: 'rule', flags: ['zone'] },
  { id: 'rule.barrier', label: 'Barrier / Obstacle', namespace: 'rule', description: 'Descriptive: the GM adjudicates the barrier or obstacle.', descriptive: true },
  { id: 'rule.flight', label: 'Flight / Levitation', namespace: 'rule', descriptive: true, description: 'Descriptive: the creature or effect flies or levitates. Movement comes from the Fly speed; the tag is a label for filters.' },
  { id: 'rule.climb', label: 'Climbing / Vertical Surface Movement', namespace: 'rule', descriptive: true, description: 'Descriptive: the creature or effect climbs vertical surfaces. Movement comes from the Climb speed; the tag is a label for filters.' },
  { id: 'rule.lifesteal', label: 'Life Steal (Heals Caster on Damage)', namespace: 'rule' },
  { id: 'rule.latch', label: 'Latch onto Target to Move When Target Moves', namespace: 'rule', description: 'Descriptive: the GM adjudicates latching on and moving with the target.', descriptive: true },
  { id: 'rule.extra-attack', label: 'Grants Free Extra Attack', namespace: 'rule', description: 'Descriptive: the GM grants the free extra attack.', descriptive: true },
  { id: 'rule.disadvantage', label: 'Imposes Disadvantage', namespace: 'rule', description: 'Descriptive: the GM applies the disadvantage it imposes.', descriptive: true },
  {
    id: 'rule.aiming-offset', label: 'Aiming Offset (ticked Aiming: Disadvantage, adds rank to hit and 1d4 damage per tier)', namespace: 'rule',
    rows: {
      attackModifiers: [
        { kind: 'bonus', label: 'Aiming', value: 1, scaleBy: { source: 'rank' }, condition: AIMING_CONDITION },
        { kind: 'advantage', label: 'Aiming', advantage: 'disadvantage', condition: AIMING_CONDITION }
      ],
      damageModifiers: [
        { mode: 'add', label: 'Aiming', dice: '1d4', minRank: 1, condition: AIMING_CONDITION },
        { mode: 'add', label: 'Aiming (Rank 5)', dice: '1d4', minRank: 5, condition: AIMING_CONDITION },
        { mode: 'add', label: 'Aiming (Rank 10)', dice: '1d4', minRank: 10, condition: AIMING_CONDITION },
        { mode: 'add', label: 'Aiming (Rank 15)', dice: '1d4', minRank: 15, condition: AIMING_CONDITION }
      ]
    }
  },
  { id: 'rule.grind-map-neighborhood', label: 'Neighborhood Map (+1 grinding hour)', namespace: 'rule' },
  { id: 'rule.grind-map-borough', label: 'Borough Map (+2 grinding hours)', namespace: 'rule' },
  { id: 'rule.offset-disadvantage', label: 'Offsets Disadvantage on Attacks', namespace: 'rule', description: 'Descriptive: the GM offsets disadvantage on attacks.', descriptive: true },
  { id: 'rule.anti-piercing', label: 'Anti-Piercing Armor', namespace: 'rule', flags: ['anti-piercing'] },
  { id: 'rule.works-in-zero-zone', label: 'Works in Zero Zone', namespace: 'rule', flags: ['works-in-zero-zone'] },
  { id: 'rule.mount',label: 'Mount / Rideable Companion', namespace: 'rule', flags: ['mount'] },
  { id: 'rule.pet-skill', label: 'Pet Signature Skill', namespace: 'rule', description: 'Descriptive: marks a pet signature skill; the GM adjudicates it.', descriptive: true },
  { id: 'rule.taunt', label: 'Taunt', namespace: 'rule', description: 'Draws enemy attacks toward the bearer (the redirect itself is the interrupt row on the skill).', descriptive: true },
  { id: 'rule.no-redirect', label: 'Cannot Be Redirected or Intercepted', namespace: 'rule', flags: ['no-redirect'] },
  { id: 'rule.evade-area-full', label: 'Evade Area Full Damage Avoidance', namespace: 'rule', rows: { defenseModifiers: [{ kind: 'evadeOutcome', option: 'full', label: 'Full area evasion' }] } },

  // --- Mob & Boss Hierarchy ---
  { id: 'mob.boss', label: 'Boss', namespace: 'mob' },
  { id: 'mob.unique', label: 'Unique Boss', namespace: 'mob' },
  { id: 'mob.summoned', label: 'Summoned Mob', namespace: 'mob', flags: ['uncounted-ally'] },
  { id: 'mob.minion', label: 'Minion', namespace: 'mob' },
  { id: 'mob.tier.neighborhood', label: 'Neighborhood Boss', namespace: 'mob' },
  { id: 'mob.tier.borough', label: 'Borough Boss', namespace: 'mob' },
  { id: 'mob.tier.city', label: 'City Boss', namespace: 'mob' },
  { id: 'mob.tier.province', label: 'Province Boss', namespace: 'mob' },
  { id: 'mob.tier.country', label: 'Country Boss', namespace: 'mob' },
  { id: 'mob.tier.floor', label: 'Floor Boss', namespace: 'mob' },
  { id: 'mob.tier.dungeon', label: 'Dungeon Boss', namespace: 'mob' },

  // --- Condition Triggers ---
  { id: 'trigger.crit', label: 'Critical Hit Trigger', namespace: 'trigger' },
  { id: 'trigger.fumble', label: 'Fumble Trigger', namespace: 'trigger' },
  { id: 'trigger.on_hit', label: 'On-Hit Debuff Trigger', namespace: 'trigger' },
  { id: 'trigger.on_slot_loss', label: 'On Health Bar Slot Loss Trigger', namespace: 'trigger' },
  { id: 'trigger.on_attack', label: 'When Attacked', namespace: 'trigger' },
  { id: 'trigger.on_damage', label: 'When Hit / Damaged', namespace: 'trigger' },
  { id: 'trigger.on_foe_leave_reach', label: 'When Foe Leaves Reach', namespace: 'trigger' },
  { id: 'trigger.on_foe_enter_reach', label: 'When Foe Enters Reach', namespace: 'trigger' },
  { id: 'trigger.on_ally_hit', label: 'When Ally Hit', namespace: 'trigger' },
  { id: 'trigger.on_ally_attack', label: 'When Ally Targeted', namespace: 'trigger' },
  { id: 'trigger.on_ally_check', label: 'Ally Check', namespace: 'trigger' },
  { id: 'trigger.before_ally_action', label: 'Before Ally Acts', namespace: 'trigger' },

  // --- Bard patronage (core rulebook pp. 145-146, 315) ---
  { id: PATRON_TAGS.eligible, label: 'Patron Eligible', namespace: 'access', engine: true, description: 'May acquire a Bard patron (pp. 145, 315).' },
  { id: PATRON_TAGS.required, label: 'Patron Required', namespace: 'rule', engine: true, description: 'Must have a Bard patron, chosen from the GM\'s offer when the class is taken (pp. 146, 315).' },
  ...PATRON_ACCESS_TAGS.map((id) => ({ id, ...PATRON_ACCESS_DEFINITIONS[id], namespace: 'access', engine: true })),

  // --- Interrupt Effects (what an interrupt does to the attack that triggered it) ---
  { id: 'interrupt.redirect_attack', label: 'Redirect Attack to Self', namespace: 'interrupt' },
  { id: 'interrupt.intercept_hit', label: 'Take Hit for Ally', namespace: 'interrupt' },
  { id: 'interrupt.not_vs_area', label: 'Not Usable vs Area Attacks', namespace: 'interrupt' }
];
