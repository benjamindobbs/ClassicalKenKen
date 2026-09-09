// Habits of Work (HoW) routes for NON-WBL classes — a parallel, class-scoped
// Do Now / Exit Slip flow. See `.refs/todo` and `.refs/Habits of Work Notes.md`.
//
// Mounted at /api/how. Deliberately separate from /api/wbl: keyed straight to a
// class (no program), carries the Dignitas / Pietas / Gravitas catalogue
// (server/how/catalog.js), and is available for any class NOT linked to a WBL
// program.
//
// A class runs in one of three modes, from classes.how_cadence + how_weekly_log
// (how_do_nows.cadence snapshots the mode at creation time):
//   'daily'      — one Do Now per calendar day; pick ONE category + bullet;
//                  one exit slip; teacher rates that one category.
//   'weekly'     — one Do Now per ISO week (date = that week's Monday); pick one
//                  bullet in EACH of the 3 categories; ONE end-of-week exit slip
//                  (self-rating + evidence + improve per category); teacher
//                  rates all 3.
//   'weekly_log' — like 'weekly', but the student adds short dated evidence
//                  notes per category through the week, and the exit slip only
//                  carries the self-rating + 'improve' (evidence is the log).
// All modes share the same tables and the PS sync (GET /sync) is driven purely
// by the teacher's per-category ratings, so its payload is identical for all.

const { Router } = require('express');
const { db, normalizeStudentId } = require('../db');
const { requireAuth } = require('../auth');
const { requireTeacher } = require('../teacherAuth');
const L = require('../wbl/logic');
const HOW = require('../how/catalog');

const router = Router();

// --- small helpers -----------------------------------------------------------

const bad  = (res, msg, extra = {}) => res.status(400).json({ error: msg, ...extra });
const nf   = (res, msg = 'not_found') => res.status(404).json({ error: msg });
const now  = () => Date.now();
const int  = v => (v == null || v === '' ? null : Number(v));
const str  = (v, d = '') => (v == null ? d : String(v));
const round2 = n => Math.round(n * 100) / 100;

// A teacher 1-4 rating on the 0-100 scale the extension scales against max
// points — mirrors WBL's `rating × 25` (server/wbl/logic.js:dispositionalScore).
const RATING_TO_PCT = 25;

// Monday (YYYY-MM-DD) of the ISO week containing dateStr, and simple day math.
function weekStart(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = d.getUTCDay() || 7;                 // Mon=1 … Sun=7
    d.setUTCDate(d.getUTCDate() - (day - 1));
    return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

const isWeekly = mode => mode === 'weekly' || mode === 'weekly_log';

// The class's current HoW mode: 'daily' | 'weekly' | 'weekly_log'.
const classMode = classId => {
    const c = db.prepare('SELECT how_cadence, how_weekly_log FROM classes WHERE id = ?').get(classId);
    if (!c || c.how_cadence !== 'weekly') return 'daily';
    return c.how_weekly_log ? 'weekly_log' : 'weekly';
};

// The Do Now key for `date` under a mode: the day itself, or its week Monday.
const periodKey = (mode, date) => (isWeekly(mode) ? weekStart(date) : date);

// Teacher owns the class AND it is not a WBL class (WBL classes use /api/wbl).
function ownedNonWblClass(req, res, classId) {
    if (!classId) { bad(res, 'class_id required'); return null; }
    const cls = db.prepare('SELECT id, name, how_cadence, how_weekly_log FROM classes WHERE id = ? AND teacher_key = ?')
        .get(classId, req.teacherKey);
    if (!cls) { nf(res, 'class_not_found'); return null; }
    if (db.prepare('SELECT 1 FROM wbl_class_programs WHERE class_id = ?').get(classId)) {
        res.status(409).json({ error: 'class_is_wbl', hint: 'Use Work-Based Learning sync for this class' });
        return null;
    }
    return cls;
}

function ownedSlip(req, res, id) {
    const slip = db.prepare(`
        SELECT es.id, es.class_id, es.do_now_id FROM how_exit_slips es
        JOIN classes c ON c.id = es.class_id
        WHERE es.id = ? AND c.teacher_key = ?
    `).get(Number(id), req.teacherKey);
    if (!slip) { nf(res, 'exit_slip_not_found'); return null; }
    return slip;
}

// Resolve the signed-in student; 404 for an unmapped roster, same as /api/wbl.
function meStudent(req, res) {
    const s = L.resolveStudent(req.userKey);
    if (!s) { res.status(404).json({ error: 'not_enrolled' }); return null; }
    return s;
}

const doNowSkills   = id => db.prepare('SELECT category, sub_bullet FROM how_do_now_skills WHERE do_now_id = ?').all(id);
const slipSelfRows  = id => db.prepare('SELECT category, goal_rating, evidence, improve FROM how_exit_slip_skills WHERE exit_slip_id = ?').all(id);
const slipRatingRows = id => db.prepare('SELECT category, rating, note FROM how_exit_slip_ratings WHERE exit_slip_id = ?').all(id);
const evidenceRows  = doNowId => db.prepare(
    'SELECT id, category, date, note, created_at FROM how_evidence_entries WHERE do_now_id = ? ORDER BY date, id'
).all(doNowId);

// =============================================================================
// Catalogue (both roles)
// =============================================================================

router.get('/catalog', (_req, res) => res.json({ categories: HOW.CATEGORIES }));

// =============================================================================
// Student — Do Now / Exit Slip
// =============================================================================

// Non-WBL classes the signed-in student is actively enrolled in, with the mode.
router.get('/me/classes', requireAuth, (req, res) => {
    const rows = db.prepare(`
        SELECT c.id AS class_id, c.name, c.how_cadence, c.how_weekly_log
        FROM class_students cs
        JOIN classes c ON c.id = cs.class_id
        WHERE cs.user_key = ? AND cs.exited_on IS NULL
          AND c.id NOT IN (SELECT class_id FROM wbl_class_programs)
        ORDER BY c.name
    `).all(req.userKey).map(c => ({
        class_id: c.class_id, name: c.name,
        cadence: c.how_cadence !== 'weekly' ? 'daily' : (c.how_weekly_log ? 'weekly_log' : 'weekly'),
    }));
    res.json({ classes: rows });
});

// This period's Do Now (and its Exit Slip / evidence log) for one class.
router.get('/me/day', requireAuth, (req, res) => {
    const s = meStudent(req, res); if (!s) return;
    const classId = int(req.query.class_id);
    if (!classId || !s.class_ids.includes(classId)) return bad(res, 'valid class_id required');
    const mode  = classMode(classId);
    const asked = L.isDate(req.query.date) ? req.query.date : L.today();
    const key   = periodKey(mode, asked);

    const doNow = db.prepare(
        'SELECT * FROM how_do_nows WHERE class_id = ? AND student_id = ? AND date = ?'
    ).get(classId, s.student_id, key);

    let exitSlip = null;
    if (doNow) {
        exitSlip = db.prepare('SELECT * FROM how_exit_slips WHERE do_now_id = ?').get(doNow.id) || null;
        if (exitSlip) {
            exitSlip = {
                ...exitSlip,
                skills: slipSelfRows(exitSlip.id),
                ratings: slipRatingRows(exitSlip.id),
                void_reason: db.prepare('SELECT reason FROM how_exit_slip_voids WHERE exit_slip_id = ?').get(exitSlip.id)?.reason ?? null,
            };
        }
    }
    res.json({
        date: key, period: isWeekly(mode) ? 'week' : 'day', cadence: mode, class_id: classId,
        week_start: isWeekly(mode) ? key : null,
        week_end:   isWeekly(mode) ? addDays(key, 6) : null,
        categories: HOW.CATEGORIES,
        do_now: doNow
            ? { ...doNow, skills: doNowSkills(doNow.id),
                evidence: doNow.cadence === 'weekly_log' ? evidenceRows(doNow.id) : [] }
            : null,
        exit_slip: exitSlip,
    });
});

// Normalises a Do Now body to a list of { category, sub_bullet } and validates
// it against the mode: daily = exactly one category; weekly / weekly_log =
// exactly one bullet in each of the 3 categories. Returns { skills } or { error }.
function readDoNowSkills(body, mode) {
    let list = Array.isArray(body?.skills) ? body.skills : null;
    if (!list && body?.category) list = [{ category: body.category, sub_bullet: body.sub_bullet }];
    if (!list || !list.length) return { error: 'skills required' };

    const seen = new Set();
    for (const it of list) {
        const c = str(it?.category), b = str(it?.sub_bullet);
        if (!HOW.isCategory(c)) return { error: `unknown category: ${c}` };
        if (!HOW.isBullet(b) || HOW.categoryOf(b) !== c) return { error: `sub_bullet must be a bullet of ${c}` };
        if (seen.has(c)) return { error: `category ${c} picked twice` };
        seen.add(c);
    }
    if (isWeekly(mode) && seen.size !== HOW.CATEGORY_CODES.length)
        return { error: 'weekly Do Now needs one goal in each of the 3 categories' };
    if (!isWeekly(mode) && seen.size !== 1)
        return { error: 'daily Do Now takes exactly one category' };
    return { skills: list.map(it => ({ category: str(it.category), sub_bullet: str(it.sub_bullet) })) };
}

// Pick focus bullet(s). One per class per period; immutable once set.
router.post('/me/do-now', requireAuth, (req, res) => {
    const s = meStudent(req, res); if (!s) return;
    const classId = int(req.body?.class_id);
    if (!classId || !s.class_ids.includes(classId)) return bad(res, 'valid class_id required');
    const mode   = classMode(classId);
    const parsed = readDoNowSkills(req.body, mode);
    if (parsed.error) return bad(res, parsed.error);

    const asked = L.isDate(req.body?.date) ? req.body.date : L.today();
    const key   = periodKey(mode, asked);

    db.exec('BEGIN');
    try {
        const info = db.prepare(
            'INSERT INTO how_do_nows(class_id, student_id, date, cadence, submitted_at) VALUES(?, ?, ?, ?, ?)'
        ).run(classId, s.student_id, key, mode, now());
        const doNowId = Number(info.lastInsertRowid);
        const ins = db.prepare('INSERT INTO how_do_now_skills(do_now_id, category, sub_bullet) VALUES(?, ?, ?)');
        for (const sk of parsed.skills) ins.run(doNowId, sk.category, sk.sub_bullet);
        db.exec('COMMIT');
        res.json({ ok: true, do_now_id: doNowId });
    } catch (e) {
        db.exec('ROLLBACK');
        if (String(e.message).includes('UNIQUE'))
            return res.status(409).json({ error: 'already_started', hint: 'one Do Now per class per period' });
        bad(res, e.message);
    }
});

// weekly_log only: add a dated evidence note for one category, any day of the
// week, until the exit slip closes the week. Append-only. Body:
// { do_now_id, category, note, date? }.
router.post('/me/evidence', requireAuth, (req, res) => {
    const s = meStudent(req, res); if (!s) return;
    const doNowId = int(req.body?.do_now_id);
    const category = str(req.body?.category);
    const note = str(req.body?.note).trim();
    if (!doNowId) return bad(res, 'do_now_id required');
    if (!note) return bad(res, 'note required');

    const dn = db.prepare('SELECT * FROM how_do_nows WHERE id = ? AND student_id = ?').get(doNowId, s.student_id);
    if (!dn) return nf(res, 'do_now_not_found');
    if (dn.cadence !== 'weekly_log') return bad(res, 'this class does not use a daily evidence log');
    if (!doNowSkills(dn.id).some(r => r.category === category))
        return bad(res, `category ${category} was not part of this Do Now`);
    if (db.prepare('SELECT 1 FROM how_exit_slips WHERE do_now_id = ?').get(dn.id))
        return res.status(409).json({ error: 'week_closed', hint: 'the exit slip for this week is already in' });

    // Default to today; clamp to the Do Now's week so a note can't land outside it.
    let date = L.isDate(req.body?.date) ? req.body.date : L.today();
    const wkEnd = addDays(dn.date, 6);
    if (date < dn.date) date = dn.date;
    if (date > wkEnd)   date = wkEnd;

    const info = db.prepare(
        'INSERT INTO how_evidence_entries(do_now_id, category, date, note, created_at) VALUES(?, ?, ?, ?, ?)'
    ).run(dn.id, category, date, note, now());
    res.json({ ok: true, id: Number(info.lastInsertRowid), date });
});

// INSERT only — no PATCH/DELETE. A junk slip is handled by a teacher void.
// Body: { do_now_id, skills:[{category, goal_rating, evidence, improve}] }, one
// entry per category the Do Now picked. A flat { do_now_id, goal_rating,
// evidence, improve } is accepted as shorthand for a 1-category (daily) slip.
// In weekly_log mode `evidence` is optional (the daily log is the evidence).
router.post('/me/exit-slip', requireAuth, (req, res) => {
    const s = meStudent(req, res); if (!s) return;
    const doNowId = int(req.body?.do_now_id);
    if (!doNowId) return bad(res, 'do_now_id required');

    const dn = db.prepare('SELECT * FROM how_do_nows WHERE id = ? AND student_id = ?').get(doNowId, s.student_id);
    if (!dn) return nf(res, 'do_now_not_found');
    const pickedCats = new Set(doNowSkills(dn.id).map(r => r.category));
    const evidenceRequired = dn.cadence !== 'weekly_log';

    let list = Array.isArray(req.body?.skills) ? req.body.skills : null;
    if (!list && pickedCats.size === 1)
        list = [{ category: [...pickedCats][0], goal_rating: req.body?.goal_rating, evidence: req.body?.evidence, improve: req.body?.improve }];
    if (!list || !list.length) return bad(res, 'skills required');

    const rows = [];
    const seen = new Set();
    for (const it of list) {
        const c = str(it?.category);
        const g = int(it?.goal_rating);
        const evidence = str(it?.evidence).trim();
        const improve  = str(it?.improve).trim();
        if (!pickedCats.has(c)) return bad(res, `category ${c} was not part of this Do Now`);
        if (seen.has(c)) return bad(res, `category ${c} given twice`);
        if (!Number.isInteger(g) || g < 1 || g > 4) return bad(res, `goal_rating (1-4) required for ${c}`);
        if (evidenceRequired && !evidence) return bad(res, `evidence required for ${c}`);
        if (!improve)  return bad(res, `improve required for ${c}`);
        seen.add(c);
        rows.push({ category: c, goal_rating: g, evidence, improve });
    }
    if (seen.size !== pickedCats.size)
        return bad(res, 'exit slip must cover every category from the Do Now');

    db.exec('BEGIN');
    try {
        const info = db.prepare(
            'INSERT INTO how_exit_slips(do_now_id, class_id, student_id, date, submitted_at) VALUES(?, ?, ?, ?, ?)'
        ).run(doNowId, dn.class_id, s.student_id, dn.date, now());
        const slipId = Number(info.lastInsertRowid);
        const ins = db.prepare(
            'INSERT INTO how_exit_slip_skills(exit_slip_id, category, goal_rating, evidence, improve) VALUES(?, ?, ?, ?, ?)'
        );
        for (const r of rows) ins.run(slipId, r.category, r.goal_rating, r.evidence, r.improve);
        db.exec('COMMIT');
        res.json({ ok: true, id: slipId });
    } catch (e) {
        db.exec('ROLLBACK');
        if (String(e.message).includes('UNIQUE'))
            return res.status(409).json({ error: 'already_submitted', hint: 'exit slips are never resubmitted' });
        bad(res, e.message);
    }
});

router.get('/me/history', requireAuth, (req, res) => {
    const s = meStudent(req, res); if (!s) return;
    const classId = int(req.query.class_id);
    if (!classId || !s.class_ids.includes(classId)) return bad(res, 'valid class_id required');

    const doNows = db.prepare(
        'SELECT * FROM how_do_nows WHERE class_id = ? AND student_id = ? ORDER BY date DESC, id DESC'
    ).all(classId, s.student_id);

    const history = doNows.map(dn => {
        const slip = db.prepare('SELECT id FROM how_exit_slips WHERE do_now_id = ?').get(dn.id);
        const selfByCat   = new Map(slip ? slipSelfRows(slip.id).map(r => [r.category, r]) : []);
        const ratingByCat = new Map(slip ? slipRatingRows(slip.id).map(r => [r.category, r.rating]) : []);
        const voidReason  = slip
            ? (db.prepare('SELECT reason FROM how_exit_slip_voids WHERE exit_slip_id = ?').get(slip.id)?.reason ?? null)
            : null;
        const evByCat = new Map();
        if (dn.cadence === 'weekly_log') {
            for (const e of evidenceRows(dn.id)) {
                if (!evByCat.has(e.category)) evByCat.set(e.category, []);
                evByCat.get(e.category).push(e);
            }
        }
        return {
            do_now_id: dn.id, date: dn.date, cadence: dn.cadence,
            exit_slip_id: slip?.id ?? null,
            void_reason: voidReason,
            skills: doNowSkills(dn.id).map(sk => ({
                category: sk.category,
                category_name: HOW.categoryName(sk.category),
                sub_bullet: sk.sub_bullet,
                sub_bullet_text: HOW.bulletText(sk.sub_bullet),
                goal_rating: selfByCat.get(sk.category)?.goal_rating ?? null,
                evidence:    selfByCat.get(sk.category)?.evidence ?? null,
                improve:     selfByCat.get(sk.category)?.improve ?? null,
                teacher_rating: ratingByCat.get(sk.category) ?? null,
                evidence_entries: evByCat.get(sk.category) || [],
            })),
        };
    });
    res.json({ history });
});

// =============================================================================
// Teacher — cadence toggle + Exit Slip review
// =============================================================================

// Body: { cadence: 'daily'|'weekly', weekly_log?: bool }. weekly_log only bites
// when cadence is 'weekly'; a daily class always stores 0. Only affects Do Nows
// created from here on — existing rows keep their snapshot mode.
router.patch('/classes/:classId/cadence', requireTeacher, (req, res) => {
    const classId = int(req.params.classId);
    const cls = ownedNonWblClass(req, res, classId); if (!cls) return;
    const cadence = str(req.body?.cadence);
    if (!['daily', 'weekly'].includes(cadence)) return bad(res, "cadence must be 'daily' or 'weekly'");
    const weeklyLog = cadence === 'weekly' && !!req.body?.weekly_log ? 1 : 0;
    db.prepare('UPDATE classes SET how_cadence = ?, how_weekly_log = ? WHERE id = ?')
        .run(cadence, weeklyLog, classId);
    res.json({ ok: true, cadence, weekly_log: !!weeklyLog, mode: cadence !== 'weekly' ? 'daily' : (weeklyLog ? 'weekly_log' : 'weekly') });
});

router.get('/classes/:classId/exit-slips', requireTeacher, (req, res) => {
    const classId = int(req.params.classId);
    const cls = ownedNonWblClass(req, res, classId); if (!cls) return;

    const roster = db.prepare(
        'SELECT student_id, student_name FROM class_students WHERE class_id = ?'
    ).all(classId);
    const nameByNorm = new Map(roster.map(r => [normalizeStudentId(r.student_id), r.student_name]));
    const rawByNorm  = new Map(roster.map(r => [normalizeStudentId(r.student_id), r.student_id]));

    let sql = `
        SELECT es.id, es.do_now_id, es.student_id, es.date, es.submitted_at,
               dn.cadence,
               v.reason AS void_reason, v.voided_at
        FROM how_exit_slips es
        JOIN how_do_nows dn ON dn.id = es.do_now_id
        LEFT JOIN how_exit_slip_voids v ON v.exit_slip_id = es.id
        WHERE es.class_id = ?`;
    const params = [classId];
    if (L.isDate(req.query.week)) {
        const ws = weekStart(req.query.week);
        sql += ' AND es.date BETWEEN ? AND ?';
        params.push(ws, addDays(ws, 6));
    }
    sql += ' ORDER BY es.date DESC, es.id DESC';

    const evGroups = doNowId => {
        const m = new Map();
        for (const e of evidenceRows(doNowId)) {
            if (!m.has(e.category)) m.set(e.category, []);
            m.get(e.category).push(e);
        }
        return m;
    };

    let rows = db.prepare(sql).all(...params).map(r => {
        const self   = new Map(slipSelfRows(r.id).map(x => [x.category, x]));
        const rating = new Map(slipRatingRows(r.id).map(x => [x.category, x]));
        const ev     = r.cadence === 'weekly_log' ? evGroups(r.do_now_id) : new Map();
        const skills = doNowSkills(r.do_now_id).map(sk => ({
            category: sk.category,
            category_name: HOW.categoryName(sk.category),
            sub_bullet: sk.sub_bullet,
            sub_bullet_text: HOW.bulletText(sk.sub_bullet),
            goal_rating: self.get(sk.category)?.goal_rating ?? null,
            evidence:    self.get(sk.category)?.evidence ?? '',
            improve:     self.get(sk.category)?.improve ?? '',
            evidence_entries: ev.get(sk.category) || [],
            teacher_rating: rating.get(sk.category)?.rating ?? null,
            teacher_note:   rating.get(sk.category)?.note ?? '',
        }));
        return {
            id: r.id, do_now_id: r.do_now_id, date: r.date, cadence: r.cadence,
            submitted_at: r.submitted_at, in_progress: false,
            student_name:   nameByNorm.get(r.student_id) || r.student_id,
            student_id_raw: rawByNorm.get(r.student_id) || r.student_id,
            voided: r.void_reason != null,
            void_reason: r.void_reason,
            skills,
            fully_rated: skills.length > 0 && skills.every(sk => sk.teacher_rating != null),
        };
    });

    // weekly_log: also surface open weeks (goals set, evidence accruing, no exit
    // slip yet) so the teacher can watch the log fill in. Read-only, no rating.
    // Skipped for the 'pending' view — there is nothing to rate until it closes.
    if (cls.how_cadence === 'weekly' && cls.how_weekly_log && req.query.status !== 'pending') {
        let dnSql = `
            SELECT dn.id, dn.student_id, dn.date, dn.cadence
            FROM how_do_nows dn
            WHERE dn.class_id = ? AND dn.cadence = 'weekly_log'
              AND NOT EXISTS (SELECT 1 FROM how_exit_slips es WHERE es.do_now_id = dn.id)`;
        const dnParams = [classId];
        if (L.isDate(req.query.week)) {
            const ws = weekStart(req.query.week);
            dnSql += ' AND dn.date BETWEEN ? AND ?';
            dnParams.push(ws, addDays(ws, 6));
        }
        dnSql += ' ORDER BY dn.date DESC, dn.id DESC';
        for (const dn of db.prepare(dnSql).all(...dnParams)) {
            const ev = evGroups(dn.id);
            rows.push({
                id: null, do_now_id: dn.id, date: dn.date, cadence: dn.cadence,
                submitted_at: null, in_progress: true,
                student_name:   nameByNorm.get(dn.student_id) || dn.student_id,
                student_id_raw: rawByNorm.get(dn.student_id) || dn.student_id,
                voided: false, void_reason: null,
                skills: doNowSkills(dn.id).map(sk => ({
                    category: sk.category,
                    category_name: HOW.categoryName(sk.category),
                    sub_bullet: sk.sub_bullet,
                    sub_bullet_text: HOW.bulletText(sk.sub_bullet),
                    goal_rating: null, evidence: '', improve: '',
                    evidence_entries: ev.get(sk.category) || [],
                    teacher_rating: null, teacher_note: '',
                })),
                fully_rated: false,
            });
        }
        rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    }

    if (req.query.status === 'pending')
        rows = rows.filter(r => !r.voided && !r.fully_rated);
    const q = str(req.query.q).trim().toLowerCase();
    if (q) rows = rows.filter(r => (r.student_name || '').toLowerCase().includes(q));

    const mode = cls.how_cadence !== 'weekly' ? 'daily' : (cls.how_weekly_log ? 'weekly_log' : 'weekly');
    res.json({ class_id: classId, class_name: cls.name, cadence: mode, exit_slips: rows });
});

// Upsert the teacher's 1-4 verdict for one or more categories on a slip.
// Body: { category, rating, note? }  OR  { ratings: [{category, rating, note?}] }.
router.post('/exit-slips/:id/rate', requireTeacher, (req, res) => {
    const slip = ownedSlip(req, res, req.params.id); if (!slip) return;
    const validCats = new Set(doNowSkills(slip.do_now_id).map(r => r.category));

    let list = Array.isArray(req.body?.ratings) ? req.body.ratings : null;
    if (!list && req.body?.category != null)
        list = [{ category: req.body.category, rating: req.body.rating, note: req.body.note }];
    if (!list && validCats.size === 1)
        list = [{ category: [...validCats][0], rating: req.body?.rating, note: req.body?.note }];
    if (!list || !list.length) return bad(res, 'category + rating (or ratings[]) required');

    for (const it of list) {
        const c = str(it?.category);
        const n = int(it?.rating);
        if (!validCats.has(c)) return bad(res, `category ${c} is not on this exit slip`);
        if (!Number.isInteger(n) || n < 1 || n > 4) return bad(res, `rating (1-4) required for ${c}`);
    }
    const up = db.prepare(`
        INSERT INTO how_exit_slip_ratings(exit_slip_id, category, rating, rated_by, note, rated_at)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(exit_slip_id, category) DO UPDATE SET
            rating = excluded.rating, rated_by = excluded.rated_by,
            note = excluded.note, rated_at = excluded.rated_at
    `);
    for (const it of list)
        up.run(slip.id, str(it.category), int(it.rating), req.teacherKey, str(it.note), now());
    res.json({ ok: true, rated: list.length });
});

router.post('/exit-slips/:id/void', requireTeacher, (req, res) => {
    const reason = str(req.body?.reason).trim();
    if (!reason) return bad(res, 'reason required');
    const slip = ownedSlip(req, res, req.params.id); if (!slip) return;
    try {
        db.prepare('INSERT INTO how_exit_slip_voids(exit_slip_id, reason, voided_by, voided_at) VALUES(?, ?, ?, ?)')
            .run(slip.id, reason, req.teacherKey, now());
        res.json({ ok: true });
    } catch {
        res.status(409).json({ error: 'already_voided' });
    }
});

// Undo a void (teacher mis-click). The slip row was never touched.
router.delete('/exit-slips/:id/void', requireTeacher, (req, res) => {
    const slip = ownedSlip(req, res, req.params.id); if (!slip) return;
    db.prepare('DELETE FROM how_exit_slip_voids WHERE exit_slip_id = ?').run(slip.id);
    res.json({ ok: true });
});

// =============================================================================
// Teacher — PowerSchool sync payload (consumed by the DobbsCore extension)
// =============================================================================

// Per category: this week's average (mean of teacher 1-4 ratings × 25) and a
// standing score (mean of the last <=3 weekly averages that have data, up to
// and including the selected week). Voided and unrated slips never count.
// `week` is any YYYY-MM-DD inside the target ISO week; defaults to today.
//
// Mode-agnostic: a weekly / weekly_log slip contributes one teacher rating per
// category, a daily slip contributes one per day — both land in the same
// per-category weekly buckets, so the payload shape never changes. Daily
// evidence-log entries are never synced; only the teacher's ratings are.
router.get('/sync', requireTeacher, (req, res) => {
    const classId = int(req.query.class_id);
    const cls = ownedNonWblClass(req, res, classId); if (!cls) return;

    const anchor  = L.isDate(req.query.week) ? req.query.week : L.today();
    const wkStart = weekStart(anchor);
    const wkEnd   = addDays(wkStart, 6);

    const roster = db.prepare(
        'SELECT student_id, student_name FROM class_students WHERE class_id = ? ORDER BY student_name'
    ).all(classId);
    const normToRaw = new Map(roster.map(r => [normalizeStudentId(r.student_id), r.student_id]));

    // Every teacher rating on a non-voided slip in this class from the target
    // week or earlier. Category comes from the rating row, so weekly slips
    // naturally feed all 3 category buckets.
    const ratings = db.prepare(`
        SELECT es.student_id, es.date, r.category, r.rating
        FROM how_exit_slip_ratings r
        JOIN how_exit_slips es ON es.id = r.exit_slip_id
        LEFT JOIN how_exit_slip_voids v ON v.exit_slip_id = es.id
        WHERE es.class_id = ? AND v.exit_slip_id IS NULL AND es.date <= ?
    `).all(classId, wkEnd);

    // (category|normStudent) -> Map(weekStart -> { sum, n })
    const bucket = new Map();
    for (const row of ratings) {
        if (!normToRaw.has(row.student_id)) continue;          // no longer on roster
        const ws = weekStart(row.date);
        if (ws > wkStart) continue;                            // safety
        const key = row.category + '|' + row.student_id;
        let weeks = bucket.get(key);
        if (!weeks) bucket.set(key, weeks = new Map());
        let cell = weeks.get(ws);
        if (!cell) weeks.set(ws, cell = { sum: 0, n: 0 });
        cell.sum += row.rating;
        cell.n   += 1;
    }

    const idsFor = (category, kind) => db.prepare(
        'SELECT ps_assignment_id, ps_assignmentsection_id FROM how_sync WHERE class_id = ? AND category = ? AND kind = ?'
    ).get(classId, category, kind) || { ps_assignment_id: null, ps_assignmentsection_id: null };

    const categories = HOW.CATEGORIES.map(cat => {
        const weekly = [], standing = [];
        for (const r of roster) {
            const norm  = normalizeStudentId(r.student_id);
            const weeks = bucket.get(cat.code + '|' + norm);
            if (!weeks) continue;

            const thisWk = weeks.get(wkStart);
            if (thisWk) weekly.push({ student_id: r.student_id, score: round2(thisWk.sum / thisWk.n * RATING_TO_PCT) });

            const recent = [...weeks.keys()].sort().reverse().slice(0, 3);
            if (recent.length) {
                const perWeek = recent.map(ws => {
                    const c = weeks.get(ws);
                    return c.sum / c.n * RATING_TO_PCT;
                });
                standing.push({
                    student_id: r.student_id,
                    score: round2(perWeek.reduce((a, b) => a + b, 0) / perWeek.length),
                });
            }
        }
        return {
            category: cat.code,
            name: cat.name,
            weekly:   { ...idsFor(cat.code, 'weekly'),   scores: weekly },
            standing: { ...idsFor(cat.code, 'standing'), scores: standing },
        };
    });

    res.json({
        class_id: classId,
        class_name: cls.name,
        cadence: cls.how_cadence !== 'weekly' ? 'daily' : (cls.how_weekly_log ? 'weekly_log' : 'weekly'),
        week: L.isoWeek(wkStart),
        week_start: wkStart,
        week_end: wkEnd,
        students: roster,
        categories,
    });
});

// The extension reports back the PS assignment IDs it created/reused.
router.post('/sync/ids', requireTeacher, (req, res) => {
    const classId = int(req.body?.class_id);
    const cls = ownedNonWblClass(req, res, classId); if (!cls) return;

    const up = db.prepare(`
        INSERT INTO how_sync(class_id, category, kind, ps_assignment_id, ps_assignmentsection_id)
        VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(class_id, category, kind) DO UPDATE SET
            ps_assignment_id = excluded.ps_assignment_id,
            ps_assignmentsection_id = excluded.ps_assignmentsection_id
    `);
    let n = 0;
    for (const a of req.body?.assignments || []) {
        if (!HOW.isCategory(a?.category)) continue;
        if (!['weekly', 'standing'].includes(a?.kind)) continue;
        if (!a?.ps_assignment_id) continue;
        up.run(classId, a.category, a.kind, String(a.ps_assignment_id), str(a.ps_assignmentsection_id));
        n++;
    }
    res.json({ ok: true, stored: n });
});

module.exports = router;
