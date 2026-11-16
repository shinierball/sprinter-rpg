/**
 * Stored-data migration for pets: a pet no longer stores a grind pool (`details.bankedGrindHours`: pets do not grind) or
 * a Floor label (`details.floor`: the Floor is the world's). Registered at import (the pet model imports this file).
 */
import { registerMigration } from '../../utils/migrations/registry.mjs';

const DROPPED_DETAILS = ['bankedGrindHours', 'floor'];

registerMigration({
  id: 'pet-drop-grind-pool-and-floor',
  release: '8.1.0',
  covers: ['field:Actor.pet:details.bankedGrindHours', 'field:Actor.pet:details.floor'],
  documents: {
    Actor(source, ctx) {
      if (ctx?.actorType !== 'pet') return source;
      const details = source?.system?.details;
      if (!details || typeof details !== 'object') return source;
      for (const key of DROPPED_DETAILS) delete details[key];
      return source;
    }
  }
});
