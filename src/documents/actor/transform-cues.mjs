/**
 * Sprinter RPG - Transformation reminder cards (7.1e).
 *
 * A cue is a moment at which a pending affliction posts a card with a Change button. Nothing here ever changes the
 * victim: only a person pressing Change does (a transformation never fires on its own). Two cues post:
 *  - `apply`: right after the affliction lands, to the GM and the carrier's owners;
 *  - `death`: when damage takes the carrier to 0 Health, to the GM only, once per lethal application.
 * `rest` and `floor` stay registered (transform-rules.mjs) but have no poster, so they are inert until a later release.
 *
 * `postCue` is the one entry point. A secret affliction is held GM-side before it is ever created (the pending store);
 * when the GM reveals it, that code creates the item and calls `postCue` like any landing.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { afflictionStage, transformState, cueOf, isAffliction, formEntries } from '../../utils/character/transform-rules.mjs';

/** English defaults, identical to the `COG.TransformCard` entries in lang/en.json (Foundry's i18n wins when it has the key). */
const TRANSFORM_CARD_TEXT = Object.freeze({
  'COG.TransformCard.Landed': '{affliction} landed on {actor}.',
  'COG.TransformCard.Death': '{actor} is at 0 Health with {affliction} pending.',
  'COG.TransformCard.Change': 'Change {actor} now',
  'COG.TransformCard.NoRace': 'Only crawlers change race; the added effects still apply.',
  'COG.TransformCard.Held': '{actor} is held by {affliction}: its cure window is closed.',
  'COG.TransformCard.Revert': 'Revert as a Rule Break',
  'COG.TransformCard.NotPending': '{affliction} is no longer waiting to change {actor}.',
  'COG.TransformCard.NotAllowed': 'Only the GM or an owner of {actor} can do that.',
  'COG.TransformCard.NotFound': 'That character or affliction could not be found.',
  'COG.TransformCard.RefusePolicy': 'This world does not allow Rule Breaks.',
  'COG.TransformCard.Secret': '{affliction} landed on {actor}. It is held secret.',
  'COG.TransformCard.Reveal': 'Reveal to the player',
  'COG.TransformCard.Keep': 'Keep secret',
  'COG.TransformCard.SecretKept': '{affliction} stays secret on {actor}. Reveal it from the Session Manager Secrets tab.',
  'COG.TransformCard.SecretGone': 'That secret is no longer held.',
  'COG.TransformCard.GMOnly': 'Only the GM can do that.'
});

export function transformCardText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return String(TRANSFORM_CARD_TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

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
  const label = transformCardText('COG.TransformCard.Change', { actor: actor.name, affliction: affliction.name });
  return `<button type="button" class="cog-transform-change-btn" data-action="crawlerChangeVictim" data-target-uuid="${escapeAttr(actor.uuid ?? '')}" data-affliction-id="${escapeAttr(idOf(affliction))}">${escapeAttr(label)}</button>`;
}

const cardOf = (kind, lines, button) => `<div class="cog-chat-card cog-transform-card" data-transform-card="${kind}">${lines.map((l) => `<p>${l}</p>`).join('')}${button}</div>`;

function cardLines(actor, affliction, key) {
  const lines = [escapeAttr(transformCardText(key, { actor: actor.name, affliction: affliction.name }))];
  if (formEntries(affliction).length && actor.type !== 'crawler') lines.push(escapeAttr(transformCardText('COG.TransformCard.NoRace')));
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
    if (appId && message) await affliction.setFlag(SYSTEM_ID, 'transformation', { ...state, deathCards: [...(state.deathCards ?? []), appId] });
    return message;
  }
};

/**
 * Post the card for a cue, when the affliction is still pending and names that cue. Posts nothing for a cue with no
 * poster (`rest`, `floor`, or an id a module registered without code) and never changes the victim.
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
  const reveal = `<button type="button" class="cog-transform-reveal-btn" data-action="crawlerRevealSecret" ${attrs}>${escapeAttr(transformCardText('COG.TransformCard.Reveal', data))}</button>`;
  const keep = `<button type="button" class="cog-transform-keep-btn" data-action="crawlerKeepSecret" ${attrs}>${escapeAttr(transformCardText('COG.TransformCard.Keep', data))}</button>`;
  return post(actor, cardOf('secret', [escapeAttr(transformCardText('COG.TransformCard.Secret', data))], reveal + keep), whisper);
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
  return held.map((affliction) => `<div class="cog-transform-held" data-affliction-id="${escapeAttr(idOf(affliction))}"><p>${escapeAttr(transformCardText('COG.TransformCard.Held', { actor: actor.name, affliction: affliction.name }))}</p><button type="button" class="cog-transform-revert-btn" data-action="crawlerRevertTransformation" data-target-uuid="${escapeAttr(actor.uuid ?? '')}" data-affliction-id="${escapeAttr(idOf(affliction))}">${escapeAttr(transformCardText('COG.TransformCard.Revert'))}</button></div>`).join('');
}
