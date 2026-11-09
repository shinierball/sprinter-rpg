/**
 * GM-only world bootstrap: background tables, journal, world macros, player permissions, mob token disposition.
 * The system's own compendiums are compiled at build time (`npm run build:packs`); nothing here writes to them.
 */
import { COG_MACROS } from '../data/macros.mjs';
import { ensureBackgroundTables } from '../data/rules/background-table-rules.mjs';
import { ensureTagSystemJournal } from '../data/journal-tag-system.mjs';
import { SYSTEM_ID } from '../constants.mjs';

export async function runGMWorldSetup() {
  // 0. Ensure default background RollTables (Tables 11, 12, 13) and Tag System Journal exist in the world
  await ensureBackgroundTables();
  await ensureTagSystemJournal();

  const MacroDocClass = CONFIG.Macro?.documentClass
    ?? globalThis.foundry?.documents?.Macro
    ?? globalThis.Macro;

  // 1. Ensure default macros exist in world with Observer ownership (default: 2) so all users can execute them
  if (game.macros && MacroDocClass) {
    for (const mData of COG_MACROS) {
      const existing = game.macros.find ? game.macros.find(m => m.flags?.[SYSTEM_ID]?.macroKey === mData.flags?.[SYSTEM_ID]?.macroKey || m.name === mData.name) : null;
      if (!existing) {
        try {
          await MacroDocClass.create({
            name: mData.name,
            type: mData.type,
            img: mData.img,
            command: mData.command,
            scope: mData.scope || 'global',
            ownership: { default: 2 },
            flags: mData.flags || {}
          });
        } catch (err) {
          console.warn(`Sprinter RPG | Could not create world macro "${mData.name}":`, err);
        }
      } else {
        // A world macro carrying the system macroKey follows the code: stale command/img are rewritten.
        // A GM's own macro that merely shares the name has no matching key and is left alone.
        const key = mData.flags?.[SYSTEM_ID]?.macroKey;
        const isSystemMacro = !!key && existing.flags?.[SYSTEM_ID]?.macroKey === key;
        const changes = {};
        if (isSystemMacro && existing.command !== mData.command) changes.command = mData.command;
        if (isSystemMacro && existing.img !== mData.img) changes.img = mData.img;
        if (existing.ownership && existing.ownership.default < 2) changes['ownership.default'] = 2;
        if (Object.keys(changes).length) {
          try {
            await existing.update(changes);
          } catch (err) {
            console.warn(`Sprinter RPG | Could not update world macro "${mData.name}":`, err);
          }
        }
      }
    }
  }

  // 2. Ensure standard players have permissions to create crawlers, place tokens, and upload assets
  await ensurePlayerRolePermissions();

  // 3. Mobs must stay Hostile even when the world's default token configuration says Friendly
  await ensureMobTokenDisposition();
}

/**
 * Foundry v14's world setting `core.prototypeTokenOverrides` is re-applied every time a prototype
 * token loads, so it beats whatever disposition the mob data or `_preCreate` stored. New worlds ship
 * with a base disposition of Friendly, which filed mobs under the Crawler phase. Pin the `mob`
 * type to Hostile unless the GM already chose a disposition for mobs.
 * @returns {Promise<boolean>} True if the setting was updated
 */
export async function ensureMobTokenDisposition() {
  if (!globalThis.game?.settings) return false;
  let current;
  try {
    current = game.settings.get('core', 'prototypeTokenOverrides');
  } catch (err) {
    console.warn('Sprinter RPG | Could not read the default token configuration:', err);
    return false;
  }
  const plain = typeof current?.toObject === 'function' ? current.toObject() : current;
  const clone = JSON.parse(JSON.stringify(plain ?? {}));
  const existing = clone.mob?.disposition;
  if (existing !== undefined && existing !== null) return false;
  clone.mob = { ...(clone.mob ?? {}), disposition: globalThis.CONST?.TOKEN_DISPOSITIONS?.HOSTILE ?? -1 };
  try {
    await game.settings.set('core', 'prototypeTokenOverrides', clone);
    return true;
  } catch (err) {
    console.warn('Sprinter RPG | Could not pin mob token disposition to Hostile:', err);
    return false;
  }
}

export const REQUIRED_PLAYER_PERMISSIONS = [
  'ACTOR_CREATE',
  'TOKEN_CREATE',
  'REGION_CREATE',
  'FILES_UPLOAD',
  'FILES_BROWSE'
];

/**
 * Automatically configures world role permissions so standard players can
 * create crawlers, upload portrait/token artwork, and place tokens on scenes.
 * Runs on GM login via runGMWorldSetup.
 * @returns {Promise<boolean>} True if permissions were updated, false if already configured
 */
export async function ensurePlayerRolePermissions() {
  if (!globalThis.game?.settings) return false;
  let currentPermissions;
  try {
    currentPermissions = game.settings.get('core', 'permissions') ?? {};
  } catch (err) {
    console.warn('Sprinter RPG | Could not read core permissions setting:', err);
    return false;
  }

  const playerRole = globalThis.CONST?.USER_ROLES?.PLAYER ?? 1;
  const clone = globalThis.foundry?.utils?.deepClone
    ? foundry.utils.deepClone(currentPermissions)
    : JSON.parse(JSON.stringify(currentPermissions));
  let modified = false;

  for (const perm of REQUIRED_PLAYER_PERMISSIONS) {
    const roles = Array.isArray(clone[perm]) ? [...clone[perm]] : [];
    if (!roles.includes(playerRole)) {
      roles.push(playerRole);
      clone[perm] = roles;
      modified = true;
    }
  }

  if (modified) {
    try {
      await game.settings.set('core', 'permissions', clone);
      console.log(`Sprinter RPG | Auto-configured player role permissions (${REQUIRED_PLAYER_PERMISSIONS.join(', ')}).`);
      return true;
    } catch (err) {
      console.warn('Sprinter RPG | Failed to save core permissions setting:', err);
      return false;
    }
  }

  return false;
}

