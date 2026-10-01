// SAT accuracy-mode requirement (classes.sat_requirement_mode = 'accuracy').
//
// The original mode only counts correct answers, which spam-guessing can
// satisfy given enough attempts. Accuracy mode keeps the same "C correct"
// count but also requires at least `pct`% correct over the student's last
// `window` answers at the moment they reach it. For example, with 3 correct
// at 50% over the last 3, the student needs their 3rd correct answer to land
// with at least 2 of their last 3 answers right.
//   - A bad start can be recovered: only the last `window` answers matter.
//   - Once met it stays met, so practising past it is never penalised.
//   - Before `window` answers exist, accuracy is over all of them (one right
//     answer on a 1-correct requirement is 1/1 = 100%).
//
// Shared by GET /api/student/daily-progress (today) and GET /api/teacher/grades
// (each day in range), so the pill and the gradebook can't disagree.

// results: one day's answers for one activity, 0/1 in submission order.
function accuracyProgress(results, requiredCorrect, window, pct) {
    const need   = Math.max(1, Math.round(requiredCorrect) || 1);
    const w      = Math.max(1, Math.round(window) || 1);
    const target = Math.min(100, Math.max(1, Number(pct) || 1)) / 100;

    let correct = 0, recent = 0, met = false, fraction = 0;
    for (let i = 0; i < results.length; i++) {
        correct += results[i] ? 1 : 0;
        recent  += (results[i] ? 1 : 0) - (i >= w && results[i - w] ? 1 : 0);
        const acc = recent / Math.min(i + 1, w);
        if (correct >= need && acc >= target - 1e-9) met = true;
        // Partial progress for grading/bars: the best moment's share of the
        // count times how close its accuracy was to the target.
        fraction = Math.max(fraction, Math.min(1, correct / need) * Math.min(1, acc / target));
    }
    if (met) fraction = 1;
    else fraction = Math.min(fraction, 0.999);

    return {
        attempts: results.length,
        correct,
        window: Math.min(results.length, w),
        recent_correct: recent,
        met,
        fraction,
    };
}

module.exports = { accuracyProgress };
