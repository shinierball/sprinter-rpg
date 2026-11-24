/**
 * The scatter line of an Attack card (core pp. 83, 200-201): a Throw or Fireball tagged `rule.scatter` whose first target
 * outcome is a fail band rolls a real 1d8 for the direction and prints where it lands. The card builders (`rollAttack`,
 * the spell attack) call `scatterRider` after the targets are judged, and post its roll with the card.
 */
import { SCATTER_DIE, scatterLine } from '../../utils/area/area-scatter.mjs';
import { reachedTierTags } from '../../utils/tag/tag-mechanics.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

/** Natural 1 with the total meeting the Difficulty: no distance, nothing to roll; the GM places it. */
const needsDie = (line) => !line.aimed && line.feet > 0;

/**
 * @param {{ tags: Iterable<string>, skill?: object|null, row: object|null|undefined }} p `tags`: the roll context's tags;
 *   `skill`: the Skill or spell whose reached Rank Upgrades may aim the throw; `row`: the first target's row
 * @returns {Promise<{ html: string, rolls: object[] }|null>} null when nothing scatters
 */
export async function scatterRider({ tags, skill = null, row }) {
  const base = { tags, reachedTierTags: skill ? reachedTierTags(skill) : [], outcomeId: row?.outcomeId, diff: row?.diff };
  const first = scatterLine(base);
  if (!first) return null;
  let line = first;
  const rolls = [];
  if (needsDie(first)) {
    const die = await new Roll(SCATTER_DIE).evaluate();
    rolls.push(die);
    line = scatterLine({ ...base, d8: die.total });
  }
  const html = `<div class="cog-scatter-line" style="margin-top: 6px; font-size: 11px;"><i class="fa-solid fa-location-crosshairs"></i> ${escapeAttr(line.text)}</div>`;
  return { html, rolls };
}
