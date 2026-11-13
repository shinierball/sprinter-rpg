/**
 * src/utils/vehicle/vehicle-damage-card.mjs
 * The damage cards a vehicle posts (3.44f): a ram and the explosion at 0%.
 *
 * Both are ordinary damage cards. They carry the same `data-*` attributes the weapon cards carry (`data-typed-damage`,
 * `data-damage-parts`, `data-roll-context`) and the same `crawlerApplyDamage` buttons, so the shared apply handler
 * reads them and the target's defenses run as for any hit. The roll context is what makes them special: a ram is tagged
 * `vehicle.check.ram` (a Ram bumper row, the ram Evade rows), the explosion `vehicle.explosion` (the vehicle's DR does
 * not protect, `vehicleDrFor`). Pure: strings in, strings out.
 */
import { cardPartOf, damageCardDataAttrs } from '../damage/damage-parts.mjs';
import { rollContextDataAttr } from '../roll/roll-context.mjs';
import { escapeAttr } from '../escape-attr.mjs';


/**
 * The HTML of a vehicle damage card.
 * @param {object} p
 * @param {string} p.attackerUuid the vehicle (explosion) or the ramming vehicle's driver (ram) the damage comes from
 * @param {string} p.itemName "Ram" or "Explosion": the name the apply and the undo record show
 * @param {string} p.title the card header
 * @param {Array<{ type: string, finalDamage: number, baseTotal?: number, formula?: string, source?: string }>} p.parts
 * @param {object} p.rollContext the damage roll's RollContext (its tags decide which defenses apply)
 * @param {string[]} [p.notes] extra lines under the total (the occupants an explosion targets, for example)
 * @param {string} [p.extraButtonsHtml] more buttons (the ram's "Apply collision")
 * @returns {string}
 */
export function vehicleDamageCardHtml({ attackerUuid, itemName, title, parts, rollContext, notes = [], extraButtonsHtml = '' }) {
  const list = Array.isArray(parts) ? parts : [];
  const typed = {};
  for (const p of list) typed[p.type] = (typed[p.type] || 0) + (Number(p.finalDamage) || 0);
  const total = Object.values(typed).reduce((a, b) => a + b, 0);
  const cardParts = list.map((p) => cardPartOf({ ...p, multiplier: 1 }));
  const rows = list.map((p) => `<div class="cog-damage-part-row"><strong class="cog-text-accent">${escapeAttr(p.finalDamage)}</strong>`
    + ` <span class="cog-damage-type">${escapeAttr(p.type)}</span>${p.formula ? ` <span class="cog-text-muted">(${escapeAttr(p.formula)})</span>` : ''}</div>`).join('');
  const noteHtml = notes.map((n) => `<div class="cog-damage-effects"><em>${escapeAttr(n)}</em></div>`).join('');
  return `
    <div class="cog-chat-card cog-damage-card cog-vehicle-damage-card"
      data-attacker-uuid="${escapeAttr(attackerUuid)}"
      data-item-name="${escapeAttr(itemName)}"
      data-damage-value="${total}"
      data-typed-damage='${escapeAttr(JSON.stringify(typed))}'${damageCardDataAttrs(cardParts, rollContextDataAttr(rollContext))}
      data-attack-type="vehicle"
      data-is-armor-piercing="false">
      <div class="cog-damage-card-header"><strong>${escapeAttr(title)}</strong></div>
      <div class="cog-damage-card-result"><span class="cog-damage-value cog-text-accent">${total}</span> <span class="cog-damage-formula">Total Damage</span></div>
      <div class="cog-typed-breakdown">${rows}</div>
      ${noteHtml}
      <div class="cog-damage-actions">
        <button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="1"><i class="fa-solid fa-crosshairs"></i> Apply to Target(s)</button>
        <div class="cog-damage-sub-actions">
          <button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="0.5" title="Apply half damage">Half</button>
          <button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="1" data-ignore-dr="true" title="Apply ignoring DR">Ignore DR</button>
          ${extraButtonsHtml}
        </div>
      </div>
    </div>`;
}

/** A button that runs a chat action, with its data attributes. Values are escaped. */
export function vehicleButtonHtml(label, action, data = {}, { className = 'cog-apply-damage-btn' } = {}) {
  const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${escapeAttr(v)}"`).join('');
  return `<button type="button" class="${className}" data-action="${escapeAttr(action)}"${attrs}>${escapeAttr(label)}</button>`;
}

/** The card a ram opens with when the driver is a mob: it never rolls, the attack is an auto-hit against the target's Evade. */
export function mobRamBannerHtml({ driverName, vehicleName, targetName, dc }) {
  return `<div class="cog-chat-card cog-vehicle-ram-card"><div class="cog-damage-card-header"><strong>${escapeAttr(driverName)}</strong> rams ${escapeAttr(targetName)} with ${escapeAttr(vehicleName)}`
    + ` (Auto-Hit vs Evade ${escapeAttr(dc)})</div></div>`;
}
