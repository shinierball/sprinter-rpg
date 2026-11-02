/** Precomputed context for the shared On Hit partial (templates/items/parts/on-hit.hbs). */
import { hasOnHitEffect } from '../../utils/on-hit.mjs';
import { buildQueryView } from './context-query.mjs';
import { buildPickList, identifierEntries } from './context-pick-list.mjs';
import { ON_HIT_MODES } from '../../models/items/base-item-model.mjs';
import { EVADE_FAIL_DEGREES } from '../../utils/evade-degrees.mjs';

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const DEGREE_KEYS = Object.freeze({ fail: 'Fail', major_fail: 'MajorFail', critical_fail: 'CriticalFail' });
const MODE_KEYS = Object.freeze({ all: 'ModeAll', pickOne: 'ModePickOne' });

const options = (values, labelOf, selected) => values.map((value) => ({ value, label: loc(labelOf(value)), selected: value === selected }));
const modeOptions = (selected) => options(ON_HIT_MODES, (m) => `COG.OnHitRiders.${MODE_KEYS[m]}`, selected);
const knownOr = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/**
 * The On Hit rider picker (3.48-4b): one pick list over the three debuff lists, plus the Evade degree, the slot
 * threshold and a mode select per list.
 */
export function buildOnHitDebuffPicker(block, availableDebuffs) {
  const entries = identifierEntries(availableDebuffs);
  const evade = block.evadeFail ?? {};
  const slot = block.slotLoss ?? {};
  const degree = knownOr(evade.degree, EVADE_FAIL_DEGREES, 'major_fail');
  return {
    picker: buildPickList({
      label: loc('COG.OnHitRiders.Label'),
      icon: 'fa-skull',
      emptyText: loc('COG.OnHitRiders.Empty'),
      choose: loc('COG.OnHitRiders.Choose'),
      placeholder: loc('COG.OnHitRiders.Placeholder'),
      lists: [
        { list: 'onHitDebuffs', badge: 'HIT', stored: block.debuffs, entries, groupLabel: loc('COG.OnHitRiders.GroupHit'), customLabel: loc('COG.OnHitRiders.ButtonHit') },
        { list: 'evadeFailDebuffs', badge: 'EVADE', stored: evade.debuffs, entries, groupLabel: loc(`COG.OnHitRiders.GroupEvade${DEGREE_KEYS[degree]}`), customLabel: loc('COG.OnHitRiders.ButtonEvade') },
        { list: 'slotLossDebuffs', badge: 'SLOT', stored: slot.debuffs, entries, groupLabel: loc('COG.OnHitRiders.GroupSlotLoss'), customLabel: loc('COG.OnHitRiders.ButtonSlot') }
      ]
    }),
    degreeOptions: options(EVADE_FAIL_DEGREES, (d) => `COG.OnHitRiders.Degree${DEGREE_KEYS[d]}`, degree),
    minSlotsLost: Math.max(1, Number(slot.minSlotsLost) || 1),
    hitModeOptions: modeOptions(knownOr(block.debuffMode, ON_HIT_MODES, 'all')),
    evadeModeOptions: modeOptions(knownOr(evade.mode, ON_HIT_MODES, 'all')),
    slotModeOptions: modeOptions(knownOr(slot.mode, ON_HIT_MODES, 'all'))
  };
}

const RANK_NOTES = Object.freeze({
  attack: 'Judged at the Rank of the weapon skill that matches this attack (0 = always).',
  gear: 'Judged at the Rank of the weapon skill that matches this weapon (0 = always). Persistent Debuffs apply to the wielder; this applies to the target.',
  skill: 'Judged at this skill\'s Rank (0 = always).',
  spell: 'Judged at this spell\'s Rank (0 = always).'
});

const QUERY_BUCKETS = Object.freeze(['all', 'any', 'none']);

/** @param {object} context the item sheet context; `context.item.type` and `context.availableDebuffs` are set */
export function buildOnHitContext(context) {
  const block = context.system?.onHit ?? {};
  const steal = block.lifesteal ?? {};
  const purge = block.dispel ?? {};
  context.onHit = {
    configured: hasOnHitEffect(context.system),
    debuffMinRank: Number(block.debuffMinRank) || 0,
    rankNote: RANK_NOTES[context.item?.type] ?? '',
    lifesteal: {
      minRank: Number(steal.minRank) || 0,
      minSlotsLost: Math.max(1, Number(steal.minSlotsLost) || 1),
      heal: Number(steal.heal) || 0
    },
    dispel: {
      enabled: purge.enabled === true,
      minRank: Number(purge.minRank) || 0,
      count: Number(purge.count) || 0
    },
    dispelQuery: buildQueryView(purge.query, 'system.onHit.dispel.query', QUERY_BUCKETS),
    debuffPicker: buildOnHitDebuffPicker(block, context.availableDebuffs)
  };
}
