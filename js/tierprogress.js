// Tier progress bar for tiered games — same look as KenKen's rank progress
// bar (js/kenken.js). Rules match server/tieredGame.js:
//   Normal route: WINDOW answers in the tier, PROMOTE_ACCURACY correct and
//                 PROMOTE_SCORE_PCT average points.
//   Streak route (when PROGRESSION.STREAK is set): STREAK correct in a row
//                 whose average points also meet PROMOTE_SCORE_PCT.
// Each requirement is scored 0–1 against its target; a route's progress is its
// weakest requirement and the bar shows the better route, so it reaches 100%
// exactly when the student moves up.
//
// Usage: TierProgress.render(containerEl, status, { progression, maxTier })
//   status: the server's status object (tier, window, attempts, accuracy,
//           avg_pct, streak, streak_pct).

const TierProgress = (function () {
    const clamp = v => Math.max(0, Math.min(1, v));
    const pct = v => `${Math.round(v * 100)}%`;

    function compute(s, P, maxTier) {
        const n = s.attempts || 0;
        const normal = [
            { label: 'Answers', have: `${n}/${s.window}`, pct: clamp(n / s.window) },
            { label: 'Correct', have: pct(n ? s.accuracy : 0), need: pct(P.PROMOTE_ACCURACY),
              pct: n ? clamp(s.accuracy / P.PROMOTE_ACCURACY) : 0 },
            { label: 'Points',  have: pct(n ? s.avg_pct : 0), need: pct(P.PROMOTE_SCORE_PCT),
              pct: n ? clamp(s.avg_pct / P.PROMOTE_SCORE_PCT) : 0 },
        ];
        const normalPct = Math.min(...normal.map(r => r.pct));

        let streak = null;
        if (P.STREAK) {
            const k = Math.min(s.streak || 0, P.STREAK);
            const pts = k && s.streak_pct != null ? clamp(s.streak_pct / P.PROMOTE_SCORE_PCT) : 0;
            streak = { label: 'Streak', have: `${k}/${P.STREAK}`, pct: Math.min(clamp(k / P.STREAK), pts) };
        }
        return {
            tier: s.tier,
            next: s.tier < maxTier ? s.tier + 1 : null,
            pct: streak ? Math.max(normalPct, streak.pct) : normalPct,
            normal, streak,
        };
    }

    function build(el) {
        el.classList.add('tier-progress');
        el.innerHTML = `
            <div class="tier-progress-header">Tier Progress</div>
            <div class="tier-progress-labels"><span data-tp="from"></span><span data-tp="to" class="tier-progress-to"></span></div>
            <div class="tier-progress-track"><div data-tp="fill" class="tier-progress-fill"></div></div>
            <div class="tier-progress-caption"><span data-tp="reqs" class="tier-progress-reqs"></span><span data-tp="pct"></span></div>`;
        el.dataset.tpBuilt = '1';
    }

    function render(el, s, { progression: P, maxTier }) {
        if (!el || !s) return;
        if (!el.dataset.tpBuilt) build(el);
        const part = k => el.querySelector(`[data-tp="${k}"]`);
        const p = compute(s, P, maxTier);
        el.style.display = '';
        part('from').textContent = `Tier ${p.tier}`;
        part('to').textContent = p.next ? `Tier ${p.next}` : 'Max';

        const width = p.next ? Math.round(p.pct * 100) : 100;
        // Two frames so a first render animates up from 0, like KenKen's.
        const fill = part('fill');
        requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = width + '%'; }));

        const item = r => `<span class="tier-req${r.pct >= 1 ? ' tier-req--met' : ''}">${r.label} ${r.have}${r.need ? ` / ${r.need}` : ''}</span>`;
        part('reqs').innerHTML = p.normal.map(item).join('')
            + (p.streak ? `<span class="tier-req-or">or</span>${item(p.streak)}` : '');
        part('pct').textContent = p.next ? `${width}% to next tier` : 'Maximum tier reached';

        el.title = `Move up: over your last ${s.window} answers in this tier, get ${pct(P.PROMOTE_ACCURACY)} correct `
                 + `and average ${pct(P.PROMOTE_SCORE_PCT)} of possible points.`
                 + (P.STREAK ? ` Or get ${P.STREAK} correct in a row averaging ${pct(P.PROMOTE_SCORE_PCT)} of possible points.` : '')
                 + ` Move down: average below ${pct(P.DEMOTE_SCORE_PCT)} over your last ${s.window}.`;
    }

    return { render, compute };
})();
