/** The number inside a draft value: a plain number, or the `value` of the rolled form `{ value, rolled: true, dice }`. */
export function plainValue(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && 'value' in v ? v.value : v;
}
