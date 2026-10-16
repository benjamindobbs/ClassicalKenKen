// Day plans, "my schedule", "my students today" and same-day alert targets.
// Shared by the Today page, the memo and the alert hook so they can't drift.

const { db } = require('./db');
const time   = require('./time');

const FLAG_LABELS = {
    pass_restriction: 'Pass restriction',
    elevator_pass:    'Elevator pass',
    tech_restriction: 'Tech restriction',
    morning_search:   'Morning search',
    accommodation:    'Accommodation',
    has_safety_plan:  'Has safety plan',
    has_iep:          'Has IEP',
    has_504:          'Has 504',
    student_senate:   'Student Senate',
};
const FLAG_TYPES = Object.keys(FLAG_LABELS);

const KIND_LABELS = { regular: '5-day week', early_release: 'Early release', x_day: 'X day' };

function divisionOf(staff) {
    return staff && staff.division === 'MS' ? 'MS' : 'HS';
}

function templateById(id) {
    if (!Number.isInteger(Number(id)) || id == null) return null;
    return db.prepare('SELECT * FROM bell_templates WHERE id = ?').get(Number(id)) || null;
}

function slotsFor(templateId) {
    return db.prepare('SELECT * FROM bell_slots WHERE template_id = ? ORDER BY slot_order').all(templateId);
}

function defaultTemplate(division) {
    return db.prepare("SELECT * FROM bell_templates WHERE division = ? AND kind = 'regular' ORDER BY id LIMIT 1").get(division) || null;
}

// The template's rotation for that weekday, e.g. { "1": "P6", "2": "P1", ... }.
function defaultSlotMap(template, date) {
    if (!template || !template.default_map_json) return {};
    const maps = JSON.parse(template.default_map_json);
    return maps[time.dayKey(date)] || {};
}

function getDayPlan(date, division) {
    const row = db.prepare('SELECT * FROM day_plans WHERE date = ? AND division = ?').get(date, division);
    let template, slotMap, note = null, isSchoolDay;

    if (row) {
        isSchoolDay = !!row.is_school_day;
        note = row.note;
        template = row.template_id ? templateById(row.template_id) : null;
        slotMap = row.slot_map_json ? JSON.parse(row.slot_map_json) : defaultSlotMap(template, date);
    } else {
        // No plan stored: weekdays fall back to the regular rotation.
        isSchoolDay = time.isWeekday(date);
        template = isSchoolDay ? defaultTemplate(division) : null;
        slotMap = defaultSlotMap(template, date);
    }
    if (!isSchoolDay) template = null;

    const slots = template ? slotsFor(template.id).map(s => ({
        order: s.slot_order,
        start: s.start_time,
        end:   s.end_time,
        label: s.label,
        meets: slotMap[String(s.slot_order)] || s.label,
        note:  s.note,
    })) : [];

    let dayType = time.isWeekday(date) ? 'No school' : 'Weekend';
    if (template) dayType = `${KIND_LABELS[template.kind] || template.name} · ${time.dayName(date)}`;

    return {
        date, division, isSchoolDay, note, dayType,
        template: template ? { id: template.id, name: template.name, kind: template.kind } : null,
        slots,
    };
}

// Does a slot whose content is `meets` (e.g. 'P3', 'WIN A') hold this section?
function slotHoldsSection(meets, section) {
    const p = String(section.period);
    return meets === `P${p}` || meets === p;
}

function periodLabel(section) {
    return /^\d+$/.test(String(section.period)) ? `P${section.period}` : String(section.period);
}

function sectionsForTeacher(staffId) {
    return db.prepare('SELECT * FROM sections WHERE teacher_id = ? ORDER BY period').all(staffId);
}

function rosterFor(sectionId, date) {
    return db.prepare(`
        SELECT s.dcid, s.student_number, s.first, s.last, s.grade
        FROM enrollments e JOIN students s ON s.dcid = e.student_dcid
        WHERE e.section_id = ? AND s.active = 1
          AND (e.enrolled_on IS NULL OR e.enrolled_on <= ?)
          AND (e.exited_on  IS NULL OR e.exited_on  >  ?)
        ORDER BY s.last, s.first
    `).all(sectionId, date, date);
}

// '1,2,3' -> 'P1–3'; '1,3' -> 'P1, P3'; 'ALL' -> 'all day'; 'LUNCH' / 'AFTER' for detentions
function formatPeriods(periods) {
    if (!periods || periods === 'ALL') return 'all day';
    if (periods === 'LUNCH') return 'lunch';
    if (periods === 'AFTER') return 'after school';
    const nums = periods.split(',').map(Number).filter(n => n > 0).sort((a, b) => a - b);
    const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    if (nums.length > 1 && contiguous) return `P${nums[0]}–${nums[nums.length - 1]}`;
    return nums.map(n => `P${n}`).join(', ');
}

function serveCoversPeriod(serve, period) {
    if (serve.periods === 'ALL') return true;
    return serve.periods.split(',').map(s => s.trim()).includes(String(period));
}

function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
}

// Everything notable about a set of students on a date, keyed by dcid.
function notesForStudents(dcids, date) {
    const out = new Map();
    if (!dcids.length) return out;
    const ph = dcids.map(() => '?').join(',');
    const push = (dcid, item) => {
        if (!out.has(dcid)) out.set(dcid, []);
        out.get(dcid).push(item);
    };

    for (const f of db.prepare(`
        SELECT * FROM student_flags
        WHERE student_dcid IN (${ph}) AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)
        ORDER BY type
    `).all(...dcids, date, date)) {
        push(f.student_dcid, {
            kind: 'flag', type: f.type, id: f.id,
            text: FLAG_LABELS[f.type] + (f.note ? ` — ${f.note}` : ''),
            startsToday: f.start_date === date,
        });
    }

    for (const s of db.prepare(`
        SELECT * FROM serves
        WHERE student_dcid IN (${ph}) AND status IN ('scheduled', 'served')
          AND serve_date <= ? AND COALESCE(serve_end_date, serve_date) >= ?
    `).all(...dcids, date, date)) {
        const span = s.serve_end_date && s.serve_end_date !== s.serve_date
            ? `through ${s.serve_end_date.slice(5).replace('-', '/')}` : formatPeriods(s.periods);
        push(s.student_dcid, {
            kind: 'serve', id: s.id, sanction: s.sanction, periods: s.periods,
            text: `${s.sanction} (${span})`,
        });
    }

    for (const t of db.prepare(`
        SELECT t.*, a.student_dcid FROM field_trips t JOIN trip_attendees a ON a.trip_id = t.id
        WHERE a.student_dcid IN (${ph}) AND t.date = ? AND t.status IN ('approved', 'changes_pending')
    `).all(...dcids, date)) {
        push(t.student_dcid, {
            kind: 'trip', id: t.id, depart: t.depart_time, ret: t.return_time,
            text: `Field trip: ${t.title} (${time.clock(t.depart_time)}–${time.clock(t.return_time)})`,
        });
    }
    return out;
}

// Mark whether each item matters for this particular slot.
function itemsForSlot(items, section, slot) {
    return items.map(it => {
        let affects = true;
        if (it.kind === 'serve') affects = serveCoversPeriod(it, section.period);
        if (it.kind === 'trip')  affects = !!(it.depart && it.ret) && overlaps(it.depart, it.ret, slot.start, slot.end);
        return { kind: it.kind, text: it.text, affects, startsToday: !!it.startsToday };
    });
}

function dutiesFor(staffId, date, isSchoolDay) {
    if (!isSchoolDay) return [];
    return db.prepare(`
        SELECT d.* FROM duty_slots d JOIN duty_assignments a ON a.duty_slot_id = d.id
        WHERE a.staff_id = ? AND d.week_type = '5-day' AND d.day_key = ?
        ORDER BY d.start_time
    `).all(staffId, time.dayKey(date));
}

function eventsOn(date) {
    return db.prepare(`
        SELECT * FROM calendar_events
        WHERE substr(start, 1, 10) <= ? AND COALESCE(substr(end, 1, 10), substr(start, 1, 10)) >= ?
        ORDER BY all_day DESC, start
    `).all(date, date);
}

function schoolCounts(date) {
    const one = (sql, ...a) => db.prepare(sql).get(...a).n;
    return {
        issToday: one(`SELECT COUNT(*) n FROM serves WHERE sanction = 'ISS' AND status IN ('scheduled','served')
                       AND serve_date <= ? AND COALESCE(serve_end_date, serve_date) >= ?`, date, date),
        ossToday: one(`SELECT COUNT(*) n FROM serves WHERE sanction = 'OSS' AND status IN ('scheduled','served')
                       AND serve_date <= ? AND COALESCE(serve_end_date, serve_date) >= ?`, date, date),
        tripsToday: one(`SELECT COUNT(*) n FROM field_trips WHERE date = ? AND status IN ('approved','changes_pending')`, date),
        pendingApprovals: one(`SELECT COUNT(*) n FROM field_trips WHERE status IN ('pending','changes_pending')`),
        flagsStartingToday: one(`SELECT COUNT(*) n FROM student_flags WHERE start_date = ?`, date),
    };
}

// The whole Today view for one staff member.
function buildToday(staff, date, opts = {}) {
    const division = divisionOf(staff);
    const plan = getDayPlan(date, division);
    const sections = sectionsForTeacher(staff.id);

    const schedule = plan.slots.map(slot => {
        const section = sections.find(s => slotHoldsSection(slot.meets, s)) || null;
        return { ...slot, section: section ? {
            id: section.id, course_name: section.course_name, ps_expression: section.ps_expression,
            period: periodLabel(section), room: section.room,
        } : null };
    });

    const studentsByPeriod = [];
    if (opts.includeStudents !== false) {
        for (const slot of schedule) {
            if (!slot.section) continue;
            const section = sections.find(s => s.id === slot.section.id);
            const roster = rosterFor(section.id, date);
            const notes = notesForStudents(roster.map(r => r.dcid), date);
            const students = roster
                .filter(r => notes.has(r.dcid))
                .map(r => ({ ...r, items: itemsForSlot(notes.get(r.dcid), section, slot) }))
                .sort((a, b) => Number(b.items.some(i => i.affects && i.kind !== 'flag')) - Number(a.items.some(i => i.affects && i.kind !== 'flag')));
            studentsByPeriod.push({
                period: slot.section.period, course_name: section.course_name, room: section.room,
                start: slot.start, end: slot.end, students,
            });
        }
    }

    let nextSchoolDay = null;
    for (let d = time.addDays(date, 1), i = 0; !plan.isSchoolDay && i < 21; d = time.addDays(d, 1), i++) {
        if (getDayPlan(d, division).isSchoolDay) { nextSchoolDay = d; break; }
    }

    return {
        date, prettyDate: time.prettyDate(date), nextSchoolDay,
        dayType: plan.dayType, note: plan.note, isSchoolDay: plan.isSchoolDay,
        division, template: plan.template,
        hasSections: sections.length > 0,
        schedule,
        duties: dutiesFor(staff.id, date, plan.isSchoolDay),
        studentsByPeriod,
        events: eventsOn(date),
        counts: opts.includeCounts ? schoolCounts(date) : null,
    };
}

// Teachers who still see this student later today (slot starts after `now`).
function alertTargets(dcid, date, now) {
    const rows = db.prepare(`
        SELECT sec.*, st.id AS staff_id, st.first, st.last, st.display_name, st.division AS staff_division
        FROM enrollments e
        JOIN sections sec ON sec.id = e.section_id
        JOIN staff st ON st.id = sec.teacher_id AND st.active = 1
        WHERE e.student_dcid = ? AND (e.exited_on IS NULL OR e.exited_on > ?)
    `).all(dcid, date);

    const plans = {};
    const later = new Map();
    const all = new Set();
    for (const r of rows) {
        const plan = plans[r.division] || (plans[r.division] = getDayPlan(date, r.division));
        for (const slot of plan.slots) {
            if (!slotHoldsSection(slot.meets, r)) continue;
            all.add(r.staff_id);
            if (slot.start > now && !later.has(r.staff_id)) {
                later.set(r.staff_id, {
                    staff_id: r.staff_id,
                    name: r.display_name || `${r.first} ${r.last}`,
                    period: periodLabel(r),
                    start: slot.start, end: slot.end,
                });
            }
        }
    }
    return { teachers: [...later.values()], seeingToday: all.size };
}

module.exports = {
    FLAG_LABELS, FLAG_TYPES, KIND_LABELS,
    divisionOf, getDayPlan, defaultSlotMap, templateById, slotsFor,
    sectionsForTeacher, rosterFor, formatPeriods, periodLabel,
    buildToday, alertTargets, eventsOn, schoolCounts, notesForStudents,
};
