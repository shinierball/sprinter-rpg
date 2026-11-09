/**
 * Who may edit an actor's `system.tags` on a live sheet.
 * The GM may add or remove any tag the sheet does not derive. An owner may add or remove tags in namespaces the
 * registry flags `identity` (seed `creature`). Derived tags (`kind.*`, `mob.boss`, `mob.tier.*`) are never edited
 * here: the type, the registry and the boss tier select write them. A refusal is a permission, not a rule break.
 */
import { isIdentityTag } from '../../data/tag-vocabulary.mjs';
import { MOB_TIER_PREFIX } from './tag-mechanics.mjs';
import { MOB_BOSS_TAG } from '../../data/tag-vocabulary.mjs';

/** True for a tag the engine derives (or a dedicated control writes), so the tag pill editor never edits it. */
export function isDerivedActorTag(tagId) {
  const id = typeof tagId === 'string' ? tagId.trim() : '';
  return id.startsWith('kind.') || id === MOB_BOSS_TAG || id.startsWith(MOB_TIER_PREFIX);
}

/**
 * Whether the current user may add or remove `tagId` on `actor`.
 * @param {object|null} actor
 * @param {string} tagId
 * @param {{ isGM?: boolean }} [user] defaults to `game.user`
 * @returns {{ ok: boolean, reason?: 'derived'|'gmOnly'|'notOwner' }}
 */
export function actorTagEditVerdict(actor, tagId, user = globalThis.game?.user) {
  if (isDerivedActorTag(tagId)) return { ok: false, reason: 'derived' };
  if (user?.isGM) return { ok: true };
  if (!actor?.isOwner) return { ok: false, reason: 'notOwner' };
  return isIdentityTag(tagId) ? { ok: true } : { ok: false, reason: 'gmOnly' };
}
