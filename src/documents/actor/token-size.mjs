/**
 * A crawler's token follows the body's size. The target is always the squares the actor's derived size calls for
 * (a form in force wins over the stored race size); each token carries one mark, `bodySize`, saying what the system
 * last set, so a token a GM sized by hand is recognised and left alone (`tokenSizeUpdate`).
 *
 * Triggers, each idempotent: an actor update that touches `system.attributes.size` (this client's own), the exit of a
 * transformation, the crawler payload, and a sweep on the active GM at `ready`.
 */
import { actorSizeNumber, mobTokenSize, tokenSizeUpdate } from '../../data/sizes.mjs';
import { flagPath, readFlag, withFlags } from '../../utils/flags.mjs';
import { isActiveGM } from '../../utils/gm-relay.mjs';
import { activeTokenDocuments } from './actor-vision.mjs';
import { isMigrationWrite } from '../migrations/world-migration.mjs';

/** Actor types whose token follows the body. Mobs are sized at build; pets, mercenaries and vehicles by hand. */
const BODY_SIZED_TOKEN_TYPES = ['crawler'];

const MARK_KEY = 'bodySize';

const readToken = (token) => ({
  width: Number(token?.width),
  height: Number(token?.height),
  mark: readFlag(token, MARK_KEY)
});

/**
 * The prototype token fields for a body of this size: width, height and the mark, or `{}` for one square (Foundry's
 * default). Spread into a payload's `prototypeToken`.
 * @param {*} size a size id or number
 */
export function bodySizedPrototype(size) {
  const squares = mobTokenSize(size);
  return squares === 1 ? {} : withFlags({ width: squares, height: squares }, { [MARK_KEY]: squares });
}

/** The update that sets one placed token's squares and mark. */
const tokenUpdate = (next) => ({ width: next.width, height: next.height, [flagPath(MARK_KEY)]: next.mark });

/**
 * Set the prototype token and the actor's placed tokens to the squares the derived size calls for. Writes only what
 * differs; false at once for a type that is not body-sized or a user who may not write the actor.
 * @param {object} actor
 * @returns {Promise<boolean>} whether anything was written
 */
async function applyTokenSize(actor) {
  if (!actor || !BODY_SIZED_TOKEN_TYPES.includes(actor.type)) return false;
  const user = globalThis.game?.user;
  if (!(user?.isGM || actor.isOwner)) return false;
  const want = mobTokenSize(actorSizeNumber(actor));
  let wrote = false;
  if (actor.isToken) {
    const own = actor.token;
    const next = own ? tokenSizeUpdate(readToken(own), want) : null;
    if (next) {
      await own.update(tokenUpdate(next));
      wrote = true;
    }
    return wrote;
  }
  const proto = tokenSizeUpdate(readToken(actor.prototypeToken), want);
  if (proto) {
    await actor.update({
      'prototypeToken.width': proto.width,
      'prototypeToken.height': proto.height,
      [`prototypeToken.${flagPath(MARK_KEY)}`]: proto.mark
    });
    wrote = true;
  }
  for (const token of activeTokenDocuments(actor)) {
    const next = tokenSizeUpdate(readToken(token), want);
    if (!next) continue;
    await token.update(tokenUpdate(next));
    wrote = true;
  }
  return wrote;
}

/** `applyTokenSize`, a fault turned into a warning: the one call the entry points make. */
export async function followBodySize(actor) {
  try {
    return await applyTokenSize(actor);
  } catch (err) {
    console.warn('Sprinter RPG | Could not size the token to the body:', err);
    return false;
  }
}

/** `updateActor` handler: only the client that made an update touching the stored size reconciles. */
export function onActorSizeChange(actor, changes, options, userId) {
  if (isMigrationWrite(options)) return Promise.resolve(false);
  if (changes?.system?.attributes?.size === undefined) return Promise.resolve(false);
  if (userId !== globalThis.game?.user?.id) return Promise.resolve(false);
  return followBodySize(actor);
}

/** The `ready` sweep: the active GM brings every world crawler's tokens in line, one after another. */
export async function syncAllTokenSizes() {
  if (!isActiveGM()) return;
  for (const actor of Array.from(globalThis.game?.actors ?? [])) {
    if (BODY_SIZED_TOKEN_TYPES.includes(actor?.type)) await followBodySize(actor);
  }
}
