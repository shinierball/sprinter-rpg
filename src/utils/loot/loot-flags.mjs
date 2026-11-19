/**
 * The flags a loot box leaves on documents: `lootBox` (provenance on every prize), `lootBoxPreroll` (the box a pre-rolled
 * world item was made for), `magicItem` (the generator record on a rolled item), `lootBoxOpen` (the ceremony card's data)
 * and `lootBoxGmNote` (the GM's whispered note). This module owns those words.
 */
import { readFlag, withFlags } from '../flags.mjs';

const LOOT_BOX = 'lootBox';
const LOOT_BOX_PREROLL = 'lootBoxPreroll';
const MAGIC_ITEM = 'magicItem';
const LOOT_BOX_OPEN = 'lootBoxOpen';
const LOOT_BOX_GM_NOTE = 'lootBoxGmNote';

/** `{ tier, boxName, openedAt }` on a prize an opened box made (undefined when it has none). */
export const lootBoxOf = (doc) => readFlag(doc, LOOT_BOX);

/** Creation data of a prize stamped with the box it came from (a copy). */
export const withLootBox = (data, record) => withFlags(data, { [LOOT_BOX]: record });

/** `{ boxUuid, boxName, at, by }` on a world item pre-rolled or chosen for a box (undefined when it has none). */
export const prerollOf = (doc) => readFlag(doc, LOOT_BOX_PREROLL);

/** Creation data of a pre-rolled prize stamped with the box it was made for (a copy). */
export const withPreroll = (data, record) => withFlags(data, { [LOOT_BOX_PREROLL]: record });

/** `{ generator, tier, rolls, missed }` on an item the magic item generator made (undefined when it has none). */
export const magicItemOf = (doc) => readFlag(doc, MAGIC_ITEM);

/** Creation data of a generated item stamped with its generator record (a copy). */
export const withMagicItem = (data, record) => withFlags(data, { [MAGIC_ITEM]: record });

/** The ceremony card's data on a chat message (undefined when it has none). */
export const lootBoxOpenOf = (message) => readFlag(message, LOOT_BOX_OPEN);

/** The flag fragment of the ceremony card, to merge with `withFlags` beside other flags. */
export const lootBoxOpenPatch = (record) => ({ [LOOT_BOX_OPEN]: record });

/** Chat message data stamped as the GM's whispered note on an opened box (a copy). */
export const withLootBoxGmNote = (data) => withFlags(data, { [LOOT_BOX_GM_NOTE]: true });
