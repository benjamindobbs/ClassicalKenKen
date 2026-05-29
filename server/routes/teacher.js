const { Router } = require('express');
const { db } = require('../db');

const router = Router();

const teacherTokenCache = new Map();

async function verifyTeacherToken(token) {
    const cached = teacherTokenCache.get(token);
    if (cached && cached.exp * 1000 > Date.now()) return cached;

    const res = await fetch(
        `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.email || data.error) return null;

    const domain = data.email.split('@')[1];
    // Explicitly exclude student subdomain
    if (domain !== 'hartfordschools.org') return null;

    const teacherKey = data.email.split('@')[0];
    const entry = {
        teacherKey,
        email: data.email,
        exp: data.expires_in
            ? Math.floor(Date.now() / 1000) + parseInt(data.expires_in)
            : Math.floor(Date.now() / 1000) + 3600,
    };

    teacherTokenCache.set(token, entry);
    if (teacherTokenCache.size > 200) {
        const now = Date.now();
        for (const [k, v] of teacherTokenCache) {
            if (v.exp * 1000 <= now) teacherTokenCache.delete(k);
        }
    }

    return entry;
}

async function requireTeacher(req, res, next) {
    if (process.env.DEV_TEACHER) {
        req.teacherKey = process.env.DEV_TEACHER;
        return next();
    }
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    const identity = await verifyTeacherToken(token);
    if (!identity) return res.status(403).json({ error: 'Not authorized as teacher' });
    req.teacherKey = identity.teacherKey;
    next();
}

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
router.get('/gradebook-settings', requireTeacher, (req, res) => {
    const row = db.prepare('SELECT * FROM gradebook_settings WHERE teacher_key = ?').get(req.teacherKey);
    res.json(row ?? { assignment_max_score: 100, completion_score_pct: 100, no_submission_score_pct: 0 });
});

router.post('/gradebook-settings', requireTeacher, (req, res) => {
    const { assignment_max_score, completion_score_pct, no_submission_score_pct } = req.body;
    if ([assignment_max_score, completion_score_pct, no_submission_score_pct].some(v => v == null || isNaN(Number(v))))
        return res.status(400).json({ error: 'All three fields are required and must be numbers' });
    db.prepare(`
        INSERT OR REPLACE INTO gradebook_settings(teacher_key, assignment_max_score, completion_score_pct, no_submission_score_pct)
        VALUES(?, ?, ?, ?)
    `).run(req.teacherKey, Number(assignment_max_score), Number(completion_score_pct), Number(no_submission_score_pct));
    res.json({ ok: true });
});

// ── Assignment settings ───────────────────────────────────────────────────────
const VALID_ACTIVITIES = new Set(['kenken', 'sat', 'both', 'either']);

router.get('/assignment-settings', requireTeacher, (req, res) => {
    const row = db.prepare('SELECT * FROM assignment_settings WHERE teacher_key = ?').get(req.teacherKey);
    res.json(row ?? { required_activity: 'either', required_kenken_count: 1, required_sat_count: 1 });
});

router.post('/assignment-settings', requireTeacher, (req, res) => {
    const { required_activity, required_kenken_count, required_sat_count } = req.body;
    if (!VALID_ACTIVITIES.has(required_activity))
        return res.status(400).json({ error: 'invalid required_activity' });
    db.prepare(`
        INSERT OR REPLACE INTO assignment_settings(teacher_key, required_activity, required_kenken_count, required_sat_count)
        VALUES(?, ?, ?, ?)
    `).run(req.teacherKey, required_activity, Number(required_kenken_count) || 1, Number(required_sat_count) || 1);
    res.json({ ok: true });
});

// ── Classes ───────────────────────────────────────────────────────────────────
router.get('/classes', requireTeacher, (req, res) => {
    const rows = db.prepare(`
        SELECT c.id, c.name, c.created_at, c.ps_section_id,
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
        'INSERT OR IGNORE INTO class_students(class_id, student_id, student_name) VALUES(?, ?, ?)'
    );
    let added = 0;
    for (const s of students) {
        if (!s.student_id || !s.student_name) continue;
        const r = insert.run(classId, String(s.student_id).trim(), String(s.student_name).trim());
        added += r.changes;
    }
    res.json({ id: classId, name: name.trim(), ps_section_id: String(ps_section_id), student_count: added });
});

router.delete('/classes/:id', requireTeacher, (req, res) => {
    db.prepare('DELETE FROM classes WHERE id = ? AND teacher_key = ?').run(Number(req.params.id), req.teacherKey);
    res.json({ ok: true });
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
    const { user_key } = req.body;
    db.prepare('UPDATE class_students SET user_key = ? WHERE class_id = ? AND student_id = ?')
        .run(user_key || null, classId, req.params.studentId);
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

    const asgn = db.prepare('SELECT * FROM assignment_settings WHERE teacher_key = ?')
        .get(req.teacherKey)
        ?? { required_activity: 'either', required_kenken_count: 1, required_sat_count: 1 };

    const students = db.prepare(
        'SELECT * FROM class_students WHERE class_id = ? ORDER BY student_name'
    ).all(Number(class_id));

    const startMs = new Date(start + 'T00:00:00').getTime();
    const endMs   = new Date(end   + 'T23:59:59').getTime();

    const maxScore   = settings.assignment_max_score;
    const noSubGrade = Math.round(maxScore * settings.no_submission_score_pct / 100);

    const results = students.map(student => {
        if (!student.user_key)
            return { student_id: student.student_id, student_name: student.student_name, grade: noSubGrade, unlinked: true };

        // All-time average determines qualifying threshold for KenKen submissions
        const avgRow    = db.prepare('SELECT AVG(score) AS avg FROM kenken_scores WHERE user_key = ?').get(student.user_key);
        const threshold = avgRow?.avg ?? 0;

        const kenkenCount = db.prepare(
            'SELECT COUNT(*) AS cnt FROM kenken_scores WHERE user_key = ? AND submitted_at >= ? AND submitted_at <= ? AND score >= ?'
        ).get(student.user_key, startMs, endMs, threshold)?.cnt ?? 0;

        const satCount = db.prepare(
            'SELECT COUNT(*) AS cnt FROM sat_scores WHERE user_key = ? AND submitted_at >= ? AND submitted_at <= ?'
        ).get(student.user_key, startMs, endMs)?.cnt ?? 0;

        const ra = asgn.required_activity;
        let required, actual;
        if      (ra === 'kenken') { required = asgn.required_kenken_count; actual = kenkenCount; }
        else if (ra === 'sat')    { required = asgn.required_sat_count;    actual = satCount; }
        else if (ra === 'both')   { required = asgn.required_kenken_count + asgn.required_sat_count; actual = kenkenCount + satCount; }
        else /* either */         { required = Math.max(asgn.required_kenken_count, asgn.required_sat_count); actual = Math.max(kenkenCount, satCount); }

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
            student_id:   student.student_id,
            student_name: student.student_name,
            grade,
            kenken_count: kenkenCount,
            sat_count:    satCount,
            required,
            actual
        };
    });

    res.json({
        class_id:  Number(class_id),
        start, end,
        max_score: settings.assignment_max_score,
        students:  results
    });
});

// ── Microcredentials ──────────────────────────────────────────────────────────

// Import parsed CSV payload: create/reuse MC templates and link them to a class
router.post('/microcredentials/import-csv', requireTeacher, (req, res) => {
    const { class_id, microcredentials } = req.body;
    if (!class_id) return res.status(400).json({ error: 'class_id required' });
    if (!Array.isArray(microcredentials) || microcredentials.length === 0)
        return res.status(400).json({ error: 'microcredentials array required' });

    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?')
        .get(Number(class_id), req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const insertMc = db.prepare(
        'INSERT OR IGNORE INTO microcredentials(teacher_key, name, created_at) VALUES(?, ?, ?)'
    );
    const getMc    = db.prepare('SELECT id FROM microcredentials WHERE teacher_key = ? AND name = ?');
    const getCps   = db.prepare('SELECT id FROM mc_checkpoints WHERE mc_id = ?');
    const insertCp = db.prepare('INSERT INTO mc_checkpoints(mc_id, name, order_idx) VALUES(?, ?, ?)');
    const assignMc = db.prepare('INSERT OR IGNORE INTO mc_class_assignments(mc_id, class_id) VALUES(?, ?)');

    const results = [];
    for (const { name, checkpoints } of microcredentials) {
        if (!name?.trim() || !Array.isArray(checkpoints) || !checkpoints.length) continue;
        insertMc.run(req.teacherKey, name.trim(), Date.now());
        const mc       = getMc.get(req.teacherKey, name.trim());
        const existing = getCps.all(mc.id);
        // Only populate checkpoints on first creation; reused templates keep their original list
        if (existing.length === 0) {
            checkpoints.forEach((cpName, i) => {
                if (cpName?.trim()) insertCp.run(mc.id, cpName.trim(), i);
            });
        }
        assignMc.run(mc.id, Number(class_id));
        results.push({
            id:               mc.id,
            name:             name.trim(),
            reused:           existing.length > 0,
            checkpoint_count: existing.length || checkpoints.filter(c => c?.trim()).length
        });
    }

    res.json({ imported: results.length, microcredentials: results });
});

// List microcredentials assigned to a class (with checkpoint lists)
router.get('/microcredentials', requireTeacher, (req, res) => {
    const { class_id } = req.query;
    if (!class_id) return res.status(400).json({ error: 'class_id required' });

    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?')
        .get(Number(class_id), req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const mcs  = db.prepare(`
        SELECT m.id, m.name, m.created_at
        FROM microcredentials m
        JOIN mc_class_assignments a ON a.mc_id = m.id
        WHERE a.class_id = ? AND m.teacher_key = ?
        ORDER BY m.name
    `).all(Number(class_id), req.teacherKey);

    const getCps = db.prepare(
        'SELECT id, name, order_idx FROM mc_checkpoints WHERE mc_id = ? ORDER BY order_idx'
    );
    res.json(mcs.map(mc => ({ ...mc, checkpoints: getCps.all(mc.id) })));
});

// Full progress grid: students × checkpoints with completion status and stored PS IDs
router.get('/microcredentials/:id/progress', requireTeacher, (req, res) => {
    const mcId    = Number(req.params.id);
    const classId = Number(req.query.class_id);
    if (!classId) return res.status(400).json({ error: 'class_id required' });

    const mc = db.prepare('SELECT * FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    const assignment = db.prepare(
        'SELECT * FROM mc_class_assignments WHERE mc_id = ? AND class_id = ?'
    ).get(mcId, classId);
    if (!assignment) return res.status(404).json({ error: 'Microcredential not assigned to this class' });

    const checkpoints = db.prepare(
        'SELECT * FROM mc_checkpoints WHERE mc_id = ? ORDER BY order_idx'
    ).all(mcId);

    const students = db.prepare(
        'SELECT * FROM class_students WHERE class_id = ? ORDER BY student_name'
    ).all(classId);

    const completions = db.prepare(`
        SELECT c.* FROM mc_completions c
        JOIN mc_checkpoints cp ON cp.id = c.checkpoint_id
        WHERE c.class_id = ? AND cp.mc_id = ?
    `).all(classId, mcId);

    const syncRows = db.prepare(`
        SELECT s.* FROM mc_checkpoint_sync s
        JOIN mc_checkpoints cp ON cp.id = s.checkpoint_id
        WHERE s.class_id = ? AND cp.mc_id = ?
    `).all(classId, mcId);

    // checkpoint_id → { student_id → completed_at }
    const doneMap = {};
    for (const cp of checkpoints) doneMap[cp.id] = {};
    for (const c of completions) {
        if (doneMap[c.checkpoint_id]) doneMap[c.checkpoint_id][c.student_id] = c.completed_at;
    }

    // checkpoint_id → { ps_assignment_id, ps_assignmentsection_id }
    const psCheckpointIds = {};
    for (const row of syncRows) {
        psCheckpointIds[row.checkpoint_id] = {
            ps_assignment_id:        row.ps_assignment_id,
            ps_assignmentsection_id: row.ps_assignmentsection_id
        };
    }

    const studentRows = students.map(s => {
        const completionMap = {};
        let earned = checkpoints.length > 0;
        for (const cp of checkpoints) {
            const ts = doneMap[cp.id]?.[s.student_id] ?? null;
            completionMap[cp.id] = ts;
            if (!ts) earned = false;
        }
        return { student_id: s.student_id, student_name: s.student_name, completions: completionMap, earned };
    });

    res.json({
        mc_id:      mcId,
        mc_name:    mc.name,
        class_id:   classId,
        checkpoints,
        students:   studentRows,
        ps_ids: {
            summative: {
                ps_assignment_id:        assignment.summative_ps_assignment_id ?? null,
                ps_assignmentsection_id: assignment.summative_ps_assignmentsection_id ?? null
            },
            checkpoints: psCheckpointIds
        }
    });
});

// Toggle a single completion square on or off
router.post('/microcredentials/:id/toggle', requireTeacher, (req, res) => {
    const mcId = Number(req.params.id);
    const { class_id, student_id, checkpoint_id, completed } = req.body;
    if (!class_id || !student_id || checkpoint_id == null)
        return res.status(400).json({ error: 'class_id, student_id, checkpoint_id required' });

    const mc = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    const cp = db.prepare('SELECT id FROM mc_checkpoints WHERE id = ? AND mc_id = ?')
        .get(Number(checkpoint_id), mcId);
    if (!cp) return res.status(404).json({ error: 'Checkpoint not found' });

    if (completed) {
        db.prepare(
            'INSERT OR IGNORE INTO mc_completions(checkpoint_id, class_id, student_id, completed_at) VALUES(?, ?, ?, ?)'
        ).run(Number(checkpoint_id), Number(class_id), String(student_id), Date.now());
    } else {
        db.prepare(
            'DELETE FROM mc_completions WHERE checkpoint_id = ? AND class_id = ? AND student_id = ?'
        ).run(Number(checkpoint_id), Number(class_id), String(student_id));
    }

    res.json({ ok: true });
});

// Store PS assignment IDs after a sync so subsequent syncs update rather than create
router.post('/microcredentials/:id/sync-ids', requireTeacher, (req, res) => {
    const mcId    = Number(req.params.id);
    const { class_id, checkpoints, summative } = req.body;
    if (!class_id) return res.status(400).json({ error: 'class_id required' });

    const mc = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    const assignment = db.prepare(
        'SELECT mc_id FROM mc_class_assignments WHERE mc_id = ? AND class_id = ?'
    ).get(mcId, Number(class_id));
    if (!assignment) return res.status(404).json({ error: 'Microcredential not assigned to this class' });

    const upsertCpSync = db.prepare(`
        INSERT OR REPLACE INTO mc_checkpoint_sync(checkpoint_id, class_id, ps_assignment_id, ps_assignmentsection_id)
        VALUES(?, ?, ?, ?)
    `);
    const updateSummative = db.prepare(`
        UPDATE mc_class_assignments
        SET summative_ps_assignment_id        = ?,
            summative_ps_assignmentsection_id = ?
        WHERE mc_id = ? AND class_id = ?
    `);

    if (Array.isArray(checkpoints)) {
        for (const { checkpoint_id, ps_assignment_id, ps_assignmentsection_id } of checkpoints) {
            if (!checkpoint_id || !ps_assignment_id) continue;
            upsertCpSync.run(
                Number(checkpoint_id), Number(class_id),
                String(ps_assignment_id), String(ps_assignmentsection_id ?? '')
            );
        }
    }
    if (summative?.ps_assignment_id) {
        updateSummative.run(
            String(summative.ps_assignment_id),
            String(summative.ps_assignmentsection_id ?? ''),
            mcId, Number(class_id)
        );
    }

    res.json({ ok: true });
});

// Rename a microcredential
router.patch('/microcredentials/:id', requireTeacher, (req, res) => {
    const mcId = Number(req.params.id);
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });

    const mc = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    try {
        db.prepare('UPDATE microcredentials SET name = ? WHERE id = ?').run(name.trim(), mcId);
        res.json({ ok: true });
    } catch {
        res.status(409).json({ error: 'A microcredential with that name already exists' });
    }
});

// Add a checkpoint to an existing microcredential
router.post('/microcredentials/:id/checkpoints', requireTeacher, (req, res) => {
    const mcId = Number(req.params.id);
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });

    const mc = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    const maxIdx = db.prepare('SELECT MAX(order_idx) AS m FROM mc_checkpoints WHERE mc_id = ?')
        .get(mcId)?.m ?? -1;
    const result = db.prepare(
        'INSERT INTO mc_checkpoints(mc_id, name, order_idx) VALUES(?, ?, ?)'
    ).run(mcId, name.trim(), maxIdx + 1);

    res.json({ id: result.lastInsertRowid, mc_id: mcId, name: name.trim(), order_idx: maxIdx + 1 });
});

// Rename a checkpoint
router.patch('/microcredentials/:id/checkpoints/:cpId', requireTeacher, (req, res) => {
    const mcId = Number(req.params.id);
    const cpId = Number(req.params.cpId);
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });

    const mc = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    db.prepare('UPDATE mc_checkpoints SET name = ? WHERE id = ? AND mc_id = ?')
        .run(name.trim(), cpId, mcId);
    res.json({ ok: true });
});

// Remove a checkpoint (cascades to completions and sync rows for that checkpoint)
router.delete('/microcredentials/:id/checkpoints/:cpId', requireTeacher, (req, res) => {
    const mcId = Number(req.params.id);
    const cpId = Number(req.params.cpId);

    const mc = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    db.prepare('DELETE FROM mc_checkpoints WHERE id = ? AND mc_id = ?').run(cpId, mcId);
    res.json({ ok: true });
});

// Unlink a microcredential from one class (keeps template and other class links intact)
router.delete('/microcredentials/:id/classes/:classId', requireTeacher, (req, res) => {
    const mcId    = Number(req.params.id);
    const classId = Number(req.params.classId);

    const mc = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    db.prepare('DELETE FROM mc_class_assignments WHERE mc_id = ? AND class_id = ?').run(mcId, classId);
    res.json({ ok: true });
});

// Delete a microcredential template entirely (cascades to checkpoints, assignments, completions)
router.delete('/microcredentials/:id', requireTeacher, (req, res) => {
    const mcId = Number(req.params.id);
    const mc   = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });
    db.prepare('DELETE FROM microcredentials WHERE id = ?').run(mcId);
    res.json({ ok: true });
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
    res.json({ users, kenken, sat });
});

module.exports = router;
