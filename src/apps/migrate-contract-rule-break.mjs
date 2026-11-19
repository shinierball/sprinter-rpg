/**
 * Stored-data migration for hired mercenaries: the `contractRuleBreak` flag a hire or an extension on a Rule Break stamped on
 * the mercenary is no longer written, because nothing ever read it (the contract card and the chat card carry the Rule Break).
 * The migration drops the stale flag. Registered at import (`mercenary-guild.mjs` imports this file).
 */
import { registerMigration } from '../utils/migrations/registry.mjs';
import { readFlag, withoutFlags } from '../utils/flags.mjs';

const OLD_FLAG = 'contractRuleBreak';

registerMigration({
  id: 'drop-contract-rule-break',
  release: '8.3.0',
  covers: ['flag:contractRuleBreak'],
  documents: {
    Actor(source) {
      return readFlag(source, OLD_FLAG) === undefined ? source : withoutFlags(source, [OLD_FLAG]);
    }
  }
});
