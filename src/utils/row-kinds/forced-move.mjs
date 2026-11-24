/** The `forcedMove` kind of `damageModifiers`, registered at import. */
import { registerCoreKind } from './registry.mjs';

/** The ways a hit can move its target (core book pp. 69-70): away from the source, toward it, or any way the source says. */
export const FORCED_MOVE_KINDS = Object.freeze({ push: 'push', pull: 'pull', slide: 'slide' });

const CHOICES = Object.values(FORCED_MOVE_KINDS);

const feetOf = (row) => {
  const n = Math.floor(Number(row?.value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Moves the hit target by `value` feet, `option` the way. Read only by the damage card's forced-move line
// (`collectForcedMoves`); the damage total never sees it. When two rows of one way match, the farthest wins (the book
// restates a distance at a higher Rank; it does not add).
registerCoreKind('damageModifiers', {
  id: 'forcedMove',
  label: 'COG.Rows.Kind.Damage.forcedMove.Label',
  hint: 'COG.Rows.Kind.Damage.forcedMove.Hint',
  fields: ['value', 'option'],
  option: {
    label: 'COG.Rows.Kind.Damage.forcedMove.OptionLabel',
    hint: 'COG.Rows.Kind.Damage.forcedMove.OptionHint',
    choices: CHOICES,
    default: FORCED_MOVE_KINDS.push,
    labels: { push: 'COG.Rows.Kind.Damage.forcedMove.Option.push', pull: 'COG.Rows.Kind.Damage.forcedMove.Option.pull', slide: 'COG.Rows.Kind.Damage.forcedMove.Option.slide' }
  },
  apply: {
    // acc: { moves: Record<kind, { kind, feet, label }> }
    forced(acc, row, ctx) {
      const feet = feetOf(row);
      if (!feet) return false;
      const kind = CHOICES.includes(row.option) ? row.option : FORCED_MOVE_KINDS.push;
      if ((acc.moves[kind]?.feet ?? 0) >= feet) return false;
      acc.moves[kind] = { kind, feet, label: ctx.label || '' };
    }
  },
  summarize(row) {
    const kind = CHOICES.includes(row.option) ? row.option : FORCED_MOVE_KINDS.push;
    return `${kind[0].toUpperCase()}${kind.slice(1)} the target ${feetOf(row)} ft`;
  }
});
