import { SYSTEM_PATH } from '../constants.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';
import { COGActorSheetV2 } from './base/actor-sheet-v2.mjs';

/**
 * Read-only sheet for `marker` actors. A marker has no stats; the sheet only names the actor whose
 * lights it carries. Core's sheets are unregistered for every type, so a marker needs one or opening it throws.
 */
export class COGMarkerSheet extends COGActorSheetV2 {
  static DEFAULT_OPTIONS = {
    classes: ['marker'],
    position: { width: 340, height: 'auto' }
  };

  static PARTS = {
    body: { template: `${SYSTEM_PATH}/templates/actors/marker.hbs` }
  };

  /** @override */
  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);
    context.lightOwnerName = resolveActorByUuid(this.actor.system?.ownerUuid)?.name ?? '';
    return context;
  }
}
