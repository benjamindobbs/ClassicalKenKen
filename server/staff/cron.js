// In-process 7:00 a.m. memo job, enabled with STAFF_MEMO_CRON=1. Checks the
// wall clock in America/New_York every 30 seconds, so DST needs no handling.
//
// Fly machines that auto-stop won't be awake at 7:00. If this app keeps
// min_machines_running = 0, trigger the job externally instead.

const { db }        = require('./db');
const time          = require('./time');
const { buildMemo } = require('./memo');
const { sendMail }  = require('./mail');
const { getDayPlan } = require('./schedule');

const RUN_AT = '07:00';
const RUN_UNTIL = '07:15';   // a restart later in the day must not send a late memo
let lastRunDate = null;

async function runDailyMemos(date = time.localDate()) {
    if (!getDayPlan(date, 'HS').isSchoolDay && !getDayPlan(date, 'MS').isSchoolDay) {
        console.log(`[staff memo] ${date} is not a school day; skipping`);
        return 0;
    }
    let sent = 0;
    for (const s of db.prepare("SELECT id FROM staff WHERE active = 1 AND role != 'guest'").all()) {
        try {
            await sendMail(buildMemo(s.id, date));
            sent++;
        } catch (e) {
            console.error(`[staff memo] staff ${s.id}: ${e.message}`);
        }
    }
    console.log(`[staff memo] ${date}: sent ${sent}`);
    return sent;
}

function start() {
    if (process.env.STAFF_MEMO_CRON !== '1') return;
    console.log(`[staff memo] scheduler on: ${RUN_AT} ${time.TZ}`);
    setInterval(() => {
        const date = time.localDate();
        const now = time.localTime();
        if (now >= RUN_AT && now < RUN_UNTIL && lastRunDate !== date) {
            lastRunDate = date;
            runDailyMemos(date).catch(e => console.error('[staff memo]', e));
        }
    }, 30_000).unref();
}

module.exports = { start, runDailyMemos };
