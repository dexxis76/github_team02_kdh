// 공공 API 는 여기(서버)에서만 부른다.
// 실패하면 이유(키 비어 있음 · 승인 안 됨 · 시간 초과 · 오류)와 「시연 값」을 함께 돌려준다.
const { encodeKey, fetchT, isTimeout } = require('./_util');

const FLIGHT_URL = 'https://apis.data.go.kr/B551177/StatusOfPassengerFlightsDSOdp/getPassengerDeparturesDSOdp';
const NOTICE_URL = 'https://apis.data.go.kr/B551177/passgrAnncmt/getPassgrAnncmt';

// .env 이름: 여객편 주간 운항 현황 = INCHEON, 승객예고 = Passenger
const KEY = { flights: 'INCHEON', notice: 'Passenger' };

const last = { flights: null, notice: null }; // 마지막 호출 결과 (상태 화면용)

async function call(which, url) {
  const name = KEY[which];
  const key = process.env[name];
  const t0 = Date.now();
  const done = r => { last[which] = { ok: r.ok, reason: r.reason || null, at: new Date().toISOString(), ms: Date.now() - t0 }; return r; };
  if (!key) return done({ ok: false, reason: '키 비어 있음' });
  try {
    const res = await fetchT(`${url}${url.includes('?') ? '&' : '?'}type=json&serviceKey=${encodeKey(key)}`, {}, 20000);
    const text = await res.text();
    const keyProblem = /SERVICE_KEY|NOT_REGISTERED|UNREGISTERED|ACCESS_DENIED/i.test(text.slice(0, 600));
    if (res.status === 401 || res.status === 403 || (keyProblem && !text.startsWith('{"response"')))
      return done({ ok: false, reason: '승인 안 됨' });
    let j;
    try { j = JSON.parse(text); } catch { return done({ ok: false, reason: '오류(응답 형식)' }); }
    const h = j.response && j.response.header;
    if (!h) return done({ ok: false, reason: '오류(응답 형식)' });
    if (h.resultCode !== '00') {
      const bad = /KEY|APPROV|DENIED/i.test(h.resultMsg || '');
      return done({ ok: false, reason: bad ? '승인 안 됨' : `오류(${h.resultMsg || h.resultCode})` });
    }
    const items = j.response.body.items;
    return done({ ok: true, items: Array.isArray(items) ? items : items && items.item ? [].concat(items.item) : [] });
  } catch (e) {
    return done({ ok: false, reason: isTimeout(e) ? '시간 초과' : `오류(${e.message})` });
  }
}

// ---- 여객편 주간 운항 현황 (출발) : 하루 500회 한도라 30분 보관
let flightCache = null;
async function getFlights() {
  if (flightCache && Date.now() - flightCache.at < 30 * 60e3) return flightCache.r;
  const r = await call('flights', FLIGHT_URL);
  if (r.ok) flightCache = { at: Date.now(), r };
  return r;
}
const termOf = id => (id === 'P01' || id === 'P03' ? 'T1' : id === 'P02' ? 'T2' : null);
const hhmm = s => `${s.slice(8, 10)}:${s.slice(10, 12)}`;

async function lookupFlight(flightId, date) {
  const r = await getFlights();
  if (!r.ok) return { ok: false, reason: r.reason };
  const id = String(flightId).replace(/\s/g, '').toUpperCase();
  const d = date.replace(/-/g, '');
  const hit = r.items.find(x => String(x.flightId).toUpperCase() === id && String(x.scheduleDateTime).startsWith(d));
  if (!hit) return { ok: true, found: false };
  return {
    ok: true, found: true,
    flight: {
      flightId: hit.flightId, airline: hit.airline, airport: hit.airport, airportCode: hit.airportCode,
      depTime: hhmm(String(hit.scheduleDateTime)), terminal: termOf(hit.terminalid),
      remark: hit.remark || '', estimated: hit.estimatedDateTime ? hhmm(String(hit.estimatedDateTime)) : null,
    },
  };
}

// ---- 승객예고 출·입국장별 : 예상치라 10분 보관
const noticeCache = {};
// 시연 값: API 가 안 될 때 보여 주는 예시 곡선 (실제 데이터 아님)
const DEMO_CURVE = [900, 700, 500, 450, 800, 1900, 3100, 3600, 3300, 3000, 2800, 2600, 2700, 2900, 2600, 2300, 2400, 2500, 2200, 1800, 1500, 1200, 1000, 900];
function demoRows() {
  return DEMO_CURVE.map((v, i) => ({ hour: i, t1: Math.round(v * 0.75), t2: Math.round(v * 0.25) }));
}
async function getCongestion(dayOffset = 0) {
  const c = noticeCache[dayOffset];
  if (c && Date.now() - c.at < 10 * 60e3) return c.v;
  const r = await call('notice', `${NOTICE_URL}?selectdate=${dayOffset}&numOfRows=30&pageNo=1`);
  let v;
  if (r.ok && r.items.length) {
    const rows = r.items.map(x => ({
      hour: parseInt(String(x.atime).slice(0, 2), 10),
      t1: Math.round(Number(x.t1dgsum1) || 0),
      t2: Math.round(Number(x.t2dgsum2) || 0),
    })).filter(x => !isNaN(x.hour)).sort((a, b) => a.hour - b.hour);
    v = { ok: true, live: true, date: r.items[0].adate, rows };
  } else {
    v = { ok: false, live: false, reason: r.reason || '오류(빈 응답)', rows: demoRows() };
  }
  if (v.ok) noticeCache[dayOffset] = { at: Date.now(), v };
  return v;
}

const peakText = (rows, key) => {
  const top = [...rows].sort((a, b) => b[key] - a[key]).slice(0, 3).sort((a, b) => a.hour - b.hour);
  return top.map(x => `${x.hour}~${x.hour + 1}시(${x[key].toLocaleString('ko-KR')}명)`).join(', ');
};
function congestionText(c) {
  const tag = c.live ? `승객예고 API 실시간 예상치, ${c.date}` : `시연 값(승객예고 API ${c.reason})`;
  return `[${tag}] 출국장 승객이 많은 시간대 — 제1터미널: ${peakText(c.rows, 't1')} / 제2터미널: ${peakText(c.rows, 't2')}. 예상치이며 실측이 아닙니다.`;
}

module.exports = { lookupFlight, getCongestion, congestionText, last, KEY };
