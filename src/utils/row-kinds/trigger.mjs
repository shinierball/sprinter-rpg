/**
 * Core kinds of `eventTriggers` (an effect that fires at a moment such as a kill), registered at import. Like `reflect`, a
 * kind is pure: its one stage, `fire(acc, row, ctx)`, pushes a plain description of the effect and writes nothing;
 * `fireEventTriggers` (documents/actor/event-triggers.mjs) judges the limit and applies what was pushed. A row's scaled
 * `value` arrives already worked out by `scaleBy`. `ctx.key` is the row key, `ctx.label` its label (or its carrier's name).
 */
import { registerCoreKind } from './registry.mjs';
import { SELF_TARGET_TAG } from '../../data/tag-vocabulary.mjs';

/** The scopes a row's `limit` counts in, as the row summary says them. */
const ONCE_PER_TEXT = Object.freeze({ combat: 'a combat', floor: 'a floor' });

/** The row's scope as stored (`''` for none or anything unknown). */
const oncePerOf = (row) => (Object.hasOwn(ONCE_PER_TEXT, row?.oncePer) ? row.oncePer : '');

/** How many times the row may fire in its scope before a Rule Break: the stored whole `limit`, at least 1. */
const limitOf = (row) => Math.max(1, Math.floor(Number(row?.limit) || 1));

/** What every effect of a row carries: which row it came from and how often it may fire. */
function effectBase(row, ctx) {
  return { key: ctx.key, label: ctx.label, oncePer: oncePerOf(row), limit: limitOf(row) };
}

/** The whole number of a row's `value`, 0 when it is not a number or below 0. */
const wholeValue = (row) => Math.max(0, Math.floor(Number(row?.value) || 0));

/** The debuff identifier a `debuff` row names, trimmed; '' when it names none. */
const debuffRef = (row) => (typeof row?.debuff === 'string' ? row.debuff.trim() : '');

/** The buff identifier a `buff` row names, trimmed; '' when it names none. */
const buffRef = (row) => (typeof row?.identifier === 'string' ? row.identifier.trim() : '');

/** The `target.*` tag a `buff` row reaches; Self Only when it names none. */
const buffTarget = (row) => (typeof row?.target === 'string' && row.target.trim() ? row.target.trim() : SELF_TARGET_TAG);
/** The skill identifier a `check` row names, trimmed; '' when it names none. */
const skillRef = (row) => (typeof row?.skill === 'string' ? row.skill.trim() : '');

/** The limit as the row summary says it: "up to 5 a combat", "once a floor", or ''. */
function limitText(row) {
  const scope = ONCE_PER_TEXT[oncePerOf(row)];
  if (!scope) return '';
  const limit = limitOf(row);
  return limit === 1 ? `once ${scope}` : `up to ${limit} ${scope}`;
}

// Heals the holder Health Bar slots when the event happens (a kill). The effect is applied through `applyHealingBars`, so a
// crawler who cannot be healed is asked first.
registerCoreKind('eventTriggers', {
  id: 'heal',
  label: 'COG.Rows.Kind.Trigger.heal.Label',
  hint: 'COG.Rows.Kind.Trigger.heal.Hint',
  fields: ['value', 'oncePer', 'limit'],
  scaled: { value: 'whole' },
  apply: {
    // acc: Array<{ type: 'heal', slots, key, label, oncePer, limit }>
    fire(acc, row, ctx) {
      const slots = wholeValue(row);
      if (slots <= 0) return false;
      acc.push({ type: 'heal', slots, ...effectBase(row, ctx) });
    }
  },
  summarize(row) {
    const slots = wholeValue(row);
    return [`Heal ${slots} slot${slots === 1 ? '' : 's'} on ${row.event || 'kill'}`, limitText(row)].filter(Boolean).join(', ');
  }
});

// Pays the holder gold when the event happens (a kill), added to `system.currency.gold`.
registerCoreKind('eventTriggers', {
  id: 'gold',
  label: 'COG.Rows.Kind.Trigger.gold.Label',
  hint: 'COG.Rows.Kind.Trigger.gold.Hint',
  fields: ['value', 'oncePer', 'limit'],
  scaled: { value: 'whole' },
  apply: {
    // acc: Array<{ type: 'gold', amount, key, label, oncePer, limit }>
    fire(acc, row, ctx) {
      const amount = wholeValue(row);
      if (amount <= 0) return false;
      acc.push({ type: 'gold', amount, ...effectBase(row, ctx) });
    }
  },
  summarize(row) {
    return [`Gain ${wholeValue(row)} gold on ${row.event || 'kill'}`, limitText(row)].filter(Boolean).join(', ');
  }
});

// Lands a debuff on the holder when the event happens (a use of the skill). The debuff is named by its identifier in the row's
// `debuff`; a blank one fires nothing. The effect is applied through `applyCondition`, so immunity and the repeat rule hold.
registerCoreKind('eventTriggers', {
  id: 'debuff',
  label: 'COG.Rows.Kind.Trigger.debuff.Label',
  hint: 'COG.Rows.Kind.Trigger.debuff.Hint',
  fields: ['debuff', 'oncePer', 'limit'],
  apply: {
    // acc: Array<{ type: 'debuff', ref, key, label, oncePer, limit }>
    fire(acc, row, ctx) {
      const ref = debuffRef(row);
      if (!ref) return false;
      acc.push({ type: 'debuff', ref, ...effectBase(row, ctx) });
    }
  },
  summarize(row) {
    return [`Gain ${debuffRef(row) || 'a debuff'} on ${row.event || 'use'}`, limitText(row)].filter(Boolean).join(', ');
  }
});

// Lands a catalog buff on the people the row reaches when the event happens (a use of the skill, a kill). The buff is named by
// its identifier in the row's `identifier`, who it reaches by `target` and `range` as an applied buff's row does; a blank
// identifier fires nothing. `fireEventTriggers` lands it through `landBuff` on `gatherBuffRecipients`' result, never asking:
// a doubtful recipient is skipped and named on the trigger's card.
registerCoreKind('eventTriggers', {
  id: 'buff',
  label: 'COG.Rows.Kind.Trigger.buff.Label',
  hint: 'COG.Rows.Kind.Trigger.buff.Hint',
  fields: ['identifier', 'target', 'range', 'oncePer', 'limit'],
  apply: {
    // acc: Array<{ type: 'buff', ref, target, range, sourceUuid, key, label, oncePer, limit }>
    fire(acc, row, ctx) {
      const ref = buffRef(row);
      if (!ref) return false;
      acc.push({
        type: 'buff', ref, target: buffTarget(row), range: Math.max(0, Number(row?.range) || 0),
        sourceUuid: ctx.source?.uuid ?? '', ...effectBase(row, ctx)
      });
    }
  },
  summarize(row) {
    return [`Gain ${buffRef(row) || 'a buff'} on ${row.event || 'use'}`, limitText(row)].filter(Boolean).join(', ');
  }
});

// Offers the holder a roll of the named skill when the event happens (the check after a kill). The effect is a card with one
// button, posted to the holder's owners and the GM; the click rolls the skill (an untrained one at Rank 0, as any skill) against
// the Unopposed Difficulty with `situation.after_kill` ticked. A blank skill fires nothing.
registerCoreKind('eventTriggers', {
  id: 'check',
  label: 'COG.Rows.Kind.Trigger.check.Label',
  hint: 'COG.Rows.Kind.Trigger.check.Hint',
  fields: ['skill', 'oncePer', 'limit'],
  apply: {
    // acc: Array<{ type: 'check', offer: true, skill, key, label, oncePer, limit }>
    fire(acc, row, ctx) {
      const skill = skillRef(row);
      if (!skill) return false;
      acc.push({ type: 'check', offer: true, skill, ...effectBase(row, ctx) });
    }
  },
  summarize(row) {
    return [`Roll ${skillRef(row) || 'a skill'} on ${row.event || 'kill'}`, limitText(row)].filter(Boolean).join(', ');
  }
});

// Gives the holder AI Favor when the event happens (a Level gained, a kill). The effect is written through `addAiFavor`, so a
// gain while the day's AI Favor bar is up asks a Rule Break. On `levelUp` the row has no limit.
registerCoreKind('eventTriggers', {
  id: 'aiFavor',
  label: 'COG.Rows.Kind.Trigger.aiFavor.Label',
  hint: 'COG.Rows.Kind.Trigger.aiFavor.Hint',
  fields: ['value', 'oncePer', 'limit'],
  scaled: { value: 'whole' },
  apply: {
    // acc: Array<{ type: 'aiFavor', amount, key, label, oncePer, limit }>
    fire(acc, row, ctx) {
      const amount = wholeValue(row);
      if (amount <= 0) return false;
      acc.push({ type: 'aiFavor', amount, ...effectBase(row, ctx) });
    }
  },
  summarize(row) {
    return [`Gain ${wholeValue(row)} AI Favor on ${row.event || 'kill'}`, limitText(row)].filter(Boolean).join(', ');
  }
});
