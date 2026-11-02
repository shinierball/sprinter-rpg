import { BaseActorDataModel } from './base-actor-model.mjs';
import { getSizeInfo, sizeLabel } from '../../data/sizes.mjs';

/**
 * TypeDataModel for Mounts and Vehicles.
 * Encapsulates structural durability (HP), carrying capacity (occupants),
 * movement speed, natural damage resistance (DR), abilities, hotlist, and owner/driver/occupant relationships (by actor UUID).
 */
export class MountVehicleDataModel extends BaseActorDataModel {
  /** @override */
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;

    return {
      tags: BaseActorDataModel.defineTagsField(),
      abilities: BaseActorDataModel.defineAbilitiesField(),
      ownerId: new fields.StringField({ initial: '' }),
      pilotUuid: new fields.StringField({ initial: '' }),
      occupants: new fields.ArrayField(new fields.SchemaField({
        uuid: new fields.StringField({ initial: '' }),
        // A VEHICLE_ROLES id. No `choices`: the registry (CONFIG.COG.vehicleRoles) validates, so a module can add one.
        role: new fields.StringField({ initial: 'passenger' }),
        // Boarded past the seat limit. Derived on the GM, never taken from a client payload.
        ruleBreak: new fields.BooleanField({ initial: false })
      }), { initial: [] }),
      vehicleType: new fields.StringField({ initial: 'Ground' }),
      attributes: new fields.SchemaField({
        hp: new fields.SchemaField({
          value: new fields.NumberField({ required: true, integer: true, initial: 30 }),
          max: new fields.NumberField({ required: true, integer: true, initial: 30 }),
          temp: new fields.NumberField({ integer: true, initial: 0 }),
          pct: new fields.NumberField({ integer: true, initial: 100 }),
          tempBars: BaseActorDataModel.defineTempBarsField()
        }),
        mana: new fields.SchemaField({
          value: new fields.NumberField({ required: true, integer: true, initial: 10 }),
          max: new fields.NumberField({ required: true, integer: true, initial: 10 }),
          pct: new fields.NumberField({ integer: true, initial: 100 })
        }),
        evade: new fields.SchemaField({
          items: new fields.NumberField({ integer: true, initial: 0 }),
          buffs: new fields.NumberField({ integer: true, initial: 0 }),
          total: new fields.NumberField({ integer: true, initial: 4 })
        }),
        dr: new fields.SchemaField({
          armor: new fields.NumberField({ integer: true, initial: 2 }),
          items: new fields.NumberField({ integer: true, initial: 0 }),
          buffs: new fields.NumberField({ integer: true, initial: 0 }),
          total: new fields.NumberField({ integer: true, initial: 2 })
        }),
        move: new fields.NumberField({ integer: true, initial: 40 }),
        speed: new fields.SchemaField({
          move: new fields.NumberField({ integer: true, initial: 40 }),
          step: new fields.NumberField({ integer: true, initial: 10 }),
          climb: new fields.NumberField({ integer: true, initial: 0 }),
          swim: new fields.NumberField({ integer: true, initial: 0 }),
          fly: new fields.NumberField({ integer: true, initial: 0 }),
          burrow: new fields.NumberField({ integer: true, initial: 0 })
        }),
        aiFavor: new fields.NumberField({ integer: true, initial: 0 }),
        debuffs: new fields.StringField({ initial: '' }),
        size: new fields.StringField({ initial: 'large' }),
        occupancy: new fields.NumberField({ integer: true, min: 0, initial: 4 }),
        cargoOccupancy: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        accessories: new fields.StringField({ initial: '' }),
        externalBuffs: new fields.SchemaField({
          buff1: new fields.StringField({ initial: '' }),
          buff2: new fields.StringField({ initial: '' }),
          buff3: new fields.StringField({ initial: '' })
        }),
        limbs: BaseActorDataModel.defineLimbsField()
      }),
      details: new fields.SchemaField({
        level: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
        notes: new fields.HTMLField({ initial: '' }),
        floor: new fields.StringField({ initial: '1st Floor' }),
        bankedGrindHours: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),
      gearSlots: BaseActorDataModel.defineGearSlotsField(),
      currency: BaseActorDataModel.defineCurrencyField(),
      hotlist: new fields.SchemaField({
        slot1: new fields.StringField({ initial: '' }),
        slot2: new fields.StringField({ initial: '' }),
        slot3: new fields.StringField({ initial: '' }),
        slot4: new fields.StringField({ initial: '' }),
        slot5: new fields.StringField({ initial: '' }),
        slot6: new fields.StringField({ initial: '' }),
        slot7: new fields.StringField({ initial: '' }),
        slot8: new fields.StringField({ initial: '' }),
        slot9: new fields.StringField({ initial: '' }),
        slot10: new fields.StringField({ initial: '' })
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

      const hpVal = Number(this.attributes.hp?.value) || 0;
      const hpMax = Number(this.attributes.hp?.max) || 1;
      if (this.attributes.hp) {
        this.attributes.hp.pct = Math.min(100, Math.max(0, Math.round((hpVal / hpMax) * 100)));
      }

      if (this.attributes.move !== undefined && this.attributes.speed) {
        this.attributes.speed.move = this.attributes.move;
      }
    }
  }
}

