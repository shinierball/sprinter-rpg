/**
 * src/data/item-setup/kinds/achievement.mjs
 * The achievement page: its name, trophy tier, how it is earned and the loot box it pays. The box starts at the trophy's own
 * tier and follows it until the GM picks a box (or "No box") themselves.
 */
import { registerSetupKind } from '../registry.mjs';
import { NAME_FIELD, nameSpec, text, followedChoice } from '../answers.mjs';
import { lootBoxTierOptions } from '../../loot-box-tiers.mjs';
import { paragraphsHtml } from '../../../sourcery/text.mjs';

const REWARD_BOX = Object.freeze({ id: 'rewardBox', type: 'choice', source: 'lootBoxTiers', blank: 'COG.ItemSetup.Kind.achievement.rewardBox.None', follows: 'tier' });

registerSetupKind({
  id: 'achievement',
  icon: 'fa-trophy',
  order: 120,
  createType: 'achievement',
  fields: Object.freeze([
    NAME_FIELD,
    Object.freeze({ id: 'tier', type: 'choice', source: 'achievementTiers', rerender: true }),
    Object.freeze({ id: 'earnedBy', type: 'textarea' }),
    REWARD_BOX
  ]),
  start: () => ({ name: '', tier: 'bronze', earnedBy: '', rewardBox: null }),
  toSpec(answers) {
    const box = followedChoice(REWARD_BOX, answers, lootBoxTierOptions().map((o) => o.key));
    return {
      ...nameSpec(answers),
      system: {
        tier: text(answers?.tier) || 'bronze',
        description: paragraphsHtml(answers?.earnedBy),
        rewardBoxes: box ? [{ tier: box, quantity: 1 }] : []
      }
    };
  }
});
