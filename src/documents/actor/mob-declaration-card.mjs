/**
 * The mob attack Declaration Card: shared by mob weapon attacks and mob spell attacks.
 * A mob never rolls to hit; the card shows the fixed Evade DC (`evadeBase + Floor`, baseline 10 + DEX mod + Floor),
 * and offers the Step 2 controls (Roll Evade is the shared `_getEvadeButtonHtml`; the Taunt and Resolve buttons are here).
 */
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { mobAttackText } from '../../utils/combat/declared-attacks.mjs';

const VARIANTS = Object.freeze({
  attack: { header: 'COG.MobAttack.Header', icon: 'fa-crosshairs', fill: 'cog-bg-accent-fill', badge: 'cog-bg-accent-strong-fill', text: 'cog-text-accent' },
  spell: { header: 'COG.MobAttack.SpellHeader', icon: 'fa-wand-magic-sparkles', fill: 'cog-bg-magic-fill', badge: 'cog-bg-magic-fill', text: 'cog-text-magic' }
});

/**
 * The card's banner: header, Floor badge, Evade DC with its breakdown, and the area note.
 * @param {{ variant?: 'attack'|'spell', evadeDC: number, floor: number, isArea?: boolean, base?: number,
 *   shift?: number, label?: string|null }} p `base` is the stat-block number and `shift` the mob's +/-5 (E6.10); the
 *   breakdown never derives the base from the DC once a shift exists
 * @returns {string}
 */
export function mobDeclarationBannerHtml({ variant = 'attack', evadeDC, floor, isArea = false, base, shift = 0, label = null }) {
  const v = VARIANTS[variant] ?? VARIANTS.attack;
  const shiftNum = Number(shift) || 0;
  const baseNum = Number.isFinite(Number(base)) && base !== undefined && base !== null ? Number(base) : Number(evadeDC) - Number(floor) - shiftNum;
  const breakdown = mobAttackText('COG.MobAttack.EvadeBreakdown', { base: baseNum, floor })
    + (shiftNum !== 0 ? ` ${mobAttackText('COG.MobAttack.EvadeShift', { sign: shiftNum > 0 ? '+' : '\u2212', n: Math.abs(shiftNum), label: label ?? '' })}` : '');
  const areaBadge = isArea
    ? `<div class="cog-area-badge cog-bg-warning-tint cog-text-warning" style="margin-top: 4px; padding: 3px 6px; border: 1px solid var(--cog-warning); border-radius: 3px; font-size: 10px; font-weight: bold;"><i class="fa-solid fa-burst"></i> ${escapeAttr(mobAttackText('COG.MobAttack.AreaBadge'))}</div>`
    : '';
  return `
      <div class="cog-mob-autohit-card cog-mob-declaration-card" style="font-family: var(--font-primary, 'Oswald', sans-serif); margin-bottom: 6px;">
        <div class="${v.fill} cog-text-on-fill" style="padding: 6px 10px; border-radius: 4px; font-weight: bold; text-transform: uppercase; display: flex; align-items: center; justify-content: space-between;">
          <span><i class="fa-solid ${v.icon}"></i> ${escapeAttr(mobAttackText(v.header))}</span>
          <span class="${v.badge}" style="padding: 2px 6px; border-radius: 3px; font-size: 11px;">${escapeAttr(mobAttackText('COG.MobAttack.FloorBadge', { floor }))}</span>
        </div>
        <div class="cog-bg-surface-alt" style="border: 1px solid var(--cog-divider); border-radius: 4px; padding: 6px 8px; margin-top: 4px; font-size: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>${escapeAttr(mobAttackText('COG.MobAttack.EvadeLabel'))}</span>
            <strong class="${v.text}" style="font-size: 14px;">${escapeAttr(mobAttackText('COG.MobAttack.EvadeDC', { dc: evadeDC }))}</strong>
          </div>
          <div class="cog-evade-dc-breakdown cog-text-muted" style="font-size: 10px; text-align: right;">${escapeAttr(breakdown)}</div>
          <div class="cog-text-muted" style="font-size: 10px; margin-top: 2px;">
            ${escapeAttr(mobAttackText('COG.MobAttack.EvadeHint', { dc: evadeDC }))}
          </div>
          ${areaBadge}
        </div>
      </div>
    `;
}

/**
 * Step 2 / Step 3 controls: a Taunt anyone may try on a single-target attack (a crawler without a Taunt interrupt
 * does so as a Rule Break), and the GM's Resolve button when the attack is declared in a combat.
 * @param {{ isArea?: boolean, targetCount?: number, inCombat?: boolean }} p
 * @returns {string}
 */
export function mobDeclarationControlsHtml({ isArea = false, targetCount = 0, inCombat = false } = {}) {
  const buttons = [];
  if (!isArea && targetCount > 0) {
    buttons.push(`<button type="button" class="cog-taunt-declared-btn cog-dark cog-bg-header-fill cog-text-on-fill" data-action="crawlerTauntDeclared" style="width: 100%; margin-top: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; border: 1px solid var(--cog-warning); border-radius: 3px; font-weight: bold; font-family: var(--font-primary, 'Oswald', sans-serif); text-transform: uppercase;"><i class="fa-solid fa-bullhorn"></i> ${escapeAttr(mobAttackText('COG.MobAttack.TauntButton'))}</button>`);
  }
  if (inCombat) {
    buttons.push(`<button type="button" class="cog-resolve-declared-btn cog-bg-accent-fill cog-text-on-fill" data-action="crawlerResolveDeclared" data-gm-only="true" style="width: 100%; margin-top: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; border: 1px solid var(--cog-accent-strong-fill); border-radius: 3px; font-weight: bold; font-family: var(--font-primary, 'Oswald', sans-serif); text-transform: uppercase;"><i class="fa-solid fa-gavel"></i> ${escapeAttr(mobAttackText('COG.MobAttack.ResolveButton'))}</button>`);
  }
  return buttons.length ? `<div class="cog-declaration-controls" style="margin-top: 6px;">${buttons.join('')}</div>` : '';
}

/**
 * The card's flags for the declaration record: who attacks with what, and each target by uuid and token.
 * @param {object} attacker
 * @param {object} item
 * @param {Array<object>} targetResults `_resolveAttackTargets` rows
 * @returns {{ attackerUuid: string|null, attackerName: string, attackItemName: string, targetResults: object[] }}
 */
export function mobDeclarationFlags(attacker, item, targetResults) {
  return {
    attackerUuid: attacker?.uuid ?? null,
    attackerName: String(attacker?.name ?? ''),
    attackItemName: String(item?.name ?? ''),
    // A target out of range (3.48-8) is not declared against: the Step 3 resolution never reaches it.
    targetResults: (targetResults || []).filter(tr => !tr?.outOfRange).map(tr => ({
      actorId: tr.actorId,
      actorUuid: tr.actor?.uuid ?? null,
      tokenId: tr.tokenId ?? null,
      actorName: tr.actorName,
      targetDC: tr.targetDC,
      isHit: true,
      diff: 0,
      outcome: 'Auto-Hit'
    }))
  };
}

/**
 * The card flag that fixes the mob's Action shift when the card is posted (E6.10 D-M2): every later reader (the Evade
 * button, the free-Evade rule) reads the card, never the mob's current state.
 * @param {{ mode?: string, shift?: number, reasons?: string[], base?: number }} state `getAttackDifficultyState` result
 * @returns {{ mode: string, shift: number, reasons: string[], base: number }}
 */
export function mobAdvantageFlag(state) {
  const reasons = (Array.isArray(state?.reasons) ? state.reasons : []).filter(r => typeof r === 'string').slice(0, 8).map(r => r.slice(0, 80));
  const mode = ['advantage', 'disadvantage', 'cancelled'].includes(state?.mode) ? state.mode : 'normal';
  return { mode, shift: Number(state?.shift) || 0, reasons, base: Number(state?.base) || 0 };
}
