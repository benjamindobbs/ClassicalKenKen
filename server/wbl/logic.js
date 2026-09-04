// Shared WBL logic — see WBL_API_Design.md §8.
//
// Everything here is pure query/compute against the schema. Route handlers own
// validation and HTTP; this module owns the rules the framework actually
// specifies, so they exist in exactly one place.

const { db, normalizeStudentId } = require('../db');

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

// ISO 8601: weeks start Monday; week 1 is the week containing the first
// Thursday. Taking the year from that Thursday is what keeps 2027-01-01 in
// 2026-W53 instead of splitting one week across two keys — which matters
// because iso_week is the key of the QC weekly cap.
function isoWeek(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${dateStr}`);
    const day = d.getUTCDay() || 7;              // Mon=1 … Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - day);      // move to this week's Thursday
    const year = d.getUTCFullYear();
    const jan1 = Date.UTC(year, 0, 1);
    const week = Math.ceil(((d - jan1) / 86400000 + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
}

const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const today  = () => new Date().toISOString().slice(0, 10);

// Inclusive count of calendar days between two YYYY-MM-DD strings. Shared by
// the activity-grade proration (server/routes/teacher.js) and the Habits of
// Work dispositional average (dispositionalScore below) — one home so the
// two don't drift apart.
const dayCount = (a, b) =>
    Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000) + 1;
const maxDate = (a, b) => (a > b ? a : b);
const minDate = (a, b) => (a < b ? a : b);

// Distinct dates a class actually met, from pulled PS attendance
// (wbl_attendance rows only ever exist for meeting days — PS's own grid
// never returns a non-meeting date, see the extension's mdToIso comment).
// Empty when nothing's been pulled for this class/window yet, which is what
// lets callers fall back to calendar-day counting rather than guessing.
function meetingDates(classId, start, end) {
    return db.prepare(
        'SELECT DISTINCT date FROM wbl_attendance WHERE class_id = ? AND date BETWEEN ? AND ? ORDER BY date'
    ).all(classId, start, end).map(r => r.date);
}

// ---------------------------------------------------------------------------
// Identity and ownership
// ---------------------------------------------------------------------------

// Students authenticate as user_key but all WBL data is keyed on
// normalizeStudentId(student_id) — class_students still carries the raw
// PowerSchool number, so this must normalize before it goes anywhere near a
// wbl_* table or a student with a leading-zero ID becomes invisible to
// every /me/* route.
function resolveStudent(userKey) {
    const rows = db.prepare(`
        SELECT cs.student_id, cs.class_id, cs.student_name
        FROM class_students cs WHERE cs.user_key = ?
    `).all(userKey);
    if (!rows.length) return null;
    return {
        student_id: normalizeStudentId(rows[0].student_id),
        student_name: rows[0].student_name,
        class_ids: rows.map(r => r.class_id),
    };
}

const ownedProgram = (teacherKey, programId) => db.prepare(
    'SELECT * FROM wbl_programs WHERE id = ? AND teacher_key = ?'
).get(Number(programId), teacherKey);

// Ownership resolves upward to the owning program for every child object.
const OWNER_SQL = {
    credential:  'SELECT p.* FROM wbl_credentials c JOIN wbl_programs p ON p.id = c.program_id WHERE c.id = ? AND p.teacher_key = ?',
    skill:       'SELECT p.* FROM wbl_skills s JOIN wbl_programs p ON p.id = s.program_id WHERE s.id = ? AND p.teacher_key = ?',
    skillVersion:'SELECT p.* FROM wbl_skill_versions v JOIN wbl_skills s ON s.id = v.skill_id JOIN wbl_programs p ON p.id = s.program_id WHERE v.id = ? AND p.teacher_key = ?',
    qcCriterion: 'SELECT p.* FROM wbl_qc_criteria q JOIN wbl_programs p ON p.id = q.program_id WHERE q.id = ? AND p.teacher_key = ?',
    workEvent:   'SELECT p.* FROM wbl_work_events w JOIN wbl_programs p ON p.id = w.program_id WHERE w.id = ? AND p.teacher_key = ?',
    participant: 'SELECT p.* FROM wbl_work_event_participants wp JOIN wbl_work_events w ON w.id = wp.work_event_id JOIN wbl_programs p ON p.id = w.program_id WHERE wp.id = ? AND p.teacher_key = ?',
    transferClaim:'SELECT p.* FROM wbl_transfer_claims t JOIN wbl_programs p ON p.id = t.program_id WHERE t.id = ? AND p.teacher_key = ?',
    calledOut:   'SELECT p.* FROM wbl_called_outs co JOIN wbl_programs p ON p.id = co.program_id WHERE co.id = ? AND p.teacher_key = ?',
};
const ownerOf = (kind, id, teacherKey) => db.prepare(OWNER_SQL[kind]).get(Number(id), teacherKey);

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

function ensurePhaseRow(programId, studentId) {
    db.prepare(`
        INSERT OR IGNORE INTO wbl_student_phase(program_id, student_id, computed_phase, updated_at)
        VALUES(?, ?, 1, ?)
    `).run(programId, studentId, Date.now());
}

function effectivePhase(programId, studentId) {
    const row = db.prepare(
        'SELECT computed_phase, override_phase FROM wbl_student_phase WHERE program_id = ? AND student_id = ?'
    ).get(programId, studentId);
    if (!row) return 1;
    return row.override_phase ?? row.computed_phase;
}

// ---------------------------------------------------------------------------
// The credentialing rule (WBL_Schema_Design.md §9)
// ---------------------------------------------------------------------------

// A demonstration counts only when it is `mastered`, on a Work Event whose
// Holistic Call cleared the credential's threshold, and it must recur across
// DISTINCT Work Events. Note there is no filter on skill_version_id — v1
// evidence still counts after v2 publishes (decision 7).
function credentialProgress(credentialId, programId, studentId) {
    const cred = db.prepare('SELECT * FROM wbl_credentials WHERE id = ?').get(credentialId);
    if (!cred) return null;

    const minRank = db.prepare('SELECT rank FROM wbl_holistic_tiers WHERE tier = ?')
        .get(cred.min_holistic_tier)?.rank ?? 2;

    const reqs = db.prepare(
        'SELECT skill_id, required_demonstrations FROM wbl_credential_skills WHERE credential_id = ? ORDER BY order_idx'
    ).all(credentialId);
    if (!reqs.length) return { credential_id: credentialId, satisfied: false, skills: [] };

    const qualifying = db.prepare(`
        SELECT sa.skill_id, sa.id AS assessment_id, sa.work_event_id, sa.assessed_at
        FROM   wbl_skill_assessments sa
        JOIN   wbl_holistic_calls hc ON hc.participant_id = sa.participant_id
        JOIN   wbl_holistic_tiers ht ON ht.tier = hc.tier
        WHERE  sa.program_id = ? AND sa.student_id = ? AND sa.result = 'mastered'
          AND  ht.rank >= ?
        ORDER BY sa.assessed_at
    `).all(programId, studentId, minRank);

    // Skill Checks: a standing, out-of-Work-Event credit with no Holistic
    // Call to gate against — crediting one IS the instructor directly
    // attesting mastery, so it always counts, unconditionally. The UNIQUE
    // constraint on wbl_skill_checks caps this at one per (program, student,
    // skill), so it contributes at most one demonstration.
    const checks = db.prepare(
        'SELECT id, skill_id FROM wbl_skill_checks WHERE program_id = ? AND student_id = ?'
    ).all(programId, studentId);

    const skills = reqs.map(r => {
        const mine = qualifying.filter(q => q.skill_id === r.skill_id);
        // "under varying conditions" — count distinct Work Events, not rows.
        const byEvent = new Map();
        for (const q of mine) if (!byEvent.has(q.work_event_id)) byEvent.set(q.work_event_id, q);
        const check = checks.find(c => c.skill_id === r.skill_id);
        const demos = byEvent.size + (check ? 1 : 0);
        const evidence = [
            ...[...byEvent.values()].map(e => ({ type: 'assessment', assessment_id: e.assessment_id })),
            ...(check ? [{ type: 'skill_check', skill_check_id: check.id }] : []),
        ].slice(0, r.required_demonstrations);
        return {
            skill_id: r.skill_id,
            required: r.required_demonstrations,
            demos,
            satisfied: demos >= r.required_demonstrations,
            evidence,
        };
    });

    return {
        credential_id: credentialId,
        satisfied: skills.every(s => s.satisfied),
        skills,
    };
}

// Runs after every skill assessment AND every holistic call. The holistic call
// matters because it is what makes prior demonstrations on that job *count* —
// grading a job "Meets spec" can complete a credential with no new assessment
// at all. Least obvious dependency in the design; see WBL_API_Design.md §5.
function recomputeAttainment(programId, studentId, earnedInClassId = null) {
    const awarded = [];
    const creds = db.prepare(
        'SELECT id FROM wbl_credentials WHERE program_id = ? AND archived_at IS NULL'
    ).all(programId);

    const existing = db.prepare(
        'SELECT credential_id FROM wbl_credential_awards WHERE program_id = ? AND student_id = ?'
    ).all(programId, studentId).map(r => r.credential_id);

    for (const c of creds) {
        if (existing.includes(c.id)) continue;
        const prog = credentialProgress(c.id, programId, studentId);
        if (!prog?.satisfied) continue;

        const info = db.prepare(`
            INSERT INTO wbl_credential_awards
                (credential_id, program_id, student_id, earned_in_class_id, awarded_at, source)
            VALUES(?, ?, ?, ?, ?, 'auto')
        `).run(c.id, programId, studentId, earnedInClassId, Date.now());

        // Snapshot the satisfying evidence: a credential must rest on a
        // defensible trail that survives later catalog edits. Evidence is
        // tagged by source — a Work Event assessment or a standing Skill
        // Check — since the two live in separate tables.
        const evAssessment = db.prepare(
            'INSERT OR IGNORE INTO wbl_award_evidence(award_id, skill_id, assessment_id) VALUES(?, ?, ?)'
        );
        const evCheck = db.prepare(
            'INSERT OR IGNORE INTO wbl_award_skill_check_evidence(award_id, skill_id, skill_check_id) VALUES(?, ?, ?)'
        );
        for (const s of prog.skills) {
            for (const e of s.evidence) {
                if (e.type === 'skill_check') evCheck.run(info.lastInsertRowid, s.skill_id, e.skill_check_id);
                else evAssessment.run(info.lastInsertRowid, s.skill_id, e.assessment_id);
            }
        }
        awarded.push(c.id);
    }

    const phase = recomputePhase(programId, studentId);
    return { awarded, phase };
}

// Auto-advance from the prerequisite credential set, with the instructor
// override left untouched. Never demotes: a student already doing Phase 2 work
// should not silently lose the transfer lens because a prereq list was edited.
function recomputePhase(programId, studentId) {
    ensurePhaseRow(programId, studentId);
    const prereqs = db.prepare(
        'SELECT credential_id FROM wbl_phase2_prereqs WHERE program_id = ?'
    ).all(programId);

    let computed = 1;
    if (prereqs.length) {
        const missing = db.prepare(`
            SELECT COUNT(*) AS n FROM wbl_phase2_prereqs p
            WHERE p.program_id = ?
              AND NOT EXISTS (
                  SELECT 1 FROM wbl_credential_awards a
                  WHERE a.credential_id = p.credential_id
                    AND a.student_id = ? AND a.revoked_at IS NULL)
        `).get(programId, studentId).n;
        if (missing === 0) computed = 2;
    }

    const row = db.prepare(
        'SELECT computed_phase, transitioned_at FROM wbl_student_phase WHERE program_id = ? AND student_id = ?'
    ).get(programId, studentId);

    if (row.computed_phase === 2) computed = 2;          // never demote
    const transitionedAt = row.transitioned_at ?? (computed === 2 ? Date.now() : null);

    db.prepare(`
        UPDATE wbl_student_phase
        SET computed_phase = ?, transitioned_at = ?, updated_at = ?
        WHERE program_id = ? AND student_id = ?
    `).run(computed, transitionedAt, Date.now(), programId, studentId);

    return effectivePhase(programId, studentId);
}

// ---------------------------------------------------------------------------
// QC rotation and the fairness floor (WBL_Schema_Design.md §6)
// ---------------------------------------------------------------------------

// Derived, never stored: students on an active Work Event with no check this
// week, longest-unchecked first. Multi-week jobs re-enter automatically
// because the job stays `active`.
function rotationQueue(programId, week) {
    return db.prepare(`
        SELECT wp.student_id,
               MAX(wp.id)            AS participant_id,
               MAX(we.id)            AS work_event_id,
               MAX(we.title)         AS work_event_title,
               (SELECT MAX(iso_week) FROM wbl_qc_checks q
                 WHERE q.program_id = ? AND q.student_id = wp.student_id) AS last_checked_week
        FROM   wbl_work_event_participants wp
        JOIN   wbl_work_events we ON we.id = wp.work_event_id
        WHERE  we.program_id = ? AND we.status = 'active' AND wp.left_on IS NULL
          AND  NOT EXISTS (
                 SELECT 1 FROM wbl_qc_checks q
                 WHERE q.program_id = ? AND q.student_id = wp.student_id AND q.iso_week = ?)
        GROUP BY wp.student_id
        ORDER BY (last_checked_week IS NOT NULL), last_checked_week ASC
    `).all(programId, programId, programId, week);
}

// The denominator is ACTIVE weeks — weeks in which the student actually had a
// participant row on an active job. Calendar weeks would count absence, breaks
// and between-jobs gaps as coverage failures, producing an alert that is wrong
// most of the time and gets ignored. Reports only; never gates.
function qcFloorReport(programId, asOfWeek) {
    const program = db.prepare('SELECT qc_max_weeks_unchecked FROM wbl_programs WHERE id = ?').get(programId);
    const limit = program?.qc_max_weeks_unchecked ?? 3;

    const rows = db.prepare(`
        SELECT wp.student_id,
               MIN(we.opened_on) AS first_active_on,
               (SELECT MAX(iso_week) FROM wbl_qc_checks q
                 WHERE q.program_id = ? AND q.student_id = wp.student_id) AS last_checked_week,
               (SELECT COUNT(*) FROM wbl_qc_checks q
                 WHERE q.program_id = ? AND q.student_id = wp.student_id) AS checks
        FROM   wbl_work_event_participants wp
        JOIN   wbl_work_events we ON we.id = wp.work_event_id
        WHERE  we.program_id = ?
        GROUP BY wp.student_id
    `).all(programId, programId, programId);

    const weeksBetween = (a, b) => {
        if (!a || !b) return null;
        const [ay, aw] = a.split('-W').map(Number);
        const [by, bw] = b.split('-W').map(Number);
        return (by - ay) * 52 + (bw - aw);
    };

    return rows.map(r => {
        const since = r.last_checked_week
            ? weeksBetween(r.last_checked_week, asOfWeek)
            : weeksBetween(isoWeek(r.first_active_on), asOfWeek);
        return {
            student_id: r.student_id,
            checks: r.checks,
            last_checked_week: r.last_checked_week,
            weeks_since_check: since,
            below_floor: since != null && since > limit,
        };
    }).filter(r => r.below_floor);
}

// ---------------------------------------------------------------------------
// Transfer claim fact-checking (WBL_Schema_Design.md §8, decision 13)
// ---------------------------------------------------------------------------

// Searches the student's ENTIRE record, not one program: citing a Carpentry
// credential while working an Apparel job is explicitly allowed, and novelty is
// only meaningful measured against everything the student holds.
function checkCitation(studentId, credentialId) {
    if (!credentialId) return { on_record: false };
    const row = db.prepare(`
        SELECT a.awarded_at, a.program_id, p.name AS program_name, c.name AS credential_name
        FROM   wbl_credential_awards a
        JOIN   wbl_credentials c ON c.id = a.credential_id
        JOIN   wbl_programs    p ON p.id = a.program_id
        WHERE  a.student_id = ? AND a.credential_id = ? AND a.revoked_at IS NULL
    `).get(studentId, credentialId);
    return row ? { on_record: true, ...row } : { on_record: false };
}

// An Extension claim for something the student is already credentialed for —
// in ANY program — is Application wearing the wrong label.
function checkNovelty(studentId, capability) {
    if (!capability?.trim()) return { novel: true };
    const hit = db.prepare(`
        SELECT c.name AS credential_name, p.name AS program_name
        FROM   wbl_credential_awards a
        JOIN   wbl_credentials c ON c.id = a.credential_id
        JOIN   wbl_programs    p ON p.id = a.program_id
        WHERE  a.student_id = ? AND a.revoked_at IS NULL
          AND  LOWER(c.name) = LOWER(?)
    `).get(studentId, capability.trim());
    return hit
        ? { novel: false, ...hit, hint: 'Already credentialed — this may be Application of Previous Knowledge' }
        : { novel: true };
}

// ---------------------------------------------------------------------------
// Attendance (WBL attendance → Holistic scoring)
// ---------------------------------------------------------------------------

// Per meeting day: present ('') or any code other than UXT/UNV = 1 full day;
// UXT (unexcused tardy) = half a day; UNV (unverified absence) is 0 UNLESS a
// wbl_called_outs row exists for that date, in which case the day is dropped
// from the ratio entirely (voided, not counted as present). Returns null —
// not 0 — when there is no attendance data in range at all, so callers can
// tell "nothing pulled yet" apart from "pulled and it was all absences."
function attendanceRatio(programId, classId, studentId, from, to) {
    if (!from || !to) return null;
    const rows = db.prepare(`
        SELECT a.date, a.code,
               EXISTS(SELECT 1 FROM wbl_called_outs co
                       WHERE co.program_id = ? AND co.student_id = a.student_id AND co.date = a.date) AS called_out
        FROM wbl_attendance a
        WHERE a.class_id = ? AND a.student_id = ? AND a.date BETWEEN ? AND ?
    `).all(programId, classId, studentId, from, to);
    if (!rows.length) return null;

    let credit = 0, counted = 0;
    for (const r of rows) {
        if (r.code === 'UNV') {
            if (r.called_out) continue;   // voided — neither credit nor a counted day
            counted += 1;                  // unexcused absence — counts against the ratio
        } else if (r.code === 'UXT') {
            credit += 0.5; counted += 1;
        } else {
            credit += 1; counted += 1;     // present ('') or any other code (e.g. EXT)
        }
    }
    if (!counted) return null;
    return { ratio: credit / counted, days_counted: counted };
}

// ---------------------------------------------------------------------------
// Habits of Work — dispositional scoring (Persistence, Commitment to
// Excellence, Academic Curiosity)
// ---------------------------------------------------------------------------

// Cumulative-for-the-marking-period average for one soft skill. `from`/`to`
// are the effective window already clamped by the caller (mirrors
// attendanceRatio's contract — this function just computes over the window
// it's given, same separation of concerns).
//
// Per meeting day (meetingDates — school days only, from pulled attendance):
//   no Do Now submitted at all         → 0 (an opportunity existed, unused)
//   Do Now submitted, skill not picked → excluded (not this skill's day)
//   picked, no resulting Exit Slip     → 0 (selected, no follow-through)
//   resulting Exit Slip, voided        → 0
//   resulting Exit Slip, unverified    → excluded (student-claimed only,
//                                         not yet reviewed — doesn't count
//                                         either way until a teacher rates it)
//   resulting Exit Slip, rated 0-4     → rating × 25
// Returns null — not 0 — when there are no meeting days, or no meeting days
// produced a countable data point at all, so callers can leave the student
// unscored rather than submit a hollow 0.
function dispositionalScore(programId, classId, studentId, softSkillCode, from, to) {
    const dates = meetingDates(classId, from, to);
    if (!dates.length) return null;

    const doNows = new Map(
        db.prepare(`
            SELECT id, date FROM wbl_do_nows
            WHERE program_id = ? AND student_id = ? AND date BETWEEN ? AND ?
        `).all(programId, studentId, from, to).map(r => [r.date, r.id])
    );

    const doNowIds = [...doNows.values()];
    const pickedDoNowIds = doNowIds.length
        ? new Set(db.prepare(`
            SELECT do_now_id FROM wbl_do_now_skills
            WHERE soft_skill_code = ? AND do_now_id IN (${doNowIds.map(() => '?').join(',')})
        `).all(softSkillCode, ...doNowIds).map(r => r.do_now_id))
        : new Set();

    const pickedIds = [...pickedDoNowIds];
    const slipByDoNow = new Map(
        (pickedIds.length
            ? db.prepare(`
                SELECT id, do_now_id FROM wbl_exit_slips
                WHERE soft_skill_code = ? AND do_now_id IN (${pickedIds.map(() => '?').join(',')})
            `).all(softSkillCode, ...pickedIds)
            : []
        ).map(s => [s.do_now_id, s])
    );

    const values = [];
    for (const date of dates) {
        const doNowId = doNows.get(date);
        if (!doNowId) { values.push(0); continue; }
        if (!pickedDoNowIds.has(doNowId)) continue;
        const slip = slipByDoNow.get(doNowId);
        if (!slip) { values.push(0); continue; }
        if (db.prepare('SELECT 1 FROM wbl_exit_slip_voids WHERE exit_slip_id = ?').get(slip.id)) {
            values.push(0); continue;
        }
        const v = db.prepare(`
            SELECT rating FROM wbl_exit_slip_verifications
            WHERE exit_slip_id = ? ORDER BY verified_at DESC LIMIT 1
        `).get(slip.id);
        if (!v || v.rating == null) continue;
        values.push(v.rating * 25);
    }

    if (!values.length) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Credential/skill sync lifecycle (Not Started / In Progress / Due)
// ---------------------------------------------------------------------------

// Loosest "someone has touched this skill" signal — any mastered assessment
// or standing Skill Check credit from a student on THIS class's roster.
// Program-wide evidence would leak progress from a different section running
// the same program; not gated by a credential's Holistic-tier threshold the
// way credentialProgress's "satisfied" bar is — that's the stricter bar for
// actually EARNING a demonstration, this is just "is there evidence yet."
function hasSkillEvidence(programId, classId, skillId) {
    const studentIds = [...new Set(
        db.prepare('SELECT student_id FROM class_students WHERE class_id = ?').all(classId)
          .map(r => normalizeStudentId(r.student_id))
    )];
    if (!studentIds.length) return false;
    const placeholders = studentIds.map(() => '?').join(',');
    const assessed = db.prepare(`
        SELECT 1 FROM wbl_skill_assessments
        WHERE program_id = ? AND skill_id = ? AND result = 'mastered' AND student_id IN (${placeholders})
        LIMIT 1
    `).get(programId, skillId, ...studentIds);
    if (assessed) return true;
    return !!db.prepare(`
        SELECT 1 FROM wbl_skill_checks WHERE program_id = ? AND skill_id = ? AND student_id IN (${placeholders}) LIMIT 1
    `).get(programId, skillId, ...studentIds);
}

module.exports = {
    isoWeek, isDate, today, dayCount, maxDate, minDate, meetingDates,
    resolveStudent, ownedProgram, ownerOf,
    ensurePhaseRow, effectivePhase, recomputePhase,
    credentialProgress, recomputeAttainment,
    rotationQueue, qcFloorReport,
    checkCitation, checkNovelty,
    attendanceRatio, dispositionalScore, hasSkillEvidence,
};
