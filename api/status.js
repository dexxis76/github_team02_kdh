// GET /api/status — 키 이름별 「값 있음/비어 있음」과 마지막 호출 결과 (키 값은 절대 내보내지 않는다)
const { keyStatus, last: ai } = require('./_ai');
const pub = require('./_public');
const store = require('./_store');
const { count } = require('./_docs');
const its = require('./_its');
const { requireAdmin } = require('./_admin');

module.exports = async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  res.status(200).json({
    keys: { ...keyStatus(), [pub.KEY.flights]: process.env[pub.KEY.flights] ? '값 있음' : '비어 있음', [pub.KEY.notice]: process.env[pub.KEY.notice] ? '값 있음' : '비어 있음', ITS_API_KEY: its.hasKey() ? '값 있음' : '비어 있음' },
    aiOrder: ['CLAUDE_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY'],
    lastAI: ai, lastPublic: { ...pub.last, its: its.last.traffic }, docs: count(), storage: store.storage(),
  });
};
