/**
 * The landing seam: what every debuff that arrives on an actor goes through, whichever route created it (Browse Debuffs,
 * a sheet drop, an aura, a theme restore, a copy from another actor, Foundry's own create). `COGItem#_preCreate` calls
 * `landingPreCreate` (strip the engine's flags, hold a secret, stamp a pending affliction) and `COGItem#_onCreate` calls
 * `landingOnCreate` (the `apply` card). The condition engine hands its decisions over in the create operation's
 * `cogLanding` option; the transformation engine marks its own creates so the seam leaves them alone.
 */
import { grantedByOf } from '../../utils/character/race-class-flags.mjs';
import { transformState, withPendingStamp, withoutEngineFlags, hasTransformBlock } from '../../utils/character/overlay-state.mjs';
import { holdSecret } from '../pending-secrets.mjs';
import { postCue } from './transform-cues.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';

const ENGINE = 'engine';
const CONDITION = 'condition';

/** Create-operation options that carry a landing: `{ ...options, cogLanding: { ...landing } }`. */
export function landingOptions(landing = {}, options = {}) {
  return { ...options, cogLanding: { ...landing } };
}

/** The options the transformation engine passes to its own creates: the seam leaves them alone. */
export function engineCreateOptions(options = {}) {
  return landingOptions({ by: ENGINE }, options);
}

const landingOf = (options) => {
  const landing = options?.cogLanding;
  return landing && typeof landing === 'object' ? landing : null;
};

/** The actor an item is being created on (a token's synthetic actor for an unlinked token), or null. */
function carrierOf(item) {
  const parent = item?.parent ?? null;
  if (!parent) return null;
  if (parent.documentName === 'ActorDelta') return parent.syntheticActor ?? null;
  return parent.items ? parent : null;
}

/** A finite number from a stamp field, or null. */
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The creation data of the item as the seam holds it: plain, without its id. */
function plainData(item) {
  const data = { ...(item.toObject?.() ?? {}), type: item.type, flags: structuredClone(item.flags ?? {}) };
  delete data._id;
  return data;
}

/**
 * Whether this create lands a secret debuff the GM must hold. A race or class grant is part of the race; a by-hand add
 * of a player's own (no `cogLanding`, a non-GM owner of the carrier) lands visibly (Question 1345 b).
 */
function holdsSecret(item, carrier, landing, user) {
  if (item.type !== 'debuff' || item.system?.secret !== true) return false;
  if (landing?.reveal === true || landing?.by === CONDITION) return false;
  if (grantedByOf(item)) return false;
  if (!landing && user && !user.isGM && carrier.testUserPermission?.(user, 'OWNER')) return false;
  return true;
}

/**
 * COGItem#_preCreate: strip, hold, stamp. Returns false only when a secret is held (the document is not created).
 * @returns {Promise<false|undefined>}
 */
export async function landingPreCreate(item, options, user) {
  const carrier = carrierOf(item);
  const landing = landingOf(options);
  if (!carrier || landing?.by === ENGINE) return undefined;

  // Strip (S3): an engine flag that names an affliction on this carrier stays, any other goes with its pause.
  const source = { type: item.type, flags: item.flags, system: item.system };
  const owns = (id) => hasTransformBlock(carrier.items.get(id));
  const stripped = withoutEngineFlags(source, owns);
  if (stripped.changed) {
    item.updateSource({ flags: stripped.data.flags }, { recursive: false });
    if (stripped.data.system !== source.system) {
      item.updateSource(item.type === 'buff' ? { 'system.active': true } : { 'system.paused': false });
    }
  }

  // Hold (S2, D10): a secret is the GM's to reveal. No notification: a player's client must not learn one exists.
  if (holdsSecret(item, carrier, landing, user)) {
    await holdSecret(carrier, plainData(item), {
      source: landing?.source ?? '',
      appId: landing?.appId ?? '',
      landedAt: finite(landing?.landedAt) ?? undefined,
      landedFloor: finite(landing?.landedFloor) ?? undefined
    });
    return false;
  }

  // Stamp (S2, D8): an affliction lands pending, with a full replacement of whatever stage a copy carried.
  if (hasTransformBlock(item)) {
    const own = transformState(item);
    const keep = landing?.keepLanding === true;
    const landedAt = finite(landing?.landedAt) ?? (keep ? finite(own.landedAt) : null) ?? (Number(globalThis.game?.time?.worldTime) || 0);
    const landedFloor = finite(landing?.landedFloor) ?? (keep ? finite(own.landedFloor) : null) ?? getCurrentFloor();
    const next = withPendingStamp({ flags: item.flags }, { landedAt, landedFloor });
    item.updateSource({ flags: next.flags }, { recursive: false });
  }
  return undefined;
}

/**
 * COGItem#_onCreate: the `apply` cue card of a pending affliction, from the client that created it. Never throws.
 */
export async function landingOnCreate(item, options, userId) {
  try {
    const landing = landingOf(options);
    if (landing?.by === ENGINE || landing?.postCue === false) return;
    if (userId !== globalThis.game?.user?.id) return;
    const carrier = carrierOf(item);
    if (!carrier || !hasTransformBlock(item)) return;
    await postCue(carrier, item, 'apply');
  } catch (err) {
    console.warn('Sprinter RPG | The landing card failed:', err);
  }
}
