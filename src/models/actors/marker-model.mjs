/**
 * TypeDataModel for `marker` actors: the minimal actor behind every light token a source actor creates.
 * It has no stats, health or tags. `ownerUuid` is the uuid of the world actor (crawler, pet, mercenary, npc or mob)
 * whose lights these are; one marker exists per source actor (`getOrCreateLightMarker`).
 */
export class MarkerDataModel extends (globalThis.foundry?.abstract?.TypeDataModel || class {}) {
  /** @override */
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ownerUuid: new fields.StringField({ initial: '' })
    };
  }
}
