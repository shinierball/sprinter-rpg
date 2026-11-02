/**
 * The last pick of the Attack Options pop-up.
 *
 * Each attack remembers what its user last picked (a Damage Effect, its variant, the ticked maneuvers and the mark
 * target) as a flag on the USER document: `game.user.flags['sprinter-rpg'].attackPicks[<actorId>][<itemId>]`. A User
 * document follows the account across browsers and devices, so nothing is kept in `localStorage`. The pick is a
 * preference, never round state: nothing here is read by a card or a damage roll.
 *
 * `prefill` is the one place that decides what is remembered (Q223 (a): maneuvers are, situations never are) and
 * what is dropped because using it now would be a Rule Break (a rule-breaking choice is never proposed). The module
 * is pure apart from `rememberAttackPick`, the only writer.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { attackText } from './attack-text.mjs';

export const ATTACK_PICKS_FLAG = 'attackPicks';
export const MAX_ATTACK_PICKS = 200;
const MAX_MANEUVERS = 8;
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MARK_TARGETS = Object.freeze(['attack', 'effect']);

/** The first entry of an array, the first item of a comma list, else '': never trusts the stored shape (CONTRIBUTING §4). */
function firstText(raw) {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  if (typeof val !== 'string') return '';
  if (val.includes(',')) val = val.split(',')[0];
  return val.trim();
}

/** `situation.*` tags from an array or a comma list, at most `MAX_MANEUVERS`. */
function maneuverTags(raw) {
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
  const out = [];
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const tag = entry.trim();
    if (tag.startsWith('situation.') && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_MANEUVERS) break;
  }
  return out;
}

/**
 * The storage key of an attack: the actor's id and the item's id, each matching `^[A-Za-z0-9_-]{1,64}$`.
 * An unlinked token's synthetic actor shares its base actor's id, so every token of one mob shares one pick.
 * @param {{ id?: string }|null} actor
 * @param {{ id?: string }|null} item
 * @returns {{ actorId: string, itemId: string }|null} null when either id is unusable (the attack is never remembered)
 */
export function pickKey(actor, item) {
  const actorId = typeof actor?.id === 'string' ? actor.id : '';
  const itemId = typeof item?.id === 'string' ? item.id : '';
  return KEY_PATTERN.test(actorId) && KEY_PATTERN.test(itemId) ? { actorId, itemId } : null;
}

/**
 * Sanitise a stored pick.
 * @param {unknown} raw
 * @returns {{ effect: string, variant: string, maneuvers: string[], markTarget: 'attack'|'effect', at: number }|null}
 */
export function readAttackPick(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const at = Number(raw.at);
  return {
    effect: firstText(raw.effect),
    variant: firstText(raw.variant),
    maneuvers: maneuverTags(raw.maneuvers),
    markTarget: raw.markTarget === 'attack' ? 'attack' : 'effect',
    at: Number.isFinite(at) ? at : 0
  };
}

/** All stored picks, as a plain `{ actorId: { itemId: rawPick } }` object (never throws). */
function storedPicks(user) {
  let all;
  try {
    all = typeof user?.getFlag === 'function' ? user.getFlag(SYSTEM_ID, ATTACK_PICKS_FLAG) : user?.flags?.[SYSTEM_ID]?.[ATTACK_PICKS_FLAG];
  } catch {
    all = undefined;
  }
  return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
}

/**
 * The user's last pick for an attack.
 * @param {object} user usually `game.user`
 * @returns {ReturnType<typeof readAttackPick>}
 */
export function getAttackPick(user, actor, item) {
  const key = pickKey(actor, item);
  if (!key) return null;
  const forActor = storedPicks(user)[key.actorId];
  return forActor && typeof forActor === 'object' ? readAttackPick(forActor[key.itemId]) : null;
}

/** The effect's `name`, for a hint; the model always carries it, a stale pick may not be in the model. */
const labelOf = (effect, identifier) => effect?.name || identifier;

/**
 * What the pop-up (or a skip) starts from. A remembered part is used only when using it now is clean (no Rule
 * Break); otherwise it is dropped with a hint saying why (4.1). With no pick: None, no maneuvers, no situations,
 * every pending Called Play ticked.
 *
 * @param {object} model `buildAttackOptions` result: `{ effects, maneuvers, calledPlays, isMob }`
 * @param {ReturnType<typeof readAttackPick>} pick
 * @returns {{ choices: object, dropped: Array<{ part: 'effect'|'variant', reason: string, hint: string }> }}
 */
export function prefill(model, pick) {
  const effects = Array.isArray(model?.effects) ? model.effects : [];
  const choices = {
    effects: [],
    variant: '',
    maneuvers: [],
    situations: [],
    calledPlays: (Array.isArray(model?.calledPlays) ? model.calledPlays : []).map(e => e?.id).filter(id => typeof id === 'string'),
    markTarget: pick?.markTarget === 'attack' ? 'attack' : 'effect',
    // the armed Playing to the Cameras choice (one-shot, never remembered) opens pre-selected
    cameras: typeof model?.armedCameras === 'string' ? model.armedCameras : ''
  };
  const dropped = [];
  if (!pick) return { choices, dropped };

  if (pick.effect) {
    const option = effects.find(e => e.identifier === pick.effect);
    const drop = (reason, key, data) => dropped.push({ part: 'effect', reason, hint: attackText(key, data) });
    if (!option) {
      drop('not-offered', 'COG.AttackChoices.Hint.NotOffered', {});
    } else if (!model.isMob && option.untrained) {
      drop('untrained', 'COG.AttackChoices.Hint.Untrained', { name: labelOf(option, pick.effect) });
    } else if (!model.isMob && option.cooldown && option.cooldown.ready === false) {
      drop('cooldown', 'COG.AttackChoices.Hint.Cooldown', { name: labelOf(option, pick.effect), left: option.cooldown.label ?? '' });
    } else {
      choices.effects = [pick.effect];
      if (pick.variant) {
        const variant = (option.variants ?? []).find(v => v.id === pick.variant);
        if (variant) choices.variant = variant.id;
        else dropped.push({ part: 'variant', reason: 'variant', hint: attackText('COG.AttackChoices.Hint.Variant', { rank: option.rank ?? 0 }) });
      }
    }
  }

  const offered = new Set((Array.isArray(model?.maneuvers) ? model.maneuvers : []).map(m => m.tag));
  choices.maneuvers = pick.maneuvers.filter(tag => offered.has(tag));
  return { choices, dropped };
}

/**
 * The pick a Roll stores: the first effect only (a multi-effect Rule Break is never proposed again), its variant,
 * the ticked maneuvers and the mark target. Situations and Called Plays are never remembered.
 * @param {object} choices an AttackChoices
 * @returns {{ effect: string, variant: string, maneuvers: string[], markTarget: 'attack'|'effect' }}
 */
export function pickFromChoices(choices) {
  const effect = firstText(Array.isArray(choices?.effects) ? choices.effects[0] : '');
  return {
    effect,
    variant: effect ? firstText(choices?.variant) : '',
    maneuvers: maneuverTags(choices?.maneuvers),
    markTarget: MARK_TARGETS.includes(choices?.markTarget) ? choices.markTarget : 'effect'
  };
}

/** The picks as `[actorId, itemId, at]` rows, for pruning. */
function pickRows(all) {
  const rows = [];
  for (const [actorId, items] of Object.entries(all)) {
    if (!items || typeof items !== 'object') continue;
    for (const [itemId, raw] of Object.entries(items)) rows.push({ actorId, itemId, at: Number(raw?.at) || 0 });
  }
  return rows;
}

const sameInterior = (a, b) => a && b && a.effect === b.effect && a.variant === b.variant && a.markTarget === b.markTarget
  && a.maneuvers.length === b.maneuvers.length && a.maneuvers.every((t, i) => t === b.maneuvers[i]);

/**
 * Store the pick of a pop-up Roll, only when it differs from the stored one (compared without `at`), then prune to
 * `MAX_ATTACK_PICKS` entries by oldest `at`. A player writes their own User flags, so there is no GM relay. Never
 * throws: a failed write only means the next pop-up starts from the older pick.
 * @param {object} user usually `game.user`
 * @param {object} actor
 * @param {object} item
 * @param {object} choices an AttackChoices
 * @returns {Promise<boolean>} whether a write happened
 */
export async function rememberAttackPick(user, actor, item, choices) {
  const key = pickKey(actor, item);
  if (!key || typeof user?.setFlag !== 'function') return false;
  const next = pickFromChoices(choices);
  const stored = getAttackPick(user, actor, item);
  if (stored ? sameInterior(stored, next) : (!next.effect && next.maneuvers.length === 0 && next.markTarget === 'effect')) return false;
  try {
    await user.setFlag(SYSTEM_ID, `${ATTACK_PICKS_FLAG}.${key.actorId}.${key.itemId}`, { ...next, at: Date.now() });
    const rows = pickRows(storedPicks(user));
    if (rows.length > MAX_ATTACK_PICKS && typeof user.unsetFlag === 'function') {
      const own = (r) => r.actorId === key.actorId && r.itemId === key.itemId;
      const oldest = rows.filter(r => !own(r)).sort((a, b) => a.at - b.at).slice(0, rows.length - MAX_ATTACK_PICKS);
      for (const r of oldest) await user.unsetFlag(SYSTEM_ID, `${ATTACK_PICKS_FLAG}.${r.actorId}.${r.itemId}`);
    }
    return true;
  } catch (err) {
    console.warn('Sprinter RPG | Could not remember the attack pick', err);
    return false;
  }
}
