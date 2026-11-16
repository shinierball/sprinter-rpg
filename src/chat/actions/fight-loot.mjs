/**
 * The two buttons on the GM's Loot card (core pp. 22-23, 215): "Roll mob loot" (`crawlerRollMobLoot`) and a boss's
 * "Hand out" (`crawlerHandOutBossLoot`). GM only, and only a card a GM wrote: everything a button does comes from the
 * card's flag, never from the button. A button already used asks a Rule Break instead of refusing (Directive 2).
 */
import { readFlag } from '../../utils/flags.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { foundryRng, rollFormula } from '../../utils/rng.mjs';
import { dialogAnswer } from '../../utils/ui/dialog-answer.mjs';
import { MOB_JUNK_DICE, mobGoldDice, mobLootTotals, splitLoot } from '../../utils/loot/fight-loot.mjs';
import { lootBoxTierDef, lootBoxTiersInOrder } from '../../data/loot-box-tiers.mjs';
import { isLootBoxType } from '../../models/items/loot-model.mjs';
import { grantMobLoot, grantBossRewards } from '../../documents/actor/fight-loot.mjs';
import { lootBoxName } from '../../documents/actor/achievement-award.mjs';
import { isGmAuthored } from '../chat-relay.mjs';
import { FIGHT_LOOT_FLAG, fightLootText, updateFightLootCard } from '../fight-loot-card.mjs';

const KEY = 'COG.FightLoot';

/** The card state a click is for, or null when the click is not one a GM may answer. */
function clickedState(message) {
  if (!globalThis.game?.user?.isGM) {
    globalThis.ui?.notifications?.warn?.(fightLootText(`${KEY}.GmOnly`));
    return null;
  }
  if (!isGmAuthored(message)) return null;
  return readFlag(message, FIGHT_LOOT_FLAG) ?? null;
}

/** Ask the Rule Break "already handed out" when `done`; resolves the answer `{ proceed, ruleBreak }`. */
async function askAgain(done) {
  if (!done) return { proceed: true, ruleBreak: false };
  const res = await confirmRuleBreak({
    title: fightLootText(`${KEY}.AlreadyTitle`),
    message: fightLootText(`${KEY}.AlreadyMessage`),
    reason: fightLootText(`${KEY}.AlreadyReason`)
  });
  return { proceed: res.confirmed, ruleBreak: res.confirmed };
}

/**
 * One dialog field as markup. `{ control: 'number'|'text'|'check'|'select', name, label, value?, checked?, placeholder?, options? }`;
 * a field with a `legend` prints it as a heading first. Every value is escaped here.
 */
function fieldHtml(field) {
  const legend = field.legend ? `<h4 class="cog-choice-group">${escapeAttr(field.legend)}</h4>` : '';
  const label = escapeAttr(field.label);
  const name = escapeAttr(field.name);
  const row = 'class="cog-choice-pick" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;"';
  if (field.control === 'check') {
    return `${legend}<label ${row}><input type="checkbox" name="${name}" value="1"${field.checked ? ' checked' : ''} /><span>${label}</span></label>`;
  }
  if (field.control === 'select') {
    const options = (field.options ?? []).map((o) => `<option value="${escapeAttr(o.value)}"${o.value === field.value ? ' selected' : ''}>${escapeAttr(o.label)}</option>`).join('');
    return `${legend}<label ${row}><span>${label}</span><select name="${name}">${options}</select></label>`;
  }
  const kind = field.control === 'number' ? 'type="number" min="0" step="1"' : 'type="text"';
  return `${legend}<label ${row}><span>${label}</span><input ${kind} name="${name}" value="${escapeAttr(field.value)}" placeholder="${escapeAttr(field.placeholder ?? '')}" /></label>`;
}

/** The value of a named field in a dialog form, or ''. */
const fieldValue = (form, name) => {
  const field = form?.querySelector?.(`[name="${name}"]`);
  // a headless select has no value: it reads the selected option, else the first, as a browser would
  if (field?.tagName === 'SELECT') return (field.querySelector('option[selected]') ?? field.querySelector('option'))?.getAttribute('value') ?? '';
  return typeof field?.value === 'string' ? field.value : (field?.getAttribute?.('value') ?? '');
};
/** Whether a named checkbox is ticked. */
const isTicked = (form, name) => {
  const field = form?.querySelector?.(`[name="${name}"]`);
  return Boolean(field?.checked ?? field?.hasAttribute?.('checked'));
};
const wholeNumber = (raw) => Math.max(0, Math.floor(Number(raw)) || 0);

/**
 * A small form dialog. `read(form)` turns the confirmed form into the answer.
 * @returns {Promise<object|null>} the answer, or null when cancelled or closed
 */
async function askForm({ title, intro, fields, confirmLabel, read }) {
  const content = `<div class="cog-dialog-choices" style="padding:6px;font-family:'Oswald',sans-serif;"><p>${escapeAttr(intro)}</p>${fields.map(fieldHtml).join('')}</div>`;
  return dialogAnswer(await globalThis.foundry.applications.api.DialogV2.wait({
    window: { title },
    position: { width: 420 },
    classes: ['cog-dialog'],
    content,
    buttons: [
      { action: 'ok', icon: 'fas fa-check', label: confirmLabel, default: true, callback: (event, button) => read(button.form) },
      { action: 'cancel', icon: 'fas fa-times', label: fightLootText(`${KEY}.Cancel`), callback: () => null }
    ],
    rejectClose: false
  }));
}

/** Roll one pile of mob loot through the live RNG and post the dice, so the table sees them. Empty dice roll nothing. */
async function rollPile(dice, label) {
  if (!dice) return 0;
  const result = rollFormula(foundryRng(), dice);
  if (!result) return 0;
  const line = fightLootText(`${KEY}.Roll.Result`, { label, dice, total: result.total });
  await globalThis.ChatMessage?.create?.({ speaker: { alias: fightLootText(`${KEY}.Title`) }, content: `<div class="cog-chat-card"><p>${escapeAttr(line)} [${escapeAttr(result.dice.join(', '))}]</p></div>` });
  return result.total;
}

/** @param {Event} event @param {HTMLElement} button @param {ChatMessage} message */
export async function handleRollMobLoot(event, button, message) {
  const state = clickedState(message);
  if (!state) return;
  const again = await askAgain(state.applied?.mob);
  if (!again.proceed) return;

  const listed = mobGoldDice(state.floor);
  const rolled = await askForm({
    title: fightLootText(`${KEY}.Roll.Title`),
    intro: `${fightLootText(`${KEY}.Roll.Intro`)}${listed.listed ? '' : ` ${fightLootText(`${KEY}.Roll.Unlisted`)}`}`,
    fields: [
      { control: 'number', name: 'bodies', label: fightLootText(`${KEY}.Roll.Bodies`), value: state.bodies },
      { control: 'number', name: 'floor', label: fightLootText(`${KEY}.Roll.Floor`), value: state.floor },
      { control: 'text', name: 'junkDice', label: fightLootText(`${KEY}.Roll.JunkDice`), value: MOB_JUNK_DICE },
      { control: 'text', name: 'goldDice', label: fightLootText(`${KEY}.Roll.GoldDice`), value: listed.dice }
    ],
    confirmLabel: fightLootText(`${KEY}.Next`),
    read: (form) => ({
      bodies: wholeNumber(fieldValue(form, 'bodies')),
      floor: wholeNumber(fieldValue(form, 'floor')),
      junkDice: fieldValue(form, 'junkDice').trim(),
      goldDice: fieldValue(form, 'goldDice').trim()
    })
  });
  if (!rolled) return;
  // an untouched Gold dice field follows the Floor the GM typed
  const goldDice = rolled.goldDice === listed.dice ? mobGoldDice(rolled.floor).dice : rolled.goldDice;
  const junkRoll = await rollPile(rolled.junkDice, fightLootText(`${KEY}.Roll.JunkLabel`));
  const goldRoll = await rollPile(goldDice, fightLootText(`${KEY}.Roll.GoldLabel`));
  const totals = mobLootTotals({ junkRoll, goldRoll, bodies: rolled.bodies });

  const crawlers = state.crawlers ?? [];
  const ids = crawlers.map((c) => c.uuid);
  const junkShare = splitLoot(totals.junk, ids);
  const goldShare = splitLoot(totals.gold, ids);
  const shareFields = crawlers.flatMap((c, i) => [
    { control: 'number', name: `junk-${i}`, legend: c.name, label: fightLootText(`${KEY}.Share.Junk`), value: junkShare.get(c.uuid) },
    { control: 'number', name: `gold-${i}`, label: fightLootText(`${KEY}.Share.Gold`), value: goldShare.get(c.uuid) }
  ]);
  const shares = await askForm({
    title: fightLootText(`${KEY}.Share.Title`),
    intro: fightLootText(`${KEY}.Share.Intro`, { junk: totals.junk, totalJunk: totals.junk, gold: totals.gold, totalGold: totals.gold }),
    fields: shareFields,
    confirmLabel: fightLootText(`${KEY}.Confirm`),
    read: (form) => crawlers.map((c, i) => ({ uuid: c.uuid, name: c.name, junk: wholeNumber(fieldValue(form, `junk-${i}`)), gold: wholeNumber(fieldValue(form, `gold-${i}`)) }))
  });
  if (!shares) return;

  const next = { ...state, applied: { ...(state.applied ?? {}), mob: { shares: shares.map(({ name, junk, gold }) => ({ name, junk, gold })), ruleBreak: again.ruleBreak } } };
  // Claim the card before writing so a second click cannot write again.
  await updateFightLootCard(message, next);
  for (const share of shares) {
    const actor = resolveActorByUuid(share.uuid);
    if (actor) await grantMobLoot(actor, share);
  }
}

/** The generic boxes and the world's box templates, as `<option>` data: `{ value, label }`. */
function boxChoices(bossTier) {
  const generic = lootBoxTiersInOrder().map((def) => ({ value: `tier:${def.id}`, label: lootBoxName(def.id) }));
  const world = Array.from(globalThis.game?.items ?? [])
    .filter((item) => item?.type === 'loot' && isLootBoxType(item.system?.lootType))
    .map((item) => ({ value: `uuid:${item.uuid}`, label: item.name }));
  const own = generic.find((g) => g.value === `tier:${bossTier}`);
  return [own, ...generic.filter((g) => g !== own), ...world].filter(Boolean);
}

/** @param {Event} event @param {HTMLElement} button @param {ChatMessage} message */
export async function handleHandOutBossLoot(event, button, message) {
  const state = clickedState(message);
  if (!state) return;
  const boss = (state.bosses ?? []).find((b) => b.uuid === button?.dataset?.bossUuid);
  if (!boss) return;
  const again = await askAgain(state.applied?.[boss.uuid]);
  if (!again.proceed) return;

  const crawlers = state.crawlers ?? [];
  const row = boss.map;
  const mapName = row ? `${fightLootText(row.labelKey)}: ${boss.name}` : '';
  const boxes = boxChoices(boss.boxTier);
  const tierOptions = lootBoxTiersInOrder().map((def) => ({ value: def.id, label: def.label || def.id }));
  const crawlerFields = crawlers.flatMap((c, i) => {
    const killer = c.uuid === boss.killerUuid;
    const label = killer ? `${c.name} (${fightLootText(`${KEY}.Boss.KillingBlow`)})` : c.name;
    const tick = { control: 'check', name: `tick-${i}`, label, checked: true };
    return killer ? [tick, { control: 'select', name: `tier-${i}`, label: lootBoxTierDef(boss.boxTier).label, options: tierOptions, value: boss.boxTier }] : [tick];
  });
  const picked = await askForm({
    title: fightLootText(`${KEY}.Boss.Title`, { name: boss.name }),
    intro: fightLootText(`${KEY}.Boss.Intro`),
    fields: [
      ...crawlerFields,
      { control: 'select', name: 'box', label: fightLootText(`${KEY}.Boss.Box`), options: boxes, value: boxes[0]?.value },
      { control: 'check', name: 'mapTick', label: fightLootText(`${KEY}.Boss.MapTick`), checked: true },
      { control: 'text', name: 'mapName', label: fightLootText(`${KEY}.Boss.MapName`), value: mapName, placeholder: fightLootText(`${KEY}.Boss.MapPlaceholder`) }
    ],
    confirmLabel: fightLootText(`${KEY}.Confirm`),
    read: (form) => ({
      box: fieldValue(form, 'box'),
      mapName: isTicked(form, 'mapTick') ? fieldValue(form, 'mapName').trim() : '',
      crawlers: crawlers.map((c, i) => ({ uuid: c.uuid, name: c.name, ticked: isTicked(form, `tick-${i}`), tier: fieldValue(form, `tier-${i}`) }))
    })
  });
  if (!picked) return;

  const [kind, ...rest] = picked.box.split(':');
  const boxRef = rest.join(':');
  const mapData = picked.mapName ? { name: picked.mapName, tag: row?.tag ?? '', description: row ? fightLootText(row.descriptionKey) : '' } : null;
  const got = [];
  const claim = { ...state, applied: { ...(state.applied ?? {}), [boss.uuid]: { got, ruleBreak: again.ruleBreak } } };
  // Claim the card before writing so a second click cannot write again.
  for (const entry of picked.crawlers.filter((c) => c.ticked)) got.push({ name: entry.name, box: '', map: mapData?.name ?? '' });
  await updateFightLootCard(message, claim);
  for (const [i, entry] of picked.crawlers.filter((c) => c.ticked).entries()) {
    const actor = resolveActorByUuid(entry.uuid);
    if (!actor) continue;
    // the killing blow's own tier counts only when the GM raised it; otherwise the Box select decides
    const own = entry.tier && entry.tier !== boss.boxTier ? entry.tier : boxRef;
    const boxRow = kind === 'uuid' ? { tier: boss.boxTier, uuid: boxRef } : { tier: own };
    const result = await grantBossRewards(actor, { bossName: boss.name, boxRow, map: mapData });
    got[i].box = result.boxes[0]?.name ?? lootBoxName(boxRow.tier);
  }
  await updateFightLootCard(message, claim);
}
