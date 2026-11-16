/**
 * The writes behind the GM's Loot card (core pp. 22-23, 215): Misc. Junk and gold onto a crawler, a boss's Boss Box and
 * map onto a crawler. The GM runs them, so there is no relay. The box goes through `grantLootBoxes` (stacking, templates,
 * `awardedBy`); the junk through the used-form path; the map is a plain loot item `buildPayload` compiles.
 */
import { buildPayload } from '../../data/builders/item-payload.mjs';
import { SCAVENGED_JUNK_FORM } from '../../data/rules/used-forms.mjs';
import { slugifyIdentifier } from '../../utils/identifier.mjs';
import { landItems } from '../../utils/content-source.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { grantLootBoxes } from './achievement-award.mjs';
import { leaveUsedFormById } from './used-items.mjs';

/** The loot type of a map: treasure, the book's word for a find worth keeping. */
const MAP_LOOT_TYPE = 'treasure';

/**
 * Give a crawler Misc. Junk points and gold.
 * @param {Actor} actor
 * @param {{ junk?: number, gold?: number }} share whole numbers; 0 writes nothing
 */
export async function grantMobLoot(actor, { junk = 0, gold = 0 } = {}) {
  const points = Math.max(0, Math.floor(Number(junk)) || 0);
  const coins = Math.max(0, Math.floor(Number(gold)) || 0);
  if (points > 0) await leaveUsedFormById(actor, SCAVENGED_JUNK_FORM, points);
  if (coins > 0) {
    // read inside the per-actor queue so two grants to one crawler both land
    await runKeyed(`gold:${actor.uuid ?? actor.id ?? ''}`, async () => {
      const current = Number(actor.system?.currency?.gold) || 0;
      await actor.update({ 'system.currency.gold': current + coins });
    });
  }
}

/**
 * Give a crawler a boss's Boss Box and map. `map` is `{ name, tag, description }`; a GM-named map has `tag` and `description`
 * empty, so it is a plain loot item with no rule tag. Null or a blank name hands out no map.
 * @param {Actor} actor
 * @param {{ bossName: string, boxRow?: object|null, map?: { name: string, tag?: string, description?: string }|null }} p
 *   `boxRow` is a `rewardBoxes` row (`{ tier, uuid? }`; quantity 1)
 * @returns {Promise<{ boxes: Item[], map: Item|null }>}
 */
export async function grantBossRewards(actor, { bossName, boxRow = null, map = null } = {}) {
  const boxes = boxRow ? await grantLootBoxes(actor, [{ ...boxRow, quantity: 1 }], { sourceName: bossName }) : [];
  const name = String(map?.name ?? '').trim();
  let item = null;
  if (name) {
    const payload = buildPayload('loot', {
      name,
      system: {
        identifier: slugifyIdentifier(name),
        description: map.description ? `<p>${escapeAttr(map.description)}</p>` : '',
        lootType: MAP_LOOT_TYPE,
        quantity: 1,
        tags: map.tag ? [map.tag] : []
      }
    }, { warnings: [] });
    [item = null] = await actor.createEmbeddedDocuments('Item', landItems([payload]));
  }
  return { boxes, map: item };
}
