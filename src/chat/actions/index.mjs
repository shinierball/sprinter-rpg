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
import { handleApplyItemBuff, handleRemoveItemBuff } from './apply-item-buff.mjs';
import { handleApplyCondition } from './apply-condition.mjs';
import { handleChangeVictim, handleRevertTransformation, handleRevealSecret, handleKeepSecret, handleChangeSecret } from './transformation.mjs';
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
import { handleRollMobLoot, handleHandOutBossLoot } from './fight-loot.mjs';
import { handleApplyEvadeInjury } from './evade-injuries.mjs';
import { handleGrindMapFind } from './grind-map-find.mjs';
import { handleGrindFloorTime } from './grind-floor-time.mjs';
import { handleFloorCollapseOffer } from './floor-collapse-offer.mjs';
import { handleUseAssist, handleApplyAssist, handleResolveCalledPlay } from './use-assist.mjs';
import { handleCameraPickRow, handleCameraAward, handleCameraChoice, handleCameraWithheld } from './cameras.mjs';
import { handleContestRoll, handleContestDrop, handleContestPropose } from './contest.mjs';
import { handlePartyCheckRoll, handlePartyCheckRemove, handlePartyCheckDifficulty } from './party-check.mjs';
import { handleTauntDeclared, handleResolveDeclared } from './declared-attacks.mjs';
import { handleLootBoxWatch } from './loot-box-watch.mjs';
import { handleDeityGift, handleDeityFallen, handleDeitySmiteChance, handleDeityInfidels } from './deity.mjs';
import {
  handleVehicleChoose, handleVehicleBoardAnyway, handleVehicleRamDamage, handleVehicleCollision,
  handleVehicleExplode, handleVehicleExplodeDismiss
} from './vehicle-check.mjs';
import { handlePatronOffer, handlePatronChoose } from './patron-offer.mjs';
import { handleChoosePetRole } from './pet-role.mjs';
import { handlePatronTransfer, handlePatronDeath, handlePatronEndDeity } from './patron-endings.mjs';
import { handlePatronGig } from './patron-gig.mjs';
import { handlePatronAudition, handlePatronPopularity, handlePatronSteady } from './patron-audition.mjs';
import { handleCheckOffer, handleApplyCheckReroll } from './check-offers.mjs';
import { handleAfterKillCheck } from './after-kill-check.mjs';
import { handleSetDifficulty, handleAskOpposed, handleAskEscalating, handleClearDifficulty } from './check-difficulty.mjs';
import { handleScatterDie } from './scatter-die.mjs';
import { handleReloadWeapon } from './reload-weapon.mjs';
import { handleExtraAttack } from './extra-attack.mjs';
import { handlePopularityChecklistUndo } from './popularity-checklist.mjs';
import { handlePopularityChecklistOpen } from './popularity-checklist-open.mjs';
import { handleFanBoxAlertAward, handleFanBoxAlertDismiss } from './fan-box-alert.mjs';
import { handleHitVehicle, handleVehicleEvade } from './vehicle-combat.mjs';
import { handlePetThrown } from './pet-thrown.mjs';
import { handleGiveBackControl } from './give-back-control.mjs';
import { handleNpcTable } from './npc-table.mjs';
import { handleShowDefinition } from './show-definition.mjs';

export const CHAT_ACTIONS = Object.freeze({
  crawlerShowDefinition: handleShowDefinition,
  crawlerNpcTable: handleNpcTable,
  crawlerGiveBackControl: handleGiveBackControl,
  crawlerPetThrown: handlePetThrown,
  crawlerChoosePetRole: handleChoosePetRole,
  crawlerPatronOffer: handlePatronOffer,
  crawlerPatronChoose: handlePatronChoose,
  crawlerPatronTransfer: handlePatronTransfer,
  crawlerPatronDeath: handlePatronDeath,
  crawlerPatronEndDeity: handlePatronEndDeity,
  crawlerPatronAudition: handlePatronAudition,
  crawlerPatronGig: handlePatronGig,
  crawlerPatronPopularity: handlePatronPopularity,
  crawlerPatronSteady: handlePatronSteady,
  crawlerDeityGift: handleDeityGift,
  crawlerDeityFallen: handleDeityFallen,
  crawlerDeitySmiteChance: handleDeitySmiteChance,
  crawlerDeityInfidels: handleDeityInfidels,
  crawlerVehicleChoose: handleVehicleChoose,
  crawlerCheckOffer: handleCheckOffer,
  crawlerApplyCheckReroll: handleApplyCheckReroll,
  crawlerVehicleBoardAnyway: handleVehicleBoardAnyway,
  crawlerVehicleRamDamage: handleVehicleRamDamage,
  crawlerVehicleCollision: handleVehicleCollision,
  crawlerVehicleExplode: handleVehicleExplode,
  crawlerVehicleExplodeDismiss: handleVehicleExplodeDismiss,
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
  crawlerApplyItemBuff: handleApplyItemBuff,
  crawlerRemoveItemBuff: handleRemoveItemBuff,
  crawlerApplyCondition: handleApplyCondition,
  crawlerCleanseDebuff: handleCleanseDebuff,
  crawlerMendInjury: handleMendInjury,
  crawlerCureDebuff: handleCureDebuff,
  crawlerChangeVictim: handleChangeVictim,
  crawlerRevertTransformation: handleRevertTransformation,
  crawlerRevealSecret: handleRevealSecret,
  crawlerKeepSecret: handleKeepSecret,
  crawlerChangeSecret: handleChangeSecret,
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
  crawlerAfterKillCheck: handleAfterKillCheck,
  crawlerSetDifficulty: handleSetDifficulty,
  crawlerAskOpposed: handleAskOpposed,
  crawlerAskEscalating: handleAskEscalating,
  crawlerClearDifficulty: handleClearDifficulty,
  crawlerScatterDie: handleScatterDie,
  crawlerReloadWeapon: handleReloadWeapon,
  crawlerExtraAttack: handleExtraAttack,
  crawlerApplyAiFavorTally: handleApplyAiFavorTally,
  crawlerRollMobLoot: handleRollMobLoot,
  crawlerApplyEvadeInjury: handleApplyEvadeInjury,
  crawlerHandOutBossLoot: handleHandOutBossLoot,
  crawlerGrindMapFind: handleGrindMapFind,
  crawlerGrindFloorTime: handleGrindFloorTime,
  crawlerFloorCollapseOffer: handleFloorCollapseOffer,
  crawlerPopularityChecklistUndo: handlePopularityChecklistUndo,
  crawlerPopularityChecklistOpen: handlePopularityChecklistOpen,
  crawlerFanBoxAlertAward: handleFanBoxAlertAward,
  crawlerFanBoxAlertDismiss: handleFanBoxAlertDismiss,
  crawlerCameraPickRow: handleCameraPickRow,
  crawlerCameraAward: handleCameraAward,
  crawlerCameraChoice: handleCameraChoice,
  crawlerCameraWithheld: handleCameraWithheld,
  crawlerContestRoll: handleContestRoll,
  crawlerContestDrop: handleContestDrop,
  crawlerContestPropose: handleContestPropose,
  crawlerPartyCheckRoll: handlePartyCheckRoll,
  crawlerPartyCheckRemove: handlePartyCheckRemove,
  crawlerPartyCheckDifficulty: handlePartyCheckDifficulty,
  crawlerTauntDeclared: handleTauntDeclared,
  crawlerResolveDeclared: handleResolveDeclared,
  crawlerHitVehicle: handleHitVehicle,
  crawlerVehicleEvade: handleVehicleEvade,
  // 7.3c: the spec names it without the `crawler` prefix (no core chat-log action has this name)
  lootBoxWatch: handleLootBoxWatch
});
