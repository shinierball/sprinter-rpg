/**
 * Step kind `startingLoot` (Questions C, D, J, P).
 * The Table 25 row gives four slot cards (weapon, armor, item, consumable), each a tier. A slot is taken as its loot or,
 * for weapon, armor and item, as Spells instead (the Consumable never: `spellsAllowed: false`). Arrival[3] rolls or
 * chooses the row (`tiers: null`, all four slots); arrival[4] and arrival[5] reuse arrival[3]'s row from `floorHistory`
 * (`reuseRowFrom: 3`) and keep only the slots whose tier is in `tiers`.
 *
 * Spec (`stepSpec`): `{ row?, slots: { weapon|armor|item|consumable: { take: 'loot'|'spells', option?, choice?, spells? } } }`.
 *  - loot: `option` is the tier option id; `choice` carries its parameters (see `compileLootPick`: `weaponId`, `skill`, `stat`,
 *    `name`, `weapon`, `slot`, `resistance`, `race`, `spell`).
 *  - spells: `{ variant?: 'a'|'b', picks: [{ row?, identifier?, rankValue?, dupValue?, substitute?, keepOverflow? }] }`.
 * Dice per spell pick: the Table 27 row die (unless `row`/`identifier` is given), then the Rank die, or, for a spell the
 * crawler already knows, the 1d2+1 bonus (clamped; a Rank ceiling such as Heal's 1 adds nothing, D10).
 * Tome or learned (Question C (a)) is settled in a finalizer after every step, so it sees the Stat step's Int.
 *
 * Scroll of Upgrade (S7b, e6.9 section 7): a Gold or Platinum weapon pick carries `slotSpec.upgrade = { row?, name?, optionIndex? }`
 * (`row` is a number, or `{ value, rolled: true, dice }` from the app; absent = rolled here on `step.upgradeTable`, default
 * `floor.loot.upgrade`; `name` is the player-edited weapon name, default "<nameAddition> <weapon name>"; `optionIndex` picks among
 * several options of the row, default the first `asTrigger`). The weapon gets `system.asTriggers` + the new `name` (+ the row's
 * `extraTags` in `system.tags`). A second trigger on a weapon (snapshot `hasAsTrigger`, an earlier upgrade this run or in
 * `floorHistory`) is the Rule Break `asTrigger:<weaponId>`; unconfirmed, nothing is written and the log says so.
 *
 * Rule Break keys: `loot:overPicks:<step>`, `loot:offOption:<step>`, `loot:spellsNotAllowed:<step>`, `loot:substitute:<step>`,
 * `loot:offTable:<step>`, `asTrigger:<weaponId>`, plus the shared `range:<step>` and `cap:<itemId>`.
 * History entry: `{ floor, kind: 'loot', step, tableKey, row, rolled, chosen, reused?, tiers, narrative, picks: [...] }`.
 */
import { findCatalogEntry } from '../../../content/catalog-lookup.mjs';
import { buildPayload } from '../../builders/item-payload.mjs';
import { addRank, cleanInt, cleanText, readSpecValue, rollOrTyped } from '../state.mjs';
import { LOOT_SPELL_TABLE, LOOT_UPGRADE_TABLE, rowForTotal } from '../tables.mjs';
import { LOOT_SLOTS, compileLootPick, manaPotionPayload, slotsForTiers, spellVariantsFor } from '../loot-tiers.mjs';
import { asTriggerFromOption } from '../../../utils/amazing-success.mjs';
import { createWorkingItem, ownedByIdentifier } from './experiences.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const loaded = (ctx, key) => Boolean(key && isObj(ctx?.tables?.[key]));

/** The row an earlier arrival rolled or chose, from the actor's own `floorHistory`. */
function reusedRow(step, state) {
  const floor = cleanInt(step.reuseRowFrom);
  if (floor === null) return null;
  const history = Array.isArray(state.snapshot?.floorHistory) ? state.snapshot.floorHistory : [];
  const entry = [...history].reverse().find(h => h?.kind === 'loot' && cleanInt(h.floor) === floor);
  return entry ? { floor, row: cleanInt(entry.row) } : null;
}

const tierSpecOf = (ctx, slot, tier) => ctx?.lootTiers?.[slot]?.[tier] ?? null;

/** UI view of one slot card: its tier's options and Spells-instead variants. */
function slotView(card, ctx) {
  const tierSpec = tierSpecOf(ctx, card.slot, card.tier);
  return {
    ...card,
    options: (tierSpec?.options ?? []).map(o => ({ id: o.id, label: o.label ?? o.name ?? o.id, kind: o.kind })),
    bonuses: tierSpec?.bonuses ?? null,
    spellVariants: card.spellsAllowed ? spellVariantsFor(tierSpec, card.tier) : []
  };
}

/** Roll a Table 27 row for a spell pick, or take the chosen row; returns the spell identifier or ''. */
function spellFromTable(step, state, ctx, rng, pickSpec, tableKey) {
  const table = ctx?.tables?.[tableKey];
  if (!isObj(table)) { state.warn(step.id, `Spell table ${tableKey} is not available; the spell pick was skipped.`); return null; }
  const given = readSpecValue(pickSpec.row);
  const chosen = given?.value ?? null;
  let rowNumber = chosen;
  if (chosen === null) {
    const roll = rollOrTyped(state, step.id, table.formula, null, rng);
    if (!roll) return null;
    rowNumber = roll.total;
  }
  const row = rowForTotal(table, rowNumber);
  const option = row?.options?.find(o => (o.kind === 'spell' || o.kind === 'named') && cleanText(o.identifier));
  if (!option) { state.warn(step.id, `${table.name || tableKey} row ${rowNumber} names no spell; the spell pick was skipped.`); return null; }
  return { identifier: cleanText(option.identifier), row: rowNumber, rolled: chosen === null || given.rolled };
}

/** One spell of a Spells-instead card. Returns the history record of the pick, or null when nothing came of it. */
function takeSpell(step, state, ctx, rng, pickSpec, rankFormula, spellTable) {
  let identifier = cleanText(pickSpec.identifier);
  let tableRow = null;
  if (identifier) {
    const table = ctx?.tables?.[spellTable];
    const listed = isObj(table) ? table.rows.some(r => r.options?.some(o => cleanText(o.identifier) === identifier)) : true;
    if (!listed) state.breakKey(`loot:offTable:${step.id}`, step.id, `${identifier} is not on the loot spell table`);
  } else {
    const found = spellFromTable(step, state, ctx, rng, pickSpec, spellTable);
    if (!found) return null;
    identifier = found.identifier;
    tableRow = found;
  }
  let owned = ownedByIdentifier(state, 'spell', identifier);
  let substituted = null;
  const substitute = cleanText(pickSpec.substitute);
  if (owned && substitute) {
    if (!ctx?.run?.spellDuplicateSubstitute) state.breakKey(`loot:substitute:${step.id}`, step.id, 'A duplicate spell may only be swapped out when building a crawler who starts on Floor 4 or 5');
    substituted = identifier;
    identifier = substitute;
    owned = ownedByIdentifier(state, 'spell', identifier);
  }
  const base = { identifier, ...(tableRow ? { tableRow: tableRow.row } : {}), ...(substituted ? { substitutedFor: substituted } : {}) };
  if (owned) {
    const roll = rollOrTyped(state, step.id, '1d2+1', pickSpec.dupValue, rng);
    if (!roll) return null;
    const rank = addRank(state, owned, roll.total, { stepId: step.id, keepOverflow: Boolean(pickSpec.keepOverflow) });
    const ceilingBound = rank.capped && owned.rankCeiling !== null && rank.after === owned.rankCeiling;
    state.log({
      step: step.id, kind: 'loot', itemId: owned.id, label: `${owned.name} (already known)`, formula: '1d2+1', dice: roll.dice ?? undefined, total: roll.total,
      rolled: roll.rolled, manual: roll.manual || undefined, before: rank.before, after: rank.after, capped: rank.capped || undefined,
      overflow: rank.overflow || undefined, breakKey: rank.breakKey ?? roll.breakKey ?? undefined,
      note: ceilingBound ? `${owned.name} cannot rise above Rank ${owned.rankCeiling}` : (substituted ? 'substituted duplicate' : undefined)
    });
    return { ...base, name: owned.name, duplicate: true, before: rank.before, after: rank.after, total: roll.total };
  }
  const entry = findCatalogEntry('spells', identifier);
  if (!entry) { state.warn(step.id, `${identifier} is not in the spell catalog; the spell pick was skipped.`); return null; }
  const roll = rollOrTyped(state, step.id, rankFormula, pickSpec.rankValue, rng);
  if (!roll) return null;
  const item = createWorkingItem(step, state, { docKind: 'spell', identifier, name: entry.name });
  const rank = addRank(state, item, roll.total, { stepId: step.id, keepOverflow: Boolean(pickSpec.keepOverflow) });
  state.log({
    step: step.id, kind: 'loot', itemId: item.id, label: item.name, formula: rankFormula, dice: roll.dice ?? undefined, total: roll.total,
    rolled: roll.rolled, manual: roll.manual || undefined, before: rank.before, after: rank.after, capped: rank.capped || undefined,
    overflow: rank.overflow || undefined, breakKey: rank.breakKey ?? roll.breakKey ?? undefined, note: 'new spell'
  });
  const record = { ...base, name: item.name, rank: rank.after, total: roll.total, isNew: true };
  // Tome or learned (C (a)) is settled after the Stat step, when the working max Mana is known.
  state.finalizers.push(() => {
    const cost = cleanInt(item.payload?.system?.manaCost) ?? 0;
    const manaMax = state.abilities.int.value;
    if (cost <= manaMax) {
      state.log({ step: step.id, kind: 'loot', itemId: item.id, label: `${item.name}: learned`, rolled: false, note: `${cost} Mana within ${manaMax}` });
      return;
    }
    const at = state.itemCreates.indexOf(item.payload);
    if (at >= 0) state.itemCreates.splice(at, 1);
    state.items.delete(item.id);
    const warnings = [];
    const tome = buildPayload('loot', {
      name: `Tome of ${item.name}`,
      system: {
        quantity: 1, lootType: 'consumable', executionMode: 'all',
        outcomes: [{ name: `Learn ${item.name}`, type: 'learn_spell', spellIdentifier: item.identifier, rank: Math.max(1, item.rank), weight: 1 }],
        notes: `Read to learn ${item.name} at Rank ${Math.max(1, item.rank)}. Can be traded or sold.`
      }
    }, { warnings });
    for (const w of warnings) state.warn(step.id, `Tome of ${item.name}: ${w.message}`);
    state.itemCreates.push(tome);
    record.tome = true;
    state.log({ step: step.id, kind: 'loot', label: `${item.name}: tome`, rolled: false, note: `${cost} Mana is above ${manaMax}; received as a tome` });
  });
  return record;
}

/** The Spells-instead card: the variant's spells plus its Mana Potions. */
function takeSpells(step, state, ctx, rng, card, slotSpec) {
  const tierSpec = tierSpecOf(ctx, card.slot, card.tier);
  const variants = spellVariantsFor(tierSpec, card.tier);
  const spellSpec = isObj(slotSpec.spells) ? slotSpec.spells : {};
  const variant = variants.find(v => v.id === cleanText(spellSpec.variant)) ?? variants[0];
  if (!variant) { state.warn(step.id, `${card.tier} ${card.slot} has no Spells defined; nothing was taken.`); return { take: 'spells', spells: [] }; }
  const picks = (Array.isArray(spellSpec.picks) ? spellSpec.picks : []).map(p => (isObj(p) ? p : {}));
  if (picks.length > variant.picks.length) state.breakKey(`loot:overPicks:${step.id}`, step.id, `${picks.length} Spells given for ${card.tier} ${card.slot} but it gives ${variant.picks.length}`);
  const spellTable = cleanText(step.spellTable) || LOOT_SPELL_TABLE;
  const spells = [];
  variant.picks.forEach((formula, i) => {
    const record = takeSpell(step, state, ctx, rng, picks[i] ?? {}, formula, spellTable);
    if (record) spells.push(record);
  });
  let potions = 0;
  if (variant.potions > 0) {
    const warnings = [];
    state.itemCreates.push(manaPotionPayload(variant.potions, warnings));
    for (const w of warnings) state.warn(step.id, w);
    potions = variant.potions;
    state.log({ step: step.id, kind: 'loot', label: `${card.slot}: Mana Potions x${potions}`, rolled: false });
  }
  return { take: 'spells', variant: variant.id, spells, potions };
}

/** Apply a compiled loot option to the working state. */
function applyLoot(step, state, card, compiled) {
  for (const payload of compiled.creates) state.itemCreates.push(payload);
  const merge = (id, changes) => state.itemUpdates.set(id, { ...(state.itemUpdates.get(id) ?? { _id: id }), ...changes });
  for (const { _id, ...changes } of compiled.updates) merge(_id, changes);
  for (const id of compiled.unequip) merge(id, { 'system.equipped': false });
  const weapons = state.weapons;
  for (const id of compiled.unequip) { const w = weapons.find(x => x.id === id); if (w) w.equipped = false; }
  if (compiled.newWeapon) weapons.push({ id: `new:weapon:${state.itemCreates.length}`, equipped: true, attackId: null, hasAsTrigger: false, asTriggers: [], ...compiled.newWeapon });
  if (compiled.upgrade) {
    const w = weapons.find(x => x.id === compiled.upgrade.weaponId);
    if (w) {
      w.grants = [...(w.grants ?? []), ...compiled.upgrade.grants];
      w.damageModifiers = [...(w.damageModifiers ?? []), ...compiled.upgrade.damageModifiers];
      for (const [key, row] of Object.entries(compiled.upgrade.abilityModifiers)) {
        w.abilityModifiers = { ...(w.abilityModifiers ?? {}), [key]: { value: (cleanInt(w.abilityModifiers?.[key]?.value) ?? 0) + row.value, type: 'flat' } };
      }
    }
  }
  let breakKey;
  for (const b of compiled.breaks) {
    breakKey = `loot:${b.key}:${step.id}`;
    state.breakKey(breakKey, step.id, b.reason);
  }
  for (const message of compiled.warnings) state.warn(step.id, message);
  state.log({
    step: step.id, kind: 'loot', label: `${card.slot}: ${compiled.summary || 'nothing'}`, slot: card.slot, tier: card.tier, rolled: false,
    breakKey, note: compiled.notes.join('; ') || undefined
  });
}

/** Weapon ids an earlier loot entry in this crawler's history upgraded with a Scroll. */
function historyUpgradedIds(state) {
  const history = Array.isArray(state.snapshot?.floorHistory) ? state.snapshot.floorHistory : [];
  const ids = new Set();
  for (const entry of history) {
    if (entry?.kind !== 'loot' || !Array.isArray(entry.picks)) continue;
    for (const pick of entry.picks) if (pick?.upgrade?.weaponId && pick.upgrade.written !== false) ids.add(String(pick.upgrade.weaponId));
  }
  return ids;
}

/**
 * Resolve the Scroll of Upgrade of a Gold/Platinum weapon pick (S7b). Returns the history record `{ tableKey, row, rolled, chosen,
 * option, name, weaponId, written }`, or null when nothing could be resolved (a warning says why and the pick stays pending).
 */
function resolveScroll(step, state, ctx, rng, slotSpec, compiled) {
  const upgradeSpec = isObj(slotSpec.upgrade) ? slotSpec.upgrade : {};
  const tableKey = cleanText(step.upgradeTable) || LOOT_UPGRADE_TABLE;
  const table = ctx?.tables?.[tableKey];
  if (!isObj(table)) { state.warn(step.id, `Scroll of Upgrade table ${tableKey} is not available; the Scroll is still pending.`); return null; }
  const weapon = compiled.upgrade ? state.weapons.find(w => w.id === compiled.upgrade.weaponId) : state.weapons[state.weapons.length - 1];
  if (!weapon) { state.warn(step.id, 'There is no weapon for the Scroll of Upgrade.'); return null; }
  const given = readSpecValue(upgradeSpec.row);
  let number = given?.value ?? null;
  let rolled = true;
  let dice = null;
  if (number === null) {
    const roll = rollOrTyped(state, step.id, table.formula, null, rng);
    if (!roll) return null;
    number = roll.total;
    dice = roll.dice ?? null;
  } else if (given.rolled) dice = given.dice ?? null;
  else rolled = false;
  const row = rowForTotal(table, number);
  const triggers = (row?.options ?? []).filter(o => o?.kind === 'asTrigger');
  const index = cleanInt(upgradeSpec.optionIndex);
  const option = (index !== null ? triggers[index] : null) ?? triggers[0];
  if (!option) { state.warn(step.id, `${table.name || tableKey} row ${number} has no Amazing Success trigger; the Scroll is still pending.`); return null; }
  const record = { tableKey, row: number, rolled, chosen: !rolled, option: option.label || option.nameAddition || '', weaponId: weapon.id };
  const upgraded = (state.upgradedWeaponIds ??= new Set());
  const again = weapon.hasAsTrigger === true || upgraded.has(weapon.id) || historyUpgradedIds(state).has(weapon.id);
  let breakKey;
  let go = true;
  if (again) {
    breakKey = `asTrigger:${weapon.id}`;
    go = state.breakKey(breakKey, step.id, `${weapon.name} already has an Amazing Success trigger; the book allows one per weapon`);
  }
  // A weapon that already carries this prefix (a second upgrade with the same option) is not prefixed twice.
  const prefix = cleanText(option.nameAddition) || 'Enchanted';
  const name = cleanText(upgradeSpec.name) || (weapon.name.startsWith(`${prefix} `) ? weapon.name : `${prefix} ${weapon.name}`);
  state.log({
    step: step.id, kind: 'loot', label: `Scroll of Upgrade: ${weapon.name}`, table: tableKey, row: number, rolled, formula: table.formula, total: number, dice: dice ?? undefined,
    breakKey, narrative: row.narrative || undefined,
    note: go ? `${record.option} added; renamed ${name}` : 'Second Amazing Success trigger not confirmed; no trigger was added'
  });
  if (!go) return { ...record, name: weapon.name, written: false };
  const trigger = asTriggerFromOption(option, { ruleBreak: again });
  if (!trigger) { state.warn(step.id, `${table.name || tableKey} row ${number} has an unusable trigger; the Scroll is still pending.`); return null; }
  const extraTags = (Array.isArray(option.extraTags) ? option.extraTags : []).map(cleanText).filter(Boolean);
  const asTriggers = [...(weapon.asTriggers ?? []), trigger];
  const tags = extraTags.length ? [...new Set([...(weapon.tags ?? []), ...extraTags])] : null;
  const gear = compiled.upgrade ? null : compiled.creates[0];
  if (gear) {
    gear.name = name;
    gear.system = { ...(gear.system ?? {}), asTriggers, ...(tags ? { tags } : {}) };
  } else {
    state.itemUpdates.set(weapon.id, { ...(state.itemUpdates.get(weapon.id) ?? { _id: weapon.id }), 'system.asTriggers': asTriggers, ...(tags ? { 'system.tags': tags } : {}), name });
  }
  Object.assign(weapon, { asTriggers, hasAsTrigger: true, name, ...(tags ? { tags } : {}) });
  upgraded.add(weapon.id);
  return { ...record, name, written: true };
}

function resolveRow(step, state, ctx, rng, stepSpec, table) {
  const reuse = reusedRow(step, state);
  if (step.reuseRowFrom !== undefined && step.reuseRowFrom !== null && !reuse) {
    state.warn(step.id, `There is no Floor ${step.reuseRowFrom} loot entry in this crawler's history; a loot row was rolled or chosen instead.`);
  }
  if (reuse && reuse.row !== null) {
    const row = rowForTotal(table, reuse.row);
    if (row) return { row, number: reuse.row, rolled: false, reused: reuse.floor };
    state.warn(step.id, `${table.name || step.table} has no row ${reuse.row}; a loot row was rolled or chosen instead.`);
  }
  const given = readSpecValue(stepSpec.row);
  const chosen = given?.value ?? null;
  if (chosen !== null) {
    const row = rowForTotal(table, chosen);
    if (!row) { state.warn(step.id, `${table.name || step.table} has no row ${chosen}; the loot step was skipped.`); return null; }
    // A row the app rolled arrives as `{ value, rolled: true, dice }`.
    if (given.rolled) return { row, number: chosen, rolled: true, roll: { total: chosen, dice: given.dice } };
    return { row, number: chosen, rolled: false };
  }
  const roll = rollOrTyped(state, step.id, table.formula, null, rng);
  if (!roll) return null;
  const row = rowForTotal(table, roll.total);
  if (!row) { state.warn(step.id, `${table.name || step.table} has no row ${roll.total}; the loot step was skipped.`); return null; }
  return { row, number: roll.total, rolled: true, roll };
}

export const startingLootStep = {
  kind: 'startingLoot',
  plan(step, state, ctx) {
    const key = cleanText(step.table);
    const table = loaded(ctx, key) ? ctx.tables[key] : null;
    if (!table) state.warn(step.id, `Loot table ${key || '(none)'} is not available.`);
    const reuse = reusedRow(step, state);
    const reused = reuse && table ? rowForTotal(table, reuse.row) : null;
    if (step.reuseRowFrom !== undefined && step.reuseRowFrom !== null && !reused) {
      state.warn(step.id, `There is no Floor ${step.reuseRowFrom} loot entry in this crawler's history; a loot row can be rolled or chosen.`);
    }
    const tiers = Array.isArray(step.tiers) ? step.tiers : null;
    return {
      table: key, tableName: table?.name ?? '', formula: table?.formula ?? '', tiers, reuse: reused ? { floor: reuse.floor, row: reuse.row } : null,
      rollable: !reused,
      rows: table ? table.rows.map(r => ({ row: r.range[0], narrative: r.narrative, slots: slotsForTiers(r, tiers).map(c => slotView(c, ctx)) })) : [],
      slots: reused ? slotsForTiers(reused, tiers).map(c => slotView(c, ctx)) : [],
      spellDuplicateSubstitute: Boolean(ctx?.run?.spellDuplicateSubstitute)
    };
  },
  resolve(step, stepSpec, state, ctx, rng) {
    const spec = isObj(stepSpec) ? stepSpec : {};
    const key = cleanText(step.table);
    if (!loaded(ctx, key)) { state.warn(step.id, `Loot table ${key || '(none)'} is not available; the loot step was skipped.`); return; }
    const table = ctx.tables[key];
    const picked = resolveRow(step, state, ctx, rng, spec, table);
    if (!picked) return;
    const { row, number } = picked;
    state.log({
      step: step.id, kind: 'loot', label: table.name || key, table: key, tableName: table.name || undefined, row: number,
      narrative: row.narrative || undefined, rolled: picked.rolled,
      ...(picked.rolled ? { formula: table.formula, dice: picked.roll.dice ?? undefined, total: picked.roll.total } : {}),
      ...(picked.reused ? { note: `row reused from Floor ${picked.reused}` } : {})
    });

    const tiers = Array.isArray(step.tiers) ? step.tiers : null;
    const cards = slotsForTiers(row, tiers);
    const slotSpecs = isObj(spec.slots) ? spec.slots : {};
    for (const given of Object.keys(slotSpecs)) {
      if (!cards.some(c => c.slot === given)) state.warn(step.id, `The ${given} slot is not offered by this arrival; its pick was skipped.`);
    }
    // Work on a copy so the caller's snapshot is never touched; later steps (AI Favor) read the new main weapon.
    state.weapons = state.weapons.map(w => structuredClone(w));
    const picks = [];
    for (const slot of LOOT_SLOTS) {
      const card = cards.find(c => c.slot === slot);
      if (!card) continue;
      const slotSpec = isObj(slotSpecs[slot]) ? slotSpecs[slot] : null;
      if (!slotSpec) { state.warn(step.id, `The ${card.tier} ${slot} loot has nothing picked yet.`); continue; }
      const take = cleanText(slotSpec.take) === 'spells' ? 'spells' : 'loot';
      if (take === 'spells') {
        if (!card.spellsAllowed) state.breakKey(`loot:spellsNotAllowed:${step.id}`, step.id, `${slot} loot cannot be taken as Spells`);
        const record = takeSpells(step, state, ctx, rng, card, slotSpec);
        picks.push({ slot, tier: card.tier, ...record });
      } else {
        const optionId = cleanText(slotSpec.option ?? slotSpec.choice?.option);
        const choice = { ...(isObj(slotSpec.choice) ? slotSpec.choice : {}), option: optionId };
        // A random Table 27 scroll takes its spell from the spell table like any loot spell.
        const option = tierSpecOf(ctx, slot, card.tier)?.options?.find(o => o.id === optionId);
        if (option?.kind === 'scrollSpell' && !cleanText(choice.spell)) {
          const found = spellFromTable(step, state, ctx, rng, { row: slotSpec.spellRow }, cleanText(step.spellTable) || LOOT_SPELL_TABLE);
          if (found) choice.spell = found.identifier;
        }
        const compiled = compileLootPick(slot, card.tier, choice, state, ctx);
        applyLoot(step, state, card, compiled);
        const upgrade = compiled.scrollPending ? resolveScroll(step, state, ctx, rng, slotSpec, compiled) : null;
        picks.push({
          slot, tier: card.tier, take: 'loot', option: cleanText(slotSpec.option ?? slotSpec.choice?.option) || undefined, summary: compiled.summary,
          ...(upgrade ? { upgrade } : (compiled.scrollPending ? { scrollPending: true } : {}))
        });
      }
    }
    state.history.push({
      floor: state.arrival?.floor ?? null, kind: 'loot', step: step.id, tableKey: key, row: number, rolled: picked.rolled, chosen: !picked.rolled && !picked.reused,
      ...(picked.reused ? { reused: picked.reused } : {}), tiers, narrative: row.narrative || '', picks
    });
  }
};
