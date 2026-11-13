/**
 * The deity item sheet's context: the signature stat options, the rivals and signature-skill pick lists, the signature
 * effects, the effects of each worship tier and the offering's consumed-item query. Every label and `selected` flag is
 * computed here (Principle 5).
 */
import { STAT_TO_TAG } from '../../data/tag-vocabulary.mjs';
import { listDeities, skillOrSpellName } from '../../utils/deity/deity-names.mjs';
import { buildPickList, identifierEntries } from './context-pick-list.mjs';
import { buildQueryView } from './context-query.mjs';

/** The worship tiers and their names (core rulebook pp. 163-164). */
const TIER_LABELS = Object.freeze([
  { tier: 1, label: 'Acolyte' },
  { tier: 2, label: 'Devotee' },
  { tier: 3, label: 'Zealot' }
]);

const loc = (key, fallback) => {
  const i18n = globalThis.game?.i18n;
  return i18n?.has?.(key) ? i18n.localize(key) : fallback;
};

const entryView = (entry, index) => ({ index, name: entry?.name ?? '', type: entry?.type ?? 'buff', img: entry?.img ?? '' });

/**
 * Add the deity sheet's view data to `context`.
 * @param {object} context the render context (`availableSkills` and `availableSpells` are already set)
 * @param {object} item the deity item
 */
export function buildDeityContext(context, item) {
  const sys = item.system ?? {};
  const stat = String(sys.signature?.stat ?? '');
  context.deityStatOptions = [
    { value: '', label: loc('COG.Deity.Sheet.NoStat', 'None'), selected: stat === '' },
    ...Object.keys(STAT_TO_TAG).map((key) => ({ value: key, label: key.toUpperCase(), selected: stat === key }))
  ];

  const ownIdentifier = String(sys.identifier ?? '');
  const rivalEntries = listDeities().filter((d) => d.system.identifier !== ownIdentifier)
    .map((d) => ({ value: d.system.identifier, label: d.name || d.system.identifier }));
  context.deityRivals = buildPickList({
    label: loc('COG.Deity.Sheet.Rivals', 'Rivals'),
    emptyText: loc('COG.Deity.Sheet.NoRivals', 'No rivals.'),
    choose: loc('COG.Deity.Sheet.ChooseDeity', '+ Add rival...'),
    placeholder: loc('COG.Deity.Sheet.CustomDeity', 'Or another deity identifier...'),
    lists: [{ list: 'deityRivals', stored: sys.rivals, entries: rivalEntries, customLabel: loc('COG.Deity.Sheet.Add', 'Add') }]
  });

  const skillEntries = identifierEntries([...(context.availableSkills ?? []), ...(context.availableSpells ?? [])]);
  const known = new Set(skillEntries.map((e) => e.value));
  const stored = Array.isArray(sys.signature?.skills) ? sys.signature.skills : [];
  // A stored identifier nothing installed has still reads by name where a catalog has it, else as itself.
  const extra = stored.filter((id) => !known.has(id)).map((id) => ({ value: id, label: skillOrSpellName(id) ?? id }));
  context.deitySignatureSkills = buildPickList({
    label: loc('COG.Deity.Sheet.SignatureSkills', 'Signature Skills and spells'),
    hint: loc('COG.Deity.Sheet.SignatureSkillsHint', ''),
    emptyText: loc('COG.Deity.Sheet.NoSignatureSkills', 'None.'),
    choose: loc('COG.Deity.Sheet.ChooseSkill', '+ Add skill or spell...'),
    placeholder: loc('COG.Deity.Sheet.CustomSkill', 'Or another identifier...'),
    lists: [{ list: 'deitySignatureSkills', stored, entries: [...skillEntries, ...extra], customLabel: loc('COG.Deity.Sheet.Add', 'Add') }]
  });

  const tierEffects = Array.isArray(sys.tierEffects) ? sys.tierEffects : [];
  context.deityTiers = TIER_LABELS.map(({ tier, label }) => ({
    tier,
    label,
    entries: tierEffects.map((entry, index) => ({ entry, index })).filter(({ entry }) => Number(entry?.tier) === tier)
      .map(({ entry, index }) => ({ ...entryView(entry, index), canTierUp: tier < TIER_LABELS.length, canTierDown: tier > 1 }))
  }));
  context.deitySignatureEffects = (Array.isArray(sys.signatureEffects) ? sys.signatureEffects : []).map(entryView);
  context.deityConsumeQuery = buildQueryView(sys.offering?.consume?.query, 'system.offering.consume.query', ['all', 'any']);
}
