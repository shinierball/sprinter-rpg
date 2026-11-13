/**
 * Restore a document from the Celestial AI Poop that replaced it. GM only. A poop keeps a full copy of what it replaced
 * (`flags['sprinter-rpg'].replaced.data`); restoring puts that copy back on the owner and removes the poop. While the
 * theme the document came from is still turned off, the GM confirms a Rule Break first. A race or class goes back through
 * the race and class applier, so its grants are applied again.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { contentRegistry } from './registry.mjs';
import { readReplacedRecord } from '../data/rules/celestial-ai-poop.mjs';
import { COGRaceClassApplier } from '../data/race-class-applier.mjs';
import { confirmRuleBreak } from '../utils/rule-break.mjs';
import { transformationOfItem } from '../utils/character/overlay-state.mjs';
import { isRaceOrClass } from '../utils/document-types.mjs';

const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};
const notify = (level, message) => globalThis.ui?.notifications?.[level]?.(message);
const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** The copy to recreate: the stored data with the restore noted in a history flag (`ruleBreak` when the theme was off). */
function restoredCopy(record, { ruleBreak }) {
  const data = structuredClone(record.data);
  const flags = isPlain(data.flags) ? data.flags : {};
  const own = isPlain(flags[SYSTEM_ID]) ? flags[SYSTEM_ID] : {};
  data.flags = { ...flags, [SYSTEM_ID]: { ...own, restoredFrom: { restoredAt: Date.now(), ruleBreak } } };
  return data;
}

/**
 * Whether a poop can be restored: the user is the GM, the poop is on an actor, and its record is readable.
 * @param {object|null} poop
 * @returns {boolean}
 */
export function canRestorePoop(poop) {
  return Boolean(globalThis.game?.user?.isGM) && Boolean(poop?.parent) && readReplacedRecord(poop) !== null;
}

/**
 * @param {object} actor the owner (defaults to the poop's parent)
 * @param {object} poop the Celestial AI Poop item
 * @param {{ registry?: object, options?: object }} [params] `options` is passed to the Rule Break confirmation
 * @returns {Promise<{ restored: boolean, item?: object|null, reason?: 'not-gm'|'unreadable'|'declined'|'failed', ruleBreak?: boolean }>}
 */
export async function restoreFromPoop(actor, poop, { registry = contentRegistry, options = {} } = {}) {
  if (!globalThis.game?.user?.isGM) return { restored: false, reason: 'not-gm' };
  actor ??= poop?.parent;
  const record = readReplacedRecord(poop);
  if (!actor || !record) return { restored: false, reason: 'unreadable' };

  let ruleBreak = false;
  if (record.source.theme && registry.isThemeOff(record.source.theme)) {
    const themeLabel = registry.getThemes?.()[record.source.theme]?.label || record.source.theme;
    const verdict = await confirmRuleBreak({
      title: t('COG.CelestialAiPoop.RestoreOffTitle'),
      message: t('COG.CelestialAiPoop.RestoreOff', { theme: themeLabel, name: record.name }),
      options
    });
    if (!verdict.confirmed) return { restored: false, reason: 'declined' };
    ruleBreak = true;
  }

  const data = restoredCopy(record, { ruleBreak });
  const poopData = typeof poop.toObject === 'function' ? poop.toObject() : null;
  await actor.deleteEmbeddedDocuments('Item', [poop.id]);
  try {
    let item = null;
    if (isRaceOrClass(data)) {
      // The applier recreates the race or class item and its grants; the grants may name the theme that is off.
      await COGRaceClassApplier.applyKind(actor, data.type, data, { allowOffTheme: true, interactive: false });
      // The restored item, never a transformation's (form race) item of the same type (D4)
      item = Array.from(actor.items ?? []).find((i) => i.type === data.type && !transformationOfItem(i)) ?? null;
    } else {
      [item] = await actor.createEmbeddedDocuments('Item', [data], { keepId: true });
    }
    notify('info', t('COG.CelestialAiPoop.Restored', { name: record.name }));
    return { restored: true, item: item ?? null, ruleBreak };
  } catch (err) {
    // Put the poop back: nothing is lost when the restore fails.
    if (poopData) await actor.createEmbeddedDocuments('Item', [poopData], { keepId: true });
    notify('error', t('COG.CelestialAiPoop.RestoreFailed', { name: record.name, error: String(err?.message ?? err) }));
    return { restored: false, reason: 'failed', ruleBreak };
  }
}
