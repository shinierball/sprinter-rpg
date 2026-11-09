/**
 * Declaration Card buttons of a mob attack: "Taunt" (Step 2) and the GM's "Resolve now" (Step 3).
 * The tagged Taunt and Catcher offers are the card's interrupt prompts (interrupts.mjs); this Taunt is for any crawler,
 * and one without a Taunt interrupt uses it as a Rule Break.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { getTagsOf } from '../../utils/tag/tag-mechanics.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag/tag-behaviour.mjs';
import { mobAttackText, TARGET_VIA } from '../../utils/combat/declared-attacks.mjs';
import { combatOfDeclaration } from '../../documents/combat-declarations.mjs';
import { COG_ACTION_TYPES } from '../../documents/combat/action-ledger.mjs';
import { resolveActingCrawler } from './roll-evade.mjs';
import { autoHitContextOf } from './interrupts.mjs';

/** The Taunt a crawler without a Taunt interrupt makes as a Rule Break: 1 Action, redirects the attack. */
function ruleBreakTaunt() {
  const def = COG_ACTION_TYPES.taunt;
  return {
    id: def.id, name: mobAttackText('COG.MobAttack.TauntName'), type: 'action', category: def.category, icon: def.icon,
    isFree: false, actionCost: 1, costDesc: '1 Action', trigger: 'any', triggerLabel: def.label,
    interceptMode: TARGET_VIA.REDIRECT, description: def.desc
  };
}

/** The attack's targets now: the declaration's in combat (after earlier Taunts), else the card's own rows. */
function currentTargets(message) {
  const decl = combatOfDeclaration(message?.id, message?.flags?.[SYSTEM_ID]?.combatId)?.getDeclaredAttack?.(message?.id) ?? null;
  if (decl) return decl.targets.map(t => ({ uuid: t.uuid, actorId: t.actorId, tokenId: t.tokenId, name: t.name }));
  const rows = message?.flags?.[SYSTEM_ID]?.targetResults;
  return (Array.isArray(rows) ? rows : [])
    .filter(r => typeof r?.actorUuid === 'string' && r.actorUuid)
    .map(r => ({ uuid: r.actorUuid, actorId: r.actorId ?? null, tokenId: r.tokenId ?? null, name: String(r.actorName ?? '') }));
}

/** The attack item behind the card, for its own tags (`rule.no-redirect` behaviour). */
function attackItemOf(flags) {
  const attacker = resolveActorByUuid(flags?.attackerUuid);
  const items = attacker?.items;
  if (!items || !flags?.attackItemId) return null;
  return typeof items.get === 'function' ? items.get(flags.attackItemId) : Array.from(items).find(i => i?.id === flags.attackItemId) ?? null;
}

async function pickDefender(candidates) {
  if (candidates.length === 1) return candidates[0];
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: mobAttackText('COG.MobAttack.PickTarget') },
    content: '',
    buttons: candidates.map((t, i) => ({ action: String(i), label: t.name })),
    rejectClose: false
  });
  return picked === null || picked === undefined ? null : candidates[Number(picked)] ?? null;
}

/**
 * "Taunt": redirect the declared attack to the clicking user's crawler. A crawler with a Taunt interrupt uses it (its
 * Action and range as usual); one without, or an attack that cannot be redirected, asks for a Rule Break.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message the mob's Declaration Card
 */
export async function handleTauntDeclared(event, button, message) {
  const flags = message?.flags?.[SYSTEM_ID];
  if (flags?.isAutoHit !== true) return null;
  const taunter = await resolveActingCrawler({
    title: mobAttackText('COG.MobAttack.PickCrawler'),
    hint: mobAttackText('COG.MobAttack.PickCrawlerHint'),
    none: mobAttackText('COG.MobAttack.NoCrawler')
  });
  if (!taunter || typeof taunter.triggerInterrupt !== 'function') return null;

  const candidates = currentTargets(message).filter(t => t.uuid !== taunter.uuid);
  if (!candidates.length) {
    ui.notifications?.warn(mobAttackText('COG.MobAttack.NoTarget'));
    return null;
  }
  const defender = await pickDefender(candidates);
  if (!defender) return null;

  const title = mobAttackText('COG.MobAttack.RuleBreakTitle');
  let ruleBreak = false;
  let interrupt = (typeof taunter.getAvailableInterrupts === 'function' ? taunter.getAvailableInterrupts() : [])
    .find(i => i?.interceptMode === TARGET_VIA.REDIRECT) ?? null;
  if (!interrupt) {
    const verdict = await confirmRuleBreak({ title, message: mobAttackText('COG.MobAttack.TauntNoTag', { name: taunter.name }) });
    if (!verdict.confirmed) return null;
    ruleBreak = true;
    interrupt = ruleBreakTaunt();
  }
  if (hasRuleFlag(getTagsOf(attackItemOf(flags)), RULE_FLAGS.noRedirect)) {
    const verdict = await confirmRuleBreak({ title, message: mobAttackText('COG.MobAttack.TauntNoRedirect'), options: { ruleBreak } });
    if (!verdict.confirmed) return null;
    ruleBreak = true;
  }

  const autoHit = autoHitContextOf(message);
  const attackContext = {
    attackerUuid: flags.attackerUuid ?? null,
    defenderId: defender.actorId,
    defenderUuid: defender.uuid,
    defenderTokenId: defender.tokenId,
    defenderName: defender.name,
    attackTotal: autoHit.targetDC,
    floor: Number(flags.currentFloor) || null,
    d20Face: null,
    ...autoHit,
    ...(ruleBreak ? { ruleBreak: true } : {})
  };
  return taunter.triggerInterrupt(interrupt, { targetName: defender.name, attackContext, ...(ruleBreak ? { ruleBreak: true } : {}) });
}

/**
 * "Resolve now (Step 3)": the GM resolves this declared attack (damage and riders through the damage card's apply).
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message the mob's Declaration Card
 */
export async function handleResolveDeclared(event, button, message) {
  if (!game.user?.isGM) {
    ui.notifications?.warn(mobAttackText('COG.MobAttack.GmOnly'));
    return null;
  }
  const combat = game.combat;
  if (!combat?.getDeclaredAttack?.(message?.id)) {
    ui.notifications?.warn(mobAttackText('COG.MobAttack.NoDeclaration'));
    return null;
  }
  return combat.resolveDeclaredAttacks({ ids: [message.id] });
}
