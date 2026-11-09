/**
 * The picks a crawler made when a race or class was applied, read back off the embedded item so a compendium
 * sync can re-apply with them as the planner's `selections`. Pure; structured fields only (choice ids, identifiers, stat
 * keys, never names or text).
 *
 * The embedded item keeps the resolved picks: `system.chosenSkills` / `chosenSpells` carry the `choiceId` of each pick,
 * and the pool split and rank-cap picks are fixed `stat` / `rank_cap` rows in its `system.grants`. A pick that no longer
 * fits the updated definition (the option is gone, the pool changed size) is dropped, so the re-apply takes the default
 * for that choice or pool as an unanswered apply does. Nothing is blocked.
 */
import { detectStatPools, evaluateStatPool } from './stat-pool.mjs';

const refOf = (v) => String(v ?? '').trim();

/** Removes one entry matching `same` from `list` (mutates); true when one was removed. */
function takeOne(list, same) {
  const at = list.findIndex(same);
  if (at < 0) return false;
  list.splice(at, 1);
  return true;
}

/**
 * @param {object} embeddedSystem the embedded race or class item's `system` (as it was before the sync overwrote it)
 * @param {object} def the updated definition (`{ system: { grants } }`)
 * @param {Array<object>} choices `COGRaceClassApplier.detectChoices(def)`
 * @returns {{ choices?: Object<string, string>, statPools?: Object<number, Object<string, number>> }} empty when nothing was recorded or still fits
 */
export function recordedPicks(embeddedSystem, def, choices = []) {
  const out = {};
  const grants = Array.isArray(def?.system?.grants) ? def.system.grants : [];
  const old = Array.isArray(embeddedSystem?.grants) ? embeddedSystem.grants : [];

  // Choices: skill and spell picks by their recorded choice id; a pick must still be one of an explicit option list
  const recorded = new Map();
  for (const row of embeddedSystem?.chosenSkills ?? []) if (row?.choiceId) recorded.set(row.choiceId, { type: 'skill', ref: refOf(row.identifier) });
  for (const row of embeddedSystem?.chosenSpells ?? []) if (row?.choiceId) recorded.set(row.choiceId, { type: 'spell', ref: refOf(row.identifier) });

  // Rank-cap picks are fixed rank_cap rows once applied. The updated definition's own fixed rows are not picks.
  const rankCapLeft = old.filter(g => g?.kind === 'rank_cap' && g.mode === 'fixed');
  for (const g of grants) if (g?.kind === 'rank_cap' && g.mode === 'fixed') takeOne(rankCapLeft, o => refOf(o.identifier) === refOf(g.identifier));

  const picked = {};
  for (const ch of choices) {
    let ref = '';
    if (ch.grantKind === 'rank_cap') {
      ref = refOf(rankCapLeft.shift()?.identifier);
    } else {
      const rec = recorded.get(ch.id);
      if (rec && rec.type === ch.type) ref = rec.ref;
    }
    if (!ref) continue;
    if (Array.isArray(ch.options) && !ch.options.some(o => refOf(o?.value ?? o) === ref)) continue; // the option was removed
    picked[ch.id] = ref;
  }
  if (Object.keys(picked).length) out.choices = picked;

  // Pool splits: the old fixed stat rows the updated definition does not author itself, matched to a pool by its label
  const statLeft = old.filter(g => g?.kind === 'stat' && g.mode === 'fixed');
  for (const g of grants) {
    if (g?.kind === 'stat' && g.mode === 'fixed') takeOne(statLeft, o => o.stat === g.stat && Number(o.value) === Number(g.value));
  }
  const pools = detectStatPools(grants);
  const statPools = {};
  for (const pool of pools) {
    if (pools.filter(p => p.label === pool.label).length !== 1) continue; // two pools share a label: the rows cannot be told apart
    const rows = statLeft.filter(r => (r.label ?? '') === pool.label);
    if (!rows.length) continue;
    const allocation = {};
    for (const r of rows) allocation[r.stat] = (allocation[r.stat] ?? 0) + (Number(r.value) || 0);
    if (Object.keys(allocation).some(stat => !pool.options.includes(stat))) continue; // a stat left the pool
    const evaluated = evaluateStatPool(pool, allocation);
    if (evaluated.spent !== pool.points) continue; // the pool changed size
    statPools[pool.grantIndex] = evaluated.allocation;
  }
  if (Object.keys(statPools).length) out.statPools = statPools;
  return out;
}
