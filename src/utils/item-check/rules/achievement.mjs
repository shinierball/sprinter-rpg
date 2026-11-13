/**
 * src/utils/item-check/rules/achievement.mjs
 * An achievement that pays no box, favor or XP gives only the trophy: a note, not a fault.
 */
import { registerItemRule, finding } from '../registry.mjs';
import { liveRows } from '../read.mjs';

registerItemRule('achievement', (item) => {
  const sys = item.system ?? {};
  const pays = liveRows(item, 'rewardBoxes').length > 0 || Number(sys.favor) > 0 || Number(sys.xp) > 0;
  return pays ? [] : [finding('achievementItem.no-reward', 'note', 'system.rewardBoxes')];
});
