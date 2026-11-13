import { findConditionEntry } from '../../content/catalog-lookup.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { getHpPerBar } from '../combat-metrics.mjs';
import { isAreaAttack } from '../../utils/area/area-attack.mjs';
import { isAreaTagSet, INJURY_NAMESPACE } from '../../utils/tag/tag-mechanics.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { carrySourceStamp, landItems } from '../../utils/content-source.mjs';
import { conditionTagId, itemIdentifier } from '../../utils/identifier.mjs';
import { resolveReachedRankBreaks } from '../../utils/skill/rank-breaks.mjs';
import { resolveAreaGeometry } from '../../utils/area/area-geometry.mjs';
import { isBuffSuppressed } from '../../utils/effects/dispel.mjs';
import { isGearSuppressed } from '../../utils/effects/gear-suppression.mjs';
import { isMarkerActor } from '../../utils/area/marker.mjs';
import { restoredValue } from '../../utils/damage/resource-restore.mjs';
import { conditionRefTag, conditionItemData } from './condition-data.mjs';
import { raceInForce, isAffliction } from '../../utils/character/transform-rules.mjs';
import { stampLanding, cureByWindow } from './transformations.mjs';
import { postCue } from './transform-cues.mjs';
import { holdSecret } from '../pending-secrets.mjs';
import { getSpellRank } from './spell-rank.mjs';
import { confirmRuleBreak, withRuleBreak, ruleBreakUpdate } from '../../utils/rule-break.mjs';
import { repeatVerdict, REPEAT_RULINGS } from './condition-repeat.mjs';
import { askRepeatRuling } from './condition-repeat-ask.mjs';
import { toStringList } from '../../utils/first-scalar.mjs';
import { incomingEffectTags } from '../../utils/effects/incoming-effect.mjs';
import { effectImmunityFor, immuneText } from '../../utils/effects/effect-immunity.mjs';
import { isDyingDebuff, isDeadDebuff } from './dying.mjs';
import { settleForfeitsOf } from './condition-expiry.mjs';
import { confirmHealing, settleHealed } from './healing.mjs';

/** A document's full tag list (explicit + derived) as an array. */
function tagListOf(item) {
  const tags = item?.allTags || (typeof item?.getTags === 'function' ? item.getTags() : getItemAllTags(item));
  return Array.from(tags ?? []);
}

/** Whether a debuff carries the condition tag `ref` names (`condition.<id>`, or an identifier). */
export function debuffHasConditionRef(debuff, ref) {
  const tag = conditionRefTag(ref);
  return Boolean(tag) && tagListOf(debuff).includes(tag);
}

/** Whether two resolved buffs/debuffs share a non-empty stored identifier. */
function sameIdentifier(a, b) {
  const id = a?.system?.identifier;
  return Boolean(id) && id === b?.system?.identifier;
}


/**
 * Get all archetype tags associated with this actor (e.g. Set {'archetype.mage'}): the archetype tags of the embedded
 * class and race items. The `details.class` text is never parsed.
 * @returns {Set<string>}
 */
export function getArchetypeTags(actor) {
  const archetypes = new Set();
  const itemsList = Array.from(actor.items ?? []);

  for (const item of itemsList) {
    if (item.type === 'class' || (item.type === 'race' && raceInForce(itemsList, item))) {
      const itemTags = item.allTags || getItemAllTags(item);
      for (const t of itemTags) {
        if (t.startsWith('archetype.')) archetypes.add(t);
      }
    }
  }

  return archetypes;
}


/**
 * Resolve and return details for the up to 3 active external buffs
 * @returns {Array<object>}
 */
export function getActiveBuffs(actor) {
  const rawBuffs = actor.system?.attributes?.externalBuffs;
  const resolved = [];

  if (rawBuffs) {
    let buffKeys = [];
    if (Array.isArray(rawBuffs)) {
      buffKeys = rawBuffs.slice(0, 3);
    } else if (typeof rawBuffs === 'object') {
      buffKeys = [
        rawBuffs.buff1,
        rawBuffs.buff2,
        rawBuffs.buff3
      ].filter(Boolean);
      if (buffKeys.length === 0) {
        buffKeys = Object.values(rawBuffs).filter(Boolean).slice(0, 3);
      }
    }

    for (const key of buffKeys) {
      if (!key) continue;
      const buffObj = resolveBuff(actor, key);
      if (buffObj) resolved.push(buffObj);
    }
  }

  // Also include any embedded buff items explicitly flagged as active
  if (actor.items) {
    const itemsList = Array.from(actor.items ?? []);
    for (const item of itemsList) {
      if (item.type === 'buff' && item.system?.active) {
        if (!resolved.some(r => r.id === (item.id || item._id))) {
          const sysData = (typeof item.system?.toObject === 'function')
            ? item.system.toObject(false)
            : structuredClone(item.system || {});
          resolved.push({
            id: item.id || item._id,
            name: item.name,
            type: item.type,
            system: sysData,
            ...sysData
          });
        }
      } else if (item.type === 'gear' && item.system?.equipped && Array.isArray(item.system?.persistentBuffs) && !isGearSuppressed(actor, item, 'persistentBuffs')) {
        for (const bKey of item.system.persistentBuffs) {
          if (!bKey) continue;
          const buffObj = resolveBuff(actor, bKey);
          if (buffObj) {
            const uniqueId = `gear-${item.id || item._id}-${buffObj.id || bKey}`;
            if (!resolved.some(r => r.id === uniqueId || sameIdentifier(r, buffObj))) {
              resolved.push({
                ...buffObj,
                id: uniqueId,
                sourceGearId: item.id || item._id,
                sourceGearName: item.name
              });
            }
          }
        }
      }
    }
  }

  // A Buff a dispel suspends does not count (3.13-2): the buff slot, buff item and gear sources all end here.
  return resolved.filter(buff => !isBuffSuppressed(actor, buff));
}


/**
 * Resolve a buff by embedded/world/compendium id or by `system.identifier` (never by name).
 * @param {string} rawVal
 * @returns {object|null}
 */
export function resolveBuff(actor, rawVal) {
  if (!rawVal) return null;
  const str = String(rawVal).trim();
  if (!str) return null;

  // 1. Check embedded item on actor
  const ownedMatch = (i) => i.id === str || i._id === str || i.system?.identifier === str;
  const owned = actor.items?.get(str) || actor.items?.find(ownedMatch);
  if (owned && owned.type === 'buff') {
    const sysData = (typeof owned.system?.toObject === 'function')
      ? owned.system.toObject(false)
      : (globalThis.foundry?.utils?.deepClone ? foundry.utils.deepClone(owned.system || {}) : structuredClone(owned.system || {}));
    return {
      id: owned.id || owned._id,
      name: owned.name,
      type: 'buff',
      img: owned.img || 'icons/svg/aura.svg',
      system: sysData
    };
  }

  // 2. The registered buff catalog: by _id or identifier.
  const compBuff = findConditionEntry('buffs', str);
  if (compBuff) {
    const sysData = (typeof compBuff.system?.toObject === 'function')
      ? compBuff.system.toObject(false)
      : (globalThis.foundry?.utils?.deepClone ? foundry.utils.deepClone(compBuff.system || {}) : structuredClone(compBuff.system || {}));
    return {
      id: compBuff._id,
      name: compBuff.name,
      type: 'buff',
      img: compBuff.img || 'icons/svg/aura.svg',
      system: sysData
    };
  }

  // 3. Check world items
  if (globalThis.game?.items) {
    const worldItem = Array.from(game.items).find(i => (i.id === str || i._id === str || i.system?.identifier === str) && i.type === 'buff');
    if (worldItem) {
      const sysData = (typeof worldItem.system?.toObject === 'function')
        ? worldItem.system.toObject(false)
        : (globalThis.foundry?.utils?.deepClone ? foundry.utils.deepClone(worldItem.system || {}) : structuredClone(worldItem.system || {}));
      return {
        id: worldItem.id || worldItem._id,
        name: worldItem.name,
        type: 'buff',
        img: worldItem.img || 'icons/svg/aura.svg',
        system: sysData
      };
    }
  }

  // 4. A compendium buff by id: only a loaded document, whose system data is complete. An index
  // entry carries no system data, so it is not a buff; no index name match.
  for (const pack of globalThis.game?.packs ?? []) {
    if (pack.documentName !== 'Item' && pack.metadata?.type !== 'Item') continue;
    const doc = pack.get?.(str);
    if (doc?.type === 'buff' && doc.system) {
      const sysData = typeof doc.system.toObject === 'function' ? doc.system.toObject(false) : structuredClone(doc.system);
      return { id: doc.id || doc._id, name: doc.name, type: 'buff', img: doc.img || 'icons/svg/aura.svg', system: sysData };
    }
  }

  // An unresolved key is no buff (no runtime prose parse of the key).
  return null;
}


/**
 * Mend injury debuffs from this actor.
 * @param {string} [severity='minor'] 'minor' | 'major' | 'long_term' | 'any'
 * @returns {Promise<Array<object>>} Removed debuffs
 */
export async function mendInjury(actor, severity = 'minor') {
  const norm = String(severity || 'minor').toLowerCase().trim();
  const allDebuffs = actor.items
    ? actor.items.filter(i => i.type === 'debuff')
    : [];

  // An injury is a debuff carrying an `injury.<severity>` tag; the severity is that tag, never the name.
  const wanted = `${INJURY_NAMESPACE}.${norm.includes('long') ? 'long_term' : norm}`;
  const toRemove = [];
  for (const debuff of allDebuffs) {
    const injuryTags = tagListOf(debuff).filter(t => t.startsWith(`${INJURY_NAMESPACE}.`));
    if (injuryTags.length === 0) continue;

    if (norm === 'all' || norm === 'any') {
      toRemove.push(debuff);
    } else if (injuryTags.includes(wanted)) {
      // A grade request ('minor', 'major') leaves the Long-Term form alone; only 'long_term', 'any' and 'all' take it.
      if (wanted !== `${INJURY_NAMESPACE}.long_term` && injuryTags.includes(`${INJURY_NAMESPACE}.long_term`)) continue;
      toRemove.push(debuff);
      break;
    }
  }

  if (toRemove.length > 0) {
    const ids = toRemove.map(i => i.id || i._id).filter(Boolean);
    if (typeof actor.deleteEmbeddedDocuments === 'function' && ids.length) {
      await actor.deleteEmbeddedDocuments('Item', ids);
    } else {
      for (const item of toRemove) {
        if (typeof item.delete === 'function') {
          await item.delete();
        }
      }
    }
  }
  return toRemove;
}


/**
 * Cure debuffs matching filter: 'all', a condition (`condition.burned` or an identifier), or a damage type.
 * A changed transformation obeys its cure window (D9): open reverts it, closed asks a Rule Break and otherwise
 * stays; the stayed ones are on the result's `held`. `'all'` leaves Dying and Dead alone: Dying ends by healing or
 * death, Dead by the GM; a filter that names the condition still removes it.
 * @param {string} [filter='all']
 * @param {object} [options] Rule Break options (`interactive: false` never opens a dialog)
 * @returns {Promise<Array<object>>} Removed debuffs (`held`: the transformations a closed window kept)
 */
export async function cureDebuffs(actor, filter = 'all', options = {}) {
  const norm = String(filter || 'all').toLowerCase().trim();
  const allDebuffs = actor.items
    ? actor.items.filter(i => i.type === 'debuff')
    : [];

  const matched = [];
  for (const debuff of allDebuffs) {
    const dType = String(debuff.system?.damageType || '').toLowerCase().trim();
    if (norm === 'all') {
      if (!isDyingDebuff(debuff) && !isDeadDebuff(debuff)) matched.push(debuff);
    } else if (debuffHasConditionRef(debuff, norm) || tagListOf(debuff).includes(`damage.${norm}`) || dType.includes(norm)) {
      matched.push(debuff);
    }
  }

  const { plain, reverted, held } = await cureByWindow(actor, matched, options);
  if (plain.length > 0) {
    const ids = plain.map(i => i.id || i._id).filter(Boolean);
    if (typeof actor.deleteEmbeddedDocuments === 'function' && ids.length) {
      await actor.deleteEmbeddedDocuments('Item', ids);
    } else {
      for (const item of plain) {
        if (typeof item.delete === 'function') {
          await item.delete();
        }
      }
    }
  }
  return Object.defineProperty([...plain, ...reverted], 'held', { value: held });
}


/**
 * Apply fixed number of health bars of healing to this actor.
 * A bearer of `no-healing` is asked a Rule Break first; a refusal heals nothing and returns `blocked: true`. A heal
 * that restores a whole slot ends the bearer's `until_healed` debuffs.
 * @param {number} [bars=1]
 * @param {object} [options] Rule Break options (`interactive: false` for an automatic heal)
 * @returns {Promise<object>}
 */
export async function applyHealingBars(actor, bars = 1, options = {}) {
  const hpPerBar = getHpPerBar(actor);
  const healAmt = bars * hpPerBar;
  const currentHp = Number(actor.system?.attributes?.hp?.value ?? actor.system?.attributes?.hp?.max ?? 0);
  const maxHp = Number(actor.system?.attributes?.hp?.max) || (10 * hpPerBar);
  const gate = await confirmHealing(actor, options);
  if (!gate.proceed) return { actualHealed: 0, newHp: currentHp, maxHp, bars, hpPerBar, blocked: true, reason: gate.reason };
  const newHp = restoredValue(currentHp, healAmt, maxHp);
  const actualHealed = Math.max(0, newHp - currentHp);
  const hpPct = maxHp > 0 ? Math.min(100, Math.max(0, Math.round((newHp / maxHp) * 100))) : 100;
  await actor.update({
    'system.attributes.hp.value': newHp,
    'system.attributes.hp.pct': hpPct
  });
  await settleHealed(actor, { before: currentHp, after: newHp });
  return { actualHealed, newHp, maxHp, bars, hpPerBar, ruleBreak: gate.ruleBreak };
}


/**
 * Apply a Heal Over Time (HoT) buff to this actor.
 * @param {object} params
 * @param {string} [params.name]
 * @param {number} [params.healBars=1]
 * @param {number} [params.rounds=3]
 * @returns {Promise<Item>}
 */
export async function applyHoT(actor, { name = 'Regeneration', healBars = 1, rounds = 3 } = {}) {
  const buffData = {
    name,
    type: 'buff',
    img: 'icons/svg/aura.svg',
    system: {
      healingPerRound: `${healBars} bar${healBars > 1 ? 's' : ''}`,
      active: true,
      duration: `${rounds} Rounds`,
      durationConfig: { type: 'rounds', value: rounds, remainingRounds: rounds },
      description: `Restores ${healBars} Health Bar(s) per combat round for ${rounds} combat rounds.`
    }
  };
  const created = await actor.createEmbeddedDocuments('Item', [buffData]);
  return created[0] || null;
}


/**
 * Cleanse / remove debuffs matching a condition reference or all debuffs. A debuff matches by the condition tag
 * its identifier derives (E4.4); its name is never read.
 * @param {string} [debuffName] - `condition.<id>` or a debuff identifier to cleanse, or empty to remove all debuffs
 * A changed transformation obeys its cure window like {@link cureDebuffs}.
 * @param {object} [options] Rule Break options
 * @returns {Promise<Array<string>>} - Array of cleansed debuff names (`held`: the transformations a closed window kept)
 */
export async function cleanseDebuff(actor, debuffName = '', options = {}) {
  const ref = String(debuffName || '').trim();
  const debuffs = (actor.items || []).filter(i => i.type === 'debuff');
  const matched = debuffs.filter(d => !ref || debuffHasConditionRef(d, ref));
  const { plain, reverted, held } = await cureByWindow(actor, matched, options);
  if (plain.length > 0) {
    await actor.deleteEmbeddedDocuments('Item', plain.map(d => d.id || d._id));
  }
  return Object.defineProperty([...plain, ...reverted].map(d => d.name), 'held', { value: held });
}



/**
 * Resolve valid targets for an action, spell, skill, or attack.
 * Supports burst/area shapes (canvas tokens within radius filtered by targetFilter),
 * targeted tokens (game.user.targets), or direct options (targetActor/targets).
 * @param {COGItem} [sourceItem]
 * @param {object} [options={}]
 * @returns {Array<Token|Actor>}
 */
export function resolveActionTargets(actor, sourceItem, options = {}) {
  const sys = sourceItem?.system || {};
  const area = sys.area || {};
  const rank = Number(getSpellRank(actor, sourceItem)) || Number(sys.rank) || 1;

  const isArea = Boolean(
    options.isBurst ||
    sys.delivery === 'burst' ||
    isAreaAttack(sourceItem, options) ||
    (sys.tags && isAreaTagSet(sys.tags))
  );

  // Only a burst is measured around the caster. A blast, cone, line, wall or rectangle is placed by the user, whose
  // targets (set when the area was placed) are the ones the action hits.
  const geometry = resolveAreaGeometry(sourceItem, { rank });
  const placedArea = Boolean(geometry && geometry.shape !== 'burst' && !options.isBurst);

  let radius = Number(options.radius ?? area.radius);
  if (!Number.isFinite(radius) || radius <= 0) radius = 5;

  if (options.radius === undefined) radius = geometry?.distance > 0 ? geometry.distance : radius + resolveReachedRankBreaks(sourceItem, rank).area.radiusBonus;

  const filter = (options.targetFilter || area.targetFilter || 'enemies').toLowerCase();

  // 1. Explicit options targets
  if (Array.isArray(options.targets) && options.targets.length > 0) return options.targets;
  if (Array.isArray(options.targetTokens) && options.targetTokens.length > 0) return options.targetTokens;
  if (Array.isArray(options.targetActors) && options.targetActors.length > 0) return options.targetActors;
  if (options.targetActor) return [options.targetActor];
  if (options.targetToken) return [options.targetToken];

  const validTargets = [];

  // 2. Burst / Area canvas tokens
  // Without a caster token there is no centre for the radius, so nothing is picked from the scene
  // (it used to hit every token); the user's own targets below are used instead.
  const casterToken = (isArea && !placedArea && typeof canvas !== 'undefined' && canvas?.tokens?.placeables)
    ? (options.token ||
      canvas.tokens.placeables.find(t => t.actor?.id === actor.id) ||
      canvas.tokens.controlled?.[0])
    : null;
  if (casterToken) {

    const myX = casterToken?.center?.x ?? casterToken?.x ?? 0;
    const myY = casterToken?.center?.y ?? casterToken?.y ?? 0;
    const gridSize = canvas.grid?.size || 50;
    const gridDist = canvas.scene?.grid?.distance || 5;

    for (const tok of canvas.tokens.placeables) {
      if (!tok.actor || isMarkerActor(tok)) continue;
      if (tok.actor.id === actor.id && filter === 'enemies') continue;

      const isHostile = tok.document?.disposition === (globalThis.CONST?.TOKEN_DISPOSITIONS?.HOSTILE ?? -1) ||
                        tok.disposition === -1 ||
                        tok.actor.type === 'mob';
      const isSelf = tok.actor.id === actor.id;
      const isAlly = !isHostile && !isSelf;

      let matchesFilter;
      if (filter === 'enemies') matchesFilter = isHostile;
      else if (filter === 'allies') matchesFilter = isAlly || isSelf;
      else matchesFilter = !isSelf;

      if (!matchesFilter) continue;

      let dist;
      if (canvas.grid && typeof canvas.grid.measureDistance === 'function') {
        dist = canvas.grid.measureDistance(casterToken, tok);
      } else {
        const tokX = tok.center?.x ?? tok.x ?? 0;
        const tokY = tok.center?.y ?? tok.y ?? 0;
        dist = (Math.hypot(tokX - myX, tokY - myY) / gridSize) * gridDist;
      }
      if (dist <= radius) validTargets.push(tok);
    }
  }

  // 3. Fallback to game.user.targets
  if (validTargets.length === 0 && typeof game !== 'undefined' && game.user?.targets?.size) {
    for (const t of game.user.targets) {
      if (isMarkerActor(t)) continue; // a T-targeted light marker is not a creature
      validTargets.push(t);
    }
  }

  return validTargets;
}


/**
 * Apply a condition/debuff to this actor using the unified Tag System.
 * Resolves by condition tag (condition.*), item ID, or data object.
 * Creates an embedded debuff Item document directly onto the actor sheet.
 * @param {string|object} conditionTagOrData - Tag ID ('condition.queasy'), item ID, or debuff data
 * @param {object} [options={}] - Options (source, sourceItem, duration, durationRounds, description, img;
 *   `reveal: true` lands a secret debuff for real, `postCue: false` skips the landing card; both are the pending store's).
 *   `durationRounds` > 0 makes the condition a round-counted effect of that many combat rounds.
 * @returns {Promise<Item|null>} The created embedded debuff item
 */
export async function applyCondition(actor, conditionTagOrData, options = {}) {
  if (!conditionTagOrData) return null;

  let tagId = '';
  let rawData = null;

  if (typeof conditionTagOrData === 'object' && conditionTagOrData !== null) {
    if (conditionTagOrData.system || conditionTagOrData.type === 'debuff') {
      rawData = conditionTagOrData;
    }
    tagId = conditionTagOrData.tagId || conditionTagOrData.conditionTag || '';
    // Data being created: its stored identifier, else the one `_preCreate` will derive from its name.
    if (!tagId) tagId = conditionTagId(itemIdentifier(conditionTagOrData));
  } else if (typeof conditionTagOrData === 'string') {
    const clean = conditionTagOrData.trim();
    tagId = clean.startsWith('id.debuff.') ? conditionTagId(clean.slice('id.debuff.'.length)) : conditionRefTag(clean);
  }

  let debuffData;

  if (rawData) {
    debuffData = {
      name: rawData.name || 'Debuff',
      type: 'debuff',
      img: options.img || rawData.img || 'icons/svg/skull.svg',
      system: {
        description: options.description || rawData.system?.description || '',
        duration: options.duration || rawData.system?.duration || '1 scene',
        tags: Array.from(new Set([...(rawData.system?.tags || []), tagId].filter(Boolean))),
        ...(rawData.system ? structuredClone(rawData.system) : {})
      },
      flags: {
        [SYSTEM_ID]: {
          inflictedBy: options.source || options.sourceItem?.name || null,
          sourceItemId: options.sourceItem?.id || options.sourceItemId || null,
          conditionTag: tagId || null
        }
      }
    };
    carrySourceStamp(debuffData, rawData);
  } else {
    debuffData = conditionItemData(conditionTagOrData, options);
  }

  // When it landed, on the clock a ledger slot's `timestamp` uses: Clean Up compares them for `next_action` debuffs.
  debuffData.flags = { ...debuffData.flags, [SYSTEM_ID]: { ...debuffData.flags?.[SYSTEM_ID], landedAt: Date.now() } };

  const durationRounds = Math.floor(Number(options.durationRounds) || 0);
  if (durationRounds > 0) {
    debuffData.system.durationConfig = { type: 'rounds', value: durationRounds, remainingRounds: durationRounds };
  }

  // An `effectImmunity` row that matches this Debuff stops it landing. Never a hard block (Directive 2): the GM or player may force it.
  const immunity = effectImmunityFor(actor, incomingEffectTags({ debuff: debuffData }), { other: options.sourceActor ?? null });
  if (immunity.immune) {
    const sources = immunity.sources.join(', ');
    const data = { actor: actor.name, effect: debuffData.name, sources };
    const verdict = await confirmRuleBreak({
      title: immuneText('Title', data, 'Immune'),
      message: immuneText('Message', data, `${data.actor} is immune to ${data.effect} (${sources}). Apply anyway as a Rule Break?`),
      options
    });
    if (!verdict.confirmed) return null;
    debuffData = withRuleBreak(debuffData);
  }

  // What a second application does is the debuff's own `repeat` (refresh, stack, or promote), judged by `repeatVerdict`.
  const verdict = repeatVerdict(actor.items, debuffData, tagId);
  if (verdict.action === 'promote') {
    await verdict.existing.delete();
    return applyCondition(actor, verdict.into, { ...options, ...(immunity.immune ? { ruleBreak: true } : {}) });
  }
  if (verdict.action === 'ask') {
    const ruling = await askRepeatRuling(actor, { existing: verdict.existing, incoming: debuffData, options });
    if (ruling === null) return null;
    if (ruling === REPEAT_RULINGS.NONE) return verdict.existing;
  }
  const existing = verdict.action === 'refresh' ? verdict.existing : null;

  if (existing) {
    if (typeof existing.update === 'function') {
      await existing.update({
        'system.duration': debuffData.system.duration,
        ...(durationRounds > 0 ? { 'system.durationConfig': debuffData.system.durationConfig } : {}),
        'system.active': true,
        [`flags.${SYSTEM_ID}.landedAt`]: debuffData.flags[SYSTEM_ID].landedAt,
        'system.description': debuffData.system.description || existing.system.description || '',
        ...(immunity.immune ? ruleBreakUpdate() : {})
      });
    } else {
      existing.system = existing.system || {};
      existing.system.duration = debuffData.system.duration;
      if (durationRounds > 0) existing.system.durationConfig = debuffData.system.durationConfig;
      existing.system.active = true;
      if (debuffData.system.description) existing.system.description = debuffData.system.description;
    }
    if (typeof actor.prepareData === 'function') {
      actor.prepareData();
    }
    return existing;
  }

  // A secret debuff waits GM-side (the pending store) until the GM reveals it or fires the change (D10). Nothing is
  // created on the carrier; revealing re-enters here with `reveal: true`.
  if (debuffData.system?.secret === true && !options.reveal) {
    await holdSecret(actor, debuffData, { source: options.source || options.sourceItem?.name || '' });
    return null;
  }

  // An affliction lands pending: when and on which floor, for its cure window (D8)
  if (isAffliction(debuffData)) stampLanding(debuffData);

  const results = await actor.createEmbeddedDocuments('Item', landItems([debuffData]));
  const created = results?.[0] || null;

  if (typeof actor.prepareData === 'function') {
    actor.prepareData();
  }

  // The `apply` cue's card. A secret affliction never reaches this create: the GM-side hold lands it and posts on reveal.
  if (created && isAffliction(created) && options.postCue !== false) await postCue(actor, created, 'apply');

  // The debuffs that land with this one: one level deep (a companion's own list is not followed), never this debuff itself.
  if (created && !options.companion) {
    for (const id of toStringList(debuffData.system?.alsoApplies)) {
      if (conditionRefTag(id) === tagId) continue;
      await applyCondition(actor, id, { ...options, postCue: false, companion: true });
    }
  }

  // A forfeit debuff (Shocked) landing on a combatant with an Action left takes it now.
  if (created && !options.companion) await settleForfeitsOf(actor);

  return created;
}


/**
 * Alias applyDebuff to applyCondition for unified developer ergonomics.
 */
export async function applyDebuff(actor, debuff, options = {}) {
  return actor.applyCondition(debuff, options);
}
