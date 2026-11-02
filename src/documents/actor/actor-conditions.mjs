import { findConditionEntry } from '../../content/catalog-lookup.mjs';
import { getItemAllTags, collectActorTags } from '../../data/tags.mjs';
import { getHpPerBar } from '../../apps/combat-metrics.mjs';
import { isAreaAttack } from '../../utils/area-attack.mjs';
import { isAreaTagSet, INJURY_NAMESPACE } from '../../utils/tag-mechanics.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { conditionTagId, itemIdentifier } from '../../utils/identifier.mjs';
import { resolveReachedRankBreaks } from '../../utils/rank-breaks.mjs';
import { resolveAreaGeometry } from '../../utils/area-geometry.mjs';
import { collectOnHitEffects } from '../../utils/on-hit.mjs';
import { isBuffSuppressed } from '../../utils/dispel.mjs';
import { isMarkerActor } from '../../utils/marker.mjs';
import { conditionRefTag, conditionItemData } from './condition-data.mjs';

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

export const actorConditionsMixin = {

  /**
   * Get all archetype tags associated with this actor (e.g. Set {'archetype.mage'}): the archetype tags of the embedded
   * class and race items. The `details.class` text is never parsed.
   * @returns {Set<string>}
   */
  getArchetypeTags() {
    const archetypes = new Set();
    const itemsList = Array.from(this.items ?? []);

    for (const item of itemsList) {
      if (item.type === 'class' || item.type === 'race') {
        const itemTags = item.allTags || getItemAllTags(item);
        for (const t of itemTags) {
          if (t.startsWith('archetype.')) archetypes.add(t);
        }
      }
    }

    return archetypes;
  },


  /**
   * Get all identity and classification tags for this actor.
   * Includes archetype tags, race, class, deity, and sponsor tags.
   * @returns {Set<string>}
   */
  getIdentityTags() {
    return collectActorTags(this, { identityOnly: true });
  },


  /**
   * Resolve and return details for the up to 3 active external buffs
   * @returns {Array<object>}
   */
  getActiveBuffs() {
    const rawBuffs = this.system?.attributes?.externalBuffs;
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
        const buffObj = this.resolveBuff(key);
        if (buffObj) resolved.push(buffObj);
      }
    }

    // Also include any embedded buff items explicitly flagged as active
    if (this.items) {
      const itemsList = Array.from(this.items ?? []);
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
        } else if (item.type === 'gear' && item.system?.equipped && Array.isArray(item.system?.persistentBuffs)) {
          for (const bKey of item.system.persistentBuffs) {
            if (!bKey) continue;
            const buffObj = this.resolveBuff(bKey);
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
    return resolved.filter(buff => !isBuffSuppressed(this, buff));
  },


  /**
   * Resolve a buff by embedded/world/compendium id or by `system.identifier` (never by name).
   * @param {string} rawVal
   * @returns {object|null}
   */
  resolveBuff(rawVal) {
    if (!rawVal) return null;
    const str = String(rawVal).trim();
    if (!str) return null;

    // 1. Check embedded item on actor
    const ownedMatch = (i) => i.id === str || i._id === str || i.system?.identifier === str;
    const owned = this.items?.get(str) || this.items?.find(ownedMatch);
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
  },


  /**
   * Apply the stackable Fatigued debuff to this actor: -1 to all Checks, Move halved,
   * lasts until the end of a long rest.
   * @returns {Promise<Item>}
   */
  async applyFatiguedDebuff() {
    const debuffData = {
      name: 'Fatigued',
      type: 'debuff',
      img: 'icons/svg/sleep.svg',
      system: {
        identifier: 'fatigued',
        severity: 'Minor',
        damageType: '',
        damageModifiers: [],
        duration: 'Until the end of a long rest.',
        durationConfig: { type: 'long_rest', value: 0 },
        description: 'Every Check takes -1 and Move is cut in half. Stacks. Wears off after a long rest.'
      }
    };
    const created = await this.createEmbeddedDocuments('Item', [debuffData]);
    return created[0] || null;
  },



  /**
   * Mend injury debuffs from this actor.
   * @param {string} [severity='minor'] 'minor' | 'major' | 'long_term' | 'any'
   * @returns {Promise<Array<object>>} Removed debuffs
   */
  async mendInjury(severity = 'minor') {
    const norm = String(severity || 'minor').toLowerCase().trim();
    const allDebuffs = this.items
      ? this.items.filter(i => i.type === 'debuff')
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
        toRemove.push(debuff);
        break;
      }
    }

    if (toRemove.length > 0) {
      const ids = toRemove.map(i => i.id || i._id).filter(Boolean);
      if (typeof this.deleteEmbeddedDocuments === 'function' && ids.length) {
        await this.deleteEmbeddedDocuments('Item', ids);
      } else {
        for (const item of toRemove) {
          if (typeof item.delete === 'function') {
            await item.delete();
          }
        }
      }
    }
    return toRemove;
  },


  /**
   * Cure debuffs matching filter: 'all', a condition (`condition.burned` or an identifier), or a damage type.
   * @param {string} [filter='all']
   * @returns {Promise<Array<object>>} Removed debuffs
   */
  async cureDebuffs(filter = 'all') {
    const norm = String(filter || 'all').toLowerCase().trim();
    const allDebuffs = this.items
      ? this.items.filter(i => i.type === 'debuff')
      : [];

    const toRemove = [];
    for (const debuff of allDebuffs) {
      const dType = String(debuff.system?.damageType || '').toLowerCase().trim();
      if (norm === 'all') {
        toRemove.push(debuff);
      } else if (debuffHasConditionRef(debuff, norm) || tagListOf(debuff).includes(`damage.${norm}`) || dType.includes(norm)) {
        toRemove.push(debuff);
      }
    }

    if (toRemove.length > 0) {
      const ids = toRemove.map(i => i.id || i._id).filter(Boolean);
      if (typeof this.deleteEmbeddedDocuments === 'function' && ids.length) {
        await this.deleteEmbeddedDocuments('Item', ids);
      } else {
        for (const item of toRemove) {
          if (typeof item.delete === 'function') {
            await item.delete();
          }
        }
      }
    }
    return toRemove;
  },


  /**
   * Apply fixed number of health bars of healing to this actor.
   * @param {number} [bars=1]
   * @returns {Promise<object>}
   */
  async applyHealingBars(bars = 1) {
    const hpPerBar = getHpPerBar(this);
    const healAmt = bars * hpPerBar;
    const currentHp = Number(this.system?.attributes?.hp?.value ?? this.system?.attributes?.hp?.max ?? 0);
    const maxHp = Number(this.system?.attributes?.hp?.max) || (10 * hpPerBar);
    const newHp = Math.min(maxHp, currentHp + healAmt);
    const actualHealed = Math.max(0, newHp - currentHp);
    const hpPct = maxHp > 0 ? Math.round((newHp / maxHp) * 100) : 100;
    await this.update({
      'system.attributes.hp.value': newHp,
      'system.attributes.hp.pct': hpPct
    });
    return { actualHealed, newHp, maxHp, bars, hpPerBar };
  },


  /**
   * Apply a Heal Over Time (HoT) buff to this actor.
   * @param {object} params
   * @param {string} [params.name]
   * @param {number} [params.healBars=1]
   * @param {number} [params.rounds=3]
   * @returns {Promise<Item>}
   */
  async applyHoT({ name = 'Regeneration', healBars = 1, rounds = 3 } = {}) {
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
    const created = await this.createEmbeddedDocuments('Item', [buffData]);
    return created[0] || null;
  },


  /**
   * Cleanse / remove debuffs matching a condition reference or all debuffs. A debuff matches by the condition tag
   * its identifier derives (E4.4); its name is never read.
   * @param {string} [debuffName] - `condition.<id>` or a debuff identifier to cleanse, or empty to remove all debuffs
   * @returns {Promise<Array<string>>} - Array of cleansed debuff names
   */
  async cleanseDebuff(debuffName = '') {
    const cleansed = [];
    const ref = String(debuffName || '').trim();
    const debuffs = (this.items || []).filter(i => i.type === 'debuff');
    const toDelete = [];
    for (const d of debuffs) {
      if (!ref || debuffHasConditionRef(d, ref)) {
        toDelete.push(d.id || d._id);
        cleansed.push(d.name);
      }
    }
    if (toDelete.length > 0) {
      await this.deleteEmbeddedDocuments('Item', toDelete);
    }
    return cleansed;
  },


  /**
   * Extract all condition tags inflicted by an item (spell, skill, attack, gear).
   * Aggregates explicit condition.* / id.debuff.* tags, onHit.debuffId, techniqueConfig.debuffId,
   * area and contest debuff references, and the debuffs and condition.* tags of reached rank breaks.
   * A rank break debuff with `debuffOn: 'crit'` is included only when `options.isCrit` is true.
   * @param {COGItem} item
   * @param {{isCrit?: boolean}} [options]
   * @returns {Array<string>} List of unique condition tag IDs (e.g. ['condition.queasy', ...])
   */
  getItemInflictedConditions(item, options = {}) {
    if (!item) return [];
    const sys = item.system || {};
    const rank = Number(this.getSpellRank ? this.getSpellRank(item) : (sys.modifiedRank ?? sys.rank)) || Number(sys.rank) || 1;
    const conditionTags = [];

    const addCondition = (val) => {
      if (!val) return;
      if (Array.isArray(val)) {
        for (const v of val) addCondition(v);
        return;
      }
      if (typeof val !== 'string') return;
      const trimmed = val.trim();
      if (!trimmed) return;

      if (trimmed.includes(',')) {
        for (const part of trimmed.split(',')) addCondition(part);
        return;
      }

      let tag = trimmed;
      if (!tag.startsWith('condition.') && !tag.startsWith('id.debuff.')) tag = conditionTagId(tag);

      if (tag && !conditionTags.includes(tag)) {
        conditionTags.push(tag);
      }
    };

    // 1. Explicit condition tags or tags list on item
    if (Array.isArray(sys.tags)) {
      for (const t of sys.tags) {
        if (typeof t === 'string' && (t.startsWith('condition.') || t.startsWith('id.debuff.'))) {
          addCondition(t);
        }
      }
    }

    // 2. Direct on-hit condition / debuff
    for (const d of collectOnHitEffects({ sources: [{ item, rank }] }).debuffs) addCondition(d);

    // 3. Technique config condition / debuff
    if (sys.techniqueConfig?.debuffId) addCondition(sys.techniqueConfig.debuffId);

    // 4. Area condition tags / inflicted debuffs
    if (sys.area?.inflictedDebuffs) addCondition(sys.area.inflictedDebuffs);

    // 5. Contest on-fail condition / debuff
    if (sys.contest?.onFailDebuff) addCondition(sys.contest.onFailDebuff);

    // 6. Rank breaks conditions
    for (const { tier } of resolveReachedRankBreaks(item, rank).reachedTiers) {
      if (Array.isArray(tier.tags)) {
        for (const t of tier.tags) {
          if (typeof t === 'string' && t.startsWith('condition.')) addCondition(t);
        }
      }
      if (tier.debuff && (tier.debuffOn !== 'crit' || options?.isCrit === true)) addCondition(tier.debuff);
      if (tier.contest?.onFailDebuff) addCondition(tier.contest.onFailDebuff);
    }

    return conditionTags;
  },


  /**
   * Resolve valid targets for an action, spell, skill, or attack.
   * Supports burst/area shapes (canvas tokens within radius filtered by targetFilter),
   * targeted tokens (game.user.targets), or direct options (targetActor/targets).
   * @param {COGItem} [sourceItem]
   * @param {object} [options={}]
   * @returns {Array<Token|Actor>}
   */
  resolveActionTargets(sourceItem, options = {}) {
    const sys = sourceItem?.system || {};
    const area = sys.area || {};
    const rank = Number(this.getSpellRank ? this.getSpellRank(sourceItem) : (sys.modifiedRank ?? sys.rank)) || Number(sys.rank) || 1;

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
        canvas.tokens.placeables.find(t => t.actor?.id === this.id) ||
        canvas.tokens.controlled?.[0])
      : null;
    if (casterToken) {

      const myX = casterToken?.center?.x ?? casterToken?.x ?? 0;
      const myY = casterToken?.center?.y ?? casterToken?.y ?? 0;
      const gridSize = canvas.grid?.size || 50;
      const gridDist = canvas.scene?.grid?.distance || 5;

      for (const tok of canvas.tokens.placeables) {
        if (!tok.actor || isMarkerActor(tok)) continue;
        if (tok.actor.id === this.id && filter === 'enemies') continue;

        const isHostile = tok.document?.disposition === (globalThis.CONST?.TOKEN_DISPOSITIONS?.HOSTILE ?? -1) ||
                          tok.disposition === -1 ||
                          tok.actor.type === 'mob';
        const isSelf = tok.actor.id === this.id;
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
  },


  /**
   * Apply a condition/debuff to this actor using the unified Tag System.
   * Resolves by condition tag (condition.*), item ID, or data object.
   * Creates an embedded debuff Item document directly onto the actor sheet.
   * @param {string|object} conditionTagOrData - Tag ID ('condition.queasy'), item ID, or debuff data
   * @param {object} [options={}] - Options (source, sourceItem, duration, durationRounds, description, img).
   *   `durationRounds` > 0 makes the condition a round-counted effect of that many combat rounds.
   * @returns {Promise<Item|null>} The created embedded debuff item
   */
  async applyCondition(conditionTagOrData, options = {}) {
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
          active: true,
          tags: Array.from(new Set([...(rawData.system?.tags || []), tagId].filter(Boolean))),
          ...(rawData.system ? structuredClone(rawData.system) : {})
        },
        flags: {
          [SYSTEM_ID]: {
            source: options.source || options.sourceItem?.name || null,
            sourceItemId: options.sourceItem?.id || options.sourceItemId || null,
            conditionTag: tagId || null
          }
        }
      };
    } else {
      debuffData = conditionItemData(conditionTagOrData, options);
    }

    const durationRounds = Math.floor(Number(options.durationRounds) || 0);
    if (durationRounds > 0) {
      debuffData.system.durationConfig = { type: 'rounds', value: durationRounds, remainingRounds: durationRounds };
    }

    // Check if actor already has a debuff carrying this condition tag (its identifier's, never its name)
    const itemsList = Array.from(this.items ?? []);
    const existing = itemsList.find(i => {
      if (i.type !== 'debuff') return false;
      return Boolean(tagId) && tagListOf(i).includes(tagId);
    });

    if (existing) {
      if (typeof existing.update === 'function') {
        await existing.update({
          'system.duration': debuffData.system.duration,
          ...(durationRounds > 0 ? { 'system.durationConfig': debuffData.system.durationConfig } : {}),
          'system.active': true,
          'system.description': debuffData.system.description || existing.system.description || ''
        });
      } else {
        existing.system = existing.system || {};
        existing.system.duration = debuffData.system.duration;
        if (durationRounds > 0) existing.system.durationConfig = debuffData.system.durationConfig;
        existing.system.active = true;
        if (debuffData.system.description) existing.system.description = debuffData.system.description;
      }
      if (typeof this.prepareData === 'function') {
        this.prepareData();
      }
      return existing;
    }

    const results = await this.createEmbeddedDocuments('Item', [debuffData]);
    const created = results?.[0] || null;

    if (typeof this.prepareData === 'function') {
      this.prepareData();
    }

    return created;
  },


  /**
   * Alias applyDebuff to applyCondition for unified developer ergonomics.
   */
  async applyDebuff(debuff, options = {}) {
    return this.applyCondition(debuff, options);
  },


  /**
   * Aggregate active Heal-Over-Time (HoT) effects from active buffs.
   * @returns {Array<{ name: string, healingPerRound: string|number, duration: string }>}
   */
  getHealingOverTime() {
    const activeBuffs = this.getActiveBuffs();
    const hots = [];
    for (const buff of activeBuffs) {
      if (!buff) continue;
      const bSys = buff.system || buff;
      if (bSys.healingPerRound) {
        hots.push({
          name: buff.name,
          healingPerRound: bSys.healingPerRound,
          duration: bSys.duration || ''
        });
      }
    }
    return hots;
  },


  /**
   * Aggregate active Damage-Over-Time (DoT) effects from active debuffs.
   * @returns {Array<{ name: string, damagePerRound: string|number, damageType: string, duration: string }>}
   */
  getDamageOverTime() {
    const debuffs = this.items
      ? this.items.filter(i => i.type === 'debuff')
      : [];
    const dots = [];
    for (const debuff of debuffs) {
      if (!debuff) continue;
      const dSys = debuff.system || {};
      if (dSys.damagePerRound) {
        dots.push({
          name: debuff.name,
          damagePerRound: dSys.damagePerRound,
          damageType: dSys.damageType || '',
          duration: dSys.duration || ''
        });
      }
    }
    return dots;
  }
};
