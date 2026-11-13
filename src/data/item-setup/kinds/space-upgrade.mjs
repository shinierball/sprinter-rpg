/**
 * src/data/item-setup/kinds/space-upgrade.mjs
 * The space upgrade page: its name and what it is (a bonus, a training room, a crafting table or a studio), then the
 * bonus and amount or the table type that kind needs. Tier, cost and the rest stay on the sheet.
 */
import { registerSetupKind } from '../registry.mjs';
import { NAME_FIELD, nameSpec, text } from '../answers.mjs';
import { BONUS_NUMBERS } from '../../../utils/item-describer/space-upgrade-fields.mjs';
import { tableTypeOptions } from '../../../documents/actor/space-purchases.mjs';

const when = (...kinds) => Object.freeze({ field: 'kind', in: Object.freeze(kinds) });

registerSetupKind({
  id: 'space_upgrade',
  icon: 'fa-house-chimney',
  order: 140,
  createType: 'space_upgrade',
  fields: Object.freeze([
    NAME_FIELD,
    Object.freeze({ id: 'kind', type: 'choice', options: Object.freeze(['bonus', 'training', 'table', 'studio']), rerender: true }),
    Object.freeze({ id: 'bonus', type: 'choice', source: 'spaceBonuses', when: when('bonus') }),
    Object.freeze({ id: 'amount', type: 'number', when: when('bonus') }),
    Object.freeze({ id: 'tableType', type: 'choice', source: 'tableTypes', when: when('table', 'studio') })
  ]),
  start: () => ({ name: '', kind: 'bonus', bonus: BONUS_NUMBERS[0][0], amount: 1, tableType: tableTypeOptions()[0]?.tag ?? '' }),
  toSpec(answers) {
    const kind = text(answers?.kind) || 'bonus';
    const tableTypeTag = text(answers?.tableType);
    const system = {};
    if (kind === 'bonus') {
      const key = BONUS_NUMBERS.find(([id]) => id === text(answers?.bonus))?.[0];
      const amount = Math.trunc(Number(text(answers?.amount)));
      if (key) system.bonuses = { [key]: Number.isFinite(amount) ? amount : 0 };
    } else if (kind === 'training') system.training = { enabled: true };
    else if (kind === 'table') system.craftingTable = { enabled: true, tableTypeTag };
    else if (kind === 'studio') system.studio = { enabled: true, tableTypeTag };
    return { ...nameSpec(answers), system };
  }
});
