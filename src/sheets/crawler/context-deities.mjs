/**
 * The crawler sheet's deity block: one row per embedded deity, read from its bond (`bondOf`). Text and the buttons a
 * viewer may press are computed here; the template only prints them.
 */
import { bondOf, WORSHIP_TIERS } from '../../utils/deity/worship-state.mjs';
import { patronageOf } from '../../utils/patron/patronage-state.mjs';
import { WORSHIP_TRACKING } from '../../utils/deity/devotion.mjs';
import { worshipTrackingMode } from '../../documents/actor/devotion.mjs';
import { say } from '../../documents/actor/vehicle-drive-common.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';

const TIER_KEYS = Object.freeze(['', 'Acolyte', 'Devotee', 'Zealot']);
const ROOT = 'COG.Deity.Sheet.Block';

const t = (key) => globalThis.game?.i18n?.localize?.(`${ROOT}.${key}`) ?? `${ROOT}.${key}`;

/** The devotion readout under the badges: the streak (daily tracking) or this Floor's count (per-Floor tracking). */
function devotionLine(bond, mode) {
  if (mode === WORSHIP_TRACKING.day) return say(`${ROOT}.Streak`, 'Streak: {n}', { n: bond.streak });
  if (mode === WORSHIP_TRACKING.floor) {
    const here = bond.floorOfferings.floor === String(getCurrentFloor());
    return say(`${ROOT}.FloorOfferings`, 'Offerings this Floor: {n}', { n: here ? bond.floorOfferings.count : 0 });
  }
  return '';
}

/**
 * Fill `context.deityRows` from the actor's embedded deity items.
 * The owner may Worship, Leave and Make Patron; the tier buttons are the GM's (a tier is granted, not taken).
 * @param {object} context
 * @param {object} actor
 */
export function buildDeityRows(context, actor) {
  const isGM = Boolean(globalThis.game?.user?.isGM);
  const editable = context.editable !== false;
  const mode = worshipTrackingMode();
  context.deityRows = Array.from(actor?.items ?? []).filter((item) => item?.type === 'deity').map((item) => {
    const bond = bondOf(item);
    const patron = patronageOf(item).status === 'patron';
    const worshipper = bond.status === 'worshipper';
    const badges = [];
    if (worshipper) badges.push(t('Worshipped'));
    else if (bond.status === 'former') badges.push(t('Former'));
    else badges.push(t('Known'));
    if (patron) badges.push(t('Patron'));
    if (bond.shunned > 0) badges.push(t('Shunned'));
    if (worshipper && bond.missedDays >= 1) badges.push(t('Lapsed'));
    return {
      id: item.id,
      name: item.name,
      img: item.img,
      title: String(item.system?.title ?? ''),
      badges,
      devotionLine: worshipper ? devotionLine(bond, mode) : '',
      tierLabel: worshipper && TIER_KEYS[bond.tier] ? t(TIER_KEYS[bond.tier]) : '',
      isWorshipper: worshipper,
      isPatron: patron,
      canWorship: editable && !worshipper,
      canLeave: editable && worshipper,
      canPatron: editable && !patron,
      canEndPatron: editable && patron,
      canOffer: editable && worshipper,
      canOffense: isGM && editable && worshipper,
      canPenance: isGM && editable && worshipper && bond.shunned > 0,
      canSetTier: isGM && editable && worshipper,
      canTierUp: bond.tier < WORSHIP_TIERS.zealot,
      canTierDown: bond.tier > WORSHIP_TIERS.acolyte,
      // The gift buttons are the GM's: a boon goes to a worshipper, a smite to one who worships or has left
      canBoon: isGM && worshipper,
      canSmite: isGM && bond.status !== 'known'
    };
  });
}
