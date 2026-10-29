// Zona waktu harus ditetapkan sebelum ada pemakaian Date (jam lembur memakai waktu lokal server).
process.env.TZ = process.env.TZ || process.env.APP_TZ || 'Asia/Jakarta';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const env = process.env;
const root = path.join(__dirname, '..');

// Path relatif dihitung dari root proyek, bukan dari direktori kerja.
const dbFile = env.DB_FILE || 'data/lembur.db';

module.exports = {
  root,
  port: Number(env.PORT || 3000),
  sessionSecret: env.SESSION_SECRET,
  secureCookie: env.HTTPS === 'true',
  trustProxy: env.TRUST_PROXY === 'true',
  dbFile: dbFile === ':memory:' || path.isAbsolute(dbFile) ? dbFile : path.join(root, dbFile),
  backupDir: path.join(root, 'backups'),
};
