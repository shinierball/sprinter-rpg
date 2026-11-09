/**
 * The drive panel's actions, shared by the vehicle sheet and the crawler's Aboard strip. Each handler runs with `this`
 * bound to the sheet; `resolve(sheet, target)` says which vehicle the control belongs to. The writes themselves live in
 * `vehicle-drive.mjs` (Rule Break confirm for a speed above the Move, the relay for someone who cannot write the vehicle).
 */
import { setVehicleSpeed } from '../../documents/actor/vehicle-move.mjs';
import { rollVehicleCheck } from '../../documents/actor/vehicle-checks.mjs';
import { startVehicleRam } from '../../documents/actor/vehicle-ram.mjs';
import { driverOf } from '../../documents/actor/vehicle-crew.mjs';
import { fireMountedWeapon, shooterFor } from '../../documents/actor/vehicle-weapons.mjs';

/** The kinds of driving check the panel rolls: Drive (Table 6) and Brake. */
const PANEL_CHECK_KINDS = Object.freeze(['performance', 'decelerate']);

const warn = (key, fallback) => globalThis.ui?.notifications?.warn?.(globalThis.game?.i18n?.localize?.(key) ?? fallback);

/** The first targeted token's actor, or null. */
function targetedActor() {
  const token = Array.from(globalThis.game?.user?.targets ?? [])[0];
  return token?.actor ?? null;
}

/**
 * @param {(sheet: object, target: HTMLElement) => Actor|null} resolve the vehicle a control belongs to
 */
export function driveActions(resolve) {
  return {
    /** change: the speed input (unnamed; above this round's Move it asks a Rule Break). */
    async vehicleSetSpeed(event, target) {
      if (!this.isEditable) return;
      const vehicle = resolve(this, target);
      if (!vehicle) return;
      const done = await setVehicleSpeed(vehicle, target.value);
      if (!done) await this.render();
    },

    /** click: a Drive or Brake check, rolled by the vehicle's driver. */
    async vehicleRollCheck(event, target) {
      if (!this.isEditable) return;
      const vehicle = resolve(this, target);
      const kind = target.dataset?.kind;
      if (!vehicle || !PANEL_CHECK_KINDS.includes(kind)) return;
      const driver = driverOf(vehicle);
      if (!driver) return warn('COG.VehicleUI.NoDriver', 'Nobody is driving.');
      return rollVehicleCheck(vehicle, driver, { kind });
    },

    /** click: ram the targeted token. */
    async vehicleRam(event, target) {
      if (!this.isEditable) return;
      const vehicle = resolve(this, target);
      if (!vehicle) return;
      const driver = driverOf(vehicle);
      if (!driver) return warn('COG.VehicleUI.NoDriver', 'Nobody is driving.');
      const victim = targetedActor();
      if (!victim) return warn('COG.VehicleUI.NoRamTarget', 'Target the token to ram first.');
      return startVehicleRam(vehicle, driver, { target: victim, headOn: this._vehicleHeadOn === true });
    },

    /**
     * click: fire a mounted weapon. From the Aboard strip the sheet's own actor fires; from the vehicle sheet the viewer's
     * character if aboard, else the driver. A passenger asks a Rule Break first.
     */
    async vehicleFireWeapon(event, target) {
      if (!this.isEditable) return;
      const vehicle = resolve(this, target);
      const weapon = vehicle?.items?.get(target.dataset?.weaponId);
      if (!vehicle || !weapon) return;
      const shooter = this.actor?.type !== 'mount_vehicle' ? this.actor : shooterFor(vehicle);
      if (!shooter) return warn('COG.VehicleUI.NoShooter', 'Nobody aboard can fire this weapon.');
      return fireMountedWeapon(shooter, vehicle, weapon);
    },

    /** change: the head-on box (unnamed; kept on the sheet, read by the next Ram). */
    vehicleHeadOn(event, target) {
      this._vehicleHeadOn = Boolean(target.checked ?? target.hasAttribute?.('checked'));
    }
  };
}
