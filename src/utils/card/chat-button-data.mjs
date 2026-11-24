/**
 * The `data-*` attributes of a chat card button (patron, worship and vehicle cards). An attribute name sits in a tag, where
 * no escaping makes typed text safe, so a name is never built from a variable: each key a button may carry is a literal
 * here, its value escaped. A key not listed is left out; add it here with the button that needs it.
 */
import { escapeAttr } from '../escape-attr.mjs';

/**
 * One attribute: ` data-<key>="<value>"`.
 * @param {string} key a key the cards use (`'actor-uuid'`)
 * @param {*} value escaped here
 * @returns {string} the attribute with a leading space, or '' for a key not listed
 */
function dataAttrHtml(key, value) {
  const v = escapeAttr(value);
  switch (key) {
    case 'actor-uuid': return ` data-actor-uuid="${v}"`;
    case 'item-id': return ` data-item-id="${v}"`;
    case 'reason': return ` data-reason="${v}"`;
    case 'delta': return ` data-delta="${v}"`;
    case 'table-uuid': return ` data-table-uuid="${v}"`;
    case 'table-name': return ` data-table-name="${v}"`;
    case 'killer-uuid': return ` data-killer-uuid="${v}"`;
    case 'mode': return ` data-mode="${v}"`;
    case 'filter-tag': return ` data-filter-tag="${v}"`;
    case 'vehicle-uuid': return ` data-vehicle-uuid="${v}"`;
    case 'driver-uuid': return ` data-driver-uuid="${v}"`;
    case 'target-dc': return ` data-target-dc="${v}"`;
    case 'condition-tag': return ` data-condition-tag="${v}"`;
    case 'ram': return ` data-ram="${v}"`;
    default: return '';
  }
}

/**
 * The attributes of a button from a `{ key: value }` map; empty, null and undefined values are left out.
 * @param {Record<string, *>} [data]
 * @returns {string} each attribute with a leading space
 */
export function chatButtonDataHtml(data = {}) {
  let html = '';
  for (const [key, value] of Object.entries(data)) {
    if (value === '' || value === undefined || value === null) continue;
    html += dataAttrHtml(key, value);
  }
  return html;
}
