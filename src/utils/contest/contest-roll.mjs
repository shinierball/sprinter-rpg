/**
 * src/utils/contest/contest-roll.mjs
 * `options.contest` on `rollSkill` / `rollStat`: a check made for one
 * leg of a race or chase. The reference is sanitised here; the roll adds a labelled Move Rate line, tags its context
 * `contest.race` / `contest.chase`, and stamps the check record with `{ messageId, legId, participantId }`.
 * Pure: no Foundry globals.
 */
import { CONTEST_TAGS } from '../../data/tag-vocabulary.mjs';
import { moveRateMod } from './contest-engine.mjs';

const text = (raw) => {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  return typeof val === 'string' ? val.trim().slice(0, 120) : '';
};

/**
 * The contest reference of a roll's options, or null when the roll is not a contest leg (no/invalid `kind`).
 * `moveMod` is trusted only as a finite non-negative whole number; otherwise it is derived from `move` when given.
 * @param {unknown} raw `options.contest`
 * @returns {{ kind: 'race'|'chase', messageId: string, legId: string, participantId: string, moveMod: number, moveNote: string, tag: string }|null}
 */
export function sanitizeContestRef(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const kind = text(raw.kind);
  if (!Object.hasOwn(CONTEST_TAGS, kind)) return null;
  let mod = Number(raw.moveMod);
  if (raw.moveMod === null || raw.moveMod === '' || typeof raw.moveMod === 'boolean' || !Number.isFinite(mod)) mod = moveRateMod(raw.move);
  return {
    kind,
    messageId: text(raw.messageId),
    legId: text(raw.legId),
    participantId: text(raw.participantId),
    moveMod: Math.max(0, Math.trunc(mod)),
    moveNote: text(raw.moveNote),
    tag: CONTEST_TAGS[kind]
  };
}

/** The flat Move Rate line a contest roll adds to its breakdown, or null when there is none to show. */
export function moveLine(contest) {
  if (!contest || !contest.moveMod) return null;
  return `Move Rate +${contest.moveMod}${contest.moveNote ? ` (${contest.moveNote})` : ''}`;
}
