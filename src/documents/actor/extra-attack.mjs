/**
 * The free extra Attack of a Rank Upgrade (core pp. 178-182): a reached Upgrade tier tagged `action.extra_attack` gives
 * one extra Attack with Disadvantage that costs no Action. The Attack card offers it as a button; the new card offers the
 * button again only while more are owed. Nothing is recorded on the action ledger.
 */
import { extraAttacksOf } from '../../utils/tag/tag-mechanics.mjs';
import { getItemRank } from '../../utils/skill/rank-breaks.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { langText } from '../../utils/lang-text.mjs';

const TEXT = Object.freeze({
  'COG.ExtraAttack.Button': 'Extra free Attack (Disadvantage)',
  'COG.ExtraAttack.Tip': 'Rank {rank} Upgrade: costs no Action',
  'COG.ExtraAttack.UsedTitle': 'Extra Attack Already Taken',
  'COG.ExtraAttack.UsedMessage': 'The extra free Attack on this card has already been taken. Take it again as a Rule Break?',
  'COG.ExtraAttack.NotOwner': 'You do not own {name}.'
});

/** An extra-attack string by its `COG.ExtraAttack.<key>` lang key (English fallback without a catalogue). */
export const extraAttackText = langText(TEXT);

/**
 * The button HTML of one Attack card, or '' when no extra Attack is owed.
 * @param {{ actor: object, item: object, skill?: object|null, extraAttack?: { remaining?: number }|null }} p
 *   `skill`: the Skill whose reached Upgrades give the grant; `extraAttack`: the option an extra Attack was rolled with
 */
export function extraAttackRider({ actor, item, skill = null, extraAttack = null }) {
  const source = skill ?? (item.type === 'skill' ? item : null);
  const remaining = extraAttack ? Math.max(0, Math.floor(Number(extraAttack.remaining) || 0)) : (source ? extraAttacksOf(source) : 0);
  if (remaining <= 0) return '';
  const tip = extraAttackText('COG.ExtraAttack.Tip', { rank: source ? getItemRank(source) : 0 });
  return `<div class="cog-extra-attack" style="margin-top: 6px;"><button type="button" class="cog-assist-offer-btn" data-action="crawlerExtraAttack" data-actor-uuid="${escapeAttr(actor.uuid)}" data-item-id="${escapeAttr(item.id)}" data-remaining="${escapeAttr(remaining)}" data-tooltip-text="${escapeAttr(tip)}">${escapeAttr(extraAttackText('COG.ExtraAttack.Button'))}</button></div>`;
}
