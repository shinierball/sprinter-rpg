/**
 * Sprinter RPG - Transformation reminder cards (7.1e).
 *
 * A cue is a moment at which a pending affliction posts a card with a Change button. Nothing here ever changes the
 * victim: only a person pressing Change does (a transformation never fires on its own). Two cues post:
 *  - `apply`: right after the affliction lands, to the GM and the carrier's owners;
 *  - `death`: when damage takes the carrier to 0 Health, to the GM only, once per lethal application.
 * `rest` and `floor` post too: `rest` to the GM and the owners after a long
 * rest, `floor` to the GM when the current floor changes (transform-cue-events.mjs calls them).
 *
 * `postCue` is the one entry point. A secret affliction is held GM-side before it is ever created (the pending store);
 * when the GM reveals it, that code creates the item and calls `postCue` like any landing.
 */
import { writeTransformState } from '../../utils/character/overlay-state.mjs';
import { transformText } from '../../utils/character/transform-text.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { registerRelayAction, dispatchRelay, getActiveGM } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { afflictionStage, transformState, cueOf, isAffliction, formEntries } from '../../utils/character/transform-rules.mjs';

const idOf = (doc) => doc?.id ?? doc?._id ?? '';

/** User ids of the GMs, or of the GMs and the actor's owners. `null` when a GM-only card has nobody to go to. */
function viewerIds(actor, { gmOnly }) {
  const me = globalThis.game?.user;
  let gms = (globalThis.ChatMessage?.getWhisperRecipients?.('GM') ?? []).map((u) => u.id).filter(Boolean);
  if (!gms.length && me?.isGM) gms = [me.id];
  if (gmOnly) return gms.length ? gms : null;
  const owners = Array.from(globalThis.game?.users ?? [])
    .filter((u) => !u.isGM && actor?.testUserPermission?.(u, 'OWNER'))
    .map((u) => u.id);
  return [...new Set([...gms, ...owners])];
}

/** The Change button: `data-action` is the chat action, the rest names the carrier and the affliction. */
function changeButton(actor, affliction) {
  const label = transformText('COG.TransformCard.Change', { actor: actor.name, affliction: affliction.name });
  return `<button type="button" class="cog-transform-change-btn" data-action="crawlerChangeVictim" data-target-uuid="${escapeAttr(actor.uuid ?? '')}" data-affliction-id="${escapeAttr(idOf(affliction))}">${escapeAttr(label)}</button>`;
}

const cardOf = (kind, lines, button) => `<div class="cog-chat-card cog-transform-card" data-transform-card="${kind}">${lines.map((l) => `<p>${escapeAttr(l)}</p>`).join('')}${button}</div>`;

function cardLines(actor, affliction, key) {
  const lines = [transformText(key, { actor: actor.name, affliction: affliction.name })];
  if (formEntries(affliction).length && actor.type !== 'crawler') lines.push(transformText('COG.TransformCard.NoRace'));
  return lines;
}

async function post(actor, content, whisper) {
  const ChatMessage = globalThis.ChatMessage;
  if (typeof ChatMessage?.create !== 'function') return null;
  const data = { speaker: ChatMessage.getSpeaker?.({ actor }), content };
  if (whisper?.length) data.whisper = whisper;
  try {
    return (await ChatMessage.create(data)) ?? null;
  } catch (err) {
    console.warn('Sprinter RPG | Could not post the transformation card:', err);
    return null;
  }
}

/**
 * A card for `actor` that carries no affliction item: to the GMs alone, or to the GMs and the owners. Null with nobody to
 * tell (a GM-only card with no GM).
 * @param {Actor} actor
 * @param {{ kind: string, lines: string[], buttons?: Array<{ cls: string, action: string, label: string }>, secretId?: string, gmOnly?: boolean }} card
 *   `kind` is the `data-transform-card` value; each button is a `data-action` button naming the held record `secretId`
 */
export async function postCueCard(actor, { kind, lines, buttons = [], secretId = '', gmOnly = true }) {
  const whisper = viewerIds(actor, { gmOnly });
  if (!actor || !whisper) return null;
  const markup = buttons.map((b) => `<button type="button" class="${escapeAttr(b.cls)}" data-action="${escapeAttr(b.action)}" data-secret-id="${escapeAttr(secretId)}">${escapeAttr(b.label)}</button>`).join('');
  return post(actor, cardOf(escapeAttr(kind), lines, markup), whisper);
}

const POSTERS = {
  /** Landing: the GM and the owners; Change is offered to whoever can write the actor. */
  async apply(actor, affliction) {
    const whisper = viewerIds(actor, { gmOnly: false });
    return post(actor, cardOf('apply', cardLines(actor, affliction, 'COG.TransformCard.Landed'), changeButton(actor, affliction)), whisper);
  },

  /** 0 Health: the GM alone (the player is not told the body is about to turn). Once per application id. */
  async death(actor, affliction, ctx = {}) {
    const whisper = viewerIds(actor, { gmOnly: true });
    if (!whisper) return null;
    const appId = String(ctx.appId ?? '');
    const state = transformState(affliction);
    if (appId && (state.deathCards ?? []).includes(appId)) return null;
    const message = await post(actor, cardOf('death', cardLines(actor, affliction, 'COG.TransformCard.Death'), changeButton(actor, affliction)), whisper);
    if (appId && message) await writeTransformState(affliction, { ...state, deathCards: [...(state.deathCards ?? []), appId] });
    return message;
  },

  /** After a long or full-day rest: the GM and the owners, like the landing card. */
  async rest(actor, affliction) {
    const whisper = viewerIds(actor, { gmOnly: false });
    return post(actor, cardOf('rest', cardLines(actor, affliction, 'COG.TransformCard.RestStill'), changeButton(actor, affliction)), whisper);
  },

  /** The current floor changed: the GM alone. */
  async floor(actor, affliction) {
    const whisper = viewerIds(actor, { gmOnly: true });
    if (!whisper) return null;
    return post(actor, cardOf('floor', cardLines(actor, affliction, 'COG.TransformCard.FloorStill'), changeButton(actor, affliction)), whisper);
  }
};

/**
 * Post the card for a cue, when the affliction is still pending and names that cue. Posts nothing for a cue with no
 * poster (an id a module registered without code) and never changes the victim.
 * @param {Actor} actor
 * @param {Item} affliction
 * @param {string} cueId a `TRANSFORM_CUES` id
 * @param {{ appId?: string }} [ctx]
 * @returns {Promise<object|null>} the posted message, or null
 */
export async function postCue(actor, affliction, cueId, ctx = {}) {
  if (!actor || !isAffliction(affliction) || afflictionStage(affliction) !== 'pending') return null;
  if (cueOf(affliction)?.id !== cueId) return null;
  const poster = POSTERS[cueId];
  return typeof poster === 'function' ? poster(actor, affliction, ctx) : null;
}

/**
 * Damage took (or may have taken) the carrier to 0 Health: post the `death` card for each pending affliction that
 * names it. Called from the damage pipeline with the application id; never throws into it.
 * @param {Actor} actor
 * @param {{ isLethal?: boolean, appId?: string }} state
 * @returns {Promise<number>} how many cards were posted
 */
export async function onLethalDamage(actor, { isLethal = false, appId = '' } = {}) {
  if (!isLethal || !actor) return 0;
  // A GM-only card a player's client creates is the player's to read (Foundry shows a whisper to its author), so a
  // player's client asks a GM's client to post it, and with no GM connected posts nothing.
  if (globalThis.game?.user?.isGM) return postLethalCards(actor, appId);
  if (!getActiveGM()) return 0;
  try {
    await dispatchRelay(GM_CARDS_RELAY, { kind: 'lethal', actorUuid: actor.uuid, appId: String(appId ?? '') });
  } catch (err) {
    console.warn('Sprinter RPG | The 0 Health transformation card request failed:', err);
  }
  return 0;
}

/** The `death` card for each pending affliction of the actor that names it, on the client that posts GM-only cards. */
async function postLethalCards(actor, appId) {
  let posted = 0;
  try {
    for (const item of Array.from(actor.items ?? [])) {
      if (await postCue(actor, item, 'death', { appId })) posted += 1;
    }
  } catch (err) {
    console.warn('Sprinter RPG | The 0 Health transformation card failed:', err);
  }
  return posted;
}

const GM_CARDS_RELAY = 'transformGmCards';

// The GM's client re-derives the afflictions from the actor; a request carries only ids. Authorised for a GM or an owner,
// and a lethal card only for an actor at 0 Health.
registerRelayAction(GM_CARDS_RELAY, {
  authorize: (payload, user) => {
    const actor = resolveActorByUuid(payload?.actorUuid);
    if (!actor) return false;
    if (!user?.isGM && !actor.testUserPermission?.(user, 'OWNER')) return false;
    return payload?.kind === 'lethal' && Number(actor.system?.attributes?.hp?.value) <= 0;
  },
  apply: async (payload) => {
    await postLethalCards(resolveActorByUuid(payload.actorUuid), String(payload.appId ?? ''));
    return true;
  }
});

/**
 * The GM-only card for a secret debuff that landed and is held GM-side (7.1f): Reveal creates it on the carrier, Keep
 * secret leaves it in the store. Nobody but the GMs is told. `held` is the pending record (only its name is used).
 * @param {Actor} actor
 * @param {{ name?: string }} held
 * @param {string} secretId the pending-store record id
 * @returns {Promise<object|null>} the posted message, or null with no GM to tell
 */
export async function postSecretCard(actor, held, secretId) {
  const whisper = viewerIds(actor, { gmOnly: true });
  if (!actor || !whisper) return null;
  const data = { actor: actor.name, affliction: held?.name ?? '' };
  const attrs = `data-secret-id="${escapeAttr(secretId)}"`;
  const reveal = `<button type="button" class="cog-transform-reveal-btn" data-action="crawlerRevealSecret" ${attrs}>${escapeAttr(transformText('COG.TransformCard.Reveal', data))}</button>`;
  const keep = `<button type="button" class="cog-transform-keep-btn" data-action="crawlerKeepSecret" ${attrs}>${escapeAttr(transformText('COG.TransformCard.Keep', data))}</button>`;
  return post(actor, cardOf('secret', [transformText('COG.TransformCard.Secret', data)], reveal + keep), whisper);
}

/**
 * The part of a cure card for transformations a cure could not revert: each with a button that reverts it as a Rule
 * Break (GM or an owner presses it). Empty when nothing was held.
 * @param {Actor} actor
 * @param {Item[]} held
 * @returns {string}
 */
export function heldCureHtml(actor, held) {
  if (!held?.length) return '';
  return held.map((affliction) => `<div class="cog-transform-held" data-affliction-id="${escapeAttr(idOf(affliction))}"><p>${escapeAttr(transformText('COG.TransformCard.Held', { actor: actor.name, affliction: affliction.name }))}</p><button type="button" class="cog-transform-revert-btn" data-action="crawlerRevertTransformation" data-target-uuid="${escapeAttr(actor.uuid ?? '')}" data-affliction-id="${escapeAttr(idOf(affliction))}">${escapeAttr(transformText('COG.TransformCard.Revert'))}</button></div>`).join('');
}
