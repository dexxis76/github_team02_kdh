// GET /api/congestion?day=0|1 — 시간대별 예상 출국장 승객 수 (승객예고 API, 실패 시 시연 값)
const { getCongestion } = require('./_public');

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const day = url.searchParams.get('day') === '1' ? 1 : 0;
  const c = await getCongestion(day);
  res.status(200).json({
    api: '승객예고 API', source: c.live ? '실시간' : '시연 값', reason: c.live ? null : c.reason,
    date: c.date || null, rows: c.rows, note: '예상치이며 실측이 아닙니다.',
  });
};
