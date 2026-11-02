import { getStatCaps } from '../../utils/stat-caps.mjs';
import { DEFAULT_SIZE, getSizeInfo, sizeLabel } from '../../data/sizes.mjs';
import { getCOGStatModifier } from '../../documents/actor/actor-constants.mjs';
import { calculateItemHandsRequired } from '../../utils/wielding.mjs';
import { collectActorTags } from '../../data/tags.mjs';
import {
  collectGearBonuses, collectBuffBonuses, collectStaticDefense, collectDebuffEffects, resolvePersistentDebuffs, collectTagBonusGrants,
  collectGearSkillBonuses, animalSkillsLockedFor, deriveSkillRanks, deriveSpellRanks, isUnsetScore, resolveBaseScore
} from './actor-derivation.mjs';
import { getActiveModifierSources } from '../../utils/damage-modifiers.mjs';
import { buildRollContext } from '../../utils/roll-context.mjs';
import { collectSenses } from '../../utils/senses.mjs';
import { resolveStatSubstitution } from '../../utils/narrow-modifiers.mjs';

/**
 * Base TypeDataModel for Sprinter RPG Actor types.
 * Provides shared abilities, base attributes, and stat derivation methods.
 */
export class BaseActorDataModel extends (globalThis.foundry?.abstract?.TypeDataModel || class {}) {
  /**
   * Helper to retrieve the parent Actor document
   * @type {Actor|null}
   */
  get actor() {
    return this.parent || null;
  }

  /**
   * Define the 5 Sprinter RPG core ability score fields
   * @param {number} [initialValue=10]
   * @returns {foundry.data.fields.SchemaField}
   */
  static defineAbilitiesField(initialValue = 10) {
    const fields = globalThis.foundry.data.fields;
    const defineAbility = () => new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: initialValue }),
      unenhanced: new fields.NumberField({ integer: true, nullable: true, initial: null }),
      mod: new fields.NumberField({ required: true, integer: true, initial: getCOGStatModifier(initialValue) })
    });

    return new fields.SchemaField({
      str: defineAbility(),
      int: defineAbility(),
      con: defineAbility(),
      dex: defineAbility(),
      cha: defineAbility()
    });
  }

  /**
   * Shared schema for temporary health bars (granted by auras, buffs, gear). Every actor
   * type whose `attributes.hp` can receive temp bars must include this field.
   * @returns {foundry.data.fields.SchemaField}
   */
  static defineTempBarsField() {
    const fields = globalThis.foundry.data.fields;
    return new fields.SchemaField({
      count: new fields.NumberField({ integer: true, initial: 0 }),
      maxCount: new fields.NumberField({ integer: true, initial: 0 }),
      hpPerSlot: new fields.NumberField({ integer: true, initial: 0 }),
      currentSlotHp: new fields.NumberField({ integer: true, initial: 0 }),
      source: new fields.StringField({ initial: '' }),
      sourceUuid: new fields.StringField({ initial: '' }),
      // `element.<type>` tag the pool is limited to; empty = absorbs damage of every type
      element: new fields.StringField({ initial: '' })
    });
  }

  /**
   * Shared schema for actor tags array.
   * @returns {foundry.data.fields.ArrayField}
   */
  static defineTagsField() {
    const fields = globalThis.foundry.data.fields;
    return new fields.ArrayField(new fields.StringField(), { initial: [] });
  }

  /**
   * Define the seven gear-slot note fields (head, torso, arms, hands, legs, feet, accessories).
   * @returns {foundry.data.fields.SchemaField}
   */
  static defineGearSlotsField() {
    const fields = globalThis.foundry.data.fields;
    return new fields.SchemaField(BaseActorDataModel.defineGearSlotFields());
  }

  /**
   * Fresh gear slot field instances, for models that add their own slots. (Spreading another
   * SchemaField's `.fields` would reuse instances, which Foundry rejects.)
   * @returns {Object<string, foundry.data.fields.StringField>}
   */
  static defineGearSlotFields() {
    const fields = globalThis.foundry.data.fields;
    return {
      head: new fields.StringField({ initial: '' }),
      torso: new fields.StringField({ initial: '' }),
      arms: new fields.StringField({ initial: '' }),
      hands: new fields.StringField({ initial: '' }),
      legs: new fields.StringField({ initial: '' }),
      feet: new fields.StringField({ initial: '' }),
      accessories: new fields.StringField({ initial: '' })
    };
  }

  /**
   * Define the base limb counts (arms, legs, hands).
   * @returns {foundry.data.fields.SchemaField}
   */
  static defineLimbsField() {
    const fields = globalThis.foundry.data.fields;
    return new fields.SchemaField({
      arms: new fields.NumberField({ integer: true, min: 0, initial: 2 }),
      legs: new fields.NumberField({ integer: true, min: 0, initial: 2 }),
      hands: new fields.NumberField({ integer: true, min: 0, initial: 2 })
    });
  }

  /**
   * Define the gold purse.
   * @returns {foundry.data.fields.SchemaField}
   */
  static defineCurrencyField() {
    const fields = globalThis.foundry.data.fields;
    return new fields.SchemaField({
      gold: new fields.NumberField({ initial: 0, integer: true, min: 0 })
    });
  }

  /**
   * Define the `details` fields every crawler-sheet actor (crawler, NPC) shares: party, floor,
   * XP track, background prose, deity and sponsor placeholders. Spread into each type's `details`.
   * @returns {Object<string, foundry.data.fields.DataField>}
   */
  static defineCharacterDetailsFields() {
    const fields = globalThis.foundry.data.fields;
    return {
      party: new fields.StringField({ initial: '' }),
      crawlerNumber: new fields.StringField({ initial: '' }),
      floor: new fields.StringField({ initial: 'Floor 1' }),
      gender: new fields.StringField({ initial: '' }),
      xp: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        max: new fields.NumberField({ initial: 1000, integer: true }),
        pct: new fields.NumberField({ initial: 0, integer: true })
      }),
      popularity: new fields.NumberField({ initial: 0, integer: true }),
      pastTrauma: new fields.HTMLField({ initial: '' }),
      looseEnds: new fields.HTMLField({ initial: '' }),
      regrets: new fields.HTMLField({ initial: '' }),
      // Free-text placeholders until deities and sponsors are designed
      deityBoons: new fields.StringField({ initial: '' }),
      deitySins: new fields.StringField({ initial: '' }),
      sponsor1: new fields.StringField({ initial: '' }),
      sponsor2: new fields.StringField({ initial: '' }),
      sponsor3: new fields.StringField({ initial: '' })
    };
  }

  /**
   * Define standard Sprinter RPG base attributes schema
   * @returns {foundry.data.fields.SchemaField}
   */
  static defineBaseAttributesField() {
    const fields = globalThis.foundry.data.fields;

    return new fields.SchemaField({
      hp: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 40 }),
        max: new fields.NumberField({ required: true, integer: true, initial: 40 }),
        temp: new fields.NumberField({ integer: true, initial: 0 }),
        pct: new fields.NumberField({ integer: true, initial: 100 }),
        tempBars: BaseActorDataModel.defineTempBarsField()
      }),
      mana: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 10 }),
        max: new fields.NumberField({ required: true, integer: true, initial: 10 }),
        pct: new fields.NumberField({ integer: true, initial: 100 })
      }),
      evade: new fields.SchemaField({
        items: new fields.NumberField({ integer: true, initial: 0 }),
        buffs: new fields.NumberField({ integer: true, initial: 0 }),
        total: new fields.NumberField({ integer: true, initial: 4 })
      }),
      dr: new fields.SchemaField({
        armor: new fields.NumberField({ integer: true, initial: 0 }),
        items: new fields.NumberField({ integer: true, initial: 0 }),
        buffs: new fields.NumberField({ integer: true, initial: 0 }),
        total: new fields.NumberField({ integer: true, initial: 0 })
      }),
      speed: new fields.SchemaField({
        move: new fields.NumberField({ integer: true, initial: 20 }),
        step: new fields.NumberField({ integer: true, initial: 10 }),
        climb: new fields.NumberField({ integer: true, initial: 0 }),
        swim: new fields.NumberField({ integer: true, initial: 0 }),
        fly: new fields.NumberField({ integer: true, initial: 0 }),
        burrow: new fields.NumberField({ integer: true, initial: 0 })
      }),
      aiFavor: new fields.NumberField({ integer: true, initial: 0 }),
      size: new fields.StringField({ initial: DEFAULT_SIZE }),
      debuffs: new fields.StringField({ initial: '' }),
      externalBuffs: new fields.SchemaField({
        buff1: new fields.StringField({ initial: '' }),
        buff2: new fields.StringField({ initial: '' }),
        buff3: new fields.StringField({ initial: '' })
      }),
      limbs: BaseActorDataModel.defineLimbsField()
    });
  }

  /** @override */
  prepareBaseData() {
    // Ensure unenhanced values exist for each ability score
    if (this.abilities) {
      for (const ability of Object.values(this.abilities)) {
        if (ability && isUnsetScore(ability.unenhanced)) {
          ability.unenhanced = ability.value ?? 10;
        }
      }
    }

    // Ensure base limbs exist
    if (this.attributes) {
      if (!this.attributes.limbs) {
        this.attributes.limbs = { arms: 2, legs: 2, hands: 2 };
      }
      if (this.attributes.limbs.arms === undefined || this.attributes.limbs.arms === null) this.attributes.limbs.arms = 2;
      if (this.attributes.limbs.legs === undefined || this.attributes.limbs.legs === null) this.attributes.limbs.legs = 2;
      if (this.attributes.limbs.hands === undefined || this.attributes.limbs.hands === null) this.attributes.limbs.hands = 2;
    }
  }

  /**
   * Shared derived data preparation for actors with core abilities and attributes.
   * Computes gear bonuses, external buffs, debuff penalties, core stat values & modifiers,
   * Evade, DR, HP (with temp HP), and Mana.
   */
  prepareDerivedBaseStats() {
    const actor = this.actor;

    // 0. Cache active actor tags (explicit + derived + active items)
    this.tagSet = collectActorTags(actor || { system: this, type: this.actor?.type });
    this.allTags = Array.from(this.tagSet);
    // Derived rows (static defense, Health Bar stat) judge `self.*` only: no action, no other party
    const derivedContext = buildRollContext({ actor: actor || { system: this, type: this.actor?.type }, phase: 'derived' });

    // 1. Normalize size
    if (this.attributes) {
      const sizeInfo = getSizeInfo(this.attributes.size);
      this.attributes.sizeInfo = sizeInfo;
      this.attributes.sizeNumber = sizeInfo.size;
      this.attributes.sizeLabel = sizeLabel(sizeInfo.id);
    }

    // 2. Gather items, equipped gear and active buffs
    const items = Array.from(actor?.items ?? []);
    const equippedGear = items.filter(i => i.type === 'gear' && i.system?.equipped);
    const gear = collectGearBonuses(equippedGear);

    // 3. Resolve active external buffs (up to 3)
    const activeBuffs = actor?.getActiveBuffs ? actor.getActiveBuffs() : [];
    const buffs = collectBuffBonuses(activeBuffs);

    // Typed defenseModifiers rows: equipped gear, and every other source (buffs, debuffs, skills, race, class)
    const modifierSources = getActiveModifierSources(actor);
    if (this.attributes) this.attributes.senses = collectSenses(actor, modifierSources);
    const gearDefense = collectStaticDefense(modifierSources.filter(s => s.type === 'gear'), derivedContext);
    const otherDefense = collectStaticDefense(modifierSources.filter(s => s.type !== 'gear'), derivedContext);
    const buffTempHp = gearDefense.tempHp + otherDefense.tempHp;
    const resistances = new Set([...gearDefense.resistances, ...otherDefense.resistances]);
    const immunities = new Set([...gearDefense.immunities, ...otherDefense.immunities]);

    // 4. Debuff stat penalties and limb changes: embedded debuff items plus persistent gear debuffs
    const debuffs = collectDebuffEffects([
      ...items.filter(i => i.type === 'debuff'),
      ...resolvePersistentDebuffs(items, equippedGear)
    ]);
    const buffStatBonuses = Object.fromEntries(Object.keys(buffs.stats).map(k => [k, buffs.stats[k] + debuffs.stats[k]]));
    const gearStatBonuses = gear.stats;
    const gearDR = gear.dr + gearDefense.dr;
    const gearEvade = gearDefense.evade;
    const modifierDR = otherDefense.dr;
    const modifierEvade = otherDefense.evade;
    const deltaArms = buffs.limbs.arms + debuffs.limbs.arms;
    const deltaLegs = buffs.limbs.legs + debuffs.limbs.legs;
    const deltaHands = buffs.limbs.hands + debuffs.limbs.hands;

    // 5. Calculate 5 Core Ability Scores and Modifiers using unenhanced base + gear bonuses + external buff bonuses
    if (this.abilities) {
      const statCaps = getStatCaps(actor);
      for (const [key, ability] of Object.entries(this.abilities)) {
        const unenhanced = resolveBaseScore(ability);
        ability.unenhanced = unenhanced;
        // Race/class stat cap: shown beside the score, and flagged when the base score is above it.
        ability.statCap = statCaps[key] ?? null;
        ability.overCap = ability.statCap !== null && unenhanced > ability.statCap;
        const flatMod = gearStatBonuses[key]?.flat || 0;
        const pctMod = gearStatBonuses[key]?.pct || 0;
        const buffMod = buffStatBonuses[key] || 0;

        // Percentage bonus rounded up (e.g. +10% of 10 = +1)
        const pctBonus = pctMod !== 0
          ? (pctMod > 0 ? Math.ceil((unenhanced * pctMod) / 100) : Math.floor((unenhanced * pctMod) / 100))
          : 0;

        ability.gearBonus = flatMod + pctBonus;
        ability.buffBonus = buffMod;
        ability.value = unenhanced + ability.gearBonus + ability.buffBonus;
        ability.mod = getCOGStatModifier(ability.value);
      }
    }

    // 6. Calculate Evade, DR, HP, and Mana
    if (this.attributes) {
      this.attributes.resistances = Array.from(resistances);
      this.attributes.immunities = Array.from(immunities);
      this.attributes.activeBuffs = activeBuffs;

      const dexMod = this.abilities?.dex?.mod ?? 0;
      const evadeBuffs = Number(this.attributes.evade?.buffs) || 0;
      if (this.attributes.evade) {
        this.attributes.evade.items = gearEvade;
        this.attributes.evade.gear = gearEvade;
        this.attributes.evade.fromBuffs = modifierEvade;
        this.attributes.evade.total = dexMod + evadeBuffs + modifierEvade + gearEvade;
      }

      if (this.attributes.dr && typeof this.attributes.dr === 'object') {
        const drArmor = Number(this.attributes.dr.armor) || 0;
        const drBuffs = Number(this.attributes.dr.buffs) || 0;
        this.attributes.dr.items = gearDR;
        this.attributes.dr.gear = gearDR;
        this.attributes.dr.fromModifiers = modifierDR;
        this.attributes.dr.total = drArmor + drBuffs + modifierDR + gearDR;
      }

      // Lift limit (book): Strength score x 15 lb; a `lift` statSubstitutions row swaps the stat. Shown, never enforced.
      if (this.abilities?.str && actor) {
        const liftSub = resolveStatSubstitution(actor, 'lift', 'str', derivedContext);
        const liftScore = Number(this.abilities?.[liftSub.stat]?.value) || 0;
        this.attributes.liftMax = Math.max(0, liftScore) * 15;
        this.attributes.liftStat = liftSub.stat;
      }

      if (this.attributes.hp) {
        if (actor?.type !== 'mount_vehicle') {
          // statSubstitutions rows, `healthBar` scope: another stat's mod sets the HP per Health Bar (spec 3.6)
          const hbSub = actor ? resolveStatSubstitution(actor, 'healthBar', 'con', derivedContext) : null;
          const conMod = hbSub?.substituted ? hbSub.mod : (this.abilities?.con?.mod ?? 1);
          this.attributes.hp.max = 10 * conMod;
          if (hbSub?.substituted) this.attributes.hp.hpPerBar = Math.max(1, conMod);
        }
        if (this.attributes.hp.bars === undefined) {
          this.attributes.hp.bars = 10;
        }
        // A null value means "not set yet" (new mob); the type's own derivation resolves it to full health.
        if (this.attributes.hp.value !== null) {
          const rawVal = Number(this.attributes.hp.value);
          const hpVal = Number.isFinite(rawVal) ? rawVal : this.attributes.hp.max;
          this.attributes.hp.value = hpVal;
          const hpMax = Number(this.attributes.hp.max) || 1;
          this.attributes.hp.pct = Math.min(100, Math.max(0, Math.round((hpVal / hpMax) * 100)));
        }

        if (buffTempHp > 0) {
          this.attributes.hp.buffTemp = buffTempHp;
          if (this.attributes.hp.temp === undefined || this.attributes.hp.temp === null || Number(this.attributes.hp.temp) <= 0) {
            this.attributes.hp.temp = buffTempHp;
          }
        }
      }

      if (this.attributes.mana) {
        const enhancedInt = Number(this.abilities?.int?.value) || 0;
        this.attributes.mana.max = enhancedInt;
        const rawMana = Number(this.attributes.mana.value);
        const manaVal = Number.isFinite(rawMana) ? rawMana : this.attributes.mana.max;
        this.attributes.mana.value = manaVal;
        const manaMax = Number(this.attributes.mana.max) || 1;
        this.attributes.mana.pct = Math.min(100, Math.max(0, Math.round((manaVal / manaMax) * 100)));
      }

      if (this.attributes.speed) {
        if (this.attributes.speed.move === undefined || this.attributes.speed.move === null || this.attributes.speed.move === '') {
          this.attributes.speed.move = 20;
        }
        if (this.attributes.speed.step === undefined || this.attributes.speed.step === null || this.attributes.speed.step === '') {
          this.attributes.speed.step = 10;
        }
      }

      // 7. Calculate Limbs (Arms, Legs, Hands) and Wielding Hand Limit
      const baseArms = Number(this.attributes?.limbs?.arms ?? 2);
      const baseLegs = Number(this.attributes?.limbs?.legs ?? 2);
      const baseHands = Number(this.attributes?.limbs?.hands ?? 2);

      const maxArms = Math.max(0, (Number.isFinite(baseArms) ? baseArms : 2) + deltaArms);
      const maxLegs = Math.max(0, (Number.isFinite(baseLegs) ? baseLegs : 2) + deltaLegs);
      const maxHands = Math.max(0, (Number.isFinite(baseHands) ? baseHands : 2) + deltaHands);

      let usedHands = 0;
      const equippedHandItems = [];

      for (const item of items) {
        const hands = calculateItemHandsRequired(item);
        if (hands > 0) {
          usedHands += hands;
          equippedHandItems.push({
            id: item.id || item._id,
            name: item.name,
            hands
          });
        }
      }

      const exceededHands = usedHands > maxHands;
      const handsWarning = exceededHands
        ? `Hands limit exceeded: Wielding gear in ${usedHands} hands, but only ${maxHands} hands available!`
        : '';

      if (!this.attributes.limbs) {
        this.attributes.limbs = { arms: baseArms, legs: baseLegs, hands: baseHands };
      }
      this.attributes.limbs.arms = baseArms;
      this.attributes.limbs.legs = baseLegs;
      this.attributes.limbs.hands = baseHands;
      this.attributes.limbs.maxArms = maxArms;
      this.attributes.limbs.maxLegs = maxLegs;
      this.attributes.limbs.maxHands = maxHands;
      this.attributes.limbs.deltaArms = deltaArms;
      this.attributes.limbs.deltaLegs = deltaLegs;
      this.attributes.limbs.deltaHands = deltaHands;
      this.attributes.limbs.usedHands = usedHands;
      this.attributes.limbs.equippedHandItems = equippedHandItems;
      this.attributes.limbs.exceededHands = exceededHands;
      this.attributes.limbs.handsWarning = handsWarning;
    }

    return { items, equippedGear, activeBuffs };
  }

  /**
   * Derive owned skill and spell ranks (gear skill bonuses, rank_bonus grants, weapon-group totals).
   * Runs for every actor type that derives base stats; call after `prepareDerivedBaseStats()`.
   * @param {{items: object[], equippedGear: object[], activeBuffs: object[]}} ctx
   */
  prepareDerivedItemRanks({ items = [], equippedGear = [], activeBuffs = [] } = {}) {
    const gearSkillBonuses = collectGearSkillBonuses(equippedGear);
    const tagGrants = collectTagBonusGrants({ equippedGear, activeBuffs, items });
    const opts = { abilities: this.abilities, gearSkillBonuses, tagGrants };
    deriveSkillRanks(items.filter(i => i.type === 'skill'), { ...opts, animalSkillsLocked: animalSkillsLockedFor(this.tagSet, items) });
    deriveSpellRanks(items.filter(i => i.type === 'spell'), opts);
  }
}
