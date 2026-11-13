import { COGDamage } from './damage-pipeline.mjs';
import { COGSessionEngine } from '../session/session-engine.mjs';
import { damageTypeToElement, elementToDamageType, normalizeElementTag } from '../../data/tag-vocabulary.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { collectDefenseModifiers, collectCheckModifiers, collectRollAdvantage } from '../../utils/roll/damage-modifiers.mjs';
import { applyRowKind } from '../../utils/row-kinds.mjs';
import { vehicleDrFor } from '../../utils/vehicle/vehicle-combat.mjs';
import { buildRollContext, readSituationOptions, resolveRowAdvantage } from '../../utils/roll/roll-context.mjs';
import { resolveReachedRankBreaks } from '../../utils/skill/rank-breaks.mjs';
import { durationRounds } from '../../utils/time/durations.mjs';
import { getCOGStatModifier } from './actor-constants.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { buildRegionData, buildAuraRingData, withoutCoverageFill, createRegion } from '../../utils/area/region-shapes.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { findActorToken } from '../../utils/combat/interrupts.mjs';
import { emitsLight, igniteLight, extinguish as extinguishLight } from './light-source.mjs';
import { auraRank, computeAuraTempBars } from './aura-effects.mjs';
import { clearAllyAuraEffects } from './aura-relay.mjs';
import { withOneNoGmWarning } from '../../utils/gm-relay.mjs';
import { deleteAuraRegionsEverywhere } from './area-relay.mjs';
import { zeroHealthOutcome, ZERO_HEALTH } from './dying.mjs';
import {
  auraRadius, blankAuraState,
  syncAuraMembership, enterAuraCaster, enterAuraAllies, fallbackAuraAllies
} from './aura-pulse.mjs';


/**
 * Automatic CON Stat Check against fatal debuff damage.
 * When debuff damage would take a crawler's last Health Bar slot to 0, the crawler rolls a
 * CON Stat Check at the end of the round (Difficulty: 10 plus the current Floor). It costs no Action and
 * resolves by itself before the fatal damage lands. Passing it ends the debuff and voids the damage.
 *
 * @param {Item|object} debuff
 * @param {number} damageVal
 * @param {object} [options={}]
 * @returns {Promise<{ avoided: boolean, roll: Roll, dc: number, success: boolean }|null>}
 */
export async function checkFatalDebuffProtection(actor, debuff, damageVal, options = {}) {
  if (zeroHealthOutcome(actor) !== ZERO_HEALTH.DYING) return null;

  let currentFloor = options.floor;
  if (currentFloor === undefined || currentFloor === null) {
    currentFloor = getCurrentFloor();
  }
  currentFloor = Number(currentFloor) || 1;

  const dc = 10 + currentFloor;
  const conVal = actor.system?.abilities?.con?.value ?? 10;
  const conMod = actor.system?.abilities?.con?.mod ?? getCOGStatModifier(conVal);
  // Resistance check: `check.resist`, `stat.con` and the hazard's own tags (automatic, so only
  // `options.situations` can tick a situation). Rows from race, class, gear and buffs apply.
  let hazardTags = [];
  try {
    hazardTags = debuff?.allTags instanceof Set ? [...debuff.allTags] : (debuff ? [...getItemAllTags(debuff)] : []);
  } catch { /* a payload without tags just matches fewer rows */ }
  // The hazard's tags are the action; the resister's own conditions are `self.condition.*` (class review B7).
  const resistContext = buildRollContext({
    actor: actor, phase: 'check', check: 'resist', stat: 'con', tags: hazardTags, other: null,
    situations: readSituationOptions(options) ?? []
  });
  const resistMods = collectCheckModifiers(actor, resistContext);
  const resistAdv = resolveRowAdvantage(collectRollAdvantage(actor, resistContext));
  const resistTotal = conMod + resistMods.flatBonus;
  const resistDice = resistMods.diceParts.map(d => ` + ${d}`).join('');
  const roll = await new Roll(`${resistAdv.formula} + ${resistTotal}${resistDice}`, { mod: conMod }).evaluate();
  const success = roll.total >= dc;

  COGSessionEngine.recordRoll({
    actor: actor,
    roll,
    type: 'stat',
    name: `CON Check vs Fatal ${debuff?.name || 'Debuff'}`,
    isUntrained: false,
    dc,
    // An automatic check, not an Action.
    spendsAction: false
  }).catch(() => {});

  if (success) {
    if (typeof debuff?.delete === 'function') {
      try { await debuff.delete(); } catch (_) {}
    }
    if (typeof actor.deleteEmbeddedDocuments === 'function' && debuff?.id) {
      try { await actor.deleteEmbeddedDocuments('Item', [debuff.id]); } catch (_) {}
    }
  }

  const cardContent = `
    <div class="cog-chat-card cog-con-check-card cog-bg-window cog-text-strong" style="border: 2px solid ${success ? 'var(--cog-success)' : 'var(--cog-accent)'}; border-radius: 4px; padding: 8px; font-family: 'Oswald', sans-serif;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px solid var(--cog-panel-border); padding-bottom: 4px;">
        <span class="cog-text-gold" style="font-weight: bold;"><i class="fa-solid fa-heart-pulse"></i> AUTOMATIC CON STAT CHECK</span>
        <span class="cog-bg-surface-strong" style="font-size: 11px; padding: 1px 6px; border-radius: 3px;">Difficulty ${dc} (10 + Floor ${currentFloor})</span>
      </div>
      <div style="font-size: 13px; margin-bottom: 6px;">
        <strong>${actor.name}</strong> faces fatal damage from <strong>${debuff?.name || 'Debuff'}</strong>!
      </div>
      <div class="cog-bg-surface-muted" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; padding: 6px; border-radius: 3px;">
        <span class="cog-text-secondary" style="font-size: 14px;">CON Roll (${resistAdv.formula} + ${resistTotal}${resistDice}):</span>
        <span class="${success ? 'cog-text-success' : 'cog-text-danger'}" style="font-size: 18px; font-weight: bold;">${roll.total}</span>
        <span class="${success ? 'cog-bg-success-fill' : 'cog-bg-accent-fill'} cog-text-on-fill" style="margin-left: auto; font-size: 12px; font-weight: bold; padding: 2px 8px; border-radius: 3px;">
          ${success ? 'SUCCESS' : 'FAILED'}
        </span>
      </div>
      <div class="${success ? 'cog-text-success' : 'cog-text-danger'}" style="font-size: 12px; font-style: italic;">
        ${success 
          ? `On a Success, ${debuff?.name || 'the Debuff'} ends, and ${actor.name} avoids the damage!` 
          : `The check failed. Fatal damage is applied.`}
      </div>
    </div>
  `;

  if (typeof ChatMessage !== 'undefined' && typeof ChatMessage.create === 'function') {
    await ChatMessage.create({
      speaker: (typeof ChatMessage.getSpeaker === 'function') ? ChatMessage.getSpeaker({ actor: actor }) : { alias: actor.name },
      content: cardContent
    });
  }

  return {
    avoided: success,
    roll,
    dc,
    success
  };
}

/**
 * Apply incoming damage to this actor using Sprinter RPG rules (DR, Temp HP, full damage bars).
 * @param {number} rawDamage
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export async function applyDamage(actor, rawDamage, options = {}) {
  let payload = { targetActor: actor, ...options };
  if (typeof rawDamage === 'object' && rawDamage !== null) {
    payload.typedDamage = rawDamage;
    payload.rawDamage = Object.values(rawDamage).reduce((a, b) => a + (Number(b) || 0), 0);
  } else {
    payload.rawDamage = Number(rawDamage) || 0;
  }
  return COGDamage.applyDamageToTarget(payload);
}

/**
 * Grant or set temporary health bars for this actor.
 * @param {object} params
 * @param {number} params.count - Number of temporary bar slots
 * @param {number} params.hpPerSlot - HP capacity per slot
 * @param {string} [params.source=''] - Display label only (source spell or item name); never used for matching
 * @param {string} [params.sourceUuid=''] - UUID of the source item; the key used to match and remove these bars
 * @param {string} [params.element=''] - `element.<type>` tag the bars are limited to; empty = absorb every damage type
 * @returns {Promise<COGActor>}
 */
export async function grantTempBars(actor, { count, hpPerSlot, source = '', sourceUuid = '', element = '' } = {}) {
  const numCount = Math.max(0, Math.floor(Number(count) || 0));
  const numPerSlot = Math.max(0, Math.floor(Number(hpPerSlot) || 0));
  if (numCount <= 0 || numPerSlot <= 0) {
    return actor.update({
      'system.attributes.hp.tempBars.count': 0,
      'system.attributes.hp.tempBars.maxCount': 0,
      'system.attributes.hp.tempBars.hpPerSlot': 0,
      'system.attributes.hp.tempBars.currentSlotHp': 0,
      'system.attributes.hp.tempBars.source': '',
      'system.attributes.hp.tempBars.sourceUuid': '',
      'system.attributes.hp.tempBars.element': '',
      'system.attributes.hp.temp': 0
    });
  }
  const totalHp = numCount * numPerSlot;
  return actor.update({
    'system.attributes.hp.tempBars.count': numCount,
    'system.attributes.hp.tempBars.maxCount': numCount,
    'system.attributes.hp.tempBars.hpPerSlot': numPerSlot,
    'system.attributes.hp.tempBars.currentSlotHp': numPerSlot,
    'system.attributes.hp.tempBars.source': String(source || ''),
    'system.attributes.hp.tempBars.sourceUuid': String(sourceUuid || ''),
    'system.attributes.hp.tempBars.element': normalizeElementTag(element),
    'system.attributes.hp.temp': totalHp
  });
}

/**
 * Activate an aura spell/item on this actor. The cast gives the caster and the allies inside the radius the
 * entry effects only (buffs, temporary health bars, one heal-over-time); damage, debuffs, instant healing
 * and cleansing happen at each Step 5 pulse. The aura's Region rides the caster's token, and who is inside
 * is kept up to date by syncAuraMembership.
 * @param {COGItem} spellItem
 * @param {object} [options={}] `allies`/`combatants` stand in for geometry when the caster has no token
 * @returns {Promise<object>}
 */
export async function activateAura(actor, spellItem, options = {}) {
  if (!spellItem) return { active: false, error: 'No item provided' };
  const sys = spellItem.system || {};
  const areaConfig = sys.area;
  const resolvedBreaks = resolveReachedRankBreaks(spellItem, auraRank(actor, spellItem));
  const radius = auraRadius(actor, spellItem);

  // Temporary health bars (the same derivation the GM relay uses)
  const { slots, hpPerSlot, totalTempHp, element } = computeAuraTempBars(actor, spellItem);
  if (slots > 0) {
    await actor.grantTempBars({ count: slots, hpPerSlot, source: spellItem.name, sourceUuid: spellItem.uuid || '', element });
  }

  // The caster's own token (never a controlled token of someone else)
  const scene = typeof canvas !== 'undefined' ? canvas?.scene : null;
  const token = scene ? findActorToken(actor) : null;
  const tokenId = token ? (token.document?.id ?? token.id ?? '') : '';

  // Active, duration, and a fresh aura state
  const rounds = (durationRounds(sys.durationConfig) || 2) + (resolvedBreaks.durationBonus || 0);
  // Gear auras last while the item is worn or switched on: no round countdown, so no duration to write (3.17-6)
  await spellItem.update({
    'system.active': true,
    ...(spellItem.type === 'gear' ? {} : { 'system.durationConfig.remainingRounds': rounds }),
    'system.appliedAllyUuids': [],
    'system.auraState': { ...blankAuraState(), sceneId: tokenId ? (scene.id ?? '') : '', tokenId }
  });

  // The marked area, attached to the caster's token so it moves with it
  let template = null;
  if (token) {
    const x = token.center?.x ?? (token.x + (canvas.grid?.size || 50) / 2);
    const y = token.center?.y ?? (token.y + (canvas.grid?.size || 50) / 2);
    if (spellItem.uuid) {
      await deleteAuraRegionsEverywhere(spellItem.uuid);
    }
    const regionParams = {
      name: spellItem.name,
      scene,
      x,
      y,
      distance: radius,
      gridBased: !scene.grid?.isGridless,
      attachToken: tokenId,
      level: token.document?.level,
      color: '#d4af37',
      flags: {
        auraSourceUuid: spellItem.uuid || '',
        actorId: actor.id,
        isAura: true,
        target: 'self'
      }
    };
    // The round outline replaces the grid-square coverage fill (3.40 l, 3.40i u); the grid-based core still decides
    // membership. The ring follows the token and dies with the aura's regions.
    const ring = buildAuraRingData(regionParams);
    const coreData = buildRegionData(regionParams);
    template = await createRegion(scene, ring ? withoutCoverageFill(coreData) : coreData);
    if (ring) await createRegion(scene, ring);
  }

  // Entry effects: the caster, then whoever is inside
  const members = await withOneNoGmWarning(async () => {
    await enterAuraCaster(actor, spellItem);
    return tokenId
      ? syncAuraMembership(actor, spellItem)
      : enterAuraAllies(actor, spellItem, fallbackAuraAllies(actor, spellItem, options));
  });
  const affectedAllies = members.allies;
  if (typeof actor.prepareData === 'function') actor.prepareData();
  for (const ally of affectedAllies) ally.prepareData?.();

  spellItem._appliedAllyActors = [...affectedAllies];

  // An aura that emits light lights a marker token (3.16c)
  if (emitsLight(spellItem)) await igniteLight(actor, spellItem);

  return {
    active: true,
    radius,
    slots,
    hpPerSlot,
    totalTempHp,
    tempBarsGranted: { slots, hpPerSlot, totalTempHp, element },
    remainingRounds: rounds,
    target: 'Self',
    targetFilter: areaConfig?.targetFilter || 'allies',
    tokenCenter: token ? { x: token.center?.x, y: token.center?.y } : null,
    templateId: template?.id || null,
    affectedAllies,
    affectedEnemies: []
  };
}

/**
 * Deactivate an aura spell/item and clear any granted temporary health bars.
 * Also clears temporary health bars and aura-inflicted effects from all entities in the aura.
 * @param {COGItem} spellItem
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export async function deactivateAura(actor, spellItem, options = {}) {
  if (!spellItem) return { active: false };

  const auraUuid = spellItem.uuid || '';
  // Provenance is matched by the source item UUID only (embedded _ids are not unique across actors); names are display labels and may collide between items.
  const isAuraTempBars = (actor) => Boolean(auraUuid) && actor?.system?.attributes?.hp?.tempBars?.sourceUuid === auraUuid;
  const isAuraEffect = (it) => Boolean(auraUuid) && it.flags?.[SYSTEM_ID]?.auraSourceUuid === auraUuid;
  const sys = spellItem.system || {};
  const appliedAllyUuids = new Set(Array.isArray(sys.appliedAllyUuids) ? sys.appliedAllyUuids : []);
  // Everyone the aura tracks: members, plus allies whose temp bars are put away
  const auraState = sys.auraState || {};
  const stateUuids = [
    ...(auraState.allyUuids || []), ...(auraState.enemyUuids || []), ...(auraState.tempBarUuids || []),
    ...(auraState.storedBars || []).map(b => b.uuid)
  ];

  // A deleted gear item cannot be written to (its delete hook calls this with `itemDeleted`)
  if (!options?.itemDeleted) {
    await spellItem.update({
      'system.active': false,
      ...(spellItem.type === 'gear' ? {} : { 'system.durationConfig.remainingRounds': 0 }),
      'system.appliedAllyUuids': [],
      'system.auraState': blankAuraState()
    });
  }

  if (isAuraTempBars(actor)) {
    await actor.grantTempBars({ count: 0, hpPerSlot: 0 });
  }

  // Discover all candidate entities across options, combatants, scene tokens, and world actors
  const candidateEntities = new Map();
  const addCandidate = (candidate) => {
    const key = candidate?.uuid || candidate?.id;
    if (key && key !== (actor.uuid || actor.id) && !candidateEntities.has(key)) {
      candidateEntities.set(key, candidate);
    }
  };

  // 0. Allies remembered on the item instance
  if (Array.isArray(spellItem._appliedAllyActors)) {
    for (const ally of spellItem._appliedAllyActors) addCandidate(ally);
  }
  spellItem._appliedAllyActors = [];

  // 1. Direct allies passed in options
  if (Array.isArray(options?.allies)) {
    for (const ally of options.allies) addCandidate(ally);
  }

  // 2. Combat combatants
  const combatants = options?.combatants ||
    (Array.isArray(actor.combat?.combatants) ? actor.combat.combatants : null) ||
    (globalThis.game?.combat?.combatants
      ? (Array.isArray(globalThis.game.combat.combatants)
          ? globalThis.game.combat.combatants
          : Array.from(globalThis.game.combat.combatants.values?.() || []))
      : []);
  if (combatants) {
    for (const c of combatants) {
      const act = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
      if (act) addCandidate(act);
    }
  }

  // 3. Canvas placeable tokens
  if (typeof canvas !== 'undefined' && canvas?.tokens?.placeables) {
    for (const t of canvas.tokens.placeables) {
      if (t.actor) addCandidate(t.actor);
    }
  }

  // 4. World actors (game.actors)
  if (globalThis.game?.actors) {
    const allActors = Array.from(globalThis.game.actors.values());
    for (const act of allActors) {
      if (act) {
        if (appliedAllyUuids.has(act.uuid) || isAuraTempBars(act)) {
          addCandidate(act);
        }
      }
    }
  }

  // Remembered allies and tracked members by UUID; resolves unlinked token actors that game.actors cannot.
  for (const uuid of [...appliedAllyUuids, ...stateUuids]) {
    const act = resolveActorByUuid(uuid);
    if (act) addCandidate(act);
  }

  // Remove temporary health bars and aura-created conditions from all affected entities.
  // Entities the current user does not own are cleared by the GM through the relay.
  for (const entity of candidateEntities.values()) {
    await clearAllyAuraEffects(entity, spellItem);
    if (typeof entity.prepareData === 'function') {
      entity.prepareData();
    }
  }

  // Also remove aura buffs/conditions from the caster (this)
  if (actor.items) {
    const myItems = Array.from(actor.items ?? []);
    const toDeleteSelf = [];
    for (const it of myItems) {
      if (isAuraEffect(it)) {
        toDeleteSelf.push(it.id || it._id);
      }
    }
    if (toDeleteSelf.length > 0) {
      await actor.deleteEmbeddedDocuments('Item', toDeleteSelf);
    }
  }
  if (typeof actor.prepareData === 'function') {
    actor.prepareData();
  }

  // Remove the aura's region, on whichever scene it was placed
  if (auraUuid) await deleteAuraRegionsEverywhere(auraUuid);

  // ...and its light goes out with it (3.16c); a deleted item's lights go out in its delete hook
  if (!options?.itemDeleted) await extinguishLight(spellItem);

  return { active: false, deactivated: true };
}

/**
 * Whether a stored resistance or immunity covers an incoming damage type. Two known element types match only when they are
 * the same element (Fire does not cover Brimstone, nor Brimstone cover Fire); otherwise the loose name match for free-text types.
 * @param {string} target lowercased incoming type or element tag
 * @param {string} listed lowercased stored entry
 */
function sameDamageType(target, listed) {
  const a = normalizeElementTag(target);
  const b = normalizeElementTag(listed);
  if (a && b) return a === b;
  return target === listed || target.includes(listed) || listed.includes(target);
}

/**
 * Check if actor has resistance to a specific damage type
 * @param {string} damageType
 * @returns {boolean}
 */
export function hasResistance(actor, damageType) {
  if (!damageType) return false;
  const list = actor.system?.attributes?.resistances || [];
  const target = damageType.toLowerCase().trim();
  return list.some(r => sameDamageType(target, r.toLowerCase().trim()));
}

/**
 * Check if actor has immunity to a specific damage type
 * @param {string} damageType
 * @returns {boolean}
 */
export function hasImmunity(actor, damageType) {
  if (!damageType) return false;
  const list = actor.system?.attributes?.immunities || [];
  const target = damageType.toLowerCase().trim();
  return list.some(i => sameDamageType(target, i.toLowerCase().trim()));
}

/**
 * Get damage reduction for an incoming damage type: the actor's derived resistances/immunities plus every
 * conditional `defenseModifiers` row that matches the `defense` context (the defender's `self.*` tags, the
 * attacker's `attacker.*` tags and the incoming attack's own tags).
 * Returns { percent, flat, dr, rounding: 'up'|'down', isResistant, isImmune, vulnerable, suppressDr, hbFactor, hbSource, sources }.
 * `hbFactor` (1 when no row) is the largest `healthBarScale` factor: damage reaching the Health Bar is divided by it.
 * `sources` ({ kind, label }[]) names what applied, for the chat breakdown only: every matching `defenseModifiers`
 * row, plus `{ kind: 'resistance', label: 'Resistant' }` / `{ kind: 'immunity', label: 'Immune' }` for a derived one.
 * `dr` is conditional flat damage resistance, on top of `attributes.dr.total`. `vulnerable`: a matching
 * `vulnerability` row doubles this damage after DR and Resistance. The caller (`COGDamage.applyDamageToTarget`) applies
 * them in the book's order: DR, then `percent`/`flat` (Resistance and reductions), then Vulnerability, then Immunity. `suppressDr`: a matching `suppress_dr` row means DR does not
 * reduce this damage type.
 * @param {string} damageType
 * @param {object} context a `defense` RollContext built for this actor (`buildRollContext({ actor, phase: 'defense', ... })`)
 * @returns {object}
 */
export function getDamageReduction(actor, damageType, context) {
  if (!damageType) return { percent: 0, flat: 0, dr: 0, rounding: 'up', isResistant: false, isImmune: false, vulnerable: false, suppressDr: false, sources: [] };
  const targetType = damageType.toLowerCase().trim();
  const elementTag = damageTypeToElement(targetType) || (targetType.startsWith('element.') ? targetType : null);
  const canonicalName = (elementToDamageType(elementTag) || targetType).toLowerCase();

  if (actor.hasImmunity(damageType) || (elementTag && actor.hasImmunity(elementTag))) {
    return { percent: 1, flat: 0, dr: 0, rounding: 'up', isResistant: false, isImmune: true, vulnerable: false, suppressDr: false, sources: [{ kind: 'immunity', label: 'Immune' }] };
  }

  const sources = [];
  const acc = {
    percent: 0, flat: 0, dr: 0, rounding: 'up', isResistant: actor.hasResistance(damageType) || (elementTag && actor.hasResistance(elementTag)),
    immune: null, vulnerable: false, suppressDr: false, hbFactor: 1, hbSource: ''
  };
  if (acc.isResistant) {
    acc.percent += 0.5;
    sources.push({ kind: 'resistance', label: 'Resistant' });
  }

  // 3.44e: someone aboard a vehicle is also protected by its DR, read now so a changed crew needs no re-preparation. The
  // explosion (`vehicle.explosion` in the defense context) ignores it.
  const vehicleDr = vehicleDrFor(actor, context);
  if (vehicleDr) {
    acc.dr += vehicleDr.dr;
    sources.push({ kind: 'dr', label: vehicleDr.label });
  }

  const { rows } = collectDefenseModifiers(actor, context, { perHit: true });
  for (const dm of rows) {
    // Only a kind that declares `damageType` is typed; a stale stored type on any other row (a `dr` row) is ignored.
    const dt = dm.def?.fields?.includes('damageType') ? (dm.damageType || '').toLowerCase().trim() : '';
    const applies = !dt || dt === 'all' || dt === targetType || dt === canonicalName || (elementTag && dt === elementTag);
    if (!applies) continue;
    // A Resistance counts once per damage type: a second one (derived or a row) never adds another half.
    const percentBefore = acc.percent;
    const wasResistant = acc.isResistant;
    sources.push({ kind: dm.kind, label: dm.label });
    applyRowKind('defenseModifiers', dm.def, 'defense', acc, dm.row, { actor: actor, source: dm.source, label: dm.label, damageType: targetType, context, tags: context.tags });
    if (dm.kind === 'resistance' && wasResistant) acc.percent = percentBefore;
    // A matching immunity wins outright: what was gathered before it is discarded.
    if (acc.immune) {
      return { percent: 1, flat: 0, dr: 0, rounding: 'up', isResistant: false, isImmune: true, vulnerable: false, suppressDr: false, sources: [{ kind: 'immunity', label: acc.immune.label }] };
    }
  }

  return {
    percent: Math.min(1, Math.max(0, acc.percent)),
    flat: acc.flat,
    dr: acc.dr,
    rounding: acc.rounding,
    isResistant: acc.isResistant,
    isImmune: false,
    vulnerable: acc.vulnerable,
    suppressDr: acc.suppressDr,
    hbFactor: acc.hbFactor,
    hbSource: acc.hbSource,
    sources
  };
}
