// Habits of Work (HoW) — the fixed catalogue for NON-WBL classes.
//
// This is deliberately hard-coded, not teacher-authored: it is a district
// framework, transcribed from `.refs/Habits of Work Notes.md`. WBL keeps its
// own separate dispositional catalogue (wbl_soft_skills) — the two never mix.
//
// Three top-level categories (Dignitas / Pietas / Gravitas). A Do Now picks
// exactly one category and then one required sub-bullet from it. The PS sync
// aggregates a week's exit-slip ratings per CATEGORY, so sub-bullet codes only
// ever need to resolve back to their category.

const CATEGORIES = [
    {
        code: 'gravitas',
        name: 'Gravitas',
        blurb: 'Preparation for and engagement with learning — showing up ready and giving your full effort.',
        groups: [
            {
                name: 'Preparation for Learning',
                bullets: [
                    { code: 'grav_on_time',    text: 'I am on time and seated when the bell rings.' },
                    { code: 'grav_materials',  text: 'I am prepared with all materials and the prior learning needed to engage with today’s tasks.' },
                    { code: 'grav_do_now',     text: 'I start the Do Now / Warm Up activity without prompting at the start of the lesson.' },
                    { code: 'grav_attendance', text: 'I attend this class regularly (over 95%) and complete missing tasks when absent.' },
                ],
            },
            {
                name: 'Engagement with Learning',
                bullets: [
                    { code: 'grav_best_work', text: 'I can do my very best work with 100% effort.' },
                    { code: 'grav_resources', text: 'I can use resources and/or seek help when needed to complete tasks.' },
                    { code: 'grav_on_task',   text: 'I can stay on task to thoroughly complete all parts of the assignments and assessments, avoiding distractions from technology, off-task conversations, and disruptive behavior.' },
                    { code: 'grav_curiosity', text: 'I can show interest and curiosity for the learning by posing questions, engaging in discourse, and/or seeking alternate solutions or perspectives.' },
                    { code: 'grav_feedback',  text: 'I can use feedback to improve my work and resubmit and/or schedule retakes when needed.' },
                ],
            },
        ],
    },
    {
        code: 'dignitas',
        name: 'Dignitas',
        blurb: 'Treating others with respect in how you speak and how you listen.',
        groups: [
            {
                name: 'Interaction with Others',
                bullets: [
                    { code: 'dig_tone',   text: 'I can use respectful language, volume, and tone with others during class.' },
                    { code: 'dig_listen', text: 'I can actively listen while others are speaking.' },
                ],
            },
        ],
    },
    {
        code: 'pietas',
        name: 'Pietas',
        blurb: 'Contributing to and keeping our learning community safe and supportive.',
        groups: [
            {
                name: 'Interaction with Others',
                bullets: [
                    { code: 'pie_contribute', text: 'I can positively contribute to our learning community by collaborating with peers and supporting others.' },
                    { code: 'pie_safe',       text: 'I can keep my community safe by calmly communicating to an adult when I am upset, frustrated, or need support.' },
                ],
            },
        ],
    },
];

const CATEGORY_CODES = CATEGORIES.map(c => c.code);

// sub_bullet code -> category code, and sub_bullet code -> its text
const BULLET_TO_CATEGORY = {};
const BULLET_TEXT = {};
for (const cat of CATEGORIES) {
    for (const g of cat.groups) {
        for (const b of g.bullets) {
            BULLET_TO_CATEGORY[b.code] = cat.code;
            BULLET_TEXT[b.code] = b.text;
        }
    }
}

const isCategory   = code => CATEGORY_CODES.includes(code);
const isBullet     = code => Object.prototype.hasOwnProperty.call(BULLET_TO_CATEGORY, code);
const categoryOf   = code => BULLET_TO_CATEGORY[code] || null;
const categoryName = code => (CATEGORIES.find(c => c.code === code) || {}).name || code;
const bulletText   = code => BULLET_TEXT[code] || code;

module.exports = {
    CATEGORIES, CATEGORY_CODES, BULLET_TO_CATEGORY, BULLET_TEXT,
    isCategory, isBullet, categoryOf, categoryName, bulletText,
};
