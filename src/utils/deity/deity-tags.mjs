/**
 * The per-god tags (a tag family per `DEITY_TAG_FAMILIES` entry: worships, blessed, temple access) as definitions.
 * Pure: the hooks layer registers them (`hooks/deity-tags.mjs`).
 */
import { DEITY_TAG_FAMILIES } from '../../data/tag-vocabulary.mjs';

const DESCRIPTIONS = Object.freeze({
  worships: (name) => `Worships ${name}. Derived on an actor that does; authored on a mob or NPC.`,
  blessed: (name) => `Gear blessed by ${name}.`,
  access: (name) => `Access to the temple of ${name}; the GM adjudicates what it allows.`
});

/**
 * Three tag definitions per deity that has an identifier.
 * @param {Array<{ name?: string, system?: { identifier?: string } }>} deities
 * @returns {Array<{ id: string, label: string, namespace: string, description: string, descriptive?: boolean }>}
 */
export function deityTagDefinitions(deities) {
  const out = [];
  for (const deity of Array.isArray(deities) ? deities : []) {
    const identifier = String(deity?.system?.identifier ?? '').trim();
    if (!identifier) continue;
    const name = String(deity?.name ?? '').trim() || identifier;
    for (const family of DEITY_TAG_FAMILIES) {
      const def = { id: `${family.prefix}${identifier}`, label: `${family.label} ${name}`, namespace: family.namespace, description: DESCRIPTIONS[family.namespace](name) };
      // The `access` namespace holds descriptive tags only (adjudicated by the GM); the others are read by the engine.
      out.push(family.namespace === 'access' ? { ...def, descriptive: true } : def);
    }
  }
  return out;
}
