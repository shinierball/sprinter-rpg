/**
 * The link between a spell's cast card and the attack roll that answers it.
 * An attack spell is cast first (Mana, cooldown), then attacked from the cast; an attack that answers no cast is a Rule
 * Break, never a block. Any number of attacks may answer one cast. Structured flags and tags only.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { isAttackSkill, isAuraItem } from '../tag/tag-mechanics.mjs';
import { attackText } from './attack-text.mjs';
import { combatRefFor } from '../roll/check-assists.mjs';
import { MAX_CARD_SCAN, messageList, scopeCombatId, inScope } from '../card/recent-cards.mjs';
import { firstScalar } from '../first-scalar.mjs';

const flagsOf = (message) => message?.flags?.[SYSTEM_ID] ?? null;

/** A flag read defensively as a trimmed string; arrays take the first entry, comma strings the first part. */
function idString(raw) {
  const val = firstScalar(raw);
  return typeof val === 'string' ? val.trim() : '';
}

/**
 * True when the spell's cast offers an attack roll: an `action.attack` spell that is not an aura and is a saved item.
 * @param {object} spell
 */
export function offersSpellAttack(spell) {
  return spell?.type === 'spell' && Boolean(spell.id) && isAttackSkill(spell) && !isAuraItem(spell);
}

/**
 * Flags the cast card carries when the spell offers the attack.
 * @returns {{ casterId: string|null, castSpellId: string|null, castSpellIdentifier: string|null, castCombatId: string|null, offersAttack: true }}
 */
export function castLinkFlags(actor, spell) {
  return {
    casterId: actor?.id ?? null,
    castSpellId: spell?.id ?? null,
    castSpellIdentifier: idString(spell?.system?.identifier) || null,
    castCombatId: combatRefFor(actor)?.id ?? null,
    offersAttack: true
  };
}

/** True when a message is a successful cast of `spell` by `actor` that offered the attack. */
function isCastOf(message, actor, spell) {
  const f = flagsOf(message);
  if (!f || f.offersAttack !== true || f.spellSuccess !== true) return false;
  if (!actor?.id || idString(f.casterId) !== actor.id) return false;
  const spellId = idString(f.castSpellId);
  const identifier = idString(spell?.system?.identifier);
  return Boolean((spellId && spellId === spell?.id) || (identifier && idString(f.castSpellIdentifier) === identifier));
}

/**
 * The actor's latest cast of this spell in scope, answered or not (253 b), or null. Scope is the started combat, else
 * at most an hour old (the 3.22-9 hit-card rule).
 * @param {object} actor
 * @param {object} spell
 * @param {{ now?: number }} [opts]
 * @returns {object|null} the cast card's message
 */
export function findLatestCast(actor, spell, { now = Date.now() } = {}) {
  const messages = globalThis.game?.messages;
  if (!actor?.id || !spell || !messages) return null;
  const list = messageList(messages);
  const combatId = scopeCombatId();
  const combatIdOf = (m) => idString(flagsOf(m)?.castCombatId) || null;
  for (let i = list.length - 1, scanned = 0; i >= 0 && scanned < MAX_CARD_SCAN; i--, scanned++) {
    const message = list[i];
    if (!isCastOf(message, actor, spell)) continue;
    if (message.visible === false || typeof message.id !== 'string' || !message.id) continue;
    if (!inScope(message, { combatId, now, combatIdOf })) continue;
    return message;
  }
  return null;
}

/**
 * What an attack answers, and the Rule Break reasons that come with it.
 * @param {object} actor
 * @param {object} spell
 * @param {{ castMessageId?: string, now?: number }} [options]
 * @returns {{ castMessageId: string|null, reasons: string[] }}
 */
export function castLinkFor(actor, spell, options = {}) {
  const notCast = () => ({
    castMessageId: null,
    reasons: [attackText('COG.SpellCast.Reason.NotCast', { name: spell?.name ?? '' })]
  });
  const explicit = typeof options?.castMessageId === 'string' ? options.castMessageId.trim() : '';
  if (explicit) {
    // The user picked this card: no time or combat scope.
    const message = globalThis.game?.messages?.get?.(explicit);
    return message && isCastOf(message, actor, spell) ? { castMessageId: explicit, reasons: [] } : notCast();
  }
  const found = findLatestCast(actor, spell, { now: options?.now });
  return found ? { castMessageId: found.id, reasons: [] } : notCast();
}
