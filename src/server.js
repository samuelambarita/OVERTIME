const config = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');

if (!config.sessionSecret) {
  console.error('SESSION_SECRET wajib diisi (lihat .env).');
  process.exit(1);
}

const db = openDb();
const app = createApp({ db, sessionSecret: config.sessionSecret, secureCookie: config.secureCookie, trustProxy: config.trustProxy });
app.listen(config.port, () => console.log(`Lembur berjalan di http://localhost:${config.port}`));
