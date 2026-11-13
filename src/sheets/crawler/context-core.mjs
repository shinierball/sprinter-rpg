/**
 * Page 1 (Core & Combat) header context: actor-type flags, floor state, health bars,
 * temporary shield bars and the precomputed selector options (CONTRIBUTING §5).
 */
import { buildTagPills } from '../base/tag-editor.mjs';
import { actorTagEditVerdict, isDerivedActorTag } from '../../utils/tag/actor-tag-permissions.mjs';
import { collectActorTags } from '../../documents/active-tags.mjs';
import { sexSelectView } from '../../utils/tag/sex.mjs';
import { camerasOffered, cameraArmView } from '../../utils/roll/cameras.mjs';
import { creatureMoveOf } from '../../documents/actor/actor-move.mjs';
import { mobDifficultyShift, MOB_QUALITIES } from '../../documents/actor/attack-targets.mjs';
import { COGActor } from '../../documents/actor.mjs';
import { contentRegistry } from '../../content/registry.mjs';
import { getHpPerBar } from '../../documents/combat-metrics.mjs';
import { DEFAULT_SIZE, getSizeInfo, sizeOptions } from '../../data/sizes.mjs';
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { BOSS_TIERS, bossActionBudget } from '../../data/mob-creation-rules.mjs';
import { overlayOf, effectiveRace, storedAttributes } from '../../utils/character/overlay-state.mjs';
import { isRaceClassLocked, raceClassText, raceClassUnlockFloor } from '../../utils/character/race-class-floor.mjs';
import { isRaceOrClass } from '../../utils/document-types.mjs';

const FLOOR_OPTIONS = [
  'Floor 1', 'Floor 2', 'Floor 3', 'Floor 4', 'Floor 5', 'Floor 6',
  'Floor 7', 'Floor 8', 'Floor 9', 'Floor 10', 'Floor 11', 'Floor 12',
  'Floor 13', 'Floor 14', 'Floor 15', 'Floor 16', 'Floor 17', 'Floor 18',
  'Overworld', 'Celestial'
];
const MOB_CREATURE_TYPES = [
  'Beast', 'Undead', 'Construct', 'Humanoid', 'Aberration', 'Elemental',
  'Demon', 'Celestial', 'Plant', 'Dragon', 'Monstrosity', 'Giant', 'Ooze'
];

/** Select options for a fixed list, plus a "(Custom)" entry when the stored value is not in it. */
function optionsWithCustom(values, current) {
  const options = values.map(v => ({ value: v, label: v, selected: current.toLowerCase() === v.toLowerCase() }));
  if (current && !options.some(o => o.selected)) {
    options.push({ value: current, label: `${current} (Custom)`, selected: true });
  }
  return options;
}

/** Most bars that still leave each segment wide enough (about 42px on the default 838px bar) for the HP number above the percentage. */
const MAX_BARS_WITH_HP_NUMBER = 20;

export function healthSegments(numBars, hpPerBar) {
  const showHp = numBars <= MAX_BARS_WITH_HP_NUMBER;
  const segments = [];
  for (let i = 1; i <= numBars; i++) {
    const pct = Math.round((i / numBars) * 100);
    segments.push({ pct, label: `${pct}%`, hpPerBar, showHp });
  }
  return segments;
}

function tempBarSlots(tb) {
  const count = Number(tb?.count) || 0;
  const maxCount = Math.max(count, Number(tb?.maxCount) || count);
  const hpPerSlot = Number(tb?.hpPerSlot) || 0;
  const currentSlotHp = Number(tb?.currentSlotHp) || (count > 0 ? hpPerSlot : 0);
  const slots = [];
  for (let i = 1; i <= maxCount; i++) {
    const isDepleted = i > count;
    const isCurrentActive = i === count;
    const slotHp = isDepleted ? 0 : (isCurrentActive ? currentSlotHp : hpPerSlot);
    slots.push({
      index: i,
      isDepleted,
      isCurrentActive,
      slotHp,
      maxHp: hpPerSlot,
      fillPct: hpPerSlot > 0 ? Math.round((slotHp / hpPerSlot) * 100) : 0,
      label: `${slotHp}/${hpPerSlot}`
    });
  }
  return slots;
}

/**
 * Mob page 1: boss tier select (from CONFIG.COG.bossTiers) and the passive DR, stat budget and
 * boss action budget readouts the mob DataModel derives (D5-D).
 */
function prepareMobReadouts(context, system, actor) {
  const currentTier = system?.bossTier || 'none';
  const tiers = globalThis.CONFIG?.COG?.bossTiers || BOSS_TIERS;
  context.mobBossTiers = [
    { value: 'none', label: 'Regular Mob', selected: currentTier === 'none' },
    ...Object.entries(tiers).map(([value, cfg]) => ({ value, label: cfg?.label ?? value, selected: currentTier === value }))
  ];
  const dr = system?.attributes?.dr;
  context.mobDrBreakdown = {
    armor: Number(dr?.armor) || 0,
    floor: Number(dr?.floor) || 0,
    total: Number(dr?.total) || 0
  };
  context.mobStatBudget = system?.attributes?.statBudget || { base: 1, points: 0 };
  context.mobStatSpent = Number(system?.attributes?.statSpent) || 0;
  context.mobStatOverBudget = Boolean(system?.attributes?.statOverBudget);
  // Budget = max(2, crawler-side combatants). Live count comes from the combat the mob fights in;
  // outside combat the minimum 2 shows with a hint (the world "crawlers remaining" count is unrelated).
  const combat = globalThis.game?.combat;
  const inCombat = Boolean(actor?.id) && Array.from(combat?.combatants ?? []).some(c => c.actorId === actor.id || c.actor?.id === actor.id);
  const crawlerSide = inCombat && typeof combat.getMaxCrawlerAlliesSeen === 'function' ? combat.getMaxCrawlerAlliesSeen() : 0;
  context.mobBossActionBudget = bossActionBudget(crawlerSide);
  context.mobBossCrawlerSide = inCombat ? crawlerSide : null;
  // Evade and Surprise as the rules read them: the stat block shifted +/-5 by the mob's net Advantage (E6.10). The
  // inputs and token bars keep the stat block.
  context.mobEvade = shiftedReadout(system?.attributes?.effectiveEvadeDC, mobDifficultyShift(actor, MOB_QUALITIES.evade));
  context.mobSurprise = shiftedReadout(system?.attributes?.effectiveSurpriseDC, mobDifficultyShift(actor, MOB_QUALITIES.surprise));
}

/** The Move readout beside the stored Move: `{ rated, title }` when the Move rows change it, else null. */
function moveNowReadout(actor) {
  const { full, rated, sources } = creatureMoveOf(actor);
  return rated === full ? null : { rated, title: sources.join('; ') };
}

/** `{ dc, shift, flat, shifted, title }` for one mob Difficulty: the stat-block number, its shift, its flat Check rows and the reasons. */
function shiftedReadout(statBlockDC, shiftState) {
  const base = Number(statBlockDC) || 0;
  const shift = Number(shiftState?.shift) || 0;
  const flat = Number(shiftState?.flat) || 0;
  const signed = (n) => (n > 0 ? `+${n}` : `\u2212${Math.abs(n)}`);
  const parts = [];
  if (shift !== 0) parts.push(`${signed(shift)}: ${shiftState.label}`);
  if (flat !== 0) parts.push(`${signed(flat)}: ${game.i18n?.localize?.('COG.MobAttack.FlatLabel') ?? 'Check modifiers'}`);
  return { dc: base + shift + flat, base, shift, flat, shifted: shift !== 0 || flat !== 0, title: parts.join('; ') };
}

/**
 * The registered species whose tags the crawler carries (its origin at induction), or null.
 * @param {Actor} actor
 * @returns {object|null}
 */
function actorSpecies(actor) {
  const tags = Array.isArray(actor?.system?.tags) ? actor.system.tags : [];
  if (!tags.length) return null;
  return contentRegistry.getSpeciesList().find(sp => Array.isArray(sp?.tags) && sp.tags.some(t => tags.includes(t))) || null;
}

/**
 * Crawler Core tab: the species label, and the "Race and Class unlock on Floor 3" hint while the crawler is below the
 * unlock floor and has neither. The selects stay enabled (applying one there asks a Rule Break).
 */
function prepareRaceClassHints(context, actor) {
  context.speciesLabel = '';
  context.raceClassHint = '';
  if (!context.isCrawler) return;
  const species = actorSpecies(actor);
  if (species) context.speciesLabel = raceClassText('COG.RaceClass.SpeciesLabel', { species: species.label || species.id });
  const hasRaceOrClass = Boolean(actor.items?.some(isRaceOrClass));
  if (isRaceClassLocked(actor) && !hasRaceOrClass) {
    context.raceClassHint = raceClassText('COG.RaceClass.UnlockHint', { floor: raceClassUnlockFloor() });
  }
}

/** The Race select's hint while a form race is laid over the crawler: the original race is not in force; '' otherwise. */
function raceNotInForceHint(actor) {
  if (!overlayOf(actor.items)) return '';
  const form = effectiveRace(actor.items);
  if (!form) return '';
  return globalThis.game?.i18n?.format?.('COG.Transform.RaceNotInForce', { form: form.name }) ?? '';
}

/**
 * The page 1 tag pill editor (E8.8): the actor's explicit tags, removable only where the user may edit them, plus the
 * derived tags read-only. Players with no editable namespace get no add row.
 */
function prepareTagEditor(context, actor) {
  context.showActorTags = !context.isVehicle && actor.type !== 'mount_vehicle';
  if (!context.showActorTags) return;
  const stored = Array.isArray(actor.system?.tags) ? actor.system.tags.filter((t) => typeof t === 'string') : [];
  const explicit = stored.filter((t) => !isDerivedActorTag(t));
  const derived = [...collectActorTags(actor)].filter(isDerivedActorTag);
  const isGM = Boolean(game.user?.isGM);
  context.tagsData = buildTagPills({
    explicit,
    derived,
    removable: (id) => actorTagEditVerdict(actor, id).ok,
    canAdd: isGM || Boolean(actor.isOwner),
    addPlaceholder: isGM ? 'COG.Tags.ActorHintGm' : 'COG.Tags.ActorHintOwner'
  });
}

export function prepareCoreContext(context, actor) {
  const system = context.system;
  context.data = actor;
  context.isMob = actor.type === 'mob';
  context.isCrawler = actor.type === 'crawler';
  context.isPet = actor.type === 'pet';
  context.isVehicle = actor.type === 'mount_vehicle';
  context.isNPC = actor.type === 'npc';
  context.currentFloor = COGActor.getCurrentFloor();
  context.floorTimer = COGActor.getFloorTimer();
  context.crawlerCount = COGActor.getCrawlerCount();
  context.formattedCrawlerCount = Number(context.crawlerCount).toLocaleString();
  context.bankedGrindHours = Number(system?.details?.bankedGrindHours ?? system?.bankedGrindHours) || 0;

  // Health bar segments: crawlers always have 10 bars; mobs set their own count.
  const numBars = context.isMob ? Math.max(1, Number(system.attributes?.hp?.bars) || 2) : 10;
  context.hpPerBar = getHpPerBar(actor);
  context.healthSegments = healthSegments(numBars, context.hpPerBar);
  context.fiveHpBars = 5 * context.hpPerBar;

  const tb = system.attributes?.hp?.tempBars;
  context.hasTempBars = (Number(tb?.count) || 0) > 0 && (Number(tb?.hpPerSlot) || 0) > 0;
  if (context.hasTempBars) {
    context.tempBarSlots = tempBarSlots(tb);
    context.tempBarsSource = tb.source || 'Shield';
  }

  context.currentSizeInfo = getSizeInfo(system.attributes?.size ?? DEFAULT_SIZE);
  // The size select and the Move input are saved with the sheet, so they show the stored values; while a form is laid
  // over the crawler the form's are only in `currentSizeInfo` and the "now" readout (7.1k)
  const stored = storedAttributes(actor);
  context.sizeOptions = sizeOptions(stored.size ?? system.attributes?.size ?? DEFAULT_SIZE);
  context.storedMove = stored.speed?.move ?? system.attributes?.speed?.move;

  context.cameraArm = camerasOffered(actor) ? cameraArmView(actor) : null;
  context.floorOptions = optionsWithCustom(FLOOR_OPTIONS, String(system?.details?.floor || '').trim());
  prepareMobReadouts(context, system, actor);
  context.moveNow = moveNowReadout(actor);
  context.mobCreatureTypes = optionsWithCustom(MOB_CREATURE_TYPES, String(system?.details?.creatureType || '').trim());

  const rc = COGRaceClassApplier.getRaceClassContext(actor, { requirements: true });
  context.raceOptions = rc.raceOptions;
  context.classOptions = rc.classOptions;
  context.hasCustomRace = rc.hasCustomRace;
  context.hasCustomClass = rc.hasCustomClass;
  context.currentRace = rc.currentRace;
  context.currentClass = rc.currentClass;
  context.currentRaceLabel = rc.currentRaceLabel;
  context.currentClassLabel = rc.currentClassLabel;
  context.currentRequirements = rc.currentRequirements;
  prepareRaceClassHints(context, actor);
  context.raceNotInForce = raceNotInForceHint(actor);
  prepareTagEditor(context, actor);
  context.sexSelect = sexSelectView(actor, collectActorTags(actor));
}
