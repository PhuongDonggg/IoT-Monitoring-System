const jwt = require('jsonwebtoken');
const config = require('./config');
const {httpError} = require('./utils/validation');
function signToken(user) {
  return jwt.sign({sub: String(user.id), username: user.username}, config.jwtSecret, {expiresIn: config.jwtExpiresIn});
}
function verifyToken(token) {
  const p = jwt.verify(token, config.jwtSecret, {algorithms:['HS256']});
  if (!Number.isSafeInteger(Number(p.sub)) || Number(p.sub) <= 0) throw new Error('Invalid token');
  return {id: Number(p.sub), username: p.username};
}
function requireAuth(req, res, next) {
  const header = req.get('Authorization') || '';
  const match = /^Bearer (\S+)$/.exec(header);
  if (!match) return next(httpError(401, 'Yêu cầu đăng nhập'));
  try { req.user = verifyToken(match[1]); next(); }
  catch { next(httpError(401, 'Token không hợp lệ hoặc đã hết hạn')); }
}
module.exports = {signToken, verifyToken, requireAuth};
