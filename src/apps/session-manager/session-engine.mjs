import { sessionStoreMixin } from './session-store.mjs';
import { sessionRosterMixin } from './session-roster.mjs';
import { ledgerRecordMixin } from './ledger-record.mjs';
import { ledgerEditMixin } from './ledger-edit.mjs';
import { sessionProgressionMixin } from './progression.mjs';
import { installSessionRelay } from './session-relay.mjs';

/**
 * Session Progression & Party Ledger Engine
 * Static methods are mixed in from the sibling modules.
 */
export class COGSessionEngine {}

Object.assign(
  COGSessionEngine,
  sessionStoreMixin,
  sessionRosterMixin,
  ledgerRecordMixin,
  ledgerEditMixin,
  sessionProgressionMixin
);

installSessionRelay(COGSessionEngine);
