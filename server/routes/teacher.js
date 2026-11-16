const { Router } = require('express');
const { randomUUID } = require('crypto');
const { db } = require('../db');
const { requireTeacher, verifyTeacherToken } = require('../teacherAuth');
const { firstNameLastInitial, kenkenLeaderboard } = require('../leaderboard');
const Activities = require('../../js/activities');
const { accuracyProgress } = require('../satAccuracy');
// maxDate/minDate/meetingDates/datesBetween/excusedAbsenceDates live in
// wbl/logic.js so the Daily Practice per-day grading below and the Habits of
// Work dispositional average share one definition instead of drifting apart.
const L = require('../wbl/logic');
const { maxDate, minDate, meetingDates } = L;

const router = Router();

const todayStr = () => new Date().toISOString().slice(0, 10);
const isDateStr = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Exchange a short-lived Google access token for a persistent session token
router.post('/login', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });
    const identity = await verifyTeacherToken(token);
    if (!identity) return res.status(403).json({ error: 'Not authorized as teacher' });
    const sessionToken = randomUUID();
    db.prepare('INSERT INTO teacher_sessions(token, user_key, created_at, last_seen) VALUES(?, ?, ?, ?)')
        .run(sessionToken, identity.teacherKey, Date.now(), Date.now());
    res.json({ sessionToken });
});

router.post('/logout', requireTeacher, (req, res) => {
    const token = (req.headers['authorization'] || '').slice(7);
    db.prepare('DELETE FROM teacher_sessions WHERE token = ?').run(token);
    res.json({ ok: true });
});

router.get('/check', requireTeacher, (req, res) => res.json({ ok: true, teacherKey: req.teacherKey }));

// ── Teacher profile ───────────────────────────────────────────────────────────
router.get('/profile', requireTeacher, (req, res) => {
    const row = db.prepare('SELECT name FROM teacher_profile WHERE teacher_key = ?').get(req.teacherKey);
    res.json({ name: row ? row.name : '' });
});

router.post('/profile', requireTeacher, (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    db.prepare('INSERT OR REPLACE INTO teacher_profile(teacher_key, name) VALUES(?, ?)').run(req.teacherKey, name.trim());
    res.json({ ok: true });
});

// ── Gradebook settings ────────────────────────────────────────────────────────
const GS_DEFAULTS = {
    assignment_max_score: 100, completion_score_pct: 100, no_submission_score_pct: 0,
    // Must mirror the ALTER TABLE defaults in db.js, or a teacher with no saved
    // row sees different values than one who has saved once.
    wbl_credential_max_score: 50, wbl_holistic_max_score: 20, wbl_transfer_max_score: 10
};

const GS_WBL_FIELDS = ['wbl_credential_max_score', 'wbl_holistic_max_score', 'wbl_transfer_max_score'];

router.get('/gradebook-settings', requireTeacher, (req, res) => {
    const row = db.prepare('SELECT * FROM gradebook_settings WHERE teacher_key = ?').get(req.teacherKey);
    res.json(row ?? GS_DEFAULTS);
});

router.post('/gradebook-settings', requireTeacher, (req, res) => {
    const { assignment_max_score, completion_score_pct, no_submission_score_pct } = req.body;
    if ([assignment_max_score, completion_score_pct, no_submission_score_pct].some(v => v == null || isNaN(Number(v))))
        return res.status(400).json({ error: 'All numeric fields are required' });
    // Upsert rather than INSERT OR REPLACE: REPLACE deletes the row first, which
    // would reset every column this statement does not name — silently wiping
    // the teacher's WBL point values each time they saved this form.
    db.prepare(`
        INSERT INTO gradebook_settings(
            teacher_key, assignment_max_score, completion_score_pct, no_submission_score_pct
        ) VALUES(?, ?, ?, ?)
        ON CONFLICT(teacher_key) DO UPDATE SET
            assignment_max_score    = excluded.assignment_max_score,
            completion_score_pct    = excluded.completion_score_pct,
            no_submission_score_pct = excluded.no_submission_score_pct
    `).run(
        req.teacherKey,
        Number(assignment_max_score), Number(completion_score_pct), Number(no_submission_score_pct)
    );

    // WBL point values are optional here, so the existing form can keep posting
    // exactly what it posts today without clearing them.
    const wbl = GS_WBL_FIELDS.filter(k => k in req.body && !isNaN(Number(req.body[k])));
    if (wbl.length) {
        db.prepare(`UPDATE gradebook_settings SET ${wbl.map(k => `${k} = ?`).join(', ')} WHERE teacher_key = ?`)
            .run(...wbl.map(k => Number(req.body[k])), req.teacherKey);
    }
    res.json({ ok: true });
});

// ── Assignment settings ───────────────────────────────────────────────────────
// required_activity is a comma list of activity keys (or a legacy combo name) —
// see js/activities.js.

// ── Classes ───────────────────────────────────────────────────────────────────
router.get('/classes', requireTeacher, (req, res) => {
    const rows = db.prepare(`
        SELECT c.id, c.name, c.created_at, c.ps_section_id, c.assessment_type,
               COUNT(cs.id)       AS student_count,
               COUNT(cs.user_key) AS linked_count
        FROM classes c
        LEFT JOIN class_students cs ON cs.class_id = c.id
        WHERE c.teacher_key = ?
        GROUP BY c.id
        ORDER BY c.created_at DESC
    `).all(req.teacherKey);
    res.json(rows);
});

router.post('/classes', requireTeacher, (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    const result = db.prepare(
        'INSERT INTO classes(teacher_key, name, created_at) VALUES(?, ?, ?)'
    ).run(req.teacherKey, name.trim(), Date.now());
    res.json({ id: result.lastInsertRowid, name: name.trim(), student_count: 0, linked_count: 0 });
});

// Import a PS roster as a new class in one shot (used by Chrome extension)
router.post('/classes/import-roster', requireTeacher, (req, res) => {
    const { name, ps_section_id, students } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    if (!ps_section_id)                    return res.status(400).json({ error: 'ps_section_id required' });
    if (!Array.isArray(students))          return res.status(400).json({ error: 'students array required' });

    const result = db.prepare(
        'INSERT INTO classes(teacher_key, name, ps_section_id, created_at) VALUES(?, ?, ?, ?)'
    ).run(req.teacherKey, name.trim(), String(ps_section_id), Date.now());

    const classId = result.lastInsertRowid;
    const insert  = db.prepare(
        'INSERT OR IGNORE INTO class_students(class_id, student_id, student_name, ps_dcid) VALUES(?, ?, ?, ?)'
    );
    let added = 0;
    for (const s of students) {
        if (!s.student_id || !s.student_name) continue;
        const r = insert.run(classId, String(s.student_id).trim(), String(s.student_name).trim(), s.ps_dcid ? String(s.ps_dcid) : null);
        added += r.changes;
    }
    res.json({ id: classId, name: name.trim(), ps_section_id: String(ps_section_id), student_count: added });
});

// Reconcile an already-imported roster against a fresh PowerSchool pull (used by
// the Chrome extension's "Re-sync Roster" flow). Non-destructive: students who
// have left the PS section are soft-withdrawn (exited_on set, every row and all
// history kept), and a student who reappears is reactivated. New arrivals are
// stamped with the PS section entry date when the extension can read it, else
// today — which is what lets GET /grades prorate their do-now score.
router.post('/classes/:id/sync-roster', requireTeacher, (req, res) => {
    const classId = Number(req.params.id);
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?')
        .get(classId, req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Not found' });

    const { students } = req.body;
    if (!Array.isArray(students)) return res.status(400).json({ error: 'students array required' });

    // Raw trimmed IDs, matching import-roster and the UNIQUE(class_id, student_id)
    // rows already on disk — normalization happens in the WBL layer, not here.
    const incoming = new Map();
    for (const s of students) {
        if (!s || !s.student_id || !s.student_name) continue;
        incoming.set(String(s.student_id).trim(), {
            name:    String(s.student_name).trim(),
            ps_dcid: s.ps_dcid ? String(s.ps_dcid) : null,
            entry:   isDateStr(s.entry_date) ? s.entry_date : null,
        });
    }

    const existing = new Map(
        db.prepare('SELECT student_id, student_name, ps_dcid, exited_on, enrolled_on FROM class_students WHERE class_id = ?')
          .all(classId).map(r => [r.student_id, r])
    );

    const today = todayStr();
    const insert = db.prepare(
        'INSERT OR IGNORE INTO class_students(class_id, student_id, student_name, ps_dcid, enrolled_on) VALUES(?, ?, ?, ?, ?)'
    );
    const reactivate = db.prepare(`
        UPDATE class_students
        SET exited_on = NULL, exit_reason = '', student_name = ?, ps_dcid = COALESCE(?, ps_dcid),
            enrolled_on = COALESCE(?, enrolled_on)
        WHERE class_id = ? AND student_id = ?
    `);
    const touch = db.prepare(
        'UPDATE class_students SET student_name = ?, ps_dcid = COALESCE(?, ps_dcid) WHERE class_id = ? AND student_id = ?'
    );
    const withdraw = db.prepare(`
        UPDATE class_students SET exited_on = ?, exit_reason = 'not on PS roster'
        WHERE class_id = ? AND student_id = ? AND exited_on IS NULL
    `);

    const added = [], reactivated = [], withdrawn = [];
    let unchanged = 0;

    db.exec('BEGIN');
    try {
        for (const [sid, s] of incoming) {
            const prev = existing.get(sid);
            if (!prev) {
                insert.run(classId, sid, s.name, s.ps_dcid, s.entry || today);
                added.push(s.name);
            } else if (prev.exited_on) {
                reactivate.run(s.name, s.ps_dcid, s.entry, classId, sid);
                reactivated.push(s.name);
            } else {
                touch.run(s.name, s.ps_dcid, classId, sid);
                unchanged++;
            }
        }
        for (const [sid, r] of existing) {
            if (incoming.has(sid) || r.exited_on) continue;
            withdraw.run(today, classId, sid);
            withdrawn.push(r.student_name);
        }
        db.exec('COMMIT');
    } catch (e) {
        db.exec('ROLLBACK');
        return res.status(400).json({ error: e.message });
    }

    res.json({ ok: true, added, reactivated, withdrawn, unchanged });
});

router.delete('/classes/:id', requireTeacher, (req, res) => {
    db.prepare('DELETE FROM classes WHERE id = ? AND teacher_key = ?').run(Number(req.params.id), req.teacherKey);
    res.json({ ok: true });
});

// PATCH /api/teacher/classes/:id  { name?, assessment_type? }
const VALID_ASSESSMENT_TYPES = new Set(['sat', 'psat-nmsqt', 'psat89']);
router.patch('/classes/:id', requireTeacher, (req, res) => {
    const classId = Number(req.params.id);
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?')
        .get(classId, req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Not found' });

    const updates = [];
    const params  = [];

    if (req.body.name != null) {
        if (!String(req.body.name).trim()) return res.status(400).json({ error: 'name cannot be empty' });
        updates.push('name = ?');
        params.push(String(req.body.name).trim());
    }
    if (req.body.assessment_type != null) {
        if (!VALID_ASSESSMENT_TYPES.has(req.body.assessment_type))
            return res.status(400).json({ error: 'invalid assessment_type' });
        updates.push('assessment_type = ?');
        params.push(req.body.assessment_type);
    }
    for (const field of ['sat_english_domains', 'sat_math_domains']) {
        if (req.body[field] !== undefined) {
            const raw = req.body[field];
            let stored = null;
            if (raw !== null) {
                const indices = Array.isArray(raw) ? raw : String(raw).split(',');
                const valid   = indices.map(Number).filter(n => [0,1,2,3].includes(n));
                stored = valid.length > 0 && valid.length < 4 ? valid.sort((a,b) => a-b).join(',') : null;
            }
            updates.push(`${field} = ?`);
            params.push(stored);
        }
    }
    if (req.body.required_activity != null) {
        if (!Activities.isValid(req.body.required_activity))
            return res.status(400).json({ error: 'invalid required_activity' });
        updates.push('required_activity = ?');
        params.push(req.body.required_activity);
    }
    for (const field of [...Activities.ACTIVITIES.map(a => a.countField), 'sat_accuracy_window']) {
        if (req.body[field] != null) {
            updates.push(`${field} = ?`);
            params.push(Math.max(1, Math.round(Number(req.body[field])) || 1));
        }
    }
    if (req.body.sat_requirement_mode != null) {
        if (!['correct', 'accuracy'].includes(req.body.sat_requirement_mode))
            return res.status(400).json({ error: 'invalid sat_requirement_mode' });
        updates.push('sat_requirement_mode = ?');
        params.push(req.body.sat_requirement_mode);
    }
    if (req.body.sat_accuracy_pct != null) {
        const pct = Math.round(Number(req.body.sat_accuracy_pct));
        if (!(pct >= 1 && pct <= 100))
            return res.status(400).json({ error: 'sat_accuracy_pct must be 1-100' });
        updates.push('sat_accuracy_pct = ?');
        params.push(pct);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    params.push(classId, req.teacherKey);
    db.prepare(`UPDATE classes SET ${updates.join(', ')} WHERE id = ? AND teacher_key = ?`).run(...params);
    res.json({ ok: true });
});

// Link unlinked roster students to matching app accounts by student_id = user_key
router.post('/classes/:id/auto-link', requireTeacher, (req, res) => {
    const classId = Number(req.params.id);
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?')
        .get(classId, req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const result = db.prepare(`
        UPDATE class_students SET user_key = student_id
        WHERE class_id = ? AND user_key IS NULL
        AND student_id IN (SELECT user_key FROM users)
    `).run(classId);

    res.json({ ok: true, linked: result.changes });
});

router.get('/classes/:id', requireTeacher, (req, res) => {
    const cls = db.prepare(
        'SELECT * FROM classes WHERE id = ? AND teacher_key = ?'
    ).get(Number(req.params.id), req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Not found' });
    const students = db.prepare(
        'SELECT * FROM class_students WHERE class_id = ? ORDER BY student_name'
    ).all(Number(req.params.id));
    // Linked to a WBL program? The Habits of Work (Do Now / Exit Slip) flow is
    // for non-WBL classes only; the teacher UI keys its panel off this.
    const wblLinked = !!db.prepare('SELECT 1 FROM wbl_class_programs WHERE class_id = ?')
        .get(Number(req.params.id));
    res.json({ ...cls, students, wbl_linked: wblLinked });
});

router.post('/classes/:id/students', requireTeacher, (req, res) => {
    const classId = Number(req.params.id);
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?').get(classId, req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Not found' });
    const { students } = req.body;
    if (!Array.isArray(students)) return res.status(400).json({ error: 'students array required' });
    const insert = db.prepare(
        'INSERT OR IGNORE INTO class_students(class_id, student_id, student_name) VALUES(?, ?, ?)'
    );
    let added = 0;
    for (const s of students) {
        if (!s.student_id || !s.student_name) continue;
        const r = insert.run(classId, String(s.student_id).trim(), String(s.student_name).trim());
        added += r.changes;
    }
    res.json({ added });
});

router.patch('/classes/:classId/students/:studentId', requireTeacher, (req, res) => {
    const classId = Number(req.params.classId);
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?').get(classId, req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Not found' });
    const row = db.prepare('SELECT student_id FROM class_students WHERE class_id = ? AND student_id = ?')
        .get(classId, req.params.studentId);
    if (!row) return res.status(404).json({ error: 'Student not found' });

    const updates = [];
    const params  = [];

    if ('user_key' in req.body) {
        updates.push('user_key = ?');
        params.push(req.body.user_key || null);
    }
    // enrolled_on / exited_on: a YYYY-MM-DD string sets the date, null clears it.
    // Clearing exited_on is how the portal reactivates a withdrawn student.
    for (const field of ['enrolled_on', 'exited_on']) {
        if (!(field in req.body)) continue;
        const v = req.body[field];
        if (v !== null && !isDateStr(v))
            return res.status(400).json({ error: `${field} must be YYYY-MM-DD or null` });
        updates.push(`${field} = ?`);
        params.push(v);
        if (field === 'exited_on' && v === null) updates.push("exit_reason = ''");
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    params.push(classId, req.params.studentId);
    db.prepare(`UPDATE class_students SET ${updates.join(', ')} WHERE class_id = ? AND student_id = ?`)
        .run(...params);
    res.json({ ok: true });
});

router.delete('/classes/:classId/students/:studentId', requireTeacher, (req, res) => {
    const classId = Number(req.params.classId);
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?').get(classId, req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM class_students WHERE class_id = ? AND student_id = ?')
        .run(classId, req.params.studentId);
    res.json({ ok: true });
});

// ── Clear user data ───────────────────────────────────────────────────────────
router.delete('/users/:userKey', requireTeacher, (req, res) => {
    const { userKey } = req.params;
    db.prepare('DELETE FROM kenken_scores WHERE user_key = ?').run(userKey);
    db.prepare('DELETE FROM sat_scores WHERE user_key = ?').run(userKey);
    db.prepare('DELETE FROM sat_math_scores WHERE user_key = ?').run(userKey);
    db.prepare('DELETE FROM measurement_scores WHERE user_key = ?').run(userKey);
    db.prepare('DELETE FROM measurement_progress WHERE user_key = ?').run(userKey);
    db.prepare('DELETE FROM projection_scores WHERE user_key = ?').run(userKey);
    db.prepare('DELETE FROM projection_progress WHERE user_key = ?').run(userKey);
    db.prepare('DELETE FROM projection_problems WHERE user_key = ?').run(userKey);
    db.prepare('DELETE FROM sessions WHERE user_key = ?').run(userKey);
    db.prepare('UPDATE class_students SET user_key = NULL WHERE user_key = ?').run(userKey);
    db.prepare('DELETE FROM users WHERE user_key = ?').run(userKey);
    res.json({ ok: true });
});

// ── Computed grades for a class + date range (used by Chrome extension) ───────
// Everything a class's grade run needs that doesn't vary per student.
function gradeContext(cls, teacherKey, start, end) {
    const settings = db.prepare('SELECT * FROM gradebook_settings WHERE teacher_key = ?')
        .get(teacherKey)
        ?? { assignment_max_score: 100, completion_score_pct: 100, no_submission_score_pct: 0 };
    // Requirements are per-class now — cls already carries them.
    const asgn = cls;
    const reqSet = Activities.parse(asgn.required_activity);
    return {
        cid: cls.id, asgn, settings, start, end, reqSet,
        maxScore:   settings.assignment_max_score,
        noSubGrade: Math.round(settings.assignment_max_score * settings.no_submission_score_pct / 100),
        either:     Activities.isEither(asgn.required_activity),
        reqCount:   key => asgn[Activities.ACTIVITIES.find(a => a.key === key).countField] ?? 1,
        // In SAT accuracy mode an SAT activity's day is met via server/satAccuracy.js
        // (correct count AND recent accuracy), not by the correct count alone.
        accuracyKeys: [...reqSet].filter(key => Activities.usesAccuracy(asgn, key)),
        // Meeting-day calendar for this class, when PS attendance has been pulled
        // for it (server/wbl/logic.js:meetingDates — dates only ever exist there
        // for days PS actually held class). Falls back to every calendar day in a
        // student's own enrolled window when nothing's been pulled yet — so this
        // is safe for every class regardless of attendance-pull history.
        meetDates: meetingDates(cls.id, start, end),
    };
}

// Group-by-day bucketing in SQL, using the same UTC-midnight day boundary
// /daily-progress uses for "today" — one query per activity, not one per
// date. SQLite's integer '/' truncates ms to whole seconds for unixepoch.
const dayCol = "strftime('%Y-%m-%d', submitted_at / 1000, 'unixepoch')";

// Per-activity score tables and the condition a row must meet to count.
// SAT/SAT-Math/Ruler/Projections only count correct answers — matches
// /daily-progress; KenKen counts games at or above the student's all-time average.
const GRADE_TABLES = {
    'kenken':      { table: 'kenken_scores',      qualifies: 'score >= ?' },
    'sat':         { table: 'sat_scores',         qualifies: 'correct = 1' },
    'sat-math':    { table: 'sat_math_scores',    qualifies: 'correct = 1' },
    'measurement': { table: 'measurement_scores', qualifies: 'correct = 1' },
    'projection':  { table: 'projection_scores',  qualifies: 'correct = 1' },
};

// One student's Daily Practice grade over ctx's window. required_*_count on
// `classes` are PER-DAY requirements — same ones /daily-progress checks against
// "today" (server/routes/student.js) — so this grades each day in range
// independently and averages the results. A day is dropped from the average
// entirely (not zero-filled) when it's outside the student's enrollment span
// or their PS attendance code excuses it (L.excusedAbsenceDates).
//
// With `trace`, also returns a `trace` object explaining every calendar day in
// the requested window — what GET /grades/debug serves. Same code path as the
// real grade, so the debug view can never disagree with what gets synced.
function gradeStudent(ctx, student, trace = false) {
    const { cid, asgn, settings, start, end, reqSet, maxScore, noSubGrade, either, reqCount, accuracyKeys, meetDates } = ctx;
    const base = {
        student_id: student.student_id, student_name: student.student_name,
        enrolled_on: student.enrolled_on, exited_on: student.exited_on,
    };
    const tr = trace ? {
        window: { start, end, eff_start: null, eff_end: null },
        calendar_source: meetDates.length ? 'attendance' : 'calendar-fallback',
        linked: !!student.user_key,
        days: [], notes: [],
    } : null;
    const withTrace = r => (tr ? { ...r, trace: tr } : r);

    // Clamp the grading window to the student's enrollment span. enrolled_on
    // NULL means "enrolled since before we tracked dates" → whole window.
    const effStart = maxDate(start, student.enrolled_on || start);
    const effEnd   = minDate(end,   student.exited_on   || end);
    if (tr) { tr.window.eff_start = effStart; tr.window.eff_end = effEnd; }

    if (effStart > effEnd) {
        // Enrollment span doesn't overlap the window — exempt entirely.
        // The extension skips students whose grade is null.
        if (tr) tr.notes.push('Enrollment span does not overlap this window — student is exempt (no grade synced).');
        return withTrace({ ...base, grade: null, exempt: true });
    }

    if (!student.user_key) {
        if (tr) tr.notes.push(`Roster row is not linked to an app account — every student in this state gets the no-submission grade (${noSubGrade}) regardless of work done.`);
        return withTrace({ ...base, grade: noSubGrade, unlinked: true });
    }

    // A real partial-enrollment sub-window should never be skipped just
    // because attendance happens to carry no rows in that narrow slice —
    // fall back to every calendar day in it when that happens, even
    // though meetDates above is meeting-day based for the full window.
    let studentDates = meetDates.filter(d => d >= effStart && d <= effEnd);
    const usedFallback = !studentDates.length;
    if (usedFallback) studentDates = L.datesBetween(effStart, effEnd);
    // Class-wide "nothing synced" is reported by attendanceCoverage; this note
    // is only for the narrower case of a student's enrolled slice having none.
    if (tr && usedFallback) {
        tr.calendar_source = 'calendar-fallback';
        if (meetDates.length)
            tr.notes.push("No PowerSchool attendance falls inside this student's enrolled dates — every calendar day (weekends included) in that span is graded.");
    }

    const attendance   = L.attendanceDetail(cid, student.student_id, effStart, effEnd);
    const exemptDates  = L.excusedAbsenceDates(cid, student.student_id, effStart, effEnd);
    const countedDates = studentDates.filter(d => !exemptDates.has(d));
    // All excused: nothing to grade, so skip the queries unless tracing.
    if (!countedDates.length && !tr)
        return { ...base, grade: null, exempt: true, days_excused: studentDates.length };

    const sMs = new Date(effStart + 'T00:00:00').getTime();
    const eMs = new Date(effEnd   + 'T23:59:59').getTime();

    // All-time average determines qualifying threshold for KenKen submissions
    const avgRow    = db.prepare('SELECT AVG(score) AS avg FROM kenken_scores WHERE user_key = ?').get(student.user_key);
    const threshold = avgRow?.avg ?? 0;
    const qualArgs  = key => (key === 'kenken' ? [threshold] : []);

    // Only submissions attributed to this class count toward its grade.
    // Pre-feature rows for single-class students were backfilled (server/db.js);
    // genuinely multi-class students' historical rows stay NULL and don't count.
    const byDay = {};
    for (const [key, t] of Object.entries(GRADE_TABLES)) {
        byDay[key] = new Map(db.prepare(`
            SELECT ${dayCol} AS day, COUNT(*) AS cnt FROM ${t.table}
            WHERE user_key = ? AND submitted_at >= ? AND submitted_at <= ? AND ${t.qualifies} AND class_id = ?
            GROUP BY day
        `).all(student.user_key, sMs, eMs, ...qualArgs(key), cid).map(r => [r.day, r.cnt]));
    }

    // SAT accuracy mode needs each day's full answer sequence, not a
    // count of correct ones (server/satAccuracy.js) — same as /daily-progress.
    const answersByDay = table => {
        const m = new Map();
        for (const r of db.prepare(`
            SELECT ${dayCol} AS day, correct FROM ${table}
            WHERE user_key = ? AND submitted_at >= ? AND submitted_at <= ? AND class_id = ?
            ORDER BY submitted_at, id
        `).all(student.user_key, sMs, eMs, cid)) {
            if (!m.has(r.day)) m.set(r.day, []);
            m.get(r.day).push(r.correct);
        }
        return m;
    };
    const accuracyAnswers = {};
    for (const key of accuracyKeys) accuracyAnswers[key] = answersByDay(GRADE_TABLES[key].table);

    // One graded day → { done, dayRequired, dayActual, dayGrade, rule }.
    const gradeDay = date => {
        const done = {};
        for (const key of Object.keys(GRADE_TABLES)) done[key] = byDay[key].get(date) ?? 0;
        const raw = { ...done };

        // Accuracy-mode SAT activities contribute their progress fraction
        // scaled to the correct count, so they pool with the rest below on
        // the same "units done vs. units required" footing.
        for (const key of accuracyKeys) {
            const need = reqCount(key);
            done[key] = need * accuracyProgress(accuracyAnswers[key].get(date) ?? [], need,
                asgn.sat_accuracy_window, asgn.sat_accuracy_pct).fraction;
        }

        // Required activities pool together: the day's requirement is the
        // sum of their counts, met by the sum of their completions.
        // Legacy 'either' is KenKen OR SAT English, whichever is higher.
        let dayRequired = 0, dayActual = 0;
        if (either) {
            dayRequired = Math.max(reqCount('kenken'), reqCount('sat'));
            dayActual   = Math.max(done.kenken, done.sat);
        } else {
            for (const key of reqSet) { dayRequired += reqCount(key); dayActual += done[key]; }
        }

        // completion_score_pct floors a PARTIAL day (some, not all, of the
        // requirement done); no_submission_score_pct floors a day with
        // nothing submitted at all; meeting/exceeding the requirement is
        // simply full credit for that day.
        let dayGrade, rule;
        if (dayActual === 0) {
            dayGrade = noSubGrade; rule = 'none';
        } else if (dayActual < dayRequired) {
            const ratio = Math.round((dayActual / dayRequired) * maxScore);
            const floor = Math.round(maxScore * settings.completion_score_pct / 100);
            dayGrade = Math.max(ratio, floor); rule = ratio >= floor ? 'partial-ratio' : 'partial-floor';
        } else {
            dayGrade = maxScore; rule = 'full';
        }
        return { done, raw, dayRequired, dayActual, dayGrade: Math.min(dayGrade, maxScore), rule };
    };

    const totals = Object.fromEntries(Object.keys(GRADE_TABLES).map(k => [k, 0]));
    const dayGrades = [];
    const graded = new Map();
    for (const date of countedDates) {
        const g = gradeDay(date);
        for (const k of Object.keys(totals)) totals[k] += g.raw[k];
        dayGrades.push(g.dayGrade);
        graded.set(date, g);
    }

    const grade = dayGrades.length
        ? Math.min(maxScore, Math.round(dayGrades.reduce((a, b) => a + b, 0) / dayGrades.length))
        : null;

    if (tr) fillTrace(tr, ctx, student, {
        effStart, effEnd, studentDates, attendance, exemptDates, graded, threshold,
        dayGrades, grade,
    });

    if (!countedDates.length) {
        // Every day in this student's window was excused — nothing to
        // grade. Same "extension skips null" convention as above.
        if (tr) tr.notes.push('Every day in the window was excused — student is exempt (no grade synced).');
        return withTrace({ ...base, grade: null, exempt: true, days_excused: studentDates.length });
    }

    return withTrace({
        ...base,
        grade,
        kenken_count:      totals.kenken,
        sat_count:         totals.sat,
        sat_math_count:    totals['sat-math'],
        measurement_count: totals.measurement,
        projection_count:  totals.projection,
        days_counted:      countedDates.length,
        days_excused:      studentDates.length - countedDates.length,
    });
}

// Debug-only: lay out every calendar day in the requested window with its
// status, plus the submissions that DIDN'T count and why (wrong class, below
// the KenKen threshold, incorrect answers, or landing on an ungraded day).
function fillTrace(tr, ctx, student, s) {
    const { cid, start, end, reqSet, either, reqCount, accuracyKeys, maxScore, settings, asgn } = ctx;
    const required = either ? ['kenken', 'sat'] : [...reqSet];
    tr.required = required.map(key => ({
        key, label: Activities.ACTIVITIES.find(a => a.key === key).label,
        per_day: reqCount(key), accuracy_mode: accuracyKeys.includes(key),
    }));
    tr.either = either;
    tr.settings = {
        max_score: maxScore,
        completion_score_pct: settings.completion_score_pct,
        no_submission_score_pct: settings.no_submission_score_pct,
        sat_accuracy_window: asgn.sat_accuracy_window, sat_accuracy_pct: asgn.sat_accuracy_pct,
    };
    tr.kenken_threshold = Math.round(s.threshold * 10) / 10;

    // Every submission across the whole requested window, any class, bucketed
    // by UTC day, split into counts that qualified for THIS class vs. not.
    const sMs = new Date(start + 'T00:00:00').getTime();
    const eMs = new Date(end   + 'T23:59:59').getTime();
    const all = {};   // day -> key -> { qualifying, other_class, not_qualifying }
    for (const [key, t] of Object.entries(GRADE_TABLES)) {
        const rows = db.prepare(`
            SELECT ${dayCol} AS day,
                   SUM(class_id = ? AND ${t.qualifies})                         AS qualifying,
                   SUM(class_id IS NULL OR class_id != ?)                       AS other_class,
                   SUM(class_id = ? AND NOT (${t.qualifies}))                   AS not_qualifying
            FROM ${t.table}
            WHERE user_key = ? AND submitted_at >= ? AND submitted_at <= ?
            GROUP BY day
        `).all(cid, ...(key === 'kenken' ? [s.threshold] : []), cid, cid,
               ...(key === 'kenken' ? [s.threshold] : []), student.user_key, sMs, eMs);
        for (const r of rows) {
            (all[r.day] ??= {})[key] = {
                qualifying: r.qualifying || 0, other_class: r.other_class || 0, not_qualifying: r.not_qualifying || 0,
            };
        }
    }

    const inSchedule = new Set(s.studentDates);
    const attendanceAll = L.attendanceDetail(cid, student.student_id, start, end);
    const workSummary = d => all[d] || {};

    let missedWork = 0, otherClassDays = 0;
    for (const date of L.datesBetween(start, end)) {
        const att = attendanceAll.get(date) || null;
        const day = { date, attendance: att, work: workSummary(date) };
        if (date < s.effStart || date > s.effEnd) {
            day.status = 'not-enrolled';
            day.why = date < s.effStart ? `before enrollment (${student.enrolled_on})` : `after withdrawal (${student.exited_on})`;
        } else if (!inSchedule.has(date)) {
            day.status = 'no-class';
            day.why = 'not a meeting day (no PS attendance for anyone in the class)';
        } else if (s.exemptDates.has(date)) {
            day.status = 'excused';
            day.why = att?.reason || 'excused';
        } else {
            const g = s.graded.get(date);
            day.status = 'graded';
            day.required = g.dayRequired;
            day.actual   = Math.round(g.dayActual * 100) / 100;
            day.done     = Object.fromEntries(required.map(k => [k, Math.round(g.done[k] * 100) / 100]));
            day.grade    = g.dayGrade;
            day.rule     = g.rule;
            day.why = {
                'full':          'requirement met',
                'partial-ratio': `partial: ${day.actual}/${g.dayRequired} of ${maxScore}`,
                'partial-floor': `partial: raised to ${settings.completion_score_pct}% completion floor`,
                'none':          `nothing qualifying — no-submission score (${settings.no_submission_score_pct}%)`,
            }[g.rule];
            if (att && !att.excused && att.code) day.why += ` · ${att.reason}`;
        }
        const w = day.work;
        const qual = Object.values(w).reduce((a, x) => a + x.qualifying, 0);
        const other = Object.values(w).reduce((a, x) => a + x.other_class, 0);
        if (day.status !== 'graded' && qual > 0) missedWork++;
        if (day.status === 'graded' && other > 0) otherClassDays++;
        tr.days.push(day);
    }

    if (missedWork)
        tr.notes.push(`${missedWork} day(s) have qualifying work on a day that isn't graded (no class / not enrolled / excused). Days bucket by UTC midnight — work done after 7pm EST (8pm EDT) lands on the NEXT day.`);
    if (otherClassDays)
        tr.notes.push(`${otherClassDays} graded day(s) have submissions attributed to another class (or no class). Those never count here — the student may have had the wrong class picked.`);
    if (accuracyKeys.length)
        tr.notes.push(`SAT accuracy mode: ${accuracyKeys.join(', ')} credit is (required count × accuracy progress), so it can be fractional.`);

    tr.summary = {
        days_graded: s.dayGrades.length,
        days_excused: s.studentDates.filter(d => s.exemptDates.has(d)).length,
        sum: s.dayGrades.reduce((a, b) => a + b, 0),
        grade: s.grade,
    };
}

router.get('/grades', requireTeacher, (req, res) => {
    const { class_id, start, end } = req.query;
    if (!class_id || !start || !end)
        return res.status(400).json({ error: 'class_id, start, end required' });

    const cid = Number(class_id);
    const cls = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_key = ?')
        .get(cid, req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const ctx = gradeContext(cls, req.teacherKey, start, end);
    const students = db.prepare(
        'SELECT * FROM class_students WHERE class_id = ? ORDER BY student_name'
    ).all(cid);

    res.json({
        class_id:  cid,
        start, end,
        max_score: ctx.maxScore,
        attendance: attendanceCoverage(cid, start, end),
        students:  students.map(s => gradeStudent(ctx, s)),
    });
});

// Weekdays in [a, b] — the "should have had class" estimate for spotting
// attendance gaps. Holidays will over-count, which only makes warnings louder.
const weekdaysBetween = (a, b) => (a > b ? [] : L.datesBetween(a, b)
    .filter(d => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w !== 0 && w !== 6; }));

// How well pulled PS attendance covers [start, end], plus a teacher-facing
// `warning` (null when fine) the extension shows before submitting grades.
// Meeting days come only from wbl_attendance (L.meetingDates), so:
//   none synced     → every calendar day, weekends included, is graded;
//   a gap at either end → weekdays outside the synced span are treated as
//                     "no class", so work done on them never counts.
// Today is ignored for the trailing gap — attendance may not be taken yet.
function attendanceCoverage(cid, start, end) {
    const span = db.prepare(`
        SELECT MIN(date) AS first, MAX(date) AS last, COUNT(DISTINCT date) AS days, MAX(synced_at) AS synced_at
        FROM wbl_attendance WHERE class_id = ? AND date BETWEEN ? AND ?
    `).get(cid, start, end);
    const lastEver = db.prepare('SELECT MAX(synced_at) AS t FROM wbl_attendance WHERE class_id = ?').get(cid)?.t ?? null;
    const out = {
        meeting_days: span.days, first_date: span.first, last_date: span.last,
        last_synced_at: lastEver, missing_start: [], missing_end: [], warning: null,
    };
    if (!span.days) {
        out.warning = `No PowerSchool attendance has been synced for ${start} to ${end}. `
            + 'Every calendar day (weekends and days off included) will be graded, so students will lose credit for days class did not meet.';
        return out;
    }
    const shift = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
    out.missing_start = weekdaysBetween(start, shift(span.first, -1));
    out.missing_end   = weekdaysBetween(shift(span.last, 1), minDate(end, shift(todayStr(), -1)));
    const gaps = [];
    if (out.missing_start.length) gaps.push(`${out.missing_start.length} weekday(s) before ${span.first}`);
    if (out.missing_end.length)   gaps.push(`${out.missing_end.length} weekday(s) after ${span.last}`);
    if (gaps.length)
        out.warning = `Synced attendance only covers ${span.first} to ${span.last} (${span.days} meeting days). `
            + `${gaps.join(' and ')} have no attendance, so they are treated as "no class" and work done on them will not count.`;
    return out;
}

// Attendance coverage alone (no grading) — the extension's pre-sync check, so
// it can warn before creating/writing a PS assignment for a class whose PS
// attendance hasn't been synced for the range.
router.get('/classes/:id/attendance-coverage', requireTeacher, (req, res) => {
    const { start, end } = req.query;
    if (!isDateStr(start) || !isDateStr(end) || start > end)
        return res.status(400).json({ error: 'start, end (YYYY-MM-DD) required' });
    const cid = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM classes WHERE id = ? AND teacher_key = ?').get(cid, req.teacherKey))
        return res.status(404).json({ error: 'Class not found' });
    res.json(attendanceCoverage(cid, start, end));
});

// One student's /grades result with a per-day breakdown of how it was reached
// (attendance codes, excusals, per-activity completions, the scoring rule
// applied each day, and work that didn't count). For debugging "why didn't
// this student get full credit" — read-only, nothing is synced.
router.get('/grades/debug', requireTeacher, (req, res) => {
    const { class_id, student_id, start, end } = req.query;
    if (!class_id || !student_id || !isDateStr(start) || !isDateStr(end))
        return res.status(400).json({ error: 'class_id, student_id, start, end (YYYY-MM-DD) required' });
    if (start > end) return res.status(400).json({ error: 'start must be on or before end' });
    if (L.dayCount(start, end) > 400) return res.status(400).json({ error: 'window too long (max 400 days)' });

    const cid = Number(class_id);
    const cls = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_key = ?')
        .get(cid, req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    const student = db.prepare('SELECT * FROM class_students WHERE class_id = ? AND student_id = ?')
        .get(cid, String(student_id));
    if (!student) return res.status(404).json({ error: 'Student not on this roster' });

    const ctx = gradeContext(cls, req.teacherKey, start, end);
    res.json({ class_id: cid, class_name: cls.name, max_score: ctx.maxScore,
               attendance: attendanceCoverage(cid, start, end), ...gradeStudent(ctx, student, true) });
});

// ── All data ──────────────────────────────────────────────────────────────────
router.get('/data', requireTeacher, (_req, res) => {
    const users  = db.prepare('SELECT * FROM users ORDER BY user_key').all();
    const kenken = db.prepare(
        'SELECT ks.*, u.email FROM kenken_scores ks JOIN users u ON ks.user_key = u.user_key ORDER BY ks.submitted_at DESC'
    ).all();
    const sat = db.prepare(
        'SELECT ss.*, u.email FROM sat_scores ss JOIN users u ON ss.user_key = u.user_key ORDER BY ss.submitted_at DESC'
    ).all();
    const sat_math = db.prepare(
        'SELECT ms.*, u.email FROM sat_math_scores ms JOIN users u ON ms.user_key = u.user_key ORDER BY ms.submitted_at DESC'
    ).all();
    const measurement = db.prepare(
        'SELECT m.*, u.email FROM measurement_scores m JOIN users u ON m.user_key = u.user_key ORDER BY m.submitted_at DESC'
    ).all();
    const measurement_progress = db.prepare('SELECT user_key, tier, tier_started_at FROM measurement_progress').all();
    const projection = db.prepare(
        'SELECT p.id, p.user_key, p.class_id, p.tier, p.task, p.shape_code, p.hidden_graded, p.correct, p.time_ms, p.score, p.submitted_at, u.email '
        + 'FROM projection_scores p JOIN users u ON p.user_key = u.user_key ORDER BY p.submitted_at DESC'
    ).all();
    const projection_progress = db.prepare('SELECT user_key, tier, tier_started_at FROM projection_progress').all();
    res.json({ users, kenken, sat, sat_math, measurement, measurement_progress, projection, projection_progress });
});

// GET /api/teacher/kenken-leaderboard — top 10 average KenKen scores among
// students actively enrolled in a class. One row per student.
router.get('/kenken-leaderboard', requireTeacher, (_req, res) => {
    res.json(kenkenLeaderboard(10).map((r, i) => ({
        rank:      i + 1,
        name:      firstNameLastInitial(r.student_name),
        avg_score: Math.round(r.avg_score),
        games:     r.games,
    })));
});

// ── Question report management ───────────────────────────────────────────────

// GET /api/teacher/reports?subject=math|english
router.get('/reports', requireTeacher, (req, res) => {
    const { subject } = req.query;
    if (!subject || !['math', 'english'].includes(subject))
        return res.status(400).json({ error: 'subject must be math or english' });

    const rows = db.prepare(`
        SELECT
            question_id,
            COUNT(DISTINCT user_key) AS report_count,
            MIN(reported_at)         AS first_reported_at
        FROM question_reports
        WHERE subject = ?
        GROUP BY question_id
        ORDER BY report_count DESC, first_reported_at ASC
    `).all(subject);

    res.json(rows);
});

// DELETE /api/teacher/reports/:questionId?subject=  — Resolve (Keep): clear reports
router.delete('/reports/:questionId', requireTeacher, (req, res) => {
    const { subject } = req.query;
    if (!subject || !['math', 'english'].includes(subject))
        return res.status(400).json({ error: 'subject must be math or english' });

    db.prepare('DELETE FROM question_reports WHERE question_id = ? AND subject = ?')
        .run(req.params.questionId, subject);

    res.json({ ok: true });
});

// POST /api/teacher/reports/:questionId/suppress?subject=  — Remove: permanently suppress
router.post('/reports/:questionId/suppress', requireTeacher, (req, res) => {
    const { subject } = req.query;
    if (!subject || !['math', 'english'].includes(subject))
        return res.status(400).json({ error: 'subject must be math or english' });

    db.prepare(`
        INSERT OR IGNORE INTO suppressed_questions(question_id, subject, suppressed_at)
        VALUES(?, ?, ?)
    `).run(req.params.questionId, subject, Date.now());

    db.prepare('DELETE FROM question_reports WHERE question_id = ? AND subject = ?')
        .run(req.params.questionId, subject);

    res.json({ ok: true });
});

module.exports = router;
