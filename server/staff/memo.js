// The 7:00 a.m. memo. The preview page and the scheduled job both call
// buildMemo, so what staff see in the preview is exactly what gets sent.

const { db }   = require('./db');
const time     = require('./time');
const schedule = require('./schedule');
const { can }  = require('./permissions');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const range = (a, b) => `${time.clock(a)}–${time.clock(b)}`;

const S = {
    wrap:  'font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;max-width:640px;margin:0 auto;padding:16px;',
    h1:    'font-size:20px;margin:0 0 4px;',
    sub:   'color:#6b7280;margin:0 0 16px;',
    h2:    'font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:#374151;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin:20px 0 8px;',
    table: 'border-collapse:collapse;width:100%;',
    td:    'padding:4px 8px 4px 0;vertical-align:top;border-bottom:1px solid #f3f4f6;',
    time:  'padding:4px 8px 4px 0;vertical-align:top;border-bottom:1px solid #f3f4f6;white-space:nowrap;color:#6b7280;',
    hit:   'font-weight:600;color:#b91c1c;',
    muted: 'color:#6b7280;',
    note:  'background:#fef3c7;padding:8px 12px;border-radius:6px;margin:0 0 12px;',
};

function buildMemo(staffId, date) {
    const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId);
    if (!staff) throw new Error(`No staff member ${staffId}`);

    const showStudents = can(staff, 'view_students');
    const today = schedule.buildToday(staff, date, {
        includeStudents: showStudents,
        includeCounts: can(staff, 'view_school_counts'),
    });
    const name = staff.display_name || `${staff.first} ${staff.last}`;
    const subject = `Staff Hub · ${time.dayName(date)} ${date.slice(5).replace('-', '/')} · ${today.dayType.split(' · ')[0]}`;

    const html = [], text = [];
    html.push(`<div style="${S.wrap}">`);
    html.push(`<h1 style="${S.h1}">Good morning, ${esc(staff.first)}.</h1>`);
    html.push(`<p style="${S.sub}">${esc(today.prettyDate)} · ${esc(today.dayType)}</p>`);
    text.push(`Good morning, ${staff.first}.`, `${today.prettyDate} · ${today.dayType}`, '');
    if (today.note) {
        html.push(`<p style="${S.note}">${esc(today.note)}</p>`);
        text.push(`NOTE: ${today.note}`, '');
    }

    if (!today.isSchoolDay) {
        html.push(`<p>No school today.</p>`);
        text.push('No school today.');
    } else {
        // My schedule
        const mine = today.schedule.filter(s => s.section);
        html.push(`<h2 style="${S.h2}">My schedule</h2>`);
        text.push('MY SCHEDULE');
        if (!mine.length) {
            html.push(`<p style="${S.muted}">No classes on your schedule.</p>`);
            text.push('  No classes on your schedule.');
        } else {
            html.push(`<table style="${S.table}">`);
            for (const s of today.schedule) {
                const what = s.section
                    ? `<strong>${esc(s.section.period)}</strong> ${esc(s.section.course_name)} · Rm ${esc(s.section.room || '—')}`
                    : `<span style="${S.muted}">${esc(s.meets)}</span>`;
                html.push(`<tr><td style="${S.time}">${range(s.start, s.end)}</td><td style="${S.td}">${what}</td></tr>`);
                text.push(`  ${range(s.start, s.end)}  ${s.section ? `${s.section.period} ${s.section.course_name} (Rm ${s.section.room || '—'})` : s.meets}`);
            }
            html.push('</table>');
        }
        text.push('');

        // My duties
        html.push(`<h2 style="${S.h2}">My duties</h2>`);
        text.push('MY DUTIES');
        if (!today.duties.length) {
            html.push(`<p style="${S.muted}">None today.</p>`);
            text.push('  None today.');
        } else {
            html.push('<ul style="margin:0;padding-left:20px;">');
            for (const d of today.duties) {
                html.push(`<li>${range(d.start_time, d.end_time)} · ${esc(d.name)} (${esc(d.location)})</li>`);
                text.push(`  ${range(d.start_time, d.end_time)}  ${d.name} (${d.location})`);
            }
            html.push('</ul>');
        }
        text.push('');

        // My students today
        if (showStudents) {
            html.push(`<h2 style="${S.h2}">My students today</h2>`);
            text.push('MY STUDENTS TODAY');
            const groups = today.studentsByPeriod.filter(g => g.students.length);
            if (!groups.length) {
                html.push(`<p style="${S.muted}">Nothing to flag for your classes today.</p>`);
                text.push('  Nothing to flag for your classes today.');
            }
            for (const g of groups) {
                html.push(`<p style="margin:8px 0 2px;"><strong>${esc(g.period)}</strong> <span style="${S.muted}">(${range(g.start, g.end)}) · ${esc(g.course_name)}</span></p>`);
                html.push('<ul style="margin:0;padding-left:20px;">');
                text.push(`  ${g.period} (${range(g.start, g.end)}) ${g.course_name}`);
                for (const st of g.students) {
                    const items = st.items.map(i => i.affects && i.kind !== 'flag'
                        ? `<span style="${S.hit}">${esc(i.text)}</span>`
                        : esc(i.text) + (i.startsToday ? ' <em>(new today)</em>' : '')).join('; ');
                    html.push(`<li>${esc(st.first)} ${esc(st.last)} <span style="${S.muted}">#${esc(st.student_number)}</span> — ${items}</li>`);
                    text.push(`    ${st.first} ${st.last} #${st.student_number} — ${st.items.map(i => i.text + (i.startsToday ? ' (new today)' : '')).join('; ')}`);
                }
                html.push('</ul>');
            }
            text.push('');
        }

        if (today.counts) {
            const c = today.counts;
            html.push(`<h2 style="${S.h2}">School today</h2>`);
            html.push(`<p>ISS: <strong>${c.issToday}</strong> · OSS: <strong>${c.ossToday}</strong> · Trips: <strong>${c.tripsToday}</strong> · Pending approvals: <strong>${c.pendingApprovals}</strong></p>`);
            text.push('SCHOOL TODAY', `  ISS ${c.issToday} · OSS ${c.ossToday} · Trips ${c.tripsToday} · Pending approvals ${c.pendingApprovals}`, '');
        }
    }

    // Events
    html.push(`<h2 style="${S.h2}">Today's events</h2>`);
    text.push("TODAY'S EVENTS");
    if (!today.events.length) {
        html.push(`<p style="${S.muted}">No events.</p>`);
        text.push('  No events.');
    } else {
        html.push('<ul style="margin:0;padding-left:20px;">');
        for (const e of today.events) {
            const when = e.all_day ? 'All day' : range(e.start.slice(11), (e.end || e.start).slice(11));
            html.push(`<li>${when} · ${esc(e.title)}${e.location ? ` <span style="${S.muted}">(${esc(e.location)})</span>` : ''}</li>`);
            text.push(`  ${when}  ${e.title}${e.location ? ` (${e.location})` : ''}`);
        }
        html.push('</ul>');
    }
    text.push('');

    // Placeholder until coverage data exists.
    html.push(`<h2 style="${S.h2}">Coverages &amp; room changes</h2>`);
    html.push(`<p style="${S.muted}">None posted. (Coverage data is not connected yet.)</p>`);
    text.push('COVERAGES & ROOM CHANGES', '  None posted.', '');

    html.push(`<p style="${S.muted};font-size:12px;margin-top:24px;">Sent to ${esc(name)} by Staff Hub. Student details are confidential; do not forward.</p>`);
    html.push('</div>');
    text.push('Student details are confidential; do not forward.');

    return { subject, html: html.join('\n'), text: text.join('\n'), to: staff.email };
}

module.exports = { buildMemo };
