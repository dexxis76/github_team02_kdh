// GET /api/reservations — 예약 표 + 배차 추천
// PATCH /api/reservations {tag|vehicle, status} — 상태 바꾸기 (접수 → 배차 완료 → 수거 완료 → 공항 인도, 앞으로만)
const store = require('./_store');
const R = require('./_rules');
const { requireAdmin } = require('./_admin');
const { ZONES, zoneOf } = require('./_zones');

function snapshot() {
  const items = store.list().sort((a, b) => (a.pickupDate + String(a.pickupHour).padStart(2, '0') + a.tag).localeCompare(b.pickupDate + String(b.pickupHour).padStart(2, '0') + b.tag));
  const withCar = items.map(i => ({ ...i, car: (zoneOf(i.district) || { car: 0 }).car }));
  return { items: withCar, vehicles: store.dispatch(items), cars: ZONES.map(z => ({ car: z.car, name: z.name, color: z.color, districts: z.districts })), storage: store.storage(), statuses: R.STATUS, maxPerVehicle: R.MAX_BAGS_PER_VEHICLE };
}

module.exports = async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method === 'GET') return res.status(200).json(snapshot());
  if (req.method === 'PATCH' || req.method === 'POST') {
    const b = req.body || {};
    const next = String(b.status || '');
    if (!R.STATUS.includes(next)) return res.status(400).json({ error: '상태 값이 올바르지 않아요' });
    let tags = [];
    if (b.tag) tags = [String(b.tag)];
    else if (b.vehicle) { const v = store.dispatch(store.list()).find(x => x.id === b.vehicle); tags = v ? v.tags : []; }
    if (!tags.length) return res.status(404).json({ error: '대상을 찾지 못했어요' });
    let changed = 0;
    for (const t of tags) {
      const r = store.list().find(x => x.tag === t);
      if (r && R.STATUS.indexOf(next) > R.STATUS.indexOf(r.status)) { store.setStatus(t, next); changed++; }
    }
    return res.status(200).json({ changed, ...snapshot() });
  }
  res.status(405).json({ error: '허용되지 않는 요청' });
};
