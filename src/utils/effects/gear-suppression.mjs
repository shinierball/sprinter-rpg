/**
 * Gear in a zero zone. While an actor stands in a zone (mobs and NPCs too) its equipped gear stops doing things for
 * its wearer, and every Buff and Debuff is paused. Nothing is deleted or written: each reader asks the predicates here.
 *
 * - `isGearSuppressed(actor, item, kind)`: does this worn item still do this kind of thing? Physical facts (it is worn,
 *   it fills hands, a weapon's own dice) keep reading `system.equipped`.
 * - The kinds live in `CONFIG.COG.gearContributions` (seeded from `DEFAULT_GEAR_CONTRIBUTIONS`), so a module can keep
 *   one kind on. The tag `rule.works-in-zero-zone` (flag `works-in-zero-zone`) lets one item ignore the zone.
 * - `isEffectPaused(actor)`: every Buff and Debuff is paused while the actor is in the zone, like a dispel. Timed ones
 *   keep counting down (that clock does not ask); permanent ones apply again when the zone ends.
 * - Current Health and Mana are never written; they may sit above the lowered maximum.
 */
import { zeroZoneOf } from './zero-zone.mjs';
import { zoneTokensOf } from '../../documents/actor/zero-zone-gate.mjs';

/** Contribution kinds. `offline: true` = suppressed in a zero zone by default. */
export const DEFAULT_GEAR_CONTRIBUTIONS = Object.freeze({
  stats: Object.freeze({ offline: true }), // stat grants (and so Stat Mods, Evade, Max Health, Max Mana)
  armor: Object.freeze({ offline: true }), // drBonus, anti-piercing DR
  sources: Object.freeze({ offline: true }), // typed rows, senses, rank_cap
  tags: Object.freeze({ offline: true }), // the gear's tags on the actor
  ranks: Object.freeze({ offline: true }), // skill/spell value and rank_bonus grants
  grantedAbilities: Object.freeze({ offline: true }), // skills and spells only the gear gives
  persistentBuffs: Object.freeze({ offline: true }),
  persistentDebuffs: Object.freeze({ offline: true }), // cursed gear too
  attackExtras: Object.freeze({ offline: true }), // damage parts and Armor-Piercing from non-attacking gear
  roundHealing: Object.freeze({ offline: true }),
  aura: Object.freeze({ offline: true }),
  light: Object.freeze({ offline: false }) // a torch is a torch
});

/**
 * `tags.mjs` and `dispel.mjs` import this module and `tag-behaviour.mjs` imports them, so it cannot import
 * `hasRuleFlag` itself. `tag-behaviour.mjs` hands it over when it loads.
 * @type {(subject: object, flag: string) => boolean}
 */
let flagReader = () => false;
export function bindGearFlagReader(fn) {
  if (typeof fn === 'function') flagReader = fn;
}

/** `RULE_FLAGS.worksInZeroZone`, spelled out for the same reason. */
const WORKS_IN_ZERO_ZONE_FLAG = 'works-in-zero-zone';

const INACTIVE = Object.freeze({ active: false, source: null, label: '' });

/** @returns {{ active: boolean, source: 'world'|'region'|null, label: string }} cheap; any failure reads as no zone */
export function gearOfflineState(actor) {
  if (!actor) return { ...INACTIVE };
  try {
    const zone = zeroZoneOf(actor, { tokens: () => zoneTokensOf(actor) });
    return zone?.active ? { active: true, source: zone.source ?? null, label: String(zone.label ?? '') } : { ...INACTIVE };
  } catch {
    return { ...INACTIVE };
  }
}

/**
 * The zone state now. Worked out fresh on every call (a world-setting read; the region source adds a token lookup), never
 * read back from `actor.system.gearOffline`: that is only the sheet's snapshot from the last prepare and goes stale when
 * the zone flips before the actor is re-prepared.
 */
function actorGearOffline(actor) {
  return gearOfflineState(actor);
}

/** Is this actor in a zone that pauses its Buffs and Debuffs? */
export function isEffectPaused(actor) {
  return actorGearOffline(actor).active === true;
}

/**
 * A persistent Buff kept on the wearer by worn gear tagged `rule.works-in-zero-zone` is not paused with the rest: the
 * item ignores the zone, and the Buff it keeps is part of what it does. `buff.sourceGearId` names that gear.
 */
export function keptByWorkingGear(actor, buff) {
  const id = buff?.sourceGearId;
  if (!id) return false;
  const gear = actor?.items?.get(id);
  return Boolean(gear && gear.type === 'gear' && gear.system?.equipped && flagReader(gear, WORKS_IN_ZERO_ZONE_FLAG));
}

function contributionOffline(kind) {
  const registry = globalThis.CONFIG?.COG?.gearContributions;
  const entry = registry?.[kind] ?? DEFAULT_GEAR_CONTRIBUTIONS[kind];
  return entry?.offline === true;
}

/** True when `item` is equipped gear that does NOT contribute `kind` for `actor` now. */
export function isGearSuppressed(actor, item, kind) {
  if (!item || item.type !== 'gear' || !item.system?.equipped) return false;
  if (!actorGearOffline(actor).active) return false;
  if (!contributionOffline(kind)) return false;
  return !flagReader(item, WORKS_IN_ZERO_ZONE_FLAG);
}

/** Equipped gear that still contributes `kind` (the replacement for `type === 'gear' && system.equipped`). */
export function workingGear(actor, items, kind) {
  return Array.from(items ?? []).filter(i => i?.type === 'gear' && i.system?.equipped && !isGearSuppressed(actor, i, kind));
}

/** Equipped gear suppressed for `kind` (the sheet's offline readouts). */
export function offlineGear(actor, items, kind) {
  return Array.from(items ?? []).filter(i => isGearSuppressed(actor, i, kind));
}
