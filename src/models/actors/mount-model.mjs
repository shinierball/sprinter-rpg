import { BaseActorDataModel } from './base-actor-model.mjs';
import { tagQueryField } from '../fields/tag-fields.mjs';
import { getSizeInfo, sizeLabel } from '../../data/sizes.mjs';
import {
  vehicleHealth, vehicleKindInfo, vehicleKindTag, sanitizeVehicleKind, DEFAULT_VEHICLE_KIND, ratedMove
} from '../../data/rules/vehicle-rules.mjs';

/**
 * TypeDataModel for Mounts and Vehicles.
 * Encapsulates structural durability (10 Health Bar slots of `size` HP), carrying capacity (occupants), full Move,
 * natural damage resistance (DR), the kind (which skill drives it), the per-round drive state, and
 * owner/driver/occupant relationships (by actor UUID). A vehicle has no stats, mana, Evade, limbs, level or hotlist.
 */
export class MountVehicleDataModel extends BaseActorDataModel {
  /** @override */
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;

    return {
      tags: BaseActorDataModel.defineTagsField(),
      ownerId: new fields.StringField({ initial: '' }),
      pilotUuid: new fields.StringField({ initial: '' }),
      occupants: new fields.ArrayField(new fields.SchemaField({
        uuid: new fields.StringField({ initial: '' }),
        // A VEHICLE_ROLES id. No `choices`: the registry (CONFIG.COG.vehicleRoles) validates, so a module can add one.
        role: new fields.StringField({ initial: 'passenger' }),
        // Boarded past the seat limit. Derived on the GM, never taken from a client payload.
        ruleBreak: new fields.BooleanField({ initial: false })
      }), { initial: [] }),
      // A CONFIG.COG.vehicleKinds id. No `choices`: the registry validates, so a module can add one.
      kind: new fields.StringField({ initial: DEFAULT_VEHICLE_KIND }),
      // Overrides the kind's skill query (the skill that drives a vehicle is found by tag, never by name).
      operateSkills: tagQueryField(fields, { nullable: true, initial: null }),
      drive: new fields.SchemaField({
        // The speed now, in ft; 0 = stopped
        currentMove: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        // The last Table 6 result, read lazily against the combat round
        result: new fields.SchemaField({
          outcome: new fields.StringField({ initial: '', blank: true }),
          choice: new fields.StringField({ initial: '', blank: true }),
          combatId: new fields.StringField({ initial: '' }),
          round: new fields.NumberField({ integer: true, nullable: true, initial: null }),
          messageId: new fields.StringField({ initial: '' }),
          driverUuid: new fields.StringField({ initial: '' }),
          applied: new fields.SchemaField({
            damage: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
            aiFavor: new fields.NumberField({ integer: true, min: 0, initial: 0 })
          }),
          gm: new fields.BooleanField({ initial: false }),
          ruleBreak: new fields.BooleanField({ initial: false }),
          // When the GM set or cleared the result by hand; a card made before it cannot replace it
          setAt: new fields.NumberField({ integer: true, min: 0, initial: 0 })
        }),
        // Actor uuid owed Advantage on their next operate check
        advantageFor: new fields.StringField({ initial: '' })
      }),
      attributes: new fields.SchemaField({
        // Max, HP per slot and the slot count are derived from the size (10 slots of `size` HP). A null value is full health.
        hp: new fields.SchemaField({
          value: new fields.NumberField({ required: true, nullable: true, integer: true, initial: null }),
          temp: new fields.NumberField({ integer: true, initial: 0 }),
          tempBars: BaseActorDataModel.defineTempBarsField()
        }),
        dr: new fields.SchemaField({
          armor: new fields.NumberField({ integer: true, initial: 2 }),
          items: new fields.NumberField({ integer: true, initial: 0 }),
          buffs: new fields.NumberField({ integer: true, initial: 0 }),
          total: new fields.NumberField({ integer: true, initial: 2 })
        }),
        // Full Move in ft
        move: new fields.NumberField({ integer: true, initial: 40 }),
        size: new fields.StringField({ initial: 'large' }),
        occupancy: new fields.NumberField({ integer: true, min: 0, initial: 4 }),
        cargoOccupancy: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      }),
      details: new fields.SchemaField({
        notes: new fields.StringField({ initial: '' })
      })
    };
  }

  /** @override */
  prepareDerivedData() {
    this.prepareDerivedItemRanks(this.prepareDerivedBaseStats());

    if (this.attributes) {
      const sizeInfo = getSizeInfo(this.attributes.size);
      this.attributes.sizeInfo = sizeInfo;
      this.attributes.sizeNumber = sizeInfo.size;
      this.attributes.sizeLabel = sizeLabel(sizeInfo.id);

      this.kind = sanitizeVehicleKind(this.kind);
      this.attributes.kindInfo = vehicleKindInfo(this.kind);
      if (this.tagSet) {
        this.tagSet.add(vehicleKindTag(this.kind));
        this.allTags = Array.from(this.tagSet);
      }

      const health = vehicleHealth(sizeInfo.size);
      if (this.attributes.hp) {
        this.attributes.hp.max = health.max;
        this.attributes.hp.hpPerBar = health.hpPerBar;
        this.attributes.hp.bars = health.bars;
        const raw = this.attributes.hp.value;
        const hpVal = raw === null || raw === undefined || !Number.isFinite(Number(raw)) ? health.max : Math.max(0, Number(raw));
        this.attributes.hp.value = hpVal;
        this.attributes.hp.pct = Math.min(100, Math.max(0, Math.round((hpVal / health.max) * 100)));
      }

      // The vehicle's own rated Move. The driver's rows are added lazily where a driver is known (vehicleMoveOf).
      this.attributes.speed = { move: ratedMove({ full: this.attributes.move }) };
    }
  }
}
