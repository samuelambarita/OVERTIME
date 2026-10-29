const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../../src/db');
const { buildDemoOrg } = require('../../src/db/demo');
const deps = require('../../src/services/departments');

const msg = (fn) => { try { fn(); } catch (e) { return e.errors; } return null; };

test('CRUD departemen dan userCount', () => {
  const db = openDb(':memory:');
  const ids = buildDemoOrg(db);
  const actor = { id: ids.admin };
  const list = deps.listDepartments(db);
  assert.strictEqual(list.find(d => d.name === 'IT').userCount, 6);
  const id = deps.createDepartment(db, actor, { name: 'Ops', category: 'NON_IT' });
  deps.updateDepartment(db, actor, id, { name: 'Operasi', category: 'IT' });
  assert.strictEqual(deps.listDepartments(db).find(d => d.id === id).name, 'Operasi');
  deps.deleteDepartment(db, actor, id);
  assert.ok(!deps.listDepartments(db).some(d => d.id === id));
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='department.create'").get());
});

test('validasi departemen', () => {
  const db = openDb(':memory:');
  const ids = buildDemoOrg(db);
  const actor = { id: ids.admin };
  const it = deps.listDepartments(db).find(d => d.name === 'IT').id;
  assert.deepStrictEqual(msg(() => deps.deleteDepartment(db, actor, it)), ['Departemen masih memiliki user.']);
  assert.deepStrictEqual(msg(() => deps.createDepartment(db, actor, { name: 'it', category: 'IT' })), ['Nama departemen sudah dipakai.']);
  assert.ok(msg(() => deps.createDepartment(db, actor, { name: 'X', category: 'LAIN' })));
  assert.deepStrictEqual(msg(() => deps.updateDepartment(db, actor, it, { name: 'Finance', category: 'IT' })), ['Nama departemen sudah dipakai.']);
});
