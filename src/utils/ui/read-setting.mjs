import { SYSTEM_ID } from '../../constants.mjs';

/** One of this system's world or client settings, or undefined when the key is not registered (or there is no game). */
export function readSetting(key) {
  try {
    return globalThis.game?.settings?.get?.(SYSTEM_ID, key);
  } catch {
    return undefined;
  }
}
