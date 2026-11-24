/**
 * `preUpdateActor`: count every rise of an actor's gold in `system.currency.looted` (the rule lives in
 * `utils/loot/looted-gold.mjs`). It runs on the client that writes, so a rise is counted once, and it adds a key to the
 * update in place. It never returns a value: a pre-hook that returns `false` cancels the update.
 */
import { lootedGoldChange } from '../utils/loot/looted-gold.mjs';
import { isMigrationWrite } from '../documents/migrations/world-migration.mjs';

/** The hook body: merge the count of a gold rise into the update. A migration's write is not loot. */
function onPreUpdateLootedGold(actor, changes, options) {
  if (isMigrationWrite(options)) return;
  const extra = lootedGoldChange(actor, changes);
  if (Object.keys(extra).length) globalThis.foundry.utils.mergeObject(changes, globalThis.foundry.utils.expandObject(extra));
}

export function registerLootedGoldHooks() {
  Hooks.on('preUpdateActor', onPreUpdateLootedGold);
}
