/** The Identity stage: name, level, design floor, size, boss tier, the three role boxes and the actor's tags. */
import { buildPickList } from '../../../sheets/item/context-pick-list.mjs';
import { tagPickerOptions } from '../../../sheets/item/row-host.mjs';
import { isDerivedActorTag } from '../../../utils/tag/actor-tag-permissions.mjs';
import { bossTierRegistry } from '../../../data/mob-creation-rules.mjs';
import { sizeOptions } from '../../../data/sizes.mjs';
import { TAG_LIST } from './pick-lists.mjs';
import { OTHER_CREATURE_TYPE, creatureTypeOptions } from '../../../data/mob-creator/draft.mjs';
import { tr } from '../words.mjs';

const TAGS = 'COG.MobCreator.Identity.Tags';

/** The registered boss tiers: `[id, definition]`. */
const tierEntries = () => Object.entries(bossTierRegistry()).filter(([, def]) => def?.boss !== false);

/** The tag pick list: chips of the stored tags, and an Add select grouped by namespace (the tags a tier or the type derive are left out). */
function tagPicker(draft, rootId) {
  const picked = new Set(draft.spec.tags.map((t) => t.toLowerCase()));
  const entries = [];
  const groups = [];
  for (const group of tagPickerOptions()) {
    const tags = group.tags.filter((t) => !isDerivedActorTag(t.id));
    for (const t of tags) entries.push({ value: t.id, label: t.label });
    const options = tags.filter((t) => !picked.has(t.id.toLowerCase())).map((t) => ({ list: TAG_LIST, value: t.id, label: t.label }));
    if (options.length) groups.push({ label: group.label, options });
  }
  const picker = buildPickList({
    label: tr(`${TAGS}.Label`), icon: 'fa-tags', emptyText: tr(`${TAGS}.Empty`), choose: tr(`${TAGS}.Choose`),
    placeholder: tr(`${TAGS}.Placeholder`), inputId: `${rootId}-actor-tags-custom`,
    lists: [{ list: TAG_LIST, stored: draft.spec.tags, entries, customLabel: tr(`${TAGS}.Add`) }]
  });
  return { ...picker, groups };
}

/** The creature type select: the registered types, then Other (the type is typed text). */
function creatureTypeSelect(draft) {
  const current = draft.creatureTypeTag.toLowerCase();
  return [
    ...creatureTypeOptions().map((o) => ({ value: o.id, label: o.label, selected: o.id === current })),
    { value: OTHER_CREATURE_TYPE, label: tr('COG.MobCreator.CreatureType.Other'), selected: !current }
  ];
}

export const IDENTITY_STAGE = Object.freeze({
  id: 'identity',
  /** @param {import('../../../data/mob-creator/draft.mjs').MobDraft} draft */
  context(draft, { rootId }) {
    const { spec } = draft;
    const tiers = tierEntries();
    return {
      rootId,
      spec,
      creatureTypeOptions: creatureTypeSelect(draft),
      typedCreatureType: !draft.creatureTypeTag,
      sizeOptions: sizeOptions(spec.size),
      tierOptions: [
        { value: 'none', label: tr('COG.MobCreator.Identity.TierNone'), selected: !draft.isBoss },
        ...tiers.map(([id, def]) => ({
          value: id,
          label: tr('COG.MobCreator.Identity.TierOption', { label: def.label, points: def.statsPerLevel, bars: def.hbBase }),
          selected: spec.bossTier === id
        }))
      ],
      tierHelp: tr('COG.MobCreator.Identity.TierHelp', { tiers: tiers.map(([, def]) => `${def.label} ${def.statsPerLevel}`).join(', ') }),
      isBoss: draft.isBoss,
      tagPicker: tagPicker(draft, rootId)
    };
  },
  actions: {
    /** The creature type select: a `creature.*` tag id or Other. */
    async setCreatureType(event, target) {
      if (!this.draft.setCreatureType(target.value)) return;
      await this.render({ parts: this._parts() });
    }
  }
});
