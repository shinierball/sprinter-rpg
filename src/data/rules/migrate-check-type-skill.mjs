/**
 * Stored-data migration: the skill check type id `stat` became `skill` (9.6h0). Release 8.0.0 labelled `stat` "Stat Check"
 * but rolled a Skill Check (1d20 + Stat Mod + Rank), so the id moved to what it does and `statOnly` can name the real Stat
 * Check. `system.checkType` holds a check-type registry id on a skill and on a spell; only the exact value `stat` converts
 * (`opposed`, `tool`, a module's own id and an unregistered id stay). A race or class keeps `chosenSkills` / `chosenSpells`
 * rows that the grant code reads a `checkType` from, so those are converted too, in the rows that carry the key. Items
 * embedded in actors and in unlinked tokens are walked by the runner as `Item` nodes. Registered at import (`check-types.mjs`,
 * which owns the ids, imports this file).
 */
import { registerMigration } from '../../utils/migrations/registry.mjs';

const OLD_ID = 'stat';
const NEW_ID = 'skill';
const CHOSEN_LISTS = ['chosenSkills', 'chosenSpells'];

/** Convert `checkType` on one record that holds it; an absent key, another value or a non-record is left alone. */
function convertRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return;
  if (record.checkType === OLD_ID) record.checkType = NEW_ID;
}

function convertItem(source) {
  const system = source?.system;
  if (system === null || typeof system !== 'object') return source;
  if (source.type === 'skill' || source.type === 'spell') convertRecord(system);
  // Only a race and a class have these lists (no type test: the lists are what is converted).
  else for (const list of CHOSEN_LISTS) if (Array.isArray(system[list])) system[list].forEach(convertRecord);
  return source;
}

registerMigration({
  id: 'check-type-skill',
  release: '8.1.0',
  covers: [
    'field:Item.skill:checkType', 'field:Item.spell:checkType',
    'field:Item.race:chosenSkills', 'field:Item.race:chosenSpells',
    'field:Item.class:chosenSkills', 'field:Item.class:chosenSpells'
  ],
  documents: { Item: convertItem }
});
