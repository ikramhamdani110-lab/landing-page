import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import requestsCore from './requests-core.js';

const { createDb, validateRequest, createRequest, listRequests, updateRequestStatus } = requestsCore;

const dbPath = path.join(process.cwd(), 'tmp-request-test.db');
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

const db = createDb(dbPath);
try {
  const valid = validateRequest({
    fullName: 'Client Name',
    email: 'client@example.com',
    companyName: 'TALORA Client',
    category: 'Design',
    title: 'Website redesign',
    description: 'We need a premium redesign.',
    budget: '15000',
    deadline: '2026-10-01',
    additionalDetails: 'Please include accessibility.'
  });
  assert.equal(valid.ok, true);

  const created = await createRequest(db, valid.fields);
  assert.equal(created.status, 'NEW');
  assert.equal(created.customerName, 'Client Name');

  const rows = await listRequests(db, { limit: 10 });
  assert.equal(rows.items.length, 1);
  assert.equal(rows.items[0].customerEmail, 'client@example.com');

  const updated = await updateRequestStatus(db, created.id, 'REVIEWING');
  assert.equal(updated.ok, true);
  assert.equal(updated.status, 'REVIEWING');

  console.log('request tests passed');
} finally {
  db.close();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
}
