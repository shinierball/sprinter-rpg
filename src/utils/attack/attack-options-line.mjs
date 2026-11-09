/**
 * The Options chip line of the attack cards: one line of chips rendering the
 * card's `attackChoices` snapshot (effect, maneuvers, situations, Rule Break), and the damage button's wording. Pure
 * view-model builders plus one renderer for `templates/shared/attack-options-line.hbs`.
 */
import { SYSTEM_PATH } from '../../constants.mjs';
import { attackText } from './attack-text.mjs';

const LINE_TEMPLATE = `${SYSTEM_PATH}/templates/shared/attack-options-line.hbs`;

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v : []);
const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** The last segment of a tag, spaced and capitalised: the fallback label of a situation that has none. */
function tagTail(tag) {
  const tail = text(tag).split('.').pop().replaceAll('-', ' ').replaceAll('_', ' ');
  return tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : '';
}

/** The effect chip text: `Mic Drop R5`, then the variant label if one is picked. */
function effectText(effect) {
  const name = text(effect.name) || text(effect.identifier);
  const rank = Number.isFinite(Number(effect.rank)) ? Number(effect.rank) : 0;
  const base = `${name} ${attackText('COG.AttackOptions.Rank', { n: rank })}`;
  const variant = isRecord(effect.variant) ? (text(effect.variant.label) || text(effect.variant.id)) : '';
  return variant ? `${base} (${variant})` : base;
}

/**
 * The chips of a card's `attackChoices` flag, sanitised; empty when it holds nothing to show.
 * @param {object|null|undefined} flag
 * @returns {Array<{ kind: string, cls: string, icon: string, text: string, title: string }>}
 */
export function optionsChips(flag) {
  if (!isRecord(flag)) return [];
  const chips = [];
  for (const effect of list(flag.effects).filter(isRecord)) {
    chips.push({
      kind: 'effect', cls: 'cog-badge-attack', icon: 'fa-solid fa-bolt', text: effectText(effect),
      title: effect.untrained ? attackText('COG.AttackOptions.Untrained') : ''
    });
  }
  for (const m of list(flag.maneuvers).filter(isRecord)) {
    const label = text(m.label) || tagTail(m.tag);
    const rank = Number(m.rank) > 0 ? ` ${attackText('COG.AttackOptions.Rank', { n: Number(m.rank) })}` : '';
    const note = text(m.note);
    chips.push({ kind: 'maneuver', cls: 'cog-badge-maneuver', icon: 'fa-solid fa-person-running', text: `${label}${rank}${note ? `: ${note}` : ''}`, title: '' });
  }
  const labels = isRecord(flag.situationLabels) ? flag.situationLabels : {};
  for (const tag of list(flag.situations).map(text).filter(Boolean)) {
    chips.push({ kind: 'situation', cls: 'cog-badge-situation', icon: '', text: text(labels[tag]) || tagTail(tag), title: '' });
  }
  if (flag.ruleBreak === true) {
    chips.push({
      kind: 'ruleBreak', ruleBreak: true, cls: 'cog-badge-rule-break', icon: 'fa-solid fa-triangle-exclamation', text: attackText('COG.AttackOptions.RuleBreak'),
      title: list(flag.reasons).map(text).filter(Boolean).join(' ')
    });
  }
  return chips;
}

/**
 * The chip line as HTML, or '' when there is nothing to show or no template renderer is loaded (a headless caller).
 * @param {object|null|undefined} flag the card's `attackChoices`
 * @returns {Promise<string>}
 */
export async function attackOptionsLineHtml(flag) {
  const chips = optionsChips(flag);
  if (chips.length === 0) return '';
  const render = globalThis.foundry?.applications?.handlebars?.renderTemplate;
  if (typeof render !== 'function') return '';
  return String(await render(LINE_TEMPLATE, { chips }));
}

/**
 * The damage button's label: `Roll Damage (2d2 + 1d4 + 4) · Mic Drop`, `Resolve: Stun instead of damage` for a
 * variant that replaces the damage, or `Roll Hit Effects (no damage)` for an attack whose only effect is its On Hit
 * riders (its zero-damage card applies them).
 * @param {object} args
 * @param {string} args.formula the damage formula, '' when the attack has none
 * @param {object|null} [args.flag] the card's `attackChoices`
 * @param {{ label?: string }|null} [args.resolveVariant] a replacing variant
 */
export function damageButtonLabel({ formula = '', flag = null, resolveVariant = null } = {}) {
  if (resolveVariant) return `Resolve: ${resolveVariant.label}`;
  const names = list(flag?.effects).filter(isRecord).map(e => text(e.name) || text(e.identifier)).filter(Boolean);
  const roll = text(formula) ? `${attackText('COG.AttackOptions.RollDamage')} (${formula})` : attackText('COG.AttackOptions.RollHitEffects');
  return `${roll}${names.length ? ` · ${names.join(', ')}` : ''}`;
}
