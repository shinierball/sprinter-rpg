/**
 * Hotlist (10 quick-access slots) and external buff slot (max 3) context for page 1.
 *
 * Hotlist slots store an owned item's id and resolve through `utils/ui/hotlist.mjs`. Option groups are precomputed (CONTRIBUTING §5).
 */
import { firstScalar } from '../../utils/first-scalar.mjs';
import { hotlistSlotId, resolveHotlistItem, isActivatableGear } from '../../utils/ui/hotlist.mjs';
import { contentRegistry } from '../../content/registry.mjs';
import { attackDamageDisplay } from '../../utils/damage/damage-parts.mjs';
import { classifyBuff } from '../../utils/effects/buff-classify.mjs';
import { describeItem, summaryText } from '../../utils/item-describer/index.mjs';
import { spellRole, spellRoleLabel } from '../../utils/tag/tag-mechanics.mjs';

export const HOTLIST_SLOT_COUNT = 10;
export const EXTERNAL_BUFF_SLOT_COUNT = 3;

const norm = (s) => String(s ?? '').toLowerCase().trim();

function hotlistSlotDisplay(resolved, actor) {
  const display = {
    type: resolved.type, badge: '', detail: '', gearSlot: '',
    isEquipped: false, canActivate: false, isSpell: false, isGear: false, isLoot: false, isAttack: false, hasDamage: false
  };
  switch (resolved.type) {
    case 'spell': {
      display.isSpell = true;
      display.badge = 'SPELL';
      display.detail = `${resolved.system?.manaCost ?? 0} MP`;
      const role = spellRole(resolved);
      if (role !== 'none') display.detail += ` • ${spellRoleLabel(role)}`;
      display.hasDamage = actor.getSpellDamageData(resolved)?.hasDamage ?? false;
      break;
    }
    case 'gear': {
      display.isGear = true;
      display.gearSlot = resolved.system?.slot || 'gear';
      display.isEquipped = Boolean(resolved.system?.equipped);
      display.badge = display.gearSlot.toUpperCase();
      display.detail = display.isEquipped ? 'Equipped' : 'Unequipped';
      display.canActivate = isActivatableGear(resolved);
      break;
    }
    case 'loot': {
      display.isLoot = true;
      display.badge = 'ITEM';
      display.detail = `x${resolved.system?.quantity ?? 1}`;
      if (resolved.system?.notes) display.detail += ` • ${resolved.system.notes}`;
      break;
    }
    case 'attack': {
      display.isAttack = true;
      display.badge = 'ATTACK';
      display.detail = attackDamageDisplay(resolved, actor);
      break;
    }
    case 'skill': {
      const dmg = actor.getSkillDamageData(resolved);
      display.hasDamage = dmg?.hasDamage ?? false;
      display.isAttack = resolved.system?.isAttack === true;
      display.badge = display.isAttack ? 'ATTACK' : 'SKILL';
      display.detail = `Rank ${resolved.system?.modifiedRank ?? resolved.system?.rank ?? 1}`;
      if (display.hasDamage && dmg?.formulaWithStat) display.detail += ` • ${dmg.formulaWithStat}`;
      else if (resolved.statModStr) display.detail += ` (${resolved.statModStr})`;
      break;
    }
    default:
      display.badge = String(resolved.type ?? '').toUpperCase();
  }
  return display;
}

function hotlistGroups(context, valStr, resolved, actor) {
  const isSelected = (entry) => entry.id === valStr || entry.id === resolved?.id;
  const group = (label, list, labelFn) => (list.length
    ? [{ label, items: list.map(entry => ({ id: entry.id, label: labelFn(entry), selected: isSelected(entry) })) }]
    : []);
  return [
    ...group('Spells', context.spells, s => `⚡ ${s.name} (${s.system?.manaCost ?? 0} MP)`),
    ...group('Attacks', context.attacks, a => {
      const damage = attackDamageDisplay(a, actor);
      return `⚔️ ${a.name}${damage ? ` (${damage})` : ''}`;
    }),
    ...group('Skills', context.skills, sk => `🎯 ${sk.name} (Rank ${sk.system?.modifiedRank ?? sk.system?.rank ?? 1})`),
    ...group('Gear (Equipment)', context.gear, g => `🛡️ ${g.name} [${(g.system?.slot || 'gear').toUpperCase()}]${g.system?.equipped ? ' (Equipped)' : ''}`),
    ...group('Inventory Items', context.loot, l => `📦 ${l.name} (x${l.system?.quantity ?? 1})`)
  ];
}

/**
 * Requires item lists, skills/spells and combat context.
 * @param {object} context
 * @param {Actor} actor
 */
export function prepareHotlist(context, actor) {
  const hotlist = context.system.hotlist || {};
  context.hotlistSlots = [];
  for (let i = 1; i <= HOTLIST_SLOT_COUNT; i++) {
    const key = `slot${i}`;
    const valStr = hotlistSlotId(hotlist[key]);
    const resolved = resolveHotlistItem(actor, valStr);
    let name = valStr;
    let display = {
      type: '', badge: '', detail: '', gearSlot: '',
      isEquipped: false, canActivate: false, isSpell: false, isGear: false, isLoot: false, isAttack: false, hasDamage: false
    };
    if (resolved) {
      name = resolved.name;
      display = hotlistSlotDisplay(resolved, actor);
    }

    context.hotlistSlots.push({
      index: i,
      key,
      value: valStr,
      isEmpty: !valStr,
      item: resolved,
      itemId: resolved?.id || '',
      name,
      img: resolved ? (resolved.img || 'icons/svg/item-bag.svg') : '',
      ...display,
      groups: hotlistGroups(context, valStr, resolved, actor),
      isCustom: Boolean(valStr && !resolved)
    });
  }
}

/* -------------------------------------------- */
/*  External buff slots                         */
/* -------------------------------------------- */

/** What a buff does, from the shared describer. Catalog entries carry no `type`, so they are described as buffs. */
async function buffDetail(b) {
  return summaryText(await describeItem(b.type ? b : { name: b.name, type: 'buff', system: b.system || {} }));
}

function buffOptionLabel(b, icon, details) {
  return details ? `${icon} ${b.name} (${details})` : `${icon} ${b.name}`;
}

async function buffBadge(buff) {
  const sys = buff.system || {};
  const kinds = classifyBuff(sys);
  const detail = await buffDetail(buff);
  if (kinds.includes('stat')) return { badge: 'STAT', detail };
  if (kinds.includes('tempHp')) return { badge: 'TEMP HP', detail };
  if (kinds.includes('resistance')) return { badge: 'RESIST', detail };
  if (kinds.includes('immunity')) return { badge: 'IMMUNE', detail };
  if (kinds.some(k => k === 'damage' || k === 'vulnerability')) return { badge: 'COMBAT', detail };
  return { badge: 'BUFF', detail };
}

/** Option groups in display order: the actor's buffs, world buffs, then compendium buffs by kind. */
async function buffOptionGroups(context) {
  const ownedBuffs = context.buffs;
  const owned = await Promise.all(ownedBuffs.map(async b => ({ id: b.id || b._id, name: b.name, label: buffOptionLabel(b, '✨', await buffDetail(b)) })));
  const world = await Promise.all(Array.from(globalThis.game?.items ?? [])
    .filter(it => it.type === 'buff' && !ownedBuffs.some(ob => (ob.id && ob.id === it.id) || (it.system?.identifier && ob.system?.identifier === it.system.identifier)))
    .map(async b => ({ id: b.id || b._id, name: b.name, label: buffOptionLabel(b, '🔮', await buffDetail(b)) })));

  const compendium = new Map();
  for (const b of CONFIG.COG?.buffs ?? []) {
    compendium.set(b._id || norm(b.name), { id: b._id, name: b.name, system: b.system || {} });
  }
  for (const entry of contentRegistry.getPack('buffs')?.index ?? []) {
    // The buffs pack also holds debuffs (3.31); only buffs belong in the buff-slot picker.
    if (entry.type && entry.type !== 'buff') continue;
    const key = entry._id || norm(entry.name);
    if (!compendium.has(key)) compendium.set(key, { id: entry._id, name: entry.name, system: entry.system || {} });
  }
  const all = [...compendium.values()];
  const detailOf = new Map(await Promise.all(all.map(async b => [b, await buffDetail(b)])));
  const pick = (filter, icon) => all.filter(filter).map(b => ({ id: b.id, name: b.name, label: buffOptionLabel(b, icon, detailOf.get(b)) }));
  const has = (...wanted) => (b) => classifyBuff(b.system).some(k => wanted.includes(k));

  return [
    { label: '📦 Character Buffs', options: owned },
    { label: '🌍 World Buffs', options: world },
    { label: '⚡ Ability Score Buffs', options: pick(has('stat'), '⚡') },
    { label: '❤️ Temporary Health Buffs', options: pick(has('tempHp'), '❤️') },
    { label: '🛡️ Damage Resistance Buffs', options: pick(has('resistance'), '🛡️') },
    { label: '🌟 Damage Immunity Buffs', options: pick(has('immunity'), '🌟') },
    { label: '⚔️ Damage Multiplier & Combat Buffs', options: pick(has('damage', 'vulnerability'), '⚔️') },
    { label: '✨ Other Compendium Buffs', options: pick(has('other'), '✨') }
  ].filter(g => g.options.length > 0);
}

/** The id of the single option to mark selected: the slot's resolved buff id, else the slot value as an id. */
function selectedBuffOption(groups, valStr, resolved) {
  if (!valStr) return null;
  const options = groups.flatMap(g => g.options);
  if (resolved?.id) {
    const byResolvedId = options.find(o => o.id === resolved.id);
    if (byResolvedId) return byResolvedId.id;
  }
  return options.find(o => o.id === valStr)?.id ?? null;
}

/**
 * External buff slots plus `isSlotN` flags on each owned buff (for the Conditions tab buttons).
 * Requires item lists.
 * @param {object} context
 * @param {Actor} actor
 */
export async function prepareExternalBuffs(context, actor) {
  const raw = context.system.attributes?.externalBuffs || {};
  const groups = await buffOptionGroups(context);
  context.externalBuffSlots = [];

  for (let i = 1; i <= EXTERNAL_BUFF_SLOT_COUNT; i++) {
    const key = `buff${i}`;
    const valStr = String(firstScalar(raw[key]) ?? '').trim();

    const resolved = actor.resolveBuff(valStr);
    const { badge, detail } = resolved ? await buffBadge(resolved) : { badge: '', detail: '' };
    const selectedId = selectedBuffOption(groups, valStr, resolved);

    // A buff already in another slot is disabled here, so one buff cannot fill two slots.
    const otherAssigned = [];
    for (let j = 1; j <= EXTERNAL_BUFF_SLOT_COUNT; j++) {
      const otherVal = j === i ? null : raw[`buff${j}`];
      if (!otherVal) continue;
      const other = actor.resolveBuff(String(otherVal).trim());
      otherAssigned.push({ slotNum: j, id: norm(other?.id ?? otherVal) });
    }

    context.externalBuffSlots.push({
      index: i,
      key,
      value: valStr,
      isEmpty: !valStr,
      name: resolved ? resolved.name : valStr,
      resolvedId: resolved?.id ?? '',
      identifier: resolved?.system?.identifier ?? '',
      badge,
      badgeClass: badge ? `cog-buff-badge-${badge.toLowerCase().replace(/\s+/g, '-')}` : '',
      detail,
      groups: groups.map(g => ({
        label: g.label,
        items: g.options.map(o => {
          const selected = Boolean(selectedId && o.id === selectedId);
          const oId = norm(o.id);
          const inOther = selected ? null : otherAssigned.find(oa => oa.id === oId);
          return { ...o, selected, disabled: Boolean(inOther), assignedSlot: inOther?.slotNum ?? null };
        })
      })),
      isCustom: Boolean(valStr && !selectedId)
    });
  }

  const matches = (item, slot) => {
    if (!slot || slot.isEmpty) return false;
    const itemId = norm(item.id || item._id);
    const identifier = item.system?.identifier;
    return Boolean(norm(slot.value) === itemId || norm(slot.resolvedId) === itemId || (identifier && slot.identifier === identifier));
  };
  for (const b of context.buffs) {
    b.isSlot1 = matches(b, context.externalBuffSlots[0]);
    b.isSlot2 = matches(b, context.externalBuffSlots[1]);
    b.isSlot3 = matches(b, context.externalBuffSlots[2]);
    b.isAssignedToAnySlot = b.isSlot1 || b.isSlot2 || b.isSlot3;
  }
}
