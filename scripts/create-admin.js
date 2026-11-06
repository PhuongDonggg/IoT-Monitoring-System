const readline = require('node:readline');
const bcrypt = require('bcryptjs');
const { pool, testConnection } = require('../src/db');
const { httpError } = require('../src/utils/validation');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: process.stdin.isTTY
});

function ask(prompt, hide = false) {
  return new Promise(resolve => {
    const originalWrite = rl._writeToOutput;
    if (hide && process.stdin.isTTY) {
      process.stdout.write(prompt);
      rl._writeToOutput = function (text) {
        if (/\r|\n/.test(text)) rl.output.write(text);
      };
    }
    rl.question(hide && process.stdin.isTTY ? '' : prompt, answer => {
      rl._writeToOutput = originalWrite;
      if (hide && process.stdin.isTTY) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function createAdmin() {
  try {
    await testConnection();
    const username = (await ask('Tên tài khoản (vd: admin): ')).trim();
    const fullName = (await ask('Họ tên hiển thị: ')).trim();
    const password = await ask('Mật khẩu (ít nhất 8 ký tự, không hiển thị): ', true);
    if (!/^[a-zA-Z0-9_.-]{3,100}$/.test(username)) {
      throw httpError(400, 'Username phải dài từ 3 ký tự, chỉ gồm chữ/số/._-');
    }
    if (!fullName || fullName.length > 150) throw httpError(400, 'Họ tên không hợp lệ');
    if (password.length < 8 || password.length > 256) {
      throw httpError(400, 'Mật khẩu phải dài 8-256 ký tự');
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.execute(
      `INSERT INTO users(username,password_hash,full_name,created_at)
       VALUES (?,?,?,UTC_TIMESTAMP(3))`,
      [username, hash, fullName]
    );
    console.log(`Đã tạo tài khoản ${username}. Mật khẩu chỉ được lưu dạng hash.`);
  } catch (err) {
    console.error('Không tạo được tài khoản:', err.code === 'ER_DUP_ENTRY' ? 'Username đã tồn tại' : err.message);
    process.exitCode = 1;
  } finally {
    rl.close();
    await pool.end();
  }
}

createAdmin();
