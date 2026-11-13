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
import { handleChangeVictim, handleRevertTransformation, handleRevealSecret, handleKeepSecret } from './transformation.mjs';
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
import { handleLootBoxWatch } from './loot-box-watch.mjs';
import { handleDeityGift, handleDeityFallen, handleDeitySmiteChance, handleDeityInfidels } from './deity.mjs';
import {
  handleVehicleChoose, handleVehicleOffer, handleVehicleBoardAnyway, handleVehicleRamDamage, handleVehicleCollision,
  handleVehicleExplode, handleVehicleExplodeDismiss
} from './vehicle-check.mjs';
import { handlePatronOffer, handlePatronChoose } from './patron-offer.mjs';
import { handlePatronTransfer, handlePatronDeath, handlePatronEndDeity } from './patron-endings.mjs';
import { handlePatronGig } from './patron-gig.mjs';
import { handlePatronAudition, handlePatronPopularity, handlePatronSteady } from './patron-audition.mjs';
import { handleSetDifficulty, handleAskOpposed, handleClearDifficulty } from './check-difficulty.mjs';
import { handleHitVehicle, handleVehicleEvade } from './vehicle-combat.mjs';

export const CHAT_ACTIONS = Object.freeze({
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
  crawlerVehicleOffer: handleVehicleOffer,
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
  crawlerApplyCondition: handleApplyCondition,
  crawlerCleanseDebuff: handleCleanseDebuff,
  crawlerMendInjury: handleMendInjury,
  crawlerCureDebuff: handleCureDebuff,
  crawlerChangeVictim: handleChangeVictim,
  crawlerRevertTransformation: handleRevertTransformation,
  crawlerRevealSecret: handleRevealSecret,
  crawlerKeepSecret: handleKeepSecret,
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
  crawlerSetDifficulty: handleSetDifficulty,
  crawlerAskOpposed: handleAskOpposed,
  crawlerClearDifficulty: handleClearDifficulty,
  crawlerApplyAiFavorTally: handleApplyAiFavorTally,
  crawlerCameraPickRow: handleCameraPickRow,
  crawlerCameraAward: handleCameraAward,
  crawlerCameraChoice: handleCameraChoice,
  crawlerCameraWithheld: handleCameraWithheld,
  crawlerContestRoll: handleContestRoll,
  crawlerContestDrop: handleContestDrop,
  crawlerContestPropose: handleContestPropose,
  crawlerTauntDeclared: handleTauntDeclared,
  crawlerResolveDeclared: handleResolveDeclared,
  crawlerHitVehicle: handleHitVehicle,
  crawlerVehicleEvade: handleVehicleEvade,
  // 7.3c: the spec names it without the `crawler` prefix (no core chat-log action has this name)
  lootBoxWatch: handleLootBoxWatch
});
