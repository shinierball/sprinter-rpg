/**
 * The Attack Options pop-up: one window per attack that has anything optional,
 * listing the Damage Effects the actor owns (untrained ones marked), maneuvers, situations and pending Called Plays,
 * pre-filled from the last pick. It only gathers choices: it returns them unsettled and `rollAttack` settles the floor
 * `use.*` rows, asks the one Rule Break confirmation and stores the pick.
 *
 * Registered on `CONFIG.COG.promptAttackOptions` (`src/hooks/system-api.mjs`). Everything shown comes from the model, so
 * the window needs no open sheet (the token HUD has none). Names and labels are only ever displayed.
 */
import { SYSTEM_PATH } from '../constants.mjs';
import { dialogAnswer } from '../utils/ui/dialog-answer.mjs';
import { attackText } from '../utils/attack/attack-text.mjs';
import { cameraText } from '../utils/roll/cameras.mjs';
import { calledPlayLabel, isChecked } from '../utils/roll/roll-context.mjs';

const TEMPLATE = `${SYSTEM_PATH}/templates/apps/attack-options.hbs`;
const t = (key, data) => attackText(`COG.AttackOptions.${key}`, data);
const rankText = (rank) => t('Rank', { n: Number(rank) || 0 });

/**
 * The template context: every label, badge and checked state worked out here (CONTRIBUTING §5).
 * @param {object} model `buildAttackOptions` result
 * @param {{ choices: object, dropped?: Array<{ hint: string }> }} prefilled `prefill` result
 * @returns {object}
 */
export function buildDialogContext(model, prefilled) {
  const choices = prefilled?.choices ?? {};
  const picked = new Set(choices.effects ?? []);
  const ticked = new Set([...(choices.situations ?? []), ...(choices.maneuvers ?? [])]);
  const effects = (model.effects ?? []).map((eff) => {
    const checked = picked.has(eff.identifier);
    const label = eff.cooldown?.ready === false ? eff.cooldown.label : '';
    return {
      identifier: eff.identifier,
      name: eff.name,
      icon: eff.icon || 'fa-burst',
      untrained: eff.untrained === true,
      rankText: rankText(eff.rank),
      summary: eff.summary || '',
      preview: eff.preview || '',
      checked,
      cooldownBadge: { cooldown: label ? { text: label, title: label } : null, ruleBreak: false },
      variantChecked: checked && Boolean(choices.variant),
      variants: (eff.variants ?? []).map(v => ({
        id: v.id,
        label: v.label || v.id,
        checked: checked && choices.variant === v.id,
        minRankText: v.minRank > 0 ? t('VariantNeeds', { n: v.minRank }) : ''
      }))
    };
  });
  const row = (o) => ({
    tag: o.tag,
    label: o.label,
    checked: ticked.has(o.tag),
    used: o.used === true,
    fromText: o.source && o.source !== o.label ? t('From', { source: o.source }) : '',
    readsText: o.reads ? t('ReadsAs', { text: o.reads }) : ''
  });
  const isDamage = model.mode === 'damage';
  // Playing to the Cameras (E6.10): None plus each audience; the pre-filled (armed) one is checked.
  const cameraPick = typeof choices.cameras === 'string' ? choices.cameras : '';
  const cameras = [
    { id: '', label: cameraText('COG.Cameras.None'), checked: !cameraPick },
    ...(model.cameras ?? []).map(a => ({ id: a.id, label: a.label, checked: a.id === cameraPick }))
  ];
  return {
    showCameras: (model.cameras ?? []).length > 0,
    cameras,
    attackName: model.attackName,
    plainFormula: model.plainFormula || '',
    hints: (prefilled?.dropped ?? []).map(d => d.hint).filter(Boolean),
    showEffects: effects.length > 0,
    noneChecked: picked.size === 0,
    aiFavorIfNone: model.aiFavorIfNone > 0 ? model.aiFavorIfNone : 0,
    effects,
    maneuvers: (model.maneuvers ?? []).map(o => ({ ...row(o), rankText: o.rank ? rankText(o.rank) : '', note: o.note || '' })),
    situations: (model.situations ?? []).map(row),
    calledPlays: (model.calledPlays ?? []).map(e => ({ id: e.id, label: calledPlayLabel(e) })),
    markAttack: choices.markTarget === 'attack',
    isDamage,
    text: {
      formula: t('Formula', { formula: model.plainFormula || '' }),
      damageEffect: t('DamageEffect'), maneuvers: t('Maneuvers'), situations: t('Situations'), calledPlay: t('CalledPlay'),
      mark: t('Mark'), markAttack: t('MarkAttack'), markEffect: t('MarkEffect'),
      none: t('None'), noneDesc: t('NoneDesc'), aiFavor: t('AiFavor', { n: model.aiFavorIfNone }),
      untrained: t('Untrained'), addAnother: t('AddAnother'), variantNormal: t('VariantNormal'), used: t('Used'),
      skipHint: t('SkipHint'), cameras: cameraText('COG.Cameras.Title'), camerasHint: cameraText('COG.Cameras.Hint')
    }
  };
}

/** The ticked values of the inputs called `name` in a form. */
const tickedValues = (form, name) => [...(form?.querySelectorAll?.(`input[name="${name}"]`) ?? [])].filter(isChecked).map(el => el.getAttribute('value'));

/**
 * The choices a form holds. Variants only count for the first picked effect; a Mark target only for a picked effect.
 * @param {object} form the dialog's form (or a parsed copy)
 * @param {object} model
 * @returns {object} an AttackChoices, unsettled
 */
export function readDialogChoices(form, model) {
  const effects = tickedValues(form, 'damageEffect').filter(id => id && id !== 'none');
  const variant = effects.length ? (tickedValues(form, `variant-${effects[0]}`)[0] ?? '') : '';
  const pending = new Set((model.calledPlays ?? []).map(e => e.id));
  return {
    effects,
    variant,
    maneuvers: tickedValues(form, 'maneuver'),
    situations: tickedValues(form, 'situation'),
    calledPlays: tickedValues(form, 'calledPlay').filter(id => pending.has(id)),
    markTarget: tickedValues(form, 'markTarget')[0] === 'attack' ? 'attack' : 'effect',
    cameras: (model.cameras ?? []).length > 0 ? (tickedValues(form, 'cameras')[0] ?? '') : null
  };
}

/**
 * Keep the window's dependent controls in step: a variant group shows only while its effect is picked, the Mark choice
 * only while an effect is picked, and "Add another" turns the effect radios into checkboxes (a Rule Break, D4).
 */
function wireDialog(root) {
  if (!root?.querySelectorAll) return;
  const inputs = () => [...root.querySelectorAll('input[name="damageEffect"]')];
  const sync = () => {
    const picked = inputs().filter(isChecked).map(el => el.value).filter(v => v && v !== 'none');
    for (const group of root.querySelectorAll('[data-variants-for]')) group.hidden = !picked.includes(group.dataset.variantsFor);
    const mark = root.querySelector('.cog-damage-effect-mark');
    if (mark) mark.hidden = picked.length === 0;
  };
  for (const input of inputs()) input.addEventListener('change', sync);
  root.querySelector('[data-action="addAnotherEffect"]')?.addEventListener('click', (event) => {
    event.preventDefault();
    for (const input of inputs()) {
      if (input.value === 'none') input.closest('label').hidden = true;
      else input.type = 'checkbox';
    }
    const none = root.querySelector('input[name="damageEffect"][value="none"]');
    if (none) none.checked = false;
    event.currentTarget.hidden = true;
    sync();
  });
  sync();
}

/**
 * Open the pop-up. Enter rolls the pre-fill (the Roll button is the default). Closing or Cancel returns null.
 * @param {object} actor
 * @param {object} item
 * @param {object} model `buildAttackOptions` result
 * @param {{ choices: object, dropped: Array }} prefilled
 * @returns {Promise<object|null>} the choices (unsettled), or null when cancelled
 */
export async function promptAttackOptions(actor, item, model, prefilled) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  const render = globalThis.foundry?.applications?.handlebars?.renderTemplate;
  if (typeof DialogV2?.wait !== 'function' || typeof render !== 'function') return prefilled.choices;
  const content = await render(TEMPLATE, buildDialogContext(model, prefilled));
  const damage = model.mode === 'damage';
  const answer = await DialogV2.wait({
    window: { title: t('Title', { name: model.attackName || item?.name || '' }) },
    position: { width: 420 },
    classes: ['cog-attack-options'],
    modal: true,
    content,
    render: (event, dialog) => wireDialog(dialog?.element ?? event?.target?.element),
    buttons: [
      {
        action: 'roll',
        icon: 'fa-solid fa-dice-d20',
        label: t(damage ? 'RollDamage' : 'RollAttack'),
        default: true,
        callback: (_event, button) => readDialogChoices(button.form, model)
      },
      { action: 'cancel', icon: 'fa-solid fa-xmark', label: t('Cancel'), callback: () => null }
    ],
    rejectClose: false
  });
  // DialogV2 answers a button whose callback returned null/undefined with the button's action string ("cancel"); only
  // the Roll button's choices object counts as a pick, so Cancel aborts exactly like closing the window.
  return dialogAnswer(answer);
}
