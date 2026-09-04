const { Router } = require('express');
const { randomUUID } = require('crypto');
const { db } = require('../db');
const { requireTeacher, verifyTeacherToken } = require('../teacherAuth');
const { firstNameLastInitial, kenkenLeaderboard } = require('../leaderboard');

const router = Router();

const todayStr = () => new Date().toISOString().slice(0, 10);
const isDateStr = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
// Inclusive count of calendar days between two YYYY-MM-DD strings.
const dayCount = (a, b) =>
    Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000) + 1;
const maxDate = (a, b) => (a > b ? a : b);
const minDate = (a, b) => (a < b ? a : b);

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
// Activity values: kenken | sat | sat-math | both | sat-both | all | either
const VALID_ACTIVITIES = new Set(['kenken', 'sat', 'sat-math', 'both', 'sat-both', 'all', 'either']);

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
        if (!VALID_ACTIVITIES.has(req.body.required_activity))
            return res.status(400).json({ error: 'invalid required_activity' });
        updates.push('required_activity = ?');
        params.push(req.body.required_activity);
    }
    for (const field of ['required_kenken_count', 'required_sat_count', 'required_sat_math_count']) {
        if (req.body[field] != null) {
            updates.push(`${field} = ?`);
            params.push(Number(req.body[field]) || 1);
        }
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
    res.json({ ...cls, students });
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
    db.prepare('DELETE FROM sessions WHERE user_key = ?').run(userKey);
    db.prepare('UPDATE class_students SET user_key = NULL WHERE user_key = ?').run(userKey);
    db.prepare('DELETE FROM users WHERE user_key = ?').run(userKey);
    res.json({ ok: true });
});

// ── Computed grades for a class + date range (used by Chrome extension) ───────
router.get('/grades', requireTeacher, (req, res) => {
    const { class_id, start, end } = req.query;
    if (!class_id || !start || !end)
        return res.status(400).json({ error: 'class_id, start, end required' });

    const cls = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_key = ?')
        .get(Number(class_id), req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const settings = db.prepare('SELECT * FROM gradebook_settings WHERE teacher_key = ?')
        .get(req.teacherKey)
        ?? { assignment_max_score: 100, completion_score_pct: 100, no_submission_score_pct: 0 };

    // Requirements are per-class now — cls already carries them.
    const asgn = cls;

    const students = db.prepare(
        'SELECT * FROM class_students WHERE class_id = ? ORDER BY student_name'
    ).all(Number(class_id));

    const maxScore   = settings.assignment_max_score;
    const noSubGrade = Math.round(maxScore * settings.no_submission_score_pct / 100);

    const windowDays = dayCount(start, end);

    const results = students.map(student => {
        // Clamp the grading window to the student's enrollment span. enrolled_on
        // NULL means "enrolled since before we tracked dates" → whole window.
        const effStart = maxDate(start, student.enrolled_on || start);
        const effEnd   = minDate(end,   student.exited_on   || end);
        if (effStart > effEnd) {
            // Enrollment span doesn't overlap the window — exempt entirely.
            // The extension skips students whose grade is null.
            return {
                student_id: student.student_id, student_name: student.student_name,
                grade: null, exempt: true,
                enrolled_on: student.enrolled_on, exited_on: student.exited_on,
            };
        }

        const enrolledDays = dayCount(effStart, effEnd);
        const prorate = r => enrolledDays < windowDays
            ? Math.max(1, Math.round(r * enrolledDays / windowDays))
            : r;

        if (!student.user_key)
            return {
                student_id: student.student_id, student_name: student.student_name,
                grade: noSubGrade, unlinked: true,
                enrolled_on: student.enrolled_on, exited_on: student.exited_on,
            };

        const sMs = new Date(effStart + 'T00:00:00').getTime();
        const eMs = new Date(effEnd   + 'T23:59:59').getTime();

        // All-time average determines qualifying threshold for KenKen submissions
        const avgRow    = db.prepare('SELECT AVG(score) AS avg FROM kenken_scores WHERE user_key = ?').get(student.user_key);
        const threshold = avgRow?.avg ?? 0;

        const kenkenCount = db.prepare(
            'SELECT COUNT(*) AS cnt FROM kenken_scores WHERE user_key = ? AND submitted_at >= ? AND submitted_at <= ? AND score >= ?'
        ).get(student.user_key, sMs, eMs, threshold)?.cnt ?? 0;

        const satCount = db.prepare(
            'SELECT COUNT(*) AS cnt FROM sat_scores WHERE user_key = ? AND submitted_at >= ? AND submitted_at <= ?'
        ).get(student.user_key, sMs, eMs)?.cnt ?? 0;

        const satMathCount = db.prepare(
            'SELECT COUNT(*) AS cnt FROM sat_math_scores WHERE user_key = ? AND submitted_at >= ? AND submitted_at <= ?'
        ).get(student.user_key, sMs, eMs)?.cnt ?? 0;

        const ra = asgn.required_activity;
        const smReq = asgn.required_sat_math_count ?? 1;
        let baseRequired, actual;
        if      (ra === 'kenken')   { baseRequired = asgn.required_kenken_count; actual = kenkenCount; }
        else if (ra === 'sat')      { baseRequired = asgn.required_sat_count;    actual = satCount; }
        else if (ra === 'sat-math') { baseRequired = smReq;                      actual = satMathCount; }
        else if (ra === 'both')     { baseRequired = asgn.required_kenken_count + asgn.required_sat_count; actual = kenkenCount + satCount; }
        else if (ra === 'sat-both') { baseRequired = asgn.required_sat_count + smReq;                     actual = satCount + satMathCount; }
        else if (ra === 'all')      { baseRequired = asgn.required_kenken_count + asgn.required_sat_count + smReq; actual = kenkenCount + satCount + satMathCount; }
        else /* either */           { baseRequired = Math.max(asgn.required_kenken_count, asgn.required_sat_count); actual = Math.max(kenkenCount, satCount); }

        // Prorate the requirement to the fraction of the window the student was
        // actually enrolled — a mid-window arrival isn't expected to have done
        // the do-now on days they weren't on the roster.
        const required = prorate(baseRequired);

        let grade;
        if (actual === 0) {
            grade = noSubGrade;
        } else {
            grade = Math.round((actual / required) * maxScore);
            grade = actual >= required
                ? Math.max(grade, Math.round(maxScore * settings.completion_score_pct / 100))
                : Math.max(grade, Math.round(maxScore * settings.no_submission_score_pct / 100));
        }
        grade = Math.min(grade, maxScore);

        return {
            student_id:      student.student_id,
            student_name:    student.student_name,
            grade,
            kenken_count:    kenkenCount,
            sat_count:       satCount,
            sat_math_count:  satMathCount,
            required,
            base_required:   baseRequired,
            actual,
            enrolled_on:     student.enrolled_on,
            exited_on:       student.exited_on,
            window_days:     windowDays,
            enrolled_days:   enrolledDays,
            prorated:        required !== baseRequired,
        };
    });

    res.json({
        class_id:  Number(class_id),
        start, end,
        max_score: settings.assignment_max_score,
        students:  results
    });
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
    res.json({ users, kenken, sat, sat_math });
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
