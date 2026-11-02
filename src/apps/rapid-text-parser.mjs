/**
 * rapid-text-parser.mjs
 * Intelligent natural language & shorthand parser for rapid in-person roll capture.
 * Parses freeform table notes, player calls, and voice-to-text transcripts into
 * structured Sprinter RPG session ledger events.
 */

import { COG_ROLL_OUTCOMES, evaluateRollOutcome } from './session-manager.mjs';
import { catalogEntries } from '../content/catalog-lookup.mjs';

// Rank-break upgrade text: authoring-time, in its own module so the pack build can load it without the
// session engine.
export { parseUpgrades, parseUpgradeTextToRankBreak, rankBreakFillPatch, withParsedRankBreaks } from './rank-break-parser.mjs';

/**
 * Normalizes text for comparison by removing whitespace and non-alphanumeric chars.
 */
export function normalizeKey(str) {
  const s = String(str || '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" || ch === '\u2018' || ch === '\u2019') continue;
    const code = ch.charCodeAt(0);
    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      out += ch.toLowerCase();
    }
  }
  return out;
}

/**
 * Authoring-time parser: turns Base Damage text ("1d8 + Str Piercing", "Base Damage: 2d6 Fire") into the structured
 * skill field `{ dice, stat, damageType }`. An object passes through unchanged. Runtime never reads the text form.
 */
export function structureBaseDamage(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { dice: String(raw.dice ?? ''), stat: String(raw.stat ?? ''), damageType: String(raw.damageType ?? '') };
  }
  const text = String(raw ?? '');
  const m = text.match(/(\d+d\d+)(?:\s*\+\s*([a-zA-Z]+))?\s*([a-zA-Z\s]+)?/i);
  if (!m) return { dice: '', stat: '', damageType: '' };
  const stat = (m[2] || '').toLowerCase();
  const typeWords = (m[3] || '').trim().split(/[.,\n]/)[0].trim();
  return {
    dice: m[1].toLowerCase(),
    stat: ['str', 'dex', 'con', 'int', 'cha'].includes(stat) ? stat : '',
    damageType: /base|damage|upgrade|per|ft/i.test(typeWords) ? '' : typeWords
  };
}

/** Replacement that restores `word` with the first letter cased as in the matched text ("first" stays "first", "First" stays "First"). */
const keepCase = (word) => (match) => {
  const upper = match[0] !== match[0].toLowerCase();
  return (upper ? word[0].toUpperCase() : word[0].toLowerCase()) + word.slice(1);
};

/**
 * Clean OCR spacing artifacts from text lines.
 */
export function cleanOCRText(t) {
  return String(t || '')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\+\s+(\d+)/g, '+$1')
    .replace(/-\s+(\d+)/g, '-$1')
    .replace(/Sk\s+ills/gi, keepCase('Skills'))
    .replace(/Sk\s+ill/gi, keepCase('Skill'))
    .replace(/Spe\s+lls/gi, keepCase('Spells'))
    .replace(/Spe\s+ll/gi, keepCase('Spell'))
    .replace(/Ear\s*th/gi, keepCase('Earth'))
    .replace(/Rag\s*e/gi, keepCase('Rage'))
    .replace(/Arc\s*anist/gi, keepCase('Arcanist'))
    .replace(/Alchem\s*y/gi, keepCase('Alchemy'))
    .replace(/Smithin\s*g/gi, keepCase('Smithing'))
    .replace(/Ta\s*ttoo/gi, keepCase('Tattoo'))
    .replace(/cr\s*afting/gi, keepCase('crafting'))
    .replace(/craft\s*ing/gi, keepCase('crafting'))
    .replace(/c\s*hoice/gi, keepCase('choice'))
    .replace(/differ\s*ent/gi, keepCase('different'))
    .replace(/We\s*apon/gi, keepCase('Weapon'))
    .replace(/we\s*apon/gi, keepCase('weapon'))
    .replace(/Edg\s*ed/gi, keepCase('Edged'))
    .replace(/Cont\s*rol/gi, keepCase('Control'))
    .replace(/Cat\s*cher/gi, keepCase('Catcher'))
    .replace(/Acut\s*e/gi, keepCase('Acute'))
    .replace(/Shadow\s*s/gi, keepCase('Shadows'))
    .replace(/Fir\s*st/gi, keepCase('First'))
    .replace(/bre\s*astplate/gi, keepCase('breastplate'))
    .replace(/Salv\s*age/gi, keepCase('Salvage'))
    .replace(/Intimida\s*te/gi, keepCase('Intimidate'))
    .replace(/Att\s*ack/gi, keepCase('Attack'))
    .replace(/Dodg\s*e/gi, keepCase('Dodge'))
    .replace(/Bloc\s*k/gi, keepCase('Block'))
    .replace(/gr\s*ant/gi, keepCase('grant'))
    .replace(/siz\s*e/gi, keepCase('size'))
    .replace(/r\s*oom/gi, keepCase('room'))
    .replace(/interes\s*t/gi, keepCase('interest'))
    .replace(/s\s*tores/gi, keepCase('stores'))
    .replace(/Manag\s*er/gi, keepCase('Manager'))
    .replace(/Pet\s*s/gi, keepCase('Pets'))
    .replace(/friendl\s*y/gi, keepCase('friendly'))
    .replace(/re\s*generation/gi, keepCase('regeneration'))
    .replace(/t\s*wice/gi, keepCase('twice'))
    .replace(/c\s*an/gi, keepCase('can'))
    .replace(/Collec\s*tor/gi, keepCase('Collector'))
    .replace(/res\s*t/gi, keepCase('rest'))
    .replace(/per\s+da\s*y/gi, 'per day')
    .replace(/da\s*y/gi, keepCase('day'))
    .replace(/\bt\s*he\b/gi, keepCase('the'))
    .replace(/Ac\s*cess/gi, 'access') // the book writes "access" lowercase; the dataset capitalises it mid-sentence
    .replace(/bur\s*st/gi, keepCase('burst'))
    .replace(/Whenev\s*er/gi, keepCase('Whenever'))
    .replace(/ag\s*ainst/gi, keepCase('against'))
    .replace(/Ether\s*eal/gi, keepCase('Ethereal'))
    .replace(/St\s*at/gi, keepCase('Stat'))
    .replace(/g\s*ain/gi, keepCase('gain'))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes a parsed skill name against the registered skills (authoring time; the author reviews the result).
 */
export function matchKnownSkill(raw) {
  let clean = String(raw || '').trim().replace(/^(?:and|or)\s+/i, '').replace(/\s+Attack$/i, '').trim();
  clean = clean.replace(/\s*\(.*?\)/g, '').trim();
  const norm = normalizeKey(clean);
  const found = catalogEntries('skills').find(s => normalizeKey(s.name) === norm);
  return found ? found.name : clean;
}

/**
 * Normalizes a parsed spell name against the registered spells (authoring time; the author reviews the result).
 */
export function matchKnownSpell(raw) {
  let clean = String(raw || '').trim().replace(/^and\s+/i, '').trim();
  clean = clean.replace(/\s*\(.*?\)/g, '').trim();
  const norm = normalizeKey(clean);
  const found = catalogEntries('spells').find(s => normalizeKey(s.name) === norm);
  return found ? found.name : clean;
}

/**
 * Parses freeform custom buff shorthand string (e.g. "+2 STR", "*2 Fire Damage", "10 Temp HP").
 * Authoring-time parser helper.
 */
export function parseCustomBuffText(str) {
  if (!str) return null;
  const raw = String(str).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  // Damage Multiplier buff string (e.g. "*2", "2x damage", "double damage", "*2 fire damage")
  const multMatch = lower.match(/(?:\*|x)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:x|\*)/i);
  if (multMatch || lower.includes('double damage') || lower.includes('triple damage')) {
    const mult = multMatch ? Number(multMatch[1] || multMatch[2]) : (lower.includes('double') ? 2 : 3);
    const dmgType = CONFIG.COG?.damageTypes?.find(dt => lower.includes(dt.toLowerCase())) || '';
    return {
      id: 'custom-' + raw,
      name: raw,
      type: 'buff',
      img: 'icons/svg/sword.svg',
      system: {
        damageType: dmgType,
        damageModifiers: [{ label: raw, mode: 'multiply', multiplier: mult, damageType: dmgType }],
        duration: '',
        description: raw
      }
    };
  }

  const statMatch = lower.match(/(?:\+?(\d+)\s*)?(strength|intelligence|constitution|dexterity|charisma|str|int|con|dex|cha)(?:\s*\+?(\d+))?/i);
  if (statMatch) {
    const statMap = { str: 'str', strength: 'str', int: 'int', intelligence: 'int', con: 'con', constitution: 'con', dex: 'dex', dexterity: 'dex', cha: 'cha', charisma: 'cha' };
    const stat = statMap[statMatch[2].toLowerCase()];
    const val = Number(statMatch[1] || statMatch[3]) || 2;
    return {
      id: 'custom-' + raw,
      name: raw,
      type: 'buff',
      img: 'icons/svg/sword.svg',
      system: { grants: [{ kind: 'stat', stat, value: val, label: raw }], damageType: '', duration: '', description: raw }
    };
  }

  if (lower.includes('resist')) {
    const dmgType = CONFIG.COG?.damageTypes?.find(dt => lower.includes(dt.toLowerCase())) || '';
    return {
      id: 'custom-' + raw,
      name: raw,
      type: 'buff',
      img: 'icons/svg/shield.svg',
      system: { damageType: dmgType, defenseModifiers: [{ kind: 'resistance', label: raw, damageType: dmgType }], duration: '', description: raw }
    };
  }

  if (lower.includes('immun')) {
    const dmgType = CONFIG.COG?.damageTypes?.find(dt => lower.includes(dt.toLowerCase())) || '';
    return {
      id: 'custom-' + raw,
      name: raw,
      type: 'buff',
      img: 'icons/svg/shield.svg',
      system: { damageType: dmgType, defenseModifiers: [{ kind: 'immunity', label: raw, damageType: dmgType }], duration: '', description: raw }
    };
  }

  if (lower.includes('temp') || lower.includes('health') || lower.includes('hp')) {
    const hpMatch = lower.match(/\+?(\d+)/);
    const val = hpMatch ? Number(hpMatch[1]) : 10;
    return {
      id: 'custom-' + raw,
      name: raw,
      type: 'buff',
      img: 'icons/svg/regen.svg',
      system: { damageType: '', defenseModifiers: [{ kind: 'tempHp', label: raw, value: val }], duration: '', description: raw }
    };
  }

  return {
    id: 'custom-' + raw,
    name: raw,
    type: 'buff',
    img: 'icons/svg/aura.svg',
    system: { damageType: '', duration: '', description: raw }
  };
}

export class COGRapidTextParser {
  /**
   * Parse a multi-line string or batch notes into an array of structured event objects.
   * @param {string} text - Raw pasted or dictated notes
   * @param {Array<object>} crawlers - Known crawlers [{id, name}, ...]
   * @param {string} [defaultActorId] - Fallback actor ID if no crawler is identified
   * @returns {Array<object>} Parsed event objects
   */
  static parse(text, crawlers = [], defaultActorId = null) {
    if (!text || typeof text !== 'string') return [];

    const lines = text
      .split(/\r?\n|;/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    const events = [];
    for (let i = 0; i < lines.length; i++) {
      const parsed = this.parseLine(lines[i], crawlers, defaultActorId);
      if (parsed) {
        parsed.lineNumber = i + 1;
        parsed.rawText = lines[i];
        events.push(parsed);
      }
    }

    return events;
  }

  /**
   * Parse a single line into a structured event object.
   * @param {string} line - Single line of text
   * @param {Array<object>} crawlers - Known crawlers
   * @param {string} [defaultActorId] - Fallback actor ID
   * @returns {object|null}
   */
  static parseLine(line, crawlers = [], defaultActorId = null) {
    if (!line || typeof line !== 'string') return null;

    let working = line.trim();

    // Remove leading list markers: - , * , 1. , 1) , •
    working = working.replace(/^[-*•\d.)\]]\s*/, '');
    // Remove bracketed or parenthesized timestamps like [12:34] or (8:00 PM)
    working = working.replace(/^\[\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?\]\s*/i, '');
    working = working.replace(/^\(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?\)\s*/i, '');

    if (!working) return null;

    // 1. MATCH CRAWLER (Prioritize crawler matching at the start of the line)
    let matchedActorId = null;
    let matchedActorName = '';
    const sortedCrawlers = [...crawlers].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));

    // Phase 1A: Check if any crawler is at the start of the line (e.g. "Ana Heal...", "Rosa Chainsaw...")
    for (const c of sortedCrawlers) {
      if (!c.name) continue;
      const fullName = c.name.trim();
      const parts = fullName.split(/\s+/);
      const candidates = [fullName];
      if (parts.length > 1) {
        for (const p of parts) {
          if (p.length >= 3 && !['the', 'and', 'von', 'del', 'san'].includes(p.toLowerCase())) {
            candidates.push(p);
          }
        }
      }

      for (const cand of candidates) {
        const esc = cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const reStart = new RegExp(`^${esc}\\b[:,-]?\\s*`, 'i');
        if (reStart.test(working)) {
          matchedActorId = c.id;
          matchedActorName = c.name;
          working = working.replace(reStart, '');
          break;
        }
      }
      if (matchedActorId) break;
    }

    // Phase 1B: If no crawler at start of line, check anywhere in the line
    if (!matchedActorId) {
      for (const c of sortedCrawlers) {
        if (!c.name) continue;
        const fullName = c.name.trim();
        const parts = fullName.split(/\s+/);
        const candidates = [fullName];
        if (parts.length > 1) {
          for (const p of parts) {
            if (p.length >= 3 && !['the', 'and', 'von', 'del', 'san'].includes(p.toLowerCase())) {
              candidates.push(p);
            }
          }
        }

        for (const cand of candidates) {
          const esc = cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const reWord = new RegExp(`\\b${esc}\\b`, 'i');
          if (reWord.test(working)) {
            matchedActorId = c.id;
            matchedActorName = c.name;
            working = working.replace(reWord, ' ');
            break;
          }
        }
        if (matchedActorId) break;
      }
    }

    if (!matchedActorId) {
      if (defaultActorId) {
        matchedActorId = defaultActorId;
        const defCrawler = crawlers.find(c => c.id === defaultActorId);
        matchedActorName = defCrawler?.name || 'Party Crawler';
      } else if (crawlers.length > 0) {
        matchedActorId = crawlers[0].id;
        matchedActorName = crawlers[0].name;
      } else {
        matchedActorId = 'unknown';
        matchedActorName = 'Party / Crawler';
      }
    }

    // 2. EXTRACT ROLL TOTAL & TARGET DC FIRST (prevents DC from being consumed by adjacent metric words)
    let total = null;
    let targetDC = null;

    // Pattern A: "18 vs 15" or "18 versus 15" or "18/15" or "18 vs DC 15"
    const vsMatch = working.match(/(\d+)\s*(?:vs\.?|versus|\/)\s*(?:dc\s*[:=]?\s*)?(\d+)/i);
    if (vsMatch) {
      total = Number(vsMatch[1]);
      targetDC = Number(vsMatch[2]);
      working = working.replace(vsMatch[0], ' ');
    }

    // Pattern B: explicit total ("total 18", "rolled 18", "roll: 18")
    if (total === null) {
      const totMatch = working.match(/(?:total|rolled|roll|result)\s*(?:an\s*)?[:=]?\s*(\d+)/i);
      if (totMatch) {
        total = Number(totMatch[1]);
        working = working.replace(totMatch[0], ' ');
      }
    }

    // Pattern C: explicit DC ("dc 15", "target 15", "ac 15", "against dc 15")
    if (targetDC === null) {
      const dcMatch = working.match(/(?:against\s*)?(?:dc|target|ac)\s*[:=]?\s*(\d+)/i);
      if (dcMatch) {
        targetDC = Number(dcMatch[1]);
        working = working.replace(dcMatch[0], ' ');
      }
    }

    // 3. UNTRAINED CHECK
    let isUntrained = false;
    const untrainedPattern = /\b(untrained|un-trained|u\/t|\bu\b|no\s*training|disadv(?:antage)?)\b/i;
    if (untrainedPattern.test(working)) {
      isUntrained = true;
      working = working.replace(untrainedPattern, ' ');
    }

    // 4. KILLING BLOW
    let isKill = false;
    const killPattern = /\b(killing\s*blow|fatal|boss\s*kill|slain|killed|dead|kill)\b/i;
    if (killPattern.test(working)) {
      isKill = true;
      working = working.replace(killPattern, ' ');
    }

    // 5. CRITICAL SUCCESS / FAILURE
    let d20Result = null;
    let explicitOutcome = null;

    const critFailPattern = /\b(nat(?:ural)?\s*1|crit(?:ical)?\s*(?:fail(?:ure)?|miss)|botch|fumble)\b/i;
    const critSuccessPattern = /\b(nat(?:ural)?\s*20|crit(?:ical)?\s*(?:success|hit)|natural\s*twenty)\b/i;

    if (critFailPattern.test(working)) {
      explicitOutcome = COG_ROLL_OUTCOMES.CRITICAL_FAILURE;
      d20Result = 1;
    } else if (critSuccessPattern.test(working)) {
      explicitOutcome = COG_ROLL_OUTCOMES.CRITICAL_SUCCESS;
      d20Result = 20;
    } else if (/\bcrit\b/i.test(working)) {
      explicitOutcome = COG_ROLL_OUTCOMES.CRITICAL_SUCCESS;
    }

    // Clean out all crit words from working text
    working = working.replace(/\b(nat(?:ural)?\s*20|nat(?:ural)?\s*1|natural\s*twenty|crit(?:ical)?\s*(?:success|hit|fail(?:ure)?|miss)?|crit|botch|fumble)\b/gi, ' ');

    // 6. METRICS: DAMAGE, HEALING, MITIGATION, FAVOR, POPULARITY
    let damage = 0;
    let healing = 0;
    let mitigation = 0;
    let statDelta = 0;
    let isDamageTaken = false;

    // Check "took X damage" vs "doing X damage"
    const tookDmgMatch = working.match(/\btook\s+(\d+)\s*(?:dmg|damage)?\b/i);
    if (tookDmgMatch) {
      isDamageTaken = true;
      damage = Number(tookDmgMatch[1]);
      working = working.replace(tookDmgMatch[0], ' ');
    }

    // Mitigation (e.g. "blocked 5 dmg", "blocked 5", "mitigated 5", "dr 5", "5 mit")
    // Checked before general damage so "blocked 5 dmg" isn't consumed as damage
    const mitMatch = working.match(/(?:(?:blocked|absorbed|mitigated)\s*(\d+)\s*(?:dmg|damage)?|(\d+)\s*(?:mitigated|mitigation|blocked|absorbed|dr|mit)|(?:mitigated|mitigation|dr|mit)\s*[:=]?\s*(\d+))/i);
    if (mitMatch) {
      mitigation = Number(mitMatch[1] || mitMatch[2] || mitMatch[3]);
      working = working.replace(mitMatch[0], ' ');
    }

    // Damage (e.g. "14 dmg", "14 damage", "dmg 14", "damage: 14")
    const dmgMatch = working.match(/(?:(\d+)\s*(?:dmg|damage|dealt)|(?:dmg|damage|dealt)\s*[:=]?\s*(\d+))/i);
    if (dmgMatch) {
      damage = Number(dmgMatch[1] || dmgMatch[2]);
      working = working.replace(dmgMatch[0], ' ');
    }

    // Healing (e.g. "8 heal", "8 healing", "8 hp", "heal: 8")
    const healMatch = working.match(/(?:(\d+)\s*(?:healing|healed|heal|hp)|(?:healing|healed)\s*[:=]?\s*(\d+)|heal\s*[:=]\s*(\d+))/i);
    if (healMatch) {
      healing = Number(healMatch[1] || healMatch[2] || healMatch[3]);
      working = working.replace(healMatch[0], ' ');
    }

    // Favor (e.g. "+5 favor", "-2 favor")
    const favorMatch = working.match(/(?:([+-]?\d+)\s*favor|favor\s*[:=]?\s*([+-]?\d+))/i);
    if (favorMatch) {
      statDelta = Number(favorMatch[1] || favorMatch[2]);
      working = working.replace(favorMatch[0], ' ');
    }

    // Popularity (e.g. "+10 pop", "pop: +10")
    const popMatch = working.match(/(?:([+-]?\d+)\s*pop(?:ularity)?|pop(?:ularity)?\s*[:=]?\s*([+-]?\d+))/i);
    if (popMatch) {
      statDelta = Number(popMatch[1] || popMatch[2]);
      working = working.replace(popMatch[0], ' ');
    }

    // 6B. CONDITIONS APPLIED / REMOVED
    let condition = '';
    let conditionAction = '';

    const conditionAppliedMatch = working.match(/\b(?:applied|inflicted|gave|caused|inflict|apply)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\b/i);
    const conditionRemovedMatch = working.match(/\b(?:removed|cured|cleansed|dispelled|remove|cure|cleanse)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\b/i);

    if (conditionAppliedMatch) {
      let condText = conditionAppliedMatch[1].trim();
      condText = condText.replace(/\s+(?:on|to|at|against|from|with|by|target|for|in)$/i, '').trim();
      condition = condText.charAt(0).toUpperCase() + condText.slice(1);
      conditionAction = 'applied';
      working = working.replace(conditionAppliedMatch[0], ' ');
    } else if (conditionRemovedMatch) {
      let condText = conditionRemovedMatch[1].trim();
      condText = condText.replace(/\s+(?:on|to|at|against|from|with|by|target|for|in)$/i, '').trim();
      condition = condText.charAt(0).toUpperCase() + condText.slice(1);
      conditionAction = 'removed';
      working = working.replace(conditionRemovedMatch[0], ' ');
    } else {
      const knownConditions = [
        'burning', 'shocked', 'poisoned', 'held', 'stunned', 'queasy', 'shakey', 'staggered',
        'terrified', 'blinded', 'woozy', 'fatigued', 'exhausted', 'frightened', 'asleep',
        'paralyzed', 'prone', 'bleeding', 'bleed', 'poison', 'burn', 'stun'
      ];
      for (const cond of knownConditions) {
        const reCond = new RegExp(`\\b${cond}\\b`, 'i');
        if (reCond.test(working)) {
          condition = cond.charAt(0).toUpperCase() + cond.slice(1);
          if (/\b(?:removed|cured|cleansed|dispelled)\b/i.test(working)) {
            conditionAction = 'removed';
            working = working.replace(/\b(?:removed|cured|cleansed|dispelled)\b/i, ' ');
          } else {
            conditionAction = 'applied';
            working = working.replace(/\b(?:applied|inflicted|gave|caused)\b/i, ' ');
          }
          working = working.replace(reCond, ' ');
          break;
        }
      }
    }

    // 7. DESCRIPTIVE OUTCOME KEYWORDS (if not crit)
    if (!explicitOutcome) {
      if (/\b(?:amazing|major)\s*success\b/i.test(working)) {
        explicitOutcome = COG_ROLL_OUTCOMES.AMAZING_SUCCESS;
        working = working.replace(/\b(?:amazing|major)\s*success\b/i, ' ');
      } else if (/\bmajor\s*fail(?:ure)?\b/i.test(working)) {
        explicitOutcome = COG_ROLL_OUTCOMES.MAJOR_FAILURE;
        working = working.replace(/\bmajor\s*fail(?:ure)?\b/i, ' ');
      } else if (/\bnear\s*miss\b/i.test(working)) {
        explicitOutcome = COG_ROLL_OUTCOMES.NEAR_MISS;
        working = working.replace(/\bnear\s*miss\b/i, ' ');
      } else if (/\b(hit|success|passed|pass)\b/i.test(working)) {
        if (targetDC === null) explicitOutcome = COG_ROLL_OUTCOMES.SUCCESS;
        working = working.replace(/\b(hit|success|passed|pass)\b/i, ' ');
      } else if (/\b(miss(?:ed)?|fail(?:ed|ure)?)\b/i.test(working)) {
        if (targetDC === null) explicitOutcome = COG_ROLL_OUTCOMES.FAILURE;
        working = working.replace(/\b(miss(?:ed)?|fail(?:ed|ure)?)\b/i, ' ');
      }
    }

    // 8. FALLBACK NUMBER EXTRACTION (if total is still missing)
    if (total === null) {
      const remainingNums = [];
      const numRegex = /\b(\d+)\b/g;
      let m;
      while ((m = numRegex.exec(working)) !== null) {
        remainingNums.push({ val: Number(m[1]), str: m[0] });
      }

      if (remainingNums.length >= 2 && targetDC === null) {
        total = remainingNums[0].val;
        targetDC = remainingNums[1].val;
        working = working.replace(remainingNums[0].str, ' ').replace(remainingNums[1].str, ' ');
      } else if (remainingNums.length >= 1) {
        total = remainingNums[0].val;
        working = working.replace(remainingNums[0].str, ' ');
      }
    }

    // Check for target recipient crawler mentions (e.g. "on Rosa", "to Dex", "at Ana")
    let targetNote = '';
    for (const c of sortedCrawlers) {
      const esc = c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const targetRegex = new RegExp(`\\b(?:on|to|at|against)\\s+(${esc})\\b`, 'i');
      const tm = working.match(targetRegex);
      if (tm) {
        targetNote = `Target: ${c.name}`;
        working = working.replace(targetRegex, ' ');
        break;
      }
    }

    // Clean up residual punctuation and excess spaces
    working = working.replace(/[:;,()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();

    // 9. EXTRACT ACTION NAME & RESIDUAL NOTES
    // Filter common filler and comparison words from action name
    const fillerWords = [
      'rolled', 'an', 'a', 'the', 'to', 'hit', 'with', 'against', 'doing', 'dealt',
      'made', 'on', 'check', 'attempt', 'rolls', 'for', 'of', 'in', 'and', 'at',
      'vs', 'versus', 'dc', 'ac', 'target', 'crit', 'critical', 'fail', 'failed',
      'failure', 'success', 'passed', 'pass', 'miss', 'missed', 'blocked', 'took',
      'damage', 'dmg', 'healing', 'healed', 'mitigated', 'mitigation', 'dr'
    ];

    const words = working.split(/\s+/).filter(w => w.length > 0);
    const actionWords = [];

    for (const w of words) {
      const lower = w.toLowerCase();
      if (fillerWords.includes(lower)) {
        continue;
      }
      actionWords.push(w);
    }

    let actionName = actionWords.join(' ').trim();
    if (!actionName) {
      if (condition) {
        actionName = conditionAction === 'removed' ? `Cleanse ${condition}` : `Apply ${condition}`;
      } else if (isDamageTaken) {
        actionName = 'Damage Taken';
      } else if (healing > 0) {
        actionName = 'Heal';
      } else if (damage > 0) {
        actionName = 'Attack Strike';
      } else if (isUntrained) {
        actionName = 'Untrained Skill';
      } else {
        actionName = 'Skill Check';
      }
    }

    // Canonical Tactical Action Names normalization
    const lowerAction = actionName.toLowerCase();
    if (lowerAction === 'interrupt') actionName = 'Interrupt';
    else if (lowerAction === 'call a play' || lowerAction === 'call play') actionName = 'Call a Play';
    else if (lowerAction === 'look for clues' || lowerAction === 'find a clue' || lowerAction === 'look clues' || lowerAction === 'clues') actionName = 'Look for Clues';
    else if (lowerAction === 'dodge' || lowerAction === 'evade' || lowerAction === 'dodge / evade') actionName = 'Dodge';
    else if (lowerAction === 'taunt') actionName = 'Taunt';
    else if (lowerAction === 'catcher') actionName = 'Catcher';
    else if (lowerAction === 'intervene') actionName = 'Intervene';

    // 10. DETERMINE EVENT TYPE
    let type = 'skill';
    if (isUntrained) {
      type = 'untrained_skill';
    } else if (condition && (!actionWords.length || actionWords.length <= 2) && damage === 0 && healing === 0) {
      type = conditionAction === 'removed' ? 'condition_removed' : 'condition_applied';
    } else if (isDamageTaken) {
      type = 'damage_taken';
    } else if (favorMatch) {
      type = 'favor';
    } else if (popMatch) {
      type = 'popularity';
    } else if (/\b(spell|cast|fireball|magic|heal|bless|curse|teleport|blast)\b/i.test(actionName) || healing > 0) {
      type = 'spell';
    } else if (/\b(attack|strike|slash|shoot|stab|chainsaw|hammer|sword|bow|dagger|punch|headbutt|kick|bite|smash)\b/i.test(actionName) || damage > 0) {
      type = 'attack';
    } else if (mitigation > 0 && damage === 0) {
      type = 'damage_mitigated';
    }

    // 11. FINAL OUTCOME EVALUATION
    let outcome = explicitOutcome;
    if (!outcome) {
      if (total !== null && targetDC !== null) {
        outcome = evaluateRollOutcome({ total, d20Result, targetDC });
      } else if (total !== null) {
        outcome = COG_ROLL_OUTCOMES.PENDING;
      } else {
        outcome = COG_ROLL_OUTCOMES.SUCCESS;
      }
    }

    // Format notes string with optional badges and target
    const noteParts = [];
    if (damage > 0) noteParts.push(`${damage} DMG`);
    if (healing > 0) noteParts.push(`${healing} HEAL`);
    if (mitigation > 0) noteParts.push(`Mitigated ${mitigation}`);
    if (condition) noteParts.push(`Condition: ${condition} (${conditionAction})`);
    if (isKill) noteParts.push('KILLING BLOW');
    if (targetNote) noteParts.push(targetNote);

    const notes = noteParts.join(' • ');

    return {
      actorId: matchedActorId,
      actorName: matchedActorName,
      type,
      name: actionName,
      isUntrained,
      total: total !== null ? total : (damage > 0 ? damage : 10),
      d20Result,
      targetDC,
      outcome,
      statDelta,
      damage,
      healing,
      mitigation,
      condition,
      conditionAction,
      isKill,
      notes
    };
  }
}
