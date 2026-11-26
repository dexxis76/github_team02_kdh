// 국가교통정보센터(ITS) 교통소통정보 호출. 키는 서버 환경 변수 ITS_API_KEY(없으면 Livetraffic)에서만 읽고 브라우저로 내보내지 않는다.
const { fetchT, isTimeout } = require('./_util');

const URL_BASE = 'https://openapi.its.go.kr:9443/trafficInfo';
const key = () => process.env.ITS_API_KEY || process.env.Livetraffic || '';
const hasKey = () => !!key();
const last = { traffic: null };
let cache = null; // 같은 요청은 잠시 재사용해서 호출 횟수(일일 한도)를 아낀다

async function trafficInfo(bbox, ttl = 5 * 60e3) {
  if (!hasKey()) return mark({ ok: false, reason: '키 비어 있음' });
  const ck = JSON.stringify(bbox);
  if (cache && cache.ck === ck && Date.now() - cache.at < ttl) return cache.res;
  const qs = new URLSearchParams({
    apiKey: key(), type: 'all', drcType: 'all', getType: 'json',
    minX: bbox.minLon, maxX: bbox.maxLon, minY: bbox.minLat, maxY: bbox.maxLat,
  }).toString();
  const t0 = Date.now();
  try {
    const r = await fetchT(`${URL_BASE}?${qs}`, {}, 20000);
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* XML·HTML 오류 문서일 수 있음 */ }
    if (!r.ok || !data) {
      const reason = r.status === 401 || r.status === 403 ? `승인 안 됨(${r.status})` : !r.ok ? `응답 ${r.status}` : `JSON 이 아닌 응답: ${text.slice(0, 80).replace(key(), '***')}`;
      return mark({ ok: false, reason });
    }
    const res = mark({ ok: true, data, ms: Date.now() - t0 });
    cache = { ck, at: Date.now(), res };
    return res;
  } catch (e) {
    return mark({ ok: false, reason: isTimeout(e) ? '시간 초과' : `연결 실패: ${String(e.message).replace(key(), '***')}${e.cause && (e.cause.code || e.cause.message) ? ' (' + String(e.cause.code || e.cause.message).replace(key(), '***') + ')' : ''}` });
  }
}
function mark(res) { last.traffic = { ok: res.ok, reason: res.reason, ms: res.ms, at: new Date().toISOString() }; return res; }

module.exports = { trafficInfo, hasKey, last };
