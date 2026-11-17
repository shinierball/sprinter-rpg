/**
 * Page 0, the play sheet: the crawler sheet's first tab.
 *
 * `preparePageZero` reads only what `prepareCoreContext`, `prepareCombat` and `prepareHotlist` already put on the
 * context (one attack resolver, one hot bar resolver). Every label and boolean is computed here (Principle 5); the
 * template has no typed field and every control is an existing `data-action`.
 */
import { signed } from '../../utils/row-kinds/summary-text.mjs';
import { SYSTEM_PATH } from '../../constants.mjs';
import { HOTLIST_SLOT_COUNT } from './context-slots.mjs';
import { latestRollFor } from '../../documents/actor/latest-roll.mjs';

export const PAGE_ZERO_PART_ID = 'page0';
export const PAGE_ZERO_TAB = Object.freeze({ id: PAGE_ZERO_PART_ID, label: '0: Play', icon: 'fa-solid fa-play', cssClass: PAGE_ZERO_PART_ID });
export const PAGE_ZERO_TEMPLATE = `${SYSTEM_PATH}/templates/actors/parts/page0-play.hbs`;

/** Marks a sheet as having shown page 0 (not stored data); the chat hook re-renders only those. */
function pageZeroView(sheet) {
  return (sheet._pageZero ??= {});
}

/** One tappable button per Health bar, with the label a screen reader says. */
const barViews = (count) => Array.from({ length: count }, (_, i) => ({ index: i + 1, label: `Health bar ${i + 1} of ${count}` }));

/** The state of a sheet that has shown page 0, else null (the sheets that never did have none). */
export const peekPageZeroView = (sheet) => sheet?._pageZero ?? null;

/** The order the play sheet lists the stats in, with the label each tile shows. */
const STAT_TILES = [['str', 'STR'], ['int', 'INT'], ['con', 'CON'], ['dex', 'DEX'], ['cha', 'CHA']];

/** Whether this actor's sheet offers page 0: only a crawler's (D5 a: not a pet, mercenary or mob). */
export function pageZeroOffered(actor) {
  return actor?.type === 'crawler';
}

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clampPercent = (v) => Math.min(100, Math.max(0, Math.round(num(v))));

/** The hot bar slot's one action, from what the page 1 hot bar shows for the same slot. */
function slotView(slot) {
  const kind = slot.isSpell ? 'spell' : slot.isGear ? 'gear' : slot.isAttack ? 'attack' : slot.type === 'skill' ? 'skill' : 'item';
  const action = { spell: 'hotlistCastSpell', gear: 'hotlistToggleEquip', attack: 'hotlistAttack', skill: 'hotlistUse', item: 'hotlistUse' }[kind];
  const isOn = kind === 'gear' && slot.isEquipped;
  return {
    key: slot.key,
    name: slot.name,
    detail: slot.detail,
    kind,
    itemId: slot.itemId,
    // A custom value that resolves to no item has nothing to fire.
    action: slot.itemId ? action : '',
    cssClass: `is-${kind}${isOn ? ' is-on' : ''}`
  };
}

/**
 * Build `context.pageZero`. Requires the core, combat and hot bar context.
 * @param {object} context
 * @param {Actor} actor
 * @param {object} [sheet] the sheet instance, which keeps the stepper's state
 */
export function preparePageZero(context, actor, sheet = {}) {
  pageZeroView(sheet);
  const system = context.system ?? actor.system ?? {};
  const attrs = system.attributes ?? {};

  const level = num(system.details?.level, 1);
  const identity = {
    name: actor.name,
    img: actor.img,
    race: context.currentRaceLabel || '',
    class: context.currentClassLabel || '',
    level,
    sub: [context.currentRaceLabel, context.currentClassLabel, `Level ${level}`].filter(Boolean).join(' · ')
  };

  const move = {
    value: num(context.storedMove ?? attrs.speed?.move),
    now: context.moveNow ? num(context.moveNow.rated) : null,
    nowTitle: context.moveNow?.title ?? '',
    step: num(attrs.speed?.step)
  };

  const hpPct = clampPercent(attrs.hp?.pct);
  const health = {
    value: num(attrs.hp?.value),
    max: num(attrs.hp?.max),
    percent: hpPct,
    emptyPercent: 100 - hpPct,
    bars: barViews(context.healthSegments?.length ?? 0)
  };

  const slots = (context.hotlistSlots ?? []).filter((s) => !s.isEmpty).map(slotView);
  // Mana is drawn only for a crawler that owns a spell (Question 1348 a).
  const mana = {
    show: (context.spells ?? []).length > 0 || (context.hotlistSlots ?? []).some((s) => s.isSpell),
    value: num(attrs.mana?.value),
    max: num(attrs.mana?.max),
    percent: clampPercent(attrs.mana?.pct)
  };

  const stats = STAT_TILES.map(([key, label]) => ({
    key,
    label,
    mod: signed(num(system.abilities?.[key]?.mod)),
    cssKey: `is-${key}`
  }));

  const attacks = (context.attacks ?? [])
    .filter((a) => a.isAttackEquipped !== false)
    .map((a) => ({
      id: a.id,
      name: a.name,
      toHit: a.toHitMod == null ? String(a.displayToHit ?? '') : signed(num(a.toHitMod)),
      damage: String(a.displayDamage ?? '')
    }));

  // The user's latest roll for this actor, from the check record on its chat message (Principle 2: never the card's text).
  const latest = latestRollFor(actor, globalThis.game?.user);
  const last = latest ? { has: true, name: latest.name, total: latest.total } : { has: false, name: '', total: 0 };

  context.pageZero = {
    identity,
    move,
    health,
    mana,
    stats,
    evade: { total: signed(num(attrs.evade?.total)) },
    favor: { count: num(attrs.aiFavor) },
    attacks,
    last,
    hotbar: { slots, filled: slots.length, total: HOTLIST_SLOT_COUNT, label: `${slots.length} of ${HOTLIST_SLOT_COUNT} slots filled` }
  };
}
