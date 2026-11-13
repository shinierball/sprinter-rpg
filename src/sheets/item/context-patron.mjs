/**
 * The patron item sheet's context: the advice-channel options, the performance-skill and additional-skill pick lists,
 * and the linked actor. Every label and `selected` flag is computed here (Principle 5).
 */
import { PATRON_MESSAGING, patronProfileOf } from '../../utils/patron/patron-profile.mjs';
import { skillOrSpellName } from '../../utils/deity/deity-names.mjs';
import { buildPickList, identifierEntries } from './context-pick-list.mjs';

const loc = (key, fallback) => {
  const i18n = globalThis.game?.i18n;
  return i18n?.has?.(key) ? i18n.localize(key) : fallback;
};

const MESSAGING_LABELS = Object.freeze({
  hud: ['COG.Patron.Sheet.MessagingHud', 'HUD chat'],
  fairy: ['COG.Patron.Sheet.MessagingFairy', 'Messenger fairy']
});

/**
 * The actor a patron is linked to: its uuid and name, or `broken` when a uuid is set and resolves to nothing.
 * @param {string} uuid
 */
function linkedActor(uuid) {
  if (!uuid) return { uuid: '', name: '', label: '', broken: false };
  let doc;
  try { doc = globalThis.fromUuidSync?.(uuid) ?? null; } catch { doc = null; }
  const name = doc?.name ?? '';
  return { uuid, name, label: doc ? name : loc('COG.Patron.Sheet.ActorBroken', 'Link broken: that actor no longer exists.'), broken: !doc };
}

/**
 * Add the patron sheet's view data to `context`.
 * @param {object} context the render context (`availableSkills` and `availableSpells` are already set)
 * @param {object} item the patron item
 */
export function buildPatronContext(context, item) {
  const profile = patronProfileOf(item);
  context.patronMessagingOptions = PATRON_MESSAGING.map((value) => ({
    value,
    label: loc(...MESSAGING_LABELS[value]),
    selected: profile.messaging === value
  }));
  context.patronMessagingHint = loc('COG.Patron.Sheet.MessagingHint', 'HUD chat for a crawler, a former crawler or an outworlder; otherwise a messenger fairy (p. 316).');

  const entries = identifierEntries([...(context.availableSkills ?? []), ...(context.availableSpells ?? [])]);
  const known = new Set(entries.map((e) => e.value));
  const sys = item.system ?? {};
  const withExtras = (stored) => [
    ...entries,
    ...(Array.isArray(stored) ? stored : []).filter((id) => !known.has(id)).map((id) => ({ value: id, label: skillOrSpellName(id) ?? id }))
  ];
  const add = loc('COG.Patron.Sheet.Add', 'Add');
  const placeholder = loc('COG.Patron.Sheet.CustomSkill', 'Or another identifier...');
  context.patronPerformanceSkills = buildPickList({
    label: loc('COG.Patron.Sheet.PerformanceSkills', 'Performance Skills'),
    hint: loc('COG.Patron.Sheet.PerformanceSkillsHint', ''),
    emptyText: loc('COG.Patron.Sheet.NoPerformanceSkills', 'None.'),
    choose: loc('COG.Patron.Sheet.ChooseSkill', '+ Add skill or spell...'),
    placeholder,
    lists: [{ list: 'patronPerformanceSkills', stored: sys.performanceSkills, entries: withExtras(sys.performanceSkills), customLabel: add }]
  });
  context.patronSkills = buildPickList({
    label: loc('COG.Patron.Sheet.Skills', 'Skills and spells it mentors'),
    emptyText: loc('COG.Patron.Sheet.NoSkills', 'None.'),
    choose: loc('COG.Patron.Sheet.ChooseSkill', '+ Add skill or spell...'),
    placeholder,
    lists: [{ list: 'patronSkills', stored: sys.skills, entries: withExtras(sys.skills), customLabel: add }]
  });
  context.patronActor = linkedActor(profile.actorUuid);
}
