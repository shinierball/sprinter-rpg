/**
 * The crawler sheet's patron rows (core rulebook pp. 315-316): one row per patron item and per god with a patronage,
 * read from its patronage block (`patronageOf`). Text and the buttons a viewer may press are computed here; the template
 * only prints them.
 */
import { patronProfileOf } from '../../utils/patron/patron-profile.mjs';
import { AUDITION_CHECKS, patronageOf, patronageItems } from '../../utils/patron/patronage-state.mjs';
import { fairyTripMinutes } from '../../utils/patron/advice.mjs';
import { parseFloorNumber } from '../../utils/floor/floor-number.mjs';
import { effectiveFloor } from '../../utils/character/race-class-floor.mjs';
import { say } from '../../documents/actor/vehicle-drive-common.mjs';

const ROOT = 'COG.Patron.Block';
const BADGES = Object.freeze({ prospect: 'Prospect', auditioning: 'Auditioning', patron: 'Patron', former: 'Former' });
const ATTITUDES = Object.freeze({ opposed: 'Opposed', reluctant: 'Reluctant', willing: 'Willing', enthusiastic: 'Enthusiastic' });

const t = (key, fallback, data) => say(`${ROOT}.${key}`, fallback, data);

/** True when a patron item names a linked actor that no longer resolves. */
function linkBroken(profile) {
  if (!profile.actorUuid) return false;
  try {
    return !globalThis.fromUuidSync?.(profile.actorUuid);
  } catch {
    return true;
  }
}

/** The advice readout of an active patron: HUD chat, or the messenger fairy's minutes each way (p. 316). */
function adviceLineOf(actor, profile) {
  if (profile.messaging !== 'fairy') return say('COG.Patron.Advice.Hud', 'Advice: HUD chat');
  let apart = 0;
  if (profile.actorUuid) {
    const linked = globalThis.fromUuidSync?.(profile.actorUuid);
    const there = parseFloorNumber(linked?.system?.details?.floor);
    if (there) apart = Math.abs(there - effectiveFloor(actor));
  }
  return say('COG.Patron.Advice.Fairy', 'Advice: messenger fairy, {minutes} min each way', { minutes: fairyTripMinutes(apart) });
}

/**
 * Fill `context.patronRows`. The owner may add, make a patron, leave and (an active patron) perform and mentor; the GM
 * starts auditions, ends a patronage and sets quests and ideas. Flags the later patronage features read are all computed
 * here, so their buttons land in the template with no further context work.
 * @param {object} context
 * @param {object} actor
 */
export function buildPatronRows(context, actor) {
  const isGM = Boolean(globalThis.game?.user?.isGM);
  const editable = context.editable !== false;
  context.patronRows = patronageItems(actor?.items).map((item) => {
    const patronage = patronageOf(item);
    const profile = patronProfileOf(item);
    const { status } = patronage;
    const isGod = item.type === 'deity';
    const active = status === 'patron';
    const badges = [t(`Badge.${BADGES[status] ?? 'Prospect'}`, `[${(BADGES[status] ?? 'Prospect').toUpperCase()}]`)];
    if (isGod) badges.push(t('Badge.Deity', '[DEITY]'));
    const broken = linkBroken(profile);
    if (broken) badges.push(t('Badge.LinkBroken', '[LINK BROKEN]'));
    const auditioning = status === 'auditioning';
    return {
      id: item.id,
      name: item.name,
      img: item.img,
      title: String(item.system?.title ?? ''),
      type: item.type,
      status,
      badges,
      attitudeLabel: auditioning ? t(`Attitude.${ATTITUDES[patronage.attitude]}`, ATTITUDES[patronage.attitude], {}) : '',
      auditionProgress: auditioning
        ? t('Progress', 'Check {n} of {total}', { n: Math.min(patronage.audition.checks.length + 1, AUDITION_CHECKS), total: AUDITION_CHECKS })
        : '',
      adviceLine: active ? adviceLineOf(actor, profile) : '',
      linkBroken: broken,
      canEdit: editable,
      canDelete: editable && (isGM || patronage.endedBy !== 'murdered'),
      canMakePatron: editable && status === 'prospect',
      canLeave: editable && active,
      canAudition: isGM && editable && status === 'prospect',
      canAuditionCheck: editable && auditioning,
      canUndoAudition: isGM && editable && patronage.audition.checks.length > 0,
      canQuit: isGM && editable && !isGod && active,
      canDied: isGM && editable && !isGod && active,
      canEndDeity: isGM && editable && isGod && active,
      canPerform: editable && active,
      canMentor: editable && active,
      canQuest: isGM && editable && active,
      canIdeas: isGM && editable && active
    };
  });
}
