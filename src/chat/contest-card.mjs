/**
 * src/chat/contest-card.mjs
 * The contest chat card: one card per race or chase, rendered from
 * its state. The state lives on the message under `flags.sprinter-rpg.contestState` as `{ id, state }`; `id` is the
 * contest's own id (stable across a re-post, see contest-service.mjs), `state` is the engine's v1 state. Everything on
 * the card is derived from the state (placements, Ground, who is out), so the card can be rebuilt at any time.
 *
 * The flag is named `contestState`, not `contest`: a skill card already stores its opposed-check block under `contest`.
 * The HTML is built here as a pure function (like the floor arrival card). Per-viewer visibility (a Roll button only
 * for the actors the viewer owns) is a render-time step, chat/render/contest.mjs.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { sanitizeContest, raceStandings, chaseStatus, contestMoveOf, moveRateMod, participantLegSkill } from '../utils/contest/contest-engine.mjs';
import { contestMoveOptions } from '../documents/actor/vehicle-contest.mjs';
import { contestKindInfo } from '../data/rules/contest-rules.mjs';
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

/**
 * The sanitised contest wrapper on a chat message, or null when it is not a contest card. Only a GM-authored message
 * counts: the contest id is public, so a player's message carrying it must never read as the contest (3.56c, A-S2).
 */
export function readContest(message) {
  if (!isGmAuthored(message)) return null;
  const raw = typeof message?.getFlag === 'function'
    ? message.getFlag(SYSTEM_ID, CONTEST_FLAG)
    : message?.flags?.[SYSTEM_ID]?.[CONTEST_FLAG];
  return sanitizeContestWrapper(raw);
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
  const standing = state.kind === 'chase' ? chaseStatus(state, resolve) : raceStandings(state, resolve);
  const anyBreak = Object.values(state.results).some((row) => Object.values(row).some((r) => r.ruleBreak));
  const legsHtml = state.legs.map((leg) => {
    const rows = state.participants.map((p) => {
      const result = state.results[leg.id]?.[p.id];
      const out = participantIsOut(state, p.id, resolve);
      const canRoll = leg.status === 'open' && p.mode === 'roll' && !out && p.actorUuid && resolve?.(p.actorUuid)?.type !== 'mob';
      const move = contestMoveOf(p, leg, resolve, contestMoveOptions);
      const roll = canRoll
        ? `<button type="button" class="cog-contest-roll" data-action="${CONTEST_ACTIONS.roll}" data-leg-id="${escapeAttr(leg.id)}" data-participant-id="${escapeAttr(p.id)}" data-actor-uuid="${escapeAttr(p.actorUuid)}">${result ? 'Reroll' : 'Roll'} (Move Rate ${signed(moveRateMod(move.move))})</button>`
        : '';
      const drop = leg.status === 'open' && !p.out && p.mode === 'roll' && p.actorUuid
        ? `<button type="button" class="cog-contest-drop" data-action="${CONTEST_ACTIONS.drop}" data-leg-id="${escapeAttr(leg.id)}" data-participant-id="${escapeAttr(p.id)}" data-actor-uuid="${escapeAttr(p.actorUuid)}">Drop out</button>`
        : '';
      const propose = drop
        ? `<button type="button" class="cog-contest-propose" data-action="${CONTEST_ACTIONS.propose}" data-leg-id="${escapeAttr(leg.id)}" data-participant-id="${escapeAttr(p.id)}" data-actor-uuid="${escapeAttr(p.actorUuid)}">Propose skill</button>`
        : '';
      const assigned = participantLegSkill(p, leg);
      const overrideTag = assigned.overridden ? ` <span class="cog-contest-override">[${escapeAttr(assigned.skill)}]</span>` : '';
      return `<tr class="cog-contest-row${out ? ' cog-contest-out' : ''}" data-participant-id="${escapeAttr(p.id)}">
        <td>${escapeAttr(p.name)} <span class="cog-contest-role">${escapeAttr(p.role)}${p.mode === 'fixed' ? ', fixed' : ''}</span>${overrideTag}</td>
        <td>${resultCell(result)}</td>
        <td>${roll}${propose}${drop}</td>
      </tr>`;
    }).join('');
    return `<div class="cog-contest-leg" data-leg-id="${escapeAttr(leg.id)}" data-leg-status="${escapeAttr(leg.status)}">
      <div class="cog-contest-leg-head"><strong>${escapeAttr(leg.label)}</strong> <span class="cog-contest-check">${escapeAttr(legCheckLabel(leg))}</span> <span class="cog-contest-leg-status">[${escapeAttr(leg.status)}]</span></div>
      <table class="cog-contest-table"><tbody>${rows}</tbody></table>
    </div>`;
  }).join('');

  const summaryRows = state.participants.map((p) => `<li>${escapeAttr(p.name)}: ${escapeAttr(rowStatus(state, p, standing))}</li>`).join('');
  let outcome = '';
  if (state.kind === 'race' && standing.winners.length) {
    const names = standing.winners.map((id) => state.participants.find((p) => p.id === id)?.name ?? id).join(', ');
    outcome = `<div class="cog-contest-outcome">${standing.complete ? 'Winner' : 'Leading'}: ${escapeAttr(names)}${standing.tied ? ' (tie)' : ''}</div>`;
  } else if (state.kind === 'chase' && standing.finished) {
    const names = standing.order.map((id) => state.participants.find((p) => p.id === id)?.name ?? id);
    outcome = `<div class="cog-contest-outcome">${names.length ? `Caught the quarry: ${escapeAttr(names.join(', '))}` : 'The quarry escaped.'}</div>`;
  }

  return `<div class="cog-chat-card cog-contest-card" data-contest-id="${escapeAttr(w.id)}" data-contest-kind="${escapeAttr(state.kind)}" data-contest-status="${escapeAttr(state.status)}">
    <div class="cog-contest-title"><i class="fa-solid fa-flag-checkered"></i> ${escapeAttr(kind.label)} <span class="cog-contest-status">[${escapeAttr(state.status)}]</span> <span class="cog-contest-floor">Floor ${escapeAttr(state.floor)}</span>${anyBreak ? ` ${ruleBreakBadgeHtml()}` : ''}</div>
    ${legsHtml}
    <ul class="cog-contest-summary">${summaryRows}</ul>
    ${outcome}
  </div>`;
}
