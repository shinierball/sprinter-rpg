/**
 * src/chat/contest-card.mjs
 * The contest chat card: one card per race, chase or skill challenge, rendered from
 * its state. The state lives on the message under `flags.sprinter-rpg.contestState` as `{ id, state }`; `id` is the
 * contest's own id (stable across a re-post, see contest-service.mjs), `state` is the engine's v1 state. Everything on
 * the card is derived from the state (placements, Ground, who is out), so the card can be rebuilt at any time.
 *
 * The flag is named `contestState`, not `contest`: a skill card already stores its opposed-check block under `contest`.
 * The HTML is built here as a pure function (like the floor arrival card). Per-viewer visibility (a Roll button only
 * for the actors the viewer owns) is a render-time step, chat/render/contest.mjs.
 */
import { readFlag } from '../utils/flags.mjs';
import { sanitizeContest, raceStandings, chaseStatus, challengeStatus, contestMoveOf, moveRateMod, participantLegSkill } from '../utils/contest/contest-engine.mjs';
import { contestMoveOptions } from '../documents/actor/vehicle-contest.mjs';
import { contestKindInfo } from '../data/rules/contest-rules.mjs';
import { COG_OUTCOME_CONFIG } from '../documents/session/roll-outcomes.mjs';
import { isGmAuthored } from './chat-relay.mjs';
import { ruleBreakBadgeHtml } from '../utils/rule-break-visibility.mjs';
import { escapeAttr } from '../utils/escape-attr.mjs';

export const CONTEST_FLAG = 'contestState';
export const CONTEST_ACTIONS = Object.freeze({ roll: 'crawlerContestRoll', drop: 'crawlerContestDrop', propose: 'crawlerContestPropose' });


const text = (raw) => {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  return typeof val === 'string' ? val.trim().slice(0, 120) : '';
};

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

/** The wrapper `{ id, state }` of a raw flag value; null when it has no usable id. */
export function sanitizeContestWrapper(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = text(raw.id);
  if (!id) return null;
  return { id, state: sanitizeContest(raw.state) };
}

/** The id the stored contest wrapper carries, unsanitised and whoever authored the card (the tracker lists every contest card). */
export const contestIdOf = (message) => readFlag(message, CONTEST_FLAG)?.id;

/**
 * The sanitised contest wrapper on a chat message, or null when it is not a contest card. Only a GM-authored message
 * counts: the contest id is public, so a player's message carrying it must never read as the contest (3.56c, A-S2).
 */
export function readContest(message) {
  if (!isGmAuthored(message)) return null;
  return sanitizeContestWrapper(readFlag(message, CONTEST_FLAG));
}

/**
 * Whether a participant is out of the contest at the open leg: a stored drop-out, or (in a chase) caught, lost or out
 * on the closed legs. A race has no derived exits. Used for the Rule Break "an out participant rolled again".
 */
export function participantIsOut(state, participantId, resolve) {
  const p = state.participants.find((x) => x.id === participantId);
  if (!p) return false;
  if (p.out) return true;
  if (state.kind !== 'chase') return false;
  const row = chaseStatus(state, resolve).chasers.find((r) => r.id === participantId);
  return Boolean(row && (row.state === 'caught' || row.state === 'out'));
}

function legCheckLabel(leg) {
  return leg.check.skill ? `${leg.check.skill} (${leg.check.stat.toUpperCase()})` : `${leg.check.stat.toUpperCase()} check`;
}

function resultCell(result) {
  if (!result) return '<span class="cog-contest-pending">&mdash;</span>';
  const badge = result.ruleBreak ? ` ${ruleBreakBadgeHtml()}` : '';
  const src = result.source === 'roll' ? '' : ` <em>(${result.source === 'fixed' ? 'fixed' : 'GM'})</em>`;
  const note = result.note ? `<div class="cog-contest-note">${escapeAttr(result.note)}</div>` : '';
  return `<strong>${escapeAttr(result.total)}</strong>${src}${badge}${note}`;
}

/**
 * A closed stage's head text: its degree and safety net. The Difficulty is the GM's (core p. 60 tells the players the
 * degree, not the margin), so it sits alone in a `data-gm-only` span that a player's client hides.
 */
function stageResultHtml(row) {
  if (row.missing) return ' <span class="cog-contest-stage-result">no roller result</span>';
  const parts = [escapeAttr(COG_OUTCOME_CONFIG[row.degree]?.label ?? row.degree)];
  if (row.net) parts.push(`${row.net > 0 ? '+1' : '-1'} safety net`);
  if (row.spent || row.overspent) parts.push('safety net spent');
  return ` <span class="cog-contest-stage-result">${parts.join('; ')}</span>`;
}

function challengeSummary(standing) {
  const rule = standing.legs.filter((l) => l.overspent).length;
  const spent = rule ? `${standing.spent + rule} spent, ${rule} as a Rule Break` : `${standing.spent} spent`;
  return `Stages: ${standing.passed} of ${standing.stages}. Safety nets: ${standing.nets} (${spent}).`;
}

function rowStatus(state, p, standing) {
  if (state.kind === 'race') {
    const row = standing.rows.find((r) => r.id === p.id);
    if (p.out) return `out (${p.out.reason})`;
    return row && row.places.length ? `places ${row.places.map((n) => n ?? '-').join(', ')}; sum ${row.sum}` : '';
  }
  const row = standing.chasers.find((r) => r.id === p.id);
  if (!row) return p.role === 'quarry' ? 'quarry' : '';
  return `Ground ${signed(row.ground)}${row.state === 'active' ? '' : `; ${row.state === 'out' ? row.outReason : row.state}`}`;
}

/**
 * The card's HTML from a contest wrapper.
 * @param {{ id: string, state: object }} wrapper
 * @param {{ resolve?: (uuid: string) => object|null }} [opts] actor lookup for Move (tie-breaks, the Move line)
 * @returns {string}
 */
export function buildContestCardHtml(wrapper, { resolve } = {}) {
  const w = sanitizeContestWrapper(wrapper) ?? { id: '', state: sanitizeContest(null) };
  const { state } = w;
  const kind = contestKindInfo(state.kind);
  const isChallenge = state.kind === 'challenge';
  const standing = state.kind === 'chase' ? chaseStatus(state, resolve) : isChallenge ? challengeStatus(state) : raceStandings(state, resolve);
  const anyBreak = Object.values(state.results).some((row) => Object.values(row).some((r) => r.ruleBreak));
  const legsHtml = state.legs.map((leg) => {
    const rows = state.participants.map((p) => {
      const result = state.results[leg.id]?.[p.id];
      const out = participantIsOut(state, p.id, resolve);
      // One roll decides a stage: its roller alone gets the buttons (p. 258).
      const mine = !isChallenge || leg.rollerId === p.id;
      const canRoll = mine && leg.status === 'open' && p.mode === 'roll' && !out && p.actorUuid && resolve?.(p.actorUuid)?.type !== 'mob';
      const move = contestMoveOf(p, leg, resolve, contestMoveOptions);
      const roll = canRoll
        ? `<button type="button" class="cog-contest-roll" data-action="${escapeAttr(CONTEST_ACTIONS.roll)}" data-leg-id="${escapeAttr(leg.id)}" data-participant-id="${escapeAttr(p.id)}" data-actor-uuid="${escapeAttr(p.actorUuid)}">${result ? 'Reroll' : 'Roll'}${isChallenge ? '' : ` (Move Rate ${escapeAttr(signed(moveRateMod(move.move)))})`}</button>`
        : '';
      const drop = mine && leg.status === 'open' && !p.out && p.mode === 'roll' && p.actorUuid
        ? `<button type="button" class="cog-contest-drop" data-action="${escapeAttr(CONTEST_ACTIONS.drop)}" data-leg-id="${escapeAttr(leg.id)}" data-participant-id="${escapeAttr(p.id)}" data-actor-uuid="${escapeAttr(p.actorUuid)}">Drop out</button>`
        : '';
      const propose = drop
        ? `<button type="button" class="cog-contest-propose" data-action="${escapeAttr(CONTEST_ACTIONS.propose)}" data-leg-id="${escapeAttr(leg.id)}" data-participant-id="${escapeAttr(p.id)}" data-actor-uuid="${escapeAttr(p.actorUuid)}">Propose skill</button>`
        : '';
      const assigned = participantLegSkill(p, leg);
      const overrideTag = assigned.overridden ? ` <span class="cog-contest-override">[${escapeAttr(assigned.skill)}]</span>` : '';
      return `<tr class="cog-contest-row${out ? ' cog-contest-out' : ''}" data-participant-id="${escapeAttr(p.id)}">
        <td>${escapeAttr(p.name)} <span class="cog-contest-role">${escapeAttr(p.role)}${p.mode === 'fixed' ? ', fixed' : ''}</span>${overrideTag}</td>
        <td>${resultCell(result)}</td>
        <td>${roll}${propose}${drop}</td>
      </tr>`;
    }).join('');
    const stageRow = isChallenge ? standing.legs.find((l) => l.id === leg.id) : null;
    const stageText = stageRow ? `${stageResultHtml(stageRow)}${stageRow.overspent || leg.netRuleBreak ? ` ${ruleBreakBadgeHtml()}` : ''}` : '';
    const difficulty = isChallenge ? ` <span class="cog-contest-dc" data-gm-only="true">Difficulty ${escapeAttr(leg.dc)}</span>` : '';
    return `<div class="cog-contest-leg" data-leg-id="${escapeAttr(leg.id)}" data-leg-status="${escapeAttr(leg.status)}">
      <div class="cog-contest-leg-head"><strong>${escapeAttr(leg.label)}</strong> <span class="cog-contest-check">${escapeAttr(legCheckLabel(leg))}</span> <span class="cog-contest-leg-status">[${escapeAttr(leg.status)}]</span>${difficulty}${stageText}</div>
      <table class="cog-contest-table"><tbody>${rows}</tbody></table>
    </div>`;
  }).join('');

  const summaryRows = isChallenge
    ? `<li>${escapeAttr(challengeSummary(standing))}</li>`
    : state.participants.map((p) => `<li>${escapeAttr(p.name)}: ${escapeAttr(rowStatus(state, p, standing))}</li>`).join('');
  let outcome = '';
  if (state.kind === 'race' && standing.winners.length) {
    const names = standing.winners.map((id) => state.participants.find((p) => p.id === id)?.name ?? id).join(', ');
    outcome = `<div class="cog-contest-outcome">${standing.complete ? 'Winner' : 'Leading'}: ${escapeAttr(names)}${standing.tied ? ' (tie)' : ''}</div>`;
  } else if (state.kind === 'chase' && standing.finished) {
    const names = standing.order.map((id) => state.participants.find((p) => p.id === id)?.name ?? id);
    outcome = `<div class="cog-contest-outcome">${names.length ? `Caught the quarry: ${escapeAttr(names.join(', '))}` : 'The quarry escaped.'}</div>`;
  }

  if (isChallenge && (standing.solved || standing.finished)) {
    outcome = `<div class="cog-contest-outcome">${standing.solved ? 'Solved.' : 'Not solved.'}</div>`;
  }

  return `<div class="cog-chat-card cog-contest-card" data-contest-id="${escapeAttr(w.id)}" data-contest-kind="${escapeAttr(state.kind)}" data-contest-status="${escapeAttr(state.status)}">
    <div class="cog-contest-title"><i class="fa-solid fa-flag-checkered"></i> ${escapeAttr(kind.label)} <span class="cog-contest-status">[${escapeAttr(state.status)}]</span>${anyBreak ? ` ${ruleBreakBadgeHtml()}` : ''}</div>
    ${legsHtml}
    <ul class="cog-contest-summary">${summaryRows}</ul>
    ${outcome}
  </div>`;
}
