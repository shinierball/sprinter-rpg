import { rankFromPoints, rankPoints } from '../../data/rules/space-rank-rules.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { resolveSpace, spaceLinksCrawler, worldSpaces } from './personal-space-links.mjs';

/** The uuids a space lists as joined (strings only, no duplicates). */
export function joinedLinks(space) {
  const raw = space?.system?.joinedToUuids;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(uuid => String(firstScalar(uuid, '')).trim()).filter(Boolean))];
}

const keyOf = (space) => space?.uuid ?? space?.id ?? space;

/**
 * The connected spaces of `space` (itself included): the walk follows `joinedToUuids` in both directions over the
 * world's personal spaces, with a seen-set, so a cycle ends and a space already in the group is counted once. A uuid that
 * no longer resolves is skipped and listed in `missing`. Members are in a stable order (name, then uuid); `points` is
 * the sum of each member's rank points and `rank` the highest rank those points reach. Never run from `prepareDerivedData`.
 * @param {Actor} space
 * @returns {{ members: Actor[], points: number, rank: number, missing: string[] }}
 */
export function spaceGroup(space) {
  if (!space) return { members: [], points: 0, rank: 0, missing: [] };
  const world = worldSpaces();
  const byUuid = new Map(world.map(s => [s.uuid, s]));
  const seen = new Map([[keyOf(space), space]]);
  const missing = new Set();
  const queue = [space];
  while (queue.length) {
    const current = queue.shift();
    const next = [];
    for (const uuid of joinedLinks(current)) {
      const found = byUuid.get(uuid) ?? resolveSpace(uuid);
      if (found) next.push(found);
      else missing.add(uuid);
    }
    if (current.uuid) next.push(...world.filter(other => joinedLinks(other).includes(current.uuid)));
    for (const found of next) {
      if (seen.has(keyOf(found))) continue;
      seen.set(keyOf(found), found);
      queue.push(found);
    }
  }
  const members = [...seen.values()].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')) || String(a.uuid ?? '').localeCompare(String(b.uuid ?? '')));
  const points = members.reduce((sum, member) => sum + rankPoints(Number(member.system?.rank) || 0), 0);
  return { members, points, rank: rankFromPoints(points), missing: [...missing].sort() };
}

/**
 * Every space_upgrade with `purchased !== false` across the group (tables, studios, attachments, training rooms).
 * @param {Actor} space
 * @returns {Item[]}
 */
export function spaceGroupFurniture(space) {
  return spaceGroup(space).members.flatMap(member => Array.from(member?.items ?? []))
    .filter(item => item?.type === 'space_upgrade' && item.system?.purchased !== false);
}

/**
 * Whether `crawler` is the owner or an occupant of any member of the group. This is the link check for everything the
 * group shares (tables, studios, training rooms); the stash stays per space (`spaceLinksCrawler`).
 * @param {Actor} space
 * @param {Actor} crawler
 * @returns {boolean}
 */
export function groupLinksCrawler(space, crawler) {
  return spaceGroup(space).members.some(member => spaceLinksCrawler(member, crawler));
}
