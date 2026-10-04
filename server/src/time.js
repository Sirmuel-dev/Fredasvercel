const timeZone = process.env.APP_TIMEZONE || 'Europe/Vilnius';

export function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function localWeekday(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(date);
}

export function isSunday(date = new Date()) {
  return localWeekday(date) === 'Sunday';
}

export function currentWeekRange() {
  const now = new Date();
  const dateKey = localDateKey(now);
  const noonUtc = new Date(`${dateKey}T12:00:00Z`);
  const weekdayIndex = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(localWeekday(now));
  const mondayOffset = weekdayIndex === 0 ? -6 : 1 - weekdayIndex;
  const monday = new Date(noonUtc);
  monday.setUTCDate(monday.getUTCDate() + mondayOffset);
  const saturday = new Date(monday);
  saturday.setUTCDate(saturday.getUTCDate() + 5);
  const format = d => d.toISOString().slice(0,10);
  return { start: format(monday), end: format(saturday) };
}

export function nowIso() {
  return new Date().toISOString();
}

export function hoursBetween(startIso, endIso, breakMinutes = 0) {
  if (!startIso || !endIso) return 0;
  const ms = Math.max(0, new Date(endIso) - new Date(startIso) - Number(breakMinutes || 0) * 60000);
  return Number((ms / 3600000).toFixed(2));
}
