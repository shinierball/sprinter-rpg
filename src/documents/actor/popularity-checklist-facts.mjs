/**
 * The facts one moment of the Popularity checklist reads for every tracked crawler: Charisma, pet, the session ledger's
 * Natural 20s and 1s, the floor-exit snapshot or the live floor and timer, the grind log and the ended day's gain.
 * Read only: nothing here writes.
 */
import { grindLogOf } from './grind-log.mjs';
import { dayIndex, SECONDS_PER_HOUR } from '../../utils/time/timing.mjs';
import { grindHoursWithin } from '../../utils/skill/grind-log.mjs';
import { GRIND_FINAL_WINDOW_HOURS } from '../../data/rules/popularity-changes.mjs';
import { dueMoments } from '../../utils/floor/popularity-checklist.mjs';
import { COGSessionEngine } from '../session/session-engine.mjs';
import { getCurrentFloor, getFloorTimer } from './actor-environment.mjs';
import { readChecklistState, readPopularityDay } from './popularity-checklist.mjs';
import { finiteOrNull as finite } from '../../utils/first-scalar.mjs';

const liveRecords = (state) => (Array.isArray(state?.applied) ? state.applied : []).filter((r) => r && !r.undoneAt);
const worldNow = () => Number(globalThis.game?.time?.worldTime) || 0;
const timestampMs = (t) => (typeof t === 'number' ? t : Date.parse(t));

/** The ledger hits (a Natural 20 or 1) a crawler has in the session since its last applied Session check. */
function ledgerCrits(session, actorId, applied) {
  if (!session) return [];
  const last = applied.filter((r) => r.moment === 'session' && (r.entries ?? []).some((e) => e.actorId === actorId)).reduce((m, r) => Math.max(m, r.at), 0);
  const since = Math.max(last, finite(session.createdAt) ?? 0);
  return (session.ledger ?? [])
    .filter((e) => e?.actorId === actorId && (Number(e.d20Result) === 20 || Number(e.d20Result) === 1) && timestampMs(e.timestamp) > since)
    .map((e) => ({ d20: Number(e.d20Result), name: String(e.name ?? '') }));
}

/**
 * The facts one moment's checklist reads for every tracked crawler of a session, plus the floor and period the check is
 * for. The Floor moment reads the floor-exit snapshot while its floor has no applied Floor record, else the live floor,
 * timer and clock. The Day moment is for the newest day a crawler's baseline closed, else the current day.
 * @param {'session'|'day'|'floor'} moment
 * @param {{ sessionId?: string }} [options] the session to read (the active one by default)
 * @returns {{ floor: number, period: { sessionId: string, day: number, floor: number }, facts: object[] }}
 */
export function gatherChecklistFacts(moment, { sessionId = '' } = {}) {
  const sId = sessionId || COGSessionEngine.getActiveSessionId() || '';
  const session = COGSessionEngine.getAllSessions().find((s) => s.id === sId) ?? null;
  const state = readChecklistState();
  const applied = liveRecords(state);
  const time = worldNow();
  const crawlers = COGSessionEngine.getPartyCrawlers({ sessionId: sId, trackedOnly: true });

  let floor = getCurrentFloor();
  let exit = null;
  if (moment === 'floor') {
    const snap = state.floorExit;
    if (snap && !applied.some((r) => r.moment === 'floor' && finite(r.period?.floor) === finite(snap.floor))) {
      floor = Number(snap.floor);
      exit = { timer: Number(snap.timer), time: Number(snap.time) };
    } else {
      exit = { timer: getFloorTimer(), time };
    }
  }

  const days = crawlers.map((a) => readPopularityDay(a)?.prev?.day).filter((d) => Number.isFinite(d));
  const day = moment === 'day' && days.length ? Math.max(...days) : dayIndex(time);

  const facts = crawlers.map((actor) => {
    const prev = readPopularityDay(actor)?.prev;
    return {
      actorId: actor.id,
      name: actor.name,
      floor,
      cha: finite(actor.system?.abilities?.cha?.value),
      popularity: Number(actor.system?.details?.popularity) || 0,
      hasPet: (actor.system?.companions?.pets ?? []).length > 0,
      partySize: crawlers.length,
      crits: moment === 'session' ? ledgerCrits(session, actor.id, applied) : [],
      exit,
      grindHours: exit ? grindHoursWithin(grindLogOf(actor), exit.time - GRIND_FINAL_WINDOW_HOURS * SECONDS_PER_HOUR, exit.time) : null,
      dayGain: moment === 'day' && prev && prev.day === day ? prev.end - prev.start : null
    };
  });
  return { floor, period: { sessionId: sId, day, floor }, facts };
}

/**
 * Which moments have a checklist waiting (the Session Manager's badges): see `dueMoments`. The ended day is the newest day
 * any tracked crawler's baseline closed.
 * @param {{ sessionId?: string }} [options] the session whose crawlers are read (the active one by default)
 * @returns {{ session: boolean, day: boolean, floor: boolean }}
 */
export function readDueMoments({ sessionId = '' } = {}) {
  const activeId = COGSessionEngine.getActiveSessionId();
  const activeSession = COGSessionEngine.getAllSessions().find((s) => s.id === activeId) ?? null;
  const crawlers = COGSessionEngine.getPartyCrawlers({ sessionId: sessionId || activeId || '', trackedOnly: true });
  const days = crawlers.map((a) => readPopularityDay(a)?.prev?.day).filter((d) => Number.isFinite(d));
  const state = readChecklistState();
  return dueMoments({ applied: state.applied, activeSession, real: Date.now(), endedDay: days.length ? Math.max(...days) : null, floorExit: state.floorExit });
}
