/**
 * Sprinter RPG — Combat Metrics window (AI Combat Awards & Performance Dashboard).
 * The engine (`COGCombatMetrics`) lives in `src/documents/combat-metrics.mjs`; this module holds the
 * AppV2 class only. Engine writes re-render this window through the `cogCombatMetricsUpdated` hook (wired in
 * `src/hooks/ready.mjs`).
 */

import { COGCombat } from '../documents/combat.mjs';
import { COGCombatMetrics } from '../documents/combat-metrics.mjs';
import { COGExperienceTracker } from './xp-tracker.mjs';
import { COGCombatArchiveApp } from './combat-archive.mjs';
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';

/**
 * The Sprinter RPG AI Combat Awards & Performance Dashboard
 */
export class COGCombatMetricsApp extends COGToolApp {
  constructor(options = {}) {
    super(options);
    this.selectedCombatId = options.combatId || null;
  }

  static DEFAULT_OPTIONS = {
    id: 'cog-combat-metrics-app',
    classes: ['cog-sheet-window', 'cog-combat-metrics-window'],
    window: { title: 'Sprinter RPG — AI Combat Performance & Awards', icon: 'fa-solid fa-chart-line', resizable: true },
    position: { width: 780, height: 680 },
    actions: {
      selectCombat: COGCombatMetricsApp.#onSelectCombat,
      resetMetrics: COGCombatMetricsApp.#onResetMetrics,
      adjustDamage: COGCombatMetricsApp.#onAdjustDamage,
      dispatchAward: COGCombatMetricsApp.#onDispatchAward,
      awardEncounterXP: COGCombatMetricsApp.#onAwardEncounterXP,
      undoEncounterXP: COGCombatMetricsApp.#onUndoEncounterXP,
      openArchive: COGCombatMetricsApp.#onOpenArchive,
      toggleFavor: COGCombatMetricsApp.#onToggleFavor
    }
  };

  static PARTS = {
    header: { template: `${SYSTEM_PATH}/templates/apps/combat-metrics/header.hbs` },
    summary: { template: `${SYSTEM_PATH}/templates/apps/combat-metrics/summary.hbs`, scrollable: [''] },
    console: { template: `${SYSTEM_PATH}/templates/apps/combat-metrics/console.hbs` }
  };

  /**
   * Helper to retrieve active combat document or archived encounter record.
   * @returns {Combat|object|null}
   */
  getTargetCombat() {
    if (this.selectedCombatId) {
      const active = (Array.isArray(game.combats) ? game.combats : (game.combats?.contents || []))
        .find(c => c.id === this.selectedCombatId) || (game.combats?.get ? game.combats.get(this.selectedCombatId) : null);
      if (active) return active;
      const archived = COGCombat.getArchivedCombats().find(a => a.id === this.selectedCombatId);
      if (archived) return archived;
    }
    const current = COGCombatMetrics.getCombat();
    if (current) return current;
    const archives = COGCombat.getArchivedCombats();
    if (archives.length > 0) return archives[0];
    return null;
  }

  /**
   * Dispatch an AI award from the console form. The recipient is an actor UUID (the `<select>` option value).
   * @param {{ recipientUuid?: string, awardType?: string, customQuote?: string, favorAmount?: number }} form
   * @returns {Promise<boolean>} true when the award was announced
   */
  async dispatchAward({ recipientUuid, awardType, customQuote = '', favorAmount = 0 } = {}) {
    const actor = resolveActorByUuid(recipientUuid);
    if (!actor) {
      ui.notifications?.warn('Sprinter RPG | Please select a recipient crawler.');
      return false;
    }
    try {
      await COGCombatMetrics.dispatchAIAward({
        combat: this.getTargetCombat(),
        recipientActor: actor,
        awardType,
        customQuote,
        favorAmount
      });
      ui.notifications?.info(`Sprinter RPG | Dispatched ${awardType} award to ${actor.name}!`);
      return true;
    } catch (err) {
      console.error('Sprinter RPG | Failed to dispatch award:', err);
      ui.notifications?.error(`Failed to dispatch award: ${err.message}`);
      return false;
    }
  }

  /** @override */
  async _prepareContext(options = {}) {
    const data = await super._prepareContext(options);

    const activeCombats = (Array.isArray(game.combats) ? game.combats : (game.combats?.contents || [])).map(c => ({
      id: c.id,
      name: c.name || (c.scene?.name ? `${c.scene.name} (Round ${c.round})` : `Combat ${c.id} (Round ${c.round})`),
      isActive: c.isActive,
      round: c.round,
      isArchived: false
    }));

    const archivedCombatsList = COGCombat.getArchivedCombats().map(a => ({
      id: a.id,
      name: a.name || 'Archived Encounter',
      dateString: a.dateString || '',
      totalRounds: a.totalRounds || 1,
      isActive: false,
      isArchived: true,
      round: a.totalRounds || 1
    }));

    const allCombats = [...activeCombats, ...archivedCombatsList];
    const targetCombat = this.getTargetCombat();
    const isArchived = Boolean(targetCombat && typeof targetCombat.setFlag !== 'function');

    const selectedCombatId = targetCombat?.id || null;
    // The encounter picker marks its own selected option (CONTRIBUTING §5: no `../` scoping in the template).
    for (const c of allCombats) c.selected = c.id === selectedCombatId;
    const rawMetrics = targetCombat ? COGCombatMetrics.getMetrics(targetCombat) : {};

    // Gather combatants in this combat
    const crawlers = [];
    if (targetCombat) {
      const combatantsList = isArchived
        ? (targetCombat.combatants || [])
        : Array.from(targetCombat.combatants || []);

      for (const cb of combatantsList) {
        const isMob = typeof cb.isMob === 'boolean'
          ? cb.isMob
          : COGCombat.isMobCombatant(cb);

        if (isMob) continue;

        const actorId = cb.actorId || cb.actor?.id;
        const liveActor = resolveActorByUuid(cb.actorUuid || actorId) || ((actorId && game.actors?.get) ? game.actors.get(actorId) : null);
        const actor = cb.actor || liveActor;
        const m = rawMetrics[actorId] || {
          totalDamage: cb.damageDealt || 0,
          damageTaken: cb.damageTaken || 0,
          highestHit: cb.highestHit || 0,
          kills: cb.kills || 0,
          attacks: {},
          skills: {}
        };

        const attacksList = Object.entries(m.attacks || {}).map(([name, att]) => ({
          name,
          count: att.count || 0,
          damage: att.damage || 0,
          type: att.type || 'Melee',
          avg: att.count > 0 ? Math.round(att.damage / att.count) : 0
        }));

        const skillsList = Object.entries(m.skills || {}).map(([name, count]) => ({
          name,
          count
        }));

        const name = cb.name || actor?.name || 'Crawler';
        const img = cb.img || actor?.img || 'icons/svg/mystery-man.svg';
        const level = actor?.system?.details?.level || cb.level || 1;
        const aiFavor = actor?.system?.attributes?.aiFavor || cb.aiFavor || 0;
        const totalDamage = Math.max(0, Number(cb.damageDealt ?? m.totalDamage) || 0);
        const damageTaken = Math.max(0, Number(cb.damageTaken ?? m.damageTaken) || 0);
        const highestHit = Math.max(0, Number(cb.highestHit ?? m.highestHit) || 0);
        const kills = Math.max(0, Number(cb.kills ?? m.kills) || 0);

        crawlers.push({
          actorId,
          actorUuid: cb.actorUuid || actor?.uuid || liveActor?.uuid || '',
          combatantId: cb.id,
          name,
          type: cb.type || liveActor?.type || 'crawler',
          img,
          level,
          aiFavor,
          totalDamage,
          damageTaken,
          highestHit,
          kills,
          attacks: attacksList,
          skills: skillsList,
          hasAttacks: attacksList.length > 0,
          hasSkills: skillsList.length > 0
        });
      }
    }

    // Sort crawlers by total damage descending
    crawlers.sort((a, b) => b.totalDamage - a.totalDamage);

    // Award console recipients, keyed by actor UUID (never a bare id: unlinked tokens share their base actor's id).
    // With no crawlers in the target encounter (or no encounter at all) fall back to the world's crawler actors.
    let recipients = crawlers
      .filter(c => c.actorUuid)
      .map(c => ({ uuid: c.actorUuid, label: `${c.name} (${c.totalDamage} dmg)` }));
    if (recipients.length === 0) {
      const worldActors = Array.from(game.actors?.contents ?? game.actors ?? []);
      recipients = worldActors
        .filter(a => a.type === 'crawler' && a.uuid)
        .map(a => ({ uuid: a.uuid, label: a.name }));
    }

    // XP calculation for post-battle awarding
    let xpInfo = null;
    if (targetCombat) {
      try {
        xpInfo = COGExperienceTracker.calculateEncounterXP(targetCombat);
      } catch (err) {
        console.warn('Sprinter RPG | Could not calculate encounter XP:', err);
      }
    }

    const previousAwards = rawMetrics.awards || targetCombat?.metrics?.awards || [];

    return {
      ...data,
      activeCombats,
      archivedCombats: archivedCombatsList,
      allCombats,
      selectedCombatId,
      hasCombat: Boolean(targetCombat),
      isArchived,
      combatName: targetCombat?.name || (isArchived ? 'Archived Encounter' : 'Active Encounter'),
      dateString: targetCombat?.dateString || null,
      round: isArchived ? (targetCombat.totalRounds || 1) : (targetCombat?.round || 0),
      totalRounds: targetCombat?.totalRounds || targetCombat?.round || 1,
      crawlers,
      hasCrawlers: crawlers.length > 0,
      recipients,
      hasRecipients: recipients.length > 0,
      xpInfo,
      previousAwards,
      hasPreviousAwards: previousAwards.length > 0
    };
  }

  /** Combat switcher. */
  static #onSelectCombat(event, target) {
    this.selectedCombatId = target.value;
    this.render();
  }

  static async #onResetMetrics() {
    const targetCombat = this.getTargetCombat();
    if (!targetCombat) return;

    const confirm = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Reset Combat Metrics?' },
      content: '<p>Are you sure you want to reset all tracked damage and skill stats for this combat encounter?</p>',
      rejectClose: false
    });
    if (confirm) {
      await COGCombatMetrics.resetMetrics(targetCombat);
      ui.notifications?.info('Sprinter RPG | Combat metrics reset.');
      this.render();
    }
  }

  /** Manual damage adjustment for one crawler. */
  static async #onAdjustDamage(event, target) {
    const actorId = target.dataset.actorId;
    const targetCombat = this.getTargetCombat();
    if (!targetCombat || !actorId) return;

    foundry.applications.api.DialogV2.wait({
      window: { title: 'Manual Damage Adjustment' },
      content: `
        <div style="padding: 6px;">
          <p>Enter the net damage amount to add (or negative to subtract):</p>
          <input type="number" name="damage" value="10" style="width: 100%; font-size: 16px; margin-bottom: 8px;" />
        </div>
      `,
      buttons: [
        {
          action: 'apply',
          icon: 'fa-solid fa-check',
          label: 'Adjust',
          default: true,
          callback: async (event, button) => {
            const val = Number(button.form.elements.damage.value) || 0;
            await COGCombatMetrics.adjustDamage(targetCombat, actorId, val);
            this.render();
          }
        },
        { action: 'cancel', icon: 'fa-solid fa-xmark', label: 'Cancel' }
      ],
      rejectClose: false
    });
  }

  /** Read the four named award console controls and dispatch. */
  static async #onDispatchAward() {
    const field = (name) => this.element.querySelector(`.cog-awards-console [name="${name}"]`);
    const dispatched = await this.dispatchAward({
      recipientUuid: field('recipientUuid')?.value,
      awardType: field('awardType')?.value,
      customQuote: field('customQuote')?.value || '',
      favorAmount: Number(field('favorAmount')?.value) || 0
    });
    if (dispatched) {
      const quote = field('customQuote');
      if (quote) quote.value = '';
      this.render();
    }
  }

  static async #onAwardEncounterXP() {
    const targetCombat = this.getTargetCombat();
    if (!targetCombat) return;

    try {
      await COGExperienceTracker.awardEncounterXP(targetCombat.id);
      this.render();
    } catch (err) {
      console.error('Sprinter RPG | Failed to award encounter XP:', err);
      ui.notifications?.error(err.message);
    }
  }

  static async #onUndoEncounterXP() {
    const targetCombat = this.getTargetCombat();
    if (!targetCombat) return;

    try {
      await COGExperienceTracker.undoAwardEncounterXP(targetCombat.id);
      this.render();
    } catch (err) {
      console.error('Sprinter RPG | Failed to undo encounter XP:', err);
      ui.notifications?.error(err.message);
    }
  }

  /** Open the combat archive timeline for the viewed encounter. */
  static #onOpenArchive() {
    const targetCombat = this.getTargetCombat();
    new COGCombatArchiveApp({ combatId: targetCombat?.id }).render({ force: true });
  }

  /** Show the favor amount only for award types that grant favor. */
  static #onToggleFavor(event, target) {
    const isFavor = target.value === 'favor' || target.value === 'mvp';
    const group = this.element.querySelector('.cog-award-favor-group');
    if (group) group.style.display = isFavor ? '' : 'none';
  }
}
