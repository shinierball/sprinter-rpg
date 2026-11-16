/**
 * Stored-data migration: `kind.upgrade` left the tag registry. The type tag of a Personal Space upgrade is
 * `kind.space_upgrade`, derived from the item type; release 8.0.0 also stored `kind.upgrade` by hand on the five crafting
 * tables, where nothing ever read it. Registered at import (`tag-catalog.mjs`, which owned the tag, imports this file).
 */
import { registerMigration } from '../utils/migrations/registry.mjs';

const DROPPED_TAG = 'kind.upgrade';

registerMigration({
  id: 'drop-kind-upgrade-tag',
  release: '8.1.0',
  covers: ['tag:kind.upgrade'],
  documents: {
    Item(source) {
      const tags = source?.system?.tags;
      if (!Array.isArray(tags) || !tags.includes(DROPPED_TAG)) return source;
      source.system.tags = tags.filter((tag) => tag !== DROPPED_TAG);
      return source;
    }
  }
});
