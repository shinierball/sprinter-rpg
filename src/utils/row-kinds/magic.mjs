/** Core kinds of `magicProperties` (the property kinds of a generated magic item), registered at import. */
import { craftText } from '../crafting/craft-text.mjs';
import { rngInt, rngPick } from '../rng.mjs';
import { registerCoreKind } from './registry.mjs';

// --- magicProperties (discriminator `property`; 7.3j, D15) ---------------------------------------------------------

/**
 * The property kinds of a generated magic item. `apply.magicItem(option, ctx)` resolves one rolled property row's `magic`
 * option into an enchantment template (the `sanitizeEnchantmentTemplate` shape) and the reveal's one-liner, or returns
 * null when the property is the GM's to finish (the book leaves it to the GM, or the pick has no candidates); the
 * generator then records the row's own words. Pure: every random pick reads `ctx.rng`, and the picks a later property must
 * not repeat go into `ctx.used`.
 * ctx: { tierDef, floor, ownedSkills, catalog: { skills, spells }, damageTypes, used: { stats: Set,
 *   skills: Set }, rng, rowWords }. The numbers (X values, 2 hours of cooldown per Rank, +1 DR, the floor as a passive
 *   skill's Rank) are the book's mechanics (Core pp. 219-220).
 */
const MAGIC_PROPERTY_STATS = Object.freeze(['str', 'dex', 'con', 'int', 'cha']);
/** Hours of cooldown per Rank of a spell a generated item grants. */
const MAGIC_SPELL_COOLDOWN_HOURS_PER_RANK = 2;
/** The flat Damage Reduction a `dr` property gives. */
const MAGIC_DR_FLAT = 1;

const pickWith = (list, rng) => rngPick(rng, list);
const intWith = (range, rng) => rngInt(rng, range);

const textOf = (v) => (typeof v === 'string' ? v.trim() : '');

/** A skill or spell reference: a catalog entry, an owned item's data or a bare identifier. */
function docRef(entry) {
  if (typeof entry === 'string') return { identifier: entry.trim(), name: '', checkType: '' };
  return {
    identifier: textOf(entry?.system?.identifier) || textOf(entry?.identifier),
    name: textOf(entry?.name),
    checkType: textOf(entry?.system?.checkType) || textOf(entry?.checkType)
  };
}
const docRefs = (list) => (Array.isArray(list) ? list : []).map(docRef).filter((r) => r.identifier);

/** The catalog entry's name and check type fill an owned reference that has none. */
function withCatalog(ref, catalog) {
  const hit = docRefs(catalog).find((c) => c.identifier === ref.identifier);
  return { identifier: ref.identifier, name: ref.name || hit?.name || ref.identifier, checkType: ref.checkType || hit?.checkType || '' };
}

const usedSet = (ctx, key) => (ctx?.used?.[key] instanceof Set ? ctx.used[key] : new Set());

const magicTemplate = (label, category, bonusLevel, rows) => ({ label, property: '', category, bonusLevel, rows });

function magicKind(def) {
  registerCoreKind('magicProperties', {
    label: `COG.Rows.Kind.MagicProperties.${def.id}.Label`, hint: `COG.Rows.Kind.MagicProperties.${def.id}.Hint`, fields: [], ...def
  });
}

magicKind({
  id: 'stat',
  apply: {
    // A Stat not picked yet (any when all are), sized by the tier: a flat range, or a percent the row keeps as a percent
    // (it works out against the opener's unenhanced Stat when the item lands on an actor)
    magicItem(option, ctx) {
      const block = ctx?.tierDef?.magicItem?.stat;
      if (!block) return null;
      const used = usedSet(ctx, 'stats');
      const free = MAGIC_PROPERTY_STATS.filter((s) => !used.has(s));
      const stat = pickWith(free.length ? free : MAGIC_PROPERTY_STATS, ctx.rng);
      used.add(stat);
      if (!Array.isArray(block.range)) {
        const percent = Number(block.percent) || 0;
        const label = craftText('COG.MagicItem.Line.statPercent', { percent, stat: stat.toUpperCase() });
        return { template: magicTemplate(label, 'stat', percent, { grants: [{ kind: 'stat', mode: 'fixed', stat, value: 0, percent, label }] }), line: label };
      }
      const value = intWith(block.range, ctx.rng);
      const label = craftText('COG.MagicItem.Line.stat', { value, stat: stat.toUpperCase() });
      return { template: magicTemplate(label, 'stat', value, { grants: [{ kind: 'stat', stat, value, label }] }), line: label };
    }
  }
});

magicKind({
  id: 'skill',
  apply: {
    // An owned skill not picked yet, else any catalog skill not picked yet; Skill Ranks from the tier's range
    magicItem(option, ctx) {
      const range = ctx?.tierDef?.magicItem?.skill;
      if (!range) return null;
      const used = usedSet(ctx, 'skills');
      const owned = docRefs(ctx.ownedSkills).filter((r) => !used.has(r.identifier));
      const pool = owned.length ? owned : docRefs(ctx.catalog?.skills).filter((r) => !used.has(r.identifier));
      const picked = pickWith(pool, ctx.rng);
      if (!picked) return null;
      const skill = withCatalog(picked, ctx.catalog?.skills);
      const value = intWith(range, ctx.rng);
      used.add(skill.identifier);
      const label = craftText('COG.MagicItem.Line.skill', { value, skill: skill.name });
      const category = skill.checkType === 'passive' ? 'passive' : 'active';
      return { template: magicTemplate(label, category, value, { grants: [{ kind: 'skill', identifier: skill.identifier, value, label }] }), line: label };
    }
  }
});

magicKind({
  id: 'passiveSkill',
  apply: {
    // A passive catalog skill not picked yet, at the current floor
    magicItem(option, ctx) {
      const used = usedSet(ctx, 'skills');
      const pool = docRefs(ctx?.catalog?.skills).filter((r) => r.checkType === 'passive' && !used.has(r.identifier));
      const skill = pickWith(pool, ctx?.rng);
      if (!skill) return null;
      const value = Math.max(1, Math.trunc(Number(ctx.floor) || 1));
      used.add(skill.identifier);
      const label = craftText('COG.MagicItem.Line.skill', { value, skill: skill.name || skill.identifier });
      return { template: magicTemplate(label, 'passive', value, { grants: [{ kind: 'skill', identifier: skill.identifier, value, label }] }), line: label };
    }
  }
});

magicKind({
  id: 'spell',
  apply: {
    // A catalog spell at a Rank from the tier's Skill range, with 2 hours of cooldown per Rank
    magicItem(option, ctx) {
      const range = ctx?.tierDef?.magicItem?.skill;
      if (!range) return null;
      const spell = pickWith(docRefs(ctx.catalog?.spells), ctx.rng);
      if (!spell) return null;
      const rank = Math.max(1, intWith(range, ctx.rng));
      const hours = MAGIC_SPELL_COOLDOWN_HOURS_PER_RANK * rank;
      const label = craftText('COG.MagicItem.Line.spell', { spell: spell.name || spell.identifier, rank, hours });
      const grant = { kind: 'spell', identifier: spell.identifier, rank, cooldown: { value: hours, unit: 'hours' }, label };
      return { template: magicTemplate(label, 'active', rank, { grants: [grant] }), line: label };
    }
  }
});

magicKind({
  id: 'dr',
  apply: {
    magicItem() {
      const label = craftText('COG.MagicItem.Line.dr', { value: MAGIC_DR_FLAT });
      return {
        template: magicTemplate(label, 'passive', 1, { defenseModifiers: [{ kind: 'reduction', flat: MAGIC_DR_FLAT, label }] }),
        line: label
      };
    }
  }
});

magicKind({
  id: 'resistance',
  fields: ['damageTypes'],
  apply: {
    // A damage type from the option's list, matched to the damage type registry case-insensitively; no list (or no match)
    // leaves the type to the GM
    magicItem(option, ctx) {
      const registry = Array.isArray(ctx?.damageTypes) ? ctx.damageTypes : Object.keys(ctx?.damageTypes ?? {});
      const listed = (Array.isArray(option?.damageTypes) ? option.damageTypes : []).map((t) => textOf(t).toLowerCase()).filter(Boolean);
      const pool = registry.filter((t) => typeof t === 'string' && listed.includes(t.toLowerCase()));
      const damageType = pickWith(pool, ctx?.rng);
      if (!damageType) return null;
      const label = craftText('COG.MagicItem.Line.resistance', { type: damageType });
      return {
        template: magicTemplate(label, 'passive', 1, { defenseModifiers: [{ kind: 'resistance', damageType, label }] }),
        line: label
      };
    }
  }
});

// The book leaves these to the GM: always recorded with the row's words.
magicKind({ id: 'buff', apply: { magicItem: () => null } });
magicKind({ id: 'restore', apply: { magicItem: () => null } });
