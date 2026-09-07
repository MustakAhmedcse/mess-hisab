/**
 * All dates are LOCAL, never UTC. toISOString() would put anything logged
 * between midnight and 6am Bangladesh time (UTC+6) on the previous day.
 */

export function todayISO() {
  return toISO(new Date());
}

export function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function thisMonthISO() {
  return todayISO().slice(0, 7);
}

export function monthOf(dateISO) {
  return String(dateISO || '').slice(0, 7);
}

export function daysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, '0')}`);
}

export function addDays(dateISO, n) {
  const [y, m, d] = dateISO.split('-').map(Number);
  return toISO(new Date(y, m - 1, d + n));
}

/** Days from `from` up to and including `to` (or today, whichever is earlier). */
export function daysBetween(fromISO, toISO_) {
  const out = [];
  let cur = fromISO;
  let guard = 0;
  while (cur <= toISO_ && guard++ < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function monthLabel(monthKey) {
  const names = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const [y, mo] = monthKey.split('-');
  return `${names[Number(mo)] || monthKey} ${y}`;
}

export function dayLabel(dateISO) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const wd = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'][new Date(y, m - 1, d).getDay()];
  return `${d} · ${wd}`;
}
