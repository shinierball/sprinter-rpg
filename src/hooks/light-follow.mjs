/** Light movement hooks: following, leash, scene travel. Logic lives in documents/actor/light-follow.mjs. */
import { onLightTokenMove, onLightOwnerTokenCreate } from '../documents/actor/light-follow.mjs';
import { isMigrationWrite } from '../documents/migrations/world-migration.mjs';

export function registerLightFollowHooks() {
  // A migration write that moves a token must not carry its lights along
  Hooks.on('moveToken', (tokenDoc, movement, operation, user) => (isMigrationWrite(operation) ? undefined : onLightTokenMove(tokenDoc, movement, operation, user)));
  Hooks.on('createToken', onLightOwnerTokenCreate);
}
