/** Small string pieces the core kinds' compact summaries share. */
export const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
export const typeSuffix = (row) => (row.damageType ? ` ${row.damageType}` : '');
