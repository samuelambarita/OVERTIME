const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const env = process.env;

module.exports = {
  port: Number(env.PORT || 3000),
  sessionSecret: env.SESSION_SECRET,
  secureCookie: env.HTTPS === 'true',
  dbFile: env.DB_FILE || 'data/lembur.db',
};
