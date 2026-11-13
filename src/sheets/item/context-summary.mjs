/** The read-only "what this does" block of the item sheet and the weapon builder's review: its lines, heading and empty line. */
import { describeItem, emptyLine } from '../../utils/item-describer/index.mjs';
import { t as summaryLabel } from '../../utils/item-describer/shared.mjs';
import { isRaceOrClass } from '../../utils/document-types.mjs';

/**
 * The read-only "what this does" block: the lines, the heading ("What this
 * grants" for races and classes, "What this does" for the rest) and the muted empty line, built from an empty result only.
 */
export async function buildSummaryContext(context, item) {
  const lines = await describeItem(item);
  const grants = isRaceOrClass(item);
  context.summaryTitle = summaryLabel(grants ? 'COG.ItemSummary.HeadingGrants' : 'COG.ItemSummary.Heading');
  context.summaryLines = lines;
  context.summaryEmpty = lines.length === 0;
  context.summaryEmptyText = emptyLine().text;
}
