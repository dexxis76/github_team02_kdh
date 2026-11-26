// 관리자 지도: 서울·경기 구·시·군 위치 + 예약 위치 + ITS 실시간 교통소통정보
// 배경 지도는 쓰지 않고(키가 브라우저에 나가지 않게), 좌표를 직접 그린다. admin.js 의 api() · data 를 쓴다.
(() => {
  const cv = document.getElementById('mapCv');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const statusEl = document.getElementById('mapStatus'), logEl = document.getElementById('routeLog');
  const T = k => window.t(k), TV = (k, v) => window.t(k, v);
  const view = { s: 1, x: 0, y: 0 }; // 확대 배율과 이동량(픽셀)
  const MIN = 1, MAX = 8;
  let base = null, traffic = null, trafficErr = null, timer = null, loading = false;

  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
  const LV = ['--c0', '--c1', '--c2', '--c3', '--c4'];

  function proj(lon, lat, W, H) {
    const b = base.bbox;
    const x = (lon - b.minLon) / (b.maxLon - b.minLon) * W, y = (1 - (lat - b.minLat) / (b.maxLat - b.minLat)) * H;
    return [(x - W / 2) * view.s + W / 2 + view.x, (y - H / 2) * view.s + H / 2 + view.y];
  }
  // 지도가 화면 밖으로 너무 나가지 않게 이동 범위를 막는다
  function clamp() {
    const W = cv.clientWidth, H = cv.clientHeight, mx = W * (view.s - 1) / 2, my = H * (view.s - 1) / 2;
    view.x = Math.max(-mx, Math.min(mx, view.x)); view.y = Math.max(-my, Math.min(my, view.y));
  }
  // (cx, cy) 지점이 그대로 있도록 배율을 바꾼다
  function zoomTo(ns, cx, cy) {
    ns = Math.max(MIN, Math.min(MAX, ns));
    const W = cv.clientWidth, H = cv.clientHeight, k = ns / view.s;
    view.x = (cx - W / 2) - ((cx - W / 2) - view.x) * k; view.y = (cy - H / 2) - ((cy - H / 2) - view.y) * k;
    view.s = ns; clamp(); syncZoom(); draw();
  }
  function syncZoom() {
    document.getElementById('zLv').textContent = '×' + (Math.round(view.s * 10) / 10);
    document.getElementById('zIn').disabled = view.s >= MAX; document.getElementById('zOut').disabled = view.s <= MIN;
  }

  function draw() {
    if (!base) return;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = css('--surface'); ctx.fillRect(0, 0, W, H);

    // 교통 선
    if (traffic && traffic.lines && traffic.lines.length) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.min(2.2 + (view.s - 1) * .5, 5);
      for (const lv of [0, 1, 2, 3, 4]) {
        ctx.strokeStyle = css(LV[lv]); ctx.beginPath();
        for (const l of traffic.lines) {
          if (l.c !== lv) continue;
          l.p.forEach(([lon, lat], i) => { const [x, y] = proj(lon, lat, W, H); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        }
        ctx.stroke();
      }
    }

    // 구·시·군 이름
    ctx.font = '10px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = css('--mute');
    for (const [name, [lat, lon]] of Object.entries(base.centers)) {
      const [x, y] = proj(lon, lat, W, H);
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill();
      ctx.fillText(name, x, y - 5);
    }

    // 예약 위치(구·시·군별 개수)
    const cnt = {};
    for (const i of ((typeof data !== 'undefined' && data && data.items) || [])) cnt[i.district] = (cnt[i.district] || 0) + 1;
    ctx.textBaseline = 'middle';
    for (const [d, n] of Object.entries(cnt)) {
      const c = base.centers[d]; if (!c) continue;
      const [x, y] = proj(c[1], c[0], W, H), r = 8 + Math.min(n, 5) * 1.5;
      ctx.fillStyle = css('--cta'); ctx.globalAlpha = .9; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.font = '700 11px Pretendard, sans-serif'; ctx.fillText(String(n), x, y + .5);
    }

    // 인천공항
    ctx.textBaseline = 'alphabetic';
    for (const k of ['T1', 'T2']) {
      const a = base.airport[k], [x, y] = proj(a.lon, a.lat, W, H);
      ctx.fillStyle = css('--red'); ctx.fillRect(x - 5, y - 5, 10, 10);
    }
    const a1 = base.airport.T1, [ax, ay] = proj(a1.lon, a1.lat, W, H);
    ctx.fillStyle = css('--ink'); ctx.font = '700 11px Pretendard, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(T('map.airport'), ax + 10, ay + 4);
  }

  function renderStatus() {
    statusEl.className = 'map-status'; logEl.innerHTML = '';
    if (!base) { statusEl.textContent = T('map.loading'); return; }
    if (!base.hasKey) { statusEl.className = 'map-status err'; statusEl.textContent = T('map.nokey'); return; }
    if (loading && !traffic) { statusEl.textContent = T('map.loading'); return; }
    if (trafficErr) { statusEl.className = 'map-status err'; statusEl.textContent = TV('map.fail', { r: trafficErr }); return; }
    if (!traffic) { statusEl.textContent = T('map.loading'); return; }
    if (!traffic.count) { statusEl.textContent = T('map.nodata'); return; }
    const when = new Date(traffic.at).toLocaleTimeString(window.i18n.lang === 'en' ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit' });
    statusEl.textContent = TV('map.updated', { t: when, n: traffic.count }) + (traffic.avgSpeed != null ? ' · ' + TV('map.avg', { v: traffic.avgSpeed }) : '');
    const parts = [];
    if (!traffic.hasGeometry) parts.push(`<p>${T('map.nogeo')}</p>`);
    if (traffic.slowest && traffic.slowest.length) parts.push(`<p><b>${T('map.slowest')}</b><br>${traffic.slowest.map(s => `${esc(s.name || '-')} · ${s.speed}km/h`).join('<br>')}</p>`);
    logEl.innerHTML = parts.join('');
  }

  async function loadBase() {
    try { const r = await api('/api/livemap?kind=base'); if (r.ok) base = await r.json(); } catch { /* 아래에서 상태로 표시 */ }
    renderStatus(); draw();
  }
  async function loadTraffic() {
    if (!base || !base.hasKey || loading) return;
    loading = true; renderStatus();
    try {
      const r = await api('/api/livemap?kind=traffic');
      if (r.status === 401) return;
      const j = await r.json();
      if (j.ok) { traffic = j; trafficErr = null; } else { trafficErr = j.reason || '?'; }
    } catch (e) { trafficErr = e.message; }
    loading = false; renderStatus(); draw();
  }

  let started = false;
  window.addEventListener('admin-render', async () => {
    if (!started) {
      started = true; await loadBase(); loadTraffic();
      timer = setInterval(() => { if (!document.hidden && !document.getElementById('app').hidden) loadTraffic(); }, 5 * 60e3);
    } else draw();
  });
  document.getElementById('mapRefresh').addEventListener('click', loadTraffic);
  const W = () => cv.clientWidth, H = () => cv.clientHeight;
  document.getElementById('zIn').addEventListener('click', () => zoomTo(view.s * 1.6, W() / 2, H() / 2));
  document.getElementById('zOut').addEventListener('click', () => zoomTo(view.s / 1.6, W() / 2, H() / 2));
  document.getElementById('zReset').addEventListener('click', () => { view.s = 1; view.x = 0; view.y = 0; syncZoom(); draw(); });
  cv.addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); const r = cv.getBoundingClientRect(); zoomTo(view.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  cv.addEventListener('dblclick', e => { const r = cv.getBoundingClientRect(); zoomTo(view.s * 1.6, e.clientX - r.left, e.clientY - r.top); });
  let drag = null;
  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; cv.setPointerCapture(e.pointerId); cv.classList.add('drag'); });
  cv.addEventListener('pointermove', e => { if (!drag) return; view.x = drag.vx + e.clientX - drag.x; view.y = drag.vy + e.clientY - drag.y; clamp(); draw(); });
  const end = () => { drag = null; cv.classList.remove('drag'); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => { clamp(); draw(); });
  syncZoom();
  window.addEventListener('themechange', draw);
  window.addEventListener('langchange', () => { renderStatus(); draw(); });
  renderStatus();
})();
