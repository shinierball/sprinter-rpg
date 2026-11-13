/**
 * Boons and smites: gifts the GM hands a worshipper (core rulebook pp. 312-314). A boon is a buff, a smite a debuff, each
 * tagged `worship.boon` / `worship.smite` and carrying the `deityGift` flag that says whose it is. A boon lasts 30 hours
 * unless the GM makes it permanent ("until a Quest is completed"); the same goes for a smite. Forgiven wipes the
 * offenses and Shunned (Table 63 entry 8, p. 313).
 *
 * The GM's gift dialog is an app; this module only opens it through the opener the app registers at load (the same
 * pattern as the Loot Box showcase), so nothing below the apps layer imports an app.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { WORSHIP_TAGS } from '../../data/tag-vocabulary.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { itemIdentifier } from '../../utils/identifier.mjs';
import { deityIdOf } from '../../utils/deity/worship-state.mjs';
import { writeBond } from './worship.mjs';
import { say } from './vehicle-drive-common.mjs';

/** Table 63: a boon lasts "for 30 hours" (p. 313). */
export const BOON_DEFAULT_HOURS = 30;

/** The gift modes, the item type each makes and the tag it carries. */
const MODES = Object.freeze({
  boon: { type: 'buff', tag: WORSHIP_TAGS.boon },
  smite: { type: 'debuff', tag: WORSHIP_TAGS.smite }
});

let opener = null;

/**
 * Register the function that opens the GM's gift dialog (the dialog module calls this when it loads). Null clears it.
 * @param {((actor: object, deityItem: object, mode: 'boon'|'smite', options: { filterTag?: string }) => unknown)|null} fn
 */
export function setDeityGiftOpener(fn) {
  opener = typeof fn === 'function' ? fn : null;
}

const warn = (text) => globalThis.ui?.notifications?.warn?.(text);

/**
 * Open the gift dialog for a worshipper. GM only; anyone else gets a warning and nothing happens.
 * @param {object} actor the crawler
 * @param {object} deityItem its embedded deity item
 * @param {'boon'|'smite'} mode
 * @param {{ filterTag?: string }} [options] `filterTag` narrows the lists to items carrying that tag (e.g. `worship.divine`)
 * @returns {unknown} whatever the dialog returns, or null when nothing opened
 */
export function openDeityGift(actor, deityItem, mode, { filterTag = '' } = {}) {
  if (!globalThis.game?.user?.isGM) {
    warn(say('COG.Deity.Gift.GMOnly', 'Only the GM can grant a boon or a smite.'));
    return null;
  }
  if (!MODES[mode] || !actor || !deityItem) return null;
  if (!opener) {
    warn(say('COG.Deity.Gift.NoDialog', 'The gift dialog is not available.'));
    return null;
  }
  return opener(actor, deityItem, mode, { filterTag: String(firstScalar(filterTag, '') ?? '').trim() });
}

/**
 * Give a worshipper a boon (a buff) or a smite (a debuff). The item is embedded active (a buff) and stamped by the
 * ordinary duration code: `hours` from now (30 by default), or no end when `permanent`.
 * @param {object} actor
 * @param {object} deityItem the god the gift is of
 * @param {object} effectData item data (or an item) of a buff for a boon, a debuff for a smite
 * @param {{ mode: 'boon'|'smite', hours?: number, permanent?: boolean }} options
 * @returns {Promise<object|null>} the embedded item, or null when the data does not fit the mode
 */
export async function createDeityGift(actor, deityItem, effectData, { mode, hours, permanent = false } = {}) {
  const def = MODES[mode];
  const source = typeof effectData?.toObject === 'function' ? effectData.toObject() : effectData;
  if (!def || !actor || !source || source.type !== def.type) return null;
  const deity = deityIdOf(deityItem);
  if (!deity) return null;

  const data = structuredClone(source);
  delete data._id;
  delete data.id;
  const system = data.system ?? {};
  const key = itemIdentifier(data);
  const length = Number(firstScalar(hours, BOON_DEFAULT_HOURS));
  const amount = Number.isFinite(length) && length > 0 ? length : BOON_DEFAULT_HOURS;
  data.system = {
    ...system,
    identifier: key,
    tags: [...new Set([...(Array.isArray(system.tags) ? system.tags : []), def.tag])],
    duration: permanent ? 'Permanent' : `${amount} hours`,
    durationConfig: {
      type: permanent ? 'permanent' : 'hours', value: permanent ? 0 : amount, scaleBy: null,
      endsWithCombat: false, remainingRounds: 0, expiresAt: null
    },
    ...(def.type === 'buff' ? { active: true } : { paused: false })
  };
  data.flags = {
    ...(data.flags ?? {}),
    [SYSTEM_ID]: {
      ...(data.flags?.[SYSTEM_ID] ?? {}),
      deityGift: { deity, kind: mode, key, at: Number(globalThis.game?.time?.worldTime) || 0, by: String(globalThis.game?.user?.id ?? '') }
    }
  };
  const [created] = await actor.createEmbeddedDocuments('Item', [data]);
  return created ?? null;
}

/**
 * Forgiven (Table 63 entry 8, p. 313): the god forgives, so the offenses and the Shunned effects are wiped.
 * @param {object} _actor the crawler (the bond lives on the deity item)
 * @param {object} deityItem
 * @returns {Promise<object>} the deity item
 */
export function forgive(_actor, deityItem) {
  return writeBond(deityItem, { offenses: 0, shunned: 0 });
}
