/**
 * Chat-card `data-action` dispatch table. Names are prefixed with `crawler` so they never
 * collide with core chat-log actions (e.g. `expandRoll`).
 */
import { handleApplyDamage } from './apply-damage.mjs';
import { handleApplyReflect } from './apply-reflect.mjs';
import { handleRollSpellDamage, handleRollItemDamage } from './roll-damage.mjs';
import { handleRollSpellAttack } from './roll-spell-attack.mjs';
import { handleRollEvade } from './roll-evade.mjs';
import { handleTriggerInterrupt, handleRetargetInterrupter } from './interrupts.mjs';
import { handleApplyHealing, handleApplyMana, handleApplyHoT } from './restore.mjs';
import { handleApplyBuff } from './apply-buff.mjs';
import { handleApplyCondition } from './apply-condition.mjs';
import { handleCleanseDebuff, handleMendInjury, handleCureDebuff } from './cure.mjs';
import { handleGrantSkillRank, handleGrantStat } from './grant-progression.mjs';
import { handleDrawTable } from './draw-table.mjs';
import { handleCastSpell } from './cast-spell.mjs';
import { handleDismissAura } from './dismiss-aura.mjs';
import { handleDismissZone } from './dismiss-zone.mjs';
import { handlePlaceTemplate } from './place-template.mjs';
import { handleRollContest } from './roll-contest.mjs';
import { handleUndoDamage } from './undo-damage.mjs';
import { handleApplyAiFavorTally } from './ai-favor-tally.mjs';
import { handleUseAssist, handleApplyAssist, handleResolveCalledPlay } from './use-assist.mjs';
import { handleCameraPickRow, handleCameraAward, handleCameraChoice, handleCameraWithheld } from './cameras.mjs';
import { handleContestRoll, handleContestDrop, handleContestPropose } from './contest.mjs';
import { handleTauntDeclared, handleResolveDeclared } from './declared-attacks.mjs';

export const CHAT_ACTIONS = Object.freeze({
  crawlerApplyDamage: handleApplyDamage,
  crawlerApplyReflect: handleApplyReflect,
  crawlerRollSpellAttack: handleRollSpellAttack,
  crawlerRollSpellDamage: handleRollSpellDamage,
  crawlerRollItemDamage: handleRollItemDamage,
  crawlerRollEvade: handleRollEvade,
  crawlerTriggerInterrupt: handleTriggerInterrupt,
  crawlerRetargetInterrupter: handleRetargetInterrupter,
  crawlerApplyHealing: handleApplyHealing,
  crawlerApplyMana: handleApplyMana,
  crawlerApplyHoT: handleApplyHoT,
  crawlerApplyBuff: handleApplyBuff,
  crawlerApplyCondition: handleApplyCondition,
  crawlerCleanseDebuff: handleCleanseDebuff,
  crawlerMendInjury: handleMendInjury,
  crawlerCureDebuff: handleCureDebuff,
  crawlerGrantSkillRank: handleGrantSkillRank,
  crawlerGrantStat: handleGrantStat,
  crawlerDrawTable: handleDrawTable,
  crawlerCastSpell: handleCastSpell,
  crawlerDismissAura: handleDismissAura,
  crawlerDismissArea: handleDismissZone,
  crawlerPlaceTemplate: handlePlaceTemplate,
  crawlerRollContest: handleRollContest,
  crawlerUndoDamage: handleUndoDamage,
  crawlerUseAssist: handleUseAssist,
  crawlerApplyAssist: handleApplyAssist,
  crawlerResolveCalledPlay: handleResolveCalledPlay,
  crawlerApplyAiFavorTally: handleApplyAiFavorTally,
  crawlerCameraPickRow: handleCameraPickRow,
  crawlerCameraAward: handleCameraAward,
  crawlerCameraChoice: handleCameraChoice,
  crawlerCameraWithheld: handleCameraWithheld,
  crawlerContestRoll: handleContestRoll,
  crawlerContestDrop: handleContestDrop,
  crawlerContestPropose: handleContestPropose,
  crawlerTauntDeclared: handleTauntDeclared,
  crawlerResolveDeclared: handleResolveDeclared
});
