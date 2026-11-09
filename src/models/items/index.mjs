import { SkillDataModel } from './skill-model.mjs';
import { AttackDataModel } from './attack-model.mjs';
import { SpellDataModel } from './spell-model.mjs';
import { GearDataModel } from './gear-model.mjs';
import { BuffDataModel } from './buff-model.mjs';
import { DebuffDataModel } from './debuff-model.mjs';
import { LootDataModel } from './loot-model.mjs';
import { AchievementDataModel } from './achievement-model.mjs';
import { RaceDataModel, ClassDataModel, DeityDataModel, SponsorDataModel } from './lore-model.mjs';
import { SpaceUpgradeDataModel } from './space-upgrade-model.mjs';

export const ITEM_DATA_MODELS = {
  skill: SkillDataModel,
  attack: AttackDataModel,
  spell: SpellDataModel,
  gear: GearDataModel,
  buff: BuffDataModel,
  debuff: DebuffDataModel,
  loot: LootDataModel,
  achievement: AchievementDataModel,
  race: RaceDataModel,
  class: ClassDataModel,
  deity: DeityDataModel,
  sponsor: SponsorDataModel,
  space_upgrade: SpaceUpgradeDataModel
};
