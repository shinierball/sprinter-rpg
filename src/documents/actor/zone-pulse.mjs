/**
 * Placed zones that pulse. A zone is the core Region of a placed area whose flag `area.kind` is `zone`
 * (a `rule.hazard` area with a lasting duration). At each Step 5 Clean Up the active GM finds the tokens inside it
 * with Foundry's own `token.testInsideRegion` (never `region.tokens`), applies the item's per-pulse effects through
 * 3.17's `applyAuraPulse` (one damage roll for everyone inside), adds the item's `pulseConditions`, takes the
 * while-inside effects off anyone who has left, stamps the pulse and counts the zone's rounds down. A zone that runs
 * out of rounds, loses its source item, or is deleted by hand ends with its splash ring. One-shot markers placed in
 * a combat are cleared at the Clean Up of that round.
 *
 * `pulseZone` trusts the region's flags on purpose. A Region has no author record, a player can write any
 * flag on a Region they create, and a non-owner's Place click on a cast card makes a real zone. None of this does more
 * harm than a mob actor of their own could, and adjudication stays with the GM, who can dismiss any zone.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { isActiveGM } from '../../utils/gm-relay.mjs';
import { combatText } from '../../utils/combat/combat-round-text.mjs';
import { findAreaRegions, tokensInRegion } from '../../utils/area/region-shapes.mjs';
import { isMarkerActor } from '../../utils/area/marker.mjs';
import { positionAfterMovement } from '../../utils/combat/movement-position.mjs';
import { pulseRows } from '../combat-aura-pulse.mjs';
import { applyAuraPulse, auraSideOf, markAppliedRound, normalizeAuraFilter, withAuraLock } from './aura-pulse.mjs';
import { findAuraEffects, removeAuraItems } from './aura-relay.mjs';
import { findHolderToken, deleteAreaGroup } from './area-relay.mjs';
import { debuffHasConditionRef } from './actor-conditions.mjs';
import { conditionLabel } from './condition-data.mjs';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const areaFlags = (region) => region?.flags?.[SYSTEM_ID]?.area ?? null;
const resolve = (uuid) => (uuid && typeof uuid === 'string' ? globalThis.fromUuidSync?.(uuid) ?? null : null);

/**
 * Who is inside a zone, split into the caster's allies and enemies. Markers are skipped by `tokensInRegion` and
 * `auraSideOf`; `filter` limits the sides like an aura's target filter.
 * @param {RegionDocument} region the zone's core region
 * @param {Actor|null} caster
 * @param {{ filter?: 'allies'|'enemies'|'both' }} [options]
 * @returns {{ allies: Actor[], enemies: Actor[] }}
 */
export function zoneMembers(region, caster, { filter = 'both' } = {}) {
  const casterToken = findHolderToken(region?.parent, caster);
  const allies = [];
  const enemies = [];
  const seen = new Set();
  for (const token of tokensInRegion(region)) {
    const actor = token.actor;
    const key = actor?.uuid || actor?.id;
    if (!actor || seen.has(key)) continue;
    const side = auraSideOf(caster, casterToken, actor, token);
    if (side === 'ally' && filter !== 'enemies') allies.push(actor);
    else if (side === 'enemy' && filter !== 'allies') enemies.push(actor);
    else continue;
    seen.add(key);
  }
  return { allies, enemies };
}

/** Every actor of the scene's tokens, deduped by uuid. */
function sceneActors(scene) {
  const tokens = scene?.tokens;
  const seen = new Map();
  for (const t of Array.from(tokens?.contents ?? tokens ?? [])) {
    if (t.actor) seen.set(t.actor.uuid || t.actor.id, t.actor);
  }
  return [...seen.values()];
}

/**
 * Take an item's while-inside buffs and debuffs off every actor on the scene that is no longer inside any zone of
 * that item (`exceptRegionId` is a region being deleted; `positions` are destinations of tokens still moving). A
 * debuff with a duration of its own is kept and runs it out. Active GM writes, so no relay is needed.
 * @returns {Promise<Array<{ actorUuid: string, name: string }>>}
 */
async function clearStaleEffects(scene, sourceItemUuid, exceptRegionId = '', { positions = null } = {}) {
  if (!scene || !sourceItemUuid) return [];
  const inside = new Set();
  for (const core of findAreaRegions(scene, { kind: 'zone', role: 'core', sourceItemUuid })) {
    if (core.id === exceptRegionId) continue;
    for (const token of tokensInRegion(core, positions)) inside.add(token.actor?.uuid || token.actor?.id);
  }
  const removed = [];
  for (const actor of sceneActors(scene)) {
    if (inside.has(actor.uuid || actor.id)) continue;
    if (!findAuraEffects(actor, sourceItemUuid).itemIds.length) continue;
    if (await removeAuraItems(actor, { uuid: sourceItemUuid }, { types: ['debuff', 'buff'], keepTimed: true })) {
      actor.prepareData?.();
      removed.push({ actorUuid: actor.uuid, name: actor.name });
    }
  }
  return removed;
}

/** Mark a pulse condition as this zone item's (by UUID, like an aura debuff), so leaving the zone can find it. */
async function stampZoneEffect(debuff, item, ref) {
  if (typeof debuff?.setFlag !== 'function') return;
  await debuff.setFlag(SYSTEM_ID, 'auraSourceUuid', item.uuid || '');
  await debuff.setFlag(SYSTEM_ID, 'auraDebuffRef', ref);
}

/**
 * `moveToken` hook body (active GM only; the hook fires on every client, so a player's drag is handled here): the
 * moved token's effects from any zone it is no longer inside come off, measured at its destination. One run per zone
 * item, under the aura lock.
 * @param {TokenDocument} tokenDoc
 * @param {object|null} [movement] the `moveToken` payload
 */
export async function onZoneTokenMove(tokenDoc, movement = null) {
  if (!isActiveGM() || !tokenDoc?.actor || isMarkerActor(tokenDoc.actor)) return;
  const scene = tokenDoc.parent ?? globalThis.canvas?.scene;
  const uuids = new Set(findAreaRegions(scene, { kind: 'zone', role: 'core' }).map(r => areaFlags(r).sourceItemUuid).filter(Boolean));
  if (!uuids.size) return;
  const positions = new Map([[tokenDoc.id, positionAfterMovement(tokenDoc, movement)]]);
  for (const uuid of uuids) {
    try { await withAuraLock(uuid, () => clearStaleEffects(scene, uuid, '', { positions })); } catch (err) {
      console.error('Sprinter RPG | Zone leave failed:', err);
    }
  }
}

/** Delete a zone's group (core and splash): directly when owner or GM, else through `areaDeleteRegions`. */
function endAreaGroup(scene, groupId) {
  return deleteAreaGroup(scene, groupId);
}

/**
 * Pulse one zone once for a combat round. Does nothing when the zone already pulsed this round of this combat.
 * @param {RegionDocument} region the zone's core region
 * @param {{ combat: Combat, round?: number }} p
 * @returns {Promise<object|null>} a ZonePulseReport `{ groupId, regionUuid, itemName, itemSystem, casterName, pulse,
 *   conditions, removed, expired }`, or null when the zone was skipped
 */
async function pulseZone(region, { combat, round = combat?.round } = {}) {
  const flags = areaFlags(region);
  if (!flags || flags.kind !== 'zone' || flags.role !== 'core' || !combat) return null;
  const scene = region.parent;
  const when = Number(round ?? combat.round) || 0;
  if (flags.combatId === combat.id && Number(flags.lastPulsedRound) === when) return null;

  const item = resolve(flags.sourceItemUuid);
  const report = {
    groupId: flags.groupId, regionUuid: region.uuid, itemName: item?.name ?? region.name, itemSystem: item?.system,
    casterName: '', pulse: null, conditions: [], removed: [], expired: false
  };
  if (!item) {
    report.expired = true;
    await endAreaGroup(scene, flags.groupId);
    report.removed = await clearStaleEffects(scene, flags.sourceItemUuid);
    return report;
  }

  const caster = item.parent ?? null;
  report.casterName = caster?.name ?? '';
  await withAuraLock(item.uuid, async () => {
    const filter = normalizeAuraFilter(item.system?.area?.targetFilter);
    const { allies, enemies } = zoneMembers(region, caster, { filter });
    report.pulse = await applyAuraPulse(caster, item, { allies, enemies, stamp: { round: when, combatId: combat.id ?? '' } });

    const refs = (item.system?.area?.pulseConditions ?? []).filter(Boolean);
    for (const actor of enemies) {
      for (const ref of refs) {
        const has = Array.from(actor.items ?? []).some(i => i.type === 'debuff' && debuffHasConditionRef(i, ref));
        if (has) continue;
        const created = await actor.applyCondition?.(ref, { sourceItem: item });
        if (created) {
          // Applied at this Clean Up: the same Clean Up's durations step must not count it down (3.40 g).
          await markAppliedRound(created, { round: when, combatId: combat.id ?? '' });
          await stampZoneEffect(created, item, ref);
          report.conditions.push({ actorUuid: actor.uuid, name: actor.name, ref });
        }
      }
    }
    report.removed = await clearStaleEffects(scene, item.uuid);

    const counted = flags.remainingRounds !== null && flags.remainingRounds !== undefined && Number.isFinite(Number(flags.remainingRounds));
    const remaining = counted ? Number(flags.remainingRounds) - 1 : null;
    report.expired = remaining !== null && remaining <= 0;
    if (report.expired) {
      await endAreaGroup(scene, flags.groupId);
    } else {
      await region.update({
        [`flags.${SYSTEM_ID}.area.lastPulsedRound`]: when,
        [`flags.${SYSTEM_ID}.area.combatId`]: combat.id ?? null,
        ...(remaining !== null ? { [`flags.${SYSTEM_ID}.area.remainingRounds`]: remaining } : {})
      });
    }
  });
  return report;
}

/** One chat card for a Clean Up's zone pulses. Posts nothing when no zone did anything. */
async function postZonePulseCard(reports, round) {
  const rows = [];
  for (const r of reports) {
    if (r.pulse) rows.push(...pulseRows({ item: { name: r.itemName, system: r.itemSystem }, result: { report: r.pulse } }));
    for (const c of r.conditions) {
      rows.push(`<div class="cog-bg-danger-tint"><strong>${esc(r.itemName)}</strong> &rarr; ${esc(c.name)}: ${esc(combatText('COG.ZonePulse.Condition', { condition: conditionLabel(c.ref) }))}</div>`);
    }
    if (r.expired) rows.push(`<div class="cog-text-muted">${esc(combatText('COG.ZonePulse.Ended', { zone: r.itemName }))}</div>`);
  }
  if (!rows.length || typeof globalThis.ChatMessage?.create !== 'function') return null;
  const content = `<div class="cog-chat-card cog-round-end-card cog-zone-pulse-card">
    <header class="cog-card-header"><h3><i class="fa-solid fa-biohazard"></i> ${esc(combatText('COG.ZonePulse.Title', { round }))}</h3></header>
    <div class="cog-card-body">${rows.join('')}</div>
  </div>`;
  return globalThis.ChatMessage.create({ content, speaker: { alias: 'Combat Tracker' } });
}

/**
 * The Step 5 Clean Up step (order 160): the GM who steps the round (not only the active GM) pulses every zone on the combat's scene, clears this round's
 * one-shot markers, and posts one card. A player client does nothing.
 * @param {Combat} combat
 * @param {{ round?: number }} [options]
 * @returns {Promise<object[]>} the ZonePulseReports
 */
export async function pulseZones(combat, { round = combat?.round } = {}) {
  if (!combat || (globalThis.game?.user && !globalThis.game.user.isGM)) return [];
  const scene = combat.scene ?? globalThis.canvas?.scene;
  if (!scene) return [];
  const when = Number(round ?? combat.round) || 0;

  const reports = [];
  for (const region of findAreaRegions(scene, { kind: 'zone', role: 'core' })) {
    try {
      const report = await pulseZone(region, { combat, round: when });
      if (report) reports.push(report);
    } catch (err) {
      console.error(`Sprinter RPG | Zone pulse "${region?.name}" failed:`, err);
    }
  }

  // One-shot markers placed in this combat are cleared at the Clean Up of the round they were placed in.
  const done = new Set();
  for (const region of findAreaRegions(scene, { kind: 'marker' })) {
    const f = areaFlags(region);
    if (f.combatId !== combat.id || done.has(f.groupId) || !(Number(f.placedRound) <= when)) continue;
    done.add(f.groupId);
    await endAreaGroup(scene, f.groupId);
  }

  await postZonePulseCard(reports, when);
  return reports;
}

/**
 * `deleteRegion` hook body (active GM only). Deleting a zone's core removes its splash ring, and the item's
 * while-inside effects come off anyone not inside another zone of that item. Aura regions and regions this system did
 * not place are ignored.
 */
export async function onAreaRegionDeleted(region) {
  const flags = areaFlags(region);
  if (!flags || region.flags?.[SYSTEM_ID]?.isAura || flags.role !== 'core' || !isActiveGM()) return;
  const scene = region.parent;
  const siblings = findAreaRegions(scene, { groupId: flags.groupId }).filter(r => r.id !== region.id);
  if (siblings.length) {
    try { await scene.deleteEmbeddedDocuments('Region', siblings.map(r => r.id)); } catch { /* already gone */ }
  }
  if (flags.kind === 'zone') await clearStaleEffects(scene, flags.sourceItemUuid, region.id);
}

/**
 * `deleteCombat` hook body (active GM only): the zones and markers placed in that combat end with it, except zones
 * that last until dismissed.
 */
export async function endCombatZones(combat) {
  if (!combat || !isActiveGM()) return;
  const scenes = new Set([globalThis.canvas?.scene, ...Array.from(globalThis.game?.scenes ?? [])].filter(Boolean));
  for (const scene of scenes) {
    const groups = new Set();
    for (const region of findAreaRegions(scene, { role: 'core' })) {
      const f = areaFlags(region);
      if (f.combatId !== combat.id) continue;
      if (f.kind === 'zone' && (f.remainingRounds === null || f.remainingRounds === undefined)) continue;
      groups.add(f.groupId);
    }
    for (const groupId of groups) await endAreaGroup(scene, groupId);
  }
}
