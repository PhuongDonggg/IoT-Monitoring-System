const mysql = require('mysql2/promise');
const { db: settings } = require('./config');
const pool = mysql.createPool({
  ...settings,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60000,
  queueLimit: 0,
  timezone: 'Z',
  decimalNumbers: true,
  dateStrings: false
});
async function testConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.query("SET time_zone = '+00:00'");
    await conn.query('SELECT 1 AS ok');
  } finally { conn.release(); }
}
module.exports = { pool, testConnection };
