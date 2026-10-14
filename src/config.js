require('dotenv').config();
function required(name) {
  const value = process.env[name];
  if (!value || value.startsWith('REPLACE_WITH_')) throw new Error(`Thiếu cấu hình ${name} trong .env`);
  return value;
}
function port(name, fallback) {
  const x = Number(process.env[name] || fallback);
  if (!Number.isInteger(x) || x < 1 || x > 65535) throw new Error(`Cổng ${name} không hợp lệ`);
  return x;
}
const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET phải dài tối thiểu 32 ký tự');
module.exports = {
  port: port('PORT', 3000),
  db: {host: required('DB_HOST'), port: port('DB_PORT', 3306), user: required('DB_USER'), password: required('DB_PASSWORD'), database: required('DB_NAME')},
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  mqtt: {host: required('MQTT_HOST'), port: port('MQTT_PORT', 2005), username: required('MQTT_USERNAME'), password: required('MQTT_PASSWORD'), protocol: process.env.MQTT_PROTOCOL || 'mqtt'},
  commandTimeoutMs: Number(process.env.COMMAND_TIMEOUT_MS || 5000)
};
