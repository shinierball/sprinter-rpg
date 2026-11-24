/**
 * Reload after a Major Fail (core pp. 181-182): a Handgun or Shotgun (a Skill tagged `rule.reload`) that misses by 10 or
 * more, or on a Natural 1, needs one Action to reload before it fires again. The mark lives on the weapon used as the
 * item flag `reload`, read and written only here. Reloading spends no ammunition; the book ties it to an Action only.
 * Permissive adjudication: an Attack with a marked weapon asks a Rule Break, never blocks.
 */
import { clearFlag, readFlag, writeFlag } from '../../utils/flags.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag/tag-behaviour.mjs';
import { COG_ROLL_OUTCOMES as O } from '../session/roll-outcomes.mjs';

const RELOAD_FLAG = 'reload';

const TEXT = Object.freeze({
  'COG.Reload.Line': 'Reload needed: spend one Action to reload (core pp. 181-182).',
  'COG.Reload.Button': 'Reload',
  'COG.Reload.Badge': '[RELOAD]',
  'COG.Reload.GateTitle': 'Weapon Not Reloaded',
  'COG.Reload.GateMessage': '{name} is not reloaded (core pp. 181-182: one Action after a Major Fail). Attack anyway as a Rule Break?',
  'COG.Reload.ActionLabel': 'Reload {name}',
  'COG.Reload.NotOwner': 'You do not own {name}.'
});

/** A reload string by its `COG.Reload.<key>` lang key (English fallback without a catalogue). */
export const reloadText = langText(TEXT);

/** The reload mark on a weapon, `{ needed: true, at }`, or null when it is loaded. */
export function readReload(item) {
  const mark = readFlag(item, RELOAD_FLAG);
  return mark && typeof mark === 'object' && mark.needed === true ? { needed: true, at: typeof mark.at === 'string' ? mark.at : '' } : null;
}

/** Mark the weapon as needing a reload since the card `messageId`. */
export function markReload(item, messageId) {
  return writeFlag(item, RELOAD_FLAG, { needed: true, at: typeof messageId === 'string' ? messageId : '' });
}

/** The weapon is loaded again. */
export function clearReload(item) {
  return clearFlag(item, RELOAD_FLAG);
}

/** Whether a weapon's reload mark shows as a badge on the sheet (the mark is set). */
export function showsReloadBadge(item) {
  return readReload(item) !== null;
}

/**
 * The gate of an Attack with a weapon that still needs its reload: asks a Rule Break first (never a block). The mark stays
 * on a confirmed Attack.
 * @param {object} actor the attacker
 * @param {object} item the weapon used
 * @param {{ options?: object }} [params] the attack's options (`ruleBreak`, `interactive`)
 * @returns {Promise<{ proceed: boolean, flags: object }>}
 */
export async function gateWeaponReload(actor, item, { options = {} } = {}) {
  const clear = { proceed: true, flags: {} };
  if (!readReload(item)) return clear;
  const verdict = await confirmRuleBreak({
    title: reloadText('COG.Reload.GateTitle'),
    message: reloadText('COG.Reload.GateMessage', { name: item.name || actor?.name || '' }),
    options
  });
  return verdict.confirmed ? { proceed: true, flags: { ruleBreak: true } } : { proceed: false, flags: {} };
}

/**
 * Whether an Attack leaves its weapon needing a reload: the roll is tagged `rule.reload` and
 * the first target's degree is a Major Fail or worse.
 * @param {{ tags: Iterable<string>, row: object|null|undefined }} p `row`: the first target's row
 */
export function needsReloadAfter({ tags, row }) {
  if (!hasRuleFlag([...(tags ?? [])], RULE_FLAGS.reload)) return false;
  return row?.outcomeId === O.MAJOR_FAILURE || row?.outcomeId === O.CRITICAL_FAILURE;
}

/** The Attack card's reload line with its Reload button. */
export function reloadLineHtml(actor, item) {
  return `<div class="cog-reload-line" style="margin-top: 6px; font-size: 11px;"><i class="fa-solid fa-gun"></i> ${escapeAttr(reloadText('COG.Reload.Line'))} `
    + `<button type="button" class="cog-assist-offer-btn" data-action="crawlerReloadWeapon" data-actor-uuid="${escapeAttr(actor.uuid)}" data-item-id="${escapeAttr(item.id)}">${escapeAttr(reloadText('COG.Reload.Button'))}</button></div>`;
}
