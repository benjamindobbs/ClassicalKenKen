// WBL Assessment Framework routes — see WBL_API_Design.md
//
// Mounted at /api/wbl. Teacher endpoints gate on requireTeacher and resolve
// ownership up to the owning program; student endpoints gate on requireAuth
// and resolve user_key -> student_id.

const { Router } = require('express');
const { db, normalizeStudentId } = require('../db');
const { requireAuth } = require('../auth');
const { requireTeacher } = require('../teacherAuth');
const L = require('../wbl/logic');

const router = Router();

// --- small helpers ---------------------------------------------------------

const bad   = (res, msg, extra = {}) => res.status(400).json({ error: msg, ...extra });
const nf    = (res, msg = 'not_found') => res.status(404).json({ error: msg });
const now   = () => Date.now();
const int   = v => (v == null || v === '' ? null : Number(v));
const str   = (v, d = '') => (v == null ? d : String(v));

// Default gradebook weighting for the four holistic tiers. Seeded per program
// so a sync never has to guess, and editable per program because "Rework
// needed" may be worth different credit in Carpentry than in Apparel.
const DEFAULT_TIER_POINTS = [
    ['not_shippable', 0], ['rework', 50], ['meets', 85], ['exceeds', 100],
];
function seedTierPoints(programId) {
    const ins = db.prepare(
        'INSERT OR IGNORE INTO wbl_holistic_tier_points(program_id, tier, points_pct) VALUES(?, ?, ?)'
    );
    for (const [tier, pct] of DEFAULT_TIER_POINTS) ins.run(programId, tier, pct);
}

// Every teacher route that names a program passes through here.
function program(req, res, id) {
    const p = L.ownedProgram(req.teacherKey, id);
    if (!p) { res.status(404).json({ error: 'program_not_found' }); return null; }
    return p;
}
function owned(req, res, kind, id) {
    const p = L.ownerOf(kind, id, req.teacherKey);
    if (!p) { res.status(404).json({ error: `${kind}_not_found` }); return null; }
    return p;
}

// =============================================================================
// 1. Programs and enrollment
// =============================================================================

router.get('/programs', requireTeacher, (req, res) => {
    const rows = db.prepare(`
        SELECT p.*,
               (SELECT COUNT(*) FROM wbl_program_enrollments e
                 WHERE e.program_id = p.id AND e.exited_on IS NULL) AS active_students,
               (SELECT COUNT(*) FROM wbl_credentials c
                 WHERE c.program_id = p.id AND c.archived_at IS NULL) AS credentials,
               (SELECT i.source_program_id FROM wbl_program_imports i
                 WHERE i.target_program_id = p.id LIMIT 1) AS imported_from
        FROM wbl_programs p
        WHERE p.teacher_key = ? AND p.archived_at IS NULL
        ORDER BY p.name
    `).all(req.teacherKey);
    res.json(rows);
});

router.post('/programs', requireTeacher, (req, res) => {
    const { name, description, qc_max_weeks_unchecked, shareable } = req.body || {};
    if (!name?.trim()) return bad(res, 'name required');
    try {
        const info = db.prepare(`
            INSERT INTO wbl_programs(teacher_key, name, description, qc_max_weeks_unchecked, shareable, created_at)
            VALUES(?, ?, ?, ?, ?, ?)
        `).run(req.teacherKey, name.trim(), str(description),
               int(qc_max_weeks_unchecked) ?? 3, shareable ? 1 : 0, now());
        seedTierPoints(Number(info.lastInsertRowid));
        res.json({ id: Number(info.lastInsertRowid) });
    } catch {
        res.status(409).json({ error: 'program_name_taken' });
    }
});

router.patch('/programs/:id', requireTeacher, (req, res) => {
    if (!program(req, res, req.params.id)) return;
    const f = ['name', 'description', 'qc_max_weeks_unchecked', 'shareable'].filter(k => k in (req.body || {}));
    if (!f.length) return bad(res, 'nothing to update');
    const vals = f.map(k => (k === 'shareable' ? (req.body[k] ? 1 : 0) : req.body[k]));
    db.prepare(`UPDATE wbl_programs SET ${f.map(k => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...vals, Number(req.params.id));
    res.json({ ok: true });
});

// A program is a curriculum. Deleting one because a name was mistyped should
// not be the same gesture as erasing a cohort's record.
router.delete('/programs/:id', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const counts = {
        enrollments: db.prepare('SELECT COUNT(*) n FROM wbl_program_enrollments WHERE program_id = ?').get(p.id).n,
        work_events: db.prepare('SELECT COUNT(*) n FROM wbl_work_events WHERE program_id = ?').get(p.id).n,
        awards:      db.prepare('SELECT COUNT(*) n FROM wbl_credential_awards WHERE program_id = ?').get(p.id).n,
    };
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total > 0 && req.query.force !== 'true') {
        return res.status(409).json({ error: 'program_has_student_data', ...counts, hint: 'retry with ?force=true' });
    }
    db.prepare('UPDATE wbl_programs SET archived_at = ? WHERE id = ?').run(now(), p.id);
    res.json({ ok: true, archived: true });
});

// The import picker: other teachers' opted-in catalogs.
router.get('/programs/shareable', requireTeacher, (req, res) => {
    res.json(db.prepare(`
        SELECT p.id, p.name, p.description, p.teacher_key,
               (SELECT COUNT(*) FROM wbl_credentials c WHERE c.program_id = p.id AND c.archived_at IS NULL) AS credentials,
               (SELECT COUNT(*) FROM wbl_skills s WHERE s.program_id = p.id AND s.archived_at IS NULL) AS skills
        FROM wbl_programs p
        WHERE p.shareable = 1 AND p.archived_at IS NULL AND p.teacher_key <> ?
        ORDER BY p.name
    `).all(req.teacherKey));
});

// Which of this teacher's classes feed this program — the link that makes a
// class eligible for the DobbsCore sync panel and puts the program in front
// of students on that roster.
router.get('/programs/:id/classes', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    res.json(db.prepare(`
        SELECT c.id, c.name FROM wbl_class_programs cp
        JOIN classes c ON c.id = cp.class_id
        WHERE cp.program_id = ? ORDER BY c.name
    `).all(p.id));
});

// A linked class's roster IS the enrollment source — no separate by-ID entry
// step. Re-runnable: already-enrolled students are a no-op via INSERT OR IGNORE,
// so this doubles as the "pick up students added after the class was linked" path.
// A student who left when a class was unlinked (exit_reason 'class unlinked')
// is reactivated if a re-link brings them back — a deliberate manual exit
// (any other reason) is never touched here.
function syncClassEnrollment(programId, classId) {
    const students = db.prepare('SELECT student_id FROM class_students WHERE class_id = ?').all(classId);
    const ins = db.prepare(`
        INSERT OR IGNORE INTO wbl_program_enrollments(program_id, student_id, enrolled_on, updated_at)
        VALUES(?, ?, ?, ?)
    `);
    const reactivate = db.prepare(`
        UPDATE wbl_program_enrollments SET exited_on = NULL, exit_reason = '', updated_at = ?
        WHERE program_id = ? AND student_id = ? AND exit_reason = 'class unlinked'
    `);
    let added = 0;
    for (const { student_id } of students) {
        const sid = normalizeStudentId(student_id);
        if (!sid) continue;
        const info = ins.run(programId, sid, L.today(), now());
        if (info.changes) { L.ensurePhaseRow(programId, sid); added++; }
        else reactivate.run(now(), programId, sid);
    }
    return added;
}

router.post('/programs/:id/classes', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const classId = int(req.body?.class_id);
    if (!classId) return bad(res, 'class_id required');
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?').get(classId, req.teacherKey);
    if (!cls) return nf(res, 'class_not_found');
    db.prepare('INSERT OR IGNORE INTO wbl_class_programs(class_id, program_id) VALUES(?, ?)').run(classId, p.id);
    const enrolled = syncClassEnrollment(p.id, classId);
    res.json({ ok: true, enrolled });
});

// Re-pull rosters for every linked class — for schedule changes / adds after
// the initial link, since linking only syncs once at that moment.
router.post('/programs/:id/roster/sync', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const classes = db.prepare('SELECT class_id FROM wbl_class_programs WHERE program_id = ?').all(p.id);
    let enrolled = 0;
    for (const { class_id } of classes) enrolled += syncClassEnrollment(p.id, class_id);
    res.json({ ok: true, enrolled, classes: classes.length });
});

// Enrolled roster grouped by class period — backs the work event participant
// picker so teachers check off students instead of typing IDs. Joined in JS,
// not SQL, because class_students carries the raw PowerSchool student number
// while enrollment keys off normalizeStudentId() — a straight SQL join would
// silently drop anyone whose raw ID still has its leading zeros.
router.get('/programs/:id/roster-by-class', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const classes = db.prepare(`
        SELECT c.id, c.name FROM wbl_class_programs cp JOIN classes c ON c.id = cp.class_id
        WHERE cp.program_id = ? ORDER BY c.name
    `).all(p.id);
    const enrolled = new Set(db.prepare(
        'SELECT student_id FROM wbl_program_enrollments WHERE program_id = ? AND exited_on IS NULL'
    ).all(p.id).map(r => r.student_id));
    const studentsFor = db.prepare(
        'SELECT student_id, student_name FROM class_students WHERE class_id = ? ORDER BY student_name'
    );
    res.json(classes.map(c => ({
        class_id: c.id, class_name: c.name,
        students: studentsFor.all(c.id)
            .filter(s => enrolled.has(normalizeStudentId(s.student_id)))
            .map(s => ({ student_id: normalizeStudentId(s.student_id), student_name: s.student_name })),
    })));
});

router.delete('/programs/:id/classes/:classId', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const classId = Number(req.params.classId);

    // Captured before the link is removed — this is who is losing their only
    // path into the program through this class.
    const leaving = new Set(
        db.prepare('SELECT student_id FROM class_students WHERE class_id = ?').all(classId)
          .map(r => normalizeStudentId(r.student_id))
    );

    db.prepare('DELETE FROM wbl_class_programs WHERE class_id = ? AND program_id = ?').run(classId, p.id);
    // Orphaned PS assignment IDs are worse than useless — they would make a
    // later sync update an assignment in a class no longer in this program.
    db.prepare(`DELETE FROM wbl_credential_sync WHERE class_id = ? AND credential_id IN
                (SELECT id FROM wbl_credentials WHERE program_id = ?)`).run(classId, p.id);
    db.prepare(`DELETE FROM wbl_credential_skill_sync WHERE class_id = ? AND credential_id IN
                (SELECT id FROM wbl_credentials WHERE program_id = ?)`).run(classId, p.id);
    db.prepare(`DELETE FROM wbl_work_event_sync WHERE class_id = ? AND work_event_id IN
                (SELECT id FROM wbl_work_events WHERE program_id = ?)`).run(classId, p.id);

    // A student still reachable through another linked class stays enrolled —
    // enrollment is a program-wide fact, not tied to any one class. Anyone
    // left with no remaining path in is exited (not deleted): awards, phase,
    // and pathway_year persist by student the same as any other exit, and a
    // later re-link reactivates them via syncClassEnrollment.
    const stillLinked = new Set(
        db.prepare(`
            SELECT DISTINCT cs.student_id FROM class_students cs
            JOIN wbl_class_programs cp ON cp.class_id = cs.class_id
            WHERE cp.program_id = ?
        `).all(p.id).map(r => normalizeStudentId(r.student_id))
    );
    const exit = db.prepare(`
        UPDATE wbl_program_enrollments SET exited_on = ?, exit_reason = 'class unlinked', updated_at = ?
        WHERE program_id = ? AND student_id = ? AND exited_on IS NULL
    `);
    let exited = 0;
    for (const sid of leaving) {
        if (stillLinked.has(sid)) continue;
        exited += exit.run(L.today(), now(), p.id, sid).changes;
    }

    res.json({ ok: true, exited });
});

router.get('/programs/:id/roster', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const week = str(req.query.week) || L.isoWeek(L.today());
    const rows = db.prepare(`
        SELECT e.student_id, e.pathway_year, e.enrolled_on, e.exited_on, e.exit_reason,
               (SELECT student_name FROM class_students cs WHERE cs.student_id = e.student_id LIMIT 1) AS student_name,
               sp.computed_phase, sp.override_phase, sp.transitioned_at,
               (SELECT COUNT(*) FROM wbl_credential_awards a
                 WHERE a.program_id = e.program_id AND a.student_id = e.student_id AND a.revoked_at IS NULL) AS credentials,
               (SELECT MAX(iso_week) FROM wbl_qc_checks q
                 WHERE q.program_id = e.program_id AND q.student_id = e.student_id) AS last_qc_week
        FROM wbl_program_enrollments e
        LEFT JOIN wbl_student_phase sp ON sp.program_id = e.program_id AND sp.student_id = e.student_id
        WHERE e.program_id = ? ${req.query.include_exited === 'true' ? '' : 'AND e.exited_on IS NULL'}
        ORDER BY student_name
    `).all(p.id);
    res.json(rows.map(r => ({ ...r, phase: r.override_phase ?? r.computed_phase ?? 1 })));
});

// Enrolled, active students with no work-event participation covering the
// given date — backs the "no job today" panel on the Work Events tab.
router.get('/programs/:id/unassigned', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const date = L.isDate(req.query.date) ? req.query.date : L.today();
    const rows = db.prepare(`
        SELECT e.student_id,
               (SELECT student_name FROM class_students cs WHERE cs.student_id = e.student_id LIMIT 1) AS student_name
        FROM wbl_program_enrollments e
        WHERE e.program_id = ? AND e.exited_on IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM wbl_work_event_participants wep
            JOIN wbl_work_events we ON we.id = wep.work_event_id
            WHERE wep.student_id = e.student_id AND we.program_id = e.program_id
              AND wep.joined_on <= ? AND (wep.left_on IS NULL OR wep.left_on >= ?)
          )
        ORDER BY student_name
    `).all(p.id, date, date);
    res.json({ date, students: rows });
});

// ── Called Out (voids a UNV pulled from PS on this date) ────────────────────
router.get('/programs/:id/called-outs', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    res.json(db.prepare(
        'SELECT * FROM wbl_called_outs WHERE program_id = ? ORDER BY date DESC'
    ).all(p.id));
});

router.post('/programs/:id/called-outs', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const studentId = normalizeStudentId(req.body?.student_id);
    const date = str(req.body?.date);
    if (!studentId || !L.isDate(date)) return bad(res, 'student_id and a valid date required');
    try {
        const info = db.prepare(`
            INSERT INTO wbl_called_outs(program_id, student_id, date, note, created_by, created_at)
            VALUES(?, ?, ?, ?, ?, ?)
        `).run(p.id, studentId, date, str(req.body?.note), req.teacherKey, now());
        res.json({ ok: true, id: Number(info.lastInsertRowid) });
    } catch { res.status(409).json({ error: 'already_called_out', hint: 'one call-out per student per date' }); }
});

router.delete('/called-outs/:id', requireTeacher, (req, res) => {
    if (!owned(req, res, 'calledOut', req.params.id)) return;
    db.prepare('DELETE FROM wbl_called_outs WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
});

router.post('/programs/:id/enrollments', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const ids = (req.body?.student_ids || []).map(normalizeStudentId).filter(Boolean);
    if (!ids.length) return bad(res, 'student_ids required');
    const on = L.isDate(req.body?.enrolled_on) ? req.body.enrolled_on : L.today();
    const ins = db.prepare(`
        INSERT OR IGNORE INTO wbl_program_enrollments(program_id, student_id, enrolled_on, updated_at)
        VALUES(?, ?, ?, ?)
    `);
    for (const sid of ids) { ins.run(p.id, sid, on, now()); L.ensurePhaseRow(p.id, sid); }
    res.json({ ok: true, enrolled: ids.length });
});

router.patch('/programs/:id/enrollments/:studentId', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const sid = normalizeStudentId(req.params.studentId);
    const f = ['pathway_year', 'exited_on', 'exit_reason'].filter(k => k in (req.body || {}));
    if (!f.length) return bad(res, 'nothing to update');
    const info = db.prepare(`UPDATE wbl_program_enrollments SET ${f.map(k => `${k} = ?`).join(', ')}, updated_at = ?
                             WHERE program_id = ? AND student_id = ?`)
        .run(...f.map(k => req.body[k]), now(), p.id, sid);
    if (!info.changes) return nf(res, 'enrollment_not_found');
    res.json({ ok: true });
});

// Advances existing enrollment rows rather than creating new ones, so one
// student keeps one pathway history across years. Deliberately touches nothing
// else: credentials and phase persist by key, not by action.
router.post('/programs/:id/enrollments/roll-year', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const info = db.prepare(`
        UPDATE wbl_program_enrollments SET pathway_year = pathway_year + 1, updated_at = ?
        WHERE program_id = ? AND exited_on IS NULL
    `).run(now(), p.id);
    res.json({ ok: true, advanced: info.changes });
});

// =============================================================================
// 2. Catalog — credentials
// =============================================================================

router.get('/programs/:id/credentials', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const creds = db.prepare(`
        SELECT c.*, (SELECT COUNT(*) FROM wbl_credential_awards a
                      WHERE a.credential_id = c.id AND a.revoked_at IS NULL) AS awards
        FROM wbl_credentials c WHERE c.program_id = ? AND c.archived_at IS NULL
        ORDER BY c.order_idx, c.name
    `).all(p.id);
    const skills = db.prepare(`
        SELECT cs.*, sv.name AS skill_name
        FROM wbl_credential_skills cs
        JOIN wbl_skills s ON s.id = cs.skill_id
        LEFT JOIN wbl_skill_versions sv ON sv.skill_id = s.id AND sv.is_current = 1
        WHERE cs.credential_id = ? ORDER BY cs.order_idx
    `);
    res.json(creds.map(c => ({ ...c, skills: skills.all(c.id) })));
});

router.post('/programs/:id/credentials', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const { name, description, min_holistic_tier, order_idx } = req.body || {};
    if (!name?.trim()) return bad(res, 'name required');
    const tier = str(min_holistic_tier, 'meets');
    if (!db.prepare('SELECT 1 FROM wbl_holistic_tiers WHERE tier = ?').get(tier)) return bad(res, 'invalid min_holistic_tier');
    try {
        const info = db.prepare(`
            INSERT INTO wbl_credentials(program_id, name, description, min_holistic_tier, order_idx, created_at)
            VALUES(?, ?, ?, ?, ?, ?)
        `).run(p.id, name.trim(), str(description), tier, int(order_idx) ?? 0, now());
        res.json({ id: Number(info.lastInsertRowid) });
    } catch { res.status(409).json({ error: 'credential_name_taken' }); }
});

router.patch('/credentials/:id', requireTeacher, (req, res) => {
    if (!owned(req, res, 'credential', req.params.id)) return;
    const f = ['name', 'description', 'min_holistic_tier', 'order_idx'].filter(k => k in (req.body || {}));
    if (!f.length) return bad(res, 'nothing to update');
    db.prepare(`UPDATE wbl_credentials SET ${f.map(k => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...f.map(k => req.body[k]), Number(req.params.id));
    res.json({ ok: true });
});

router.delete('/credentials/:id', requireTeacher, (req, res) => {
    if (!owned(req, res, 'credential', req.params.id)) return;
    const awards = db.prepare('SELECT COUNT(*) n FROM wbl_credential_awards WHERE credential_id = ?')
        .get(Number(req.params.id)).n;
    if (awards > 0) return res.status(409).json({ error: 'credential_awarded', awards, hint: 'archive instead' });
    db.prepare('UPDATE wbl_credentials SET archived_at = ? WHERE id = ?').run(now(), Number(req.params.id));
    res.json({ ok: true, archived: true });
});

router.put('/credentials/:id/skills', requireTeacher, (req, res) => {
    const p = owned(req, res, 'credential', req.params.id);
    if (!p) return;
    const list = req.body?.skills;
    if (!Array.isArray(list)) return bad(res, 'skills array required');
    const cid = Number(req.params.id);
    db.exec('BEGIN');
    try {
        db.prepare('DELETE FROM wbl_credential_skills WHERE credential_id = ?').run(cid);
        const ins = db.prepare(`INSERT INTO wbl_credential_skills
            (credential_id, skill_id, required_demonstrations, order_idx) VALUES(?, ?, ?, ?)`);
        list.forEach((s, i) => {
            const owns = db.prepare('SELECT 1 FROM wbl_skills WHERE id = ? AND program_id = ?').get(int(s.skill_id), p.id);
            if (!owns) throw new Error('skill_not_in_program:' + s.skill_id);
            ins.run(cid, int(s.skill_id), int(s.required_demonstrations) ?? 2, int(s.order_idx) ?? i);
        });
        db.exec('COMMIT');
        res.json({ ok: true, skills: list.length });
    } catch (e) { db.exec('ROLLBACK'); bad(res, e.message); }
});

// Bulk catalog import, mirroring the legacy microcredentials CSV shape
// (Microcredential, Checkpoint, Description, Subtask) so an existing sheet
// can be reused: Credential -> Skill -> Criterion. Existing credentials
// (matched by name) and skills (matched by slug) are left untouched — a
// published skill version cannot be edited in place, and re-importing must
// never silently corrupt what a student has already been assessed against.
// Only new skills get criteria and get published; the credential<->skill
// link is added either way (INSERT OR IGNORE) so a second pass can still
// attach a pre-existing skill to a newly-named credential.
router.post('/programs/:id/catalog/import-csv', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || !rows.length) return bad(res, 'rows required');

    const slugify = s => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    db.exec('BEGIN');
    try {
        const credIds = new Map();   // name -> id
        const skillIds = new Map();  // slug -> id
        const newSkillOrder = [];    // slugs created this import, in row order
        const credSkillOrder = new Map(); // credential name -> [skill slug, ...] in row order
        let credsCreated = 0, skillsCreated = 0;

        for (const row of rows) {
            const credName = str(row.credential).trim();
            const skillName = str(row.skill).trim();
            if (!credName || !skillName) continue;
            const slug = slugify(skillName);
            if (!slug) continue;

            if (!credIds.has(credName)) {
                let cred = db.prepare('SELECT id FROM wbl_credentials WHERE program_id = ? AND name = ?')
                    .get(p.id, credName);
                if (!cred) {
                    const info = db.prepare(`
                        INSERT INTO wbl_credentials(program_id, name, description, min_holistic_tier, order_idx, created_at)
                        VALUES(?, ?, '', 'meets', ?, ?)
                    `).run(p.id, credName, credIds.size, now());
                    cred = { id: Number(info.lastInsertRowid) };
                    credsCreated++;
                }
                credIds.set(credName, cred.id);
                credSkillOrder.set(credName, []);
            }
            if (!credSkillOrder.get(credName).includes(slug)) credSkillOrder.get(credName).push(slug);

            if (!skillIds.has(slug)) {
                let skill = db.prepare('SELECT id FROM wbl_skills WHERE program_id = ? AND slug = ?').get(p.id, slug);
                if (!skill) {
                    const s = db.prepare('INSERT INTO wbl_skills(program_id, slug, created_at) VALUES(?, ?, ?)')
                        .run(p.id, slug, now());
                    db.prepare(`
                        INSERT INTO wbl_skill_versions(skill_id, version_no, name, description, status, created_at)
                        VALUES(?, 1, ?, ?, 'draft', ?)
                    `).run(s.lastInsertRowid, skillName, str(row.description), now());
                    skill = { id: Number(s.lastInsertRowid) };
                    skillsCreated++;
                    newSkillOrder.push(slug);
                }
                skillIds.set(slug, skill.id);
            }

            const criterion = str(row.criterion).trim();
            if (criterion && newSkillOrder.includes(slug)) {
                const skillId = skillIds.get(slug);
                const v = db.prepare('SELECT id FROM wbl_skill_versions WHERE skill_id = ? AND status = ?')
                    .get(skillId, 'draft');
                const n = db.prepare('SELECT COUNT(*) n FROM wbl_skill_criteria WHERE skill_version_id = ?').get(v.id).n;
                db.prepare('INSERT INTO wbl_skill_criteria(skill_version_id, name, order_idx) VALUES(?, ?, ?)')
                    .run(v.id, criterion, n);
            }
        }

        for (const slug of newSkillOrder) {
            const skillId = skillIds.get(slug);
            const v = db.prepare('SELECT id FROM wbl_skill_versions WHERE skill_id = ? AND status = ?').get(skillId, 'draft');
            db.prepare(`UPDATE wbl_skill_versions SET status = 'published', is_current = 1, published_at = ? WHERE id = ?`)
                .run(now(), v.id);
        }

        const linkCred = db.prepare(`
            INSERT OR IGNORE INTO wbl_credential_skills(credential_id, skill_id, required_demonstrations, order_idx)
            VALUES(?, ?, 1, ?)
        `);
        for (const [credName, slugs] of credSkillOrder) {
            slugs.forEach((slug, i) => linkCred.run(credIds.get(credName), skillIds.get(slug), i));
        }

        db.exec('COMMIT');
        res.json({ ok: true, credentials_created: credsCreated, skills_created: skillsCreated, rows: rows.length });
    } catch (e) { db.exec('ROLLBACK'); bad(res, e.message); }
});

// =============================================================================
// 2b. Catalog — skills (versioned)
// =============================================================================

router.get('/programs/:id/skills', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    // Display the current published version when there is one, otherwise the
    // latest draft — a brand-new skill has no current version, and joining only
    // on is_current would leave it nameless and impossible to publish.
    // draft_version_id is surfaced separately so a draft sitting behind an
    // already-published version is still reachable.
    const rows = db.prepare(`
        SELECT s.id, s.slug, s.source_skill_id, s.created_at,
               v.id AS version_id, v.version_no, v.name, v.description, v.status, v.published_at,
               (SELECT d.id FROM wbl_skill_versions d
                 WHERE d.skill_id = s.id AND d.status = 'draft'
                 ORDER BY d.version_no DESC LIMIT 1) AS draft_version_id
        FROM wbl_skills s
        LEFT JOIN wbl_skill_versions v ON v.id = (
            SELECT x.id FROM wbl_skill_versions x
            WHERE x.skill_id = s.id
            ORDER BY x.is_current DESC, x.version_no DESC LIMIT 1
        )
        WHERE s.program_id = ? AND s.archived_at IS NULL
        ORDER BY v.name, s.slug
    `).all(p.id);
    // The checklist itself, not just a count: the assessment screen needs the
    // criterion names to render, and this saves it a request per skill.
    const crit = db.prepare(
        'SELECT id, name, order_idx FROM wbl_skill_criteria WHERE skill_version_id = ? ORDER BY order_idx'
    );
    const openings = db.prepare('SELECT soft_skill_code FROM wbl_skill_openings WHERE skill_id = ?');
    res.json(rows.map(r => ({
        ...r,
        criteria: r.version_id ? crit.all(r.version_id) : [],
        openings: openings.all(r.id).map(o => o.soft_skill_code),
    })));
});

// The fixed dispositional vocabulary — what a skill can be tagged to open up
// for Phase 1 Do Now reflection.
router.get('/soft-skills', requireTeacher, (req, res) => {
    res.json(db.prepare(
        `SELECT code, name, category FROM wbl_soft_skills WHERE category = 'dispositional' ORDER BY order_idx`
    ).all());
});

// Creates the lineage plus a draft v1 — a skill has no content of its own.
router.post('/programs/:id/skills', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const { slug, name, description } = req.body || {};
    if (!slug?.trim() || !name?.trim()) return bad(res, 'slug and name required');
    db.exec('BEGIN');
    try {
        const s = db.prepare('INSERT INTO wbl_skills(program_id, slug, created_at) VALUES(?, ?, ?)')
            .run(p.id, slug.trim(), now());
        const v = db.prepare(`INSERT INTO wbl_skill_versions(skill_id, version_no, name, description, status, created_at)
                              VALUES(?, 1, ?, ?, 'draft', ?)`)
            .run(s.lastInsertRowid, name.trim(), str(description), now());
        db.exec('COMMIT');
        res.json({ id: Number(s.lastInsertRowid), version_id: Number(v.lastInsertRowid), version_no: 1 });
    } catch { db.exec('ROLLBACK'); res.status(409).json({ error: 'skill_slug_taken' }); }
});

router.get('/skills/:id/versions', requireTeacher, (req, res) => {
    if (!owned(req, res, 'skill', req.params.id)) return;
    const versions = db.prepare('SELECT * FROM wbl_skill_versions WHERE skill_id = ? ORDER BY version_no')
        .all(Number(req.params.id));
    const crit = db.prepare('SELECT * FROM wbl_skill_criteria WHERE skill_version_id = ? ORDER BY order_idx');
    res.json(versions.map(v => ({ ...v, criteria: crit.all(v.id) })));
});

router.post('/skills/:id/versions', requireTeacher, (req, res) => {
    if (!owned(req, res, 'skill', req.params.id)) return;
    const skillId = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM wbl_skill_versions WHERE skill_id = ? AND is_current = 1').get(skillId);
    const nextNo = (db.prepare('SELECT MAX(version_no) m FROM wbl_skill_versions WHERE skill_id = ?').get(skillId).m || 0) + 1;
    const name = req.body?.name ?? cur?.name;
    if (!name) return bad(res, 'name required');
    db.exec('BEGIN');
    try {
        const v = db.prepare(`INSERT INTO wbl_skill_versions
            (skill_id, version_no, name, description, status, change_note, created_at)
            VALUES(?, ?, ?, ?, 'draft', ?, ?)`)
            .run(skillId, nextNo, name, str(req.body?.description, cur?.description ?? ''),
                 str(req.body?.change_note), now());
        if (req.query.copy_current === 'true' && cur) {
            const ins = db.prepare('INSERT INTO wbl_skill_criteria(skill_version_id, name, order_idx) VALUES(?, ?, ?)');
            for (const c of db.prepare('SELECT * FROM wbl_skill_criteria WHERE skill_version_id = ? ORDER BY order_idx').all(cur.id))
                ins.run(v.lastInsertRowid, c.name, c.order_idx);
        }
        db.exec('COMMIT');
        res.json({ version_id: Number(v.lastInsertRowid), version_no: nextNo });
    } catch (e) { db.exec('ROLLBACK'); bad(res, e.message); }
});

// Published versions are immutable — a trigger enforces it, this is the
// friendly error. That rule is what makes skill_version_id on an assessment a
// durable record of what a student was actually assessed against.
router.patch('/skill-versions/:id', requireTeacher, (req, res) => {
    if (!owned(req, res, 'skillVersion', req.params.id)) return;
    const v = db.prepare('SELECT * FROM wbl_skill_versions WHERE id = ?').get(Number(req.params.id));
    if (v.status === 'published') {
        return res.status(409).json({ error: 'version_published', hint: 'create a new version' });
    }
    const f = ['name', 'description', 'change_note'].filter(k => k in (req.body || {}));
    if (!f.length) return bad(res, 'nothing to update');
    db.prepare(`UPDATE wbl_skill_versions SET ${f.map(k => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...f.map(k => req.body[k]), v.id);
    res.json({ ok: true });
});

router.put('/skill-versions/:id/criteria', requireTeacher, (req, res) => {
    if (!owned(req, res, 'skillVersion', req.params.id)) return;
    const v = db.prepare('SELECT * FROM wbl_skill_versions WHERE id = ?').get(Number(req.params.id));
    if (v.status === 'published') {
        return res.status(409).json({ error: 'version_published', hint: 'create a new version' });
    }
    const list = req.body?.criteria;
    if (!Array.isArray(list)) return bad(res, 'criteria array required');
    db.exec('BEGIN');
    try {
        db.prepare('DELETE FROM wbl_skill_criteria WHERE skill_version_id = ?').run(v.id);
        const ins = db.prepare('INSERT INTO wbl_skill_criteria(skill_version_id, name, order_idx) VALUES(?, ?, ?)');
        list.forEach((c, i) => ins.run(v.id, str(c.name ?? c), int(c.order_idx) ?? i));
        db.exec('COMMIT');
        res.json({ ok: true, criteria: list.length });
    } catch (e) { db.exec('ROLLBACK'); bad(res, e.message); }
});

router.post('/skill-versions/:id/publish', requireTeacher, (req, res) => {
    if (!owned(req, res, 'skillVersion', req.params.id)) return;
    const v = db.prepare('SELECT * FROM wbl_skill_versions WHERE id = ?').get(Number(req.params.id));
    if (v.status !== 'draft') return res.status(409).json({ error: 'not_a_draft', status: v.status });
    db.exec('BEGIN');
    try {
        db.prepare('UPDATE wbl_skill_versions SET is_current = 0 WHERE skill_id = ? AND is_current = 1').run(v.skill_id);
        db.prepare(`UPDATE wbl_skill_versions SET status = 'published', is_current = 1, published_at = ? WHERE id = ?`)
            .run(now(), v.id);
        db.exec('COMMIT');
        res.json({ ok: true, version_no: v.version_no });
    } catch (e) { db.exec('ROLLBACK'); bad(res, e.message); }
});

// Retiring a skill strands every student partway through a credential that
// still requires it, so the count is reported before the damage is done.
router.post('/skill-versions/:id/retire', requireTeacher, (req, res) => {
    const p = owned(req, res, 'skillVersion', req.params.id);
    if (!p) return;
    const v = db.prepare('SELECT * FROM wbl_skill_versions WHERE id = ?').get(Number(req.params.id));

    if (req.query.force !== 'true') {
        const creds = db.prepare(`
            SELECT c.id, c.name FROM wbl_credential_skills cs
            JOIN wbl_credentials c ON c.id = cs.credential_id
            WHERE cs.skill_id = ? AND c.archived_at IS NULL
        `).all(v.skill_id);
        if (creds.length) {
            const stranded = db.prepare(`
                SELECT COUNT(DISTINCT e.student_id) n
                FROM wbl_program_enrollments e
                WHERE e.program_id = ? AND e.exited_on IS NULL
                  AND NOT EXISTS (SELECT 1 FROM wbl_credential_awards a
                                  WHERE a.student_id = e.student_id AND a.credential_id IN
                                        (${creds.map(() => '?').join(',')}))
            `).get(p.id, ...creds.map(c => c.id)).n;
            return res.status(409).json({
                error: 'skill_in_use',
                credentials: creds.map(c => c.name),
                students_stranded: stranded,
                hint: 'retry with ?force=true',
            });
        }
    }
    db.prepare(`UPDATE wbl_skill_versions SET status = 'retired', is_current = 0 WHERE id = ?`).run(v.id);
    res.json({ ok: true });
});

router.put('/skills/:id/openings', requireTeacher, (req, res) => {
    if (!owned(req, res, 'skill', req.params.id)) return;
    const codes = req.body?.soft_skill_codes;
    if (!Array.isArray(codes)) return bad(res, 'soft_skill_codes array required');
    const skillId = Number(req.params.id);
    db.exec('BEGIN');
    try {
        db.prepare('DELETE FROM wbl_skill_openings WHERE skill_id = ?').run(skillId);
        const ins = db.prepare('INSERT OR IGNORE INTO wbl_skill_openings(skill_id, soft_skill_code) VALUES(?, ?)');
        for (const c of codes) {
            const ok = db.prepare(`SELECT 1 FROM wbl_soft_skills WHERE code = ? AND category = 'dispositional'`).get(c);
            if (!ok) throw new Error('not_a_dispositional_skill:' + c);
            ins.run(skillId, c);
        }
        db.exec('COMMIT');
        res.json({ ok: true });
    } catch (e) { db.exec('ROLLBACK'); bad(res, e.message); }
});

// =============================================================================
// 2c. QC criteria and program config
// =============================================================================

router.get('/programs/:id/qc-criteria', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    res.json(db.prepare('SELECT * FROM wbl_qc_criteria WHERE program_id = ? AND archived_at IS NULL ORDER BY order_idx, name')
        .all(p.id));
});

router.post('/programs/:id/qc-criteria', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    if (!req.body?.name?.trim()) return bad(res, 'name required');
    const info = db.prepare(`INSERT INTO wbl_qc_criteria(program_id, name, description, order_idx, created_at)
                             VALUES(?, ?, ?, ?, ?)`)
        .run(p.id, req.body.name.trim(), str(req.body.description), int(req.body.order_idx) ?? 0, now());
    res.json({ id: Number(info.lastInsertRowid) });
});

router.patch('/qc-criteria/:id', requireTeacher, (req, res) => {
    if (!owned(req, res, 'qcCriterion', req.params.id)) return;
    const f = ['name', 'description', 'order_idx'].filter(k => k in (req.body || {}));
    if (!f.length) return bad(res, 'nothing to update');
    db.prepare(`UPDATE wbl_qc_criteria SET ${f.map(k => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...f.map(k => req.body[k]), Number(req.params.id));
    res.json({ ok: true });
});

router.delete('/qc-criteria/:id', requireTeacher, (req, res) => {
    if (!owned(req, res, 'qcCriterion', req.params.id)) return;
    const used = db.prepare('SELECT COUNT(*) n FROM wbl_qc_check_results WHERE criterion_id = ?').get(Number(req.params.id)).n;
    if (used > 0) return res.status(409).json({ error: 'criterion_in_use', checks: used, hint: 'archive instead' });
    db.prepare('UPDATE wbl_qc_criteria SET archived_at = ? WHERE id = ?').run(now(), Number(req.params.id));
    res.json({ ok: true, archived: true });
});

// Loosening the gate can promote immediately; tightening never demotes.
router.put('/programs/:id/phase2-prereqs', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const ids = req.body?.credential_ids;
    if (!Array.isArray(ids)) return bad(res, 'credential_ids array required');
    db.exec('BEGIN');
    try {
        db.prepare('DELETE FROM wbl_phase2_prereqs WHERE program_id = ?').run(p.id);
        const ins = db.prepare('INSERT OR IGNORE INTO wbl_phase2_prereqs(program_id, credential_id) VALUES(?, ?)');
        for (const cid of ids) {
            if (!db.prepare('SELECT 1 FROM wbl_credentials WHERE id = ? AND program_id = ?').get(int(cid), p.id))
                throw new Error('credential_not_in_program:' + cid);
            ins.run(p.id, int(cid));
        }
        db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return bad(res, e.message); }

    const students = db.prepare('SELECT student_id FROM wbl_program_enrollments WHERE program_id = ?').all(p.id);
    for (const s of students) L.recomputePhase(p.id, s.student_id);
    res.json({ ok: true, recomputed: students.length });
});

router.get('/programs/:id/tier-points', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    seedTierPoints(p.id);   // backfills programs created before defaults existed
    res.json(db.prepare(`
        SELECT t.tier, t.label, t.rank, tp.points_pct
        FROM wbl_holistic_tiers t
        LEFT JOIN wbl_holistic_tier_points tp ON tp.tier = t.tier AND tp.program_id = ?
        ORDER BY t.rank
    `).all(p.id));
});

router.put('/programs/:id/tier-points', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const list = req.body?.tiers;
    if (!Array.isArray(list)) return bad(res, 'tiers array required');
    const ins = db.prepare('INSERT OR REPLACE INTO wbl_holistic_tier_points(program_id, tier, points_pct) VALUES(?, ?, ?)');
    for (const t of list) {
        if (!db.prepare('SELECT 1 FROM wbl_holistic_tiers WHERE tier = ?').get(str(t.tier))) {
            return bad(res, 'unknown tier: ' + t.tier);
        }
        ins.run(p.id, str(t.tier), Number(t.points_pct));
    }
    res.json({ ok: true });
});

// =============================================================================
// 4. Work events
// =============================================================================

// Resolves a participant to its work event and owning program in one hop.
function participantCtx(req, res, pid) {
    const row = db.prepare(`
        SELECT wp.*, we.program_id, we.status AS event_status, we.title AS event_title, we.closed_on AS event_closed_on,
               (SELECT cs.student_name FROM class_students cs
                 WHERE cs.student_id = wp.student_id AND cs.class_id = wp.class_id LIMIT 1) AS student_name
        FROM wbl_work_event_participants wp
        JOIN wbl_work_events we ON we.id = wp.work_event_id
        JOIN wbl_programs    p  ON p.id  = we.program_id
        WHERE wp.id = ? AND p.teacher_key = ?
    `).get(Number(pid), req.teacherKey);
    if (!row) { res.status(404).json({ error: 'participant_not_found' }); return null; }
    return row;
}

router.get('/programs/:id/work-events', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const status = str(req.query.status);
    res.json(db.prepare(`
        SELECT we.*,
               (SELECT COUNT(*) FROM wbl_work_event_participants wp WHERE wp.work_event_id = we.id) AS participants,
               (SELECT COUNT(*) FROM wbl_holistic_calls hc WHERE hc.work_event_id = we.id) AS holistic_calls
        FROM wbl_work_events we
        WHERE we.program_id = ? ${status ? 'AND we.status = ?' : ''}
        ORDER BY we.opened_on DESC, we.id DESC
    `).all(...(status ? [p.id, status] : [p.id])));
});

// Skill scoping is advisory (§ note on wbl_work_event_skills), so an invalid
// id is dropped rather than failing the whole save — a typo in the picker
// shouldn't block creating the job.
function setWorkEventSkills(weId, programId, skillIds) {
    db.prepare('DELETE FROM wbl_work_event_skills WHERE work_event_id = ?').run(weId);
    if (!Array.isArray(skillIds) || !skillIds.length) return;
    const ins = db.prepare('INSERT OR IGNORE INTO wbl_work_event_skills(work_event_id, skill_id) VALUES(?, ?)');
    const owns = db.prepare('SELECT 1 FROM wbl_skills WHERE id = ? AND program_id = ?');
    for (const sid of skillIds) {
        const id = int(sid);
        if (id && owns.get(id, programId)) ins.run(weId, id);
    }
}

router.post('/programs/:id/work-events', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const { title, external_ref, description, opened_on, closed_on, skill_ids } = req.body || {};
    if (!title?.trim()) return bad(res, 'title required');
    const on = L.isDate(opened_on) ? opened_on : L.today();
    const due = L.isDate(closed_on) ? closed_on : null;
    const info = db.prepare(`
        INSERT INTO wbl_work_events(program_id, title, external_ref, description, opened_on, closed_on, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.id, title.trim(), external_ref ? String(external_ref) : null, str(description), on, due, now(), now());
    const weId = Number(info.lastInsertRowid);
    if ('skill_ids' in (req.body || {})) setWorkEventSkills(weId, p.id, skill_ids);
    res.json({ id: weId });
});

router.get('/work-events/:id', requireTeacher, (req, res) => {
    if (!owned(req, res, 'workEvent', req.params.id)) return;
    const we = db.prepare('SELECT * FROM wbl_work_events WHERE id = ?').get(Number(req.params.id));
    const participants = db.prepare(`
        SELECT wp.*,
               (SELECT student_name FROM class_students cs
                 WHERE cs.student_id = wp.student_id AND cs.class_id = wp.class_id LIMIT 1) AS student_name,
               (SELECT tier FROM wbl_holistic_calls hc WHERE hc.participant_id = wp.id) AS holistic_tier,
               (SELECT COUNT(*) FROM wbl_skill_assessments sa WHERE sa.participant_id = wp.id) AS assessments,
               (SELECT COUNT(*) FROM wbl_qc_checks q WHERE q.participant_id = wp.id) AS qc_checks
        FROM wbl_work_event_participants wp WHERE wp.work_event_id = ? ORDER BY student_name
    `).all(we.id);
    const skill_ids = db.prepare('SELECT skill_id FROM wbl_work_event_skills WHERE work_event_id = ?')
        .all(we.id).map(r => r.skill_id);
    res.json({ ...we, participants, skill_ids });
});

// Closing a job is the one place the framework's cadence is enforced rather
// than recorded: a Work Event that completes without a Holistic Call leaves
// every skill demonstrated on it unable to ever count toward mastery, because
// the credentialing rule joins through the holistic tier.
router.patch('/work-events/:id', requireTeacher, (req, res) => {
    const p = owned(req, res, 'workEvent', req.params.id);
    if (!p) return;
    const id = Number(req.params.id);
    const body = req.body || {};

    if (body.status === 'complete' && req.query.force !== 'true') {
        const missing = db.prepare(`
            SELECT wp.id AS participant_id, wp.student_id,
                   (SELECT student_name FROM class_students cs
                     WHERE cs.student_id = wp.student_id LIMIT 1) AS student_name
            FROM wbl_work_event_participants wp
            WHERE wp.work_event_id = ?
              AND NOT EXISTS (SELECT 1 FROM wbl_holistic_calls hc WHERE hc.participant_id = wp.id)
        `).all(id);
        if (missing.length) {
            return res.status(409).json({
                error: 'missing_holistic_calls', participants: missing, hint: 'retry with ?force=true',
            });
        }
    }

    if ('skill_ids' in body) setWorkEventSkills(id, p.id, body.skill_ids);

    const f = ['title', 'external_ref', 'description', 'status', 'opened_on', 'closed_on']
        .filter(k => k in body);
    if (f.length) {
        const vals = f.map(k => body[k]);
        if (body.status === 'complete' && !('closed_on' in body)) { f.push('closed_on'); vals.push(L.today()); }
        db.prepare(`UPDATE wbl_work_events SET ${f.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
            .run(...vals, now(), id);
    } else if (!('skill_ids' in body)) {
        return bad(res, 'nothing to update');
    }
    res.json({ ok: true });
});

// phase_at_start is stamped here so the record stays honest after a student
// advances — a Phase 1 participant is never retroactively expected to have
// filed transfer claims.
router.post('/work-events/:id/participants', requireTeacher, (req, res) => {
    const p = owned(req, res, 'workEvent', req.params.id);
    if (!p) return;
    const weId = Number(req.params.id);
    const classId = int(req.body?.class_id);
    const ids = (req.body?.student_ids || []).map(normalizeStudentId).filter(Boolean);
    if (!classId) return bad(res, 'class_id required');
    if (!ids.length) return bad(res, 'student_ids required');

    const on = L.isDate(req.body?.joined_on) ? req.body.joined_on : L.today();
    const ins = db.prepare(`
        INSERT OR IGNORE INTO wbl_work_event_participants
            (work_event_id, class_id, student_id, role, phase_at_start, joined_on)
        VALUES(?, ?, ?, ?, ?, ?)
    `);
    let added = 0;
    for (const sid of ids) {
        L.ensurePhaseRow(p.id, sid);
        const info = ins.run(weId, classId, sid, str(req.body?.role), L.effectivePhase(p.id, sid), on);
        added += info.changes;
    }
    res.json({ ok: true, added });
});

router.delete('/work-events/:id/participants/:pid', requireTeacher, (req, res) => {
    const wp = participantCtx(req, res, req.params.pid);
    if (!wp) return;
    const counts = db.prepare(`
        SELECT (SELECT COUNT(*) FROM wbl_skill_assessments WHERE participant_id = ?) AS assessments,
               (SELECT COUNT(*) FROM wbl_qc_checks        WHERE participant_id = ?) AS qc_checks,
               (SELECT COUNT(*) FROM wbl_holistic_calls   WHERE participant_id = ?) AS holistic
    `).get(wp.id, wp.id, wp.id);
    if (counts.assessments + counts.qc_checks + counts.holistic > 0) {
        return res.status(409).json({ error: 'participant_has_assessments', ...counts });
    }
    db.prepare('DELETE FROM wbl_work_event_participants WHERE id = ?').run(wp.id);
    res.json({ ok: true });
});

// =============================================================================
// 5. Assessment — the three lenses against one participant
// =============================================================================

// The screen that makes §2 of the framework real: one request, one participant,
// all three lenses — mirroring a supervisor watching someone do the job once.
router.get('/participants/:id', requireTeacher, (req, res) => {
    const wp = participantCtx(req, res, req.params.id);
    if (!wp) return;
    const assessments = db.prepare(`
        SELECT sa.*, v.name AS skill_name, v.version_no
        FROM wbl_skill_assessments sa
        JOIN wbl_skill_versions v ON v.id = sa.skill_version_id
        WHERE sa.participant_id = ?
    `).all(wp.id);
    const critResults = db.prepare('SELECT * FROM wbl_skill_criterion_results WHERE assessment_id = ?');
    const qc = db.prepare('SELECT * FROM wbl_qc_checks WHERE participant_id = ? ORDER BY iso_week').all(wp.id);
    const qcResults = db.prepare('SELECT * FROM wbl_qc_check_results WHERE check_id = ?');

    const plannedSkillIds = db.prepare('SELECT skill_id FROM wbl_work_event_skills WHERE work_event_id = ?')
        .all(wp.work_event_id).map(r => r.skill_id);

    res.json({
        participant: wp,
        phase_now: L.effectivePhase(wp.program_id, wp.student_id),
        planned_skill_ids: plannedSkillIds,
        hard_skills: assessments.map(a => ({ ...a, criteria: critResults.all(a.id) })),
        qc_checks: qc.map(c => ({ ...c, results: qcResults.all(c.id) })),
        holistic: db.prepare('SELECT * FROM wbl_holistic_calls WHERE participant_id = ?').get(wp.id) ?? null,
        attendance: L.attendanceRatio(wp.program_id, wp.class_id, wp.student_id,
            wp.joined_on, wp.left_on || wp.event_closed_on || L.today()),
        transfer_claims: db.prepare('SELECT * FROM wbl_transfer_claims WHERE participant_id = ?').all(wp.id),
        dispositional: db.prepare(`
            SELECT es.*, (SELECT confidence FROM wbl_exit_slip_verifications v
                           WHERE v.exit_slip_id = es.id ORDER BY v.verified_at DESC LIMIT 1) AS confidence,
                   (SELECT 1 FROM wbl_exit_slip_voids vo WHERE vo.exit_slip_id = es.id) AS voided
            FROM wbl_exit_slips es WHERE es.work_event_id = ? AND es.student_id = ? ORDER BY es.date
        `).all(wp.work_event_id, wp.student_id),
    });
});

// The client sends skill_id; the server resolves and pins the current version.
// Clients never choose a version — that is what keeps the pin trustworthy.
router.put('/participants/:id/skills/:skillId', requireTeacher, (req, res) => {
    const wp = participantCtx(req, res, req.params.id);
    if (!wp) return;
    const skillId = Number(req.params.skillId);
    const result = str(req.body?.result);
    if (!['not_demonstrated', 'developing', 'mastered'].includes(result)) return bad(res, 'invalid result');

    const version = db.prepare(`
        SELECT v.* FROM wbl_skill_versions v
        JOIN wbl_skills s ON s.id = v.skill_id
        WHERE v.skill_id = ? AND v.is_current = 1 AND s.program_id = ?
    `).get(skillId, wp.program_id);
    if (!version) return res.status(409).json({ error: 'no_published_version', skill_id: skillId });

    db.exec('BEGIN');
    try {
        db.prepare(`
            INSERT INTO wbl_skill_assessments
                (participant_id, work_event_id, program_id, class_id, student_id, skill_id, skill_version_id,
                 result, note, assessed_by, assessed_at, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(participant_id, skill_id) DO UPDATE SET
                skill_version_id = excluded.skill_version_id,
                result = excluded.result, note = excluded.note,
                assessed_by = excluded.assessed_by, updated_at = excluded.updated_at
        `).run(wp.id, wp.work_event_id, wp.program_id, wp.class_id, wp.student_id, skillId, version.id,
               result, str(req.body?.note), req.teacherKey, now(), now());

        const a = db.prepare('SELECT id FROM wbl_skill_assessments WHERE participant_id = ? AND skill_id = ?')
            .get(wp.id, skillId);
        db.prepare('DELETE FROM wbl_skill_criterion_results WHERE assessment_id = ?').run(a.id);
        const ins = db.prepare(
            'INSERT OR REPLACE INTO wbl_skill_criterion_results(assessment_id, criterion_id, met) VALUES(?, ?, ?)'
        );
        for (const c of req.body?.criteria || []) ins.run(a.id, int(c.criterion_id), c.met ? 1 : 0);
        db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return bad(res, e.message); }

    res.json({ ok: true, pinned_version: version.version_no, ...L.recomputeAttainment(wp.program_id, wp.student_id, wp.class_id) });
});

// iso_week is computed server-side, never taken from the client. The weekly cap
// is a UNIQUE constraint, so a second check in the same week is a 409.
router.post('/participants/:id/qc-check', requireTeacher, (req, res) => {
    const wp = participantCtx(req, res, req.params.id);
    if (!wp) return;
    const on = L.isDate(req.body?.checked_on) ? req.body.checked_on : L.today();
    const week = L.isoWeek(on);

    const existing = db.prepare(
        'SELECT id, checked_on FROM wbl_qc_checks WHERE program_id = ? AND student_id = ? AND iso_week = ?'
    ).get(wp.program_id, wp.student_id, week);
    if (existing) {
        return res.status(409).json({
            error: 'already_checked_this_week', iso_week: week,
            existing_check_id: existing.id, checked_on: existing.checked_on,
        });
    }

    db.exec('BEGIN');
    try {
        const info = db.prepare(`
            INSERT INTO wbl_qc_checks(participant_id, work_event_id, program_id, class_id, student_id,
                                      iso_week, checked_on, checked_by, note, created_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(wp.id, wp.work_event_id, wp.program_id, wp.class_id, wp.student_id, week, on,
               req.teacherKey, str(req.body?.note), now());
        const ins = db.prepare(
            'INSERT INTO wbl_qc_check_results(check_id, criterion_id, outcome, note) VALUES(?, ?, ?, ?)'
        );
        for (const r of req.body?.results || []) {
            if (!['pass', 'fail', 'na'].includes(r.outcome)) throw new Error('invalid outcome: ' + r.outcome);
            ins.run(info.lastInsertRowid, int(r.criterion_id), r.outcome, str(r.note));
        }
        db.exec('COMMIT');
        res.json({ ok: true, id: Number(info.lastInsertRowid), iso_week: week });
    } catch (e) { db.exec('ROLLBACK'); bad(res, e.message); }
});

// Triggers recomputeAttainment because the call is what makes prior
// demonstrations on this job COUNT — grading a job "Meets spec" can complete a
// credential with no new skill assessment at all.
router.put('/participants/:id/holistic', requireTeacher, (req, res) => {
    const wp = participantCtx(req, res, req.params.id);
    if (!wp) return;
    const tier = str(req.body?.tier);
    if (!db.prepare('SELECT 1 FROM wbl_holistic_tiers WHERE tier = ?').get(tier)) return bad(res, 'invalid tier');

    const prior = db.prepare('SELECT tier FROM wbl_holistic_calls WHERE participant_id = ?').get(wp.id);
    db.prepare(`
        INSERT INTO wbl_holistic_calls(participant_id, work_event_id, program_id, class_id, student_id,
                                       tier, rationale, called_by, called_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(participant_id) DO UPDATE SET
            tier = excluded.tier, rationale = excluded.rationale,
            called_by = excluded.called_by, updated_at = excluded.updated_at
    `).run(wp.id, wp.work_event_id, wp.program_id, wp.class_id, wp.student_id, tier,
           str(req.body?.rationale), req.teacherKey, now(), now());

    const out = L.recomputeAttainment(wp.program_id, wp.student_id, wp.class_id);

    // Awards are never revoked automatically: downgrading a call after a
    // credential was granted flags it for review rather than silently
    // retracting something a student has been told they hold.
    let review = null;
    if (prior) {
        const rank = t => db.prepare('SELECT rank FROM wbl_holistic_tiers WHERE tier = ?').get(t).rank;
        if (rank(tier) < rank(prior.tier)) {
            const affected = db.prepare(`
                SELECT DISTINCT a.credential_id, c.name
                FROM wbl_award_evidence ev
                JOIN wbl_skill_assessments sa ON sa.id = ev.assessment_id
                JOIN wbl_credential_awards a  ON a.id = ev.award_id
                JOIN wbl_credentials c        ON c.id = a.credential_id
                WHERE sa.participant_id = ?
            `).all(wp.id);
            if (affected.length) review = { downgraded_from: prior.tier, awards_to_review: affected };
        }
    }
    res.json({ ok: true, ...out, ...(review ? { review } : {}) });
});

router.patch('/transfer-claims/:id/verify', requireTeacher, (req, res) => {
    if (!owned(req, res, 'transferClaim', req.params.id)) return;
    const verdict = str(req.body?.verdict);
    if (!['verified', 'citation_not_on_record', 'not_novel', 'insufficient'].includes(verdict)) {
        return bad(res, 'invalid verdict');
    }
    db.prepare(`
        UPDATE wbl_transfer_claims
        SET verdict = ?, score = ?, verify_note = ?, verified_by = ?, verified_at = ?
        WHERE id = ?
    `).run(verdict, req.body?.score ?? null, str(req.body?.verify_note), req.teacherKey, now(), Number(req.params.id));
    res.json({ ok: true });
});

// Pre-answers both fact-checks so the instructor sees the answer before
// opening the claim. Searches the student's whole record, across programs.
router.get('/transfer-claims/:id/factcheck', requireTeacher, (req, res) => {
    if (!owned(req, res, 'transferClaim', req.params.id)) return;
    const c = db.prepare('SELECT * FROM wbl_transfer_claims WHERE id = ?').get(Number(req.params.id));
    res.json(c.kind === 'application'
        ? { kind: c.kind, citation: L.checkCitation(c.student_id, c.cited_credential_id) }
        : { kind: c.kind, novelty: L.checkNovelty(c.student_id, c.new_capability) });
});

// =============================================================================
// 6. Student-facing — /me
// =============================================================================

// A student with no class_students row has no WBL identity. 404 rather than an
// empty success, so an unmapped roster surfaces as a real problem.
function me(req, res) {
    const s = L.resolveStudent(req.userKey);
    if (!s) { res.status(404).json({ error: 'not_enrolled' }); return null; }
    return s;
}

// Programs a student reaches through their class rosters.
const myPrograms = (s) => db.prepare(`
    SELECT DISTINCT p.id, p.name, e.pathway_year, sp.computed_phase, sp.override_phase
    FROM wbl_class_programs cp
    JOIN wbl_programs p ON p.id = cp.program_id AND p.archived_at IS NULL
    LEFT JOIN wbl_program_enrollments e ON e.program_id = p.id AND e.student_id = ?
    LEFT JOIN wbl_student_phase sp      ON sp.program_id = p.id AND sp.student_id = ?
    WHERE cp.class_id IN (${s.class_ids.map(() => '?').join(',')})
`).all(s.student_id, s.student_id, ...s.class_ids)
  .map(r => ({ ...r, phase: r.override_phase ?? r.computed_phase ?? 1 }));

router.get('/me', requireAuth, (req, res) => {
    const s = me(req, res); if (!s) return;
    res.json({
        student_id: s.student_id,
        student_name: s.student_name,
        programs: myPrograms(s),
        credentials: db.prepare(`
            SELECT a.credential_id, c.name AS credential_name, p.name AS program_name, a.awarded_at
            FROM wbl_credential_awards a
            JOIN wbl_credentials c ON c.id = a.credential_id
            JOIN wbl_programs    p ON p.id = a.program_id
            WHERE a.student_id = ? AND a.revoked_at IS NULL ORDER BY a.awarded_at DESC
        `).all(s.student_id),
    });
});

// Spans EVERY program the student holds awards in — decision 13 allows citing
// a Carpentry credential while working an Apparel job. Grouped so the
// cross-program case is visible rather than accidental.
router.get('/me/credentials', requireAuth, (req, res) => {
    const s = me(req, res); if (!s) return;
    res.json(db.prepare(`
        SELECT a.credential_id, c.name AS credential_name, a.program_id, p.name AS program_name, a.awarded_at
        FROM wbl_credential_awards a
        JOIN wbl_credentials c ON c.id = a.credential_id
        JOIN wbl_programs    p ON p.id = a.program_id
        WHERE a.student_id = ? AND a.revoked_at IS NULL
        ORDER BY p.name, c.name
    `).all(s.student_id));
});

router.get('/me/work-events', requireAuth, (req, res) => {
    const s = me(req, res); if (!s) return;
    res.json(db.prepare(`
        SELECT wp.id AS participant_id, we.id AS work_event_id, we.title, we.status,
               we.opened_on, we.program_id, wp.phase_at_start
        FROM wbl_work_event_participants wp
        JOIN wbl_work_events we ON we.id = wp.work_event_id
        WHERE wp.student_id = ? AND we.status = 'active'
        ORDER BY we.opened_on DESC
    `).all(s.student_id));
});

// Every job a student has been on, with the verdict they received on each —
// the QC trail and Holistic Output Call, the two lenses students otherwise
// have no way to see. Rationale is left out: that's teacher-facing framing
// language, not the record a student needs.
router.get('/me/work-history', requireAuth, (req, res) => {
    const s = me(req, res); if (!s) return;
    const events = db.prepare(`
        SELECT wp.id AS participant_id, we.id AS work_event_id, we.title, we.description,
               we.status, we.opened_on, we.closed_on, we.program_id,
               (SELECT name FROM wbl_programs WHERE id = we.program_id) AS program_name
        FROM wbl_work_event_participants wp
        JOIN wbl_work_events we ON we.id = wp.work_event_id
        WHERE wp.student_id = ?
        ORDER BY we.opened_on DESC
    `).all(s.student_id);
    const holistic = db.prepare(`
        SELECT hc.tier, t.label, t.rank, tp.points_pct
        FROM wbl_holistic_calls hc
        JOIN wbl_holistic_tiers t ON t.tier = hc.tier
        LEFT JOIN wbl_holistic_tier_points tp ON tp.program_id = hc.program_id AND tp.tier = hc.tier
        WHERE hc.participant_id = ?
    `);
    const qcChecks = db.prepare(`
        SELECT id, checked_on, note FROM wbl_qc_checks WHERE participant_id = ? ORDER BY checked_on
    `);
    const qcResults = db.prepare(`
        SELECT r.outcome, r.note, c.name AS criterion
        FROM wbl_qc_check_results r JOIN wbl_qc_criteria c ON c.id = r.criterion_id
        WHERE r.check_id = ?
    `);
    res.json(events.map(e => ({
        ...e,
        holistic: holistic.get(e.participant_id) ?? null,
        qc_checks: qcChecks.all(e.participant_id).map(q => ({ ...q, results: qcResults.all(q.id) })),
    })));
});

// Returns undelivered feedback so it surfaces at the START of the next
// session. §4.3.1 is explicit that the loop runs forward — feedback is never
// an annotation on the prior exit slip.
router.get('/me/do-now', requireAuth, (req, res) => {
    const s = me(req, res); if (!s) return;
    const programId = int(req.query.program_id);
    if (!programId) return bad(res, 'program_id required');
    const date = L.isDate(req.query.date) ? req.query.date : L.today();

    const doNow = db.prepare(
        'SELECT * FROM wbl_do_nows WHERE program_id = ? AND student_id = ? AND date = ?'
    ).get(programId, s.student_id, date);

    const phase = L.effectivePhase(programId, s.student_id);
    const out = {
        date, phase,
        do_now: doNow ?? null,
        skills: doNow
            ? db.prepare('SELECT * FROM wbl_do_now_skills WHERE do_now_id = ?').all(doNow.id)
            : [],
        available: db.prepare(
            `SELECT code, name FROM wbl_soft_skills WHERE category = 'dispositional' ORDER BY order_idx`
        ).all(),
        pending_feedback: db.prepare(`
            SELECT id, body, created_at FROM wbl_dispositional_feedback
            WHERE program_id = ? AND student_id = ? AND delivered_at IS NULL ORDER BY created_at
        `).all(programId, s.student_id),
    };

    // Phase 1 narrows the choice to instructor-pre-identified openings (§3);
    // Phase 2 selection is fully self-directed, so the field is absent.
    if (phase === 1) {
        out.openings = db.prepare(`
            SELECT DISTINCT o.soft_skill_code, o.skill_id, v.name AS skill_name
            FROM wbl_skill_openings o
            JOIN wbl_skills s2 ON s2.id = o.skill_id AND s2.program_id = ?
            LEFT JOIN wbl_skill_versions v ON v.skill_id = s2.id AND v.is_current = 1
        `).all(programId);
    }
    res.json(out);
});

router.post('/me/do-now', requireAuth, (req, res) => {
    const s = me(req, res); if (!s) return;
    const programId = int(req.body?.program_id);
    const codes = req.body?.skills || [];
    if (!programId) return bad(res, 'program_id required');
    if (!codes.length) return bad(res, 'pick at least one dispositional skill');
    if (codes.length > 2) return bad(res, 'at most two dispositional skills');
    const date = L.isDate(req.body?.date) ? req.body.date : L.today();
    const classId = s.class_ids[0];

    db.exec('BEGIN');
    try {
        db.prepare(`INSERT OR IGNORE INTO wbl_do_nows(program_id, class_id, student_id, date, submitted_at)
                    VALUES(?, ?, ?, ?, ?)`).run(programId, classId, s.student_id, date, now());
        const doNow = db.prepare(
            'SELECT id FROM wbl_do_nows WHERE program_id = ? AND student_id = ? AND date = ?'
        ).get(programId, s.student_id, date);

        const ins = db.prepare(
            'INSERT OR IGNORE INTO wbl_do_now_skills(do_now_id, soft_skill_code, from_skill_id) VALUES(?, ?, ?)'
        );
        for (const c of codes) {
            const code = typeof c === 'string' ? c : c.soft_skill_code;
            const okCode = db.prepare(
                `SELECT 1 FROM wbl_soft_skills WHERE code = ? AND category = 'dispositional'`
            ).get(code);
            if (!okCode) throw new Error('not_a_dispositional_skill:' + code);
            ins.run(doNow.id, code, typeof c === 'object' ? int(c.from_skill_id) : null);
        }

        // Feedback is delivered forward, stamped as the student sees it.
        db.prepare(`UPDATE wbl_dispositional_feedback SET delivered_do_now_id = ?, delivered_at = ?
                    WHERE program_id = ? AND student_id = ? AND delivered_at IS NULL`)
            .run(doNow.id, now(), programId, s.student_id);

        db.exec('COMMIT');
        res.json({ ok: true, do_now_id: doNow.id });
    } catch (e) {
        db.exec('ROLLBACK');
        if (String(e.message).includes('at most two')) return res.status(409).json({ error: 'skill_cap_exceeded' });
        bad(res, e.message);
    }
});

// INSERT only. There is deliberately no PATCH or DELETE for exit slips — a
// junk entry is handled by an instructor recording a void, never by editing.
router.post('/me/exit-slip', requireAuth, (req, res) => {
    const s = me(req, res); if (!s) return;
    const doNowId = int(req.body?.do_now_id);
    const code = str(req.body?.soft_skill_code);
    const narrative = str(req.body?.narrative).trim();
    if (!doNowId || !code) return bad(res, 'do_now_id and soft_skill_code required');
    if (!narrative) return bad(res, 'narrative required');

    const doNow = db.prepare('SELECT * FROM wbl_do_nows WHERE id = ? AND student_id = ?').get(doNowId, s.student_id);
    if (!doNow) return nf(res, 'do_now_not_found');
    const picked = db.prepare('SELECT 1 FROM wbl_do_now_skills WHERE do_now_id = ? AND soft_skill_code = ?')
        .get(doNowId, code);
    if (!picked) return bad(res, 'that skill was not selected on this Do Now');

    try {
        const info = db.prepare(`
            INSERT INTO wbl_exit_slips(do_now_id, program_id, class_id, student_id, date, work_event_id,
                                       soft_skill_code, narrative, submitted_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(doNowId, doNow.program_id, doNow.class_id, s.student_id, doNow.date,
               int(req.body?.work_event_id), code, narrative, now());
        res.json({ ok: true, id: Number(info.lastInsertRowid) });
    } catch {
        res.status(409).json({ error: 'already_submitted', hint: 'exit slips are never resubmitted' });
    }
});

router.get('/me/exit-slips', requireAuth, (req, res) => {
    const s = me(req, res); if (!s) return;
    res.json(db.prepare(`
        SELECT es.*,
               (SELECT confidence FROM wbl_exit_slip_verifications v
                 WHERE v.exit_slip_id = es.id ORDER BY v.verified_at DESC LIMIT 1) AS confidence,
               (SELECT reason FROM wbl_exit_slip_voids vo WHERE vo.exit_slip_id = es.id) AS void_reason
        FROM wbl_exit_slips es WHERE es.student_id = ? ORDER BY es.date DESC, es.id DESC
    `).all(s.student_id));
});

// Dormant in Phase 1 — enforced, not merely documented (§4.3.2).
router.post('/me/transfer-claims', requireAuth, (req, res) => {
    const s = me(req, res); if (!s) return;
    const pid = int(req.body?.participant_id);
    const kind = str(req.body?.kind);
    if (!pid || !['application', 'extension'].includes(kind)) return bad(res, 'participant_id and valid kind required');

    const wp = db.prepare(`
        SELECT wp.*, we.program_id FROM wbl_work_event_participants wp
        JOIN wbl_work_events we ON we.id = wp.work_event_id
        WHERE wp.id = ? AND wp.student_id = ?
    `).get(pid, s.student_id);
    if (!wp) return nf(res, 'participant_not_found');

    if (L.effectivePhase(wp.program_id, s.student_id) !== 2) {
        return res.status(403).json({
            error: 'phase_1_dormant', hint: 'Transfer skills activate on entry to Phase 2',
        });
    }
    if (!str(req.body?.claim_text).trim()) return bad(res, 'claim_text required');

    try {
        const info = db.prepare(`
            INSERT INTO wbl_transfer_claims(participant_id, work_event_id, program_id, class_id, student_id, kind,
                                            cited_skill_id, cited_credential_id, cited_program_id,
                                            new_capability, claim_text, submitted_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(pid, wp.work_event_id, wp.program_id, wp.class_id, s.student_id, kind,
               int(req.body?.cited_skill_id), int(req.body?.cited_credential_id), int(req.body?.cited_program_id),
               str(req.body?.new_capability), str(req.body?.claim_text), now());
        res.json({
            ok: true, id: Number(info.lastInsertRowid),
            factcheck: kind === 'application'
                ? L.checkCitation(s.student_id, int(req.body?.cited_credential_id))
                : L.checkNovelty(s.student_id, str(req.body?.new_capability)),
        });
    } catch { res.status(409).json({ error: 'claim_already_submitted', kind }); }
});

// =============================================================================
// 7. Rotation, floor, cross-program lookup, sync
// =============================================================================

router.get('/programs/:id/rotation', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const week = str(req.query.week) || L.isoWeek(L.today());
    res.json(L.rotationQueue(p.id, week));
});

router.get('/programs/:id/qc-floor', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const week = str(req.query.week) || L.isoWeek(L.today());
    res.json({ week, max_weeks_unchecked: p.qc_max_weeks_unchecked, below_floor: L.qcFloorReport(p.id, week) });
});

// Instructor records a dispositional verification or a void. Both are
// append-only; the exit slip itself is never touched.
router.post('/exit-slips/:id/verify', requireTeacher, (req, res) => {
    const confidence = str(req.body?.confidence);
    if (!['instructor_verified', 'instructor_witnessed'].includes(confidence)) return bad(res, 'invalid confidence');
    const slip = db.prepare(`
        SELECT es.id FROM wbl_exit_slips es
        JOIN wbl_programs p ON p.id = es.program_id
        WHERE es.id = ? AND p.teacher_key = ?
    `).get(Number(req.params.id), req.teacherKey);
    if (!slip) return nf(res, 'exit_slip_not_found');
    db.prepare(`INSERT INTO wbl_exit_slip_verifications(exit_slip_id, confidence, verified_by, note, verified_at)
                VALUES(?, ?, ?, ?, ?)`).run(slip.id, confidence, req.teacherKey, str(req.body?.note), now());
    res.json({ ok: true });
});

router.post('/exit-slips/:id/void', requireTeacher, (req, res) => {
    if (!str(req.body?.reason).trim()) return bad(res, 'reason required');
    const slip = db.prepare(`
        SELECT es.id FROM wbl_exit_slips es
        JOIN wbl_programs p ON p.id = es.program_id
        WHERE es.id = ? AND p.teacher_key = ?
    `).get(Number(req.params.id), req.teacherKey);
    if (!slip) return nf(res, 'exit_slip_not_found');
    try {
        db.prepare('INSERT INTO wbl_exit_slip_voids(exit_slip_id, reason, voided_by, voided_at) VALUES(?, ?, ?, ?)')
            .run(slip.id, str(req.body.reason), req.teacherKey, now());
        res.json({ ok: true });
    } catch { res.status(409).json({ error: 'already_voided' }); }
});

// Feedback on a reflection is written here but never attached to it — it is
// stamped as delivered when the student opens their NEXT Do Now, because
// §4.3.1 runs the loop forward rather than correcting a prior entry.
router.post('/exit-slips/:id/feedback', requireTeacher, (req, res) => {
    const body = str(req.body?.body).trim();
    if (!body) return bad(res, 'body required');
    const slip = db.prepare(`
        SELECT es.id, es.program_id, es.student_id FROM wbl_exit_slips es
        JOIN wbl_programs p ON p.id = es.program_id
        WHERE es.id = ? AND p.teacher_key = ?
    `).get(Number(req.params.id), req.teacherKey);
    if (!slip) return nf(res, 'exit_slip_not_found');
    const info = db.prepare(`
        INSERT INTO wbl_dispositional_feedback(program_id, student_id, exit_slip_id, body, author_key, created_at)
        VALUES(?, ?, ?, ?, ?, ?)
    `).run(slip.program_id, slip.student_id, slip.id, body, req.teacherKey, now());
    res.json({ ok: true, id: Number(info.lastInsertRowid), delivers_on: 'next Do Now' });
});

// Instructor view of a student's reflections, for the async spot-check.
router.get('/programs/:id/exit-slips', requireTeacher, (req, res) => {
    const p = program(req, res, req.params.id);
    if (!p) return;
    const sid = req.query.student_id ? normalizeStudentId(req.query.student_id) : null;
    res.json(db.prepare(`
        SELECT es.*,
               (SELECT student_name FROM class_students cs WHERE cs.student_id = es.student_id LIMIT 1) AS student_name,
               (SELECT confidence FROM wbl_exit_slip_verifications v
                 WHERE v.exit_slip_id = es.id ORDER BY v.verified_at DESC LIMIT 1) AS confidence,
               (SELECT reason FROM wbl_exit_slip_voids vo WHERE vo.exit_slip_id = es.id) AS void_reason
        FROM wbl_exit_slips es
        WHERE es.program_id = ? ${sid ? 'AND es.student_id = ?' : ''}
        ORDER BY es.date DESC, es.id DESC
    `).all(...(sid ? [p.id, sid] : [p.id])));
});

// The one place the program boundary is crossed: an Apparel instructor
// verifying an Application claim must confirm a Carpentry credential exists.
// Read-only, and returns nothing about the other program's internals.
router.get('/students/:studentId/credentials', requireTeacher, (req, res) => {
    const sid = normalizeStudentId(req.params.studentId);
    res.json(db.prepare(`
        SELECT c.name AS credential_name, p.name AS program_name, a.awarded_at
        FROM wbl_credential_awards a
        JOIN wbl_credentials c ON c.id = a.credential_id
        JOIN wbl_programs    p ON p.id = a.program_id
        WHERE a.student_id = ? AND a.revoked_at IS NULL
        ORDER BY p.name, c.name
    `).all(sid));
});

// The server NEVER pushes to PowerSchool. The DobbsCore extension reads this,
// computes point values client-side, creates/updates PS assignments with the
// teacher's session cookies, then posts the IDs back to /sync/ids.
router.get('/sync/progress', requireTeacher, (req, res) => {
    const classId = int(req.query.class_id);
    if (!classId) return bad(res, 'class_id required');
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?').get(classId, req.teacherKey);
    if (!cls) return nf(res, 'class_not_found');

    const programs = db.prepare(`
        SELECT p.* FROM wbl_class_programs cp JOIN wbl_programs p ON p.id = cp.program_id
        WHERE cp.class_id = ? AND p.teacher_key = ? AND p.archived_at IS NULL
    `).all(classId, req.teacherKey);

    const students = db.prepare(
        'SELECT student_id, student_name FROM class_students WHERE class_id = ? ORDER BY student_name'
    ).all(classId);

    const out = programs.map(p => ({
        program: { id: p.id, name: p.name },
        credentials: db.prepare(`
            SELECT c.id AS credential_id, c.name,
                   s.ps_assignment_id, s.ps_assignmentsection_id, COALESCE(s.sync_enabled, 1) AS sync_enabled
            FROM wbl_credentials c
            LEFT JOIN wbl_credential_sync s ON s.credential_id = c.id AND s.class_id = ?
            WHERE c.program_id = ? AND c.archived_at IS NULL
        `).all(classId, p.id).map(c => {
            const awards = db.prepare(`
                SELECT student_id, earned_in_class_id FROM wbl_credential_awards
                WHERE credential_id = ? AND revoked_at IS NULL
            `).all(c.credential_id);
            const here  = awards.filter(a => a.earned_in_class_id === classId).map(a => a.student_id);
            // Earned in a different class or a prior year. Its grade already
            // landed there, so the extension scores nothing rather than
            // awarding the credential a second time in this term.
            const prior = awards.filter(a => a.earned_in_class_id !== classId).map(a => a.student_id);
            // Per-skill satisfaction. Each required skill becomes its own
            // formative 0/100 completion assignment; the credential itself is
            // the summative 0/100. Sync is keyed on (credential, skill) because
            // the thresholds belong to the credential, so one skill shared by
            // two credentials can be satisfied for one and not the other.
            const reqs = db.prepare(`
                SELECT cs.skill_id, cs.required_demonstrations, cs.order_idx,
                       v.name AS skill_name,
                       s.ps_assignment_id, s.ps_assignmentsection_id,
                       COALESCE(s.sync_enabled, 1) AS sync_enabled
                FROM wbl_credential_skills cs
                LEFT JOIN wbl_skill_versions v ON v.skill_id = cs.skill_id AND v.is_current = 1
                LEFT JOIN wbl_credential_skill_sync s
                       ON s.credential_id = cs.credential_id AND s.skill_id = cs.skill_id AND s.class_id = ?
                WHERE cs.credential_id = ?
                ORDER BY cs.order_idx
            `).all(classId, c.credential_id);

            const perStudent = students.map(s => ({
                student_id: s.student_id,
                skills: L.credentialProgress(c.credential_id, p.id, s.student_id)?.skills ?? [],
            }));

            return {
                ...c,
                earned: here,
                earned_prior: prior,
                skills: reqs.map(r => ({
                    skill_id: r.skill_id,
                    name: r.skill_name,
                    required_demonstrations: r.required_demonstrations,
                    ps_assignment_id: r.ps_assignment_id,
                    ps_assignmentsection_id: r.ps_assignmentsection_id,
                    sync_enabled: r.sync_enabled,
                    satisfied: perStudent
                        .filter(ps => ps.skills.find(x => x.skill_id === r.skill_id)?.satisfied)
                        .map(ps => ps.student_id),
                })),
            };
        }),
        work_events: db.prepare(`
            SELECT we.id AS work_event_id, we.title, we.status, we.closed_on,
                   s.ps_assignment_id, s.ps_assignmentsection_id, COALESCE(s.sync_enabled, 1) AS sync_enabled
            FROM wbl_work_events we
            LEFT JOIN wbl_work_event_sync s ON s.work_event_id = we.id AND s.class_id = ?
            WHERE we.program_id = ? AND we.status = 'complete'
        `).all(classId, p.id).map(w => ({
            ...w,
            // points_pct is the blend (80% direct tier assessment, 20% attendance)
            // when attendance data exists for the participant's window on this job,
            // and the raw tier value untouched when it doesn't — a student is never
            // penalized for attendance that was never pulled from PS.
            calls: db.prepare(`
                SELECT hc.student_id, hc.tier, t.rank,
                       (SELECT points_pct FROM wbl_holistic_tier_points tp
                         WHERE tp.program_id = ? AND tp.tier = hc.tier) AS points_pct,
                       wp.joined_on, wp.left_on
                FROM wbl_holistic_calls hc
                JOIN wbl_holistic_tiers t ON t.tier = hc.tier
                JOIN wbl_work_event_participants wp
                     ON wp.work_event_id = hc.work_event_id AND wp.student_id = hc.student_id
                WHERE hc.work_event_id = ? AND hc.class_id = ?
            `).all(p.id, w.work_event_id, classId).map(c => {
                const att = L.attendanceRatio(p.id, classId, c.student_id,
                    c.joined_on, c.left_on || w.closed_on || L.today());
                const points_pct = att
                    ? Math.round((0.8 * c.points_pct + 0.2 * (att.ratio * 100)) * 100) / 100
                    : c.points_pct;
                return { student_id: c.student_id, tier: c.tier, rank: c.rank, points_pct, attendance: att };
            }),
        })),
        transfer: ['application', 'extension'].map(kind => ({
            kind,
            ...db.prepare('SELECT ps_assignment_id, ps_assignmentsection_id, sync_enabled FROM wbl_transfer_sync WHERE class_id = ? AND kind = ?')
                .get(classId, kind) ?? { ps_assignment_id: null, ps_assignmentsection_id: null, sync_enabled: 1 },
            scores: db.prepare(`
                SELECT student_id, SUM(COALESCE(score, 0)) AS score, COUNT(*) AS claims
                FROM wbl_transfer_claims
                WHERE program_id = ? AND class_id = ? AND kind = ? AND verdict = 'verified'
                GROUP BY student_id
            `).all(p.id, classId, kind),
        })),
    }));

    res.json({ class_id: classId, students, programs: out });
});

// Mirrors POST /api/teacher/microcredentials/:id/sync-ids: the extension tells
// us which PS assignments it created so a re-sync updates rather than
// duplicates them.
router.post('/sync/ids', requireTeacher, (req, res) => {
    const classId = int(req.body?.class_id);
    if (!classId) return bad(res, 'class_id required');
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?').get(classId, req.teacherKey);
    if (!cls) return nf(res, 'class_not_found');

    let n = 0;
    const cred = db.prepare(`INSERT OR REPLACE INTO wbl_credential_sync
        (credential_id, class_id, ps_assignment_id, ps_assignmentsection_id) VALUES(?, ?, ?, ?)`);
    for (const c of req.body?.credentials || []) {
        if (!c.credential_id || !c.ps_assignment_id) continue;
        if (!L.ownerOf('credential', c.credential_id, req.teacherKey)) continue;
        cred.run(int(c.credential_id), classId, String(c.ps_assignment_id), str(c.ps_assignmentsection_id)); n++;
    }
    const cskill = db.prepare(`INSERT OR REPLACE INTO wbl_credential_skill_sync
        (credential_id, skill_id, class_id, ps_assignment_id, ps_assignmentsection_id) VALUES(?, ?, ?, ?, ?)`);
    for (const s of req.body?.skills || []) {
        if (!s.credential_id || !s.skill_id || !s.ps_assignment_id) continue;
        if (!L.ownerOf('credential', s.credential_id, req.teacherKey)) continue;
        cskill.run(int(s.credential_id), int(s.skill_id), classId,
                   String(s.ps_assignment_id), str(s.ps_assignmentsection_id)); n++;
    }
    const we = db.prepare(`INSERT OR REPLACE INTO wbl_work_event_sync
        (work_event_id, class_id, ps_assignment_id, ps_assignmentsection_id) VALUES(?, ?, ?, ?)`);
    for (const w of req.body?.work_events || []) {
        if (!w.work_event_id || !w.ps_assignment_id) continue;
        if (!L.ownerOf('workEvent', w.work_event_id, req.teacherKey)) continue;
        we.run(int(w.work_event_id), classId, String(w.ps_assignment_id), str(w.ps_assignmentsection_id)); n++;
    }
    const tr = db.prepare(`INSERT OR REPLACE INTO wbl_transfer_sync
        (class_id, kind, ps_assignment_id, ps_assignmentsection_id) VALUES(?, ?, ?, ?)`);
    for (const t of req.body?.transfer || []) {
        if (!['application', 'extension'].includes(t.kind) || !t.ps_assignment_id) continue;
        tr.run(classId, t.kind, String(t.ps_assignment_id), str(t.ps_assignmentsection_id)); n++;
    }
    res.json({ ok: true, stored: n });
});

// Bulk ingest from the DobbsCore extension's PS attendance scrape — the whole
// cached date range for a section in one request, keyed by ps_dcid since
// that's what the extension has (class_students.ps_dcid, set on roster
// import). Rows for a student with no matching ps_dcid are skipped and
// reported back rather than silently dropped.
router.post('/classes/:classId/attendance/import', requireTeacher, (req, res) => {
    const classId = int(req.params.classId);
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?').get(classId, req.teacherKey);
    if (!cls) return nf(res, 'class_not_found');
    const rows = req.body?.rows;
    if (!Array.isArray(rows)) return bad(res, 'rows array required');

    const dcidMap = new Map(
        db.prepare('SELECT student_id, ps_dcid FROM class_students WHERE class_id = ? AND ps_dcid IS NOT NULL')
          .all(classId).map(s => [String(s.ps_dcid), s.student_id])
    );

    const ins = db.prepare(`
        INSERT INTO wbl_attendance(class_id, student_id, date, code, synced_at)
        VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(class_id, student_id, date) DO UPDATE SET
            code = excluded.code, synced_at = excluded.synced_at
    `);
    let imported = 0;
    const unmatched = new Set();
    const ts = now();
    db.exec('BEGIN');
    try {
        for (const r of rows) {
            const studentId = dcidMap.get(String(r.ps_dcid));
            if (!studentId) { unmatched.add(String(r.ps_dcid)); continue; }
            if (!L.isDate(r.date)) continue;
            ins.run(classId, studentId, r.date, str(r.code), ts);
            imported++;
        }
        db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return bad(res, e.message); }

    res.json({ ok: true, imported, unmatched: [...unmatched] });
});

module.exports = router;
