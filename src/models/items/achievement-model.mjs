import { BaseItemDataModel } from './base-item-model.mjs';

/**
 * Data Model for Sprinter RPG Achievement Items.
 */
export class AchievementDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      quote: new fields.StringField({ initial: '' }),
      reward: new fields.StringField({ initial: '' }),
      rewardContents: new fields.StringField({ initial: '' }),
      category: new fields.StringField({ initial: '' }),
      tier: new fields.StringField({ initial: 'bronze' }),
      floor: new fields.StringField({ initial: '1st Floor' }),
      dateEarned: new fields.StringField({ initial: '' }),
      session: new fields.StringField({ initial: '' }),
      // The boxes this achievement pays out (7.3a, 7.3 D2). A tier alone is the generic tier box; a uuid or identifier points
      // at a GM-made template box. `name` is a display snapshot of the template. `reward` stays the human label.
      rewardBoxes: new fields.ArrayField(new fields.SchemaField({
        tier: new fields.StringField({ initial: 'bronze' }),
        quantity: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
        uuid: new fields.StringField({ initial: '' }),
        identifier: new fields.StringField({ initial: '' }),
        name: new fields.StringField({ initial: '' })
      }), { initial: [] }),
      favor: new fields.NumberField({ integer: true, initial: 0 }),
      xp: new fields.NumberField({ integer: true, initial: 0 }),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}
