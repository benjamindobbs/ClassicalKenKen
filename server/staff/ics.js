// Outlook calendar import. Stubbed for the demo: events are seeded instead.
// The real version will fetch the ICS feed, parse VEVENTs and upsert into
// calendar_events by UID with source = 'ics'.

async function syncIcs(url) {
    console.log(`[staff ics] syncIcs(${url}) is a stub in the demo; no events fetched`);
    return { skipped: true, upserted: 0 };
}

module.exports = { syncIcs };
