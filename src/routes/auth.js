const express = require('express');
const bcrypt = require('bcryptjs');
const {pool} = require('../db');
const {signToken, requireAuth} = require('../auth');
const {httpError} = require('../utils/validation');
const r = express.Router();
r.post('/login', async (req, res) => {
  const {username, password} = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password || username.length > 100 || password.length > 256) throw httpError(400, 'Username hoặc password không hợp lệ');
  const [rows] = await pool.execute('SELECT id, username, full_name, password_hash FROM users WHERE username = ? LIMIT 1', [username.trim()]);
  const valid = rows.length && await bcrypt.compare(password, rows[0].password_hash);
  if (!valid) throw httpError(401, 'Sai tài khoản hoặc mật khẩu');
  const user = {id: rows[0].id, username: rows[0].username, fullName: rows[0].full_name};
  return res.json({token: signToken(user), tokenType: 'Bearer', user});
});
r.get('/me', requireAuth, async (req, res) => {
  const [rows] = await pool.execute('SELECT id, username, full_name FROM users WHERE id=?', [req.user.id]);
  if (!rows.length) throw httpError(401, 'Tài khoản không còn tồn tại');
  res.json({id: rows[0].id, username: rows[0].username, fullName: rows[0].full_name});
});
module.exports = r;
