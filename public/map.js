// 관리자 지도: 실제 지도(OpenStreetMap 계열 타일) 위에 서울 25개 구 · 경기 31개 시·군 경계, 예약 위치, 인천공항, ITS 실시간 도로 구간을 그린다.
// 지도 라이브러리: Leaflet. 타일은 키가 필요 없는 공개 타일을 쓰고, ITS 키는 서버에만 있다. admin.js 의 api() · data 를 쓴다.
(() => {
  const el = document.getElementById('mapEl');
  if (!el || typeof L === 'undefined') { const s = document.getElementById('mapStatus'); if (s) s.textContent = '지도를 불러오지 못했어요.'; return; }
  const statusEl = document.getElementById('mapStatus'), logEl = document.getElementById('routeLog');
  const T = k => window.t(k), TV = (k, v) => window.t(k, v);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
  const LV = ['--c0', '--c1', '--c2', '--c3', '--c4'];
  const esc2 = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const map = L.map(el, { zoomControl: false, scrollWheelZoom: false, maxZoom: 17, attributionControl: true }).setView([37.52, 127.0], 9);
  L.control.zoom({ position: 'topright', zoomInTitle: T('map.zoomIn'), zoomOutTitle: T('map.zoomOut') }).addTo(map);
  let fitBounds = null;
  const Fit = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const d = L.DomUtil.create('div', 'leaflet-bar leaflet-control-fit');
      const a = L.DomUtil.create('a', '', d); a.href = '#'; a.role = 'button'; a.textContent = '⤢'; a.title = T('map.fit'); a.setAttribute('aria-label', T('map.fit'));
      L.DomEvent.on(a, 'click', e => { L.DomEvent.stop(e); fit(); });
      this._a = a; return d;
    },
  });
  const fitCtl = new Fit().addTo(map);
  const fit = () => fitBounds && map.fitBounds(fitBounds, { padding: [8, 8] });

  // ---- 바탕 지도 타일: 키가 필요 없는 OpenStreetMap 타일 하나만 쓴다. 다크 모드는 색만 반전한다(CSS)
  let tile = null;
  function setTiles() {
    if (!tile) {
      tile = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
    }
    el.classList.toggle('dark-tiles', document.documentElement.dataset.theme === 'dark');
  }
  setTiles();

  // ---- 서울·경기 행정구역 경계
  let areas = null, base = null, traffic = null, trafficErr = null, loading = false, pins = L.layerGroup().addTo(map), roads = L.layerGroup().addTo(map);
  const zoneColor = {}, zoneCar = {};
  function areaStyle(f) {
    const c = zoneColor[f.properties.n] || css('--mute');
    return { color: c, weight: 1.4, opacity: .9, fillColor: c, fillOpacity: .18 };
  }
  function setZones() {
    if (!base || !base.zones) return;
    for (const z of base.zones) for (const d of z.districts) { zoneColor[d] = z.color; zoneCar[d] = z.car; }
    document.getElementById('carLegend').innerHTML = base.zones.map(z => `<span><i style="background:${z.color}"></i>${esc2(TV('car.label', { n: z.car }))} ${esc2(z.name)}</span>`).join('');
    if (areas) areas.setStyle(areaStyle);
  }
  async function loadAreas() {
    try {
      const gj = await (await fetch('/seoul-gyeonggi.json')).json();
      areas = L.geoJSON(gj, {
        style: areaStyle,
        onEachFeature: (f, layer) => {
          layer.bindTooltip(f.properties.n, { permanent: true, direction: 'center', className: 'area-label' });
          layer.bindPopup(() => { const c = zoneCar[f.properties.n]; return `<b>${esc2(f.properties.n)}</b><br>${c ? esc2(TV('car.label', { n: c })) : esc2(T('car.none'))}`; });
          layer.on('mouseover', () => layer.setStyle({ fillOpacity: .3, weight: 2.2 }));
          layer.on('mouseout', () => layer.setStyle(areaStyle(f)));
        },
      }).addTo(map);
      areas.bringToBack(); tile.bringToBack();
      map.invalidateSize(false);
      fitBounds = areas.getBounds(); map.fitBounds(fitBounds, { padding: [8, 8], animate: false });
      map.setMinZoom(Math.max(7, map.getZoom() - 1)); map.setMaxBounds(fitBounds.pad(0.4));
      labels();
    } catch { statusEl.textContent = '경계를 불러오지 못했어요.'; }
  }
  // 글자가 겹치지 않게 어느 정도 확대했을 때만 지역 이름을 보여 준다
  function labels() { el.classList.toggle('nolabel', map.getZoom() < 10); }
  map.on('zoomend', labels);

  // ---- 예약 위치 · 공항
  function drawPins() {
    pins.clearLayers();
    if (!base) return;
    const cnt = {};
    for (const i of ((typeof data !== 'undefined' && data && data.items) || [])) cnt[i.district] = (cnt[i.district] || 0) + 1;
    for (const [d, n] of Object.entries(cnt)) {
      const c = base.centers[d]; if (!c) continue;
      const size = 24 + Math.min(n, 5) * 3;
      const col = zoneColor[d] || css('--cta');
      L.marker(c, { icon: L.divIcon({ className: '', html: `<div class="rsv-pin" style="width:${size}px;height:${size}px;background:${col}">${n}</div>`, iconSize: [size, size] }), title: `${d} ${n}` })
        .bindTooltip(`${esc2(d)} · ${zoneCar[d] ? esc2(TV('car.label', { n: zoneCar[d] })) + ' · ' : ''}${n}`, { direction: 'top' }).addTo(pins);
    }
    for (const k of ['T1', 'T2']) {
      const a = base.airport[k];
      L.marker([a.lat, a.lon], { icon: L.divIcon({ className: '', html: '<div class="apt-pin" style="width:14px;height:14px"></div>', iconSize: [14, 14] }) })
        .bindTooltip(esc2(a.name), { direction: 'top' }).addTo(pins);
    }
  }

  // ---- ITS 실시간 도로 구간(좌표가 있을 때)
  function drawRoads() {
    roads.clearLayers();
    if (!traffic || !traffic.lines) return;
    for (const l of traffic.lines) {
      L.polyline(l.p.map(([lon, lat]) => [lat, lon]), { color: css(LV[l.c] || '--c0'), weight: 4, opacity: .9 })
        .bindTooltip(`${esc2(l.n || '')}${l.s != null ? ' · ' + l.s + 'km/h' : ''}`, { sticky: true }).addTo(roads);
    }
  }

  function renderStatus() {
    statusEl.className = 'map-status'; logEl.innerHTML = '';
    if (!base) { statusEl.textContent = T('map.loading'); return; }
    if (!base.hasKey) { statusEl.className = 'map-status err'; statusEl.textContent = T('map.nokey'); return; }
    if (trafficErr) { statusEl.className = 'map-status err'; statusEl.textContent = TV('map.fail', { r: trafficErr }); return; }
    if (!traffic) { statusEl.textContent = T('map.loading'); return; }
    if (!traffic.count) { statusEl.textContent = T('map.nodata'); return; }
    const when = new Date(traffic.at).toLocaleTimeString(window.i18n.lang === 'en' ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit' });
    statusEl.textContent = TV('map.updated', { t: when, n: traffic.count }) + (traffic.avgSpeed != null ? ' · ' + TV('map.avg', { v: traffic.avgSpeed }) : '');
    const parts = [];
    if (!traffic.hasGeometry) parts.push(`<p>${T('map.nogeo')}</p>`);
    if (traffic.slowest && traffic.slowest.length) parts.push(`<p><b>${T('map.slowest')}</b><br>${traffic.slowest.map(s => `${esc2(s.name || '-')} · ${s.speed}km/h`).join('<br>')}</p>`);
    logEl.innerHTML = parts.join('');
  }

  async function loadBase() {
    try { const r = await api('/api/livemap?kind=base'); if (r.ok) base = await r.json(); } catch { /* 상태로 표시 */ }
    setZones(); renderStatus(); drawPins();
  }
  async function loadTraffic() {
    if (!base || !base.hasKey || loading) return;
    loading = true;
    try {
      const r = await api('/api/livemap?kind=traffic');
      if (r.status === 401) { loading = false; return; }
      const j = await r.json();
      if (j.ok) { traffic = j; trafficErr = null; } else { trafficErr = j.reason || '?'; }
    } catch (e) { trafficErr = e.message; }
    loading = false; renderStatus(); drawRoads();
  }

  let started = false;
  window.addEventListener('admin-render', async () => {
    if (!started) {
      started = true;
      map.invalidateSize(false); // 숨겨진 상태에서 만들어졌으므로 보이는 크기로 다시 계산
      await loadBase(); loadAreas(); loadTraffic();
      setInterval(() => { if (!document.hidden && !document.getElementById('app').hidden) loadTraffic(); }, 5 * 60e3);
    } else drawPins();
  });
  document.getElementById('mapRefresh').addEventListener('click', loadTraffic);
  window.addEventListener('themechange', () => { setTiles(); if (areas) areas.setStyle(areaStyle); drawRoads(); });
  window.addEventListener('langchange', () => { setZones(); drawPins(); renderStatus(); fitCtl._a && (fitCtl._a.title = T('map.fit')); });
  window.addEventListener('resize', () => map.invalidateSize());
  renderStatus();
})();
