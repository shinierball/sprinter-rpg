/** Descriptor-only core kinds of the closed arrays (their collectors read the rows directly), registered at import. */
import { registerCoreKind } from './registry.mjs';

// --- closed arrays: descriptors only, their collectors read the rows directly -

registerCoreKind('manaCostModifiers', { id: 'add', label: 'COG.Rows.Kind.ManaCost.add.Label', hint: 'COG.Rows.Kind.ManaCost.add.Hint', fields: ['value'], scaled: { value: 'whole' } });
registerCoreKind('manaCostModifiers', { id: 'multiply', label: 'COG.Rows.Kind.ManaCost.multiply.Label', hint: 'COG.Rows.Kind.ManaCost.multiply.Hint', fields: ['multiplier'], scaled: { multiplier: 'factor' } });
registerCoreKind('recoveryModifiers', { id: 'default', label: 'COG.Rows.Kind.Recovery.default.Label', hint: 'COG.Rows.Kind.Recovery.default.Hint', fields: ['resource', 'multiplier'], scaled: { multiplier: 'factor' } });
registerCoreKind('popularityTriggers', { id: 'default', label: 'COG.Rows.Kind.Popularity.default.Label', hint: 'COG.Rows.Kind.Popularity.default.Hint', fields: ['event', 'value', 'oncePer'], scaled: { value: 'whole' } });
registerCoreKind('aiFavorRatings', { id: 'default', label: 'COG.Rows.Kind.AiFavor.default.Label', hint: 'COG.Rows.Kind.AiFavor.default.Hint', fields: ['value'] });
registerCoreKind('statSubstitutions', { id: 'default', label: 'COG.Rows.Kind.Substitution.default.Label', hint: 'COG.Rows.Kind.Substitution.default.Hint', fields: ['scope', 'from', 'to', 'optional'] });
