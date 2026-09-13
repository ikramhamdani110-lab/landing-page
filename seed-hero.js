// Seeds the real TALORA website content (Hero) into the content table if not present.
const path = require('path');
const cc = require('./content-core');
const db = cc.createDb(path.join(__dirname, process.env.DATABASE_PATH || 'talora.db'));

(async () => {
  const existing = await cc.listContent(db, { section: 'Hero', status: 'published' });
  if (existing.length) { console.log('Hero content already present:', existing[0].title); return; }
  const item = await cc.createContent(db, {
    title: 'TALORA is the area for your talent to grow',
    description: 'TALORA collects valuable skills across design, engineering, creative technology and strategy, then connects that talent with projects where those skills can create real value.',
    category: 'General',
    status: 'published',
    section: 'Hero'
  });
  console.log('Seeded Hero content, id', item.id);
})();
