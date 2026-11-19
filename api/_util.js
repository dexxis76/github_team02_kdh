// 날짜·시간 도우미 (모두 한국 시간 기준)
const KST = 9 * 3600e3;
const today = () => new Date(Date.now() + KST).toISOString().slice(0, 10);
const addDays = (s, n) => {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diffDays = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5);
const won = n => Number(n).toLocaleString('ko-KR') + '원';
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const korDate = s => { const [, m, d] = s.split('-'); return `${Number(m)}월 ${Number(d)}일`; };

// 공공데이터포털 키: Encoding(%가 들어 있음)·Decoding(원문) 둘 다 동작하게 한다
const encodeKey = k => (/%[0-9A-Fa-f]{2}/.test(k) ? k : encodeURIComponent(k));

// fetch + 시간 초과
async function fetchT(url, opts = {}, ms = 15000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}
const isTimeout = e => e && (e.name === 'TimeoutError' || e.name === 'AbortError');

module.exports = { today, addDays, diffDays, won, validDate, korDate, encodeKey, fetchT, isTimeout };
