/**
 * Party check controls (core pp. 59-60): the GM's start dialog and a participant's Roll button on the card.
 * The card, its state and the ingest are in ../party-check-card.mjs and ../party-check-ingest.mjs.
 */
import { COGSessionEngine } from '../../documents/session/session-engine.mjs';
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { skillStandIn } from '../../utils/skill/skill-stand-in.mjs';
import { difficultyFor } from '../../utils/roll/check-difficulty.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { isChecked } from '../../utils/roll/roll-context.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { MAX_PARTY_PARTICIPANTS } from '../../data/rules/party-check-rules.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { foeEntryFor, askOpposed, setCheckDifficulty } from './check-difficulty.mjs';
import { readPartyCheck, findPartyMessage, updatePartyCheck, postPartyCheckCard, difficultySpecOf, partyText } from '../party-check-card.mjs';

const notify = (level, text) => globalThis.ui?.notifications?.[level]?.(`Sprinter RPG | ${text}`);
/** Skills that are never rolled as a Skill Check: a Stat Check (core p. 59), a passive and a skill with no check. */
const UNROLLED_CHECK_TYPES = Object.freeze(['statOnly', 'passive', 'none']);

const worldCrawlers = () => Array.from(globalThis.game?.actors?.filter?.((a) => a.type === 'crawler') ?? []);

const hasPlayerOwner = (actor) => Array.from(globalThis.game?.users?.values?.() ?? [])
  .some((u) => !u.isGM && actor.testUserPermission?.(u, 'OWNER'));

/** The crawlers a party check starts with ticked: the active session's tracked ones, else the selected tokens', else every crawler a player owns. */
function defaultParticipants(crawlers) {
  if (COGSessionEngine.getActiveSessionId?.()) {
    const tracked = COGSessionEngine.getPartyCrawlers({ trackedOnly: true });
    if (tracked.length) return tracked;
  }
  const selected = (globalThis.canvas?.tokens?.controlled ?? []).map((t) => t.actor).filter((a) => a?.type === 'crawler');
  if (selected.length) return selected;
  return crawlers.filter(hasPlayerOwner);
}

/** The Skills a party check can name, `{ identifier, name, stat }` by name: the crawlers' own and the catalog's. */
function rollableSkills(crawlers) {
  const rows = new Map();
  const add = (sys, name) => {
    const identifier = typeof sys?.identifier === 'string' ? sys.identifier : '';
    if (!identifier || rows.has(identifier) || UNROLLED_CHECK_TYPES.includes(sys.checkType)) return;
    rows.set(identifier, { identifier, name: name || identifier, stat: sys.stat || 'str' });
  };
  for (const actor of crawlers) for (const item of actor.items ?? []) if (item.type === 'skill') add(item.system, item.name);
  for (const entry of catalogEntries('skills')) add(entry.system, entry.name);
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const targetedFoe = () => {
  const first = [...(globalThis.game?.user?.targets ?? [])][0];
  return first?.actor ?? null;
};

/** Post the card for a chosen Skill, crawlers and Difficulty spec (`difficultyFor`'s spec, or null for none). */
async function startPartyCheck({ skill, actors, spec }) {
  const difficulty = spec ? difficultyFor(spec, { floor: getCurrentFloor() }) : null;
  const participants = actors.slice(0, MAX_PARTY_PARTICIPANTS).map((a) => ({ actorUuid: a.uuid, name: a.name }));
  return postPartyCheckCard({ skill: { identifier: skill.identifier, name: skill.name }, difficulty, participants });
}

/**
 * The GM's start dialog: a Skill, the participants and a Difficulty; OK posts the card. GM only.
 * @returns {Promise<object|null>} the posted card, or null (not a GM, no choice made, cancelled)
 */
export async function openPartyCheckDialog() {
  if (!globalThis.game?.user?.isGM) { notify('warn', partyText('GmOnly')); return null; }
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt !== 'function') return null;
  const crawlers = worldCrawlers();
  const skills = rollableSkills(crawlers);
  if (!skills.length || !crawlers.length) return null;
  const ticked = new Set(defaultParticipants(crawlers).map((a) => a.uuid));
  const foe = targetedFoe();
  const option = (value, label) => `<option value="${escapeAttr(value)}">${escapeAttr(label)}</option>`;
  const skillOptions = skills.map((sk) => option(sk.identifier, sk.name)).join('');
  const crawlerRows = crawlers.map((a) => `<label class="cog-party-pick"><input type="checkbox" name="participant" value="${escapeAttr(a.uuid)}"${ticked.has(a.uuid) ? ' checked' : ''}> ${escapeAttr(a.name)}</label>`).join('');
  const modes = [['', partyText('None')], ['unopposed', partyText('Unopposed')]];
  if (foe) modes.push(['opposed', partyText('Opposed', { foe: foe.name })]);
  modes.push(['typed', partyText('Number')]);
  const modeOptions = modes.map(([value, label]) => option(value, label)).join('');
  const content = `<label>${escapeAttr(partyText('Skill'))} <select name="skill">${skillOptions}</select></label>
    <fieldset><legend>${escapeAttr(partyText('Participants'))}</legend>${crawlerRows}</fieldset>
    <label>${escapeAttr(partyText('Difficulty'))} <select name="mode">${modeOptions}</select> <input type="number" name="value" value="0"></label>`;
  let choice;
  try {
    choice = await DialogV2.prompt({
      window: { title: partyText('DialogTitle') },
      content,
      ok: {
        label: partyText('Start'),
        callback: (_event, button) => ({
          skill: button?.form?.elements?.skill?.value ?? '',
          uuids: [...(button?.form?.querySelectorAll?.('input[name="participant"]') ?? [])].filter(isChecked).map((el) => el.getAttribute('value')),
          mode: button?.form?.elements?.mode?.value ?? '',
          value: button?.form?.elements?.value?.value ?? ''
        })
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
  const skill = skills.find((s) => s.identifier === choice?.skill);
  const actors = crawlers.filter((a) => (choice?.uuids ?? []).includes(a.uuid));
  if (!skill || !actors.length) return null;
  let spec = null;
  if (choice.mode === 'unopposed') spec = { mode: 'unopposed' };
  else if (choice.mode === 'typed') spec = { mode: 'typed', value: choice.value };
  else if (choice.mode === 'opposed' && foe) spec = { mode: 'opposed', stat: skill.stat, foe: foeEntryFor(foe, skill.stat, null) };
  return startPartyCheck({ skill, actors, spec });
}

/** Roll button: the participant's Skill Check, rolled from the card (never with Help; it is a party roll). */
export async function handlePartyCheckRoll(event, button, message) {
  const state = readPartyCheck(message);
  if (!state) return;
  const participant = state.participants.find((p) => p.id === button?.dataset?.participantId && !p.removed);
  const actor = participant ? resolveActorByUuid(participant.actorUuid) : null;
  if (!participant || !actor) { notify('warn', partyText('NotParticipant')); return; }
  if (!globalThis.game?.user?.isGM && !actor.isOwner) { notify('warn', partyText('NotParticipant')); return; }
  // A second roll asks a Rule Break (Directive 2); declining rolls nothing. The newer card replaces the old one when the
  // GM's ingest takes it, and the ingest badges the row.
  if (participant.messageId) {
    const text = partyText('RollAgainConfirm', { name: participant.name });
    const res = await confirmRuleBreak({ title: partyText('RollAgainTitle'), message: text, reason: text });
    if (!res.confirmed) return;
  }
  await actor.rollSkill(skillStandIn(actor, state.skill.identifier), {
    partyCheck: { messageId: message.id, participantId: participant.id },
    difficulty: difficultySpecOf(state)
  });
}

const gmOnly = () => {
  if (globalThis.game?.user?.isGM) return true;
  notify('warn', partyText('GmOnlyControl'));
  return false;
};

/** Remove button (GM): the participant is out of the count. */
export async function handlePartyCheckRemove(event, button, message) {
  if (!gmOnly() || !readPartyCheck(message)) return;
  const id = button?.dataset?.participantId;
  await updatePartyCheck(message.id, (state) => {
    const p = state.participants.find((x) => x.id === id && !x.removed);
    if (!p) return false;
    p.removed = true;
    return undefined;
  });
}

/** The spec a Difficulty button asks for, or null when it is cancelled or has no usable number. `{ mode: '' }` clears. */
async function specFromButton(button, message, state) {
  const mode = button?.dataset?.mode ?? '';
  if (mode === 'clear') return { mode: '' };
  if (mode === 'unopposed') return { mode };
  if (mode === 'typed') {
    const box = button.closest?.('.cog-party-difficulty-controls')?.querySelector?.('input[type="number"]');
    return box && box.value !== '' && Number.isFinite(Number(box.value)) ? { mode, value: box.value } : null;
  }
  if (mode !== 'opposed') return null;
  const stat = rollableSkills(worldCrawlers()).find((s) => s.identifier === state.skill.identifier)?.stat ?? '';
  const foe = targetedFoe();
  if (foe) return { mode, stat, foe: foeEntryFor(foe, stat, null) };
  return askOpposed(message, { targets: [], stat, rollerUuid: '' });
}

/**
 * The Difficulty buttons on the card (GM): set it on the card, then on every member card already rolled
 * (`setCheckDifficulty` with `partyCard`), whose updates the ingest reads back. Opposed works out the foe's number once.
 */
export async function handlePartyCheckDifficulty(event, button, message) {
  if (!gmOnly()) return;
  const state = readPartyCheck(message);
  if (!state) return;
  const spec = await specFromButton(button, message, state);
  if (!spec) return;
  const difficulty = spec.mode === '' ? null : difficultyFor(spec, { floor: getCurrentFloor() });
  if (spec.mode !== '' && !difficulty) return;
  const res = await updatePartyCheck(message.id, (draft) => { draft.difficulty = difficulty; });
  if (!res.ok) return;
  for (const p of res.state.participants) {
    const member = p.removed ? null : findPartyMessage(p.messageId);
    if (member) await setCheckDifficulty(member, spec, { partyCard: true });
  }
}
