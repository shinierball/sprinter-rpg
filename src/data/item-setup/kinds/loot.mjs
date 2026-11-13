/**
 * src/data/item-setup/kinds/loot.mjs
 * The consumable, item or loot page: its name and what kind of item it is, then the one more answer the kinds that cannot
 * work without it need: what using a consumable does, the spell a scroll or wand holds, a wand's charges, a loot box's tier.
 * The other types (lottery ticket, blueprint, treasure, crafting material, quest item) are made by type and name; their
 * tables and recipes are filled on the sheet.
 */
import { registerSetupKind } from '../registry.mjs';
import { NAME_FIELD, nameSpec, text, wholeNumber } from '../answers.mjs';
import { LOOT_TYPE_CHOICES, LOOT_BOX_LOOT_TYPE } from '../../../models/items/loot-model.mjs';
import { DEFAULT_LOOT_BOX_TIER } from '../../loot-box-tiers.mjs';

const DEFAULT_LOOT_TYPE = LOOT_TYPE_CHOICES[0].value;
const USES = Object.freeze(['heal', 'buff', 'spell', 'none']);
const consumable = { field: 'lootType', in: ['consumable'] };
const holdsSpell = { field: 'lootType', in: ['scroll', 'wand'] };

/** The spell a scroll or wand names, with its display name from the world's spells when it is there. */
function spellKeys(identifier, resolver) {
  const id = text(identifier);
  return id ? { spellIdentifier: id, spellName: text(resolver?.find?.('spells', id)?.name) } : {};
}

registerSetupKind({
  id: 'loot',
  icon: 'fa-flask',
  order: 110,
  createType: 'loot',
  fields: Object.freeze([
    NAME_FIELD,
    Object.freeze({ id: 'lootType', type: 'choice', options: LOOT_TYPE_CHOICES, rerender: true }),
    Object.freeze({ id: 'use', type: 'choice', options: USES, rerender: true, when: consumable }),
    Object.freeze({ id: 'healBars', type: 'number', min: 1, when: [consumable, { field: 'use', in: ['heal'] }] }),
    Object.freeze({ id: 'buff', type: 'catalogPick', catalog: 'buffs', blank: 'COG.ItemSetup.Kind.loot.buff.Blank', when: [consumable, { field: 'use', in: ['buff'] }] }),
    Object.freeze({ id: 'spell', type: 'catalogPick', catalog: 'spells', blank: 'COG.ItemSetup.Kind.loot.spell.Blank', when: [consumable, { field: 'use', in: ['spell'] }] }),
    Object.freeze({ id: 'inscribed', type: 'catalogPick', catalog: 'spells', blank: 'COG.ItemSetup.Kind.loot.inscribed.Blank', when: holdsSpell }),
    Object.freeze({ id: 'charges', type: 'number', min: 1, when: { field: 'lootType', in: ['wand'] } }),
    Object.freeze({ id: 'boxTier', type: 'choice', source: 'lootBoxTiers', when: { field: 'lootType', in: [LOOT_BOX_LOOT_TYPE] } })
  ]),
  start: () => ({ name: '', lootType: DEFAULT_LOOT_TYPE, use: 'heal', healBars: 1, buff: '', spell: '', inscribed: '', charges: 1, boxTier: DEFAULT_LOOT_BOX_TIER }),
  toSpec(answers, resolver) {
    const asked = text(answers?.lootType);
    const lootType = LOOT_TYPE_CHOICES.some((choice) => choice.value === asked) ? asked : DEFAULT_LOOT_TYPE;
    const name = text(answers?.name);
    const system = { lootType };
    if (lootType === 'consumable') {
      const use = text(answers?.use);
      const healBars = wholeNumber(answers?.healBars);
      const buffIdentifier = text(answers?.buff);
      if (use === 'heal' && healBars) system.outcomes = [{ type: 'heal', name, healBars, targetType: 'self' }];
      else if (use === 'buff' && buffIdentifier) system.outcomes = [{ type: 'buff', name, buffIdentifier, targetType: 'self' }];
      else if (use === 'spell') Object.assign(system, spellKeys(answers?.spell, resolver));
    } else if (holdsSpell.in.includes(lootType)) {
      Object.assign(system, spellKeys(answers?.inscribed, resolver));
      if (lootType === 'wand') {
        const charges = wholeNumber(answers?.charges);
        system.charges = { value: charges, max: charges };
      }
    } else if (lootType === LOOT_BOX_LOOT_TYPE) {
      system.box = { tier: text(answers?.boxTier) || DEFAULT_LOOT_BOX_TIER };
    }
    return { ...nameSpec(answers), system };
  }
});
