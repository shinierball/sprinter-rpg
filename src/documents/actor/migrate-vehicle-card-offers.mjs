/**
 * Stored-data migration for vehicle check cards: the degree shifts and the spent row keys a card kept in two flags of its
 * own (`vehicleShifts`, `vehicleUsed`) live on the card's check record now (`check.shifts`, `check.offersUsed`), where every
 * reader of a check card finds them. Registered at import (`vehicle-drive-common.mjs` imports this file).
 */
import { registerMigration } from '../../utils/migrations/registry.mjs';
import { readFlag, withFlags, withoutFlags } from '../../utils/flags.mjs';

const OLD_SHIFTS = 'vehicleShifts';
const OLD_USED = 'vehicleUsed';
const RECORD = 'check';
const MAX_SHIFTS = 10;
const MAX_OFFERS_USED = 20;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A stored shift list as the old flag kept it: plain objects with a row key, `{ rowKey, steps, failOnly }`. */
function shiftsFrom(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => isRecord(s) && typeof s.rowKey === 'string' && s.rowKey)
    .map((s) => ({ rowKey: s.rowKey.slice(0, 200), steps: Math.max(1, Math.trunc(Number(s.steps)) || 1), failOnly: s.failOnly !== false }));
}

registerMigration({
  id: 'vehicle-card-offers-onto-check-record',
  release: '8.1.0',
  covers: [],
  documents: {
    ChatMessage(source) {
      const oldShifts = readFlag(source, OLD_SHIFTS);
      const oldUsed = readFlag(source, OLD_USED);
      if (oldShifts === undefined && oldUsed === undefined) return source;
      const record = readFlag(source, RECORD);
      const bare = withoutFlags(source, [OLD_SHIFTS, OLD_USED]);
      // A card with no check record has nowhere to keep them: they were only read through the record's vehicle reference.
      if (!isRecord(record)) return bare;
      const shifts = [...shiftsFrom(oldShifts), ...shiftsFrom(record.shifts)].slice(0, MAX_SHIFTS);
      const used = [...(Array.isArray(oldUsed) ? oldUsed : []), ...(Array.isArray(record.offersUsed) ? record.offersUsed : [])]
        .filter((key, at, all) => typeof key === 'string' && key && all.indexOf(key) === at)
        .slice(0, MAX_OFFERS_USED);
      return withFlags(bare, { [RECORD]: { ...record, shifts, offersUsed: used } });
    }
  }
});
