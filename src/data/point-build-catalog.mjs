/**
 * Sprinter RPG — Point Build Catalog
 * The system's core benefits, detriments and tier costs (rules source: core rulebook, Chapter 3, pp. 158–164).
 * Names and descriptions are original text (3.6a R2t); a content module can restyle an entry by registering one with
 * the same `id` (see src/content/point-build.mjs).
 *
 * Shared between the Class Creator (30 BP base) and Race Creator (25 BP base).
 *
 * `rows`: the structured rows a benefit or detriment adds to the race or class it is built into, as
 * `{ path, row }` templates (see src/utils/character/perk-rows.mjs). A `$name` in a template is filled from the selection's
 * `params` (`rowParams` lists them, `rowDefaults` gives defaults); a row whose parameter is not chosen yet is left
 * out. `buildPointBuyPayload` applies them with the same function the perk conversion uses, so a builder-made
 * race and a converted rulebook race carry identical rows. Entries without `rows` are narration the GM adjudicates.
 */

import { MELEE_ATTACK_ANY } from './rules/melee-attack.mjs';

export const COG_POINT_BUILD_BENEFITS = [
  // ==========================================
  // Minor tier: cost 1 BP
  // ==========================================
  {
    id: 'minor_advancement_check',
    name: '+1 to Skill Advancement Checks',
    tier: 'minor',
    cost: 1,
    category: 'Progression',
    description: 'Pick one skill. Its floor-end Skill Advancement Checks get a +1 bonus.',
    rowParams: ['skillTag'],
    rows: [
      { path: 'system.checkModifiers', row: { value: 1, condition: { all: ['check.advancement', '$skillTag'] } } }
    ]
  },
  {
    id: 'minor_rank_20_cap',
    name: 'Raise Specific Skill Cap to Rank 20',
    tier: 'minor',
    cost: 1,
    category: 'Progression',
    description: 'One chosen skill may keep advancing past the usual Rank 15 limit, topping out at Rank 20.',
    rowParams: ['skill'],
    rows: [
      { path: 'system.grants', row: { kind: 'rank_cap', identifier: '$skill', value: 20 } }
    ]
  },
  {
    id: 'minor_noncombat_stat_mod',
    name: 'Double Stat Mod on Specific Non-Combat Check',
    tier: 'minor',
    cost: 1,
    category: 'Utility',
    description: 'Pick a non-combat skill and an everyday situation. Checks with that skill in that situation add the chosen Stat Mod on top of the usual one.',
    rowParams: ['stat', 'skillTag', 'situation', 'label'],
    rows: [
      { path: 'system.checkModifiers', row: { label: '$label', stat: '$stat', condition: { all: ['check.skill', '$skillTag', '$situation'] } } }
    ]
  },
  {
    id: 'minor_conditional_advantage',
    name: 'Conditional Combat Advantage',
    tier: 'minor',
    cost: 1,
    category: 'Combat',
    description: 'Pick one kind of creature, such as undead or constructs. Your attacks against that kind roll with Advantage.',
    rowParams: ['creatureTag'],
    rows: [
      { path: 'system.attackModifiers', row: { kind: 'advantage', advantage: 'advantage', condition: { all: ['subject.$creatureTag'] } } }
    ]
  },
  {
    id: 'minor_darkvision',
    name: 'Darkvision / Light Generation',
    tier: 'minor',
    cost: 1,
    category: 'Senses',
    description: 'You see clearly in complete darkness. Making light at will instead is a narrated option; the sheet records only the dark sight.',
    rows: [
      { path: 'system.senses', row: { darkvisionUnlimited: true } }
    ]
  },
  {
    id: 'minor_double_mana_terrain',
    name: 'Double Mana Regen in Specific Terrain',
    tier: 'minor',
    cost: 1,
    category: 'Magic',
    description: 'Mana you recover by mending or resting is doubled while you are in one chosen setting (a natural environment unless you pick another).',
    rowParams: ['situation', 'label'],
    rowDefaults: { situation: 'situation.natural_environment', label: 'In a Natural Environment' },
    rows: [
      { path: 'system.recoveryModifiers', row: { label: '$label', resource: 'mana', multiplier: 2, condition: { all: ['$situation'] } } }
    ]
  },
  {
    id: 'minor_telescopic_vision',
    name: 'Telescopic Vision',
    tier: 'minor',
    cost: 1,
    category: 'Senses',
    description: 'Your eyesight reaches twice the usual distance, picking out fine detail far away.',
    rows: [
      { path: 'system.senses', row: { rangeMultiplier: 2 } }
    ]
  },
  {
    id: 'minor_crafting_table_t1',
    name: 'Tier-1 Crafting Table',
    tier: 'minor',
    cost: 1,
    category: 'Crafting',
    description: 'Pick any Tier-1 crafting table. The moment you own a Personal Space, the table is waiting in it.',
    rows: [
      { path: 'system.startingItems', row: { itemType: 'space_upgrade', quantity: 1, mode: 'choice', query: { all: ['upgrade.crafting_table'] }, label: 'A Tier-1 crafting table you pick' } }
    ]
  },
  {
    id: 'minor_safe_room',
    name: 'Complimentary Safe Room Lodging',
    tier: 'minor',
    cost: 1,
    category: 'Utility',
    description: 'Every safe room keeps a private room ready for you, free of charge.',
    rows: [
      { path: 'system.tags', row: 'access.saferoom.free_room' }
    ]
  },
  {
    id: 'minor_store_discount',
    name: 'Merchant Discount / Interest Bonus (+1)',
    tier: 'minor',
    cost: 1,
    category: 'Economy',
    description: 'A money perk: cheaper shop prices, more coin from each sale, or added bank interest. Each of the three is worth +1 and is taken separately.',
    rows: [
      { path: 'system.tags', row: 'rule.store_discount' }
    ]
  },
  {
    id: 'minor_session_benefit',
    name: 'Once-per-Session Non-Combat Perk',
    tier: 'minor',
    cost: 1,
    category: 'Utility',
    description: 'Once per session, a small out-of-combat perk kicks in, but only in a narrow situation agreed with the GM.'
  },

  // ==========================================
  // Moderate tier: cost 2 BP
  // ==========================================
  {
    id: 'mod_dr_buff_1',
    name: '+1 DR Buff',
    tier: 'moderate',
    cost: 2,
    drBonus: 1,
    category: 'Defense',
    description: 'Adds +1 to your Damage Reduction for good. DR bought this way costs 2 BP per point, to a maximum of +3.'
  },
  {
    id: 'mod_dr_buff_2',
    name: '+2 DR Buff',
    tier: 'moderate',
    cost: 4,
    drBonus: 2,
    category: 'Defense',
    description: 'Adds +2 to your Damage Reduction for good, for 4 BP (two steps of the DR purchase).'
  },
  {
    id: 'mod_dr_buff_3',
    name: '+3 DR Buff',
    tier: 'moderate',
    cost: 6,
    drBonus: 3,
    category: 'Defense',
    description: 'Adds +3 to your Damage Reduction for good, for 6 BP. No build can buy more DR than this.'
  },
  {
    id: 'mod_kill_heal_bar',
    name: 'Vampiric Execution (Heal 1 Health Bar on Kill/Dmg)',
    tier: 'moderate',
    cost: 2,
    category: 'Combat',
    description: 'Pick a weapon skill or spell. Each time it damages or kills a creature, you recover 1 Health Bar slot, to a maximum of 5 slots in one combat scene.'
  },
  {
    id: 'mod_attack_stat_mod_x2',
    name: 'Double Attack Stat Mod in Common Condition',
    tier: 'moderate',
    cost: 2,
    category: 'Combat',
    description: 'Name an everyday attack situation. While it applies, your attacks add the chosen Stat Mod an extra time.',
    rowParams: ['stat', 'situation', 'label'],
    rows: [
      { path: 'system.attackModifiers', row: { label: '$label', stat: '$stat', condition: { all: ['$situation'] } } }
    ]
  },
  {
    id: 'mod_advancement_advantage',
    name: 'Advantage on Specific Skill Advancement Checks',
    tier: 'moderate',
    cost: 2,
    category: 'Progression',
    description: 'Pick one skill. You roll its floor-end Skill Advancement Checks with Advantage.',
    rowParams: ['skillTag'],
    rows: [
      { path: 'system.checkModifiers', row: { kind: 'advantage', advantage: 'advantage', condition: { all: ['check.advancement', '$skillTag'] } } }
    ]
  },
  {
    id: 'mod_linked_advancement_plus1',
    name: '+1 Advancement Checks on Linked Skill Group',
    tier: 'moderate',
    cost: 2,
    category: 'Progression',
    description: 'Pick a linked group of related skills. Each skill in it gets +1 on floor-end Skill Advancement Checks.',
    rowParams: ['groupTag'],
    rows: [
      { path: 'system.checkModifiers', row: { value: 1, condition: { all: ['check.advancement', '$groupTag'] } } }
    ]
  },
  {
    id: 'mod_damage_type_shift',
    name: 'Encounter Damage Type Alteration',
    tier: 'moderate',
    cost: 2,
    category: 'Combat',
    description: 'When a fight begins, you may name a new damage type. Everything you deal in that fight uses it.'
  },
  {
    id: 'mod_guild_access',
    name: 'Universal Guild Access',
    tier: 'moderate',
    cost: 2,
    category: 'Club & Access',
    description: 'You may use any guild of one kind, on every floor, such as every guild that teaches weapon skills. The sheet tags weapon-training guilds; settle another kind with the GM.',
    rows: [
      { path: 'system.tags', row: 'access.guild.weapon_training' }
    ]
  },
  {
    id: 'mod_unlimited_mana_regen',
    name: 'Unrestricted Double Mana Regeneration',
    tier: 'moderate',
    cost: 2,
    category: 'Magic',
    description: 'Mana you recover by mending or resting is doubled everywhere, with no setting or situation required.',
    rows: [
      { path: 'system.recoveryModifiers', row: { resource: 'mana', multiplier: 2 } }
    ]
  },
  {
    id: 'mod_linked_rank_20',
    name: 'Raise Thematically Linked Skills to Rank 20',
    tier: 'moderate',
    cost: 2,
    category: 'Progression',
    description: 'Every skill in a chosen linked group may advance beyond the Rank 15 limit and reach Rank 20.',
    rowParams: ['groupTag'],
    rows: [
      { path: 'system.grants', row: { kind: 'rank_cap', tag: '$groupTag', value: 20 } }
    ]
  },
  {
    id: 'mod_mob_gold_bounty',
    name: 'Signature Attack Gold Bounty (1 x Floor)',
    tier: 'moderate',
    cost: 2,
    category: 'Economy',
    description: 'Pick a signature attack. A mob it kills drops extra gold equal to the Floor Number.',
    rows: [
      { path: 'system.tags', row: 'rule.kill_bounty' }
    ]
  },
  {
    id: 'mod_popularity_action',
    name: 'Signature Action Popularity Generation',
    tier: 'moderate',
    cost: 2,
    category: 'Popularity',
    description: 'Certain showy moves win you audience Popularity: a named attack, a stunt, or a catchphrase delivered on cue.'
  },
  {
    id: 'mod_patron_benefit',
    name: 'Patron Backing',
    tier: 'moderate',
    cost: 2,
    category: 'Utility',
    description: 'A patron takes an interest in you and sends messages, gifts, or the odd small favour. The GM decides who they are and what arrives.',
    rows: [
      { path: 'system.tags', row: 'access.patron' }
    ]
  },
  {
    id: 'mod_uncommon_resistance',
    name: 'Resistance to Uncommon Damage Type',
    tier: 'moderate',
    cost: 2,
    category: 'Defense',
    description: 'Choose one uncommon damage type, for instance Psychic. You take half damage from it.',
    rowParams: ['damageType'],
    rows: [
      { path: 'system.defenseModifiers', row: { kind: 'resistance', damageType: '$damageType' } }
    ]
  },
  {
    id: 'mod_hazard_resistance',
    name: 'Environmental Hazard Resistance',
    tier: 'moderate',
    cost: 2,
    category: 'Defense',
    description: 'Harm dealt by the dungeon itself (falls, drowning, traps built into the floor) is halved for you.'
  },
  {
    id: 'mod_stat_swap',
    name: 'Stat Modifier Replacement for Ability/Skill',
    tier: 'moderate',
    cost: 2,
    category: 'Utility',
    description: 'Checks with one chosen skill use a different Stat than usual, for example Dexterity in place of Strength for a climbing skill.',
    rowParams: ['from', 'to', 'skillTag'],
    rows: [
      { path: 'system.statSubstitutions', row: { scope: 'check', from: '$from', to: '$to', optional: false, condition: { all: ['$skillTag'] } } }
    ]
  },
  {
    id: 'mod_secondary_stat_mod',
    name: 'Secondary Stat Mod Added to Skill',
    tier: 'moderate',
    cost: 2,
    category: 'Combat',
    description: 'Checks with a chosen skill add the Mod of a second Stat as well as the Mod they already use.',
    rowParams: ['stat', 'skillTag'],
    rows: [
      { path: 'system.checkModifiers', row: { stat: '$stat', condition: { all: ['check.skill', '$skillTag'] } } }
    ]
  },
  {
    id: 'mod_cross_weapon_skill',
    name: 'Cross-Weapon Skill Technique Transfer',
    tier: 'moderate',
    cost: 2,
    category: 'Combat',
    description: 'Skills and techniques meant for one type of weapon work with a different weapon type of your choosing.'
  },
  {
    id: 'mod_healing_spell_boost',
    name: 'Enhanced Healing Spells (+1 Health Bar)',
    tier: 'moderate',
    cost: 2,
    category: 'Magic',
    description: 'Your Healing-type spells restore 1 more Health Bar slot to whoever they heal.'
  },
  {
    id: 'mod_traverse_terrain',
    name: 'Unchecked Terrain Traversal',
    tier: 'moderate',
    cost: 2,
    category: 'Movement',
    description: 'Pick hard ground such as bog, ice or loose scree. You cross it with no Skill Checks needed.'
  },
  {
    id: 'mod_burrow',
    name: 'Burrowing Movement',
    tier: 'moderate',
    cost: 2,
    category: 'Movement',
    description: 'You can dig your way through soil, sand and loose rock as a natural way of moving.'
  },
  {
    id: 'mod_water_breathing',
    name: 'Aquatic Respiration (Breathe Underwater)',
    tier: 'moderate',
    cost: 2,
    category: 'Utility',
    description: 'You breathe water as easily as air and can stay submerged for as long as you like.',
    rows: [
      { path: 'system.tags', row: 'sense.water_breathing' }
    ]
  },
  {
    id: 'mod_natural_attack_d6',
    name: 'Natural Attack (1d6 + Mod Scaling)',
    tier: 'moderate',
    cost: 2,
    category: 'Combat',
    description: 'A natural weapon (claws, horns, a tail) whose Rank equals the Floor Number. It deals 1d6 + the chosen Stat Mod and adds another 1d6 when its Rank reaches 5, 10 and 15.'
  },
  {
    id: 'mod_reassign_stats',
    name: 'Long Rest Stat Point Reassignment',
    tier: 'moderate',
    cost: 2,
    category: 'Utility',
    description: 'During a Long Rest, once each floor, you may move your race or class Stat bonuses onto different Stats.'
  },

  // ==========================================
  // Major tier: cost 3 BP
  // ==========================================
  {
    id: 'major_pet_or_mount',
    name: 'Loyal Companion: Friendly Pet or Mount',
    tier: 'major',
    cost: 3,
    category: 'Companion',
    description: 'A friendly pet or a battle-ready mount is loyal to you from the moment you take this race or class.'
  },
  {
    id: 'major_pet_mount_commander',
    name: 'Pack Commander (Up to 4 Pts Buff to Pets/Mounts)',
    tier: 'major',
    cost: 3,
    category: 'Companion',
    description: 'You can give every pet and mount you own a buff or perk worth as much as 4 points.'
  },
  {
    id: 'major_encounter_alteration',
    name: 'Daily Encounter Disruption (1/Day)',
    tier: 'major',
    cost: 3,
    category: 'Combat',
    description: 'Once a day you can upend a fight in a big way, for instance by turning a pack of enemies on one another.'
  },
  {
    id: 'major_absolute_defense',
    name: 'Daily Absolute Defense (1/Day)',
    tier: 'major',
    cost: 3,
    category: 'Defense',
    description: 'Once a day, cancel every point of damage from one attack that hits you.'
  },
  {
    id: 'major_party_buff_daily',
    name: 'Daily Party-Wide Buff (1/Day)',
    tier: 'major',
    cost: 3,
    category: 'Party',
    description: 'Once a day, boost the whole party for an hour: regeneration, +1 DR, or an extra die on rolls, for example.'
  },
  {
    id: 'major_limited_flight',
    name: 'Limited Flight / Gliding',
    tier: 'major',
    cost: 3,
    category: 'Movement',
    description: 'You can fly, within a limit such as a set distance per scene, or gliding only.',
    rows: [
      { path: 'system.tags', row: 'rule.flight_limited' }
    ]
  },
  {
    id: 'major_anaerobic_biology',
    name: 'Anaerobic Biology (No Breathing & Toxin Immunity)',
    tier: 'major',
    cost: 3,
    category: 'Defense',
    description: 'You never need to breathe, so inhaled poisons, gases and smothering cannot hurt you.',
    rows: [
      { path: 'system.tags', row: 'rule.no_breath' }
    ]
  },
  {
    id: 'major_rage',
    name: 'Berserker Rage (+1 Melee Damage per Lost Bar)',
    tier: 'major',
    cost: 3,
    category: 'Combat',
    description: 'Every Health Bar slot you are missing adds +1 damage to your melee attacks.',
    rows: [
      { path: 'system.damageModifiers', row: { mode: 'add', value: 1, scaleBy: { source: 'hpSlotsLost' }, condition: { any: [...MELEE_ATTACK_ANY] } } }
    ]
  },
  {
    id: 'major_size_small',
    name: 'Small Size Category (Size 2 or less)',
    tier: 'major',
    cost: 3,
    category: 'Utility',
    description: 'Your size is 2 (Small) or smaller, so you slip through tight gaps and are harder to pin down.'
  },
  {
    id: 'major_movement_bonus',
    name: '+5ft Move or +5 Step Bonus',
    tier: 'major',
    cost: 3,
    category: 'Movement',
    description: 'Your Move rises by 5 ft for good. Taking +5 Step instead is allowed, but the sheet applies only the Move increase.',
    rows: [
      { path: 'system.movement', row: { walkDelta: 5 } }
    ]
  },
  {
    id: 'major_bonus_die_1d4',
    name: '+1d4 Bonus Die to Evade or Stat Checks',
    tier: 'major',
    cost: 3,
    category: 'Combat',
    description: 'Add a 1d4 to every Evade Check. Taking the die on Stat Checks for one Stat instead is allowed, but the sheet applies only the Evade die.',
    rows: [
      { path: 'system.checkModifiers', row: { dice: '1d4', condition: { all: ['check.evade'] } } }
    ]
  },
  {
    id: 'major_natural_attack_d8',
    name: 'Heavy Natural Attack (1d8 + Mod Scaling)',
    tier: 'major',
    cost: 3,
    category: 'Combat',
    description: 'A heavier natural weapon whose Rank equals the Floor Number. It deals 1d8 + the chosen Stat Mod and adds another 1d8 when its Rank reaches 5, 10 and 15.'
  },
  {
    id: 'major_noncombat_advantage',
    name: 'Advantage on One Non-Combat Skill or Spell',
    tier: 'major',
    cost: 3,
    category: 'Utility',
    description: 'Checks with one chosen skill or spell used outside combat (not an attack spell) roll with Advantage.',
    rowParams: ['skillTag'],
    rows: [
      { path: 'system.checkModifiers', row: { kind: 'advantage', advantage: 'advantage', condition: { all: ['check.skill', '$skillTag'] } } }
    ]
  },
  {
    id: 'major_situational_double_dmg',
    name: 'Situational x2 Damage Burst (1 Round/Scene)',
    tier: 'major',
    cost: 3,
    category: 'Combat',
    description: 'Pick a combat trigger, such as a surprise round. While it applies, your melee attacks deal double damage; the trigger should last one round at most.',
    rowParams: ['situation', 'label'],
    rows: [
      { path: 'system.damageModifiers', row: { label: '$label', mode: 'multiply', multiplier: 2, condition: { all: ['$situation'], any: [...MELEE_ATTACK_ANY] } } }
    ]
  },
  {
    id: 'major_con_swap_hp',
    name: 'Swap Con for Determining Health Bars',
    tier: 'major',
    cost: 3,
    category: 'Defense',
    description: 'Your Health Bar slots are worked out from a Stat of your choice (Strength, perhaps) in place of Constitution.',
    rowParams: ['to'],
    rows: [
      { path: 'system.statSubstitutions', row: { scope: 'healthBar', from: 'con', to: '$to', optional: false, condition: {  } } }
    ]
  },
  {
    id: 'major_climb_movement',
    name: 'Ceiling & Wall Spider Climb Movement',
    tier: 'major',
    cost: 3,
    category: 'Movement',
    description: 'You gain a Climb speed and scale walls, and even ceilings, without needing to roll.'
  },

  // ==========================================
  // Extreme tier: cost 4 BP
  // ==========================================
  {
    id: 'extreme_exotic_skill',
    name: 'Exotic Unlearnable Skill Access (+1 Rank)',
    tier: 'extreme',
    cost: 4,
    category: 'Progression',
    description: '+1 Rank in a skill your race and class could never normally learn, such as a monster\'s signature survival trick.'
  },
  {
    id: 'extreme_linked_skills_small',
    name: '+1 to Thematically Linked Group (3–5 Skills)',
    tier: 'extreme',
    cost: 4,
    category: 'Progression',
    description: '+1 Rank to each skill in a small linked group of 3 to 5 skills, for example all thrown-weapon skills.',
    rowParams: ['groupTag'],
    rows: [
      { path: 'system.grants', row: { kind: 'rank_bonus', tag: '$groupTag', value: 1 } }
    ]
  },
  {
    id: 'extreme_stat_checks_advantage',
    name: 'Advantage on Raw Checks of One Stat',
    tier: 'extreme',
    cost: 4,
    category: 'Utility',
    description: 'Raw Stat Checks with one chosen Stat roll with Advantage, for example every Strength check.',
    rowParams: ['statTag'],
    rows: [
      { path: 'system.checkModifiers', row: { kind: 'advantage', advantage: 'advantage', condition: { all: ['check.stat', '$statTag'] } } }
    ]
  },
  {
    id: 'extreme_linked_rank_20_group',
    name: 'Linked Group Skill Cap to Rank 20 (Up to 6 Skills)',
    tier: 'extreme',
    cost: 4,
    category: 'Progression',
    description: 'Each skill in a linked group of no more than 6 may advance beyond the Rank 15 limit and reach Rank 20.',
    rowParams: ['groupTag'],
    rows: [
      { path: 'system.grants', row: { kind: 'rank_cap', tag: '$groupTag', value: 20 } }
    ]
  },
  {
    id: 'extreme_poison_immunity',
    name: 'Complete Poison Immunity',
    tier: 'extreme',
    cost: 4,
    category: 'Defense',
    description: 'You take no Poison damage at all. The sheet blocks the damage; poison conditions and debuffs are left to the GM.',
    rows: [
      { path: 'system.defenseModifiers', row: { kind: 'immunity', damageType: 'Poison' } }
    ]
  },
  {
    id: 'extreme_common_resistance',
    name: 'Resistance to Common Damage Type',
    tier: 'extreme',
    cost: 4,
    category: 'Defense',
    description: 'Pick a common damage type, Slashing or Fire for example. You take half damage from it.',
    rowParams: ['damageType'],
    rows: [
      { path: 'system.defenseModifiers', row: { kind: 'resistance', damageType: '$damageType' } }
    ]
  },
  {
    id: 'extreme_double_spell_duration',
    name: 'Double Spell Duration (Rank 5 & Lower)',
    tier: 'extreme',
    cost: 4,
    category: 'Magic',
    description: 'Spells of Rank 5 or lower that have a duration last twice as long when you cast them.'
  },
  {
    id: 'extreme_noncombat_broad_advantage',
    name: 'Broad Non-Combat Advantage',
    tier: 'extreme',
    cost: 4,
    category: 'Utility',
    description: 'Pick a limited non-combat setting, like haggling in a market. Every skill check you make there rolls with Advantage.'
  },
  {
    id: 'extreme_additional_arm',
    name: 'Additional Functional Arm',
    tier: 'extreme',
    cost: 4,
    category: 'Physical',
    description: 'You grow a working extra arm that can hold a shield, help wield a two-handed weapon, or use tools.'
  },

  // ==========================================
  // Epic tier: cost 6 BP
  // ==========================================
  {
    id: 'epic_linked_skills_large',
    name: '+1 to Thematically Linked Group (6+ Skills)',
    tier: 'epic',
    cost: 6,
    category: 'Progression',
    description: '+1 Rank to each skill in a large linked group of at least 6 skills, such as every Dexterity skill or every melee weapon skill.',
    rowParams: ['groupTag'],
    rows: [
      { path: 'system.grants', row: { kind: 'rank_bonus', tag: '$groupTag', value: 1 } }
    ]
  },
  {
    id: 'epic_universal_rank_20',
    name: 'Universal Rank 20 Cap for All Skills',
    tier: 'epic',
    cost: 6,
    category: 'Progression',
    description: 'Any skill you have can advance past Rank 15, all the way to Rank 20, with no exceptions.',
    rows: [
      { path: 'system.grants', row: { kind: 'rank_cap', tag: 'kind.skill', value: 20 } }
    ]
  },
  {
    id: 'epic_major_defense_immunity',
    name: 'Common Damage Immunity / Daily Hit Halving',
    tier: 'epic',
    cost: 6,
    category: 'Defense',
    description: 'Pick a common damage type (Piercing, say) and become immune to it. Having the first nine hits on you each day deal half damage instead is allowed, but the sheet applies only the immunity.',
    rowParams: ['damageType'],
    rows: [
      { path: 'system.defenseModifiers', row: { kind: 'immunity', damageType: '$damageType' } }
    ]
  },
  {
    id: 'epic_limb_regeneration',
    name: 'Limb & Organ Regeneration',
    tier: 'epic',
    cost: 6,
    category: 'Defense',
    description: 'Lost limbs and damaged organs grow back on their own over time, with no divine healing needed.',
    rows: [
      { path: 'system.tags', row: 'rule.limb_regeneration' }
    ]
  },
  {
    id: 'epic_disease_poison_immunity',
    name: 'Poison and Disease Immunity',
    tier: 'epic',
    cost: 6,
    category: 'Defense',
    description: 'You take no Poison damage, and no disease, infection or engineered plague can take hold of you.',
    rows: [
      { path: 'system.defenseModifiers', row: { kind: 'immunity', damageType: 'Poison' } },
      { path: 'system.tags', row: 'rule.immunity_disease' }
    ]
  },
  {
    id: 'epic_stat_skill_advantage',
    name: 'Advantage on Skill Checks of One Stat',
    tier: 'epic',
    cost: 6,
    category: 'Progression',
    description: 'Every skill check that uses one chosen Stat rolls with Advantage, for example every Charisma skill.',
    rowParams: ['statTag'],
    rows: [
      { path: 'system.checkModifiers', row: { kind: 'advantage', advantage: 'advantage', condition: { all: ['check.skill', '$statTag'] } } }
    ]
  },
  {
    id: 'epic_unrestricted_flight',
    name: 'Unrestricted Unlimited Flight',
    tier: 'epic',
    cost: 6,
    category: 'Movement',
    description: 'You fly freely and for as long as you like, with no limit on time, height or distance.'
  }
];

export const COG_POINT_BUILD_DETRIMENTS = [
  // ==========================================
  // Minor detriment tier: grants +1 BP
  // ==========================================
  {
    id: 'det_minor_stat_penalties',
    name: 'Stat Penalties (-2 Stats)',
    tier: 'minor',
    extraPoints: 1,
    description: 'Each -2 of Stat penalties you accept earns 1 extra Build Point.'
  },
  {
    id: 'det_minor_skill_penalties',
    name: 'Skill Penalties (-2 Skills)',
    tier: 'minor',
    extraPoints: 1,
    description: 'Each -2 of Skill Rank penalties you accept earns 1 extra Build Point.'
  },
  {
    id: 'det_minor_stat_group_skill_penalties',
    name: 'Stat-Wide Skill Penalty (-1 to All Skills Under Stat)',
    tier: 'minor',
    extraPoints: 1,
    description: 'Each -1 applied to every skill of one Stat (all Intelligence skills, say) earns 1 extra Build Point. It hits only skills you already have and never drops a Rank below 1.',
    rowParams: ['statTag'],
    rows: [
      { path: 'system.grants', row: { kind: 'rank_bonus', tag: '$statTag', value: -1, floor: 1, onlyIfOwned: true } }
    ]
  },
  {
    id: 'det_minor_unfavored_spell_mana',
    name: '+1 Mana Cost for Non-Favored Spells',
    tier: 'minor',
    extraPoints: 1,
    description: 'Casting a spell your class does not favor costs 1 extra Mana.',
    rowParams: ['favoredTag'],
    rows: [
      { path: 'system.manaCostModifiers', row: { mode: 'add', value: 1, condition: { none: ['$favoredTag'] } } }
    ]
  },
  {
    id: 'det_minor_conditional_disadvantage',
    name: 'Conditional Disadvantage on Linked Skills',
    tier: 'minor',
    extraPoints: 1,
    description: 'A linked group of skills rolls with Disadvantage against one kind of creature, for example trickery skills used on constructs.',
    rowParams: ['groupTag', 'creatureTag'],
    rows: [
      { path: 'system.checkModifiers', row: { kind: 'advantage', advantage: 'disadvantage', condition: { all: ['check.skill', '$groupTag', 'subject.$creatureTag'] } } }
    ]
  },
  {
    id: 'det_minor_mandatory_worship',
    name: 'Mandatory Daily Deity Worship',
    tier: 'minor',
    extraPoints: 1,
    description: 'You must follow a deity, and neglecting your devotions invites whatever divine displeasure the GM decides.',
    rows: [
      { path: 'system.requirements', row: { kind: 'worship' } }
    ]
  },
  {
    id: 'det_minor_prohibited_worship',
    name: 'Prohibited from Deity Worship',
    tier: 'minor',
    extraPoints: 1,
    description: 'No god will have you: you cannot follow a deity or receive divine blessings.',
    rows: [
      { path: 'system.requirements', row: { kind: 'noWorship' } }
    ]
  },
  {
    id: 'det_minor_advancement_penalty',
    name: '-1 to Advancement Checks for Rank 5+ Class Skill',
    tier: 'minor',
    extraPoints: 1,
    description: 'Pick one class skill at Rank 5 or higher. Its Skill Advancement Checks take a -1 penalty.',
    rowParams: ['skillTag'],
    rows: [
      { path: 'system.checkModifiers', row: { value: -1, condition: { all: ['check.advancement', '$skillTag'] } } }
    ]
  },
  {
    id: 'det_minor_uncommon_vulnerability',
    name: 'Vulnerability: Uncommon Damage (Double Damage)',
    tier: 'minor',
    extraPoints: 1,
    description: 'One uncommon damage type, Psychic for instance, hurts you twice as much as normal.',
    rowParams: ['damageType'],
    rows: [
      { path: 'system.defenseModifiers', row: { kind: 'vulnerability', damageType: '$damageType' } }
    ]
  },
  {
    id: 'det_minor_halve_nonfocus_damage',
    name: 'Halve Damage of Non-Focus Category',
    tier: 'minor',
    extraPoints: 1,
    description: 'Pick a broad kind of damage outside your focus, such as weapon damage for a spellcaster. You deal only half of it.',
    rowParams: ['tag'],
    rows: [
      { path: 'system.damageModifiers', row: { mode: 'multiply', multiplier: 0.5, condition: { all: ['$tag'] } } }
    ]
  },
  {
    id: 'det_minor_milestone_delay',
    name: 'Delayed Milestone Activation (Floor 6+ / Lvl 50+)',
    tier: 'minor',
    extraPoints: 1,
    description: 'One of your big bonuses stays switched off until you reach the 6th Floor or Level 50.'
  },

  // ==========================================
  // Moderate detriment tier: grants +2 BP
  // ==========================================
  {
    id: 'det_mod_broad_disadvantage',
    name: 'Broad Disadvantage Condition',
    tier: 'moderate',
    extraPoints: 2,
    description: 'Choose one broad condition, such as any social check. Every check under it rolls with Disadvantage.',
    rowParams: ['tag'],
    rows: [
      { path: 'system.checkModifiers', row: { kind: 'advantage', advantage: 'disadvantage', condition: { all: ['$tag'] } } }
    ]
  },
  {
    id: 'det_mod_descent_only_advancement',
    name: 'Floor Descent Only Skill Progression',
    tier: 'moderate',
    extraPoints: 2,
    description: 'Your signature class skill ignores Skill Advancement Checks. Its Rank goes up only when you descend to a new floor.'
  },
  {
    id: 'det_mod_weapon_restriction',
    name: 'Severe Weapon Selection Restriction',
    tier: 'moderate',
    extraPoints: 2,
    description: 'You may fight only with a short, fixed list of weapons.'
  },
  {
    id: 'det_mod_no_weapon_stat_mod',
    name: 'No Stat Mod Added to Class Weapon Damage',
    tier: 'moderate',
    extraPoints: 2,
    description: 'Damage from your class weapon skill gets no Stat Mod added to it.',
    rowParams: ['weaponTag'],
    rows: [
      { path: 'system.damageModifiers', row: { mode: 'suppress_stat', condition: { all: ['$weaponTag'] } } }
    ]
  },
  {
    id: 'det_mod_class_spell_mana_3',
    name: '+3 Mana Cost for Class Spell Category',
    tier: 'moderate',
    extraPoints: 2,
    description: 'One category of spells from your class costs 3 extra Mana to cast.',
    rowParams: ['spellTag'],
    rows: [
      { path: 'system.manaCostModifiers', row: { mode: 'add', value: 3, condition: { all: ['$spellTag'] } } }
    ]
  },
  {
    id: 'det_mod_movement_disadvantage',
    name: 'Disadvantage on All Movement Skills',
    tier: 'moderate',
    extraPoints: 2,
    description: 'Every movement skill, such as running, jumping, climbing or tumbling, rolls with Disadvantage.',
    rows: [
      { path: 'system.checkModifiers', row: { kind: 'advantage', advantage: 'disadvantage', condition: { all: ['check.skill', 'skillGroup.movement'] } } }
    ]
  },
  {
    id: 'det_mod_broad_gear_prohibition',
    name: 'Prohibition from Broad Useful Item Category',
    tier: 'moderate',
    extraPoints: 2,
    description: 'A whole useful category of gear is off-limits to you, for instance any kind of armor, or passive spells.'
  },

  // ==========================================
  // Major detriment tier: grants +3 BP
  // ==========================================
  {
    id: 'det_major_stat_cap_10',
    name: 'Permanent Stat Cap at 10',
    tier: 'major',
    extraPoints: 3,
    description: 'One chosen Stat can never rise above 10. Gear, buffs and potions do not lift it past that ceiling; the sheet warns when a total goes over.',
    rowParams: ['stat'],
    rows: [
      { path: 'system.statCaps', row: { '$stat': 10 } }
    ]
  },
  {
    id: 'det_major_common_vulnerability',
    name: 'Vulnerability: Common Damage (Double Damage)',
    tier: 'major',
    extraPoints: 3,
    description: 'One common damage type, Slashing for instance, hurts you twice as much as normal.',
    rowParams: ['damageType'],
    rows: [
      { path: 'system.defenseModifiers', row: { kind: 'vulnerability', damageType: '$damageType' } }
    ]
  }
];

