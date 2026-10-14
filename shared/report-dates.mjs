const dayMs = 86400000;
export function validDate(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const iso = date => date.toISOString().slice(0, 10);
const dateOf = value => new Date(value + 'T00:00:00Z');
export function nextDate(value) {
  if (!validDate(value)) throw new Error('Invalid date.');
  return iso(new Date(dateOf(value).getTime() + dayMs));
}
export function reportRange(mode, value, end, today) {
  if (mode === 'all') return {};
  if (!validDate(today)) throw new Error('The current date is unavailable. Refresh the page.');
  if (mode === 'month') {
    if (!/^\d{4}-\d{2}$/.test(value) || !validDate(value + '-01')) throw new Error('Choose a month.');
    const first = dateOf(value + '-01');
    const last = new Date(first);
    last.setUTCMonth(last.getUTCMonth() + 1);
    last.setUTCDate(0);
    return {from: iso(first), to: iso(last)};
  }
  if (mode === 'period') {
    if (value === 'this_year') return {from: today.slice(0, 4) + '-01-01', to: today};
    if (value === 'this_month') return {from: today.slice(0, 7) + '-01', to: today};
    const days = {last_7: 7, last_30: 30, last_90: 90}[value];
    if (!days) throw new Error('Choose a time period.');
    return {from: iso(new Date(dateOf(today).getTime() - (days - 1) * dayMs)), to: today};
  }
  if (!validDate(value)) throw new Error('Choose a valid date.');
  if (mode === 'date') return {from: value, to: value};
  if (mode === 'week') {
    const first = dateOf(value);
    first.setUTCDate(first.getUTCDate() - (first.getUTCDay() + 6) % 7);
    return {from: iso(first), to: iso(new Date(first.getTime() + 6 * dayMs))};
  }
  if (mode === 'range') {
    if (!validDate(end)) throw new Error('Choose a valid end date.');
    if (end < value) throw new Error('The end date must be on or after the start date.');
    return {from: value, to: end};
  }
  throw new Error('Choose a time frame.');
}
