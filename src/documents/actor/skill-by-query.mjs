/**
 * The skill an actor rolls for a purpose a tag query names (driving a vehicle, taming a pet): found by tags, never by name.
 */
import { getItemAllTags } from '../active-tags.mjs';
import { skillStandInByQuery } from '../../utils/skill/skill-stand-in.mjs';
import { pickOperateSkill } from '../../data/rules/vehicle-rules.mjs';

/** The skill items of an actor as `pickOperateSkill` entries: tags and Modified Rank. */
function skillEntries(actor) {
  const items = Array.from(actor?.items ?? []).filter((i) => i?.type === 'skill');
  return items.map((item) => ({
    item,
    tags: [...getItemAllTags(item)],
    rank: Number(item.modifiedRank ?? item.system?.modifiedRank ?? item.system?.rank) || 0
  }));
}

/**
 * Among the actor's skills whose tags match the query, the highest Modified Rank; none owned gives the untrained stand-in of
 * the first catalog skill that matches. Null when nothing matches (the caller rolls a stat check or nothing).
 * @param {Actor} actor
 * @param {object|string|null} query a tag query
 * @returns {object|null} an owned skill item or a stand-in
 */
export function skillByQuery(actor, query) {
  const picked = pickOperateSkill(skillEntries(actor), query);
  if (picked?.item) return picked.item;
  return skillStandInByQuery(actor, query);
}
