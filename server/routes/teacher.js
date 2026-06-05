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
const GS_DEFAULTS = {
    assignment_max_score: 100, completion_score_pct: 100, no_submission_score_pct: 0,
    mc_subtask_max_score: 10,  mc_credential_max_score: 50, mc_include_subtasks: 1,
    rubric_max_score: 15
};

router.get('/gradebook-settings', requireTeacher, (req, res) => {
    const row = db.prepare('SELECT * FROM gradebook_settings WHERE teacher_key = ?').get(req.teacherKey);
    res.json(row ?? GS_DEFAULTS);
});

router.post('/gradebook-settings', requireTeacher, (req, res) => {
    const {
        assignment_max_score, completion_score_pct, no_submission_score_pct,
        mc_subtask_max_score, mc_credential_max_score, mc_include_subtasks,
        rubric_max_score
    } = req.body;
    if ([assignment_max_score, completion_score_pct, no_submission_score_pct,
         mc_subtask_max_score, mc_credential_max_score, rubric_max_score].some(v => v == null || isNaN(Number(v))))
        return res.status(400).json({ error: 'All numeric fields are required' });
    db.prepare(`
        INSERT OR REPLACE INTO gradebook_settings(
            teacher_key, assignment_max_score, completion_score_pct, no_submission_score_pct,
            mc_subtask_max_score, mc_credential_max_score, mc_include_subtasks, rubric_max_score
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        req.teacherKey,
        Number(assignment_max_score), Number(completion_score_pct), Number(no_submission_score_pct),
        Number(mc_subtask_max_score), Number(mc_credential_max_score), mc_include_subtasks ? 1 : 0,
        Number(rubric_max_score)
    );
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

router.delete('/classes/:id', requireTeacher, (req, res) => {
    db.prepare('DELETE FROM classes WHERE id = ? AND teacher_key = ?').run(Number(req.params.id), req.teacherKey);
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
    const insertCp = db.prepare('INSERT INTO mc_checkpoints(mc_id, name, order_idx, description) VALUES(?, ?, ?, ?)');
    const assignMc = db.prepare('INSERT OR IGNORE INTO mc_class_assignments(mc_id, class_id) VALUES(?, ?)');

    const results = [];
    for (const { name, checkpoints } of microcredentials) {
        if (!name?.trim() || !Array.isArray(checkpoints) || !checkpoints.length) continue;
        insertMc.run(req.teacherKey, name.trim(), Date.now());
        const mc       = getMc.get(req.teacherKey, name.trim());
        const existing = getCps.all(mc.id);
        // Only populate checkpoints on first creation; reused templates keep their original list
        if (existing.length === 0) {
            checkpoints.forEach((cp, i) => {
                // Accept either a plain string or { name, description }
                const cpName = typeof cp === 'string' ? cp : cp?.name;
                const cpDesc = typeof cp === 'string' ? '' : (cp?.description ?? '');
                if (cpName?.trim()) insertCp.run(mc.id, cpName.trim(), i, cpDesc);
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
        SELECT m.id, m.name, m.created_at, a.sync_enabled
        FROM microcredentials m
        JOIN mc_class_assignments a ON a.mc_id = m.id
        WHERE a.class_id = ? AND m.teacher_key = ?
        ORDER BY m.name
    `).all(Number(class_id), req.teacherKey);

    const getCps = db.prepare(
        'SELECT id, name, order_idx, sync_enabled FROM mc_checkpoints WHERE mc_id = ? ORDER BY order_idx'
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

    const rawCheckpoints = db.prepare(
        'SELECT * FROM mc_checkpoints WHERE mc_id = ? ORDER BY order_idx'
    ).all(mcId);

    const getSubtasks = db.prepare('SELECT * FROM mc_subtasks WHERE checkpoint_id = ? ORDER BY order_idx');
    const checkpoints = rawCheckpoints.map(cp => ({ ...cp, subtasks: getSubtasks.all(cp.id) }));

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

    const subtaskCompletions = db.prepare(`
        SELECT sc.* FROM mc_subtask_completions sc
        JOIN mc_subtasks st ON st.id = sc.subtask_id
        JOIN mc_checkpoints cp ON cp.id = st.checkpoint_id
        WHERE sc.class_id = ? AND cp.mc_id = ?
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

    // student_id → { subtask_id → completed_at }
    const subtaskDoneMap = {};
    for (const sc of subtaskCompletions) {
        if (!subtaskDoneMap[sc.student_id]) subtaskDoneMap[sc.student_id] = {};
        subtaskDoneMap[sc.student_id][sc.subtask_id] = sc.completed_at;
    }

    const studentRows = students.map(s => {
        const completionMap = {};
        let earned = checkpoints.length > 0;
        for (const cp of checkpoints) {
            const ts = doneMap[cp.id]?.[s.student_id] ?? null;
            completionMap[cp.id] = ts;
            if (!ts) earned = false;
        }
        return {
            student_id:          s.student_id,
            student_name:        s.student_name,
            completions:         completionMap,
            subtask_completions: subtaskDoneMap[s.student_id] ?? {},
            earned
        };
    });

    res.json({
        mc_id:        mcId,
        mc_name:      mc.name,
        class_id:     classId,
        sync_enabled: assignment.sync_enabled ?? 1,
        checkpoints,
        students:     studentRows,
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

// Toggle gradebook sync for a checkpoint (global across classes)
router.patch('/microcredentials/checkpoint/:cpId/sync', requireTeacher, (req, res) => {
    const cpId = Number(req.params.cpId);
    const { sync_enabled } = req.body;
    if (sync_enabled == null) return res.status(400).json({ error: 'sync_enabled required' });

    const cp = db.prepare(`
        SELECT c.id FROM mc_checkpoints c
        JOIN microcredentials m ON m.id = c.mc_id
        WHERE c.id = ? AND m.teacher_key = ?
    `).get(cpId, req.teacherKey);
    if (!cp) return res.status(404).json({ error: 'Checkpoint not found' });

    db.prepare('UPDATE mc_checkpoints SET sync_enabled = ? WHERE id = ?')
        .run(sync_enabled ? 1 : 0, cpId);
    res.json({ ok: true });
});

// Toggle gradebook sync for a microcredential in a specific class
router.patch('/microcredentials/:id/class-sync', requireTeacher, (req, res) => {
    const mcId = Number(req.params.id);
    const { class_id, sync_enabled } = req.body;
    if (!class_id || sync_enabled == null) return res.status(400).json({ error: 'class_id and sync_enabled required' });

    const mc = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    db.prepare('UPDATE mc_class_assignments SET sync_enabled = ? WHERE mc_id = ? AND class_id = ?')
        .run(sync_enabled ? 1 : 0, mcId, Number(class_id));
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
        'INSERT INTO mc_checkpoints(mc_id, name, order_idx, description) VALUES(?, ?, ?, ?)'
    ).run(mcId, name.trim(), maxIdx + 1, '');

    res.json({ id: result.lastInsertRowid, mc_id: mcId, name: name.trim(), order_idx: maxIdx + 1, description: '' });
});

// Update a checkpoint (name and/or description)
router.patch('/microcredentials/:id/checkpoints/:cpId', requireTeacher, (req, res) => {
    const mcId = Number(req.params.id);
    const cpId = Number(req.params.cpId);
    const { name, description } = req.body;
    if (name == null && description == null)
        return res.status(400).json({ error: 'name or description required' });

    const mc = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    if (name != null) {
        if (!name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
        db.prepare('UPDATE mc_checkpoints SET name = ? WHERE id = ? AND mc_id = ?')
            .run(name.trim(), cpId, mcId);
    }
    if (description != null) {
        db.prepare('UPDATE mc_checkpoints SET description = ? WHERE id = ? AND mc_id = ?')
            .run(description, cpId, mcId);
    }
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

// ── Sub-tasks ─────────────────────────────────────────────────────────────────

// Clear all sub-tasks for a checkpoint (called before re-importing to prevent duplicates)
router.delete('/microcredentials/:id/checkpoints/:cpId/subtasks', requireTeacher, (req, res) => {
    const mcId = Number(req.params.id);
    const cpId = Number(req.params.cpId);

    const mc = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    db.prepare(`
        DELETE FROM mc_subtasks WHERE checkpoint_id = ?
        AND checkpoint_id IN (SELECT id FROM mc_checkpoints WHERE mc_id = ?)
    `).run(cpId, mcId);
    res.json({ ok: true });
});

// Add a sub-task to a checkpoint
router.post('/microcredentials/:id/checkpoints/:cpId/subtasks', requireTeacher, (req, res) => {
    const mcId = Number(req.params.id);
    const cpId = Number(req.params.cpId);
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });

    const mc = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    const cp = db.prepare('SELECT id FROM mc_checkpoints WHERE id = ? AND mc_id = ?').get(cpId, mcId);
    if (!cp) return res.status(404).json({ error: 'Checkpoint not found' });

    const maxIdx = db.prepare('SELECT MAX(order_idx) AS m FROM mc_subtasks WHERE checkpoint_id = ?')
        .get(cpId)?.m ?? -1;
    const result = db.prepare(
        'INSERT INTO mc_subtasks(checkpoint_id, name, order_idx) VALUES(?, ?, ?)'
    ).run(cpId, name.trim(), maxIdx + 1);

    res.json({ id: result.lastInsertRowid, checkpoint_id: cpId, name: name.trim(), order_idx: maxIdx + 1 });
});

// Rename a sub-task
router.patch('/microcredentials/:id/subtasks/:stId', requireTeacher, (req, res) => {
    const mcId = Number(req.params.id);
    const stId = Number(req.params.stId);
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });

    const mc = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    db.prepare(`
        UPDATE mc_subtasks SET name = ? WHERE id = ?
        AND checkpoint_id IN (SELECT id FROM mc_checkpoints WHERE mc_id = ?)
    `).run(name.trim(), stId, mcId);
    res.json({ ok: true });
});

// Delete a sub-task (cascades completions)
router.delete('/microcredentials/:id/subtasks/:stId', requireTeacher, (req, res) => {
    const mcId = Number(req.params.id);
    const stId = Number(req.params.stId);

    const mc = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    db.prepare(`
        DELETE FROM mc_subtasks WHERE id = ?
        AND checkpoint_id IN (SELECT id FROM mc_checkpoints WHERE mc_id = ?)
    `).run(stId, mcId);
    res.json({ ok: true });
});

// Toggle a sub-task completion for one student
router.post('/microcredentials/:id/subtasks/:stId/toggle', requireTeacher, (req, res) => {
    const mcId = Number(req.params.id);
    const stId = Number(req.params.stId);
    const { class_id, student_id, completed } = req.body;
    if (!class_id || !student_id) return res.status(400).json({ error: 'class_id and student_id required' });

    const mc = db.prepare('SELECT id FROM microcredentials WHERE id = ? AND teacher_key = ?')
        .get(mcId, req.teacherKey);
    if (!mc) return res.status(404).json({ error: 'Microcredential not found' });

    if (completed) {
        db.prepare(
            'INSERT OR IGNORE INTO mc_subtask_completions(subtask_id, class_id, student_id, completed_at) VALUES(?, ?, ?, ?)'
        ).run(stId, Number(class_id), String(student_id), Date.now());
    } else {
        db.prepare(
            'DELETE FROM mc_subtask_completions WHERE subtask_id = ? AND class_id = ? AND student_id = ?'
        ).run(stId, Number(class_id), String(student_id));
    }
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

// ── Daily rubric ──────────────────────────────────────────────────────────────

// Get entries for a class on a specific date
router.get('/rubric', requireTeacher, (req, res) => {
    const classId = Number(req.query.class_id);
    const date    = req.query.date;
    if (!classId || !date) return res.status(400).json({ error: 'class_id and date required' });

    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?')
        .get(classId, req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const entries = db.prepare(
        'SELECT student_id, timeliness, problem_solving, task_completion, total FROM daily_rubric WHERE class_id = ? AND date = ?'
    ).all(classId, date);

    res.json({ date, entries });
});

// Upsert rubric entries for a class on a date (batch)
router.post('/rubric', requireTeacher, (req, res) => {
    try {
        const { class_id, date, entries } = req.body;
        if (!class_id || !date || !Array.isArray(entries))
            return res.status(400).json({ error: 'class_id, date, and entries array required' });

        const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?')
            .get(Number(class_id), req.teacherKey);
        if (!cls) return res.status(404).json({ error: 'Class not found' });

        const upsert = db.prepare(`
            INSERT INTO daily_rubric(class_id, student_id, date, timeliness, problem_solving, task_completion, total, submitted_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(class_id, student_id, date) DO UPDATE SET
                timeliness = excluded.timeliness,
                problem_solving = excluded.problem_solving,
                task_completion = excluded.task_completion,
                total = excluded.total,
                submitted_at = excluded.submitted_at
        `);

        const now = Date.now();
        db.exec('BEGIN');
        try {
            for (const e of entries) {
                const timeliness      = Number(e.timeliness)      || 0;
                const problem_solving = Number(e.problem_solving) || 1;
                const task_completion = Number(e.task_completion) || 1;
                const total           = timeliness + problem_solving + task_completion;
                upsert.run(Number(class_id), String(e.student_id), date, timeliness, problem_solving, task_completion, total, now);
            }
            db.exec('COMMIT');
        } catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('[POST /rubric]', err);
        res.status(500).json({ error: err.message });
    }
});

// Sum rubric totals per student across a date range (for PowerSchool sync)
router.get('/rubric/totals', requireTeacher, (req, res) => {
    const classId = Number(req.query.class_id);
    const start   = req.query.start;
    const end     = req.query.end;
    if (!classId || !start || !end) return res.status(400).json({ error: 'class_id, start, and end required' });

    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?')
        .get(classId, req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const rows = db.prepare(`
        SELECT student_id, SUM(total) AS total_score, COUNT(*) AS days_scored
        FROM daily_rubric
        WHERE class_id = ? AND date >= ? AND date <= ?
        GROUP BY student_id
    `).all(classId, start, end);

    res.json({ class_id: classId, start, end, students: rows });
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
