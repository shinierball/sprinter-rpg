/**
 * The "Buffs this applies" editor of a skill or spell (`system.appliedBuffs`) and the two controls a buff sheet shows
 * for being applied by one (`system.rank`, `system.repeat.mode`). Every input is a 1-to-1 schema field named by its
 * index; labels, option lists and `selected` flags are worked out here.
 */
import { identifierOptions } from '../../utils/ui/identifier-options.mjs';
import { localiseKey as loc } from '../../utils/lang-text.mjs';
import { pickOptions } from '../../utils/ui/field-options.mjs';
import { buffTargetTags, rowRecipients } from '../../utils/effects/applied-buff.mjs';
import { effectiveDuration, durationConfigText } from '../../utils/time/durations.mjs';
import { BUFF_REPEAT_MODES } from '../../models/items/buff-model.mjs';


/** What a blank "Within" means for a target: the item's own Range for one chosen creature, no limit for the rest. */
const rangeHintKey = (gather) => (gather === 'chosen' ? 'COG.AppliedBuffs.Sheet.WithinHintOne' : 'COG.AppliedBuffs.Sheet.WithinHintOther');

/** The Target select: every tag with a recipients block; a stored tag with none stays as its own selected option (the check says it acts as Self). */
function targetOptions(current) {
  const tags = buffTargetTags();
  const id = String(current ?? '');
  const options = pickOptions(tags, id);
  if (id && !tags.some((t) => t.id === id)) options.unshift({ value: id, label: id, selected: true });
  return options;
}

/** The line under the list: where a copy's length comes from. */
function durationLine(item) {
  const eff = effectiveDuration(item, { rank: Number(item.system?.rank) || 0 });
  const text = eff.type && eff.type !== 'instant' ? durationConfigText({ type: eff.type, value: eff.value, scaleBy: eff.scaleBy }) : '';
  return text ? loc('COG.AppliedBuffs.Sheet.Lasts', { duration: text }) : loc('COG.AppliedBuffs.Sheet.NoDuration');
}

/**
 * @param {object} context the render context (`availableBuffs` and `availableSkills` are set)
 * @param {object} item the skill or spell
 */
export function buildAppliedBuffsContext(context, item) {
  const stored = Array.isArray(context.system?.appliedBuffs) ? context.system.appliedBuffs : [];
  context.appliedBuffs = {
    count: stored.length,
    durationLine: durationLine(item),
    rows: stored.map((row, index) => {
      const rankValue = Number(row.rank) || 0;
      return {
        index,
        names: Object.fromEntries(['buff', 'target', 'range', 'minRank', 'maxRank', 'rank', 'rankSkill'].map((key) => [key, `system.appliedBuffs.${index}.${key}`])),
        buffOptions: identifierOptions(context.availableBuffs, row.buff, { blankLabel: loc('COG.AppliedBuffs.Sheet.ChooseBuff') }),
        targetOptions: targetOptions(row.target),
        rankSkillOptions: identifierOptions(context.availableSkills, row.rankSkill, { blankLabel: loc('COG.AppliedBuffs.Sheet.ItemRank') }),
        range: Number(row.range) || 0,
        rangeHint: loc(rangeHintKey(rowRecipients(row).spec.gather)),
        minRank: Number(row.minRank) || 0,
        maxRank: row.maxRank === null || row.maxRank === undefined ? '' : row.maxRank,
        // A blank Buff's Rank means the item's own Rank (stored as 0)
        rank: rankValue > 0 ? rankValue : ''
      };
    })
  };
}

/** The buff sheet's "When applied again" select (the "Applied at Rank" input needs no options). */
export function buildBuffAppliedContext(context, item) {
  context.repeatModeOptions = pickOptions(
    BUFF_REPEAT_MODES.map((id) => ({ id, label: loc(`COG.Buff.Sheet.RepeatMode.${id}`) })),
    item.system?.repeat?.mode
  );
}
