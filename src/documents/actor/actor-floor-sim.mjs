/**
 * Floor Simulator document layer. `snapshotForFloorSim` turns a crawler into plain
 * data, `loadFloorSimContext` gathers what the compiler reads besides it (never another actor), and
 * `applyFloorArrival` is the one write path for a compiled result.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { getFloorArrival, runForStartFloor, TUTORIAL_EXPERIENCE_TABLES } from '../../data/floor-arrivals.mjs';
import { prefillAiFavorRating } from '../../utils/ai-favor.mjs';
import { getLootTiers } from '../../data/floor-simulator/loot-tiers.mjs';
import { LOOT_SPELL_TABLE, LOOT_UPGRADE_TABLE, loadFloorTableSnapshots } from '../../data/floor-simulator/tables.mjs';
import { applyRaceClassChoices } from '../../data/race-class-applier.mjs';
import { buildFloorArrivalCard } from '../../chat/floor-arrival-card.mjs';
import { getItemAllTags } from '../../data/tags.mjs';
import { asTriggersOf, hasAsTrigger } from '../../utils/amazing-success.mjs';
import { getRankCeiling } from '../../utils/rank-cap.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { parseFloorNumber } from '../../utils/floor-number.mjs';

const STATS = ['str', 'dex', 'con', 'int', 'cha'];

const intOr = (raw, fallback = 0) => {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? n : fallback;
};

const itemList = (actor) => {
  return Array.from(actor?.items ?? []);
};

const flagOf = (actor, key) => actor?.flags?.[SYSTEM_ID]?.[key] ?? actor?.getFlag?.(SYSTEM_ID, key) ?? null;

/** The pending-run flag, sanitised: `{ startFloor, done: number[], complete? }` or null. */
function cleanFloorRun(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const startFloor = parseFloorNumber(raw.startFloor);
  if (!startFloor) return null;
  const done = (Array.isArray(raw.done) ? raw.done : []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  return { startFloor, done, ...(raw.complete ? { complete: true } : {}) };
}

/**
 * Plain data for the compiler; no documents. `floorRun` is null for an actor with no pending run (the simulator refuses it).
 * @param {object} actor
 * @returns {object} FloorSnapshot
 */
export function snapshotForFloorSim(actor) {
  const system = actor?.system ?? {};
  const abilities = {};
  for (const key of STATS) {
    const a = system.abilities?.[key] ?? {};
    const value = intOr(a.value, 10);
    abilities[key] = { value, unenhanced: intOr(a.unenhanced, value), cap: a.statCap === null || a.statCap === undefined ? null : intOr(a.statCap, null) };
  }
  const skills = [];
  const spells = [];
  const weapons = [];
  let hasRace = false;
  let hasClass = false;
  for (const item of itemList(actor)) {
    const role = item.flags?.[SYSTEM_ID]?.starterRole ?? null;
    if (item.type === 'skill') {
      skills.push({
        id: item.id, identifier: item.system?.identifier ?? '', name: item.name, rank: intOr(item.system?.rank), rankCeiling: getRankCeiling(item),
        tags: [...getItemAllTags(item)], starterRole: role, aiFavor: prefillAiFavorRating(item.system?.aiFavorRatings), aiFavorRatings: structuredClone(item.system?.aiFavorRatings ?? [])
      });
    } else if (item.type === 'spell') {
      spells.push({
        id: item.id, identifier: item.system?.identifier ?? '', name: item.name, rank: intOr(item.system?.rank), rankCeiling: getRankCeiling(item),
        manaCost: intOr(item.system?.manaCost), aiFavor: intOr(item.system?.aiFavor), starterRole: role
      });
    } else if (item.type === 'gear' && Array.isArray(item.system?.damageParts) && item.system.damageParts.length) {
      weapons.push({
        id: item.id, name: item.name, equipped: Boolean(item.system?.equipped), attackId: null,
        skillIdentifier: item.system?.selectedSkill || item.system?.associatedSkills?.[0] || null, aiFavor: prefillAiFavorRating(item.system?.aiFavorRatings), aiFavorRatings: structuredClone(item.system?.aiFavorRatings ?? []), hasAsTrigger: hasAsTrigger(item), asTriggers: structuredClone(asTriggersOf(item)), tags: Array.from(item.system?.tags ?? []),
        grants: structuredClone(Array.from(item.system?.grants ?? [])), damageModifiers: structuredClone(Array.from(item.system?.damageModifiers ?? [])),
        abilityModifiers: structuredClone(item.system?.abilityModifiers ?? {})
      });
    } else if (item.type === 'race') hasRace = true;
    else if (item.type === 'class') hasClass = true;
  }
  // A weapon's pre-filled AI Favor also counts the linked skill's rows (3.25d-3b); aiFavorRatings stays the gear's own.
  for (const w of weapons) {
    const linked = w.skillIdentifier ? itemList(actor).find(i => i.type === 'skill' && i.system?.identifier === w.skillIdentifier) : null;
    if (linked) w.aiFavor = Math.max(w.aiFavor, prefillAiFavorRating(linked.system?.aiFavorRatings));
  }
  const history = flagOf(actor, 'floorHistory');
  return {
    actorUuid: actor?.uuid ?? '', name: actor?.name ?? '', type: actor?.type ?? '',
    level: Math.max(1, intOr(system.details?.level, 1)), floor: parseFloorNumber(system.details?.floor) || 1,
    pendingStatPoints: Math.max(0, intOr(system.details?.pendingStatPoints)), abilities,
    aiFavor: intOr(system.attributes?.aiFavor), popularity: intOr(system.details?.popularity), manaMax: intOr(system.attributes?.mana?.max),
    skills, spells, weapons, hasRace, hasClass, floorHistory: Array.isArray(history) ? structuredClone(history) : [],
    floorRun: cleanFloorRun(flagOf(actor, 'floorRun'))
  };
}

/**
 * Everything the compiler reads besides the snapshot. Reads this actor's run flag and the content catalog only.
 * Tables and loot tiers arrive in later rows (S5 discovery, S7a).
 * @param {object} actor
 * @param {number|object} arrival A floor number or an arrival definition
 * @returns {object} FloorSimContext
 */
export function loadFloorSimContext(actor, arrival) {
  const definition = arrival && typeof arrival === 'object' ? arrival : getFloorArrival(arrival);
  const floorRun = cleanFloorRun(flagOf(actor, 'floorRun'));
  const arrivals = floorRun ? runForStartFloor(floorRun.startFloor) : [];
  const duplicateSubstitute = arrivals.some(n => Boolean(getFloorArrival(n)?.spellDuplicateSubstitute));
  return {
    arrival: definition ?? null,
    run: { startFloor: floorRun?.startFloor ?? null, arrivals, spellDuplicateSubstitute: duplicateSubstitute },
    tables: {},
    catalog: {
      skills: catalogEntries('skills').map(d => ({ identifier: d.system?.identifier ?? '', name: d.name, tags: d.system?.tags ?? [], stat: d.system?.stat ?? '', rankCeiling: getRankCeiling(d) })),
      spells: catalogEntries('spells').map(d => ({ identifier: d.system?.identifier ?? '', name: d.name, manaCost: intOr(d.system?.manaCost), tags: d.system?.tags ?? [], aiFavor: intOr(d.system?.aiFavor), rankCeiling: getRankCeiling(d) }))
    },
    lootTiers: getLootTiers()
  };
}

/** Every table key an arrival's steps name (index, tables, suggestedTables, table), once each. */
export function floorTableKeys(arrival) {
  const keys = new Set();
  for (const step of Array.isArray(arrival?.steps) ? arrival.steps : []) {
    for (const k of [step.table, step.spellTable, step.index, ...(Array.isArray(step.tables) ? step.tables : []), ...(Array.isArray(step.suggestedTables) ? step.suggestedTables : [])]) {
      if (typeof k === 'string' && k.trim()) keys.add(k.trim());
    }
    // The Experiences step falls back to the six Tutorial Floor tables when it names none (steps/experiences.mjs).
    if (step.kind === 'experiences' && !(Array.isArray(step.tables) && step.tables.length)) for (const k of TUTORIAL_EXPERIENCE_TABLES) keys.add(k);
    // The loot step rolls its Spell picks on this table unless the step names another (steps/loot.mjs).
    if (step.kind === 'startingLoot' && !(typeof step.spellTable === 'string' && step.spellTable.trim())) keys.add(LOOT_SPELL_TABLE);
    // A Gold or Platinum weapon pick resolves its Scroll of Upgrade on this table (S7b).
    if (step.kind === 'startingLoot') keys.add(typeof step.upgradeTable === 'string' && step.upgradeTable.trim() ? step.upgradeTable.trim() : LOOT_UPGRADE_TABLE);
  }
  return [...keys];
}

/**
 * `loadFloorSimContext` plus the table snapshots the arrival names (S5 discovery: the world's tables, then the registered
 * packs). `context.tables[key]` is a TableSnapshot or null (missing, with a warning in `context.warnings`); the experience
 * step then falls back to Custom mode for that slot.
 * @param {object} actor
 * @param {number|object} arrival
 * @param {{ sources?: object, resolveUuid?: Function }} [options] Passed to `loadFloorTableSnapshots` (tests inject sources)
 * @returns {Promise<object>} FloorSimContext with `tables` filled
 */
export async function loadFloorSimContextWithTables(actor, arrival, options = {}) {
  const context = loadFloorSimContext(actor, arrival);
  const warnings = [];
  context.tables = await loadFloorTableSnapshots(floorTableKeys(context.arrival), { ...options, warnings });
  context.warnings = warnings;
  return context;
}

/**
 * Write a compiled arrival. Order (book order, D2b): gainLevels, create and update items, spendStatPoints, the actor
 * update (floor label, AI Favor, Popularity, the run flag, the history flag, full resources), Race and Class last, then
 * the chat card. Foundry has no transactions, so a failed write is reported in `warnings` and the rest continues.
 * Pending Rule Breaks are confirmed once for the whole arrival; declining writes nothing.
 * @param {object} actor
 * @param {object} result FloorArrivalResult
 * @param {object} [options]
 * @param {object[]} [options.rolls] Foundry Roll objects to attach to the card
 * @param {string} [options.rollMode]
 * @param {boolean} [options.fillResources=true] Set HP and Mana to their derived maximums after the Stat step
 * @param {boolean} [options.interactive=true] false: no dialogs (a pending Rule Break is then refused)
 * @returns {Promise<{applied: boolean, declined?: boolean, refused?: boolean, warnings: object[]}>}
 */
export async function applyFloorArrival(actor, result, { rolls = [], rollMode, fillResources = true, interactive = true, ruleBreak = false } = {}) {
  const warnings = [...(result?.warnings ?? [])];
  if (!result || result.refused) return { applied: false, refused: true, warnings };
  const confirmOptions = { interactive, ...(ruleBreak ? { ruleBreak: true } : {}) };

  const pending = result.ruleBreaks?.pending ?? [];
  let final = result;
  if (pending.length) {
    const confirm = await confirmRuleBreak({
      title: 'Floor Simulator',
      message: `${pending.map(p => p.reason).join('; ')}. Apply the arrival anyway as a Rule Break?`,
      options: confirmOptions
    });
    if (!confirm.confirmed) return { applied: false, declined: true, warnings };
    const keys = new Set(pending.map(p => p.key));
    final = structuredClone(result);
    final.ruleBreaks = { pending: [], confirmed: [...(result.ruleBreaks.confirmed ?? []), ...keys] };
    for (const section of final.card?.sections ?? []) {
      for (const entry of section.entries) if (entry.breakKey && keys.has(entry.breakKey)) entry.ruleBreak = true;
    }
  }
  const brokeRules = (final.ruleBreaks?.confirmed?.length ?? 0) > 0;
  const statBreak = (final.ruleBreaks?.confirmed ?? []).some(k => k.startsWith('stats:'));

  const attempt = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      console.error(`Sprinter RPG | Floor Simulator ${label} failed:`, err);
      warnings.push({ step: null, message: `${label} failed: ${err?.message ?? err}` });
      return null;
    }
  };

  if (final.levelsGained > 0) await attempt('Level gain', () => actor.gainLevels(final.levelsGained, { source: 'floor', options: confirmOptions }));
  if (final.itemCreates?.length) await attempt('Item creation', () => actor.createEmbeddedDocuments('Item', final.itemCreates));
  if (final.itemUpdates?.length) await attempt('Item update', () => actor.updateEmbeddedDocuments('Item', final.itemUpdates));
  if (Object.keys(final.statAllocation ?? {}).length) {
    await attempt('Stat points', () => actor.spendStatPoints(final.statAllocation, { ...confirmOptions, ...(statBreak ? { ruleBreak: true } : {}) }));
  }

  // Read before the writes below move the run on: the card records which run it belonged to.
  const startFloor = flagOf(actor, 'floorRun')?.startFloor ?? null;
  const update = { ...final.actorUpdate };
  if (final.history?.length) {
    const history = flagOf(actor, 'floorHistory');
    update[`flags.${SYSTEM_ID}.floorHistory`] = [...(Array.isArray(history) ? history : []), ...final.history];
  }
  if (brokeRules) update[`flags.${SYSTEM_ID}.ruleBreak`] = true;
  if (fillResources) {
    const hpMax = actor.system?.attributes?.hp?.max;
    const manaMax = actor.system?.attributes?.mana?.max;
    if (Number.isFinite(Number(hpMax))) update['system.attributes.hp.value'] = Number(hpMax);
    if (Number.isFinite(Number(manaMax))) update['system.attributes.mana.value'] = Number(manaMax);
  }
  // Flags go through setFlag; everything else in one update.
  const flagPrefix = `flags.${SYSTEM_ID}.`;
  const flagWrites = Object.entries(update).filter(([k]) => k.startsWith(flagPrefix));
  for (const [k] of flagWrites) delete update[k];
  await attempt('Actor update', () => actor.update(update));
  for (const [k, v] of flagWrites) await attempt(`Flag ${k.slice(flagPrefix.length)}`, () => actor.setFlag(SYSTEM_ID, k.slice(flagPrefix.length), v));

  if (final.raceClass && (final.raceClass.race || final.raceClass.class)) {
    await attempt('Race and Class', () => applyRaceClassChoices(actor, {
      ...(final.raceClass.race ? { race: final.raceClass.race } : {}),
      ...(final.raceClass.class ? { class: final.raceClass.class } : {})
    }, { interactive }));
  }

  await attempt('Chat card', () => {
    const data = {
      speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
      content: buildFloorArrivalCard({ ...final, warnings }),
      rolls,
      flags: { [SYSTEM_ID]: { floorArrival: { actorUuid: actor.uuid ?? null, floor: final.floor, startFloor, history: final.history ?? [], ruleBreak: brokeRules } } }
    };
    if (rollMode && typeof globalThis.ChatMessage?.applyMode === 'function') globalThis.ChatMessage.applyMode(data, rollMode);
    return globalThis.ChatMessage.create(data);
  });

  return { applied: true, warnings };
}
