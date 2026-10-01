// Task 9 (RBAC) — seed one ADMIN and one EMPLOYEE account for local development.
//
//   node seed-rbac-users.js
//
// Credentials come from the environment (never hardcoded secrets):
//   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
//   SEED_EMPLOYEE_EMAIL / SEED_EMPLOYEE_PASSWORD
// When SEED_ADMIN_PASSWORD is not set, the two demo passwords below are used —
// they are local-development-only values that are useless in production because
// seed-rbac-users.js is never run there (and ADMIN_TOKEN_SECRET gates prod auth).
const path = require('path');
const cc = require('./content-core');
const auc = require('./auth-user-core');
const { ROLES } = require('./rbac-core');

const IS_PROD = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
if (IS_PROD) {
  console.error('Refusing to seed demo users in production.');
  process.exit(1);
}

const SEEDS = [
  {
    role: ROLES.ADMIN,
    fullName: 'TALORA Admin',
    email: (process.env.SEED_ADMIN_EMAIL || 'admin@talora.dev').toLowerCase(),
    password: process.env.SEED_ADMIN_PASSWORD || 'TaloraAdmin!2024'
  },
  {
    role: ROLES.EMPLOYEE,
    fullName: 'TALORA Employee',
    email: (process.env.SEED_EMPLOYEE_EMAIL || 'employee@talora.dev').toLowerCase(),
    password: process.env.SEED_EMPLOYEE_PASSWORD || 'TaloraEmployee!2024'
  }
];

(async () => {
  const db = cc.createDb(path.join(__dirname, process.env.DATABASE_PATH || 'talora.db'));
  try {
    for (const s of SEEDS) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(s.email);
      if (existing) {
        db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(s.role, existing.id);
        console.log(`updated  ${s.role.padEnd(8)} ${s.email}`);
        continue;
      }
      const info = db.prepare('INSERT INTO users (full_name, email, password_hash, role, signup_type) VALUES (?, ?, ?, ?, ?)')
        .run(s.fullName, s.email, auc.hashPassword(s.password), s.role, 'project');
      console.log(`created  ${s.role.padEnd(8)} ${s.email} (id ${info.lastInsertRowid})`);
    }
    console.log('\nSign in through POST /api/auth/user-login (or dashboard.html).');
    console.log('The CMS admin (cms.html) still uses the env-configured ADMIN_USERNAME/ADMIN_PASSWORD.');
  } finally { db.close(); }
})().catch(err => { console.error('seed failed:', err); process.exit(1); });
