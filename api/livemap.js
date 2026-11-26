// 관리자 지도용 실시간 교통 중계 (비밀번호 필요). 키는 서버에서만 쓴다.
//   GET /api/livemap?kind=base     → 구·시·군 대표 좌표, 인천공항, 지도 범위
//   GET /api/livemap?kind=traffic  → ITS 교통소통정보(서울·경기 범위)를 지도에 쓸 모양으로 정리
//   GET /api/livemap?kind=probe    → 응답 모양 확인용(필드 이름과 앞 2건, 키는 없음)
const { requireAdmin } = require('./_admin');
const its = require('./_its');
const geo = require('./_geo');
const { ZONES } = require('./_zones');

const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const pick = (o, names) => { for (const n of names) if (o[n] != null && o[n] !== '') return o[n]; return null; };

// 응답에서 항목 배열 찾기 (body.items / body.items.item / items 등 모양이 달라도 읽는다)
function items(d) {
  const b = (d && (d.body || d.response && d.response.body)) || d || {};
  let it = b.items != null ? b.items : b.item != null ? b.item : b;
  if (it && !Array.isArray(it) && it.item) it = it.item;
  if (it && !Array.isArray(it) && typeof it === 'object' && Array.isArray(Object.values(it)[0])) it = Object.values(it)[0];
  return Array.isArray(it) ? it : (it && typeof it === 'object' ? [it] : []);
}
const level = sp => (sp == null ? 0 : sp >= 60 ? 1 : sp >= 40 ? 2 : sp >= 20 ? 3 : 4); // 속도(km/h) → 원활·서행·지체·정체 (어림 기준)

function shape(d) {
  const rows = [], lines = [];
  for (const it of items(d)) {
    const speed = num(pick(it, ['speed', 'spd', 'avgSpeed']));
    const name = String(pick(it, ['roadName', 'routeName', 'linkName', 'name', 'startNodeName']) || '');
    const sx = num(pick(it, ['startX', 'sx', 'startLon', 'fromX'])), sy = num(pick(it, ['startY', 'sy', 'startLat', 'fromY']));
    const ex = num(pick(it, ['endX', 'ex', 'endLon', 'toX'])), ey = num(pick(it, ['endY', 'ey', 'endLat', 'toY']));
    rows.push({ name, speed, travelTime: num(pick(it, ['travelTime', 'time'])) });
    if (sx != null && sy != null && ex != null && ey != null) lines.push({ c: level(speed), p: [[sx, sy], [ex, ey]], s: speed, n: name });
  }
  return { rows, lines };
}

module.exports = async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  const kind = new URL(req.url, 'http://x').searchParams.get('kind') || '';
  if (kind === 'base') return res.status(200).json({ hasKey: its.hasKey(), centers: geo.CENTERS, airport: geo.AIRPORT, bbox: geo.BBOX, zones: ZONES.map(z => ({ car: z.car, name: z.name, color: z.color, districts: z.districts })) });
  if (kind === 'net') {
    const { fetchT } = require('./_util');
    const targets = ['https://openapi.its.go.kr:9443/', 'https://openapi.its.go.kr/', 'http://openapi.its.go.kr:8080/', 'https://www.its.go.kr/', 'https://apis.data.go.kr/'];
    const out = await Promise.all(targets.map(async u => {
      const t0 = Date.now();
      try { const r = await fetchT(u, { redirect: 'manual' }, 8000); return { url: u, ok: true, status: r.status, ms: Date.now() - t0 }; }
      catch (e) { return { url: u, ok: false, error: (e.cause && (e.cause.code || e.cause.message)) || e.message, ms: Date.now() - t0 }; }
    }));
    return res.status(200).json({ region: process.env.VERCEL_REGION || null, results: out });
  }
  if (kind !== 'traffic' && kind !== 'probe') return res.status(400).json({ error: '알 수 없는 요청' });
  const r = await its.trafficInfo(geo.BBOX);
  if (!r.ok) return res.status(200).json({ ok: false, reason: r.reason });
  if (kind === 'probe') {
    const list = items(r.data);
    const header = (r.data && (r.data.header || r.data.response && r.data.response.header)) || null;
    return res.status(200).json({ ok: true, topKeys: Object.keys(r.data || {}), header, count: list.length, itemKeys: list[0] ? Object.keys(list[0]) : [], sample: list.slice(0, 2) });
  }
  const { rows, lines } = shape(r.data);
  const speeds = rows.map(x => x.speed).filter(x => x != null);
  const avg = speeds.length ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : null;
  const slow = rows.filter(x => x.speed != null).sort((a, b) => a.speed - b.speed).slice(0, 5);
  res.status(200).json({ ok: true, at: new Date().toISOString(), count: rows.length, hasGeometry: lines.length > 0, lines: lines.slice(0, 8000), avgSpeed: avg, slowest: slow });
};
