/**
 * src/utils/item-check/rules/consumable.mjs
 * A consumable does something when used: an outcome, or a spell it casts. Its outcomes' buff, debuff and Skill
 * references, and the spell it casts, must resolve in this world.
 */
import { registerItemRule, finding } from '../registry.mjs';
import { resolveReference } from '../../item-from-words/check-references.mjs';
import { OUTCOME_REFERENCES } from '../../item-from-words/draft-fields.mjs';

registerItemRule('consumable', (item, ctx) => {
  const sys = item.system ?? {};
  const out = [];
  const outcomes = (Array.isArray(sys.outcomes) ? sys.outcomes : []).filter((row) => row && typeof row === 'object');
  const spellRef = typeof sys.spellIdentifier === 'string' ? sys.spellIdentifier.trim() : '';
  // A scroll of prayer names a god instead of a spell: that is what reading it does.
  const deity = typeof sys.deity === 'string' ? sys.deity.trim() : '';
  if (!outcomes.length && !spellRef && !deity) out.push(finding('consumable.no-outcome', 'warning', 'system.outcomes'));
  outcomes.forEach((row, i) => {
    for (const [field, kind] of Object.entries(OUTCOME_REFERENCES)) {
      if (row[field] && resolveReference(kind, row[field], ctx.resolve).status === 'unresolved') {
        out.push(finding('consumable.reference-unresolved', 'warning', `system.outcomes[${i}].${field}`, { kind, ref: String(row[field]) }));
      }
    }
  });
  if (spellRef && resolveReference('spells', spellRef, ctx.resolve).status === 'unresolved') {
    out.push(finding('consumable.reference-unresolved', 'warning', 'system.spellIdentifier', { kind: 'spells', ref: spellRef }));
  }
  return out;
});
