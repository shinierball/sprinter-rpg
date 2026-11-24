import { langText } from '../lang-text.mjs';
import { escapeAttr } from '../escape-attr.mjs';
import { FORCED_MOVE_KINDS } from '../row-kinds/forced-move.mjs';

/** English fallbacks of the `COG.ForcedMove.*` lang keys (lang/en.json holds the same text). */
const FORCED_MOVE_TEXT = Object.freeze({
  'COG.ForcedMove.Title': 'Forced movement',
  'COG.ForcedMove.Push': 'Push {target} {feet} ft away from {source}',
  'COG.ForcedMove.Pull': 'Pull {target} {feet} ft toward {source}',
  'COG.ForcedMove.Slide': 'Slide {target} up to {feet} ft',
  'COG.ForcedMove.PushNoTarget': 'Push the target {feet} ft away from {source}',
  'COG.ForcedMove.PullNoTarget': 'Pull the target {feet} ft toward {source}',
  'COG.ForcedMove.SlideNoTarget': 'Slide the target up to {feet} ft',
  'COG.ForcedMove.Immovable': '(cannot be forcibly moved, core p. 95)'
});

const forcedMoveText = langText(FORCED_MOVE_TEXT);

const KEY_OF = Object.freeze({ [FORCED_MOVE_KINDS.push]: 'Push', [FORCED_MOVE_KINDS.pull]: 'Pull', [FORCED_MOVE_KINDS.slide]: 'Slide' });

/**
 * @typedef {object} ForcedMoveEntry
 * @property {string|null} target the hit creature's name, or null when the roll has no target
 * @property {string} source the attacker's name
 * @property {boolean} immovable the target bears `rule.immovable`
 * @property {Array<{ kind: 'push'|'pull'|'slide', feet: number, label: string }>} moves
 */

/**
 * The plain-text lines of a damage card's forced movement: one per move of each entry, "Push {target} {feet} ft away from
 * {source}", then the row's label; a target that cannot be moved gets the core p. 95 note on its line.
 * @param {ForcedMoveEntry[]} entries
 * @returns {string[]}
 */
function forcedMoveLines(entries) {
  const lines = [];
  for (const entry of entries ?? []) {
    for (const move of entry.moves ?? []) {
      const key = `${KEY_OF[move.kind] ?? 'Push'}${entry.target ? '' : 'NoTarget'}`;
      const text = forcedMoveText(`COG.ForcedMove.${key}`, { target: entry.target ?? '', feet: move.feet, source: entry.source });
      const parts = [text];
      if (move.label) parts.push(`(${move.label})`);
      if (entry.immovable) parts.push(forcedMoveText('COG.ForcedMove.Immovable'));
      lines.push(parts.join(' '));
    }
  }
  return lines;
}

/**
 * The "Forced movement" box of a damage card, in the style of the Per target box. Names and labels are user text and are escaped.
 * @param {ForcedMoveEntry[]} entries
 * @returns {string} HTML, '' when no entry has a move
 */
export function forcedMoveBoxHtml(entries) {
  const lines = forcedMoveLines(entries);
  if (lines.length === 0) return '';
  const items = lines.map((line) => `<li class="cog-per-target-row">${escapeAttr(line)}</li>`).join('');
  return `<div class="cog-per-target-box cog-forced-move-box"><div class="cog-per-target-title">${escapeAttr(forcedMoveText('COG.ForcedMove.Title'))}</div><ul class="cog-per-target-rows">${items}</ul></div>`;
}
