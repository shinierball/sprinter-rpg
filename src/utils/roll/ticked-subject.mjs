import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { splitRoleTag } from '../../data/tag-vocabulary.mjs';

/**
 * A `subject.*` tag ticked by hand on an untargeted roll is an assertion about a creature that was
 * not there. Against a real target it stands only when the target has no tag in the same namespace.
 */

/**
 * The namespace a ticked subject tag competes in: the unprefixed tag up to its LAST dot, so `creature` for
 * `creature.female` and `creature.size` for `creature.size.large`. A tag with no dot has no namespace (null): nothing
 * can conflict with it.
 * @param {string} tag a role-prefixed tag (`subject.creature.female`)
 * @returns {string|null}
 */
export function tickedNamespace(tag) {
  const inner = splitRoleTag(tag)?.tag ?? '';
  const dot = inner.lastIndexOf('.');
  return dot > 0 ? inner.slice(0, dot) : null;
}

/**
 * The ticks a real target's own tags contradict.
 * @param {Iterable<string>} ticks the card's asserted `subject.*` tags
 * @param {Iterable<string>} targetTags the target's `subject.*` tags * @returns {{ kept: string[], dropped: Array<{ tag: string, targetTags: string[] }> }}
 */
export function partitionTicks(ticks, targetTags) {
  const target = [...targetTags];
  const kept = [];
  const dropped = [];
  for (const tag of ticks) {
    const ns = tickedNamespace(tag);
    const clash = ns === null || target.includes(tag) ? [] : target.filter(t => tickedNamespace(t) === ns);
    if (clash.length > 0) dropped.push({ tag, targetTags: clash });
    else kept.push(tag);
  }
  return { kept, dropped };
}

const TEXT = { 'COG.TickedSubject.Dropped': 'Ticked {tick} dropped: target is {target}' };

function labelOf(tag) {
  const inner = splitRoleTag(tag)?.tag ?? tag;
  return getTagDefinition(inner)?.label ?? inner;
}

/** The warning for one dropped tick: "Ticked Female dropped: target is Male" (localized; labels from the tag registry). */
export function droppedTickText({ tag, targetTags }) {
  const data = { tick: labelOf(tag), target: targetTags.map(labelOf).join(', ') };
  const key = 'COG.TickedSubject.Dropped';
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return TEXT[key].replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}
