/**
 * Step panel contexts for the floor-start stages. Pure: it reads an `ArrivalDraft` and returns plain data,
 * with every option list, `selected` flag, label source and die control precomputed (CONTRIBUTING §5). Static words live in
 * the templates (`COG.FloorSim.*` lang keys); this file supplies ids, numbers and names.
 */
import { loadoutOptions } from '../../content/creation-loadouts.mjs';
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { formulaForRank } from '../../data/floor-simulator/steps/skill-boost.mjs';
import { LOOT_BRACELET_RACE_TABLE, LOOT_UPGRADE_TABLE, rowForTotal } from '../../data/floor-simulator/tables.mjs';
import { damageTypesOfRarity } from '../../utils/damage/damage-types.mjs';
import { LOOT_SPELL_TABLE, plainValue } from '../crawler-creator/arrival-draft.mjs';

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'cha'];
const ARMOR_SLOTS = ['head', 'torso', 'arms', 'legs', 'feet'];
const hasValue = (v) => v !== undefined && v !== null && v !== '';
const opt = (value, label, selected, extra = {}) => ({ value, label, selected: Boolean(selected), ...extra });

/** The template's die control: a number field plus a Roll button, bound by path. */
function die(session, path, formula) {
  const value = session.get(path);
  return { path, formula, value: hasValue(value) ? value : '', rolled: session.isRolled(path), open: !hasValue(value) };
}

const entryFor = (result, stepId, itemId) => result?.log.find(e => e.step === stepId && e.itemId === itemId) ?? null;

/** The Rank ceiling shown as "Rank N maximum": the owned item's, else the catalog entry's. */
function ceilingFor(session, docKind, identifier) {
  if (!identifier) return null;
  const snap = session.snapshot;
  const owned = [...(snap.skills ?? []), ...(snap.spells ?? [])].find(i => i.identifier === identifier);
  if (owned) return owned.rankCeiling ?? null;
  const list = docKind === 'spell' ? session.context.catalog?.spells : session.context.catalog?.skills;
  return list?.find(i => i.identifier === identifier)?.rankCeiling ?? null;
}

function catalogSkillOptions(session, selected = '') {
  return (session.context.catalog?.skills ?? [])
    .filter(s => s.identifier)
    .map(s => opt(s.identifier, s.name, s.identifier === selected))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function catalogSpellOptions(session, selected = '') {
  return (session.context.catalog?.spells ?? [])
    .filter(s => s.identifier)
    .map(s => opt(s.identifier, s.name, s.identifier === selected))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function raceOptionValues(selected = '') {
  const rc = COGRaceClassApplier.getRaceClassContext({ type: 'crawler', system: { details: { race: '', class: '' } }, items: [] });
  return (rc.raceOptions ?? []).flatMap(g => g.options ?? []).map(o => opt(String(o.value).toLowerCase(), o.label, String(o.value).toLowerCase() === selected));
}

function selectParam(key, label, options, value, extra = {}) {
  return { key, label, kind: 'select', value, options: [opt('', '', !value), ...options.map(o => ({ ...o, selected: o.value === value }))], ...extra };
}

const textParam = (key, label, value) => ({ key, label, kind: 'text', value: value ?? '' });

/** The inputs a chosen loot option needs (the keys `compileLootPick` reads from `choice`). */
function lootParams(session, option, tierSpec, slotSpec) {
  if (!option) return [];
  const choice = slotSpec.choice ?? {};
  const bonuses = tierSpec?.bonuses ?? {};
  const params = [];
  const statParam = () => {
    if (!bonuses.stat || !Array.isArray(bonuses.statChoices)) return;
    params.push(selectParam('stat', 'stat', bonuses.statChoices.map(k => opt(k, k.toUpperCase(), false)), choice.stat ?? bonuses.statChoices[0]));
  };
  if (option.kind === 'weaponUpgrade') {
    const weapons = session.snapshot.weapons ?? [];
    params.push(selectParam('weaponId', 'weapon', weapons.map(w => opt(w.id, w.name, false)), choice.weaponId ?? (weapons.find(w => w.equipped) ?? weapons[0])?.id ?? ''));
    const current = weapons.find(w => w.id === (choice.weaponId ?? (weapons.find(w2 => w2.equipped) ?? weapons[0])?.id));
    params.push(selectParam('skill', 'skill', catalogSkillOptions(session), choice.skill ?? current?.skillIdentifier ?? ''));
    statParam();
  } else if (option.kind === 'weaponNew') {
    params.push(selectParam('weapon', 'weaponType', loadoutOptions('weapon').map(w => opt(w.id, w.name, false)), choice.weapon ?? ''));
    params.push(textParam('name', 'name', choice.name));
    params.push(selectParam('skill', 'skill', catalogSkillOptions(session), choice.skill ?? ''));
    statParam();
  } else if (option.kind === 'armor') {
    params.push(selectParam('slot', 'slot', ARMOR_SLOTS.map(s => opt(s, s, false)), choice.slot ?? 'torso'));
    params.push(textParam('name', 'name', choice.name));
    if (bonuses.resistanceRarity) params.push(selectParam('resistance', 'resistance', damageTypesOfRarity(bonuses.resistanceRarity).map(t => opt(t, t, false)), choice.resistance ?? ''));
    if (Array.isArray(bonuses.grantSkillChoices)) params.push(selectParam('skill', 'skill', bonuses.grantSkillChoices.map(k => opt(k, k, false)), choice.skill ?? ''));
  } else if (option.kind === 'bracelet') {
    params.push(selectParam('race', 'race', raceOptionValues(), choice.race ?? ''));
    params.push(textParam('name', 'name', choice.name));
  } else if (option.kind === 'skillPotion') {
    params.push(selectParam('skill', 'skill', catalogSkillOptions(session), choice.skill ?? ''));
  } else if (option.kind === 'scrollSpell') {
    params.push(selectParam('spell', 'spell', catalogSpellOptions(session), choice.spell ?? ''));
  }
  return params;
}

// ---------------------------------------------------------------- panels

function levelPanel(step) {
  return { isLevel: true, from: step.from, to: step.to, levelsGained: step.levelsGained, pointsGained: step.pointsGained };
}

function primaryPanel(session, step, spec, result) {
  const itemId = spec.itemId ?? '';
  const entry = entryFor(result, step.id, itemId);
  return {
    isPrimaryBoost: true, formula: step.formula,
    items: step.candidates.map(c => opt(c.id, c.name, c.id === itemId, { rank: c.rank, kind: c.kind })),
    hasItem: Boolean(itemId), die: die(session, `${step.id}.value`, step.formula), entry
  };
}

function boostRows(session, step, spec, result, working, exclude = '') {
  const picks = spec.picks ?? [];
  return step.candidates.filter(c => c.id !== exclude).map(c => {
    const at = picks.findIndex(p => p.itemId === c.id);
    const entry = entryFor(result, step.id, c.id);
    const rank = working ? working(c, entry) : c.rank;
    return {
      id: c.id, name: c.name, kind: c.kind, rank, rankCeiling: c.rankCeiling, checked: at >= 0, entry,
      formula: step.target === 'chosen' ? formulaForRank(step.formulaByRank, rank) : step.formula,
      die: at >= 0 ? die(session, `${step.id}.picks.${at}.value`, step.target === 'chosen' ? formulaForRank(step.formulaByRank, rank) : step.formula) : null
    };
  });
}

function othersPanel(session, step, spec, result) {
  const primaryId = session.get(session.plan.steps.find(s => s.kind === 'skillBoost' && s.target === 'primary')?.id + '.itemId') ?? '';
  const rows = boostRows(session, step, spec, result, null, primaryId);
  const count = rows.filter(r => r.checked).length;
  return { isOtherBoosts: true, stepId: step.id, rows, counter: { count, max: step.count, over: count > step.count } };
}

function chosenPanel(session, step, spec, result) {
  const previewRanks = new Map((result?.preview?.skills ?? []).map(s => [s.id, s]));
  // The working Rank is the Rank after the arrival's earlier steps: the pick's own "before", else the previewed Rank.
  const rows = boostRows(session, step, spec, result, (c, entry) => entry?.before ?? previewRanks.get(c.id)?.after ?? c.rank);
  const count = rows.filter(r => r.checked).length;
  return { isChosenSkills: true, stepId: step.id, rows, counter: { count, max: step.count, over: count > step.count } };
}

function experienceSlots(session, step, spec) {
  const ctx = session.context;
  return (spec.picks ?? []).map((slot, i) => {
    const tableKey = session.slotTableKey(step, spec, slot);
    const view = tableKey ? step.tableData?.[tableKey] : null;
    const base = `${step.id}.picks.${i}`;
    const rowNumber = hasValue(slot.row) ? Number(plainValue(slot.row)) : null;
    const tableRow = view && rowNumber !== null ? view.rows.find(r => rowNumber >= r.range[0] && rowNumber <= r.range[1]) : null;
    const slotView = {
      index: i, number: i + 1, tableKey, tableName: view?.name ?? '', hasTable: Boolean(view),
      tableOptions: spec.mode === 'custom'
        ? [opt('', '', !slot.tableKey), ...step.tables.map(t => opt(t.key, t.name || t.key, t.key === slot.tableKey, { available: t.available }))]
        : [],
      indexDie: spec.mode === 'random' ? die(session, `${base}.indexRow`, ctx.tables?.[step.index]?.formula ?? '1d6') : null,
      indexRow: hasValue(slot.indexRow) ? Number(plainValue(slot.indexRow)) : null,
      rowOptions: view ? [opt('', '', rowNumber === null), ...view.rows.map(r => opt(r.range[0], `${r.range[0]}: ${r.narrative}`, rowNumber !== null && rowNumber >= r.range[0] && rowNumber <= r.range[1]))] : [],
      rowDie: view ? die(session, `${base}.row`, ctx.tables?.[tableKey]?.formula ?? '') : null,
      rowMarker: rowNumber === null ? 'open' : (session.isRolled(`${base}.row`) ? 'rolled' : 'chosen'),
      narrative: tableRow?.narrative ?? '', hasRow: Boolean(tableRow), canSwap: (slot.skills ?? []).length > 1,
      skills: []
    };
    (slot.skills ?? []).forEach((skill, j) => {
      const picked = hasValue(skill.option) ? tableRow?.options?.[Number(skill.option)] ?? null : null;
      const skillBase = `${base}.skills.${j}`;
      const pickedItem = picked && (picked.identifier || skill.identifier || skill.name);
      slotView.skills.push({
        index: j, formula: skill.formula || step.rankFormulas[j] || '',
        chips: (tableRow?.options ?? []).map(o => ({
          index: o.index, label: o.name, kind: o.kind, active: Number(skill.option) === o.index && hasValue(skill.option),
          isChoice: o.kind === 'choice', isCustom: o.kind === 'custom', docKind: o.docKind, needsImport: Boolean(o.needsImport),
          ceiling: o.kind === 'named' || o.kind === 'spell' ? ceilingFor(session, o.docKind || (o.kind === 'spell' ? 'spell' : 'skill'), o.identifier) : null
        })),
        choice: picked?.kind === 'choice' ? { path: `${skillBase}.identifier`, options: [opt('', '', !skill.identifier), ...(picked.choices ?? []).map(c => opt(c.value, c.label, c.value === skill.identifier))] } : null,
        custom: picked?.kind === 'custom'
          ? { namePath: `${skillBase}.name`, name: skill.name ?? '', kindPath: `${skillBase}.docKind`, kinds: [opt('skill', '', (skill.docKind ?? 'skill') === 'skill'), opt('spell', '', skill.docKind === 'spell')] }
          : null,
        die: hasValue(skill.option) ? die(session, `${skillBase}.value`, skill.formula || step.rankFormulas[j]) : null,
        ready: Boolean(pickedItem)
      });
    });
    return slotView;
  });
}

function experiencesPanel(session, step, spec) {
  return {
    isExperiences: true, stepId: step.id, mode: spec.mode,
    modes: step.modes.map(m => ({ value: m, active: m === spec.mode, labelKey: `COG.FloorSim.Exp.Mode.${m}` })), fixedMode: step.modes.length === 1,
    slots: experienceSlots(session, step, spec), rankFormulas: step.rankFormulas
  };
}

function spellPickViews(session, step, spec, card, slotSpec, result) {
  const spellTable = session.context.tables?.[LOOT_SPELL_TABLE];
  const variant = card.spellVariants.find(v => v.id === slotSpec.spells?.variant) ?? card.spellVariants[0];
  const history = result?.history?.find(h => h.kind === 'loot' && h.step === step.id);
  const records = history?.picks?.find(p => p.slot === card.slot)?.spells ?? [];
  const substitute = Boolean(session.effectiveContext().run?.spellDuplicateSubstitute);
  return (variant?.picks ?? []).map((formula, k) => {
    const pick = slotSpec.spells?.picks?.[k] ?? {};
    const base = `${step.id}.slots.${card.slot}.spells.picks.${k}`;
    const record = records[k] ?? null;
    const row = spellTable && hasValue(pick.row) ? rowForTotal(spellTable, Number(plainValue(pick.row))) : null;
    return {
      index: k, formula,
      rowOptions: spellTable ? [opt('', '', !hasValue(pick.row)), ...spellTable.rows.map(r => opt(r.range[0], `${r.range[0]}: ${r.options?.find(o => o.identifier)?.name ?? r.narrative}`, hasValue(pick.row) && row?.range?.[0] === r.range[0]))] : [],
      rowDie: spellTable ? die(session, `${base}.row`, spellTable.formula) : null,
      rankDie: die(session, `${base}.rankValue`, formula), dupDie: die(session, `${base}.dupValue`, '1d2+1'),
      record, duplicate: Boolean(record?.duplicate), tome: Boolean(record?.tome), name: record?.name ?? '',
      resolved: hasValue(pick.row) || hasValue(pick.identifier),
      substitute: substitute && record?.duplicate
        ? { path: `${base}.substitute`, options: [opt('', '', !pick.substitute), ...catalogSpellOptions(session, pick.substitute ?? '')] }
        : null
    };
  });
}

/**
 * The Scroll of Upgrade controls of a Gold or Platinum weapon pick: the upgrade-table row (a die), the trigger to add when
 * the row offers several, and the weapon's new name. Written to `slots.<slot>.upgrade = { row, name, optionIndex }`.
 */
function scrollView(session, step, base, slotSpec, option, tierSpec) {
  if (!tierSpec?.bonuses?.scroll || (option?.kind !== 'weaponNew' && option?.kind !== 'weaponUpgrade')) return null;
  const table = session.context.tables?.[step.upgradeTable || LOOT_UPGRADE_TABLE];
  if (!table) return null;
  const upgrade = slotSpec.upgrade ?? {};
  const rowPath = `${base}.upgrade.row`;
  const row = hasValue(session.get(rowPath)) ? rowForTotal(table, Number(session.get(rowPath))) : null;
  const triggers = (row?.options ?? []).filter(o => o?.kind === 'asTrigger');
  const picked = Number.isInteger(Number(upgrade.optionIndex)) && hasValue(upgrade.optionIndex) ? Number(upgrade.optionIndex) : 0;
  return {
    die: die(session, rowPath, table.formula),
    narrative: row?.narrative ?? '',
    optionPath: `${base}.upgrade.optionIndex`,
    optionOptions: triggers.length > 1 ? triggers.map((t, i) => opt(i, t.label || t.nameAddition || String(i + 1), i === picked)) : [],
    namePath: `${base}.upgrade.name`, name: upgrade.name ?? ''
  };
}

/**
 * The bracelet race die: shown while no race is chosen and a race table exists. `race` is the identifier the die's row
 * names (the select shows it), `installed` whether that race is installed (a missing one leaves the select blank and warns).
 */
function braceletRaceView(session, option, slotSpec, base) {
  const table = session.context.tables?.[LOOT_BRACELET_RACE_TABLE];
  if (option?.kind !== 'bracelet' || !table || hasValue(slotSpec.choice?.race)) return null;
  const path = `${base}.raceRow`;
  const row = hasValue(session.get(path)) ? rowForTotal(table, Number(session.get(path))) : null;
  const named = row?.options?.find(o => hasValue(o?.identifier));
  const race = String(named?.identifier ?? '').trim().toLowerCase();
  const installed = Boolean(race) && raceOptionValues().some(o => o.value === race);
  return {
    die: die(session, path, table.formula), race, installed, name: named?.name || race, narrative: row?.narrative ?? '',
    marker: !row ? 'open' : (session.isRolled(path) ? 'rolled' : 'chosen')
  };
}

function lootPanel(session, step, spec, result) {
  const ctx = session.context;
  const rowTable = ctx.tables?.[step.table];
  const cards = session.lootCards(step, spec).map(card => {
    const slotSpec = spec.slots?.[card.slot] ?? {};
    const base = `${step.id}.slots.${card.slot}`;
    const tierSpec = ctx.lootTiers?.[card.slot]?.[card.tier];
    const optionId = slotSpec.option ?? slotSpec.choice?.option ?? (card.options.length === 1 ? card.options[0].id : '');
    const option = tierSpec?.options?.find(o => o.id === optionId) ?? null;
    const takeSpells = slotSpec.take === 'spells' && card.spellsAllowed;
    const entry = result?.log.find(e => e.step === step.id && e.slot === card.slot);
    const braceletRace = braceletRaceView(session, option, slotSpec, base);
    const paramSpec = braceletRace?.installed ? { ...slotSpec, choice: { ...slotSpec.choice, race: braceletRace.race } } : slotSpec;
    return {
      slot: card.slot, tier: card.tier, tierLabel: card.label || tierSpec?.label || `${card.tier} ${card.slot}`, spellsAllowed: card.spellsAllowed,
      takePath: `${base}.take`, take: slotSpec.take ?? '', takeLoot: slotSpec.take === 'loot', takeSpells,
      takeOptions: [opt('', '', !slotSpec.take, { labelKey: 'COG.FloorSim.Loot.Take.none' }), opt('loot', '', slotSpec.take === 'loot', { labelKey: 'COG.FloorSim.Loot.Take.loot' }), ...(card.spellsAllowed ? [opt('spells', '', slotSpec.take === 'spells', { labelKey: 'COG.FloorSim.Loot.Take.spells' })] : [])],
      optionPath: `${base}.option`, optionOptions: [opt('', '', !optionId), ...card.options.map(o => opt(o.id, o.label, o.id === optionId))],
      params: lootParams(session, option, tierSpec, paramSpec).map(p => ({ ...p, path: `${base}.choice.${p.key}` })),
      braceletRace,
      scroll: scrollView(session, step, base, slotSpec, option, tierSpec),
      scrollRoll: option?.kind === 'scrollSpell' && !hasValue(slotSpec.choice?.spell) ? die(session, `${base}.spellRow`, ctx.tables?.[LOOT_SPELL_TABLE]?.formula ?? '') : null,
      variants: card.spellVariants.map(v => opt(v.id, v.picks.join(' + '), v.id === (slotSpec.spells?.variant ?? card.spellVariants[0]?.id), { potions: v.potions })),
      variantPath: `${base}.spells.variant`,
      spellPicks: takeSpells ? spellPickViews(session, step, spec, card, slotSpec, result) : [],
      bonuses: card.bonuses, entry
    };
  });
  const rowNumber = hasValue(spec.row) ? Number(plainValue(spec.row)) : null;
  return {
    isLoot: true, stepId: step.id, tableName: step.tableName, reuse: step.reuse, rollable: step.rollable, tiers: step.tiers,
    rowOptions: step.rollable && rowTable
      ? [opt('', '', rowNumber === null), ...step.rows.map(r => opt(r.row, `${r.row}: ${r.narrative}`, rowNumber !== null && rowNumber >= r.row))]
      : [],
    rowPath: `${step.id}.row`, rowDie: step.rollable ? die(session, `${step.id}.row`, step.formula) : null,
    rowMarker: rowNumber === null ? 'open' : (session.isRolled(`${step.id}.row`) ? 'rolled' : 'chosen'),
    cards, hasCards: cards.length > 0, spellDuplicateSubstitute: step.spellDuplicateSubstitute
  };
}

function statsPanel(session, step, spec, result) {
  const allocation = spec.allocation ?? {};
  const after = result?.preview?.abilities ?? {};
  const allocated = STAT_KEYS.reduce((sum, k) => sum + (Number(allocation[k]) || 0), 0);
  return {
    isStats: true, stepId: step.id, pool: step.pool, allocated, left: step.pool - allocated, over: allocated > step.pool,
    leftover: Math.max(0, step.pool - allocated),
    rows: STAT_KEYS.map(key => {
      const a = step.abilities[key];
      const add = Number(allocation[key]) || 0;
      return {
        key, unenhanced: a.unenhanced, enhanced: a.value, added: add, afterUnenhanced: after[key]?.unenhanced ?? a.unenhanced + add,
        afterEnhanced: after[key]?.value ?? a.value + add, cap: a.cap
      };
    })
  };
}

function aiFavorPanel(session, step, spec, result) {
  const rating = Number(spec.rating ?? step.defaultRating ?? 0);
  return {
    isAiFavor: true, stepId: step.id, ratingPath: `${step.id}.rating`, current: step.current, mode: step.mode, defaultRating: step.defaultRating,
    ratings: [0, 1, 2].map(n => opt(n, String(n), n === rating)), rating,
    baseDie: die(session, `${step.id}.value`, step.formula),
    bonusDie: rating > 0 && step.byRating?.[rating] ? die(session, `${step.id}.ratingValue`, step.byRating[rating]) : null,
    entry: result?.log.find(e => e.step === step.id) ?? null
  };
}

function popularityPanel(session, step, spec, result) {
  return {
    isPopularity: true, mode: step.mode, current: step.current, chaMod: step.chaMod, multiplier: step.multiplier, value: step.value,
    entry: result?.log.find(e => e.step === step.id) ?? null
  };
}

function raceClassPanel(session, step, spec) {
  const rc = COGRaceClassApplier.getRaceClassContext({ type: 'crawler', system: { details: { race: spec.race ?? '', class: spec.class ?? '' } }, items: [] });
  return {
    isRaceClass: true, stepId: step.id, racePath: `${step.id}.race`, classPath: `${step.id}.class`,
    raceOptions: rc.raceOptions, classOptions: rc.classOptions, hasRace: step.hasRace, hasClass: step.hasClass,
    laterChosen: !spec.race && !spec.class
  };
}

/**
 * The panel of one arrival step. `session` is the `ArrivalDraft` of one arrival of the Crawler Creator's floor start.
 */
export function stepPanel(session, step, spec, preview) {
  const result = preview?.result;
  if (step.kind === 'level') return levelPanel(step);
  if (step.kind === 'skillBoost') {
    if (step.target === 'primary') return primaryPanel(session, step, spec, result);
    return step.target === 'others' ? othersPanel(session, step, spec, result) : chosenPanel(session, step, spec, result);
  }
  if (step.kind === 'experiences') return experiencesPanel(session, step, spec);
  if (step.kind === 'startingLoot') return lootPanel(session, step, spec, result);
  if (step.kind === 'stats') return statsPanel(session, step, spec, result);
  if (step.kind === 'aiFavor') return aiFavorPanel(session, step, spec, result);
  if (step.kind === 'popularity') return popularityPanel(session, step, spec, result);
  if (step.kind === 'raceClass') return raceClassPanel(session, step, spec);
  return { isUnknown: true, kind: step.kind };
}
