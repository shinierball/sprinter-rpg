/**
 * Page 0 (the play sheet) actions that no other tab has: the Health bars and the AI Favor reroll.
 * Every handler runs with `this` bound to the sheet; each is thin, the rules live in `documents/actor/`.
 */
import { tapHealthBar, healthAfterTap } from '../../documents/actor/health-bar-tap.mjs';
import { latestAiFavorReroll } from '../../documents/actor/latest-roll.mjs';
import { useCheckOffer } from '../../documents/actor/check-after-roll.mjs';
import { AI_FAVOR_OFFER_KEY, AI_FAVOR_REROLL_COST } from '../../utils/roll/check-offers.mjs';
import { checkOfferText } from '../../utils/roll/check-offer-text.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

export const pageZeroActions = {
  /** Tap a Health bar (`data-bar`, 1 = the first): a bar holding Health empties with every bar above it, an empty bar fills up to it. */
  async pageZeroHpBar(event, target) {
    if (!this.isEditable) return;
    const bar = target.dataset.bar;
    // A tap that would leave 0 Health (after temp bars have taken their share) is asked about once; No changes nothing.
    if ((Number(this.actor.system?.attributes?.hp?.value) || 0) > 0 && healthAfterTap(this.actor, bar) <= 0) {
      const text = `This takes ${this.actor.name} to 0 Health, and they start Dying. Continue?`;
      const proceed = await foundry.applications.api.DialogV2.confirm({
        window: { title: 'Take Health to 0?' },
        content: `<p>${escapeAttr(text)}</p>`,
        rejectClose: false,
        modal: true
      });
      if (!proceed) return;
    }
    return tapHealthBar(this.actor, bar);
  },

  /** Confirm, then reroll the user's latest roll with AI Favor through the chat card's own path (`useCheckOffer`). */
  async pageZeroFavorReroll() {
    if (!this.isEditable) return;
    const latest = latestAiFavorReroll(this.actor, globalThis.game?.user);
    if (!latest) return ui.notifications?.info?.(checkOfferText('NothingToReroll'));
    const text = checkOfferText('SpendPrompt', { cost: AI_FAVOR_REROLL_COST, check: latest.name });
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: checkOfferText('SpendTitle') },
      content: `<p>${escapeAttr(text)}</p>`,
      modal: true
    });
    if (!proceed) return;
    await useCheckOffer(latest.message, AI_FAVOR_OFFER_KEY);
  }
};
