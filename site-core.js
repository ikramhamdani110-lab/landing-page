// Shared website-content management logic (same pattern as content-core.js):
//   - serve.js (local Node server)
//   - api/*.js (Vercel serverless functions)
// Stores per-key website content overrides in the `website_settings` table of the
// existing database. A key not present in the table (or saved as empty) falls back
// to the DEFAULTS below, which mirror the current hardcoded index.html content.
// Only status='published' rows are served to the public website.

const { verifyAuth } = require('./content-core');

// ---------- Content map: section -> editable fields ----------
const SECTIONS = [
  {
    key: 'hero', label: 'Hero', icon: 'bx-sun',
    fields: [
      { key: 'hero_badge', label: 'Badge / Eyebrow', type: 'text' },
      { key: 'hero_title', label: 'Headline', type: 'html', help: 'The word TALORA is highlighted automatically.' },
      { key: 'hero_desc', label: 'Description', type: 'html' },
      { key: 'link_hero_video', label: 'Hero video path / URL', type: 'url' }
    ]
  },
  {
    key: 'studio', label: 'Studio Ecosystem', icon: 'bx-globe',
    fields: [
      { key: 'eco_title', label: 'Section title', type: 'html' },
      { key: 'eco_sub', label: 'Section description', type: 'text' },
      { key: 'talent_title', label: 'Talent — title', type: 'text' },
      { key: 'talent_desc', label: 'Talent — description', type: 'html' },
      { key: 'project_title', label: 'Project — title', type: 'text' },
      { key: 'project_desc', label: 'Project — description', type: 'html' },
      { key: 'match_title', label: 'Match — title', type: 'text' },
      { key: 'match_desc', label: 'Match — description', type: 'html' },
      { key: 'build_title', label: 'Build — title', type: 'text' },
      { key: 'build_desc', label: 'Build — description', type: 'text' },
      { key: 'deliver_title', label: 'Deliver — title', type: 'text' },
      { key: 'deliver_desc', label: 'Deliver — description', type: 'html' },
      { key: 'earn_title', label: 'Earn — title', type: 'text' },
      { key: 'earn_desc', label: 'Earn — description', type: 'html' },
      { key: 'grow_title', label: 'Grow — title', type: 'text' },
      { key: 'grow_desc', label: 'Grow — description', type: 'html' }
    ]
  },
  {
    key: 'build', label: 'Build With TALORA', icon: 'bx-layer',
    fields: [
      { key: 'bwith_title', label: 'Section title', type: 'html' },
      { key: 'bwith_sub', label: 'Section description', type: 'html' },
      { key: 'cap_design_title', label: 'Design — title', type: 'text' },
      { key: 'cap_design_list', label: 'Design — capabilities', type: 'list', help: 'One capability per line.' },
      { key: 'cap_eng_title', label: 'Engineering — title', type: 'text' },
      { key: 'cap_eng_list', label: 'Engineering — capabilities', type: 'list', help: 'One capability per line.' },
      { key: 'cap_creative_title', label: 'Creative Technology — title', type: 'text' },
      { key: 'cap_creative_list', label: 'Creative Technology — capabilities', type: 'list', help: 'One capability per line.' },
      { key: 'cap_strategy_title', label: 'Strategy — title', type: 'text' },
      { key: 'cap_strategy_list', label: 'Strategy — capabilities', type: 'list', help: 'One capability per line.' }
    ]
  },
  {
    key: 'join', label: 'Join TALORA', icon: 'bx-rocket',
    fields: [
      { key: 'join_title', label: 'Section title', type: 'html' },
      { key: 'join_sub', label: 'Section description', type: 'text' },
      { key: 'join_eyebrow', label: 'Card eyebrow', type: 'html' },
      { key: 'join_state1_title', label: 'Slide 1 — title', type: 'text' },
      { key: 'join_state1_text', label: 'Slide 1 — text', type: 'text' },
      { key: 'join_state2_title', label: 'Slide 2 — title', type: 'text' },
      { key: 'join_state2_text', label: 'Slide 2 — text', type: 'text' },
      { key: 'link_join_cta', label: 'CTA button link', type: 'url' }
    ]
  },
  {
    key: 'contact', label: 'Contact', icon: 'bx-envelope',
    fields: [
      { key: 'contact_title', label: 'Section title', type: 'html' },
      { key: 'contact_sub', label: 'Section description', type: 'html' },
      { key: 'contact_question', label: 'Question heading', type: 'html' },
      { key: 'audience_project', label: 'Audience button — project', type: 'text' },
      { key: 'audience_join', label: 'Audience button — join', type: 'html' },
      { key: 'label_name', label: 'Label — Full Name', type: 'text' },
      { key: 'label_email', label: 'Label — Email Address', type: 'text' },
      { key: 'label_subject', label: 'Label — Subject', type: 'text' },
      { key: 'label_message', label: 'Label — Your Message', type: 'text' },
      { key: 'send_btn', label: 'Submit button text', type: 'text' },
      { key: 'toast_success_title', label: 'Success toast — title', type: 'text' },
      { key: 'toast_success_text', label: 'Success toast — message', type: 'text' }
    ]
  },
  {
    key: 'social', label: 'Social & Links', icon: 'bx-link',
    fields: [
      { key: 'link_github', label: 'GitHub URL', type: 'url' },
      { key: 'social_github_title', label: 'GitHub card — title', type: 'text' },
      { key: 'social_github_sub', label: 'GitHub card — subtitle', type: 'text' },
      { key: 'social_github_desc', label: 'GitHub card — description', type: 'html' },
      { key: 'link_linkedin', label: 'LinkedIn URL', type: 'url' },
      { key: 'social_linkedin_title', label: 'LinkedIn card — title', type: 'text' },
      { key: 'social_linkedin_sub', label: 'LinkedIn card — subtitle', type: 'text' },
      { key: 'social_linkedin_desc', label: 'LinkedIn card — description', type: 'html' },
      { key: 'link_email', label: 'Email address', type: 'url', help: 'Just the address — the mailto: link is built for you.' },
      { key: 'social_email_title', label: 'Email card — title', type: 'text' },
      { key: 'social_email_sub', label: 'Email card — address line', type: 'text' },
      { key: 'social_email_desc', label: 'Email card — description', type: 'text' }
    ]
  },
  {
    key: 'nav', label: 'Navigation', icon: 'bx-menu',
    fields: [
      { key: 'nav_home', label: 'Nav — Home', type: 'text' },
      { key: 'nav_studio', label: 'Nav — Studio', type: 'text' },
      { key: 'nav_build', label: 'Nav — Build With TALORA', type: 'html' },
      { key: 'nav_join', label: 'Nav — Join TALORA', type: 'html' },
      { key: 'nav_contact', label: 'Nav — Contact', type: 'text' }
    ]
  },
  {
    key: 'footer', label: 'Footer', icon: 'bx-copyright',
    fields: [
      { key: 'footer_text', label: 'Footer line', type: 'html' }
    ]
  }
];

// ---------- Defaults (mirror current index.html — used as fallback) ----------
const GRAD = (t) => '<span class="gradient">TALORA</span>';
const DEFAULTS = {
  hero_badge: 'Creative Technology Studio',
  hero_title: GRAD() + ' is the area for your talent to grow',
  hero_desc: GRAD() + ' collects valuable skills across design, engineering, creative technology and strategy, then connects that talent with projects where those skills can create real value.',
  link_hero_video: 'videos/hero-video.mp4',
  eco_title: 'The Studio <span class="accent-color">Ecosystem</span>',
  eco_sub: 'A premium ecosystem connecting clients with skilled people.',
  talent_title: 'Talent',
  talent_desc: GRAD() + ' brings together people with valuable skills across technology, design, creativity and strategy.',
  project_title: 'Project',
  project_desc: 'A client brings a project to ' + GRAD() + ' and explains what they need, what they want to achieve and what the project requires.',
  match_title: 'Match',
  match_desc: GRAD() + ' identifies the person or team whose skills are the strongest fit for that project.',
  build_title: 'Build',
  build_desc: "The selected talent works on the project, turning the client's needs into the actual product or experience.",
  deliver_title: 'Deliver',
  deliver_desc: 'The finished work is delivered to the client through ' + GRAD() + '.',
  earn_title: 'Earn',
  earn_desc: 'The client pays ' + GRAD() + '. ' + GRAD() + ' keeps the agreed share, and the remaining amount goes to the person or team who completed the work.',
  grow_title: 'Grow',
  // Grow description is fully editable; wording above mirrors the live site's original text
  grow_desc: 'Talent gains experience and new opportunities, clients can return with new ideas, and ' + GRAD() + ' continues connecting the right people with the right projects.',
  bwith_title: 'Build <span class="accent-color">With <span class="gradient">TALORA</span></span>',
  bwith_sub: 'Capabilities that live across the <span class="gradient">TALORA</span> ecosystem.',
  cap_design_title: 'Design',
  cap_design_list: 'UI/UX Design\nProduct Design\nVisual Design\nInteraction Design',
  cap_eng_title: 'Engineering',
  cap_eng_list: 'Front-End Development\nBack-End Development\nFull-Stack Development\nSoftware Engineering',
  cap_creative_title: 'Creative Technology',
  cap_creative_list: 'Creative Development\nMotion Design\nInteractive Experiences\nDigital Experiences',
  cap_strategy_title: 'Strategy',
  cap_strategy_list: 'Digital Strategy\nProduct Thinking\nExperience Strategy',
  join_title: 'Join <span class="accent-color"><span class="gradient">TALORA</span></span>',
  join_sub: 'Bring your skills into an ecosystem built around meaningful work.',
  join_eyebrow: 'Join <span class="gradient">TALORA</span>',
  join_state1_title: 'Meaningful Projects',
  join_state1_text: 'Work on real client projects matched to what you do best, in close collaboration.',
  join_state2_title: 'Grow & Earn',
  join_state2_text: 'Build experience with every project and get paid for the work you complete.',
  link_join_cta: '#contact',
  contact_title: "Let's <span class=\"gradient\">Build</span> Together",
  contact_sub: 'Connect with <span class="gradient">TALORA</span> — whether you have a project or skills to bring.',
  contact_question: 'What brings you to <span class="gradient">TALORA</span>?',
  audience_project: 'Start a Project',
  audience_join: 'Join <span class="gradient">TALORA</span>',
  label_name: 'Full Name',
  label_email: 'Email Address',
  label_subject: 'Subject',
  label_message: 'Your Message',
  send_btn: 'Send Message',
  toast_success_title: 'Message Sent Successfully',
  toast_success_text: 'Thank you for reaching out to TALORA. Your inquiry has been received.',
  link_github: 'https://github.com/ikramhamdani110-lab/',
  social_github_title: 'GitHub',
  social_github_sub: 'Explore Our Work',
  social_github_desc: "Discover projects and work created by <span class=\"gradient\">TALORA</span>'s talent.",
  link_linkedin: 'https://www.linkedin.com/in/hamdani-ikram-86a0953b0/',
  social_linkedin_title: 'LinkedIn',
  social_linkedin_sub: 'Follow Our Journey',
  social_linkedin_desc: "Stay updated on <span class=\"gradient\">TALORA</span>'s growth and company updates.",
  link_email: 'ikramhamdani110@gmail.com',
  social_email_title: 'Email',
  social_email_sub: 'ikramhamdani110@gmail.com',
  social_email_desc: "Write to us and we'll respond quickly.",
  nav_home: 'Home',
  nav_studio: 'Studio',
  nav_build: 'Build With <span class="gradient">TALORA</span>',
  nav_join: 'Join <span class="gradient">TALORA</span>',
  nav_contact: 'Contact',
  footer_text: '© 2025 <span class="gradient">TALORA</span>. A premium ecosystem connecting clients with skilled people.'
};

const ALL_KEYS = SECTIONS.flatMap(s => s.fields.map(f => f.key));
const FIELD_MAP = Object.fromEntries(SECTIONS.flatMap(s => s.fields.map(f => [f.key, f])));
const LIMITS = { text: 500, html: 1000, list: 2000, url: 500 };

// ---------- Database ----------
function pgConnectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function createDb(dbFile) {
  const Database = require('better-sqlite3');
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS website_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return db;
}

let pgPool = null;
function getPool() {
  if (!pgPool) {
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: pgConnectionString(), max: 3, ssl: { rejectUnauthorized: false } });
  }
  return pgPool;
}

// Returns the effective value map. Public: published keys only (defaults fill the rest).
async function getSettings(db, { publicOnly = false } = {}) {
  const rows = pgConnectionString()
    ? (await ensurePgTable(), (await getPool().query('SELECT key, value, status FROM website_settings')).rows)
    : db.prepare('SELECT key, value, status FROM website_settings').all();
  const overrides = {};
  for (const r of rows) {
    if (!ALL_KEYS.includes(r.key)) continue;
    if (publicOnly && r.status !== 'published') continue;
    overrides[r.key] = r.value;
  }
  const merged = { ...DEFAULTS, ...overrides };
  // An override explicitly saved as empty resets to the default
  for (const k of Object.keys(merged)) {
    if (merged[k] === '' && DEFAULTS[k] !== '') merged[k] = DEFAULTS[k];
  }
  return merged;
}

// Returns { ok: true, saved: n } or { ok: false, status, message }
async function saveSettings(db, body) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body || '{}') : (body || {}); }
  catch { return { ok: false, status: 400, message: 'Invalid request body.' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.values !== 'object' || data.values === null) {
    return { ok: false, status: 400, message: 'Invalid request body. Expected a "values" object.' };
  }
  const values = data.values;
  for (const key of Object.keys(values)) {
    if (!ALL_KEYS.includes(key)) {
      return { ok: false, status: 400, message: 'Unknown content key: ' + key + '.' };
    }
    const v = values[key];
    if (v !== null && typeof v !== 'string') {
      return { ok: false, status: 400, message: 'Invalid value for ' + key + '.' };
    }
    const err = validateValue(key, v == null ? '' : v);
    if (err) return { ok: false, status: 400, message: err };
  }

  const entries = Object.entries(values);
  if (pgConnectionString()) {
    await ensurePgTable();
    for (const [key, value] of entries) {
      await getPool().query(
        `INSERT INTO website_settings (key, value, status, updated_at) VALUES ($1, $2, 'published', now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, status = 'published', updated_at = now()`,
        [key, value]);
    }
  } else {
    const upsert = db.prepare(`INSERT INTO website_settings (key, value, status, updated_at)
      VALUES (?, ?, 'published', datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, status = 'published', updated_at = datetime('now')`);
    const tx = db.transaction((rows) => { for (const [k, v] of rows) upsert.run(k, v); });
    tx(entries);
  }
  return { ok: true, saved: entries.length };
}

function validateValue(key, value) {
  const def = FIELD_MAP[key];
  const v = value.trim();
  if (v.length > (LIMITS[def.type] || 500)) {
    return 'Value for ' + key + ' is too long (max ' + (LIMITS[def.type] || 500) + ' characters).';
  }
  if (def.type === 'url') {
    if (v && !( /^https?:\/\//i.test(v) || /^mailto:/i.test(v) || /^(\/#|\.\/|\.\.\/)/.test(v) || /^#/.test(v)
      || /^[\w\- ]+(\/[\w\-. %@]+)*$/.test(v)   // relative path e.g. videos/hero-video.mp4
      || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) )) { // bare email address
      return def.help || (key + ' must be a valid URL, email address or path.');
    }
  }
  if (def.type === 'list') {
    for (const line of v.split('\n')) {
      if (line.trim().length > 100) return 'Each line in ' + key + ' must be 100 characters or fewer.';
    }
  }
  return null;
}

async function ensurePgTable() {
  await getPool().query(`CREATE TABLE IF NOT EXISTS website_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

// Auth is shared with the content CMS (same bearer-token admin auth)
function verifyAdmin(req) { return verifyAuth(req); }

module.exports = {
  SECTIONS, DEFAULTS, ALL_KEYS, FIELD_MAP,
  pgConnectionString, createDb,
  getSettings, saveSettings, verifyAdmin
};
