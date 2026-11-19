/**
 * The `starterRole` flag: which job a crawler's starting item does (`primarySkill`, `heal`, `starterSpell`,
 * `starterAttack`, `manaPotion`), so the hotlist and the floor simulator find an item by role and never by name. This
 * module is the one place that names the stored key. A leaf: the crawler payload builder and the floor-simulator
 * snapshot both reach it without an import cycle.
 */
import { readFlag, withFlags } from '../flags.mjs';

const STARTER_ROLE_KEY = 'starterRole';

/** The starter role of an item (a document or creation data), or `null` when it has none. */
export function starterRoleOf(item) {
  return readFlag(item, STARTER_ROLE_KEY) ?? null;
}

/** `data` stamped with a starter role. A copy. */
export function withStarterRole(data, role) {
  return withFlags(data, { [STARTER_ROLE_KEY]: role });
}
