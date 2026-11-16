/**
 * Paying a resource for Damage Reduction when a hit is applied (`paidDr` defence rows, a race that spends AI Favor when damaged).
 * Applying a card to a target asks the target's player (or the GM) how many points to spend; each point buys the row's DR for
 * that one application, which `applyDamageTo` hands to the pipeline as `extraDr`. A spend is written through `addAiFavor`
 * (the one AI Favor writer, ledgered). Armor-Piercing ignores every `extraDr`, and the dialog says so.
 */
import { collectPaidDr } from '../../utils/roll/damage-modifiers.mjs';
import { actionTagsOf, buildRollContext, parseRollContext } from '../../utils/roll/roll-context.mjs';
import { addAiFavor } from './ai-favor-tally.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

/** The most spend buttons the dialog shows (a button per point, 0 to this). */
const PAID_DR_MAX_BUTTONS = 5;

const TEMPLATES = {
  'COG.PaidDr.Title': 'Spend AI Favor for DR',
  'COG.PaidDr.Question': '{target} takes {damage}{type} before DR {dr}. Spend AI Favor for +{each} DR each? You have {available}.',
  'COG.PaidDr.Piercing': 'This attack is Armor-Piercing: the DR will be ignored.',
  'COG.PaidDr.None': 'Spend none',
  'COG.PaidDr.Spend': 'Spend {n}'
};

function t(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return TEMPLATES[key].replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

/**
 * Ask how many points to spend. Returns 0 on "none", Cancel or a closed window.
 * @param {{ target: Actor, offer: { dr: number }, rawDamage: number, damageType: string, currentDr: number, available: number, armorPiercing: boolean }} p
 * @returns {Promise<number>} an integer from 0 to `available`
 */
async function askPaidDr({ target, offer, rawDamage, damageType, currentDr, available, armorPiercing }) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.wait !== 'function') return 0;
  const question = escapeAttr(t('COG.PaidDr.Question', {
    target: target.name, damage: rawDamage, type: damageType ? ` ${damageType}` : '', dr: currentDr, each: offer.dr, available
  }));
  const content = `<p>${question}</p>${armorPiercing ? `<p><em>${escapeAttr(t('COG.PaidDr.Piercing'))}</em></p>` : ''}`;
  const buttons = [{ action: 'spend0', label: t('COG.PaidDr.None') }];
  for (let n = 1; n <= Math.min(available, PAID_DR_MAX_BUTTONS); n++) buttons.push({ action: `spend${n}`, label: t('COG.PaidDr.Spend', { n }) });
  const picked = await DialogV2.wait({ window: { title: t('COG.PaidDr.Title') }, content, buttons, rejectClose: false });
  const match = typeof picked === 'string' ? /^spend(\d+)$/.exec(picked) : null;
  return match ? Math.min(available, Number(match[1])) : 0;
}

/**
 * The DR a target's player pays for with AI Favor against one application of a card, asked once per target. Nothing is asked
 * when the call is not interactive, the hit is 0, the user neither is the GM nor owns the target, the target has no AI Favor,
 * or no `paidDr` row of the target matches. The spend is written before the DR is returned.
 * @param {Actor} target
 * @param {Actor|null} attacker
 * @param {{ rollContext?: string, rawDamage?: number, damageType?: string, ignoreDR?: boolean }} params the parsed card
 * @param {{ interactive?: boolean }} [ctx]
 * @returns {Promise<{ extraDr: number, label: string }>}
 */
export async function offerPaidDr(target, attacker, params, ctx = {}) {
  const none = { extraDr: 0, label: '' };
  const rawDamage = Math.max(0, Number(params?.rawDamage) || 0);
  if (ctx.interactive === false || rawDamage <= 0 || !target) return none;
  if (!(globalThis.game?.user?.isGM || target.isOwner)) return none;
  const available = Math.max(0, Math.floor(Number(target.system?.attributes?.aiFavor) || 0));
  if (available < 1) return none;
  const attack = params.rollContext ? parseRollContext(params.rollContext) : null;
  const context = buildRollContext({ actor: target, phase: 'defense', tags: [...actionTagsOf(attack)], other: attacker ?? null, otherRole: 'attacker' });
  const offer = collectPaidDr(target, context).find((o) => o.resource === 'aiFavor');
  if (!offer) return none;
  const currentDr = Number(target.system?.attributes?.dr?.total ?? target.system?.attributes?.dr?.value) || 0;
  const n = await askPaidDr({ target, offer, rawDamage, damageType: params.damageType ?? '', currentDr, available, armorPiercing: Boolean(params.ignoreDR) });
  if (n < 1) return none;
  const paid = await addAiFavor(target, -n, offer.label, { ruleBreak: true });
  return paid ? { extraDr: n * offer.dr, label: offer.label } : none;
}
