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

  const map = L.map(el, { zoomControl: false, scrollWheelZoom: true, wheelPxPerZoomLevel: 90, maxZoom: 17, attributionControl: true }).setView([37.52, 127.0], 9);
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
  let areas = null, base = null, loading = false, pins = L.layerGroup().addTo(map);
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

  // ---- ITS 돌발정보(사고·공사 등) : 관리자 PC 의 브라우저가 ITS 를 직접 부른다(서버는 ITS 접속이 막혀 있음)
  // 키는 이 브라우저(localStorage)에만 저장하고 서버·저장소에는 보내지 않는다.
  const KEY = 'hd-its-key';
  const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  const setKey = v => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* 저장소를 못 쓰면 이번 방문에만 */ } };
  let events = null, evErr = null, eventsAt = null, evLayer = L.layerGroup().addTo(map), carCount = {};
  const KINDS = { acc: { c: '--c3', t: 'its.k.acc' }, con: { c: '--c2', t: 'its.k.con' }, wea: { c: '--zone5', t: 'its.k.wea' }, etc: { c: '--c0', t: 'its.k.etc' } };
  const kindOf = e => (/사고|acc/i.test(e.eventType) ? 'acc' : /공사|cor|con/i.test(e.eventType) ? 'con' : /기상|재난|wea|dis/i.test(e.eventType) ? 'wea' : 'etc');
  const fmtDate = v => { const m = String(v || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/); return m ? `${m[2]}/${m[3]} ${m[4]}:${m[5]}` : ''; };
  // 사고 지점이 어느 호차 구역인지: 가장 가까운 구·시·군 중심의 호차 (20km 안에 없으면 서비스 지역 밖)
  function carOfPoint(lat, lon) {
    let best = null;
    for (const [d, [la, lo]] of Object.entries(base.centers)) {
      const km = Math.hypot((la - lat) * 111, (lo - lon) * 88);
      if (!best || km < best.km) best = { d, km };
    }
    return best && best.km <= 20 ? { car: zoneCar[best.d] || 0, district: best.d } : null;
  }
  function drawEvents() {
    evLayer.clearLayers(); carCount = {};
    if (events && base) {
      for (const e of events) {
        const k = kindOf(e), col = css(KINDS[k].c);
        const pin = L.marker([e.lat, e.lon], { icon: L.divIcon({ className: '', html: `<div class="ev-pin ${k}" style="background:${col}">${k === 'acc' ? '!' : ''}</div>`, iconSize: [18, 18] }), zIndexOffset: k === 'acc' ? 500 : 0 });
        const where = e.area ? `${esc2(e.area.district)}${e.area.car ? ' · ' + esc2(TV('car.label', { n: e.area.car })) : ''}` : '';
        pin.bindPopup(`<b>${esc2(T(KINDS[k].t))}</b> ${esc2(e.eventDetailType || '')}<br>${esc2(e.type || '')} ${esc2(e.roadName || '')} ${esc2(e.roadDrcType || '')}<br><small>${esc2(fmtDate(e.startDate))}${where ? ' · ' + where : ''}</small><br>${esc2(String(e.message || '').slice(0, 160))}`).addTo(evLayer);
        if (e.area && e.area.car) { const c = carCount[e.area.car] = carCount[e.area.car] || { acc: 0, all: 0 }; c.all++; if (k === 'acc') c.acc++; }
      }
    }
    applyBadges();
  }
  // 호차 카드에 구역 안 사고·돌발 건수 표시 (카드는 10초마다 다시 그려지므로 그때마다 다시 붙인다)
  function applyBadges() {
    document.querySelectorAll('.carcard[data-car]').forEach(card => {
      card.querySelector('.its-badge')?.remove();
      if (!events) return;
      const c = carCount[card.dataset.car] || { acc: 0, all: 0 };
      const b = document.createElement('p'); b.className = 'its-badge' + (c.acc ? ' warn' : '');
      b.textContent = TV('its.badge', { a: c.acc, n: c.all }); card.appendChild(b);
    });
  }
  function keyBox() {
    const box = document.getElementById('itsKeyBox'); if (!box) return;
    const has = !!getKey();
    box.querySelector('.its-form').hidden = has; box.querySelector('.its-have').hidden = !has;
  }

  function renderStatus() {
    statusEl.className = 'map-status'; logEl.innerHTML = '';
    keyBox();
    if (!base) { statusEl.textContent = T('map.loading'); return; }
    if (!getKey()) { statusEl.className = 'map-status err'; statusEl.textContent = T('its.noKey'); return; }
    if (evErr) { statusEl.className = 'map-status err'; statusEl.textContent = TV('its.fail', { r: evErr }); return; }
    if (!events) { statusEl.textContent = T('map.loading'); return; }
    const accs = events.filter(e => kindOf(e) === 'acc');
    const when = new Date(eventsAt).toLocaleTimeString(window.i18n.lang === 'en' ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit' });
    statusEl.textContent = TV('its.updated', { t: when, n: events.length, a: accs.length });
    const list = accs.slice(0, 8);
    logEl.innerHTML = list.length
      ? `<p><b>${esc2(T('its.accList'))}</b><br>${list.map(e => `${esc2(fmtDate(e.startDate))} ${esc2(e.roadName || '')} ${esc2(e.roadDrcType || '')}${e.area && e.area.car ? ' · ' + esc2(TV('car.label', { n: e.area.car })) : ''}`).join('<br>')}</p>`
      : `<p>${esc2(T('its.noAcc'))}</p>`;
  }

  async function loadBase() {
    try { const r = await api('/api/livemap?kind=base'); if (r.ok) base = await r.json(); } catch { /* 상태로 표시 */ }
    setZones(); renderStatus(); drawPins();
  }
  async function loadTraffic() {
    const key = getKey();
    if (!base || !key || loading) return;
    loading = true;
    const b = base.bbox;
    const url = `https://openapi.its.go.kr:9443/eventInfo?apiKey=${encodeURIComponent(key)}&type=all&eventType=all&minX=${b.minLon}&maxX=${b.maxLon}&minY=${b.minLat}&maxY=${b.maxLat}&getType=json`;
    try {
      const r = await fetch(url); const text = await r.text(); let j = null;
      try { j = JSON.parse(text); } catch { /* 아래에서 처리 */ }
      if (!j) throw new Error(T('its.notJson'));
      const code = j.header && j.header.resultCode;
      if (code != null && String(code) !== '0') throw new Error(`resultCode ${code}${j.header.resultMsg ? ' · ' + j.header.resultMsg : ''}`);
      let it = (j.body && j.body.items) || [];
      if (!Array.isArray(it)) it = it.item ? [].concat(it.item) : [];
      events = it.map(e => ({ ...e, lat: parseFloat(e.coordY), lon: parseFloat(e.coordX) }))
        .filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lon) && e.lat >= b.minLat && e.lat <= b.maxLat && e.lon >= b.minLon && e.lon <= b.maxLon)
        .map(e => ({ ...e, area: carOfPoint(e.lat, e.lon) }));
      events.sort((x, y) => String(y.startDate).localeCompare(String(x.startDate)));
      eventsAt = Date.now(); evErr = null;
    } catch (e) {
      evErr = String(e.message || e).split(key).join('***');
      if (/Failed to fetch|NetworkError|Load failed/i.test(evErr)) evErr = T('its.cors');
    }
    loading = false; renderStatus(); drawEvents();
  }

  let started = false;
  window.addEventListener('admin-render', async () => {
    if (!started) {
      started = true;
      map.invalidateSize(false); // 숨겨진 상태에서 만들어졌으므로 보이는 크기로 다시 계산
      await loadBase(); loadAreas(); loadTraffic();
      setInterval(() => { if (!document.hidden && !document.getElementById('app').hidden) loadTraffic(); }, 5 * 60e3);
    } else { drawPins(); applyBadges(); }
  });
  document.getElementById('mapRefresh').addEventListener('click', loadTraffic);
  document.getElementById('itsSave').addEventListener('click', () => {
    const v = document.getElementById('itsKey').value.trim(); if (!v) return;
    setKey(v); document.getElementById('itsKey').value = ''; evErr = null; events = null; renderStatus(); loadTraffic();
  });
  document.getElementById('itsKey').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('itsSave').click(); } });
  document.getElementById('itsClear').addEventListener('click', () => { setKey(''); events = null; evErr = null; drawEvents(); renderStatus(); });
  window.addEventListener('themechange', () => { setTiles(); if (areas) areas.setStyle(areaStyle); drawEvents(); });
  window.addEventListener('langchange', () => { setZones(); drawPins(); renderStatus(); fitCtl._a && (fitCtl._a.title = T('map.fit')); });
  window.addEventListener('resize', () => map.invalidateSize());
  renderStatus();
})();
