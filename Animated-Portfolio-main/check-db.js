require('dotenv').config({ path: '.env.production' });
const { Pool } = require('pg');
(async () => {
  try {
    const r = await new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
      .query('SELECT id, name, email, subject, message, "createdAt" FROM inquiries ORDER BY id');
    console.log(JSON.stringify(r.rows, null, 1));
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message);
    process.exit(1);
  }
})();
