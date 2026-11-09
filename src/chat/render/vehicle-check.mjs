/**
 * Render-time block on vehicle check cards (3.44d).
 *
 * The card's flags are the truth (`flags.sprinter-rpg.check` and the GM's `vehicleResult`); this module only decorates:
 * the Difficulty and the Table 6 result line in our words, the Critical choice, the after-roll offers this user may click
 * (reroll, degree shift) and the GM's "Board anyway" after a failed boarding check. Markup is built with
 * createElement/textContent: names and labels are user text and never go through innerHTML.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { readCheckRecord, isSuccessOutcome } from '../../utils/roll/check-assists.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { resultEffect, VEHICLE_CHECK_KINDS } from '../../data/rules/vehicle-rules.mjs';
import { VEHICLE_CARD_FLAGS } from '../../documents/actor/vehicle-drive-common.mjs';
import { RAM_FLAGS } from '../../documents/actor/vehicle-ram.mjs';
import { vehicleCardInfo } from '../../documents/actor/vehicle-after-roll.mjs';
import { userOwnsActor } from '../../documents/actor/personal-space-links.mjs';

/** English fallbacks of the `COG.VehicleCheck.*` keys in lang/en.json (the headless test world has no i18n). */
const TEXT = Object.freeze({
  Difficulty: 'Difficulty {dc}',
  DifficultyOpen: 'Difficulty not set',
  Stopped: 'Stopped: the vehicle comes to a halt.',
  NotStopped: 'The vehicle does not stop. The GM decides what happens.',
  Boarded: 'Made it aboard.',
  NotBoarded: 'Did not make it aboard.',
  BoardAnyway: 'Board anyway (Rule Break)',
  Offer: '{label} ({source})',
  OfferReroll: 'Reroll: {label}',
  OfferShift: 'Use {label}',
  Choose: 'Take instead: {label}',
  RamHit: 'The ram connects.',
  RamMiss: 'The ram misses.',
  EvadeClear: 'The vehicle swerves clear.',
  EvadeHit: 'The hit lands.',
  RamDamage: 'Roll ram damage',
  RuleBreak: 'Rule Break: not the driver, or above the available Move.'
});

function vcText(key, data = {}) {
  const full = `COG.VehicleCheck.${key}`;
  const i18n = globalThis.game?.i18n;
  try {
    const s = Object.keys(data).length ? i18n?.format?.(full, data) : i18n?.localize?.(full);
    if (typeof s === 'string' && s && s !== full) return s;
  } catch {
    // fall through to the fallback
  }
  return Object.entries(data).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), TEXT[key] ?? full);
}

/** A lang key's text, else the fallback (the key's last segment). */
function langText(key, fallback) {
  try {
    const s = globalThis.game?.i18n?.localize?.(key);
    if (typeof s === 'string' && s && s !== key) return s;
  } catch {
    // fall through
  }
  return fallback;
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(doc, label, action, data) {
  const b = el(doc, 'button', 'cog-vehicle-check__btn', label);
  b.type = 'button';
  b.dataset.action = action;
  for (const [k, v] of Object.entries(data)) b.dataset[k] = String(v);
  return b;
}

const cardResult = (message) => message?.flags?.[SYSTEM_ID]?.[VEHICLE_CARD_FLAGS.result] ?? null;

/**
 * Add the vehicle block to a rendered check card (nothing for any other card).
 * @param {HTMLElement} root the rendered message element
 * @param {ChatMessage} message
 */
export function renderVehicleCheck(root, message) {
  const record = readCheckRecord(message);
  const ref = record?.vehicle;
  const host = root?.querySelector?.('.message-content') ?? root;
  if (!ref || !host?.ownerDocument) return;
  host.querySelector?.('.cog-vehicle-check')?.remove?.();
  const doc = host.ownerDocument;
  const def = VEHICLE_CHECK_KINDS[ref.kind];
  const info = vehicleCardInfo(message);
  const outcome = info?.outcome ?? null;
  const block = el(doc, 'div', 'cog-vehicle-check');
  block.dataset.vehicleKind = ref.kind;

  block.append(el(doc, 'p', 'cog-vehicle-check__dc',
    ref.dc === null ? vcText('DifficultyOpen') : vcText('Difficulty', { dc: ref.dc })));

  const user = globalThis.game?.user;
  const stored = info?.vehicle?.system?.drive?.result ?? {};
  const isStored = Boolean(info) && stored.messageId === message.id;
  const settled = cardResult(message);

  if (outcome && def?.resolve === 'table6') {
    const choice = isStored ? stored.choice : (settled?.choice ?? '');
    const effect = resultEffect(outcome, choice);
    block.append(el(doc, 'p', 'cog-vehicle-check__result', langText(effect.label, effect.outcome)));
    const canChoose = isStored && (userOwnsActor(info.vehicle, user) || userOwnsActor(resolveActorByUuid(stored.driverUuid), user));
    if (canChoose && effect.choices.length > 1) {
      for (const c of effect.choices.filter((x) => x.id !== effect.choice)) {
        block.append(button(doc, vcText('Choose', { label: langText(c.label, c.id) }), 'crawlerVehicleChoose', { choice: c.id }));
      }
    }
    if (isStored && stored.ruleBreak) block.append(el(doc, 'p', 'cog-vehicle-check__rule-break', vcText('RuleBreak')));
  } else if (outcome && def?.resolve === 'stop') {
    block.append(el(doc, 'p', 'cog-vehicle-check__result', vcText(settled?.note === 'gm' ? 'NotStopped' : 'Stopped')));
  } else if (outcome && def?.resolve === 'ram') {
    const hit = isSuccessOutcome(outcome);
    block.append(el(doc, 'p', 'cog-vehicle-check__result', vcText(hit ? 'RamHit' : 'RamMiss')));
    const rolled = Boolean(message?.flags?.[SYSTEM_ID]?.[RAM_FLAGS.rolled]);
    if (hit && !rolled && (user?.isGM || userOwnsActor(info.roller, user))) block.append(button(doc, vcText('RamDamage'), 'crawlerVehicleRamDamage', {}));
  } else if (outcome && def?.resolve === 'evade') {
    block.append(el(doc, 'p', 'cog-vehicle-check__result', vcText(isSuccessOutcome(outcome) ? 'EvadeClear' : 'EvadeHit')));
  } else if (outcome && def?.resolve === 'board') {
    const made = isSuccessOutcome(outcome);
    const aboard = (info.vehicle.system?.occupants ?? []).some((o) => o?.uuid === record.rollerUuid);
    block.append(el(doc, 'p', 'cog-vehicle-check__result', vcText(made ? 'Boarded' : 'NotBoarded')));
    if (!made && !aboard && user?.isGM) block.append(button(doc, vcText('BoardAnyway'), 'crawlerVehicleBoardAnyway', {}));
  }

  if (info && userOwnsActor(info.roller, user)) {
    for (const offer of info.offers) {
      const label = vcText(offer.kind === 'reroll' ? 'OfferReroll' : 'OfferShift', { label: offer.label });
      const b = button(doc, `${label}${offer.sourceName ? ` (${offer.sourceName})` : ''}`, 'crawlerVehicleOffer', { rowKey: offer.rowKey, offerKind: offer.kind });
      block.append(b);
    }
  }
  host.append(block);
}
