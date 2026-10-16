// Outgoing mail. MAIL_TRANSPORT=console (default) only logs; resend sends
// through the Resend API using RESEND_API_KEY and MAIL_FROM.

async function sendMail({ to, subject, html, text }) {
    const transport = process.env.MAIL_TRANSPORT || 'console';

    if (transport === 'console') {
        console.log(`[staff mail] to=${to} subject="${subject}"\n${text}\n[end mail]`);
        return { transport, queued: true };
    }

    if (transport === 'resend') {
        const key = process.env.RESEND_API_KEY;
        const from = process.env.MAIL_FROM;
        if (!key || !from) throw new Error('RESEND_API_KEY and MAIL_FROM are required for MAIL_TRANSPORT=resend');
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to, subject, html, text }),
        });
        if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
        return { transport, ...(await res.json()) };
    }

    throw new Error(`Unknown MAIL_TRANSPORT "${transport}"`);
}

module.exports = { sendMail };
