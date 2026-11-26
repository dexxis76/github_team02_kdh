// 예약 저장소.
// 내 컴퓨터: data/reservations.json 파일에 저장. Vercel: 서버 메모리(서버가 쉬었다 깨면 처음 값으로 돌아감).
const fs = require('fs');
const path = require('path');
const R = require('./_rules');
const { today, addDays } = require('./_util');

const ON_VERCEL = !!process.env.VERCEL;
const FILE = ON_VERCEL ? null : path.join(__dirname, '..', 'data', 'reservations.json');
let mem = null;

// 시연용 가상 예약 (지어낸 이름·번호). 화면에 「데모 데이터」로 표시한다.
function seed() {
  const d1 = addDays(today(), 1), d2 = addDays(today(), 2);
  const base = [
    ['김가상', '010-0000-0001', '서울 강남구 테헤란로 1', '강남구', '동남', 'KE701', 'T1', '15:40', '도쿄', 2, 1, d1, 10],
    ['이시연', '010-0000-0002', '서울 서초구 반포대로 2', '서초구', '동남', 'OZ101', 'T1', '16:10', '오사카', 3, 0, d1, 11],
    ['박예시', '010-0000-0003', '서울 송파구 올림픽로 3', '송파구', '동남', 'KE903', 'T1', '17:20', '방콕', 4, 2, d1, 10],
    ['최데모', '010-0000-0004', '서울 마포구 월드컵로 4', '마포구', '서북', 'TW201', 'T2', '14:05', '다낭', 2, 0, d1, 14],
    ['정샘플', '010-0000-0005', '서울 노원구 동일로 5', '노원구', '동북', 'LJ301', 'T2', '13:30', '후쿠오카', 1, 0, d2, 9],
    ['한가상', '010-0000-0006', '서울 영등포구 여의대로 6', '영등포구', '서남', 'OZ331', 'T1', '19:00', '싱가포르', 5, 1, d2, 16],
  ];
  const seq = {};
  const parties = [4, 2, 5, 3, 1, 4]; // 시연용 동반 인원
  return base.map((b, i) => ({
    tag: `HD-${b[11].replace(/-/g, '')}-${String((seq[b[11]] = (seq[b[11]] || 0) + 1)).padStart(3, '0')}`,
    party: parties[i],
    name: b[0], phone: b[1], address: b[2], district: b[3], region: b[4],
    flightId: b[5], flightDate: addDays(b[11], 1), terminal: b[6], depTime: b[7], airport: b[8],
    bags: b[9], large: b[10], price: R.price(b[9], b[10]),
    pickupDate: b[11], pickupHour: b[12], status: '접수', demo: true, createdAt: new Date(Date.now() - (6 - i) * 60e3).toISOString(),
  })).map(r => ({ ...r, voucher: R.voucherFor(r.party, r.tag, r.flightDate) }));
}

function save() {
  if (!FILE) return;
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(mem, null, 1)); } catch { /* 저장 실패는 메모리로 계속 */ }
}
function load() {
  if (mem) return mem;
  if (FILE && fs.existsSync(FILE)) { try { mem = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { mem = null; } }
  if (!mem) { mem = seed(); save(); }
  return mem;
}

function create(r) {
  const all = load();
  const prefix = `HD-${r.pickupDate.replace(/-/g, '')}-`;
  const n = Math.max(0, ...all.filter(x => x.tag.startsWith(prefix)).map(x => Number(x.tag.slice(prefix.length)) || 0)) + 1;
  const tag = `${prefix}${String(n).padStart(3, '0')}`;
  const rec = { ...r, tag, voucher: R.voucherFor(r.party, tag, r.flightDate), status: '접수', demo: false, createdAt: new Date().toISOString() };
  all.push(rec); save();
  return rec;
}
const list = () => load().slice();
function setStatus(tag, status) {
  const r = load().find(x => x.tag === tag);
  if (!r || !R.STATUS.includes(status)) return null;
  r.status = status; save();
  return r;
}

// 배차 추천: 차량은 4대(1~4호차) 고정. 예약의 수거지(구·시·군)가 속한 호차가 맡고,
// 같은 수거일 × 2시간 시간대 × 같은 호차를 한 묶음으로 본다. 한 묶음 최대 캐리어 40개를 넘으면 「적재 초과」로 표시한다(자동으로 옮기지 않음).
// 방문 순서: 공항에서 먼 곳부터 가까운 곳 순(직선거리 기준). 실시간 교통·사고는 아직 반영하지 않는다.
const { zoneOf } = require('./_zones');
const { CENTERS, AIRPORT } = require('./_geo');

const km = (a, b) => {
  const rad = x => x * Math.PI / 180, dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const toAirport = r => (CENTERS[r.district] ? km(CENTERS[r.district], [AIRPORT.T1.lat, AIRPORT.T1.lon]) : 0);

function dispatch(items) {
  const groups = {};
  for (const r of items) {
    const z = zoneOf(r.district);
    const car = z ? z.car : 0; // 0 = 구역 밖(미배정)
    const slot = R.slotStart(r.pickupHour);
    const k = `${r.pickupDate}|${slot}|${car}`;
    (groups[k] = groups[k] || []).push(r);
  }
  const vehicles = [];
  for (const [k, rs] of Object.entries(groups)) {
    const [date, slot, car] = k.split('|');
    const z = zoneOf(rs[0].district);
    rs.sort((a, b) => toAirport(b) - toAirport(a) || a.tag.localeCompare(b.tag)); // 먼 곳 → 가까운 곳
    const bags = rs.reduce((n, r) => n + r.bags, 0);
    vehicles.push({
      id: `C${car}-${date.replace(/-/g, '')}-${slot}`, car: Number(car), carName: z ? z.name : '', color: z ? z.color : '#9aa0aa',
      pickupDate: date, slot: R.slotLabel(Number(slot)), bags, max: R.MAX_BAGS_PER_VEHICLE, over: bags > R.MAX_BAGS_PER_VEHICLE,
      tags: rs.map(r => r.tag),
      stops: rs.map((r, i) => ({ n: i + 1, tag: r.tag, district: r.district, bags: r.bags, km: Math.round(toAirport(r)) })),
      districts: [...new Set(rs.map(x => x.district))],
      statuses: [...new Set(rs.map(x => x.status))],
    });
  }
  return vehicles.sort((a, b) => (a.pickupDate + a.slot + String(a.car)).localeCompare(b.pickupDate + b.slot + String(b.car)));
}

const storage = () => (ON_VERCEL ? '서버 메모리(쉬었다 깨면 처음 값으로 돌아감)' : '파일(data/reservations.json)');
module.exports = { create, list, setStatus, dispatch, storage };
