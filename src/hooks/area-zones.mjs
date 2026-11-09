/**
 * Placed-zone lifecycle: the Step 5 Clean Up step that pulses zones, and the hooks that end them.
 * The step is registered at import, after the aura pulse (150) and before durations (200).
 */
import { COGCombat } from '../documents/combat.mjs';
import { pulseZones, onAreaRegionDeleted, endCombatZones, onZoneTokenMove } from '../documents/actor/zone-pulse.mjs';

/** Clean Up order of the zone step: right after `aura-pulse` (150). */
const AREA_ZONES_ORDER = 160;

COGCombat.registerCleanUpStep('area-zones', (combat, { round }) => pulseZones(combat, { round }), { order: AREA_ZONES_ORDER });

export function registerAreaZoneHooks() {
  Hooks.on('deleteRegion', (region) => onAreaRegionDeleted(region));
  Hooks.on('moveToken', (tokenDoc, movement) => onZoneTokenMove(tokenDoc, movement));
  Hooks.on('deleteCombat', (combat) => endCombatZones(combat));
}
