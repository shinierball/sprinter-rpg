/**
 * The tag id map: every tag id that changed its spelling or merged into another, old id to new id. It is stored-data
 * history: a world saved before the change holds the old ids on items, actors, rows and queries, and the migration
 * `migrate-tag-ids.mjs` rewrites them through this map. Release 8.0.0 is the oldest release a world can come from.
 * Each group says why the id moved; the registry (`tag-catalog.mjs`, `perk-tags.mjs`) holds only the new ids.
 */

/** Descriptive rule tags a race, a class or a benefit carries: labels with text, no rows or flags. They leave `rule.*` (which means "the engine enforces this") for `perk.*`. */
const PERK_IDS = {
  'rule.store_discount': 'perk.store_discount',
  'rule.kill_bounty': 'perk.kill_bounty',
  'rule.flight_limited': 'perk.flight_limited',
  'rule.no_breath': 'perk.no_breath',
  'rule.limb_regeneration': 'perk.limb_regeneration',
  'rule.immunity_disease': 'perk.immunity_disease',
  'rule.causes-darkness': 'perk.causes_darkness',
  'rule.depletes-on-empty': 'perk.depletes_on_empty',
  'rule.climb': 'perk.climb',
  'rule.offset-disadvantage': 'perk.offset_disadvantage',
  'rule.coin_interest': 'perk.coin_interest',
  'rule.cog.acid_touch': 'perk.cog.acid_touch',
  'rule.cog.ai_favor_dr': 'perk.cog.ai_favor_dr',
  'rule.cog.aiming_for_ice_spells': 'perk.cog.aiming_for_ice_spells',
  'rule.cog.level_50_wings': 'perk.cog.level_50_wings',
  'rule.cog.caustic_regurgitation': 'perk.cog.caustic_regurgitation',
  'rule.cog.caustic_regurgitation_scavenger_digestio': 'perk.cog.caustic_regurgitation_scavenger_digestio',
  'rule.cog.cavalier_code_catcher': 'perk.cog.cavalier_code_catcher',
  'rule.cog.cavalier_mount_redirect': 'perk.cog.cavalier_mount_redirect',
  'rule.cog.cephalopod_camouflage_squeeze': 'perk.cog.cephalopod_camouflage_squeeze',
  'rule.cog.changeling_disguise_systems': 'perk.cog.changeling_disguise_systems',
  'rule.cog.changeling_mimic_aversion': 'perk.cog.changeling_mimic_aversion',
  'rule.cog.changeling_shapeshifting': 'perk.cog.changeling_shapeshifting',
  'rule.cog.city_elf_reassign': 'perk.cog.city_elf_reassign',
  'rule.cog.chain_weapon': 'perk.cog.chain_weapon',
  'rule.cog.cooked_meal_buff': 'perk.cog.cooked_meal_buff',
  'rule.cog.help_bonus_die': 'perk.cog.help_bonus_die',
  'rule.cog.day_strength_halved': 'perk.cog.day_strength_halved',
  'rule.cog.shape_changing': 'perk.cog.shape_changing',
  'rule.cog.weapon_incorporation': 'perk.cog.weapon_incorporation',
  'rule.cog.earthquake_resonance': 'perk.cog.earthquake_resonance',
  'rule.cog.extended_spell_duration': 'perk.cog.extended_spell_duration',
  'rule.cog.fire_breath': 'perk.cog.fire_breath',
  'rule.cog.flight_clipped_cleric': 'perk.cog.flight_clipped_cleric',
  'rule.cog.focused_healing': 'perk.cog.focused_healing',
  'rule.cog.four_arms': 'perk.cog.four_arms',
  'rule.cog.head_lizard_light': 'perk.cog.head_lizard_light',
  'rule.cog.herding_tools_only': 'perk.cog.herding_tools_only',
  'rule.cog.inventory_burns_health': 'perk.cog.inventory_burns_health',
  'rule.cog.day_night_stats': 'perk.cog.day_night_stats',
  'rule.cog.level_up_ai_favor': 'perk.cog.level_up_ai_favor',
  'rule.cog.mischievous_pilfer': 'perk.cog.mischievous_pilfer',
  'rule.cog.monster_truck_momentum': 'perk.cog.monster_truck_momentum',
  'rule.cog.monster_truck_payback': 'perk.cog.monster_truck_payback',
  'rule.cog.night_strength_doubled': 'perk.cog.night_strength_doubled',
  'rule.cog.nine_lives': 'perk.cog.nine_lives',
  'rule.cog.obsidian_sixth_floor_choice': 'perk.cog.obsidian_sixth_floor_choice',
  'rule.cog.prehensile_climbing_swinging': 'perk.cog.prehensile_climbing_swinging',
  'rule.cog.question_corpse': 'perk.cog.question_corpse',
  'rule.cog.rat_informants': 'perk.cog.rat_informants',
  'rule.cog.declare_sonic_damage': 'perk.cog.declare_sonic_damage',
  'rule.cog.settlement_first_impression': 'perk.cog.settlement_first_impression',
  'rule.cog.shake_off_debuff': 'perk.cog.shake_off_debuff',
  'rule.cog.shepherd_herd_dr': 'perk.cog.shepherd_herd_dr',
  'rule.cog.silent_stalk': 'perk.cog.silent_stalk',
  'rule.cog.troll_grapple_target': 'perk.cog.troll_grapple_target',
  'rule.cog.undead_kill_heal': 'perk.cog.undead_kill_heal',
  'rule.cog.unnoticed_spells': 'perk.cog.unnoticed_spells',
  'rule.cog.untrained_as_rank_2': 'perk.cog.untrained_as_rank_2',
  'rule.cog.winged_reach': 'perk.cog.winged_reach',
  'rule.floor_coupon.weapon_training': 'perk.floor_coupon.weapon_training',
  'rule.manager_benefit': 'perk.manager_benefit',
  'rule.no_fall_damage': 'perk.no_fall_damage',
  'rule.no_heat_survival': 'perk.no_heat_survival',
  'rule.popularity.crit_larger_foe': 'perk.popularity.crit_larger_foe',
  'rule.popularity.performance_after_kill': 'perk.popularity.performance_after_kill',
  'rule.popularity.surprise_round_action': 'perk.popularity.surprise_round_action',
  'rule.popularity.troll_lick': 'perk.popularity.troll_lick'
};

/** Descriptive labels that skills and spells carry (and the summon label, which merges into `action.summon`): they sit in `action.*` with the other skill and spell classifications. */
const ACTION_LABEL_IDS = {
  'rule.mind-control': 'action.mind_control',
  'rule.summon': 'action.summon',
  'rule.barrier': 'action.barrier',
  'rule.flight': 'action.flight',
  'rule.latch': 'action.latch',
  'rule.extra-attack': 'action.extra_attack',
  'rule.disadvantage': 'action.disadvantage',
  'rule.pet-skill': 'action.pet_skill',
  'rule.taunt': 'action.taunt'
};

/** Twin pairs: two ids for one thing. The old id merges into its partner; a document that carries both keeps one. */
const TWIN_IDS = {
  'shape.aura': 'delivery.aura',
  'action.ignore_dr': 'action.armor_piercing',
  'action.opposed': 'contest.opposed'
};

/** Case rule: a `rule.*` leaf is kebab-case, every other core namespace is snake_case. */
const LEAF_CASE_IDS = {
  'rule.mounted_only': 'rule.mounted-only',
  'rule.extra_pet': 'rule.extra-pet',
  'resource.hp-bars': 'resource.hp_bars',
  'resource.temp-bars': 'resource.temp_bars'
};

/** Old id to new id, all groups. */
export const TAG_RENAME_MAP = Object.freeze({ ...PERK_IDS, ...ACTION_LABEL_IDS, ...TWIN_IDS, ...LEAF_CASE_IDS });
