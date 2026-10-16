// One capability map for the whole hub. Every API route checks a capability
// from here; the front end only uses /me's capability list to hide controls.

const VIEW_ALL = [
    'view_today', 'view_links', 'view_faq', 'view_directory', 'view_students',
    'view_flags', 'view_serves', 'view_trips', 'view_schedule', 'view_memo',
];

const ROLES = {
    admin_school: {
        label: 'Admin (school)',
        caps: [...VIEW_ALL, 'view_serves_full', 'view_school_counts', 'view_audit',
               'edit_serves', 'approve_trips', 'submit_trips', 'edit_flags',
               'edit_links', 'edit_duties', 'edit_day_plans'],
    },
    admin_tech: {
        label: 'Admin (technical)',
        caps: [...VIEW_ALL, 'view_serves_full', 'view_school_counts', 'view_audit',
               'manage_users', 'import', 'settings', 'sync_roster'],
    },
    office: {
        label: 'Office',
        caps: [...VIEW_ALL, 'view_serves_full', 'view_school_counts',
               'approve_trips', 'submit_trips', 'edit_flags',
               'edit_links', 'edit_duties', 'edit_day_plans'],
    },
    teacher: {
        label: 'Teacher',
        caps: [...VIEW_ALL, 'submit_trips', 'sync_own_roster'],
    },
    staff: {
        label: 'Staff',
        caps: [...VIEW_ALL, 'submit_trips'],
    },
    guest: {
        label: 'Guest',
        caps: ['view_today', 'view_links'],
    },
};

const ROLE_NAMES = Object.keys(ROLES);

function can(user, cap) {
    return !!user && !!ROLES[user.role] && ROLES[user.role].caps.includes(cap);
}

function capsFor(role) {
    return ROLES[role] ? [...ROLES[role].caps] : [];
}

// Express middleware: 401 without a user, 403 without the capability.
function requireCap(...caps) {
    return (req, res, next) => {
        if (!req.staffUser) return res.status(401).json({ error: 'Not signed in' });
        if (!caps.every(c => can(req.staffUser, c))) {
            return res.status(403).json({ error: `Requires ${caps.join(', ')}` });
        }
        next();
    };
}

// Serve fields basic viewers may see. Whitelisted rather than stripped so a
// new admin-only column can't leak by default.
const SERVE_BASIC_FIELDS = [
    'id', 'student_dcid', 'student_number', 'first', 'last', 'grade',
    'sanction', 'serve_date', 'serve_end_date', 'periods', 'infraction_code', 'incident_date',
];

function shapeServe(serve, user) {
    if (can(user, 'view_serves_full')) return serve;
    const out = {};
    for (const k of SERVE_BASIC_FIELDS) if (k in serve) out[k] = serve[k];
    return out;
}

module.exports = { ROLES, ROLE_NAMES, can, capsFor, requireCap, shapeServe };
