// 관리자 화면용 비밀번호 확인. 비밀번호는 환경 변수 ADMIN_PASSWORD, 없으면 데모 값 0000.
// 화면에서만 막으면 주소(/api/reservations)로 바로 열 수 있으므로 API 에서 검사한다.
const crypto = require('crypto');

const PASSWORD = () => String(process.env.ADMIN_PASSWORD || '0000');
const digest = s => crypto.createHash('sha256').update(String(s)).digest();

function isAdmin(req) {
  const given = req.headers && req.headers['x-admin-password'];
  if (typeof given !== 'string') return false;
  return crypto.timingSafeEqual(digest(given), digest(PASSWORD()));
}

// 통과하면 true, 아니면 401 을 보내고 false
function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  res.status(401).json({ error: '관리자 비밀번호가 필요해요' });
  return false;
}

module.exports = { requireAdmin, isAdmin };
