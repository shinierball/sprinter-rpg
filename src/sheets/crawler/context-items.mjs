/**
 * Sorts the actor's embedded items into the lists every crawler-sheet tab reads,
 * and decorates them with display-only fields (summaries, tier colours, attack rows).
 */
import { isWeaponGear } from '../../documents/actor.mjs';
import { COG_ACHIEVEMENT_TIERS } from '../../data/rules/achievement-tiers.mjs';
import { prepareAttackDisplay } from './attack-display.mjs';
import { classifyBuff } from '../../utils/effects/buff-classify.mjs';
import { isBuffSuppressed } from '../../utils/effects/dispel.mjs';
import { canSwitchDebuff } from '../../documents/actor/debuff-switch.mjs';
import { itemDisplayName } from '../../utils/tag/display-name.mjs';
import { raceInForce } from '../../utils/character/overlay-state.mjs';
import { afflictionView } from './context-transformation.mjs';
import { activationView } from './activation-view.mjs';
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { isActivatableGear } from '../../utils/ui/hotlist.mjs';
import { describeItem, summaryText, summaryTooltip, emptyLine, linesInGroups } from '../../utils/item-describer/index.mjs';
import { htmlSnippet } from '../../utils/ui/html-snippet.mjs';
import { sourceBadge } from '../../utils/content-source.mjs';
import { decorateOfflineGear, offlineReadouts } from './gear-offline-display.mjs';
import { isRaceOrClass } from '../../utils/document-types.mjs';

/** Sort by the manual `sort` key, then by name. */
export const sortItems = (a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name);

const FALLBACK_TIER = {
  color: '#e74c3c',
  icon: 'fa-solid fa-trophy',
  bgColor: 'rgba(231, 76, 60, 0.15)'
};

/**
 * Categorise embedded items into `context` lists.
 * Sets: attacks, stowedAttacks, skills, spells, gear, races, classes, deities, sponsors,
 * loot, buffs, debuffs, achievements, equippedBySlot.
 * @param {object} context
 * @param {Actor} actor
 */
export function prepareItemLists(context, actor) {
  Object.assign(context, {
    attacks: [],
    stowedAttacks: [],
    skills: [],
    spells: [],
    gear: [],
    races: [],
    classes: [],
    deities: [],
    sponsors: [],
    loot: [],
    buffs: [],
    debuffs: [],
    achievements: [],
    equippedBySlot: {
      head: null, torso: null, arms: null, hands: null, legs: null, feet: null,
      collar: null, barding: null, saddle: null, pack: null,
      accessory: [], tattoo: [], patch: []
    }
  });

  for (const item of actor.items) {
    switch (item.type) {
      case 'attack': {
        prepareAttackDisplay(item, actor);
        (item.system?.equipped !== false ? context.attacks : context.stowedAttacks).push(item);
        break;
      }
      case 'gear': {
        item.canActivate = isActivatableGear(item);
        context.gear.push(item);
        if (isWeaponGear(item)) {
          prepareAttackDisplay(item, actor);
          (item.system?.equipped ? context.attacks : context.stowedAttacks).push(item);
        }
        if (item.system?.equipped) {
          const slot = (item.system.slot || 'torso').toLowerCase();
          if (Array.isArray(context.equippedBySlot[slot])) context.equippedBySlot[slot].push(item);
          else context.equippedBySlot[slot] = item;
        }
        break;
      }
      case 'skill': context.skills.push(item); break;
      case 'spell': item.sourceBadge = sourceBadge(item); context.spells.push(item); break;
      case 'race': {
        // The race an overlay has set aside is listed but marked (7.1: the form race is the one in force)
        item.notInForce = !raceInForce(actor.items, item);
        item.notInForceLabel = item.notInForce ? globalThis.game?.i18n?.localize?.('COG.Transform.NotInForceBadge') : '';
        item.notInForceTooltip = item.notInForce ? globalThis.game?.i18n?.localize?.('COG.Transform.NotInForceTooltip') : '';
        context.races.push(item);
        break;
      }
      case 'class': context.classes.push(item); break;
      case 'deity': context.deities.push(item); break;
      case 'sponsor': context.sponsors.push(item); break;
      case 'loot': {
        // The input is plain text: the notes, else the rich-text description read as text (never its `<p>` markup).
        item.lootNotes = item.system?.notes || htmlSnippet(item.system?.description);
        context.loot.push(item);
        break;
      }
      case 'buff': {
        item.kindLabel = classifyBuff(item.system || {}).join(' / ');
        // A dispel in force suspends the Buff: the tab keeps the row but marks it [SUSPENDED] (3.40 j)
        // A closed activation window is not a dispel: the row shows [READY] or [COOLDOWN n] for it instead
        item.isSuspended = isBuffSuppressed(actor, item, { ignoreWindow: true });
        item.activation = activationView(actor, item);
        item.sourceBadge = sourceBadge(item);
        context.buffs.push(item);
        break;
      }
      case 'debuff': {
        const sev = (item.system?.severity || 'Minor').toLowerCase();
        item.severityClass = sev === 'major' ? 'is-major' : 'is-minor';
        item.displayName = itemDisplayName(item);
        item.canSwitch = canSwitchDebuff(actor.items?.get(item.id) ?? item);
        // An affliction's stage and controls (7.1g); null for an ordinary debuff
        item.transform = afflictionView(actor, item);
        item.sourceBadge = sourceBadge(item);
        context.debuffs.push(item);
        break;
      }
      case 'achievement': {
        const tier = (item.system?.tier || 'bronze').toLowerCase();
        const tierConfig = COG_ACHIEVEMENT_TIERS?.[tier] || { ...FALLBACK_TIER, label: tier.toUpperCase() };
        item.tierLabel = tierConfig.label || tier.toUpperCase();
        item.tierColor = tierConfig.color || FALLBACK_TIER.color;
        item.tierIcon = tierConfig.icon || FALLBACK_TIER.icon;
        item.tierBgColor = tierConfig.bgColor || FALLBACK_TIER.bgColor;
        context.achievements.push(item);
        break;
      }
      default: break;
    }
  }

  decorateOfflineGear(actor, context.gear);
  context.offlineReadouts = offlineReadouts(actor.system);

  context.buffs.sort(sortItems);
  context.debuffs.sort(sortItems);
  // The banner lists the afflictions that have changed their victim
  context.transformations = context.debuffs.filter((d) => d.transform?.isChanged).map((d) => d.transform);
}

/** The summary groups the inventory's gear badge text reads (stats, skills and spells, defenses). */
const GEAR_BONUS_GROUPS = ['stat', 'skill', 'defense'];

/** The summary groups a debuff chip shows inline (the full summary is its tooltip). */
const DEBUFF_CHIP_GROUPS = ['effect', 'stat'];

/** Item types whose rows get the summary as a hover tooltip on the name. */
const TOOLTIP_TYPES = new Set(['spell', 'skill', 'gear', 'attack', 'loot', 'buff', 'debuff']);

/**
 * Describe the actor's items once (`describeItem`, owner = the actor) and attach the results:
 * `featureLines` on races and classes, `summaryTip` (tooltip HTML) on every spell, skill, gear, attack, loot, buff and
 * debuff row, and `summary` (the " • " line; a debuff's is its effect and stat groups) on buffs and debuffs. Nothing is stored on a document and nothing is
 * cached; the lines are rebuilt on every render. Also sets `context.summaryEmptyText`, the muted line for an item
 * with no structured effects.
 * @param {object} context Context filled by {@link prepareItemLists}
 * @param {Actor} actor
 */
export async function prepareItemSummaries(context, actor) {
  context.summaryEmptyText = emptyLine().text;
  const rows = [...context.races, ...context.classes, ...context.spells, ...context.skills, ...context.gear, ...context.loot,
    ...context.attacks, ...context.stowedAttacks, ...context.buffs, ...context.debuffs];
  const seen = new Set();
  await Promise.all(rows.filter(item => !seen.has(item) && seen.add(item)).map(async (item) => {
    const lines = await describeItem(item, { actor });
    if (isRaceOrClass(item)) item.featureLines = lines;
    if (!TOOLTIP_TYPES.has(item.type)) return;
    item.summaryTip = summaryTooltip(lines);
    // The short gear badge text (equipped-slot tooltips, inventory row): what the item changes on its owner
    if (item.type === 'gear') item.bonusesSummary = summaryText(linesInGroups(lines, GEAR_BONUS_GROUPS));
    if (item.type === 'buff') item.summary = summaryText(lines);
    // The debuff chip shows what the debuff does (its effect and stat lines); duration, limbs and the rest stay in the tooltip
    if (item.type === 'debuff') item.summary = summaryText(linesInGroups(lines, DEBUFF_CHIP_GROUPS));
  }));
}

/**
 * Tooltips for the gear-granted skill and spell rows (built by `prepareSkillsAndSpells`, so `prepareItemSummaries` never
 * sees them). Each row is described from its catalog document at the granted Rank, not from the partial stand-in
 * `system`; a granted identifier with no catalog entry describes the stand-in itself.
 * @param {Iterable<object>} rows the granted rows (`type` is "skill" or "spell")
 * @param {Actor} actor
 */
export async function prepareGrantedSummaries(rows, actor) {
  await Promise.all([...rows].map(async (row) => {
    const kind = row.type === 'spell' ? 'spells' : 'skills';
    const identifier = row.system?.identifier;
    const official = identifier ? catalogEntries(kind).find((entry) => entry.system?.identifier === identifier) : null;
    const rank = Number(row.system?.modifiedRank ?? row.system?.rank ?? row.rank) || undefined;
    row.summaryTip = summaryTooltip(await describeItem(official ?? row, { actor, rank }));
  }));
}
