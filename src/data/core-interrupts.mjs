/**
 * Built-in interrupts available to every actor, expressed as tag data so they go through
 * the same offer path as owned items. Taunt, Catcher and Intervene are NOT built-ins: they are skills
 * (see src/data/skills.mjs). Call a Play is a standard action (COG_ACTION_TYPES.play) planned on the
 * actor's own turn, so it is never an interrupt.
 */
const freezeEntry = (e) => Object.freeze({
  ...e,
  tags: Object.freeze([...e.tags]),
  ...(e.interrupt ? { interrupt: Object.freeze({ ...e.interrupt }) } : {})
});

export const CORE_INTERRUPTS = Object.freeze([
  {
    id: 'evade', name: 'Evade', category: 'defensive', icon: 'fa-solid fa-shield-halved',
    description: 'Declare defensive focus to boost Evade against all incoming attacks for the rest of the round.',
    tags: ['action.interrupt', 'trigger.on_attack']
  }
].map(freezeEntry));
