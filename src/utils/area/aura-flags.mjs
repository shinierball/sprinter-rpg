/**
 * The flags that tie an effect or a region to the aura (or zone) item that made it. Effect items carry the source
 * item's UUID (`auraSourceUuid`), the condition ref a pulse inflicted (`auraDebuffRef`) and the source's name
 * (`sourceAura`); an aura's regions carry `isAura` and the same UUID. This module owns those words.
 */
import { readFlag, withFlags, writeFlag } from '../flags.mjs';

const SOURCE_UUID = 'auraSourceUuid';
const DEBUFF_REF = 'auraDebuffRef';
const SOURCE_NAME = 'sourceAura';
const IS_AURA = 'isAura';

/** The UUID of the aura or zone item that made this effect item or region (empty when it was not made by one). */
export const auraSourceUuidOf = (doc) => readFlag(doc, SOURCE_UUID);

/** The condition ref a pulse inflicted this debuff for. */
const auraDebuffRefOf = (doc) => readFlag(doc, DEBUFF_REF);

/** The name of the aura that granted this effect item. */
export const sourceAuraOf = (doc) => readFlag(doc, SOURCE_NAME);

/** Whether this region is one of an aura's regions. */
export const isAuraRegion = (region) => Boolean(readFlag(region, IS_AURA));

/** Whether `doc` was made by the aura item `uuid` (an empty `uuid` matches nothing). */
export const madeByAura = (doc, uuid) => Boolean(uuid) && auraSourceUuidOf(doc) === uuid;

/** Whether `doc` was made by the aura item `uuid` for the condition ref `ref`. */
export const madeByAuraFor = (doc, uuid, ref) => auraSourceUuidOf(doc) === uuid && auraDebuffRefOf(doc) === ref;

/**
 * Item creation data stamped as an aura's effect: its source UUID and name, and the condition ref for a debuff.
 * @param {object} data item creation data
 * @param {{ uuid?: string, name?: string }} item the aura item
 * @param {{ debuffRef?: string }} [opts]
 */
export function withAuraStamp(data, item, { debuffRef } = {}) {
  return withFlags(data, {
    [SOURCE_UUID]: item?.uuid || '',
    ...(debuffRef === undefined ? {} : { [DEBUFF_REF]: debuffRef }),
    [SOURCE_NAME]: item?.name
  });
}

/** Stamp an existing effect item as made by `item` for the condition ref `ref` (a document without `setFlag` is left alone). */
export async function stampAuraDebuff(doc, item, ref) {
  await writeFlag(doc, SOURCE_UUID, item.uuid || '');
  await writeFlag(doc, DEBUFF_REF, ref);
}

/** The flags an aura's regions carry beside the area flag (`ctx.flags` of `buildAreaRegions`). */
export const auraRegionFlags = (auraUuid) => ({ [SOURCE_UUID]: auraUuid || '', [IS_AURA]: true });
