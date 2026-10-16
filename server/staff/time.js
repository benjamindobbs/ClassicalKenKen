// School-local date/time helpers. All "today" logic runs in the school's IANA
// zone so DST is handled by Intl rather than a fixed offset.

const TZ = 'America/New_York';
const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function localDate(d = new Date()) { return dateFmt.format(d); }           // 'YYYY-MM-DD'
function localTime(d = new Date()) { return timeFmt.format(d); }           // 'HH:MM'

// Strict: '2026-02-31' is rejected rather than rolled over to March.
function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T12:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

// Calendar arithmetic on date strings; noon UTC keeps us clear of DST edges.
function parse(date) { return new Date(date + 'T12:00:00Z'); }
function addDays(date, n) {
    const d = parse(date);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}
function dayKey(date) { return DAY_KEYS[parse(date).getUTCDay()]; }
function dayName(date) { return DAY_NAMES[parse(date).getUTCDay()]; }
function isWeekday(date) { const k = parse(date).getUTCDay(); return k >= 1 && k <= 5; }

function prettyDate(date) {
    return parse(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// '13:10' -> '1:10'
function clock(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`;
}

module.exports = { TZ, DAY_KEYS, localDate, localTime, isDate, isTime, addDays, dayKey, dayName, isWeekday, prettyDate, clock };
