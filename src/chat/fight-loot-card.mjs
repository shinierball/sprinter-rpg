/**
 * The GM's Loot card at the end of a combat (core pp. 22-23, 170, 215). A GM whisper built from a snapshot taken before the
 * combat is deleted: one "Roll mob loot" button when mobs died, one "Hand out" button per boss killed. Nothing is handed out
 * until the GM presses a button and confirms its dialog. What was handed out is recorded in the card's flag
 * (`applied`), so the card re-renders from the flag alone. Every name is escaped.
 */
import { escapeAttr } from '../utils/escape-attr.mjs';
import { withFlags, flagPath } from '../utils/flags.mjs';
import { isMobSide } from '../utils/combat/combat-sides.mjs';
import { fightLootSnapshot } from '../utils/loot/fight-loot.mjs';
import { getCurrentFloor } from '../utils/floor/current-floor.mjs';
import { lootBoxTierDef } from '../data/loot-box-tiers.mjs';
import { metricsOf } from '../documents/combat/combat-flags.mjs';
import { ruleBreakBadgeHtml } from '../utils/rule-break-visibility.mjs';
import { makeCardText } from './popularity-checklist-card.mjs';

/** The flag on the Loot card: `{ combatId, floor, bodies, bosses, crawlers, applied }`. */
export const FIGHT_LOOT_FLAG = 'fightLoot';
const ROLL_ACTION = 'crawlerRollMobLoot';
const HAND_OUT_ACTION = 'crawlerHandOutBossLoot';

const KEY = 'COG.FightLoot';
export const fightLootText = makeCardText({
  [`${KEY}.Title`]: 'Loot',
  [`${KEY}.Hint`]: 'Nothing is handed out until you press a button and confirm.',
  [`${KEY}.Bodies`]: 'Dead mobs: {count}',
  [`${KEY}.RollMob`]: 'Roll mob loot',
  [`${KEY}.MobDone`]: 'Mob loot handed out',
  [`${KEY}.ShareLine`]: '{name}: {junk} Misc. Junk, {gold} gold',
  [`${KEY}.BossLine`]: '{name} ({tier})',
  [`${KEY}.Levels`]: 'Levels: use Award Levels, {tier}.',
  [`${KEY}.HandOut`]: 'Hand out',
  [`${KEY}.BossDone`]: 'Handed out',
  [`${KEY}.Got`]: '{name}: {box}{map}',
  [`${KEY}.GotMap`]: ' and {map}',
  [`${KEY}.GmOnly`]: 'Only the GM can hand out loot.',
  [`${KEY}.AlreadyTitle`]: 'Already Handed Out',
  [`${KEY}.AlreadyMessage`]: 'This loot was already handed out. Hand it out again as a Rule Break?',
  [`${KEY}.AlreadyReason`]: 'Loot handed out twice from one combat.',
  [`${KEY}.Cancel`]: 'Cancel',
  [`${KEY}.Next`]: 'Next',
  [`${KEY}.Confirm`]: 'Hand out',
  [`${KEY}.Roll.Title`]: 'Mob loot',
  [`${KEY}.Roll.Intro`]: 'Each dead mob carries one roll of Misc. Junk and one of gold, multiplied by the number of bodies. The book lists mob gold for Floors 1 to 5.',
  [`${KEY}.Roll.Unlisted`]: 'The book lists Floors 1 to 5; this Floor is pre-filled with the last entry.',
  [`${KEY}.Roll.Bodies`]: 'Bodies',
  [`${KEY}.Roll.Floor`]: 'Floor',
  [`${KEY}.Roll.JunkDice`]: 'Misc. Junk dice',
  [`${KEY}.Roll.GoldDice`]: 'Gold dice (empty for none)',
  [`${KEY}.Roll.Result`]: '{label} ({dice}): {total}',
  [`${KEY}.Roll.JunkLabel`]: 'Misc. Junk',
  [`${KEY}.Roll.GoldLabel`]: 'Gold',
  [`${KEY}.Share.Title`]: 'Share the loot',
  [`${KEY}.Share.Intro`]: 'Pre-filled as an even split. Handed out {junk} of {totalJunk} Misc. Junk and {gold} of {totalGold} gold; a mismatch is allowed.',
  [`${KEY}.Share.Junk`]: 'Misc. Junk',
  [`${KEY}.Share.Gold`]: 'Gold',
  [`${KEY}.Boss.Title`]: 'Hand out: {name}',
  [`${KEY}.Boss.Intro`]: 'Tick the crawlers who get this boss\'s Boss Box and map.',
  [`${KEY}.Boss.Box`]: 'Box',
  [`${KEY}.Boss.KillingBlow`]: 'killing blow',
  [`${KEY}.Boss.TierBox`]: '{tier} Loot Box',
  [`${KEY}.Boss.MapName`]: 'Map name',
  [`${KEY}.Boss.MapTick`]: 'Hand out a map',
  [`${KEY}.Boss.MapPlaceholder`]: 'Name this boss\'s map, or leave empty for none',
  [`${KEY}.Map.neighborhood.Label`]: 'Neighborhood Map',
  [`${KEY}.Map.neighborhood.Description`]: 'A hand-drawn map of the boss\'s neighborhood. It adds an hour to the safe grinding limit on a grind of 5 or more hours.',
  [`${KEY}.Map.borough.Label`]: 'Borough Boss Map',
  [`${KEY}.Map.borough.Description`]: 'A map of the boss\'s borough, with the notes the neighborhood map left out. It adds two hours to the safe grinding limit.',
  [`${KEY}.Map.city.Label`]: 'City Boss Map',
  [`${KEY}.Map.city.Description`]: 'A city-sized map with several routes circled in red. Whoever holds it can find a Silver box worth of loot each time the party grinds. Homebrew.',
  [`${KEY}.Map.country.Label`]: 'Country Boss Map',
  [`${KEY}.Map.country.Description`]: 'A map of the floor with every magical item marked on it. Nothing is automated; the GM reads out what it shows. Homebrew.'
});

/** The tags of an actor as an array (a mob's `allTags`, else its tag set). */
const tagsOf = (actor) => Array.from(actor?.allTags ?? actor?.system?.tagSet ?? actor?.system?.tags ?? []);

/**
 * The state a Loot card keeps, from a combat that is ending: its snapshot plus the Floor, or null when there is nothing to
 * hand out (no dead mob).
 * @param {object} combat
 * @returns {{ combatId: string, floor: number, bodies: number, bosses: object[], crawlers: object[], applied: object }|null}
 */
function buildFightLootState(combat) {
  const metrics = metricsOf(combat);
  const rows = Array.from(combat?.combatants ?? []).map((c) => {
    const actor = c.actor;
    return {
      uuid: actor?.uuid ?? '',
      name: actor?.name ?? c.name ?? '',
      actorType: actor?.type ?? '',
      defeated: Boolean(c.isDefeated ?? c.defeated),
      mobSide: isMobSide({ actor, token: c.token }),
      tags: actor?.type === 'mob' ? tagsOf(actor) : [],
      kills: Number(metrics?.[c.actorId]?.kills) || 0,
      bossKills: (actor?.system?.trophies?.bossLog ?? []).map((k) => k?.victimUuid).filter(Boolean)
    };
  });
  const snap = fightLootSnapshot(rows);
  if (!snap.bodies) return null;
  return { combatId: combat.id, floor: getCurrentFloor(), ...snap, applied: {} };
}

/** The boss tier's own name ("Borough Boss"), from the registry. */
const tierName = (boss) => globalThis.CONFIG?.COG?.bossTiers?.[boss.tierId]?.label || boss.tierId;
const tierLabel = (boss) => lootBoxTierDef(boss.boxTier).label;

/** The card's markup, from its flag. @param {object} state */
function renderFightLootCard(state) {
  const applied = state.applied ?? {};
  const rows = [];
  if (state.bodies > 0) {
    const done = applied.mob;
    const control = done
      ? `<span class="cog-state-badge">${escapeAttr(fightLootText(`${KEY}.MobDone`))}${done.ruleBreak ? ` ${ruleBreakBadgeHtml({ cls: '' })}` : ''}</span>
        <ul>${(done.shares ?? []).map((s) => `<li>${escapeAttr(fightLootText(`${KEY}.ShareLine`, s))}</li>`).join('')}</ul>`
      : `<button type="button" class="cog-btn cog-btn-primary" data-action="${ROLL_ACTION}" data-gm-only="true"><i class="fa-solid fa-dice"></i> ${escapeAttr(fightLootText(`${KEY}.RollMob`))}</button>`;
    rows.push(`<div class="cog-fight-loot-row"><p><strong>${escapeAttr(fightLootText(`${KEY}.Bodies`, { count: state.bodies }))}</strong></p>${control}</div>`);
  }
  for (const boss of state.bosses ?? []) {
    const done = applied[boss.uuid];
    const control = done
      ? `<span class="cog-state-badge">${escapeAttr(fightLootText(`${KEY}.BossDone`))}${done.ruleBreak ? ` ${ruleBreakBadgeHtml({ cls: '' })}` : ''}</span>
        <ul>${(done.got ?? []).map((g) => `<li>${escapeAttr(fightLootText(`${KEY}.Got`, { name: g.name, box: g.box, map: g.map ? fightLootText(`${KEY}.GotMap`, { map: g.map }) : '' }))}</li>`).join('')}</ul>`
      : `<button type="button" class="cog-btn cog-btn-primary" data-action="${HAND_OUT_ACTION}" data-boss-uuid="${escapeAttr(boss.uuid)}" data-gm-only="true"><i class="fa-solid fa-gift"></i> ${escapeAttr(fightLootText(`${KEY}.HandOut`))}</button>`;
    rows.push(`<div class="cog-fight-loot-row"><p><strong>${escapeAttr(fightLootText(`${KEY}.BossLine`, { name: boss.name, tier: tierLabel(boss) }))}</strong></p>
      <div class="cog-card-note">${escapeAttr(fightLootText(`${KEY}.Levels`, { tier: tierName(boss) }))}</div>${control}</div>`);
  }
  return `<div class="cog-chat-card cog-fight-loot-card">
    <header class="cog-card-header"><h3><i class="fa-solid fa-coins"></i> ${escapeAttr(fightLootText(`${KEY}.Title`))}</h3></header>
    <div class="cog-card-body"><div class="cog-card-note">${escapeAttr(fightLootText(`${KEY}.Hint`))}</div>${rows.join('')}</div>
  </div>`;
}

/**
 * Post the Loot card to the GMs, or return null when no mob died. Nothing is handed out.
 * @param {object} combat
 * @returns {Promise<object|null>} the created message
 */
export async function postFightLootCard(combat) {
  const state = buildFightLootState(combat);
  if (!state || typeof globalThis.ChatMessage?.create !== 'function') return null;
  const whisper = globalThis.ChatMessage.getWhisperRecipients?.('GM')?.map((u) => u.id);
  return globalThis.ChatMessage.create(withFlags({
    speaker: { alias: fightLootText(`${KEY}.Title`) },
    content: renderFightLootCard(state),
    ...(whisper?.length ? { whisper } : {})
  }, { [FIGHT_LOOT_FLAG]: state }));
}

/** Rewrite a posted card from new state (content and flag together). */
export async function updateFightLootCard(message, state) {
  await message.update({ content: renderFightLootCard(state), [flagPath(FIGHT_LOOT_FLAG)]: state });
}
