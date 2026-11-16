/**
 * Stored-data migration: tag ids moved or merged (`tag-rename-map.mjs`). Release 8.0.0 stored the old ids on items and actors
 * (`system.tags`, grant rows that name a tag, row conditions, requirement queries and `where`s, with the `self.`, `subject.`
 * and `attacker.` role prefixes), in the copies a race, class or deity keeps of its buffs and debuffs, and in three world
 * settings. A tag id is a whole string wherever it is stored, so the conversion walks the stored data and renames a string
 * that is exactly an old id (or a role-prefixed one), never a longer id that starts like it. A list that holds both a twin and
 * its survivor keeps the survivor's place and drops the twin; an object keyed by an old id moves the key, the new key winning
 * when both exist. Registered at import (`tag-catalog.mjs`, which owns the ids, imports this file).
 */
import { registerMigration } from '../utils/migrations/registry.mjs';
import { TAG_RENAME_MAP } from './tag-rename-map.mjs';

const ROLE_PREFIXES = ['self.', 'subject.', 'attacker.'];

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The new spelling of a stored string, or null when it is not an old id (role prefix allowed, nothing longer). */
function renamedString(text) {
  const role = ROLE_PREFIXES.find((prefix) => text.startsWith(prefix)) ?? '';
  const bare = role ? text.slice(role.length) : text;
  return Object.hasOwn(TAG_RENAME_MAP, bare) ? role + TAG_RENAME_MAP[bare] : null;
}

/**
 * Rename every old tag id inside a stored value. Returns the value itself when nothing in it changes, so a caller can tell.
 * @param {*} value
 * @returns {*}
 */
function renameDeep(value) {
  if (typeof value === 'string') return renamedString(value) ?? value;
  if (Array.isArray(value)) {
    const items = value.map(renameDeep);
    const renamed = items.map((item, at) => item !== value[at]);
    if (!renamed.some(Boolean)) return value;
    // A renamed string that now repeats one the list already holds is the twin of a survivor: drop it, keep the survivor.
    const kept = items.filter((item, at) => !(renamed[at] && typeof item === 'string'
      && items.some((other, otherAt) => otherAt !== at && other === item && (!renamed[otherAt] || otherAt < at))));
    return kept;
  }
  if (isRecord(value)) {
    let changed = false;
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      const newKey = renamedString(key) ?? key;
      const newValue = renameDeep(inner);
      if (newKey !== key || newValue !== inner) changed = true;
      // The new key wins when the object holds both the old key and the new one.
      if (newKey !== key && Object.hasOwn(value, newKey)) continue;
      out[newKey] = newValue;
    }
    return changed ? out : value;
  }
  return value;
}

/** A setting value converted, or the value itself when it holds no old id (the runner skips an unchanged one). */
const renameSetting = (value) => ({ value: renameDeep(value) });

registerMigration({
  id: 'rename-tag-ids',
  release: '8.1.0',
  covers: [
    'tag:rule.store_discount', 'tag:rule.kill_bounty', 'tag:rule.flight_limited', 'tag:rule.no_breath', 'tag:rule.limb_regeneration',
    'tag:rule.immunity_disease', 'tag:rule.causes-darkness', 'tag:rule.depletes-on-empty', 'tag:rule.climb', 'tag:rule.offset-disadvantage',
    'tag:rule.mind-control', 'tag:rule.summon', 'tag:rule.barrier', 'tag:rule.flight', 'tag:rule.latch', 'tag:rule.extra-attack',
    'tag:rule.disadvantage', 'tag:rule.pet-skill', 'tag:rule.taunt', 'tag:shape.aura', 'tag:action.ignore_dr', 'tag:action.opposed',
    'tag:rule.mounted_only', 'tag:resource.hp-bars', 'tag:resource.temp-bars'
  ],
  documents: {
    Item: (source) => renameDeep(source),
    Actor: (source) => renameDeep(source)
  },
  settings: {
    tagOverrides: renameSetting,
    customTags: renameSetting,
    pendingSecrets: renameSetting
  }
});
