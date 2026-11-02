import { BaseItemDataModel } from './base-item-model.mjs';

/**
 * Data Model for Sprinter RPG Achievement Items.
 */
export class AchievementDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      quote: new fields.HTMLField({ initial: '' }),
      reward: new fields.StringField({ initial: '' }),
      rewardContents: new fields.HTMLField({ initial: '' }),
      category: new fields.StringField({ initial: '' }),
      tier: new fields.StringField({ initial: 'bronze' }),
      floor: new fields.StringField({ initial: '1st Floor' }),
      dateEarned: new fields.StringField({ initial: '' }),
      session: new fields.StringField({ initial: '' }),
      favor: new fields.NumberField({ integer: true, initial: 0 }),
      xp: new fields.NumberField({ integer: true, initial: 0 }),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}
