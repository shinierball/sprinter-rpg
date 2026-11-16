/**
 * src/utils/item-check/rules/applied-buffs.mjs
 * The buffs a skill or spell applies (`system.appliedBuffs`): the buff must exist in this world, the target must be a
 * tag that says who it reaches (else the row acts as Self Only), and a row that reaches allies or everyone with no
 * distance reaches the whole scene.
 */
import { registerItemRule, finding } from '../registry.mjs';
import { resolveReference } from '../../item-from-words/check-references.mjs';
import { hasRecipientsBlock, rowRecipients } from '../../effects/applied-buff.mjs';

/** Gathers that look at everyone near the caster, so no distance means no limit. */
const REACH_GATHERS = new Set(['allies', 'everyone']);

registerItemRule('*', (item, ctx) => {
  if (item?.type !== 'skill' && item?.type !== 'spell') return [];
  const rows = Array.isArray(item.system?.appliedBuffs) ? item.system.appliedBuffs : [];
  const out = [];
  rows.forEach((row, i) => {
    if (!row || typeof row !== 'object' || !String(row.buff ?? '').trim()) return;
    const path = `system.appliedBuffs[${i}]`;
    if (resolveReference('buffs', row.buff, ctx.resolve).status === 'unresolved') {
      out.push(finding('row.reference-unresolved', 'warning', `${path}.buff`, { kind: 'buffs', ref: String(row.buff) }));
    }
    if (!hasRecipientsBlock(row.target)) {
      out.push(finding('appliedBuff.no-recipients', 'warning', `${path}.target`, { target: String(row.target ?? '') }));
      return;
    }
    const { spec } = rowRecipients(row);
    if (REACH_GATHERS.has(spec.gather) && !(Number(row.range) > 0)) {
      out.push(finding('appliedBuff.no-reach', 'warning', `${path}.range`, { target: spec.label }));
    }
  });
  return out;
});
