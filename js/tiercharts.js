// Chart.js configs for tiered games (Ruler Game, Projections), shared by the
// teacher portal and the student My Progress page. Each builder returns a
// config for `new Chart(ctx, config)`; the page owns date filtering and chart
// instances. Rows are score rows with submitted_at, score, correct, tier.

const TierCharts = (function () {
    const day = ms => new Date(ms).toISOString().substring(0, 10);
    const base = { responsive: true, maintainAspectRatio: false };

    // Average score per day.
    function scoreOverTime(rows) {
        const byDate = {};
        rows.forEach(r => {
            const d = day(r.submitted_at);
            (byDate[d] ||= { sum: 0, n: 0 }).sum += Number(r.score);
            byDate[d].n += 1;
        });
        const dates = Object.keys(byDate).sort();
        return {
            type: 'line',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Avg Score', data: dates.map(d => Math.round(byDate[d].sum / byDate[d].n)),
                    borderColor: '#0ea5e9', backgroundColor: 'rgba(14,165,233,0.08)',
                    pointBackgroundColor: '#0ea5e9', tension: 0.3, borderWidth: 2, pointRadius: 4, fill: true,
                }],
            },
            options: {
                ...base,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: i => `Avg score: ${i.raw}` } } },
                scales: { y: { title: { display: true, text: 'Score' } }, x: { title: { display: true, text: 'Date' } } },
            },
        };
    }

    // Accuracy % per bucket. buckets: [{ key, label }] in display order;
    // bucketOf(row) returns a bucket key.
    function accuracyBars(rows, buckets, bucketOf, xTitle) {
        const agg = Object.fromEntries(buckets.map(b => [b.key, { correct: 0, total: 0 }]));
        rows.forEach(r => {
            const a = agg[bucketOf(r)];
            if (!a) return;
            a.correct += Number(r.correct);
            a.total   += 1;
        });
        return {
            type: 'bar',
            data: {
                labels: buckets.map(b => b.label),
                datasets: [{
                    label: 'Accuracy', backgroundColor: '#10b981', borderRadius: 4,
                    data: buckets.map(b => agg[b.key].total ? Math.round(agg[b.key].correct / agg[b.key].total * 100) : null),
                }],
            },
            options: {
                ...base,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: i => {
                        const a = agg[buckets[i.dataIndex].key];
                        return `${i.raw}% correct (${a.correct}/${a.total})`;
                    } } },
                },
                scales: {
                    y: { min: 0, max: 100, ticks: { callback: v => v + '%' }, title: { display: true, text: 'Accuracy' } },
                    x: { title: { display: true, text: xTitle } },
                },
            },
        };
    }

    // Students currently on each tier (progressRows: { tier }).
    function tierDistribution(progressRows, maxTier) {
        const tiers  = Array.from({ length: maxTier }, (_, i) => i + 1);
        const counts = tiers.map(t => progressRows.filter(p => Number(p.tier) === t).length);
        return {
            type: 'bar',
            data: {
                labels: tiers.map(t => 'Tier ' + t),
                datasets: [{ label: 'Students', data: counts, backgroundColor: '#8b5cf6', borderRadius: 4 }],
            },
            options: {
                ...base,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: i => `${i.raw} student${i.raw === 1 ? '' : 's'}` } } },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Students' } },
                    x: { title: { display: true, text: 'Current tier' } },
                },
            },
        };
    }

    // Highest tier played each day.
    function tierOverTime(rows, maxTier) {
        const byDate = {};
        rows.forEach(r => {
            const d = day(r.submitted_at);
            byDate[d] = Math.max(byDate[d] || 0, Number(r.tier));
        });
        const dates = Object.keys(byDate).sort();
        return {
            type: 'line',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Tier', data: dates.map(d => byDate[d]), stepped: true,
                    borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.08)',
                    pointBackgroundColor: '#8b5cf6', borderWidth: 2, pointRadius: 4, fill: true,
                }],
            },
            options: {
                ...base,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: i => `Tier ${i.raw}` } } },
                scales: {
                    y: { min: 1, max: maxTier, ticks: { stepSize: 1 }, title: { display: true, text: 'Tier' } },
                    x: { title: { display: true, text: 'Date' } },
                },
            },
        };
    }

    // Ruler Game: accuracy by the target's reduced denominator.
    function rulerAccuracy(rows) {
        const buckets = MeasurementCore.DENOMINATOR_LABELS.map(l => ({ key: l, label: l === 'Whole' ? 'Whole inch' : l + '″' }));
        return accuracyBars(rows, buckets, r => MeasurementCore.denominatorLabel(Number(r.target_32)), 'Target fraction');
    }

    return { scoreOverTime, accuracyBars, tierDistribution, tierOverTime, rulerAccuracy };
})();
