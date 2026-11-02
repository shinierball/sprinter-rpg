/** Light movement hooks: following, leash, scene travel. Logic lives in documents/actor/light-follow.mjs. */
import { onLightTokenMove, onLightOwnerTokenCreate } from '../documents/actor/light-follow.mjs';

export function registerLightFollowHooks() {
  Hooks.on('moveToken', onLightTokenMove);
  Hooks.on('createToken', onLightOwnerTokenCreate);
}
