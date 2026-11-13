/**
 * Contest card buttons (3.45-4): a participant's Roll for the open leg, and Drop out. 3.45-6 adds Propose skill.
 */
import { readContest } from '../contest-card.mjs';
import { rollContestLeg, requestContestDrop, requestContestSkill } from '../contest-ingest.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { MOVEMENT_SKILL_TAG } from '../../data/tag-vocabulary.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

const notify = (level, message) => globalThis.ui?.notifications?.[level]?.(`Sprinter RPG | ${message}`);

const REASONS = {
  'no-contest': 'This is not a contest card.',
  'unknown-target': 'That leg or participant is no longer on the contest.',
  'no-actor': 'The participant\'s actor could not be found.',
  fixed: 'Mobs and fixed participants do not roll. The GM types a result if needed.',
  'not-owner': 'You do not own that participant.'
};

/** Roll button: roll the leg's check for the participant on the button. */
export async function handleContestRoll(event, button, message) {
  const res = await rollContestLeg({
    message,
    legId: button?.dataset?.legId,
    participantId: button?.dataset?.participantId
  });
  if (!res.ok && REASONS[res.reason]) notify('warn', REASONS[res.reason]);
}

/** Drop out button: the participant leaves the contest from the open leg (the GM applies it). */
export async function handleContestDrop(event, button, message) {
  const wrapper = readContest(message);
  if (!wrapper) return;
  const res = await requestContestDrop(wrapper.id, button?.dataset?.participantId);
  if (!res.ok && res.reason && res.reason !== 'no-gm' && res.reason !== 'no-socket') notify('warn', 'The GM could not apply that.');
}


/**
 * The skills a participant may propose, as `{ identifier, name }` sorted by name: the actor's own skills, then the
 * catalog's movement skills they lack. Identifiers only; a name is just the label.
 */
export function proposableSkills(actor) {
  const rows = new Map();
  for (const item of actor?.items ?? []) {
    const identifier = item?.type === 'skill' ? item.system?.identifier : '';
    if (typeof identifier === 'string' && identifier) rows.set(identifier, { identifier, name: item.name || identifier });
  }
  for (const entry of catalogEntries('skills')) {
    const identifier = entry?.system?.identifier;
    if (typeof identifier !== 'string' || !identifier || rows.has(identifier)) continue;
    if ((entry.system?.tags ?? []).includes(MOVEMENT_SKILL_TAG)) rows.set(identifier, { identifier, name: entry.name || identifier });
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Ask which skill to propose. Resolves a skill identifier, or null (Cancel, closed, or no dialog). */
async function askSkill(skills) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt !== 'function') return null;
  const options = skills.map((s) => `<option value="${escapeAttr(s.identifier)}">${escapeAttr(s.name)}</option>`).join('');
  try {
    const picked = await DialogV2.prompt({
      window: { title: 'Propose a skill' },
      content: `<p>Which skill do you want to use for this leg? The GM accepts or dismisses it.</p><select name="skill">${options}</select>`,
      ok: { label: 'Propose', callback: (_event, button) => button?.form?.elements?.skill?.value ?? null },
      rejectClose: false,
      modal: true
    });
    return skills.some((s) => s.identifier === picked) ? picked : null;
  } catch {
    return null;
  }
}

/** Propose skill button: pick a skill for the leg; the GM accepts or dismisses it in the tracker. Cancel sends nothing. */
export async function handleContestPropose(event, button, message) {
  const wrapper = readContest(message);
  if (!wrapper) return;
  const skills = proposableSkills(resolveActorByUuid(button?.dataset?.actorUuid));
  if (!skills.length) return notify('warn', 'There are no skills to propose.');
  const skill = await askSkill(skills);
  if (!skill) return;
  const res = await requestContestSkill(wrapper.id, button?.dataset?.participantId, skill, button?.dataset?.legId ?? '');
  if (res.ok) notify('info', 'Proposed to the GM.');
  else if (res.reason && res.reason !== 'no-gm' && res.reason !== 'no-socket') notify('warn', 'The GM could not take that proposal.');
}
