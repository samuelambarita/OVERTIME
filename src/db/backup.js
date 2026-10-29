const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./index');

const pad = (n) => String(n).padStart(2, '0');

// Waktu lokal: lembur-YYYYMMDD-HHMMSS.db
function backupName(now) {
  return `lembur-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.db`;
}

function backup(db, dir = 'backups', now = new Date()) {
  const file = db.prepare('PRAGMA database_list').all().find((r) => r.name === 'main');
  if (!file || !file.file) throw new Error('Backup tidak tersedia untuk database :memory:.');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.resolve(dir, backupName(now));
  if (fs.existsSync(target)) throw new Error(`File backup sudah ada: ${target}`);
  db.prepare('VACUUM INTO ?').run(target);
  return target;
}

if (require.main === module) {
  const config = require('../config');
  if (config.dbFile === ':memory:') {
    console.error('Backup tidak tersedia untuk database :memory:.');
    process.exit(1);
  }
  const db = openDb();
  try {
    console.log(backup(db));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  db.close();
}

module.exports = { backup, backupName };
