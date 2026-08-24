const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scores.db');

// Ensure directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new DatabaseSync(dbPath);

// node:sqlite enables FK enforcement by default (unlike most SQLite bindings); this schema
// uses REFERENCES purely as documentation and relies on it never being enforced — e.g. an
// asset can be assigned to a roster ID before that roster row is imported.
db.exec('PRAGMA foreign_keys = OFF');

// Migrate single-row teacher tables to per-teacher-key schema
{
    const cols = db.prepare("PRAGMA table_info(teacher_profile)").all();
    if (cols.length > 0 && !cols.some(c => c.name === 'teacher_key')) {
        db.exec(`
            DROP TABLE IF EXISTS class_students;
            DROP TABLE IF EXISTS classes;
            DROP TABLE IF EXISTS assignment_settings;
            DROP TABLE IF EXISTS gradebook_settings;
            DROP TABLE IF EXISTS teacher_profile;
        `);
    }
}

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        user_key    TEXT    PRIMARY KEY,
        email       TEXT    NOT NULL UNIQUE,
        first_seen  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kenken_scores (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_key     TEXT    NOT NULL REFERENCES users(user_key),
        score        REAL    NOT NULL,
        size         INTEGER NOT NULL,
        submitted_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sat_scores (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_key     TEXT    NOT NULL REFERENCES users(user_key),
        correct      INTEGER NOT NULL,
        domain_idx   INTEGER NOT NULL,
        skill        TEXT    NOT NULL DEFAULT '',
        difficulty   TEXT    NOT NULL,
        submitted_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sat_math_scores (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_key     TEXT    NOT NULL REFERENCES users(user_key),
        correct      INTEGER NOT NULL,
        domain_idx   INTEGER NOT NULL,
        skill        TEXT    NOT NULL DEFAULT '',
        difficulty   TEXT    NOT NULL,
        submitted_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT    PRIMARY KEY,
        user_key   TEXT    NOT NULL REFERENCES users(user_key),
        created_at INTEGER NOT NULL,
        last_seen  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kenken_user    ON kenken_scores(user_key);
    CREATE INDEX IF NOT EXISTS idx_sat_user       ON sat_scores(user_key);
    CREATE INDEX IF NOT EXISTS idx_sat_math_user  ON sat_math_scores(user_key);
    CREATE INDEX IF NOT EXISTS idx_sessions_user  ON sessions(user_key);

    CREATE TABLE IF NOT EXISTS teacher_profile (
        teacher_key TEXT PRIMARY KEY,
        name        TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS gradebook_settings (
        teacher_key             TEXT PRIMARY KEY,
        assignment_max_score    REAL NOT NULL DEFAULT 100,
        completion_score_pct    REAL NOT NULL DEFAULT 100,
        no_submission_score_pct REAL NOT NULL DEFAULT 0
    );

    -- required_activity: 'kenken' | 'sat' | 'both' | 'either'
    CREATE TABLE IF NOT EXISTS assignment_settings (
        teacher_key           TEXT    PRIMARY KEY,
        required_activity     TEXT    NOT NULL DEFAULT 'either',
        required_kenken_count INTEGER NOT NULL DEFAULT 1,
        required_sat_count    INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS classes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_key TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        created_at  INTEGER NOT NULL
    );

    -- student_id is the school-assigned ID from CSV
    -- user_key links to app account; nullable until teacher maps the student
    CREATE TABLE IF NOT EXISTS class_students (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id     INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        student_id   TEXT    NOT NULL,
        student_name TEXT    NOT NULL,
        user_key     TEXT    REFERENCES users(user_key),
        UNIQUE(class_id, student_id)
    );

    CREATE INDEX IF NOT EXISTS idx_class_students_class ON class_students(class_id);
    CREATE INDEX IF NOT EXISTS idx_class_students_user  ON class_students(user_key);

    -- Microcredential templates (reusable across classes)
    CREATE TABLE IF NOT EXISTS microcredentials (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_key TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        created_at  INTEGER NOT NULL,
        UNIQUE(teacher_key, name)
    );

    -- Ordered checkpoints within a microcredential
    CREATE TABLE IF NOT EXISTS mc_checkpoints (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        mc_id     INTEGER NOT NULL REFERENCES microcredentials(id) ON DELETE CASCADE,
        name      TEXT    NOT NULL,
        order_idx INTEGER NOT NULL
    );

    -- Assigns a microcredential template to a class; stores summative PS assignment IDs for re-sync
    CREATE TABLE IF NOT EXISTS mc_class_assignments (
        mc_id                             INTEGER NOT NULL REFERENCES microcredentials(id) ON DELETE CASCADE,
        class_id                          INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        summative_ps_assignment_id        TEXT,
        summative_ps_assignmentsection_id TEXT,
        PRIMARY KEY (mc_id, class_id)
    );

    -- Per-checkpoint PS assignment IDs, scoped per class for re-sync
    CREATE TABLE IF NOT EXISTS mc_checkpoint_sync (
        checkpoint_id           INTEGER NOT NULL REFERENCES mc_checkpoints(id) ON DELETE CASCADE,
        class_id                INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        ps_assignment_id        TEXT,
        ps_assignmentsection_id TEXT,
        PRIMARY KEY (checkpoint_id, class_id)
    );

    -- One row per completed checkpoint per student per class
    CREATE TABLE IF NOT EXISTS mc_completions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        checkpoint_id INTEGER NOT NULL REFERENCES mc_checkpoints(id) ON DELETE CASCADE,
        class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        student_id    TEXT    NOT NULL,
        completed_at  INTEGER NOT NULL,
        UNIQUE(checkpoint_id, class_id, student_id)
    );

    CREATE INDEX IF NOT EXISTS idx_mc_checkpoints_mc    ON mc_checkpoints(mc_id);
    CREATE INDEX IF NOT EXISTS idx_mc_completions_cp    ON mc_completions(checkpoint_id, class_id);
    CREATE INDEX IF NOT EXISTS idx_mc_completions_class ON mc_completions(class_id);

    -- Sub-tasks within a checkpoint
    CREATE TABLE IF NOT EXISTS mc_subtasks (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        checkpoint_id INTEGER NOT NULL REFERENCES mc_checkpoints(id) ON DELETE CASCADE,
        name          TEXT    NOT NULL,
        order_idx     INTEGER NOT NULL
    );

    -- Per-student sub-task completion
    CREATE TABLE IF NOT EXISTS mc_subtask_completions (
        subtask_id   INTEGER NOT NULL REFERENCES mc_subtasks(id) ON DELETE CASCADE,
        class_id     INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        student_id   TEXT    NOT NULL,
        completed_at INTEGER NOT NULL,
        UNIQUE(subtask_id, class_id, student_id)
    );

    CREATE INDEX IF NOT EXISTS idx_mc_subtasks_cp   ON mc_subtasks(checkpoint_id);
    CREATE INDEX IF NOT EXISTS idx_mc_subtask_comps ON mc_subtask_completions(subtask_id, class_id);

    -- Daily rubric scores per student per date
    CREATE TABLE IF NOT EXISTS daily_rubric (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        student_id      TEXT    NOT NULL,
        date            TEXT    NOT NULL,
        timeliness      INTEGER NOT NULL DEFAULT 0,
        problem_solving INTEGER NOT NULL DEFAULT 3,
        task_completion INTEGER NOT NULL DEFAULT 3,
        total           INTEGER NOT NULL,
        submitted_at    INTEGER NOT NULL,
        UNIQUE(class_id, student_id, date)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_rubric_class_date ON daily_rubric(class_id, date);

    -- Question reports (one per student per question; 2+ unique reporters = suspended)
    CREATE TABLE IF NOT EXISTS question_reports (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id TEXT    NOT NULL,
        subject     TEXT    NOT NULL CHECK(subject IN ('math','english')),
        user_key    TEXT    NOT NULL,
        reported_at INTEGER NOT NULL,
        UNIQUE(question_id, user_key)
    );
    CREATE INDEX IF NOT EXISTS idx_qreports_qid ON question_reports(question_id, subject);

    -- Permanently suppressed questions (teacher-driven removal from pool)
    CREATE TABLE IF NOT EXISTS suppressed_questions (
        question_id   TEXT    NOT NULL,
        subject       TEXT    NOT NULL CHECK(subject IN ('math','english')),
        suppressed_at INTEGER NOT NULL,
        PRIMARY KEY(question_id, subject)
    );
`);

db.exec(`CREATE TABLE IF NOT EXISTS teacher_sessions (
    token      TEXT    PRIMARY KEY,
    user_key   TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL
)`);

// IT Help Desk: asset management + ticketing
db.exec(`
    CREATE TABLE IF NOT EXISTS it_students (
        student_id   TEXT PRIMARY KEY,
        first_name   TEXT NOT NULL,
        last_name    TEXT NOT NULL,
        grade_level  TEXT,
        advisor_name TEXT
    );

    -- email is optional; when known it lets a staff requester's own ticket
    -- ("Device Owner: Myself") resolve straight to their staff_number
    CREATE TABLE IF NOT EXISTS it_staff (
        staff_number TEXT PRIMARY KEY,
        first_name   TEXT NOT NULL,
        last_name    TEXT NOT NULL,
        email        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_it_staff_email ON it_staff(email);

    -- assigned_type: 'student' | 'staff' | 'cart' | NULL (unassigned)
    CREATE TABLE IF NOT EXISTS it_assets (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        serial_number         TEXT    NOT NULL UNIQUE,
        asset_number          TEXT,
        assigned_type         TEXT    CHECK(assigned_type IN ('student','staff','cart')),
        assigned_student_id   TEXT    REFERENCES it_students(student_id),
        assigned_staff_number TEXT    REFERENCES it_staff(staff_number),
        assigned_cart_name    TEXT,
        device_status         TEXT    NOT NULL DEFAULT 'working' CHECK(device_status IN ('working','missing','locked','in shop')),
        repair_status         TEXT    CHECK(repair_status IN ('not started','in progress','complete')),
        created_at            INTEGER NOT NULL,
        updated_at            INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_it_assets_student ON it_assets(assigned_student_id);
    CREATE INDEX IF NOT EXISTS idx_it_assets_staff   ON it_assets(assigned_staff_number);
    CREATE INDEX IF NOT EXISTS idx_it_assets_status  ON it_assets(device_status);

    -- category: 'Hardware' | 'Software' | 'Accounts' | 'Whitelist/Blacklist Request' | 'DobbsCore' | 'Other'
    -- priority: 'Low' | 'Medium' | 'High' | 'Urgent'
    -- status:   'Open' | 'In Progress' | 'Completed'
    CREATE TABLE IF NOT EXISTS it_tickets (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_user_key  TEXT    NOT NULL REFERENCES users(user_key),
        requester_name      TEXT    NOT NULL,
        requester_email     TEXT    NOT NULL,
        room_number         TEXT,
        category            TEXT    NOT NULL,
        priority            TEXT    NOT NULL,
        note                TEXT    NOT NULL DEFAULT '',
        linked_asset_id     INTEGER REFERENCES it_assets(id),
        status              TEXT    NOT NULL DEFAULT 'Open',
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_it_tickets_requester ON it_tickets(requester_user_key);
    CREATE INDEX IF NOT EXISTS idx_it_tickets_status    ON it_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_it_tickets_asset     ON it_tickets(linked_asset_id);

    -- event_type: 'created' | 'status_change' | 'note' — append-only audit log
    CREATE TABLE IF NOT EXISTS it_ticket_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id   INTEGER NOT NULL REFERENCES it_tickets(id) ON DELETE CASCADE,
        event_type  TEXT    NOT NULL,
        actor_email TEXT    NOT NULL,
        detail      TEXT    NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_it_ticket_events_ticket ON it_ticket_events(ticket_id);
`);

// ============================================================================
// WBL Assessment Framework — see WBL_Schema_Design.md
//
// `program` is the unit of progression (curriculum, credentials, phase);
// `class` is the unit of roster and gradebook. Keying student history to the
// program is what lets credentials and Phase 2 survive a section change or a
// new school year.
// ============================================================================
db.exec(`
    -- The WBL environment: Apparel Decoration, Carpentry Job Shop, etc.
    -- Ownership lives HERE and is not denormalized onto child tables.
    CREATE TABLE IF NOT EXISTS wbl_programs (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_key            TEXT    NOT NULL,
        name                   TEXT    NOT NULL,
        description            TEXT    NOT NULL DEFAULT '',
        qc_max_weeks_unchecked INTEGER NOT NULL DEFAULT 3,
        shareable              INTEGER NOT NULL DEFAULT 0,
        archived_at            INTEGER,
        created_at             INTEGER NOT NULL,
        UNIQUE(teacher_key, name)
    );

    -- Many-to-many: one class period can span two sectors.
    CREATE TABLE IF NOT EXISTS wbl_class_programs (
        class_id   INTEGER NOT NULL REFERENCES classes(id),
        program_id INTEGER NOT NULL REFERENCES wbl_programs(id),
        PRIMARY KEY (class_id, program_id)
    );

    -- Catalog copies for parity. Recorded as a relationship, not a flag, so
    -- drift against the source stays detectable.
    CREATE TABLE IF NOT EXISTS wbl_program_imports (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        target_program_id INTEGER NOT NULL REFERENCES wbl_programs(id),
        source_program_id INTEGER NOT NULL REFERENCES wbl_programs(id),
        mode              TEXT    NOT NULL DEFAULT 'tracked' CHECK(mode IN ('snapshot','tracked')),
        imported_by       TEXT    NOT NULL,
        imported_at       INTEGER NOT NULL,
        UNIQUE(target_program_id, source_program_id)
    );

    -- min_holistic_tier: technique only counts toward mastery on work that
    -- shipped acceptably.
    CREATE TABLE IF NOT EXISTS wbl_credentials (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        program_id           INTEGER NOT NULL REFERENCES wbl_programs(id),
        name                 TEXT    NOT NULL,
        description          TEXT    NOT NULL DEFAULT '',
        min_holistic_tier    TEXT    NOT NULL DEFAULT 'meets',
        order_idx            INTEGER NOT NULL DEFAULT 0,
        source_credential_id INTEGER REFERENCES wbl_credentials(id),
        archived_at          INTEGER,
        created_at           INTEGER NOT NULL,
        UNIQUE(program_id, name)
    );

    -- Skill LINEAGE: stable identity across versions; carries no definition.
    CREATE TABLE IF NOT EXISTS wbl_skills (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        program_id      INTEGER NOT NULL REFERENCES wbl_programs(id),
        slug            TEXT    NOT NULL,
        source_skill_id INTEGER REFERENCES wbl_skills(id),
        archived_at     INTEGER,
        created_at      INTEGER NOT NULL,
        UNIQUE(program_id, slug)
    );

    -- Versioned rather than edited in place. A published version is immutable.
    CREATE TABLE IF NOT EXISTS wbl_skill_versions (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id          INTEGER NOT NULL REFERENCES wbl_skills(id),
        version_no        INTEGER NOT NULL,
        name              TEXT    NOT NULL,
        description       TEXT    NOT NULL DEFAULT '',
        status            TEXT    NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','retired')),
        is_current        INTEGER NOT NULL DEFAULT 0,
        change_note       TEXT    NOT NULL DEFAULT '',
        source_version_id INTEGER REFERENCES wbl_skill_versions(id),
        source_version_no INTEGER,
        published_at      INTEGER,
        created_at        INTEGER NOT NULL,
        UNIQUE(skill_id, version_no)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wbl_skill_current
        ON wbl_skill_versions(skill_id) WHERE is_current = 1;

    -- The mastery checklist, owned by the VERSION.
    CREATE TABLE IF NOT EXISTS wbl_skill_criteria (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_version_id INTEGER NOT NULL REFERENCES wbl_skill_versions(id),
        name             TEXT    NOT NULL,
        order_idx        INTEGER NOT NULL
    );

    -- Requirements reference the LINEAGE, so v1 evidence still counts after v2.
    CREATE TABLE IF NOT EXISTS wbl_credential_skills (
        credential_id           INTEGER NOT NULL REFERENCES wbl_credentials(id),
        skill_id                INTEGER NOT NULL REFERENCES wbl_skills(id),
        required_demonstrations INTEGER NOT NULL DEFAULT 2,
        order_idx               INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (credential_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS wbl_qc_criteria (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        program_id          INTEGER NOT NULL REFERENCES wbl_programs(id),
        name                TEXT    NOT NULL,
        description         TEXT    NOT NULL DEFAULT '',
        order_idx           INTEGER NOT NULL DEFAULT 0,
        source_criterion_id INTEGER REFERENCES wbl_qc_criteria(id),
        archived_at         INTEGER,
        created_at          INTEGER NOT NULL
    );

    -- Fixed vocabularies (seeded below).
    CREATE TABLE IF NOT EXISTS wbl_soft_skills (
        code      TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        category  TEXT NOT NULL CHECK(category IN ('dispositional','transfer')),
        order_idx INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS wbl_holistic_tiers (
        tier  TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        rank  INTEGER NOT NULL
    );

    -- Enrollment is a fact in its own right, not inferred from class rosters.
    CREATE TABLE IF NOT EXISTS wbl_program_enrollments (
        program_id   INTEGER NOT NULL REFERENCES wbl_programs(id),
        student_id   TEXT    NOT NULL,
        pathway_year INTEGER NOT NULL DEFAULT 1,
        enrolled_on  TEXT    NOT NULL,
        exited_on    TEXT,
        exit_reason  TEXT    NOT NULL DEFAULT '',
        updated_at   INTEGER NOT NULL,
        PRIMARY KEY (program_id, student_id)
    );
    CREATE INDEX IF NOT EXISTS idx_wbl_enroll_active
        ON wbl_program_enrollments(program_id) WHERE exited_on IS NULL;

    CREATE TABLE IF NOT EXISTS wbl_phase2_prereqs (
        program_id    INTEGER NOT NULL REFERENCES wbl_programs(id),
        credential_id INTEGER NOT NULL REFERENCES wbl_credentials(id),
        PRIMARY KEY (program_id, credential_id)
    );

    -- Effective phase = COALESCE(override_phase, computed_phase).
    CREATE TABLE IF NOT EXISTS wbl_student_phase (
        program_id      INTEGER NOT NULL REFERENCES wbl_programs(id),
        student_id      TEXT    NOT NULL,
        computed_phase  INTEGER NOT NULL DEFAULT 1 CHECK(computed_phase IN (1,2)),
        override_phase  INTEGER CHECK(override_phase IN (1,2)),
        override_by     TEXT    NOT NULL DEFAULT '',
        override_note   TEXT    NOT NULL DEFAULT '',
        transitioned_at INTEGER,
        updated_at      INTEGER NOT NULL,
        PRIMARY KEY (program_id, student_id)
    );

    -- Phase 1 scaffolding: dispositional openings per instructor-designed unit.
    CREATE TABLE IF NOT EXISTS wbl_skill_openings (
        skill_id        INTEGER NOT NULL REFERENCES wbl_skills(id),
        soft_skill_code TEXT    NOT NULL REFERENCES wbl_soft_skills(code),
        PRIMARY KEY (skill_id, soft_skill_code)
    );

    -- The shared job. No class_id: participants carry their own section.
    CREATE TABLE IF NOT EXISTS wbl_work_events (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        program_id   INTEGER NOT NULL REFERENCES wbl_programs(id),
        title        TEXT    NOT NULL,
        external_ref TEXT,
        description  TEXT    NOT NULL DEFAULT '',
        status       TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','complete','cancelled')),
        opened_on    TEXT    NOT NULL,
        closed_on    TEXT,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
    );

    -- Which skills a job is expected to exercise — advisory, not a gate. The
    -- Hard Skills lens uses this to lead with the planned set, but every
    -- published skill in the program stays reachable, since real jobs surface
    -- skills nobody planned for.
    CREATE TABLE IF NOT EXISTS wbl_work_event_skills (
        work_event_id INTEGER NOT NULL REFERENCES wbl_work_events(id),
        skill_id      INTEGER NOT NULL REFERENCES wbl_skills(id),
        PRIMARY KEY (work_event_id, skill_id)
    );

    -- The row every assessment hangs off - all three lenses point here.
    -- phase_at_start keeps the record honest after a student advances.
    CREATE TABLE IF NOT EXISTS wbl_work_event_participants (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        work_event_id  INTEGER NOT NULL REFERENCES wbl_work_events(id),
        class_id       INTEGER NOT NULL REFERENCES classes(id),
        student_id     TEXT    NOT NULL,
        role           TEXT    NOT NULL DEFAULT '',
        phase_at_start INTEGER NOT NULL DEFAULT 1 CHECK(phase_at_start IN (1,2)),
        joined_on      TEXT    NOT NULL,
        left_on        TEXT,
        UNIQUE(work_event_id, student_id)
    );

    -- Lens 1: hard skills. skill_version_id is PINNED at assessment time.
    CREATE TABLE IF NOT EXISTS wbl_skill_assessments (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        participant_id   INTEGER NOT NULL REFERENCES wbl_work_event_participants(id),
        work_event_id    INTEGER NOT NULL REFERENCES wbl_work_events(id),
        program_id       INTEGER NOT NULL,
        class_id         INTEGER NOT NULL,
        student_id       TEXT    NOT NULL,
        skill_id         INTEGER NOT NULL REFERENCES wbl_skills(id),
        skill_version_id INTEGER NOT NULL REFERENCES wbl_skill_versions(id),
        result           TEXT    NOT NULL CHECK(result IN ('not_demonstrated','developing','mastered')),
        note             TEXT    NOT NULL DEFAULT '',
        assessed_by      TEXT    NOT NULL,
        assessed_at      INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL,
        UNIQUE(participant_id, skill_id)
    );
    CREATE TABLE IF NOT EXISTS wbl_skill_criterion_results (
        assessment_id INTEGER NOT NULL REFERENCES wbl_skill_assessments(id),
        criterion_id  INTEGER NOT NULL REFERENCES wbl_skill_criteria(id),
        met           INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (assessment_id, criterion_id)
    );

    -- Lens 2a: QC spot check. The UNIQUE constraint IS the weekly cap.
    CREATE TABLE IF NOT EXISTS wbl_qc_checks (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        participant_id INTEGER NOT NULL REFERENCES wbl_work_event_participants(id),
        work_event_id  INTEGER NOT NULL,
        program_id     INTEGER NOT NULL,
        class_id       INTEGER NOT NULL,
        student_id     TEXT    NOT NULL,
        iso_week       TEXT    NOT NULL,
        checked_on     TEXT    NOT NULL,
        checked_by     TEXT    NOT NULL,
        note           TEXT    NOT NULL DEFAULT '',
        created_at     INTEGER NOT NULL,
        UNIQUE(program_id, student_id, iso_week)
    );
    CREATE TABLE IF NOT EXISTS wbl_qc_check_results (
        check_id     INTEGER NOT NULL REFERENCES wbl_qc_checks(id),
        criterion_id INTEGER NOT NULL REFERENCES wbl_qc_criteria(id),
        outcome      TEXT    NOT NULL CHECK(outcome IN ('pass','fail','na')),
        note         TEXT    NOT NULL DEFAULT '',
        PRIMARY KEY (check_id, criterion_id)
    );

    -- Lens 2b: the verdict. Informed by QC history, never averaged from it.
    CREATE TABLE IF NOT EXISTS wbl_holistic_calls (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        participant_id INTEGER NOT NULL REFERENCES wbl_work_event_participants(id),
        work_event_id  INTEGER NOT NULL,
        program_id     INTEGER NOT NULL,
        class_id       INTEGER NOT NULL,
        student_id     TEXT    NOT NULL,
        tier           TEXT    NOT NULL REFERENCES wbl_holistic_tiers(tier),
        rationale      TEXT    NOT NULL DEFAULT '',
        called_by      TEXT    NOT NULL,
        called_at      INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        UNIQUE(participant_id)
    );

    -- Lens 3a: dispositional. Formative only - note there is no points column
    -- anywhere here, so scoring these would require a schema change.
    CREATE TABLE IF NOT EXISTS wbl_do_nows (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        program_id   INTEGER NOT NULL REFERENCES wbl_programs(id),
        class_id     INTEGER NOT NULL REFERENCES classes(id),
        student_id   TEXT    NOT NULL,
        date         TEXT    NOT NULL,
        submitted_at INTEGER NOT NULL,
        UNIQUE(program_id, student_id, date)
    );
    CREATE TABLE IF NOT EXISTS wbl_do_now_skills (
        do_now_id       INTEGER NOT NULL REFERENCES wbl_do_nows(id),
        soft_skill_code TEXT    NOT NULL REFERENCES wbl_soft_skills(code),
        from_skill_id   INTEGER REFERENCES wbl_skills(id),
        PRIMARY KEY (do_now_id, soft_skill_code)
    );

    -- IMMUTABLE: note the deliberate absence of updated_at. Enforced by
    -- trigger below, not by convention.
    CREATE TABLE IF NOT EXISTS wbl_exit_slips (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        do_now_id       INTEGER NOT NULL REFERENCES wbl_do_nows(id),
        program_id      INTEGER NOT NULL,
        class_id        INTEGER NOT NULL,
        student_id      TEXT    NOT NULL,
        date            TEXT    NOT NULL,
        work_event_id   INTEGER REFERENCES wbl_work_events(id),
        soft_skill_code TEXT    NOT NULL REFERENCES wbl_soft_skills(code),
        narrative       TEXT    NOT NULL,
        submitted_at    INTEGER NOT NULL,
        UNIQUE(do_now_id, soft_skill_code)
    );

    -- Confidence gradient as data, not a credited flag. NO row =
    -- student_claimed; append-only so a later witnessing doesn't erase a
    -- prior verification.
    CREATE TABLE IF NOT EXISTS wbl_exit_slip_verifications (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        exit_slip_id INTEGER NOT NULL REFERENCES wbl_exit_slips(id),
        confidence   TEXT    NOT NULL CHECK(confidence IN ('instructor_verified','instructor_witnessed')),
        verified_by  TEXT    NOT NULL,
        note         TEXT    NOT NULL DEFAULT '',
        verified_at  INTEGER NOT NULL
    );

    -- Escape hatch for junk submissions. The slip is never mutated.
    CREATE TABLE IF NOT EXISTS wbl_exit_slip_voids (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        exit_slip_id INTEGER NOT NULL REFERENCES wbl_exit_slips(id),
        reason       TEXT    NOT NULL,
        voided_by    TEXT    NOT NULL,
        voided_at    INTEGER NOT NULL,
        UNIQUE(exit_slip_id)
    );

    -- Feedback delivered FORWARD via the next Do Now, never as a correction.
    CREATE TABLE IF NOT EXISTS wbl_dispositional_feedback (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        program_id          INTEGER NOT NULL,
        student_id          TEXT    NOT NULL,
        exit_slip_id        INTEGER REFERENCES wbl_exit_slips(id),
        body                TEXT    NOT NULL,
        author_key          TEXT    NOT NULL,
        created_at          INTEGER NOT NULL,
        delivered_do_now_id INTEGER REFERENCES wbl_do_nows(id),
        delivered_at        INTEGER
    );

    -- Lens 3b: transfer. cited_program_id MAY differ from program_id.
    CREATE TABLE IF NOT EXISTS wbl_transfer_claims (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        participant_id      INTEGER NOT NULL REFERENCES wbl_work_event_participants(id),
        work_event_id       INTEGER NOT NULL,
        program_id          INTEGER NOT NULL,
        class_id            INTEGER NOT NULL,
        student_id          TEXT    NOT NULL,
        kind                TEXT    NOT NULL CHECK(kind IN ('application','extension')),
        cited_skill_id      INTEGER REFERENCES wbl_skills(id),
        cited_credential_id INTEGER REFERENCES wbl_credentials(id),
        cited_program_id    INTEGER REFERENCES wbl_programs(id),
        new_capability      TEXT    NOT NULL DEFAULT '',
        claim_text          TEXT    NOT NULL,
        submitted_at        INTEGER NOT NULL,
        verdict             TEXT    CHECK(verdict IN ('verified','citation_not_on_record','not_novel','insufficient')),
        score               REAL,
        verify_note         TEXT    NOT NULL DEFAULT '',
        verified_by         TEXT,
        verified_at         INTEGER,
        UNIQUE(participant_id, kind)
    );

    -- Keyed to the STUDENT within a PROGRAM, not to a class: credentials
    -- survive section changes and school years.
    CREATE TABLE IF NOT EXISTS wbl_credential_awards (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        credential_id      INTEGER NOT NULL REFERENCES wbl_credentials(id),
        program_id         INTEGER NOT NULL REFERENCES wbl_programs(id),
        student_id         TEXT    NOT NULL,
        earned_in_class_id INTEGER REFERENCES classes(id),
        awarded_at         INTEGER NOT NULL,
        source             TEXT    NOT NULL DEFAULT 'auto' CHECK(source IN ('auto','manual','migrated')),
        awarded_by         TEXT    NOT NULL DEFAULT '',
        note               TEXT    NOT NULL DEFAULT '',
        revoked_at         INTEGER,
        revoked_note       TEXT    NOT NULL DEFAULT '',
        UNIQUE(credential_id, student_id)
    );
    CREATE TABLE IF NOT EXISTS wbl_award_evidence (
        award_id      INTEGER NOT NULL REFERENCES wbl_credential_awards(id),
        skill_id      INTEGER NOT NULL,
        assessment_id INTEGER NOT NULL REFERENCES wbl_skill_assessments(id),
        PRIMARY KEY (award_id, assessment_id)
    );

    -- PS sync stays CLASS-keyed (a grade pushes to a section) even though
    -- progression is program-keyed. The server never talks to PowerSchool -
    -- these only store what the DobbsCore extension created.
    CREATE TABLE IF NOT EXISTS wbl_credential_sync (
        credential_id           INTEGER NOT NULL REFERENCES wbl_credentials(id),
        class_id                INTEGER NOT NULL REFERENCES classes(id),
        ps_assignment_id        TEXT,
        ps_assignmentsection_id TEXT,
        sync_enabled            INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (credential_id, class_id)
    );
    -- One formative PS assignment per skill WITHIN a credential. Keyed on the
    -- pair because a skill may be required by two credentials with different
    -- thresholds, so it can be satisfied for one and not the other.
    CREATE TABLE IF NOT EXISTS wbl_credential_skill_sync (
        credential_id           INTEGER NOT NULL REFERENCES wbl_credentials(id),
        skill_id                INTEGER NOT NULL REFERENCES wbl_skills(id),
        class_id                INTEGER NOT NULL REFERENCES classes(id),
        ps_assignment_id        TEXT,
        ps_assignmentsection_id TEXT,
        sync_enabled            INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (credential_id, skill_id, class_id)
    );

    CREATE TABLE IF NOT EXISTS wbl_work_event_sync (
        work_event_id           INTEGER NOT NULL REFERENCES wbl_work_events(id),
        class_id                INTEGER NOT NULL,
        ps_assignment_id        TEXT,
        ps_assignmentsection_id TEXT,
        sync_enabled            INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (work_event_id, class_id)
    );
    CREATE TABLE IF NOT EXISTS wbl_transfer_sync (
        class_id                INTEGER NOT NULL,
        kind                    TEXT    NOT NULL CHECK(kind IN ('application','extension')),
        ps_assignment_id        TEXT,
        ps_assignmentsection_id TEXT,
        sync_enabled            INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (class_id, kind)
    );
    CREATE TABLE IF NOT EXISTS wbl_holistic_tier_points (
        program_id INTEGER NOT NULL REFERENCES wbl_programs(id),
        tier       TEXT    NOT NULL REFERENCES wbl_holistic_tiers(tier),
        points_pct REAL    NOT NULL,
        PRIMARY KEY (program_id, tier)
    );

    CREATE INDEX IF NOT EXISTS idx_wbl_programs_teacher     ON wbl_programs(teacher_key);
    CREATE INDEX IF NOT EXISTS idx_wbl_class_programs_prog  ON wbl_class_programs(program_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_prog_imports_src     ON wbl_program_imports(source_program_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_credentials_prog     ON wbl_credentials(program_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_skills_prog          ON wbl_skills(program_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_skill_versions_skill ON wbl_skill_versions(skill_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_skill_criteria_ver   ON wbl_skill_criteria(skill_version_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_qc_criteria_prog     ON wbl_qc_criteria(program_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_we_program           ON wbl_work_events(program_id, status);
    CREATE INDEX IF NOT EXISTS idx_wbl_wep_event            ON wbl_work_event_participants(work_event_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_wep_student          ON wbl_work_event_participants(student_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_wep_class            ON wbl_work_event_participants(class_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_sa_student           ON wbl_skill_assessments(program_id, student_id, skill_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_sa_event             ON wbl_skill_assessments(work_event_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_qc_student           ON wbl_qc_checks(program_id, student_id, iso_week);
    CREATE INDEX IF NOT EXISTS idx_wbl_qc_event             ON wbl_qc_checks(work_event_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_hc_student           ON wbl_holistic_calls(program_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_donow_student        ON wbl_do_nows(program_id, student_id, date);
    CREATE INDEX IF NOT EXISTS idx_wbl_slip_student         ON wbl_exit_slips(program_id, student_id, date);
    CREATE INDEX IF NOT EXISTS idx_wbl_slip_donow           ON wbl_exit_slips(do_now_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_tc_student           ON wbl_transfer_claims(program_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_awards_student       ON wbl_credential_awards(program_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_wbl_fb_undelivered       ON wbl_dispositional_feedback(program_id, student_id) WHERE delivered_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_wbl_tc_pending           ON wbl_transfer_claims(program_id) WHERE verdict IS NULL;
`);

// Invariants the framework rests on, enforced by the database. Triggers fire
// regardless of the foreign_keys pragma, unlike REFERENCES above.
db.exec(`
    -- "one (capped at two) dispositional skill(s)"
    CREATE TRIGGER IF NOT EXISTS trg_wbl_do_now_skill_cap
    BEFORE INSERT ON wbl_do_now_skills
    FOR EACH ROW
    WHEN (SELECT COUNT(*) FROM wbl_do_now_skills WHERE do_now_id = NEW.do_now_id) >= 2
    BEGIN
        SELECT RAISE(ABORT, 'A Do Now may focus on at most two dispositional skills');
    END;

    -- "Exit Slip entries are never edited or resubmitted." DELETE is
    -- deliberately permitted: editing falsifies invisibly, deletion is
    -- auditable by absence, and records-retention purges must stay possible.
    CREATE TRIGGER IF NOT EXISTS trg_wbl_exit_slip_no_update
    BEFORE UPDATE ON wbl_exit_slips
    FOR EACH ROW
    BEGIN
        SELECT RAISE(ABORT, 'Exit slips are immutable - record a void instead');
    END;

    -- A published skill version's CONTENT cannot change, only be superseded.
    -- Narrowed to name/description so publish and retire still work.
    CREATE TRIGGER IF NOT EXISTS trg_wbl_skill_version_published_immutable
    BEFORE UPDATE OF name, description ON wbl_skill_versions
    FOR EACH ROW WHEN OLD.status = 'published'
    BEGIN
        SELECT RAISE(ABORT, 'Published skill versions are immutable - publish a new version');
    END;
`);

// Seed the fixed vocabularies. These are framework mechanics, not per-program
// content, which is why they are seeded rather than authored.
{
    const softSkill = db.prepare(
        'INSERT OR IGNORE INTO wbl_soft_skills(code, name, category, order_idx) VALUES(?, ?, ?, ?)'
    );
    [
        ['persistence',                       'Persistence',                       'dispositional', 1],
        ['commitment_to_excellence',          'Commitment to Excellence',          'dispositional', 2],
        ['academic_curiosity',                'Academic Curiosity',                'dispositional', 3],
        ['application_of_previous_knowledge', 'Application of Previous Knowledge', 'transfer',      4],
        ['extension_of_knowledge',            'Extension of Knowledge',            'transfer',      5],
    ].forEach(r => softSkill.run(...r));

    const tier = db.prepare(
        'INSERT OR IGNORE INTO wbl_holistic_tiers(tier, label, rank) VALUES(?, ?, ?)'
    );
    [
        ['not_shippable', 'Not shippable', 0],
        ['rework',        'Rework needed', 1],
        ['meets',         'Meets spec',    2],
        ['exceeds',       'Exceeds spec',  3],
    ].forEach(r => tier.run(...r));
}

// One-time migrations
try { db.prepare('ALTER TABLE classes ADD COLUMN ps_section_id TEXT').run(); } catch { /* already exists */ }
try { db.prepare('ALTER TABLE class_students ADD COLUMN ps_dcid TEXT').run(); } catch { /* already exists */ }
try { db.prepare("ALTER TABLE mc_checkpoints ADD COLUMN description TEXT NOT NULL DEFAULT ''").run(); } catch { /* already exists */ }
try { db.prepare('ALTER TABLE gradebook_settings ADD COLUMN mc_subtask_max_score REAL NOT NULL DEFAULT 10').run(); } catch { /* already exists */ }
try { db.prepare('ALTER TABLE gradebook_settings ADD COLUMN mc_credential_max_score REAL NOT NULL DEFAULT 50').run(); } catch { /* already exists */ }
try { db.prepare('ALTER TABLE gradebook_settings ADD COLUMN mc_include_subtasks INTEGER NOT NULL DEFAULT 1').run(); } catch { /* already exists */ }
try { db.prepare('ALTER TABLE gradebook_settings ADD COLUMN rubric_max_score REAL NOT NULL DEFAULT 15').run(); } catch { /* already exists */ }
try { db.prepare('ALTER TABLE mc_class_assignments ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 1').run(); } catch { /* already exists */ }
try { db.prepare('ALTER TABLE mc_checkpoints ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 1').run(); } catch { /* already exists */ }
try { db.prepare('ALTER TABLE assignment_settings ADD COLUMN required_sat_math_count INTEGER NOT NULL DEFAULT 1').run(); } catch { /* already exists */ }
try { db.prepare("ALTER TABLE classes ADD COLUMN assessment_type TEXT NOT NULL DEFAULT 'sat'").run(); } catch { /* already exists */ }
try { db.prepare('ALTER TABLE classes ADD COLUMN sat_english_domains TEXT').run(); } catch { /* already exists */ }
try { db.prepare('ALTER TABLE classes ADD COLUMN sat_math_domains TEXT').run(); } catch { /* already exists */ }
try { db.prepare('ALTER TABLE gradebook_settings ADD COLUMN wbl_credential_max_score REAL NOT NULL DEFAULT 50').run(); } catch { /* already exists */ }
try { db.prepare('ALTER TABLE gradebook_settings ADD COLUMN wbl_holistic_max_score REAL NOT NULL DEFAULT 20').run(); } catch { /* already exists */ }
try { db.prepare('ALTER TABLE gradebook_settings ADD COLUMN wbl_transfer_max_score REAL NOT NULL DEFAULT 10').run(); } catch { /* already exists */ }

function upsertUser(userKey, email) {
    db.prepare(
        'INSERT OR IGNORE INTO users(user_key, email, first_seen) VALUES(?, ?, ?)'
    ).run(userKey, email, Date.now());
}

// Canonical student_id (WBL_Schema_Design.md decision 17). School IDs are
// numeric with inconsistent zero-padding across SIS exports, so "0012345",
// "12345" and "12345 " are one student. Non-numeric IDs are trimmed only —
// never stripped — so an alphanumeric scheme can't be silently mangled, and
// an all-zeros ID becomes "0" rather than an invisible empty-string key.
//
// NOTE: the DobbsCore extension matches students by exact key equality against
// PowerSchool's raw `studentnumber`. If PS reports it zero-padded, the same
// normalization must be applied there or every score silently fails to match.
function normalizeStudentId(raw) {
    const s = String(raw ?? '').trim();
    if (!/^\d+$/.test(s)) return s;
    const stripped = s.replace(/^0+/, '');
    return stripped === '' ? '0' : stripped;
}

module.exports = { db, upsertUser, normalizeStudentId };
