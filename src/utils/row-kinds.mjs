/**
 * Row kinds: the public face. The registry and its query API live in `row-kinds/registry.mjs`; each array's core kinds
 * register themselves at import from the file beside it (`row-kinds/<array>.mjs`). The imports below load those files in a
 * fixed order, so the registry is always seeded before engine code reads it. Everything importers need is re-exported here.
 */
export {
  MAX_SNAPSHOT_TEXT, ROW_ARRAYS, ROW_KINDS, warnRowKindOnce, _resetRowKindWarnings, registerRowKind, getRowKind, kindOf, rowKindOf,
  listRowKinds, rowKindErrors, applyRowKind, isNumericRowField, SNAPSHOT_TEXT_LIMIT
} from './row-kinds/registry.mjs';
import './row-kinds/damage.mjs';
import './row-kinds/defense.mjs';
export { addWaivableRollPenalty } from './row-kinds/check.mjs';
import './row-kinds/craft.mjs';
import './row-kinds/craft-space.mjs';
import './row-kinds/vehicle.mjs';
import './row-kinds/descriptors.mjs';
export { tableRowEntry } from './row-kinds/box.mjs';
import './row-kinds/magic.mjs';
import './row-kinds/requirement.mjs';
