/**
 * Sprinter RPG - The moments that post transformation cue cards: a long rest, a floor change.
 *
 * Nothing here changes a victim: a card carries a Change button and only a person
 * pressing it changes anyone. Held secrets (pending-secrets.mjs) with the same cue get a GM-only card with Reveal and
 * Change now; the player is never told one exists, so a rest with no GM connected posts and warns nothing.
 */
import { registerRelayAction, dispatchRelay, getActiveGM, isActiveGM } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { restLevelOf, REST_LEVELS } from '../../utils/time/rest-durations.mjs';
import { transformText } from '../../utils/character/transform-text.mjs';
import { writeTransformState } from '../../utils/character/overlay-state.mjs';
import { afflictionStage, cueOf, cureWindowOpen, isAffliction, transformState } from '../../utils/character/transform-rules.mjs';
import { postCue, postCueCard } from './transform-cues.mjs';
import { listPending, carriers } from '../pending-secrets.mjs';

const HELD_REST_RELAY = 'transformHeldRestCards';
const HOUR_RESTS = ['1hour', '1h', 'hour'];

/** Whether a rest type is a long or full-day rest (an hour's rest and a short rest post nothing). */
const isLongRest = (restType) => {
  const type = String(restType ?? 'long').toLowerCase().trim();
  return !HOUR_RESTS.includes(type) && restLevelOf(type) >= REST_LEVELS.long_rest;
};

/** The GM-only card for a held affliction whose cue came up: Reveal and Change now. */
async function postHeldCueCard(record, cue) {
  const actor = resolveActorByUuid(record.actorUuid);
  if (!actor) return null;
  const data = { actor: actor.name, affliction: record.name ?? '' };
  const buttons = [
    { cls: 'cog-transform-reveal-btn', action: 'crawlerRevealSecret', label: transformText('COG.TransformCard.Reveal', data) },
    { cls: 'cog-transform-change-now-btn', action: 'crawlerChangeSecret', label: transformText('COG.TransformCard.ChangeNow', data) }
  ];
  const key = cue === 'rest' ? 'COG.TransformCard.HeldRest' : 'COG.TransformCard.HeldFloor';
  return postCueCard(actor, { kind: `held-${cue}`, lines: [transformText(key, data)], buttons, secretId: record.id });
}

/** Held affliction records whose debuff names `cue`, for one actor (or every actor when `actorUuid` is empty). */
const heldWithCue = (cue, actorUuid = '') => listPending().filter((r) => (!actorUuid || r.actorUuid === actorUuid) && isAffliction(r.debuffData) && cueOf(r.debuffData)?.id === cue);

async function postHeldRestCards(actor) {
  let posted = 0;
  for (const record of heldWithCue('rest', actor.uuid)) if (await postHeldCueCard(record, 'rest')) posted += 1;
  return posted;
}

// A player's client cannot post a GM-only card (Foundry shows a whisper to its author), so it asks the GM's client. The
// request carries only the actor; the GM's client reads the held records itself.
registerRelayAction(HELD_REST_RELAY, {
  authorize: (payload, user) => {
    const actor = resolveActorByUuid(payload?.actorUuid);
    return Boolean(actor && (user?.isGM || actor.testUserPermission?.(user, 'OWNER')));
  },
  apply: async (payload) => {
    const actor = resolveActorByUuid(payload.actorUuid);
    if (actor) await postHeldRestCards(actor);
    return true;
  }
});

/**
 * A long or full-day rest ended: each pending affliction of the actor with the `rest` cue posts its card (GM and owners),
 * and each held secret with that cue gets a GM-only card. Never throws into the rest.
 * @param {Actor} actor
 * @param {string} restType
 * @returns {Promise<number>} cards posted by this client
 */
export async function postRestCues(actor, restType) {
  if (!actor || !isLongRest(restType)) return 0;
  let posted = 0;
  try {
    for (const item of Array.from(actor.items ?? [])) if (await postCue(actor, item, 'rest')) posted += 1;
    if (!heldWithCue('rest', actor.uuid).length) return posted;
    if (globalThis.game?.user?.isGM) return posted + (await postHeldRestCards(actor));
    if (getActiveGM()) await dispatchRelay(HELD_REST_RELAY, { actorUuid: actor.uuid });
  } catch (err) {
    console.warn('Sprinter RPG | The rest transformation cards failed:', err);
  }
  return posted;
}

/** A changed affliction whose cure window was open where it landed and is closed now: tell the GM and the owners once. */
async function noticeClosedWindow(actor, item, floor) {
  if (afflictionStage(item) !== 'changed') return 0;
  const state = transformState(item);
  if (state.windowNoticed) return 0;
  if (!cureWindowOpen(item, { floor: state.landedFloor }) || cureWindowOpen(item, { floor })) return 0;
  const lines = [transformText('COG.TransformCard.WindowClosed', { actor: actor.name, affliction: item.name })];
  const message = await postCueCard(actor, { kind: 'window', lines, gmOnly: false });
  if (message) await writeTransformState(item, { ...state, windowNoticed: true });
  return message ? 1 : 0;
}

/**
 * The current floor changed. On the active GM's client only (one client posts, once): a GM card for each pending
 * affliction with the `floor` cue and each held secret with it, and the closed-window notice for each changed one.
 * Not awaited by the setting handler; never throws into it.
 * @returns {Promise<number>} cards posted
 */
export async function onFloorChanged() {
  if (!isActiveGM()) return 0;
  const floor = getCurrentFloor();
  let posted = 0;
  try {
    for (const actor of carriers()) {
      for (const item of Array.from(actor.items ?? [])) {
        if (!isAffliction(item)) continue;
        if (await postCue(actor, item, 'floor')) posted += 1;
        posted += await noticeClosedWindow(actor, item, floor);
      }
    }
    for (const record of heldWithCue('floor')) if (await postHeldCueCard(record, 'floor')) posted += 1;
  } catch (err) {
    console.warn('Sprinter RPG | The floor transformation cards failed:', err);
  }
  return posted;
}
