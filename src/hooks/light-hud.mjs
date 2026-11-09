/**
 * Light token HUD: an Extinguish button in Foundry's core Token HUD, on the light token itself and on the
 * owner's token (which puts out every light that owner has lit). 3.16d adds Double (when `canDouble`) and Attach / Detach
 * (when `canAttach`).
 * Not the crawler action HUD (`src/apps/crawler-token-hud.mjs`), which is for crawlers only.
 */
import { lightFlagOf, findLightTokens, extinguishTokens } from '../documents/actor/light-source.mjs';
import { toggleDouble, attachLight, detachLight } from '../documents/actor/light-follow.mjs';

/** The light tokens the HUD's token controls: itself when it is a light, else the lights its actor owns. */
function lightsForHud(tokenDoc) {
  if (!tokenDoc) return [];
  if (lightFlagOf(tokenDoc)) return [tokenDoc];
  const ownerUuid = tokenDoc.actor?.uuid;
  return ownerUuid ? findLightTokens((flag) => flag.ownerUuid === ownerUuid) : [];
}

function addControl(root, { cls, label, icon, onClick }) {
  const button = root.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = `control-icon ${cls}`;
  button.dataset.tooltip = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<i class="fa-solid ${icon}"></i>`;
  button.addEventListener('click', async (ev) => {
    ev.preventDefault();
    await onClick();
  });
  (root.querySelector('.col.right') ?? root).appendChild(button);
  return button;
}

/**
 * `renderTokenHUD(app, html)`: v14 passes an HTMLElement. Adds Extinguish when the user owns a lit light, Double when one
 * of them can double, Attach / Detach when one can attach.
 */
export function onRenderTokenHUD(hud, html) {
  // v14 passes the HUD element itself (its `[0]` is the first control, not a wrapper); jQuery (v13) wraps it in `[0]`.
  const root = html?.querySelector ? html : html?.[0];
  const doc = hud?.document ?? hud?.object?.document;
  if (!root?.querySelector || !doc || root.querySelector('.cog-light-extinguish')) return null;
  const owned = () => lightsForHud(doc).filter((d) => d.isOwner !== false);
  const lights = owned();
  if (!lights.length) return null;
  const rerender = () => hud.render?.();
  const extinguishButton = addControl(root, {
    cls: 'cog-light-extinguish', label: 'Extinguish', icon: 'fa-fire-flame-curved',
    onClick: async () => { await extinguishTokens(lightsForHud(doc), { ended: true }); rerender(); }
  });
  const doublers = lights.filter((d) => lightFlagOf(d)?.canDouble);
  if (doublers.length) {
    const allDoubled = doublers.every((d) => lightFlagOf(d).doubled);
    addControl(root, {
      cls: `cog-light-double${allDoubled ? ' active' : ''}`, label: allDoubled ? 'Halve radius' : 'Double radius', icon: 'fa-expand',
      onClick: async () => { for (const d of owned().filter((x) => lightFlagOf(x)?.canDouble)) await toggleDouble(d, !allDoubled); rerender(); }
    });
  }
  const attachers = lights.filter((d) => lightFlagOf(d)?.canAttach);
  if (attachers.length) {
    const allAttached = attachers.every((d) => lightFlagOf(d).attached);
    addControl(root, {
      cls: 'cog-light-attach', label: allAttached ? 'Detach' : 'Attach', icon: allAttached ? 'fa-link-slash' : 'fa-link',
      onClick: async () => {
        for (const d of owned().filter((x) => lightFlagOf(x)?.canAttach)) {
          if (allAttached) await detachLight(d);
          else await attachLight(d);
        }
        rerender();
      }
    });
  }
  return extinguishButton;
}
