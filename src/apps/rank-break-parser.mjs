/**
 * Authoring-time rank-break text parser (moved out of the runtime `src/data/rank-dice.mjs`). It turns a
 * skill or spell's prose upgrade text ("Rank 5: +1d6 base damage") into structured rank-break fields, for the item
 * sheet's explicit "Parse upgrade text into rank breaks" action and the pack build pass. The author reviews the result;
 * the engine never reads the prose. Re-exported from `rapid-text-parser.mjs` (the authoring parser).
 */
import { COG_TAGS } from '../data/tag-catalog.mjs';
import { catalogEntries } from '../content/catalog-lookup.mjs';

/**
 * The debuffs the parser looks for when the caller gives none, each with the reference a match stores: a catalog debuff's
 * identifier, or a `condition.*` tag that no catalog debuff of that name answers for. A name the tag catalog and a catalog
 * debuff share is listed once, with the debuff's identifier.
 * @returns {{ name: string, identifier: string }[]}
 */
function catalogDebuffRefs() {
  const debuffs = [];
  for (const entry of catalogEntries('debuffs')) {
    if (typeof entry?.name === 'string' && entry.name.trim()) debuffs.push({ name: entry.name.trim(), identifier: String(entry.system?.identifier ?? '').trim() });
  }
  const byName = new Map(debuffs.map(d => [d.name.toLowerCase(), d]));
  const refs = COG_TAGS.filter(tag => tag.namespace === 'condition' && tag.label)
    .map(tag => byName.get(tag.label.toLowerCase()) ?? { name: tag.label, identifier: tag.id });
  const seen = new Set();
  return [...refs, ...debuffs].filter(ref => !seen.has(ref.name.toLowerCase()) && seen.add(ref.name.toLowerCase()));
}

/** A known debuff as `{ name, ref }`: a string is a name (a match stores it as given); an object's match stores its identifier. */
function knownDebuff(entry) {
  if (typeof entry === 'string') return { name: entry, ref: entry };
  const name = typeof entry?.name === 'string' ? entry.name : '';
  const identifier = typeof entry?.identifier === 'string' ? entry.identifier.trim() : '';
  return { name, ref: identifier || name };
}

/**
 * Extract rank upgrade strings (Rank 5, Rank 10, Rank 15) from an upgrades object or string.
 * @param {object|string} upgrades
 * @returns {{ rank5: string, rank10: string, rank15: string }}
 */
function parseUpgrades(upgrades) {
  if (!upgrades) return { rank5: '', rank10: '', rank15: '' };
  if (typeof upgrades === 'object') {
    return {
      rank5: String(upgrades.rank5 || ''),
      rank10: String(upgrades.rank10 || ''),
      rank15: String(upgrades.rank15 || '')
    };
  }
  if (typeof upgrades === 'string') {
    const r5 = upgrades.match(/Rank\s*5\s*:\s*([^\n\r]+)/i)?.[1]?.trim() || '';
    const r10 = upgrades.match(/Rank\s*10\s*:\s*([^\n\r]+)/i)?.[1]?.trim() || '';
    const r15 = upgrades.match(/Rank\s*15\s*:\s*([^\n\r]+)/i)?.[1]?.trim() || '';
    return { rank5: r5, rank10: r10, rank15: r15 };
  }
  return { rank5: '', rank10: '', rank15: '' };
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Convert an unstructured milestone upgrade text into a structured rankBreak object.
 * Extracts damageDice, baseDiceCountMod, rankDamageDice, debuff, buffsResistances, and notes.
 *
 * @param {string} text
 * @param {(string|{ name: string, identifier?: string })[]} [knownDebuffs=[]] names, or debuffs whose match stores the
 *   identifier; when empty, {@link catalogDebuffRefs}
 * @returns {{ damageDice: string, baseDiceCountMod: string, rankDamageDice: number, buffsResistances: string, debuff: string, notes: string }}
 */
export function parseUpgradeTextToRankBreak(text, knownDebuffs = []) {
  const result = {
    damageDice: '',
    baseDiceCountMod: '',
    rankDamageDice: 0,
    buffsResistances: '',
    debuff: '',
    notes: ''
  };
  if (!text || typeof text !== 'string') return result;
  const t = text.trim();
  if (!t) return result;
  result.notes = t;

  // 1. Additional Damage Dice (e.g. +2d2 base damage, +1d6, 1d12 base damage)
  const dmg = t.match(/\+(\d+d\d+)(?:\s+(?:base\s+)?damage)?/i) || t.match(/(\d+d\d+)\s+(?:base\s+)?damage/i);
  if (dmg) {
    result.damageDice = dmg[1];
  }

  // 2. Base Dice Count Mod (e.g. base dice count +1, etc.)
  const countMod = t.match(/base\s+dice\s+count\s*([+-]\d+)/i);
  if (countMod) {
    result.baseDiceCountMod = countMod[1];
  }

  // 3. Rank Damage Dice (e.g. 1 Rank damage die, add 1 Rank damage die)
  const rDie = t.match(/(\d+)\s+Rank\s+damage\s+di[ec]/i) || t.match(/add\s+(?:one|1)\s+.*Rank\s+damage\s+di[ec]/i);
  if (rDie && !t.includes("Misc Junk")) {
    result.rankDamageDice = rDie[1] ? parseInt(rDie[1], 10) : 1;
  }

  // 4. Debuff match against known canonical debuffs (data-driven). A match stores the debuff's identifier when the list gives one.
  const debuffList = Array.isArray(knownDebuffs) && knownDebuffs.length > 0 ? knownDebuffs : catalogDebuffRefs();
  for (const known of debuffList) {
    const { name: dName, ref } = knownDebuff(known);
    if (!dName.trim()) continue;
    // Debuff names come from world items, so they may hold regex syntax ("[claude] Dazed", "Hex (Minor)").
    const name = escapeRegExp(dName);
    const regex = new RegExp(`(?<![\\w])${name}(?![\\w])(?:\\s+Debuff)?`, 'i');
    if (regex.test(t)) {
      const isHealing = new RegExp(`(?:heal|mend|remove|cure|end|avoid)\\w*\\s+(?:an?\\s+)?(?:Long-Term\\s+)?(?:Minor\\s+Injury|Major\\s+Injury|${name})`, 'i').test(t);
      const isHeldItems = dName.toLowerCase() === 'held' && /held\s+items?/i.test(t);
      if (!isHealing && !isHeldItems) {
        result.debuff = ref;
        break;
      }
    }
  }

  // 5. Buffs / Resistances
  const buff = t.match(/([A-Za-z\s]+?\s+Resistance|\+\d+\s+DR|\+\d+\s+Evade\b|\+\d+\s+[A-Z]{3}\b|\bDR\s*\+\s*\d+)/i);
  if (buff) {
    result.buffsResistances = buff[1].trim();
  }

  // 6. Damage Type change (e.g. becomes Force and Fire damage)
  const dtMatch = t.match(/(?:becomes|deal[s]?)\s+([A-Za-z\s&]+?)\s+damage/i);
  if (dtMatch) {
    result.damageType = dtMatch[1].replace(/\s+and\s+/gi, ' & ').trim();
  }

  return result;
}

const PARSED_BREAK_FIELDS = ['damageDice', 'damageType', 'baseDiceCountMod', 'rankDamageDice', 'buffsResistances', 'debuff', 'notes'];

/**
 * The structured rank-break fields the upgrade text would fill, for the item sheet's explicit
 * "Parse upgrade text into rank breaks" action. Only fields that are empty in `existingRankBreaks`
 * and that the text actually yields are returned, keyed by their form input name, so a value the
 * author already entered is never overwritten.
 * @param {object} [existingRankBreaks]
 * @param {object|string} [rawUpgrades]
 * @param {string[]} [knownDebuffs]
 * @returns {Record<string, string|number>} e.g. `{ 'system.rankBreaks.rank5.damageDice': '1d6' }`
 */
export function rankBreakFillPatch(existingRankBreaks = {}, rawUpgrades = {}, knownDebuffs = []) {
  const isEmpty = (v) => v === undefined || v === null || v === '' || v === 0;
  const patch = {};
  const upgrades = parseUpgrades(rawUpgrades);
  for (const rKey of ['rank5', 'rank10', 'rank15', 'rank20']) {
    const existing = existingRankBreaks?.[rKey] || {};
    const parsed = parseUpgradeTextToRankBreak(upgrades[rKey] || '', knownDebuffs);
    for (const field of PARSED_BREAK_FIELDS) {
      if (!isEmpty(parsed[field]) && isEmpty(existing[field])) patch[`system.rankBreaks.${rKey}.${field}`] = parsed[field];
    }
  }
  return patch;
}

/**
 * Build-time pass: run the upgrade-text parser once over a bundled spell or skill `system` so no
 * shipped item depends on a render-time fallback. Values already set are kept.
 * @param {object} system
 * @param {string[]} [knownDebuffs]
 * @returns {object} a copy of `system` with `rankBreaks` filled in
 */
export function withParsedRankBreaks(system, knownDebuffs = []) {
  return { ...system, rankBreaks: mergeParsedRankBreaks(system?.rankBreaks, system?.upgrades, knownDebuffs) };
}

/**
 * Rank breaks with the structured fields the upgrade text yields, where the authored break leaves them empty
 * (the pack build pass; nothing calls this at runtime).
 * @param {object} [existingRankBreaks={}]
 * @param {object|string} [rawUpgrades={}]
 * @param {string[]} [knownDebuffs=[]]
 * @returns {object} Fully populated rankBreaks object with rank5, rank10, rank15, rank20
 */
function mergeParsedRankBreaks(existingRankBreaks = {}, rawUpgrades = {}, knownDebuffs = []) {
  const breaks = {};
  const upgrades = parseUpgrades(rawUpgrades);

  for (const rKey of ['rank5', 'rank10', 'rank15', 'rank20']) {
    const existing = existingRankBreaks?.[rKey] || {};
    const parsed = parseUpgradeTextToRankBreak(upgrades[rKey] || '', knownDebuffs);
    const defaultRank = rKey === 'rank5' ? 5 : (rKey === 'rank10' ? 10 : (rKey === 'rank15' ? 15 : 20));

    breaks[rKey] = {
      ...existing,
      rank: existing.rank !== undefined && Number(existing.rank) > 0 ? Number(existing.rank) : defaultRank,
      critMultiplier: existing.critMultiplier !== undefined && Number(existing.critMultiplier) >= 1
        ? Number(existing.critMultiplier)
        : (rKey === 'rank15' && rawUpgrades.critMultiplierR15
          ? Number(rawUpgrades.critMultiplierR15)
          : (rKey === 'rank5' && rawUpgrades.critMultiplierR5 ? Number(rawUpgrades.critMultiplierR5) : 1)),
      damageDice: existing.damageDice !== undefined && existing.damageDice !== '' ? String(existing.damageDice).trim() : parsed.damageDice,
      damageType: existing.damageType !== undefined && existing.damageType !== '' ? String(existing.damageType).trim() : (parsed.damageType || ''),
      baseDiceCountMod: existing.baseDiceCountMod !== undefined && existing.baseDiceCountMod !== '' ? String(existing.baseDiceCountMod).trim() : parsed.baseDiceCountMod,
      rankDamageDice: existing.rankDamageDice !== undefined && existing.rankDamageDice !== null && existing.rankDamageDice !== '' && Number.isFinite(Number(existing.rankDamageDice)) ? Number(existing.rankDamageDice) : parsed.rankDamageDice,
      buffsResistances: existing.buffsResistances !== undefined && existing.buffsResistances !== '' ? String(existing.buffsResistances).trim() : parsed.buffsResistances,
      debuff: existing.debuff !== undefined && existing.debuff !== '' ? String(existing.debuff).trim() : parsed.debuff,
      notes: existing.notes !== undefined && existing.notes !== '' ? String(existing.notes).trim() : (parsed.notes || ''),
      contest: {
        dcBonus: existing.contest?.dcBonus !== undefined ? Number(existing.contest.dcBonus) || 0 : 0,
        onFailDebuff: existing.contest?.onFailDebuff !== undefined ? String(existing.contest.onFailDebuff).trim() : ''
      }
    };
  }

  return breaks;
}
