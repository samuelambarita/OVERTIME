const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../../src/db');
const { buildDemoOrg } = require('../../src/db/demo');
const audit = require('../../src/services/audit');

test('listAudit: join nama aktor, filter prefix ter-escape, urut terbaru, paginasi', () => {
  const db = openDb(':memory:');
  const ids = buildDemoOrg(db);
  audit.log(db, ids.admin, 'user.create', 'user', 1, { a: 1 });
  audit.log(db, ids.admin, 'user.update', 'user', 1);
  audit.log(db, null, 'department.create', 'department', 2);
  audit.log(db, ids.admin, 'x%y', 'user', 3);

  const all = audit.listAudit(db, {});
  assert.strictEqual(all.total, 4);
  assert.strictEqual(all.rows[0].action, 'x%y');
  assert.strictEqual(all.rows.find((r) => r.action === 'user.create').actor_name, 'Admin');
  assert.strictEqual(all.rows.find((r) => r.action === 'department.create').actor_name, null);

  assert.strictEqual(audit.listAudit(db, { action: 'user.' }).total, 2);
  assert.strictEqual(audit.listAudit(db, { action: 'x%' }).total, 1);
  assert.strictEqual(audit.listAudit(db, { action: '%' }).total, 0); // wildcard tidak berlaku
  assert.strictEqual(audit.listAudit(db, { action: 'user.', page: 2 }).rows.length, 0);
});
