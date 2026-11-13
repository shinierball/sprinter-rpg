/**
 * Floor Simulator loot tiers (Question J (a)).
 * `LOOT_TIERS[slot][tier]` holds the book's tier numbers (bonuses, DR, quantities, Ranks) with original item names.
 * The system ships these as rules; a homebrew or content module replaces them with `CONFIG.COG.lootTiers`
 * (read through `getLootTiers()`), so nothing here is a closed enum.
 *
 * Shape: `LOOT_TIERS[slot][tier] = { label, spellsAllowed, bonuses?, options: [Option], spells? }`.
 *  - `bonuses` (weapons and armor): `{ skill, damage, stat, scroll, aiFavorRatings, dr, tags, resistance, con, grantSkillChoices, grantSkill }`.
 *  - `options`: what the player can take instead of Spells. `{ id, label, kind, ... }` with kind one of
 *    `weaponUpgrade | weaponNew | armor | item | bracelet | accessory | skillPotion | consumable | scrollSpell`.
 *  - `spells` (weapon, armor, item tiers): `{ variants: [{ id, picks: ['1d4', ...], potions }] }`; each pick is a Rank die.
 *
 * `compileLootPick(slot, tier, choice, state, ctx)` turns one chosen option into payloads and updates through
 * `buildPayload`. It is pure: it reads the working state and writes nothing; the step applies the result.
 */
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { damageTypesOfRarity } from '../../utils/damage/damage-types.mjs';
import { getStarterWeaponDefinition, starterPotionPayload, weaponTagsForSkill } from '../../content/creation-loadouts.mjs';
import { buildPayload } from '../builders/item-payload.mjs';
import { skillPotionPayload } from '../skill-potion-payload.mjs';
import { cleanText } from './state.mjs';
import { stableId } from '../../utils/stable-id.mjs';
import { prefillAiFavorRating } from '../../utils/character/ai-favor.mjs';
import { HAZARD_BREAKS_ON, HAZARD_ENCHANTMENTS, breakItemUpdate, buildEnchantmentWrite, enchantmentCount } from '../../utils/crafting/crafting-engine.mjs';

export const LOOT_SLOTS = Object.freeze(['weapon', 'armor', 'item', 'consumable']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Catalog item the tiers reference by `_id` (quantity set at build time). The mana potion comes from the loadout reader. */
const ANTIDOTE_REF = 'dccitm0000000006';

const heal = (name, bars) => ({ name, type: 'heal', healBars: bars, targetType: 'self' });
const consumable = (id, label, name, quantity, outcomes, extra = {}) => ({
  id, label, kind: 'consumable', name, quantity, outcomes, ...extra
});
const mundane = (id, label, name) => ({ id, label, kind: 'item', name, description: `${label}. Narrative only.` });

/** Stat and paired Skill of the Gold accessory (the book's five pairs). */
const ACCESSORY_PAIRS = Object.freeze([
  { id: 'str', stat: 'str', skill: 'climbing', label: 'Strength and Climbing' },
  { id: 'dex', stat: 'dex', skill: 'lockpicking', label: 'Dexterity and Lockpicking' },
  { id: 'int', stat: 'int', skill: 'fabricate', label: 'Intelligence and Fabricate' },
  { id: 'con', stat: 'con', skill: 'survival', label: 'Constitution and Survival' },
  { id: 'cha', stat: 'cha', skill: 'streetwise', label: 'Charisma and Streetwise' }
]);

const SPELL_VARIANTS = Object.freeze({
  bronze: [{ id: 'a', picks: ['1d4'], potions: 1 }],
  silver: [{ id: 'a', picks: ['2d4'], potions: 2 }, { id: 'b', picks: ['1d4', '1d4'], potions: 0 }],
  gold: [{ id: 'a', picks: ['1d4', '1d4', '1d4'], potions: 3 }],
  platinum: [{ id: 'a', picks: ['2d4', '2d4'], potions: 4 }, { id: 'b', picks: ['1d4', '1d4', '1d4', '1d4'], potions: 0 }]
});

const slotTier = (tier, label, spellsAllowed, rest) => ({ tier, label, spellsAllowed, ...rest });

function weaponTier(tier, bonuses, withUpgrade) {
  const options = [];
  if (withUpgrade) options.push({ id: 'upgrade', label: 'Upgrade your weapon', kind: 'weaponUpgrade' });
  options.push({ id: 'new', label: 'A new weapon', kind: 'weaponNew', defaultName: tier === 'bronze' ? 'Amusing Weapon' : 'Prize Weapon', damageDice: tier === 'bronze' ? '1d6' : null });
  return slotTier(tier, `${tier} weapon`, true, { bonuses, options, spells: { variants: SPELL_VARIANTS[tier] } });
}

function armorTier(tier, bonuses) {
  return slotTier(tier, `${tier} armor`, true, {
    bonuses, options: [{ id: 'armor', label: `${tier} armor`, kind: 'armor', defaultName: tier === 'bronze' ? 'Awkward Padding' : 'Prize Armor' }],
    spells: { variants: SPELL_VARIANTS[tier] }
  });
}

/** The book's tier numbers with original item names. Frozen; copy before editing. */
/** The Bronze loot weapon's book rating: "AI Favor: 2 when fighting Bosses" (the target is any registered boss tier). */
const BRONZE_BOSS_RATING = Object.freeze({ label: '', value: 2, condition: { all: ['subject.mob.boss'], any: [], none: [] }, minRank: 0, maxRank: null });

export const LOOT_TIERS = Object.freeze({
  weapon: Object.freeze({
    bronze: weaponTier('bronze', { aiFavorRatings: [BRONZE_BOSS_RATING] }, false),
    silver: weaponTier('silver', { skill: 1, damage: 1 }, true),
    gold: weaponTier('gold', { skill: 1, scroll: true }, true),
    platinum: weaponTier('platinum', { skill: 2, stat: 3, statChoices: ['str', 'dex'], scroll: true }, true)
  }),
  armor: Object.freeze({
    bronze: armorTier('bronze', { dr: 1 }),
    silver: armorTier('silver', { dr: 2, tags: ['rule.anti-piercing'] }),
    gold: armorTier('gold', { dr: 3, resistanceRarity: 'uncommon' }),
    platinum: armorTier('platinum', { dr: 4, con: 5, grantSkill: 3, grantSkillChoices: ['catcher', 'taunt'] })
  }),
  item: Object.freeze({
    bronze: slotTier('bronze', 'bronze item', true, {
      options: [
        mundane('rope', '50 feet of rope', 'Coil of Rope (50 ft)'), mundane('bicycle', 'A bicycle', 'Folding Bicycle'),
        mundane('canoe', 'A canoe and paddle', 'Canoe and Paddle'), mundane('glider', 'A hang glider', 'Hang Glider')
      ],
      spells: { variants: SPELL_VARIANTS.bronze }
    }),
    silver: slotTier('silver', 'silver item', true, {
      options: [{ id: 'bracelet', label: 'Friendship Bracelet of a race', kind: 'bracelet', name: 'Friendship Bracelet' }],
      spells: { variants: SPELL_VARIANTS.silver }
    }),
    gold: slotTier('gold', 'gold item', true, {
      bonuses: { stat: 3, skill: 3 },
      options: ACCESSORY_PAIRS.map(p => ({ ...p, kind: 'accessory', name: 'Prize Accessory' })),
      spells: { variants: SPELL_VARIANTS.gold }
    }),
    platinum: slotTier('platinum', 'platinum item', true, {
      bonuses: { skillRank: 3 },
      options: [{ id: 'skillPotion', label: '+3 Skill Potion (permanent)', kind: 'skillPotion', name: 'Potion of Study' }],
      spells: { variants: SPELL_VARIANTS.platinum }
    })
  }),
  consumable: Object.freeze({
    bronze: slotTier('bronze', 'bronze consumable', false, {
      options: [
        consumable('healing', '10 Healing Potions (5 Health Bar slots)', 'Healing Potion', 10, [heal('Healing', 5)], { usedInto: 'empty-bottle' }),
        consumable('bandages', '10 Bandages (remove Blood Trail)', 'Bandages', 10, [{ name: 'Bind the wound', type: 'cure_debuff', debuffTarget: 'blood-trail', targetType: 'self' }]),
        consumable('torches', '10 Torches (20 ft bright, 20 ft dim, about an hour)', 'Torch', 10, [], { notes: 'Bright out to 20 feet, dim for 20 feet beyond that. Burns out in about an hour.' }),
        consumable('dynamite', '1 stick of basic dynamite', 'Stick of Dynamite', 1, [
          { name: 'Blast', type: 'damage', damage: '1d6', damageType: 'Bludgeoning', targetType: 'closest_mob' }
        ], { notes: 'Thrown. 0 ft blast radius plus 5 ft splash.' })
      ]
    }),
    silver: slotTier('silver', 'silver consumable', false, {
      options: [
        { id: 'antidotes', label: 'Two Poison Antidotes', kind: 'consumable', catalog: ANTIDOTE_REF, name: 'Antidote Flask', quantity: 2 },
        consumable('goodHealing', 'One Silver Healing Tonic (6 Health Bar slots)', 'Silver Healing Tonic', 1, [heal('Silver healing', 6)], { usedInto: 'empty-bottle' }),
        consumable('goodDynamite', 'One stick of fine dynamite', 'Stick of Fine Dynamite', 1, [
          { name: 'Blast', type: 'damage', damage: '2d6', damageType: 'Bludgeoning', targetType: 'closest_mob' }
        ], { notes: 'Thrown. 5 ft blast radius plus 5 ft splash.' })
      ]
    }),
    gold: slotTier('gold', 'gold consumable', false, {
      options: [
        { id: 'scroll', label: 'A Spell Scroll of a random spell, cast at Rank 5', kind: 'scrollSpell', rank: 5 },
        consumable('premiumHealing', 'One Premium Healing Draught (7 Health Bar slots, mends one Minor Injury)', 'Premium Healing Draught', 1, [
          heal('Premium healing', 7), { name: 'Mend', type: 'mend_injury', injurySeverity: 'minor', targetType: 'self' }
        ], { usedInto: 'empty-bottle' })
      ]
    }),
    platinum: slotTier('platinum', 'platinum consumable', false, {
      options: [
        consumable('remedyTicket', 'A Remedy Scratcher ticket', 'Remedy Scratcher', 1, [
          { name: 'Bottled calm', weight: 50, type: 'heal', healBars: 5, targetType: 'self' },
          { name: 'Soothing mist', weight: 50, type: 'cure_debuff', debuffTarget: 'all', targetType: 'self' }
        ], { lootType: 'scratch_ticket', cooldown: { value: 1, unit: 'scene' } }),
        consumable('orbitTicket', 'An Orbit Roulette Scratcher ticket', 'Orbit Roulette Scratcher', 1, [
          { name: 'Mana bloom', weight: 50, type: 'restore_resource', resource: 'mana', mode: 'full', targetType: 'self' },
          { name: 'Pocket change', weight: 50, type: 'heal', healBars: 3, targetType: 'self' }
        ], { lootType: 'scratch_ticket', cooldown: { value: 1, unit: 'scene' } })
      ]
    })
  })
});

/** The active tier set: `CONFIG.COG.lootTiers` when a module or world replaced it, else the system's. */
export function getLootTiers() {
  const configured = globalThis.CONFIG?.COG?.lootTiers;
  return isObj(configured) && Object.keys(configured).length ? configured : LOOT_TIERS;
}

/**
 * The slot cards a Table 25 row offers, optionally filtered to `tiers` (D4a).
 * @param {{ options?: object[] }|null} row a TableSnapshot row
 * @param {string[]|null} tiers null keeps every slot
 * @returns {Array<{ slot: string, tier: string, spellsAllowed: boolean, label: string }>}
 */
export function slotsForTiers(row, tiers = null) {
  const wanted = Array.isArray(tiers) && tiers.length ? new Set(tiers.map(cleanText)) : null;
  return (Array.isArray(row?.options) ? row.options : [])
    .filter(o => o?.kind === 'lootSlot' && o.slot && o.tier && (!wanted || wanted.has(cleanText(o.tier))))
    .map(o => ({ slot: cleanText(o.slot), tier: cleanText(o.tier), spellsAllowed: o.spellsAllowed !== false && cleanText(o.slot) !== 'consumable', label: cleanText(o.label) }));
}

function newPick() {
  return { creates: [], updates: [], unequip: [], newWeapon: null, notes: [], warnings: [], breaks: [], scrollPending: false, summary: '' };
}

const skillName = (ctx, identifier) => ctx?.catalog?.skills?.find(s => s.identifier === identifier)?.name || identifier;

/** buildPayload with its warnings routed to the pick's warning list. */
function build(out, type, spec, label) {
  const warnings = [];
  const payload = buildPayload(type, spec, { warnings });
  for (const w of warnings) out.warnings.push(`${label}: ${w.message}`);
  return payload;
}

const skillGrant = (ctx, identifier, value) => ({ kind: 'skill', identifier, label: skillName(ctx, identifier), value });

function catalogCopy(ref, quantity) {
  const entry = findCatalogEntry('items', ref);
  if (!entry) return null;
  const copy = structuredClone(entry);
  delete copy._id;
  delete copy.id;
  copy.system = { ...(copy.system ?? {}), quantity };
  return copy;
}

function lootSpec(option) {
  return {
    name: option.name,
    system: {
      quantity: option.quantity ?? 1, lootType: option.lootType ?? 'consumable', executionMode: option.lootType === 'scratch_ticket' ? '' : 'all',
      cooldown: option.cooldown ?? { value: 0, unit: '' }, outcomes: structuredClone(option.outcomes ?? []), notes: option.notes ?? '',
      description: option.description ?? option.notes ?? '',
      ...(option.usedInto ? { usedInto: option.usedInto } : {})
    }
  };
}

function weaponBonusRows(ctx, bonuses, skill, stat, out, label) {
  const grants = [];
  const damageModifiers = [];
  if (bonuses.skill) {
    if (skill) grants.push(skillGrant(ctx, skill, bonuses.skill));
    else out.warnings.push(`${label}: no weapon Skill was named, so the +${bonuses.skill} Skill bonus was skipped.`);
  }
  if (bonuses.damage) damageModifiers.push({ label: `+${bonuses.damage} damage`, mode: 'add', value: bonuses.damage });
  // A new weapon carries the stat row itself; an upgrade stamps it as its own ledger entry.
  const statRows = bonuses.stat && stat ? [{ kind: 'stat', stat, value: bonuses.stat }] : [];
  return { grants, damageModifiers, statRows };
}

function pickStat(out, bonuses, choice, label) {
  if (!bonuses.stat) return '';
  const choices = Array.isArray(bonuses.statChoices) ? bonuses.statChoices : [];
  const picked = cleanText(choice.stat).toLowerCase() || choices[0] || '';
  if (choices.length && !choices.includes(picked)) out.breaks.push({ key: 'offOption', reason: `${label}: ${picked || 'that stat'} is not one of ${choices.join(' or ')}` });
  return picked;
}

function compileWeapon(option, tierSpec, choice, state, ctx, out, label, rollHazard) {
  const bonuses = tierSpec.bonuses ?? {};
  const weapons = Array.isArray(state.weapons) ? state.weapons : [];
  const stat = pickStat(out, bonuses, choice, label);
  if (option.kind === 'weaponUpgrade') {
    const weapon = weapons.find(w => w.id === cleanText(choice.weaponId)) ?? weapons.find(w => w.equipped) ?? weapons[0];
    if (!weapon) { out.warnings.push(`${label}: there is no weapon to upgrade.`); return; }
    const skill = cleanText(choice.skill) || cleanText(weapon.skillIdentifier);
    const rows = weaponBonusRows(ctx, bonuses, skill, stat, out, label);
    const update = { _id: weapon.id };
    // The book applies the over-enchanting 1d10 "by any means": a weapon already at the engine's threshold risks breaking.
    const enchantCount = enchantmentCount(weapon);
    if (enchantCount >= HAZARD_ENCHANTMENTS && typeof rollHazard === 'function') {
      const roll = rollHazard();
      if (roll) {
        const destroyed = roll.total <= HAZARD_BREAKS_ON;
        out.hazard = { weaponId: weapon.id, name: weapon.name, count: enchantCount, total: roll.total, dice: roll.dice ?? null, destroyed };
        if (destroyed) {
          Object.assign(update, breakItemUpdate(weapon, { destroyed: true }));
          out.updates.push(update);
          out.upgrade = { weaponId: weapon.id, destroyed: true, grants: [], damageModifiers: [], enchantments: [] };
          out.summary = `${weapon.name} destroyed by the over-enchant roll`;
          return;
        }
      }
    }
    // One ledger entry per bonus (the book: a Skill Rank and a damage bonus are two enchantments): stamped rows plus an entry each.
    // No dialog; the simulator's own Rule Break keys decide.
    const templates = [];
    if (rows.grants.length) templates.push({ label: option.label || 'Weapon upgrade', property: '', category: 'active', bonusLevel: bonuses.skill, rows: { grants: rows.grants } });
    if (rows.damageModifiers.length) templates.push({ label: `+${bonuses.damage} damage`, property: '', category: 'other', bonusLevel: bonuses.damage, rows: { damageModifiers: rows.damageModifiers } });
    if (bonuses.stat && stat) templates.push({ label: `+${bonuses.stat} ${stat.toUpperCase()}`, property: '', category: 'stat', bonusLevel: bonuses.stat, rows: { grants: [{ kind: 'stat', stat, value: bonuses.stat, label: `+${bonuses.stat} ${stat.toUpperCase()}` }] } });
    let working = { grants: weapon.grants, damageModifiers: weapon.damageModifiers, enchantments: weapon.enchantments };
    const stamped = { grants: [], damageModifiers: [] };
    const entries = [];
    for (const template of templates) {
      // The ledger id follows the weapon and the bonus, so the same answers compile to the same payload.
      const written = buildEnchantmentWrite(working, template, { id: stableId(`upgrade:${weapon.id}:${template.label}:${(working.enchantments ?? []).length}`), method: 'floor-simulator' });
      Object.assign(update, written.update);
      working = { ...working, ...Object.fromEntries(Object.entries(written.update).map(([key, value]) => [key.slice('system.'.length), value])) };
      for (const array of Object.keys(stamped)) stamped[array].push(...(written.rows[array] ?? []));
      entries.push(written.entry);
    }
    out.updates.push(update);
    out.upgrade = { weaponId: weapon.id, grants: stamped.grants, damageModifiers: stamped.damageModifiers, enchantments: entries };
    out.summary = `${weapon.name} upgraded`;
  } else {
    const def = getStarterWeaponDefinition(cleanText(choice.weapon) || cleanText(choice.name) || option.defaultName);
    const name = cleanText(choice.name) || def.name;
    // The weapon's Skill supplies its Base Damage. A starter weapon type (it has a Skill) never takes an override; the option's
    // own dice apply only to a weapon that is no starter type (the unnamed default).
    const baseDamage = option.damageDice && !def.skillIdentifier ? { baseDamage: { dice: option.damageDice } } : {};
    const skill = cleanText(choice.skill);
    // The weapon's own Skill is its loadout's; a weapon that is no starter weapon takes the Skill its bonus went to.
    const weaponSkill = cleanText(def.skillIdentifier) || skill;
    const associatedSkills = weaponSkill ? [weaponSkill] : [];
    const tags = weaponTagsForSkill(weaponSkill);
    const rows = weaponBonusRows(ctx, bonuses, skill, stat, out, label);
    const gear = build(out, 'weapon', {
      name, img: def.img,
      system: {
        slot: 'hands', quantity: 1, equipped: true, isWeapon: true, toHitStat: def.toHitStat, ...baseDamage, associatedSkills, tags,
        aiFavorRatings: structuredClone(bonuses.aiFavorRatings ?? []), grants: [...rows.statRows, ...rows.grants], damageModifiers: rows.damageModifiers,
        notes: def.effects || ''
      }
    }, label);
    // The AI Favor reader looks at the attack item, not the gear it was made from: the rows ride on both, like the creator's starter attack.
    const attack = build(out, 'attack', { name, img: def.img, system: { toHitStat: def.toHitStat, toHitRank: 3, ...baseDamage, associatedSkills, tags, effects: def.effects || '', aiFavorRatings: structuredClone(bonuses.aiFavorRatings ?? []) } }, label);
    out.creates.push(gear, attack);
    out.unequip = weapons.filter(w => w.equipped).map(w => w.id);
    out.newWeapon = { name, aiFavor: prefillAiFavorRating(bonuses.aiFavorRatings), aiFavorRatings: structuredClone(bonuses.aiFavorRatings ?? []), skillIdentifier: skill, grants: [...rows.statRows, ...rows.grants], damageModifiers: rows.damageModifiers };
    out.summary = `${name} (new weapon)`;
  }
  if (bonuses.scroll) {
    // The loot step resolves the Scroll of Upgrade on the upgrade table (S7b); the flag asks it to.
    out.scrollPending = true;
  }
}

function compileArmor(option, tierSpec, choice, ctx, out, label) {
  const b = tierSpec.bonuses ?? {};
  const grants = [];
  const system = { slot: cleanText(choice.slot) || 'torso', quantity: 1, equipped: false, drBonus: b.dr ?? 0 };
  if (b.tags) system.tags = [...b.tags];
  if (b.resistanceRarity) {
    const type = cleanText(choice.resistance);
    const offered = damageTypesOfRarity(b.resistanceRarity);
    if (!type) out.warnings.push(`${label}: no ${b.resistanceRarity} damage type was chosen for the Resistance.`);
    else {
      if (offered.length && !offered.some(t => t.toLowerCase() === type.toLowerCase())) out.breaks.push({ key: 'offOption', reason: `${label}: ${type} is not an ${b.resistanceRarity} damage type` });
      system.defenseModifiers = [{ kind: 'resistance', label: `${type} Resistance`, damageType: type }];
    }
  }
  if (b.con) grants.push({ kind: 'stat', stat: 'con', value: b.con });
  if (b.grantSkillChoices) {
    const skill = cleanText(choice.skill).toLowerCase();
    if (!skill) out.warnings.push(`${label}: choose ${b.grantSkillChoices.join(' or ')} for the +${b.grantSkill} Skill bonus.`);
    else {
      if (!b.grantSkillChoices.includes(skill)) out.breaks.push({ key: 'offOption', reason: `${label}: ${skill} is not ${b.grantSkillChoices.join(' or ')}` });
      grants.push(skillGrant(ctx, skill, b.grantSkill));
    }
  }
  if (grants.length) system.grants = grants;
  const name = cleanText(choice.name) || option.defaultName;
  out.creates.push(build(out, 'gear', { name, system }, label));
  out.summary = `${name} (+${b.dr} DR)`;
}

function compileItem(option, tierSpec, choice, ctx, out, label) {
  const name = cleanText(choice.name) || option.name;
  if (option.kind === 'item') {
    out.creates.push(build(out, 'loot', { name, system: { quantity: 1, lootType: 'consumable', notes: option.description, description: option.description } }, label));
  } else if (option.kind === 'bracelet') {
    const race = cleanText(choice.race).toLowerCase();
    if (!race) out.warnings.push(`${label}: no race was chosen for the bracelet; it was created without a race tag.`);
    out.creates.push(build(out, 'gear', {
      name: race ? `${name} of ${race} kind` : name,
      system: { slot: 'accessory', quantity: 1, equipped: false, ...(race ? { tags: [`id.race.${race}`] } : {}) }
    }, label));
  } else if (option.kind === 'accessory') {
    out.creates.push(build(out, 'gear', {
      name, system: {
        slot: 'accessory', quantity: 1, equipped: false,
        grants: [{ kind: 'stat', stat: option.stat, value: tierSpec.bonuses.stat }, skillGrant(ctx, option.skill, tierSpec.bonuses.skill)]
      }
    }, label));
  } else if (option.kind === 'skillPotion') {
    const skill = cleanText(choice.skill);
    if (!skill) { out.warnings.push(`${label}: choose a Skill for the potion; nothing was created.`); return; }
    const warnings = [];
    out.creates.push(skillPotionPayload({ name: skillName(ctx, skill), identifier: skill }, tierSpec.bonuses.skillRank, { name, warnings }));
    for (const w of warnings) out.warnings.push(`${label}: ${w.message}`);
  }
  out.summary = out.creates.at(-1)?.name ?? '';
}

function compileConsumable(option, state, choice, ctx, out, label) {
  if (option.kind === 'scrollSpell') {
    const identifier = cleanText(choice.spell);
    if (!identifier) { out.warnings.push(`${label}: no spell was rolled or chosen for the scroll; nothing was created.`); return; }
    const spell = findCatalogEntry('spells', identifier);
    const name = spell?.name || identifier;
    out.creates.push(build(out, 'loot', {
      name: `Scroll of ${name}`,
      system: {
        quantity: 1, lootType: 'scroll', executionMode: 'all', spellIdentifier: identifier, spellName: name,
        outcomes: [{ name: `Cast ${name}`, type: 'spell', spellIdentifier: identifier, spellRank: option.rank, targetType: 'self' }],
        notes: `Casts ${name} at Rank ${option.rank}.`
      }
    }, label));
    out.summary = `Scroll of ${name}`;
    return;
  }
  const quantity = option.quantity ?? 1;
  const fromCatalog = option.catalog ? catalogCopy(option.catalog, quantity) : null;
  if (fromCatalog) out.creates.push(build(out, 'loot', fromCatalog, label));
  else out.creates.push(build(out, 'loot', lootSpec(option), label));
  out.summary = `${out.creates.at(-1).name} x${quantity}`;
}

/**
 * Compile one chosen (non-spell) loot option.
 * @param {string} slot weapon | armor | item | consumable
 * @param {string} tier bronze | silver | gold | platinum
 * @param {object} choice `{ option, weaponId?, skill?, stat?, name?, weapon?, slot?, resistance?, race?, spell? }`
 * @param {object} state the working state (reads `state.weapons`)
 * @param {object} ctx the FloorSimContext (`ctx.lootTiers`, `ctx.catalog`)
 * @param {{ rollHazard?: () => ({ total: number, dice?: number[] }|null) }} [hooks] `rollHazard` rolls the over-enchanting 1d10 when an upgraded weapon already carries the hazard count; without it nothing is rolled
 * @returns {{ creates: object[], updates: object[], unequip: string[], newWeapon: object|null, upgrade?: object, notes: string[],
 *   warnings: string[], breaks: Array<{key: string, reason: string}>, scrollPending: boolean, summary: string }}
 */
export function compileLootPick(slot, tier, choice, state, ctx, hooks = {}) {
  const out = newPick();
  const tiers = ctx?.lootTiers ?? getLootTiers();
  const tierSpec = tiers?.[slot]?.[tier];
  const label = `${tier} ${slot}`;
  if (!tierSpec) { out.warnings.push(`There is no ${label} loot defined; the pick was skipped.`); return out; }
  const ch = isObj(choice) ? choice : {};
  const options = Array.isArray(tierSpec.options) ? tierSpec.options : [];
  const wanted = cleanText(ch.option);
  const option = wanted ? options.find(o => o.id === wanted) : (options.length === 1 ? options[0] : null);
  if (!option) {
    out.warnings.push(wanted ? `${wanted} is not offered by ${label} loot; the pick was skipped.` : `${label} loot needs an option chosen; the pick was skipped.`);
    return out;
  }
  if (option.kind === 'weaponUpgrade' || option.kind === 'weaponNew') compileWeapon(option, tierSpec, ch, state, ctx, out, label, hooks.rollHazard);
  else if (option.kind === 'armor') compileArmor(option, tierSpec, ch, ctx, out, label);
  else if (slot === 'consumable') compileConsumable(option, state, ch, ctx, out, label);
  else compileItem(option, tierSpec, ch, ctx, out, label);
  return out;
}

/** The Spells-instead variants of a tier (the tier's own, else the standard set for that tier id). */
export function spellVariantsFor(tierSpec, tier) {
  const own = tierSpec?.spells?.variants;
  return Array.isArray(own) && own.length ? own : (SPELL_VARIANTS[tier] ?? []);
}

/**
 * Mana Potions through the starter-potion reader (3.6a D3): the registered potion's catalog copy, else its embedded
 * fallback (the system example when nothing is registered); a plain one only when even that cannot be built.
 * @param {number} quantity
 * @param {string[]} [warnings]
 */
export function manaPotionPayload(quantity, warnings = []) {
  const payload = starterPotionPayload(quantity, warnings);
  if (payload) return payload;
  return buildPayload('loot', {
    name: 'Mana Potion',
    system: { quantity, lootType: 'consumable', executionMode: 'all', outcomes: [{ name: 'Refill Mana', type: 'restore_resource', resource: 'mana', mode: 'full', targetType: 'self' }] }
  }, { warnings: [] });
}
