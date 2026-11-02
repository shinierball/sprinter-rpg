/**
 * Sprinter RPG — Session Progression & Party Activity Manager
 * 
 * Provides comprehensive tracking across the entire crawler party:
 * - Session definition (Active, New, Historical/Archived)
 * - 7-tier roll outcome evaluation (Critical Failure, Major Failure, Failure, Near Miss, Success, Amazing Success, Critical Success)
 * - Activity ledger (trained & untrained skill checks, spells, attacks, damage given & taken)
 * - Quests, Loot boxes, AI Favor, and Popularity tracking
 * - Manual DM override & live editing controls
 * - End-of-session progression engine (untrained skill promotions, XP distribution, AI recap broadcast)
 */

export {
  COG_ROLL_OUTCOMES,
  COG_OUTCOME_CONFIG,
  evaluateRollOutcome,
  extractD20Result
} from './session-manager/roll-outcomes.mjs';
export { COGSessionEngine } from './session-manager/session-engine.mjs';
export { COGSessionManagerApp } from './session-manager/manager-app.mjs';
