import { buildPayload } from '../data/builders/item-payload.mjs';

/**
 * Item creation helpers shared by directory buttons and the dev API.
 */
/**
 * Create a new Sprinter RPG Item in the world with canonical defaults and immediately open COGItemSheet.
 * Ensures the exact same interface (Item Builder) is used globally for both creation and editing.
 * @param {string} type
 * @param {object} initialData
 * @returns {Promise<Item>}
 */
export async function createAndEditItem(type = 'gear', initialData = {}) {
  // `initialData` is a partial payload, not a budget builder's spec: the sheet is where race and class get edited.
  const spec = { ...initialData };
  const weapon = type === 'weapon' || initialData.isWeapon || initialData.system?.isWeapon;
  if (weapon) spec.system = { ...(initialData.system || {}), isWeapon: true };
  delete spec.isWeapon;
  const itemPayload = buildPayload(weapon ? 'weapon' : type, spec, { delegate: false });

  const ItemClass = CONFIG.Item?.documentClass
    ?? globalThis.foundry?.documents?.Item
    ?? globalThis.Item;

  const created = await ItemClass.create(itemPayload);
  if (created && typeof created.sheet?.render === 'function') {
    created.sheet.render({ force: true });
  }
  return created;
}

/**
 * Open modal to choose object type and immediately launch the Unified Item Builder (COGItemSheet).
 */
export function openGlobalItemCreatorDialog() {
  const content = `
    <div style="font-family: 'Oswald', sans-serif; padding: 6px;">
      <p class="cog-text" style="font-size: 13px; margin-bottom: 10px;">Select the type of object to create in the Unified Item Builder:</p>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <button type="button" class="cog-create-type-btn cog-bg-accent-fill cog-text-on-fill" data-type="weapon" style="padding: 8px; font-family: 'Oswald', sans-serif; font-size: 12px; font-weight: bold; border: 1.5px solid var(--cog-ink); border-radius: 3px; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-crosshairs"></i> Weapon
        </button>
        <button type="button" class="cog-create-type-btn cog-dark cog-bg-header-fill cog-text-on-fill" data-type="gear" style="padding: 8px; font-family: 'Oswald', sans-serif; font-size: 12px; font-weight: bold; border: 1.5px solid var(--cog-ink); border-radius: 3px; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-shield-halved"></i> Gear / Armor
        </button>
        <button type="button" class="cog-create-type-btn cog-bg-magic-fill cog-text-on-fill" data-type="spell" style="padding: 8px; font-family: 'Oswald', sans-serif; font-size: 12px; font-weight: bold; border: 1.5px solid var(--cog-ink); border-radius: 3px; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Spell
        </button>
        <button type="button" class="cog-create-type-btn cog-bg-success-fill cog-text-on-fill" data-type="skill" style="padding: 8px; font-family: 'Oswald', sans-serif; font-size: 12px; font-weight: bold; border: 1.5px solid var(--cog-ink); border-radius: 3px; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-book-bookmark"></i> Skill
        </button>
        <button type="button" class="cog-create-type-btn cog-dark cog-bg-header-fill cog-text-gold" data-type="class" style="padding: 8px; font-family: 'Oswald', sans-serif; font-size: 12px; font-weight: bold; border: 1.5px solid var(--cog-ink); border-radius: 3px; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-graduation-cap"></i> Class
        </button>
        <button type="button" class="cog-create-type-btn cog-bg-magic-tint cog-text-magic" data-type="race" style="padding: 8px; font-family: 'Oswald', sans-serif; font-size: 12px; font-weight: bold; border: 1.5px solid var(--cog-ink); border-radius: 3px; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-dna"></i> Race
        </button>
        <button type="button" class="cog-create-type-btn cog-bg-success-fill cog-text-on-fill" data-type="buff" style="padding: 8px; font-family: 'Oswald', sans-serif; font-size: 12px; font-weight: bold; border: 1.5px solid var(--cog-ink); border-radius: 3px; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-angles-up"></i> Buff
        </button>
        <button type="button" class="cog-create-type-btn cog-bg-warning-fill cog-text-on-fill" data-type="debuff" style="padding: 8px; font-family: 'Oswald', sans-serif; font-size: 12px; font-weight: bold; border: 1.5px solid var(--cog-ink); border-radius: 3px; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-angles-down"></i> Debuff
        </button>
        <button type="button" class="cog-create-type-btn cog-bg-neutral-fill cog-text-on-fill" data-type="loot" style="padding: 8px; font-family: 'Oswald', sans-serif; font-size: 12px; font-weight: bold; border: 1.5px solid var(--cog-ink); border-radius: 3px; cursor: pointer; text-align: left; grid-column: span 2; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-flask"></i> Consumable / Item / Loot
        </button>
      </div>
    </div>
  `;

  return foundry.applications.api.DialogV2.wait({
    window: { title: 'Sprinter RPG — Create New Item / Object' },
    position: { width: 440 },
    content,
    buttons: [
      { action: 'cancel', icon: 'fa-solid fa-xmark', label: 'Cancel', default: true }
    ],
    rejectClose: false,
    render: (event, dialog) => {
      for (const btn of dialog.element.querySelectorAll('.cog-create-type-btn')) {
        btn.addEventListener('click', async (ev) => {
          ev.preventDefault();
          await dialog.close();
          await createAndEditItem(btn.dataset.type);
        });
      }
    }
  });
}
