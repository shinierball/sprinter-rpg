/**
 * The Step 5 Clean Up aura pulse: every active aura on the combat's scene pulses once for the
 * round, on the GM who steps the round (no active-GM gate: a second GM clicking must not be silently skipped), and the pulses post one chat card. Registered with `COGCombat.registerCleanUpStep`
 * at `CLEAN_UP_ORDER.AURA_PULSE` (after round-end effects, before durations, so an aura pulses in the round it
 * expires). Nothing pulses out of combat.
 */
import { combatText } from '../utils/combat-round-text.mjs';
import { conditionLabel } from './actor/condition-data.mjs';
import { activeAurasOnScene, pulseAura } from './actor/aura-pulse.mjs';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/**
 * Pulse every active aura on the combat's scene once for this round.
 * @param {Combat} combat
 * @param {{ round?: number }} [options]
 * @returns {Promise<Array<{ holder: Actor, item: Item, result: object }>>} the auras that pulsed
 */
export async function runAuraPulseStep(combat, { round = combat?.round } = {}) {
  if (!combat || (globalThis.game?.user && !globalThis.game.user.isGM)) return [];
  const scene = combat.scene ?? globalThis.canvas?.scene;
  if (!scene) return [];
  const pulses = [];
  for (const { holder, item } of activeAurasOnScene(scene, { combat })) {
    let result;
    try {
      result = await pulseAura(holder, item, { combat, round });
    } catch (err) {
      console.error(`Sprinter RPG | Aura pulse "${item?.name}" failed:`, err);
      continue;
    }
    if (result.pulsed) pulses.push({ holder, item, result });
  }
  if (pulses.length) await postAuraPulseCard(pulses, round);
  return pulses;
}

/** The card rows of one pulse: damage per enemy, inflicted debuffs, healing and cleansing per ally. */
export function pulseRows({ item, result }) {
  const { report } = result;
  const rows = [];
  const damage = report.damage;
  if (damage) {
    rows.push(`<div class="cog-text-muted">${esc(combatText('COG.AuraPulse.DamageRoll', {
      aura: item.name, formula: damage.formula, total: damage.total, type: damage.type
    }))}</div>`);
  }
  for (const failure of report.errors ?? []) {
    rows.push(`<div class="cog-text-muted">${esc(combatText('COG.AuraPulse.Failed', { aura: item.name, name: failure.actor?.name ?? '?', message: failure.message }))}</div>`);
  }
  const heal = Number(item.system?.area?.healingBars) || 0;
  for (const entry of report.enemies) {
    const parts = [];
    // Damage is dealt in whole Health Bars: a roll too small to take one reads as no bar lost, not "-0 HP"
    if (damage) {
      parts.push(entry.damage > 0
        ? `<span class="cog-text-accent">&minus;${esc(combatText('COG.AuraPulse.Damage', { amount: entry.damage, type: entry.damageType }))}</span>`
        : `<span class="cog-text-muted">${esc(combatText('COG.AuraPulse.NoBarLost', { type: entry.damageType || damage.type }))}</span>`);
    }
    for (const debuff of entry.inflicted ?? []) parts.push(esc(combatText('COG.AuraPulse.Debuff', { debuff: conditionLabel(debuff) })));
    if (parts.length) rows.push(`<div class="cog-bg-danger-tint"><strong>${esc(item.name)}</strong> &rarr; ${esc(entry.actor.name)}: ${parts.join(', ')}</div>`);
  }
  for (const entry of report.allies) {
    const parts = [];
    if (entry.healed) parts.push(esc(combatText('COG.AuraPulse.Heal', { bars: heal })));
    for (const debuff of entry.cleansed) parts.push(esc(combatText('COG.AuraPulse.Cleanse', { debuff: conditionLabel(debuff) })));
    if (parts.length) rows.push(`<div class="cog-bg-success-tint"><strong>${esc(item.name)}</strong> &rarr; ${esc(entry.actor.name)}: ${parts.join(', ')}</div>`);
  }
  return rows;
}

/**
 * One chat card for a Step 5's pulses. Posts nothing when no aura did anything.
 * @param {Array<{ holder: Actor, item: Item, result: object }>} pulses
 * @param {number} round
 * @returns {Promise<ChatMessage|null>}
 */
export async function postAuraPulseCard(pulses, round) {
  const rows = pulses.flatMap(pulseRows);
  if (!rows.length || typeof globalThis.ChatMessage?.create !== 'function') return null;
  const content = `<div class="cog-chat-card cog-round-end-card cog-aura-pulse-card">
    <header class="cog-card-header"><h3><i class="fa-solid fa-circle-radiation"></i> ${esc(combatText('COG.AuraPulse.Title', { round }))}</h3></header>
    <div class="cog-card-body">${rows.join('')}</div>
  </div>`;
  return globalThis.ChatMessage.create({ content, speaker: { alias: 'Combat Tracker' } });
}
