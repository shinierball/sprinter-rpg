import { PDFDocument as importedPDFDocument } from '../../lib/pdf-lib.mjs';
import { findCatalogEntry } from '../content/catalog-lookup.mjs';
import { isWeaponGear } from '../documents/actor.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { checkTypeLabel } from '../data/rules/check-types.mjs';
import { normalizeBaseDamage, baseDamageText } from '../utils/base-damage.mjs';
import { primaryDamagePart } from '../utils/damage-parts.mjs';
import { toHitBonusText } from '../utils/to-hit-display.mjs';
import { describeItem, summaryText } from '../utils/item-describer/index.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { DEFAULT_SIZE, sizeName } from '../data/sizes.mjs';
import { spellRole, spellRoleLabel } from '../utils/tag-mechanics.mjs';

function getPDFDocument() {
  return globalThis.PDFLib?.PDFDocument || importedPDFDocument;
}

/**
 * Helper to safely set text on a PDF text field
 */
function setTextField(form, fieldName, value) {
  if (value == null) return;
  try {
    const field = form.getTextField(fieldName);
    if (field) {
      try {
        field.setText(String(value));
      } catch (_err) {
        // Fallback for non-WinAnsi characters (e.g. high Unicode or emojis)
        // eslint-disable-next-line no-control-regex -- intentionally keeps only WinAnsi-safe code points
        const safe = String(value).replace(/[^\x00-\x7F\xA0-\xFF\u2018-\u201D\u2022\u2026]/g, '');
        field.setText(safe);
      }
    }
  } catch (_e) {
    // Gracefully ignore missing or mismatched field
  }
}

/**
 * Helper to safely set a checkbox state
 */
function setCheckBox(form, fieldName, checked) {
  try {
    const field = form.getCheckBox(fieldName);
    if (field) {
      if (checked) field.check();
      else field.uncheck();
    }
  } catch (_e) {
    // Gracefully ignore missing or mismatched checkbox
  }
}

/**
 * The PDF lines for a race or class: its granted features (one per line), or its description when it
 * grants nothing structured.
 * @param {object} item
 * @param {number} maxLines
 * @returns {Promise<string[]>}
 */
async function featureLinesForPdf(item, maxLines) {
  const features = await describeItem(item);
  if (features.length) return features.map(f => f.text).slice(0, maxLines);
  return item.system?.description ? splitToLines(item.system.description, maxLines) : [];
}

/**
 * Helper to split multi-line or comma-delimited text into lines
 */
function splitToLines(text, maxLines = 10) {
  if (!text) return [];
  const raw = String(text);
  let lines = raw.includes('\n')
    ? raw.split('\n')
    : raw.split('; ');
  return lines.map(l => l.trim()).filter(Boolean).slice(0, maxLines);
}

/**
 * Format stat modifier with explicit sign (+/-)
 */
function formatMod(mod) {
  const num = Number(mod) || 0;
  return num >= 0 ? `+${num}` : `${num}`;
}

/**
 * Resolves an external buff key or ID into a clean, human-readable description
 * (e.g. "+2 Strength Buff", "+10 Temp HP", "Resist Fire (50%)")
 * @param {Actor} actor The Crawler Actor
 * @param {string} rawVal The raw buff ID, key, or custom text
 * @returns {string} Human-readable description
 */
export async function resolveBuffDescription(actor, rawVal) {
  if (!rawVal) return '';
  let str = String(rawVal).trim();
  if (Array.isArray(rawVal)) str = String(rawVal[0] || '').trim();
  if (str.includes(',')) str = str.split(',')[0].trim();
  if (!str) return '';

  let buff = null;
  if (typeof actor?.resolveBuff === 'function') {
    buff = actor.resolveBuff(str);
  }
  // By id: an owned item, then the registered catalog (`findCatalogEntry` matches `_id` and `system.identifier`, never a name).
  if (!buff) buff = actor?.items?.get(str) ?? findCatalogEntry('buffs', str);

  if (!buff) {
    return str;
  }

  const name = buff.name || '';

  // What the item does, from the shared describer: "Iron Skin (+2 Strength)"
  const effects = summaryText(await describeItem(buff, { actor }));
  if (!effects) return name || str;
  return name ? `${name} (${effects})` : effects;
}

/**
 * Resolves a hotlist slot entry (id or name) into a readable display string
 */
export async function resolveHotlistDisplay(actor, rawVal, items = []) {
  if (!rawVal) return '';
  const valStr = typeof rawVal === 'string' ? rawVal.trim() : String(rawVal[0] || '').trim();
  if (!valStr) return '';

  // Hotlist slots store document ids (the slot <select> values): owned items first, then registered definitions.
  let matchedItem = items.find(it => it.id === valStr || it._id === valStr);
  if (!matchedItem) matchedItem = findCatalogEntry('spells', valStr);
  if (!matchedItem) matchedItem = findCatalogEntry('skills', valStr);
  if (!matchedItem) matchedItem = findCatalogEntry('buffs', valStr);

  if (matchedItem) {
    if (matchedItem.type === 'spell') {
      const cost = matchedItem.system?.manaCost ?? 0;
      return `${matchedItem.name} (${cost} MP)`;
    } else if (matchedItem.type === 'attack') {
      const dice = primaryDamagePart(matchedItem.system).dice;
      return dice ? `${matchedItem.name} [${dice}]` : matchedItem.name;
    } else if (matchedItem.type === 'buff') {
      return await resolveBuffDescription(actor, matchedItem._id || matchedItem.id || matchedItem.name);
    }
    return matchedItem.name;
  }

  return valStr;
}

/**
 * Route a system-relative file path (`systems/<id>/...`) through Foundry so a host with a route prefix still resolves it.
 * Absolute URLs (`https://`, `//`, `/`, `blob:`, `data:`) pass through unchanged.
 * @param {string} path
 * @returns {string}
 */
export function resolveAssetUrl(path) {
  if (typeof path !== 'string' || !path) return path;
  if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(path)) return path;
  const getRoute = globalThis.foundry?.utils?.getRoute;
  return typeof getRoute === 'function' ? getRoute(path) : path;
}

/** World setting that holds the GM's own copy of the fillable character sheet (a file path). */
export const SHEET_PDF_SETTING = 'characterSheetPdfPath';

/**
 * Where the sheet PDF template comes from, in order: an explicit `options.url`, the world setting the GM filled in,
 * then a sheet a module registered with `registerCharacterSheetPdf`.
 * @param {{ url?: string }} [options]
 * @returns {{ path: string, source: 'option'|'setting'|'registry' }|null}
 */
export function resolveTemplateSource(options = {}) {
  if (options.url) return { path: options.url, source: 'option' };
  let setting = '';
  try { setting = globalThis.game?.settings?.get?.(SYSTEM_ID, SHEET_PDF_SETTING); } catch { /* not registered yet */ }
  if (typeof setting === 'string' && setting.trim()) return { path: setting.trim(), source: 'setting' };
  const registered = contentRegistry.getCharacterSheetPdf()?.path;
  return registered ? { path: registered, source: 'registry' } : null;
}

/**
 * Load template PDF bytes dynamically in browser or Node.js. Returns null when no sheet is configured.
 */
export async function loadTemplatePdf(options = {}) {
  if (options.templateBytes) return options.templateBytes;
  const source = resolveTemplateSource(options);
  if (!source && !options.templatePath) return null;

  const isNode = Boolean(globalThis.process?.versions?.node);

  // Browser / Foundry environment
  if (!isNode && typeof fetch === 'function') {
    const url = source.path;
    const res = await fetch(resolveAssetUrl(url));
    if (!res.ok) throw new Error(`Could not load PDF template from ${url}: ${res.statusText}`);
    return await res.arrayBuffer();
  }

  // Headless Node.js environment
  const fsMod = 'node:fs/promises';
  const pathMod = 'node:path';
  const fs = await import(fsMod);
  const path = await import(pathMod);
  const filePath = options.templatePath || path.resolve(globalThis.process.cwd(), source.path.replace(/^systems\/[^/]+\//, ''));
  return await fs.readFile(filePath);
}

/** Tell the GM there is no sheet to fill. Never throws. */
export function notifyNoSheetPdf() {
  const text = globalThis.game?.i18n?.localize?.('COG.Content.PdfNeedsSheet') ?? 'No character sheet PDF is set.';
  globalThis.ui?.notifications?.warn?.(text);
}

/**
 * Exports a Crawler actor to a fillable character sheet PDF the GM supplies
 * @param {Actor} actor The Crawler Actor
 * @param {object} options Export and template options
 * @returns {Promise<Uint8Array|null>} Filled PDF document bytes, or null when no sheet is set
 */
export async function exportCrawlerToPdf(actor, options = {}) {
  if (!actor) throw new Error('Cannot export PDF without a valid Actor instance');

  if (!options.templateBytes && !options.templatePath && !resolveTemplateSource(options)) {
    notifyNoSheetPdf();
    return null;
  }

  const PDFDocClass = getPDFDocument();
  if (!PDFDocClass) throw new Error('PDFLib is not available');

  const templateBytes = await loadTemplatePdf(options);
  if (!templateBytes) return null;
  const pdfDoc = await PDFDocClass.load(templateBytes);
  const form = pdfDoc.getForm();

  const system = actor.system || {};
  const details = system.details || {};
  const abilities = system.abilities || {};
  const attributes = system.attributes || {};
  const gearSlots = system.gearSlots || {};
  const hotlist = system.hotlist || {};

  // Extract embedded items
  const items = Array.from(actor.items || []);
  const synthAttacks = typeof actor.getSynthesizedAttacks === 'function' ? actor.getSynthesizedAttacks() : null;
  const attacks = (synthAttacks && synthAttacks.length > 0)
    ? synthAttacks
    : items.filter(i => (i.type === 'attack' && i.system?.equipped !== false) || (i.type === 'gear' && i.system?.equipped && isWeaponGear(i)));
  const skills = items.filter(i => i.type === 'skill');
  const spells = items.filter(i => i.type === 'spell');
  const gear = items.filter(i => i.type === 'gear');
  const loot = items.filter(i => i.type === 'loot' || i.type === 'consumable');
  const races = items.filter(i => i.type === 'race');
  const classes = items.filter(i => i.type === 'class');
  const deities = items.filter(i => i.type === 'deity');
  const sponsors = items.filter(i => i.type === 'sponsor');

  // =========================================================================
  // PAGE 1: CORE CHARACTER SHEET
  // =========================================================================
  // 1. Identity
  setTextField(form, 'Name', actor.name || '');
  const raceName = details.race || (races[0] ? races[0].name : '');
  setTextField(form, 'Race', raceName);
  setTextField(form, 'Gender', details.gender || '');
  setTextField(form, 'level', details.level != null ? details.level : 1);
  setTextField(form, 'crawler number', details.crawlerNumber || '');
  const className = details.class || (classes[0] ? classes[0].name : '');
  setTextField(form, 'class', className);
  setTextField(form, 'Floor', details.floor || 'Floor 1');

  // 2. Health Bar (10% to 100%)
  // In Sprinter RPG, each Health Bar slot has a capacity equal to the crawler's CON Mod (Max HP = 10 * CON Mod).
  // Each slot box displays the slot capacity (CON Mod), with checkboxes left blank for tabletop play.
  const conMod = abilities.con?.mod != null ? Number(abilities.con.mod) : 0;
  const maxHp = Number(attributes.hp?.max) || 40;
  const slotHpValue = conMod > 0 ? conMod : Math.max(1, Math.round(maxHp / 10));

  const hpBoxes = [
    { textKey: '10', checkKey: 'Check Box6 2' },
    { textKey: '20', checkKey: 'Check Box6 1' },
    { textKey: '30', checkKey: 'Check Box6 1 1' },
    { textKey: '40', checkKey: 'Check Box6 1 2' },
    { textKey: '50', checkKey: 'Check Box6 1 3' },
    { textKey: '60', checkKey: 'Check Box6 1 4' },
    { textKey: '70', checkKey: 'Check Box6 1 5' },
    { textKey: '80', checkKey: 'Check Box6 1 6' },
    { textKey: '90', checkKey: 'Check Box6 1 7' },
    { textKey: '100', checkKey: 'Check Box6 1 8' }
  ];

  for (const box of hpBoxes) {
    setTextField(form, box.textKey, slotHpValue);
    setCheckBox(form, box.checkKey, false);
  }

  // 3. Ability Scores (Enhanced, Unenhanced, Stat Mod)
  const statMap = [
    { key: 'str', enhancedField: 'Text Field 21', unenhancedField: 'Text Field 22', modField: 'Text Field 23' },
    { key: 'int', enhancedField: 'Text Field 34', unenhancedField: 'Text Field 35', modField: 'Text Field 36' },
    { key: 'con', enhancedField: 'Text Field 43', unenhancedField: 'Text Field 44', modField: 'Text Field 45' },
    { key: 'dex', enhancedField: 'Text Field 46', unenhancedField: 'Text Field 47', modField: 'Text Field 48' },
    { key: 'cha', enhancedField: 'Text Field 49', unenhancedField: 'Text Field 50', modField: 'Text Field 51' }
  ];

  for (const stat of statMap) {
    const ab = abilities[stat.key] || {};
    const enhanced = ab.value != null ? ab.value : 10;
    const unenhanced = ab.unenhanced != null ? ab.unenhanced : enhanced;
    const mod = ab.mod != null ? ab.mod : 0;
    setTextField(form, stat.enhancedField, enhanced);
    setTextField(form, stat.unenhancedField, unenhanced);
    setTextField(form, stat.modField, formatMod(mod));
  }

  // 4. EVADE Row
  const dexMod = abilities.dex?.mod != null ? abilities.dex.mod : 0;
  setTextField(form, 'Text Field 24', formatMod(dexMod));
  setTextField(form, 'Text Field 25', attributes.evade?.buffs || 0);
  setTextField(form, 'Text Field 26', attributes.evade?.total != null ? attributes.evade.total : 10);
  setTextField(form, 'Text Field 27', attributes.speed?.move != null ? attributes.speed.move : 20);
  setTextField(form, 'Text Field 28', attributes.speed?.step != null ? attributes.speed.step : 10);

  // 5. DAMAGE RESISTANCE Row
  const drArmor = (Number(attributes.dr?.armor) || 0) + (Number(attributes.dr?.items) || 0);
  setTextField(form, 'Text Field 29', drArmor);
  setTextField(form, 'Text Field 30', attributes.dr?.buffs || 0);
  setTextField(form, 'Text Field 31', attributes.dr?.total != null ? attributes.dr.total : 0);
  setTextField(form, 'Text Field 32', attributes.aiFavor != null ? attributes.aiFavor : 0);
  setTextField(form, 'Text Field 33', sizeName(attributes.size || DEFAULT_SIZE));

  // 6. Mana & Debuffs
  setTextField(form, 'Text Field 38', attributes.mana?.max != null ? attributes.mana.max : 10);
  setTextField(form, 'Text Field 37', attributes.mana?.value != null ? attributes.mana.value : 10);
  setTextField(form, 'Text Field 39', attributes.debuffs || '');

  // 7. External Buffs (Max 3)
  const extBuffs = attributes.externalBuffs || {};
  setTextField(form, 'Text Field 40', await resolveBuffDescription(actor, extBuffs.buff1));
  setTextField(form, 'Text Field 41', await resolveBuffDescription(actor, extBuffs.buff2));
  setTextField(form, 'Text Field 42', await resolveBuffDescription(actor, extBuffs.buff3));

  // 8. Attacks (Up to 5 rows)
  const attackRowMap = [
    { name: 'Text Field 55', rank: 'Text Field 551', toHitMod: 'Text Field 52', dice: 'Text Field 53', dmgMod: 'Text Field 54', effects: 'Text Field 56' },
    { name: 'Text Field 61', rank: 'Text Field 57', toHitMod: 'Text Field 59', dice: 'Text Field 58', dmgMod: 'Text Field 60', effects: 'Text Field 62' },
    { name: 'Text Field 67', rank: 'Text Field 63', toHitMod: 'Text Field 65', dice: 'Text Field 64', dmgMod: 'Text Field 66', effects: 'Text Field 68' },
    { name: 'Text Field 73', rank: 'Text Field 69', toHitMod: 'Text Field 71', dice: 'Text Field 70', dmgMod: 'Text Field 72', effects: 'Text Field 74' },
    { name: 'Text Field 79', rank: 'Text Field 75', toHitMod: 'Text Field 77', dice: 'Text Field 76', dmgMod: 'Text Field 78', effects: 'Text Field 80' }
  ];

  for (let i = 0; i < attackRowMap.length; i++) {
    const row = attackRowMap[i];
    const atk = attacks[i];
    if (atk) {
      const atkSys = atk.system || {};
      const name = atk.displayName || atk.name || '';
      setTextField(form, row.name, name);
      const rank = atk.skillRank ?? atkSys.rank ?? '';
      setTextField(form, row.rank, rank != null && rank !== '' ? String(rank) : '');
      // A profile's toHitMod is the whole flat to-hit the roll adds (rank, stat, rows, rank breaks); its row dice follow it.
      const toHitMod = atk.toHitMod ?? atkSys.statMod;
      setTextField(form, row.toHitMod, toHitMod != null && toHitMod !== '' ? toHitBonusText({ toHitMod, toHitDiceParts: atk.toHitDiceParts }) : '');
      const dice = atk.combinedDice ?? primaryDamagePart(atkSys).dice;
      setTextField(form, row.dice, dice);
      const dmgMod = atk.dmgStatMod ?? atk.displayDmgMod ?? abilities[primaryDamagePart(atkSys).stat]?.mod ?? '';
      setTextField(form, row.dmgMod, dmgMod != null && dmgMod !== '' ? formatMod(dmgMod) : '');
      const effects = atk.effects ?? atk.displayEffects ?? atkSys.effects ?? atkSys.description ?? '';
      setTextField(form, row.effects, effects);
    }
  }

  // =========================================================================
  // PAGE 2: HOTLIST & GEAR
  // =========================================================================
  // 1. Hotlist (10 slots)
  const hotlistFields = [
    'Text Field 81', 'Text Field 82', 'Text Field 83', 'Text Field 84', 'Text Field 85',
    'Text Field 86', 'Text Field 87', 'Text Field 88', 'Text Field 89', 'Text Field 90'
  ];

  for (let i = 0; i < 10; i++) {
    const slotKey = `slot${i + 1}`;
    const rawVal = hotlist[slotKey];
    if (rawVal) {
      const display = await resolveHotlistDisplay(actor, rawVal, items);
      setTextField(form, hotlistFields[i], display);
    }
  }

  // 2. Gear Slots
  const gearSlotMap = {
    head: 'Text Field 92',
    torso: 'Text Field 93',
    arms: 'Text Field 94',
    hands: 'Text Field 95',
    legs: 'Text Field 96',
    feet: 'Text Field 97'
  };

  for (const [slot, fieldName] of Object.entries(gearSlotMap)) {
    const val = gearSlots[slot] || '';
    // Look up equipped gear for this slot
    const equippedItem = gear.find(g => g.system?.equipped && (g.system.slot || '').toLowerCase() === slot);
    const text = equippedItem ? equippedItem.name : val;
    setTextField(form, fieldName, text);
  }

  // Accessories (multi-line)
  const equippedAccessories = gear
    .filter(g => g.system?.equipped && (g.system.slot || '').toLowerCase() === 'accessory')
    .map(g => g.name);
  const accessoriesText = (equippedAccessories.length ? equippedAccessories.join('\n') : gearSlots.accessories) || '';
  setTextField(form, 'Text Field 91', accessoriesText);

  // 3. Details & Character Notes
  setTextField(form, 'Text Field 98', details.popularity ? String(details.popularity) : '');
  setTextField(form, 'Text Field 99', details.pastTrauma || '');
  setTextField(form, 'Text Field 100', details.looseEnds || '');
  setTextField(form, 'Text Field 101', details.regrets || '');
  const combatTechs = typeof actor.getCombatTechniques === 'function' ? actor.getCombatTechniques() : [];
  let notesText = details.notes || '';
  if (combatTechs.length > 0) {
    const techSummaries = combatTechs.map(t => `• ${t.name} (R${t.rank}): ${t.summary}`).join('\n');
    notesText = notesText ? `${notesText}\n\n[COMBAT MANEUVERS]:\n${techSummaries}` : `[COMBAT MANEUVERS]:\n${techSummaries}`;
  }
  setTextField(form, 'Text Field 102', notesText);

  // =========================================================================
  // PAGE 3: SKILLS & KNOWN SPELLS (20 Rows)
  // Known spells are appended directly to the skills list.
  // =========================================================================
  const skillAndSpellEntries = [...skills, ...spells];
  for (let i = 0; i < 20; i++) {
    const entry = skillAndSpellEntries[i];
    const nameField = `Text Field ${103 + 6 * i}`;
    const rankField = `Text Field ${104 + 6 * i}`;
    const statField = `Text Field ${105 + 6 * i}`;
    const checkTypeField = `Text Field ${106 + 6 * i}`;
    const notesField = `Text Field ${107 + 6 * i}`;
    const checkBox = `Check Box ${i + 1}`;

    if (entry) {
      const sys = entry.system || {};
      const isSpell = entry.type === 'spell';

      if (isSpell) {
        setTextField(form, nameField, entry.name);
        setTextField(form, rankField, sys.rank != null ? sys.rank : 1);

        const statKey = (sys.stat || 'int').toLowerCase();
        const govStat = statKey.toUpperCase();
        const statMod = abilities[statKey]?.mod ?? abilities.int?.mod;
        const statDisplay = statMod != null ? `${govStat} ${formatMod(statMod)}` : govStat;
        setTextField(form, statField, statDisplay);

        const manaCost = sys.manaCost != null ? `${sys.manaCost} MP` : '';
        const role = spellRole(entry);
        const roleText = role !== 'none' ? spellRoleLabel(role) : '';
        let typeDisplay = 'Spell';
        if (roleText && manaCost) {
          typeDisplay = `Spell: ${roleText} (${manaCost})`;
        } else if (manaCost) {
          typeDisplay = `Spell (${manaCost})`;
        } else if (roleText) {
          typeDisplay = `Spell (${roleText})`;
        }
        setTextField(form, checkTypeField, typeDisplay);

        const notesParts = [];
        const baseDamage = normalizeBaseDamage(sys.baseDamage);
        if (baseDamage.dice) {
          notesParts.push(`Dmg: ${baseDamageText(baseDamage, sys.stat)}`);
        }
        if (sys.range && sys.range !== 'Self') {
          notesParts.push(`Rng: ${sys.range}`);
        }
        if (sys.duration && sys.duration !== 'Instantaneous') {
          notesParts.push(`Dur: ${sys.duration}`);
        }
        if (sys.description) {
          notesParts.push(sys.description);
        }
        const notesText = notesParts.join(' | ') || sys.quote || sys.notes || '';
        setTextField(form, notesField, notesText);

        setCheckBox(form, checkBox, (Number(sys.rank) || 1) > 0);
      } else {
        setTextField(form, nameField, entry.name);
        setTextField(form, rankField, sys.rank != null ? sys.rank : '');
        const govStat = (sys.stat || sys.governingStat || '').toUpperCase();
        const statMod = sys.statMod != null ? formatMod(sys.statMod) : '';
        const statDisplay = govStat && statMod ? `${govStat} ${statMod}` : (govStat || statMod);
        setTextField(form, statField, statDisplay);
        setTextField(form, checkTypeField, sys.checkNote || (sys.checkType ? checkTypeLabel(sys.checkType) : '') || '');
        setTextField(form, notesField, sys.description || sys.notes || '');
        setCheckBox(form, checkBox, (Number(sys.rank) || 0) > 0);
      }
    }
  }

  // =========================================================================
  // PAGE 4: INVENTORY (20 Rows)
  // =========================================================================
  const inventoryItems = [...gear, ...loot];
  for (let i = 0; i < 20; i++) {
    const itemField = `Text Field ${223 + 3 * i}`;
    const qtyField = `Text Field ${224 + 3 * i}`;
    const notesField = `Text Field ${225 + 3 * i}`;
    const it = inventoryItems[i];
    if (it) {
      setTextField(form, itemField, it.name);
      const qty = it.system?.quantity != null ? it.system.quantity : 1;
      setTextField(form, qtyField, qty);
      const notes = it.system?.description || it.system?.notes || '';
      setTextField(form, notesField, notes);
    }
  }

  // =========================================================================
  // PAGE 5: EXTRAS & SPACE
  // =========================================================================
  // Pet (if defined on actor or system)
  const petData = details.pet || system.pet || {};
  if (petData.level != null || petData.name) {
    setTextField(form, 'Text Field 3075', petData.level || 1);
    setTextField(form, 'Text Field 3074', petData.abilities?.str?.value ?? petData.str ?? '');
    setTextField(form, 'Text Field 3076', petData.abilities?.int?.value ?? petData.int ?? '');
    setTextField(form, 'Text Field 3078', petData.abilities?.con?.value ?? petData.con ?? '');
    setTextField(form, 'Text Field 3080', petData.abilities?.dex?.value ?? petData.dex ?? '');
    setTextField(form, 'Text Field 3082', petData.abilities?.cha?.value ?? petData.cha ?? '');
    setTextField(form, 'Text Field 3077', petData.attributes?.dr?.total ?? petData.dr ?? '');
    setTextField(form, 'Text Field 3079', petData.attributes?.evade?.total ?? petData.evade ?? '');
    setTextField(form, 'Text Field 3081', petData.attributes?.speed?.move ?? petData.move ?? '');
    setTextField(form, 'Text Field 3083', sizeName(petData.attributes?.size ?? petData.size ?? 'small'));
    setTextField(form, 'Text Field 3084', petData.attack1 || '');
    setTextField(form, 'Text Field 3085', petData.attack2 || '');
    setTextField(form, 'Text Field 3086', petData.special || '');

    const petConMod = petData.abilities?.con?.mod ?? petData.conMod ?? petData.abilities?.con?.value;
    const petSlotVal = petConMod ? Number(petConMod) : '';
    const petHpTextFields = ['Text Field 3064', 'Text Field 3065', 'Text Field 3066', 'Text Field 3067', 'Text Field 3068',
                             'Text Field 3069', 'Text Field 3070', 'Text Field 3071', 'Text Field 3072', 'Text Field 3073'];
    const petCheckBoxes = ['Check Box 800', 'Check Box 801', 'Check Box 802', 'Check Box 803', 'Check Box 804',
                           'Check Box 805', 'Check Box 806', 'Check Box 807', 'Check Box 808', 'Check Box 809'];
    for (let i = 0; i < 10; i++) {
      if (petSlotVal) setTextField(form, petHpTextFields[i], petSlotVal);
      setCheckBox(form, petCheckBoxes[i], false);
    }
  }

  // Mount / Vehicle
  const mountData = details.mount || system.mount_vehicle || {};
  if (mountData.size || mountData.move || mountData.occupants) {
    setTextField(form, 'Text Field 3098', mountData.size ? sizeName(mountData.size) : '');
    setTextField(form, 'Text Field 3099', mountData.move || '');
    setTextField(form, 'Text Field 30100', mountData.occupants || '');
    setTextField(form, 'Text Field 30101', mountData.dr || '');
    setTextField(form, 'Text Field 30102', mountData.accessories || '');
  }

  // Important Things I've Killed (13 lines: Text Field 30103 to 301015)
  const killLines = splitToLines(details.importantKills, 13);
  for (let i = 0; i < 13; i++) {
    const fieldName = `Text Field ${30103 + i}`;
    setTextField(form, fieldName, killLines[i] || '');
  }

  // Clubs, Societies, Guilds (6 lines: Text Field 301016 to 301021)
  const clubLines = splitToLines(details.clubsSocieties, 6);
  for (let i = 0; i < 6; i++) {
    const fieldName = `Text Field ${301016 + i}`;
    setTextField(form, fieldName, clubLines[i] || '');
  }

  // Personal Space
  // The personal-space actor is the single source of truth (2.7a/2.16).
  const spaceSys = actor.getOwnedPersonalSpace?.()?.system || {};
  setTextField(form, 'Text Field 301022', spaceSys.tier ? `Tier ${spaceSys.tier}` : '');
  setTextField(form, 'Text Field 301023', spaceSys.size || '');
  const amenityLines = splitToLines(spaceSys.details?.amenities, 11);
  for (let i = 0; i < 11; i++) {
    const fieldName = `Text Field ${301024 + i}`;
    setTextField(form, fieldName, amenityLines[i] || '');
  }

  // Deity
  const deityText = details.deity || (deities[0] ? `${deities[0].name}: ${deities[0].system?.description || ''}` : '');
  setTextField(form, 'Text Field 301035', deityText);

  // =========================================================================
  // PAGE 6: ABILITIES & SPONSORS
  // =========================================================================
  // Racial Abilities (22 lines: Text Field 301036, 301038, ..., 301078)
  const racialTraits = [];
  if (races[0]) racialTraits.push(...await featureLinesForPdf(races[0], 22));
  for (let i = 0; i < 22; i++) {
    const fieldName = `Text Field ${301036 + 2 * i}`;
    setTextField(form, fieldName, racialTraits[i] || '');
  }

  // Class Abilities (22 lines: Text Field 301037, 301039, ..., 301079)
  const classTraits = [];
  if (classes[0]) classTraits.push(...await featureLinesForPdf(classes[0], 22));
  for (let i = 0; i < 22; i++) {
    const fieldName = `Text Field ${301037 + 2 * i}`;
    setTextField(form, fieldName, classTraits[i] || '');
  }

  // Sponsors (3 boxes: Text Field 301080, 301081, 301082)
  const sponsorFields = ['Text Field 301080', 'Text Field 301081', 'Text Field 301082'];
  for (let i = 0; i < 3; i++) {
    const sp = sponsors[i];
    if (sp) {
      const desc = sp.system?.description ? `\n${sp.system.description}` : '';
      setTextField(form, sponsorFields[i], `${sp.name}${desc}`);
    }
  }

  return await pdfDoc.save();
}

/**
 * Downloads or saves the filled PDF document to the user's computer
 * @param {Actor} actor The Crawler Actor
 * @param {object} options
 */
export async function saveCrawlerPdf(actor, options = {}) {
  if (!options.templateBytes && !options.templatePath && !resolveTemplateSource(options)) {
    notifyNoSheetPdf();
    return null;
  }

  const pdfBytes = await exportCrawlerToPdf(actor, options);
  if (!pdfBytes) return null;
  const rawName = actor?.name || 'crawler';
  const cleanName = rawName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${cleanName}_CharacterSheet.pdf`;

  // 1. Foundry VTT saveDataToFile
  const saveToFile = globalThis.foundry?.utils?.saveDataToFile;
  if (typeof saveToFile === 'function') {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    return saveToFile(blob, 'application/pdf', filename);
  }

  // 2. Standard browser anchor download
  if (typeof document !== 'undefined' && document.createElement) {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);
    return filename;
  }

  return pdfBytes;
}

export const COGPdfExporter = {
  exportCrawlerToPdf,
  saveCrawlerPdf,
  loadTemplatePdf,
  resolveTemplateSource,
  notifyNoSheetPdf,
  resolveAssetUrl,
  resolveBuffDescription,
  resolveHotlistDisplay
};
