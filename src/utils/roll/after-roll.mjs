/**
 * src/utils/roll/after-roll.mjs
 * The offers a finished check makes (3.44d): `checkModifiers` rows of the `reroll` and `degreeShift` kinds (stage
 * `afterRoll`, 3.44c) that match the card's context. Pure of Foundry globals: the caller passes the roller, the card's
 * context and the vehicle's sources; nothing is clicked or written here.
 *
 * An offer names the row (`rowKey`, from `evaluateRows`), the item that carries it (for the cooldown gate) and, for a
 * shift, how far it moves a degree. A shift that would change nothing (the degree is not a Fail, or it cannot move
 * further) is not offered.
 */
import { evaluateRows } from './damage-modifiers.mjs';
import { applyRowKind, getRowKind } from '../row-kinds.mjs';
import { shiftDegree } from '../../data/rules/vehicle-rules.mjs';

/**
 * @typedef {object} AfterRollOffer
 * @property {'reroll'|'degreeShift'} kind
 * @property {string} rowKey      the row's key (`rowKeyOf`): stable for this source and row index
 * @property {string} label       the row's label, else its source's name
 * @property {number} [steps]     degreeShift: how far
 * @property {boolean} [failOnly] degreeShift: only a Fail degree moves
 * @property {string} sourceName
 * @property {string} itemUuid    the carrying item's uuid ('' for a synthetic source)
 * @property {string} itemId
 */

/**
 * The after-roll offers of a card.
 * @param {object} actor the roller
 * @param {object} context the card's RollContext, with its outcome tags (`extendContext(ctx, { tags })`)
 * @param {object} [opts]
 * @param {object[]} [opts.extraSources] the vehicle's active sources
 * @param {string} [opts.outcome] the card's degree after any shifts: a shift that cannot change it is dropped
 * @param {Iterable<string>} [opts.used] row keys already spent on this card
 * @returns {AfterRollOffer[]}
 */
export function afterRollOffers(actor, context, { extraSources = [], outcome = '', used = [] } = {}) {
  const out = [];
  const matched = evaluateRows(actor, 'checkModifiers', context, { extraSources, skip: used });
  for (const { source, row, scale, key } of matched) {
    const def = getRowKind('checkModifiers', row.kind);
    if (!def?.apply?.afterRoll) continue;
    const acc = { offers: [] };
    const label = row.label || source.name || 'After-roll';
    applyRowKind('checkModifiers', def, 'afterRoll', acc, row, { actor, source, scale, context, label });
    for (const offer of acc.offers) {
      if (offer.kind === 'degreeShift' && outcome && shiftDegree(outcome, offer.steps, { failOnly: offer.failOnly }) === outcome) continue;
      const { source: src, ...rest } = offer;
      out.push({
        ...rest,
        rowKey: key,
        sourceName: String(src?.name ?? ''),
        itemUuid: String(src?.uuid ?? ''),
        itemId: String(src?.id ?? src?._id ?? '')
      });
    }
  }
  return out;
}

/** The offer of `rowKey` among a list, or null. */
export const offerByKey = (offers, rowKey) => offers.find((o) => o.rowKey === rowKey) ?? null;
