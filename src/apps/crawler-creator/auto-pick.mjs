/**
 * The automatic picks of an arrival draft (the picks behind "Roll everything remaining" and "Randomize All") and the
 * list of picks a draft still has open. Both read the draft's plan and spec; neither rolls a die (`ArrivalDraft.autoFill`
 * alternates them with the dice, because a pick opens dice and a die opens picks).
 */
import { offeredEntries } from '../../utils/content-source.mjs';
import { LOOT_BRACELET_RACE_TABLE } from '../../data/floor-simulator/tables.mjs';
import { rngIndex } from '../../utils/rng.mjs';
import { loadoutOptions, getStarterWeaponDefinition } from '../../content/creation-loadouts.mjs';
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { damageTypesOfRarity } from '../../utils/damage/damage-types.mjs';
import { isFormRace } from '../../utils/character/transform-rules.mjs';
import { identifierOptions } from '../../utils/ui/identifier-options.mjs';
import { plainValue } from './draft-values.mjs';

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'cha'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasValue = (v) => v !== undefined && v !== null && v !== '';
const pickFrom = (rng, list) => (list.length ? list[rngIndex(rng, list.length)] : undefined);

/** The table row an experience slot sits on (the row whose range holds the slot's row number), or null. */
function tableRowOf(draft, step, spec, slot) {
  const view = step.tableData?.[draft.slotTableKey(step, spec, slot)];
  if (!view || !hasValue(slot.row)) return null;
  const n = Number(plainValue(slot.row));
  return view.rows.find(r => n >= r.range[0] && n <= r.range[1]) ?? null;
}

/**
 * Picks the draft still has open, as `{ step, kind, path, blocking }`. `blocking` ones stop Next and Finish (an unfinished
 * form is not a rule being exceeded): a loot card taken as loot with no option chosen. The rest are answered by the random
 * fill and counted on the stage's open total.
 */
export function openChoices(draft) {
  const out = [];
  if (!draft?.arrival || !draft.draft) return out;
  for (const step of draft.plan?.steps ?? []) {
    const spec = draft.draft.steps[step.id];
    if (!spec || step.skipped) continue;
    const open = (kind, path, blocking = false) => out.push({ step: step.id, kind, path, blocking });
    if (step.kind === 'experiences') {
      (spec.picks ?? []).forEach((slot, i) => {
        const row = tableRowOf(draft, step, spec, slot);
        if (!row) return;
        (slot.skills ?? []).forEach((skill, j) => {
          const path = `${step.id}.picks.${i}.skills.${j}`;
          if (!hasValue(skill.option)) return open('skill', path);
          const option = row.options?.[Number(skill.option)];
          if (option?.kind === 'choice' && !hasValue(skill.identifier)) open('choice', path);
          else if (option?.kind === 'custom' && !hasValue(skill.identifier) && !hasValue(skill.name)) open('custom', path);
        });
      });
    } else if (step.kind === 'skillBoost' && step.target === 'chosen') {
      const wanted = Math.min(Number(step.count) || 0, (step.candidates ?? []).length);
      if ((spec.picks ?? []).length < wanted) open('chosenSkills', step.id);
    } else if (step.kind === 'stats' && Number(step.pool) > 0) {
      const spent = STAT_KEYS.reduce((sum, k) => sum + (Number(spec.allocation?.[k]) || 0), 0) + draft.heldTotal(step.id);
      if (spent < Number(step.pool)) open('stats', step.id);
    } else if (step.kind === 'startingLoot') {
      for (const card of draft.lootCards(step, spec)) {
        const slotSpec = spec.slots?.[card.slot];
        const path = `${step.id}.slots.${card.slot}`;
        if (!hasValue(slotSpec?.take)) open('loot', path);
        else if (slotSpec.take === 'loot' && (card.options ?? []).length > 1 && !hasValue(slotSpec.option ?? slotSpec.choice?.option)) open('lootOption', path, true);
      }
    }
  }
  return out;
}

/** One round of automatic picks over the whole draft; true when something changed (the dice they open are rolled next). */
export function autoPick(draft, rng) {
  let changed = false;
  for (const step of draft.plan?.steps ?? []) {
    const spec = draft.draft.steps[step.id];
    if (!spec || step.skipped) continue;
    if (step.kind === 'skillBoost' && step.target === 'chosen') changed = autoChosenSkills(step, spec, rng) || changed;
    else if (step.kind === 'experiences') changed = autoExperiences(draft, step, spec, rng) || changed;
    else if (step.kind === 'startingLoot') changed = autoLoot(draft, step, spec, rng) || changed;
    else if (step.kind === 'stats') changed = autoStats(draft, step, spec, rng) || changed;
  }
  if (changed) {
    draft._replan();
    draft._touch();
  }
  return changed;
}

/** The chosen-Skills count filled with distinct candidates, keeping the ones already picked. */
function autoChosenSkills(step, spec, rng) {
  const picks = spec.picks ?? [];
  const taken = new Set(picks.map(p => p?.itemId));
  const pool = (step.candidates ?? []).filter(c => !taken.has(c.id));
  const missing = Math.min(Number(step.count) || 0, (step.candidates ?? []).length) - picks.length;
  if (missing <= 0) return false;
  for (let i = 0; i < missing && pool.length; i++) picks.push({ itemId: pool.splice(rngIndex(rng, pool.length), 1)[0].id });
  spec.picks = picks;
  return true;
}

/** The Stat points not yet spent (the pool less the player's own and the ones held for a requirement), spread over the five stats. */
function autoStats(draft, step, spec, rng) {
  const pool = Number(step.pool) || 0;
  const allocation = { ...(spec.allocation ?? {}) };
  const left = pool - STAT_KEYS.reduce((sum, k) => sum + (Number(allocation[k]) || 0), 0) - draft.heldTotal(step.id);
  if (left <= 0) return false;
  for (let i = 0; i < left; i++) {
    const key = STAT_KEYS[rngIndex(rng, STAT_KEYS.length)];
    allocation[key] = (allocation[key] ?? 0) + 1;
  }
  spec.allocation = allocation;
  return true;
}

/** A random catalog Skill or Spell identifier, through the same picker the write-in select uses. */
const randomCatalogIdentifier = (rng, docKind) => pickFrom(rng, identifierOptions(docKind, '').filter(o => o.value))?.value ?? '';

/** A row that offers Spells and no Skills writes in a Spell; any other row's write-in is a Skill. */
const writeInKind = (row) => {
  const kinds = (row.options ?? []).map(o => o.docKind ?? (o.kind === 'spell' ? 'spell' : null)).filter(Boolean);
  return kinds.length && kinds.every(k => k === 'spell') ? 'spell' : 'skill';
};

/**
 * Answer the Skill options of every experience slot whose row is known: a random option for each (a catalog Skill or
 * Spell, a choice, a write-in answered with a catalog Skill or Spell, and only when nothing else is left an option that
 * needs an import), and the catalog identifier a choice or write-in option still lacks.
 */
function autoExperiences(draft, step, spec, rng) {
  let changed = false;
  (spec.picks ?? []).forEach((slot, i) => {
    if (spec.mode === 'custom' && !slot.tableKey) {
      const tables = (step.tables ?? []).filter(t => t.available);
      const key = step.slots?.[i]?.tableKey || pickFrom(rng, tables)?.key;
      if (key) { slot.tableKey = key; changed = true; }
    }
    const row = tableRowOf(draft, step, spec, slot);
    if (!row) return;
    const options = row.options ?? [];
    const ready = (o) => !o.needsImport && (o.kind === 'named' || o.kind === 'spell' || o.kind === 'custom' || (o.kind === 'choice' && o.choices?.length));
    const usable = options.filter(ready);
    const pool = usable.length ? usable : options.filter(o => o.needsImport && (o.kind === 'named' || o.kind === 'spell'));
    const taken = new Set((slot.skills ?? []).filter(s => hasValue(s.option)).map(s => Number(s.option)));
    for (const skill of slot.skills ?? []) {
      if (!hasValue(skill.option)) {
        const free = pool.filter(o => !taken.has(o.index));
        const option = pickFrom(rng, free.length ? free : pool);
        if (!option) continue;
        skill.option = option.index;
        taken.add(option.index);
        changed = true;
      }
      const option = options[Number(skill.option)];
      if (option?.kind === 'choice' && !hasValue(skill.identifier) && option.choices?.length) {
        skill.identifier = pickFrom(rng, option.choices).value;
        changed = true;
      } else if (option?.kind === 'custom' && !hasValue(skill.identifier) && !hasValue(skill.name)) {
        const docKind = skill.docKind === 'spell' || skill.docKind === 'skill' ? skill.docKind : writeInKind(row);
        const identifier = randomCatalogIdentifier(rng, docKind);
        if (identifier) {
          skill.docKind = docKind;
          skill.identifier = identifier;
          changed = true;
        }
      }
    }
  });
  return changed;
}

/** Every loot card of the row in play: a take, an option under it and the inputs that option needs; answers given stay. */
function autoLoot(draft, step, spec, rng) {
  let changed = false;
  spec.slots = spec.slots ?? {};
  for (const card of draft.lootCards(step, spec)) {
    const options = card.options ?? [];
    const given = spec.slots[card.slot];
    if (hasValue(given?.take) && given.take !== 'loot') continue;
    if (!options.length) continue;
    const optionId = given?.option ?? given?.choice?.option;
    const option = options.find(o => o.id === optionId) ?? pickFrom(rng, options);
    const choice = { ...autoLootChoice(draft, card, option, rng), ...(isObj(given?.choice) ? given.choice : {}) };
    const same = given?.take === 'loot' && given.option === option.id && Object.keys(choice).every(k => given.choice?.[k] === choice[k]);
    if (same) continue;
    spec.slots[card.slot] = { ...(given ?? {}), take: 'loot', option: option.id, ...(Object.keys(choice).length ? { choice } : {}) };
    changed = true;
  }
  return changed;
}

/** The inputs a loot option needs (the keys `compileLootPick` reads from `choice`), answered at random. */
function autoLootChoice(draft, card, option, rng) {
  const pick = (list) => pickFrom(rng, list);
  const bonuses = draft.context?.lootTiers?.[card.slot]?.[card.tier]?.bonuses ?? {};
  const weapons = draft.snapshot?.weapons ?? [];
  const ownWeapon = weapons.find(w => w.equipped) ?? weapons[0];
  // The weapon Skill bonus goes to the weapon's own Skill, else the crawler's primary attack skill
  const weaponSkill = (own) => own?.skillIdentifier || (draft.snapshot?.skills ?? []).find(s => s.starterRole === 'primarySkill')?.identifier || '';
  const choice = {};
  if (bonuses.stat && Array.isArray(bonuses.statChoices) && bonuses.statChoices.length) choice.stat = pick(bonuses.statChoices);
  if (option?.kind === 'weaponUpgrade' && ownWeapon) {
    choice.weaponId = ownWeapon.id;
    if (weaponSkill(ownWeapon)) choice.skill = weaponSkill(ownWeapon);
  } else if (option?.kind === 'weaponNew') {
    const weapon = pick(loadoutOptions('weapon'));
    if (weapon) choice.weapon = weapon.id;
    const skill = getStarterWeaponDefinition(weapon?.id).skillIdentifier || weaponSkill(ownWeapon);
    if (skill) choice.skill = skill;
  } else if (option?.kind === 'armor') {
    if (bonuses.resistanceRarity) {
      const type = pick(damageTypesOfRarity(bonuses.resistanceRarity));
      if (type) choice.resistance = type;
    }
    if (Array.isArray(bonuses.grantSkillChoices) && bonuses.grantSkillChoices.length) choice.skill = pick(bonuses.grantSkillChoices);
  } else if (option?.kind === 'bracelet') {
    // With a race table the die answers it (rolled with the other open dice); without one a random race is chosen
    const race = draft.context?.tables?.[LOOT_BRACELET_RACE_TABLE] ? null : pick(offeredEntries('races').filter(r => !COGRaceClassApplier.isPetRace(r) && !isFormRace(r)));
    if (race) choice.race = String(COGRaceClassApplier.definitionRef(race)).toLowerCase();
  } else if (option?.kind === 'skillPotion') {
    const skill = pick((draft.context?.catalog?.skills ?? []).filter(s => s.identifier));
    if (skill) choice.skill = skill.identifier;
  }
  return choice;
}
