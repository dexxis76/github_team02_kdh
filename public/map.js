// 관리자 지도: 서울·경기 8개 호차 구역 + 예약 위치 + ITS 실시간 사고·공사 지점.
// 보기가 복잡하지 않게 「배차 구역 / 교통 정보 / 함께」 세 가지로 바꿔 볼 수 있고, 호차를 누르면 그 구역만 또렷하게 보인다.
// 지도 라이브러리: Leaflet. 배경은 키가 필요 없는 OpenStreetMap 타일(회색으로 눌러서 색이 잘 보이게 함). admin.js 의 api() · data 를 쓴다.
(() => {
  const el = document.getElementById('mapEl');
  if (!el || typeof L === 'undefined') { const s = document.getElementById('mapStatus'); if (s) s.textContent = '지도를 불러오지 못했어요.'; return; }
  const statusEl = document.getElementById('mapStatus'), logEl = document.getElementById('routeLog'), carListEl = document.getElementById('carList');
  const T = k => window.t(k), TV = (k, v) => window.t(k, v);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
  const esc2 = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* 저장소를 못 쓰면 이번 방문에만 */ } },
  };

  const map = L.map(el, { zoomControl: false, scrollWheelZoom: true, wheelPxPerZoomLevel: 90, maxZoom: 17, attributionControl: true }).setView([37.52, 127.0], 9);
  L.control.zoom({ position: 'topright', zoomInTitle: T('map.zoomIn'), zoomOutTitle: T('map.zoomOut') }).addTo(map);
  let fitBounds = null;
  const Fit = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const d = L.DomUtil.create('div', 'leaflet-bar leaflet-control-fit');
      const a = L.DomUtil.create('a', '', d); a.href = '#'; a.role = 'button'; a.textContent = '⤢'; a.title = T('map.fit'); a.setAttribute('aria-label', T('map.fit'));
      L.DomEvent.on(a, 'click', e => { L.DomEvent.stop(e); selectCar(0); });
      this._a = a; return d;
    },
  });
  const fitCtl = new Fit().addTo(map);
  const fit = () => fitBounds && map.fitBounds(fitBounds, { padding: [8, 8] });

  // ---- 바탕 지도: OpenStreetMap 타일 하나. 색을 빼서(CSS) 구역 색과 사고 점이 잘 보이게 하고, 다크 모드는 색을 반전한다
  let tile = null;
  function setTiles() {
    if (!tile) tile = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
    el.classList.toggle('dark-tiles', document.documentElement.dataset.theme === 'dark');
  }
  setTiles();

  // ---- 상태
  let base = null, areas = null, outlines = {}, outlineGroup = L.layerGroup().addTo(map), zoneLabels = L.layerGroup().addTo(map);
  let pins = L.layerGroup().addTo(map), evLayer = L.layerGroup().addTo(map);
  let mode = ['zone', 'traffic', 'both'].includes(store.get('hd-map-mode')) ? store.get('hd-map-mode') : 'both';
  let focusCar = 0, loading = false;
  const zoneColor = {}, zoneCar = {}, zoneInfo = {}, districtLayers = [];

  const hid = car => focusCar && car !== focusCar; // 호차를 골랐을 때 나머지는 아예 숨긴다(전체를 고르면 모두 보임)
  window.hdSel = window.hdSel || { car: 0 };          // admin.js 가 아래 배차 카드·예약 표를 걸러 보여 줄 때 쓴다

  // ---- 구·시·군 경계(칠하기) · 호차 구역 외곽선 · 호차 번호 라벨
  function areaStyle(f) {
    const car = zoneCar[f.properties.n], c = zoneColor[f.properties.n] || css('--mute');
    const fill = mode === 'zone' ? .34 : mode === 'both' ? .12 : 0;
    return { color: mode === 'traffic' ? css('--mute') : c, weight: mode === 'traffic' ? .6 : .7, opacity: mode === 'traffic' ? .5 : .55, fillColor: c, fillOpacity: fill };
  }
  function outlineStyle(car) {
    const z = zoneInfo[car];
    return { color: mode === 'traffic' ? css('--mute') : z.color, weight: mode === 'traffic' ? 1.4 : (focusCar === car ? 6 : 4), opacity: mode === 'traffic' ? .7 : .95, fill: false, lineJoin: 'round' };
  }
  function drawLabels() {
    zoneLabels.clearLayers();
    if (mode === 'traffic' || !base || !base.zones) return;
    for (const z of base.zones) {
      const o = outlines[z.car]; if (!o || hid(z.car)) continue;
      const big = mode === 'zone' || !!focusCar;
      const html = `<div class="zlabel${big ? ' big' : ''}" style="--car:${esc2(z.color)}"><i>${z.car}</i><span>${esc2(z.name)}</span></div>`;
      L.marker(o.center, { icon: L.divIcon({ className: '', html, iconSize: null }), interactive: true, keyboard: false })
        .on('click', () => toggleFocus(z.car)).addTo(zoneLabels);
    }
  }
  function restyle() {
    if (areas) {
      for (const d of districtLayers) { // 선택한 호차 구역의 구·시·군만 보인다
        const show = !hid(zoneCar[d.name]);
        if (show && !areas.hasLayer(d.layer)) areas.addLayer(d.layer);
        if (!show && areas.hasLayer(d.layer)) areas.removeLayer(d.layer);
      }
      areas.setStyle(areaStyle);
    }
    for (const [car, o] of Object.entries(outlines)) {
      const show = !hid(Number(car));
      if (show && !outlineGroup.hasLayer(o.layer)) outlineGroup.addLayer(o.layer);
      if (!show && outlineGroup.hasLayer(o.layer)) outlineGroup.removeLayer(o.layer);
      o.layer.setStyle(outlineStyle(Number(car)));
    }
    renderTabs(); renderDetail(); renderTicker();
    drawLabels(); drawPins(); drawEvents(); renderCarList();
    document.querySelectorAll('#mapMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    el.classList.toggle('mode-traffic', mode === 'traffic');
    labelsByZoom();
  }
  // 호차 선택: 0 = 전체(한꺼번에 보기), 1~ = 그 호차 구역과 정보만
  function selectCar(car) {
    focusCar = car; window.hdSel.car = car;
    restyle();
    if (focusCar && outlines[focusCar]) map.fitBounds(outlines[focusCar].layer.getBounds(), { padding: [30, 30] }); else fit();
    window.dispatchEvent(new Event('car-select'));
  }
  function toggleFocus(car) { selectCar(focusCar === car ? 0 : car); }
  // 글자가 겹치지 않게, 구·시·군 이름은 많이 확대했을 때만 보여 준다
  function labelsByZoom() { el.classList.toggle('nolabel', map.getZoom() < 11 || mode === 'traffic' && map.getZoom() < 12); }
  map.on('zoomend', labelsByZoom);

  function setZones() {
    if (!base || !base.zones) return;
    for (const z of base.zones) { zoneInfo[z.car] = z; for (const d of z.districts) { zoneColor[d] = z.color; zoneCar[d] = z.car; } }
  }
  async function loadAreas() {
    try {
      const [gj, zj] = await Promise.all([fetch('/seoul-gyeonggi.json').then(r => r.json()), fetch('/zones.json').then(r => r.json())]);
      areas = L.geoJSON(gj, {
        style: areaStyle,
        onEachFeature: (f, layer) => {
          districtLayers.push({ name: f.properties.n, layer });
          layer.bindTooltip(f.properties.n, { permanent: true, direction: 'center', className: 'area-label' });
          layer.bindPopup(() => { const c = zoneCar[f.properties.n]; return `<b>${esc2(f.properties.n)}</b><br>${c ? esc2(TV('car.label', { n: c })) + ' · ' + esc2(zoneInfo[c].name) : esc2(T('car.none'))}`; });
          layer.on('mouseover', () => layer.setStyle({ weight: 2 }));
          layer.on('mouseout', () => layer.setStyle(areaStyle(f)));
        },
      }).addTo(map);
      for (const f of zj.features) {
        const car = f.properties.car;
        outlines[car] = { layer: L.geoJSON(f, { style: () => outlineStyle(car), interactive: false }).addTo(outlineGroup), center: [f.properties.lat, f.properties.lon] };
      }
      areas.bringToBack(); tile.bringToBack();
      map.invalidateSize(false);
      fitBounds = areas.getBounds(); map.fitBounds(fitBounds, { padding: [8, 8], animate: false });
      map.setMinZoom(Math.max(7, map.getZoom() - 1)); map.setMaxBounds(fitBounds.pad(0.4));
      restyle();
    } catch { statusEl.textContent = '경계를 불러오지 못했어요.'; }
  }

  // ---- 예약 위치(호차 색)
  function drawPins() {
    pins.clearLayers();
    if (!base) return;
    const cnt = {};
    for (const i of ((typeof data !== 'undefined' && data && data.items) || [])) cnt[i.district] = (cnt[i.district] || 0) + 1;
    for (const [d, n] of Object.entries(cnt)) {
      const c = base.centers[d]; if (!c) continue;
      const car = zoneCar[d]; if (hid(car)) continue;
      const size = 24 + Math.min(n, 5) * 3, col = zoneColor[d] || css('--cta');
      L.marker(c, { icon: L.divIcon({ className: '', html: `<div class="rsv-pin" style="width:${size}px;height:${size}px;background:${col}">${n}</div>`, iconSize: [size, size] }), zIndexOffset: 200 })
        .bindTooltip(`${esc2(d)} · ${car ? esc2(TV('car.label', { n: car })) + ' · ' : ''}${n}`, { direction: 'top' }).addTo(pins);
    }
    for (const k of ['T1', 'T2']) {
      const a = base.airport[k];
      L.marker([a.lat, a.lon], { icon: L.divIcon({ className: '', html: '<div class="apt-pin" style="width:16px;height:16px"></div>', iconSize: [16, 16] }), zIndexOffset: 300 })
        .bindTooltip(esc2(a.name), { direction: 'top' }).addTo(pins);
    }
  }

  // ---- ITS 돌발정보(사고·공사 등): 관리자 PC 의 브라우저가 ITS 를 직접 부른다(서버는 ITS 접속이 막혀 있음)
  // 키는 이 브라우저(localStorage)에만 저장하고 서버·저장소에는 보내지 않는다.
  const KEY = 'hd-its-key';
  let events = null, evErr = null, eventsAt = null, carCount = {};
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
        const car = e.area && e.area.car; if (car) { const c = carCount[car] = carCount[car] || { acc: 0, all: 0 }; c.all++; if (kindOf(e) === 'acc') c.acc++; }
        if (mode === 'zone' || hid(car)) continue; // 배차 구역만 볼 때, 또는 다른 호차 구역의 점은 그리지 않는다
        const k = kindOf(e), col = css(KINDS[k].c), size = mode === 'traffic' ? 26 : 20;
        const where = e.area ? `${esc2(e.area.district)}${car ? ' · ' + esc2(TV('car.label', { n: car })) : ''}` : '';
        L.marker([e.lat, e.lon], { icon: L.divIcon({ className: '', html: `<div class="ev-pin ${k}" style="background:${col};width:${size}px;height:${size}px;font-size:${size - 8}px;line-height:${size - 4}px">${k === 'acc' ? '!' : ''}</div>`, iconSize: [size, size] }), zIndexOffset: k === 'acc' ? 800 : 500 })
          .bindPopup(`<b>${esc2(T(KINDS[k].t))}</b> ${esc2(e.eventDetailType || '')}<br>${esc2(e.type || '')} ${esc2(e.roadName || '')} ${esc2(e.roadDrcType || '')}<br><small>${esc2(fmtDate(e.startDate))}${where ? ' · ' + where : ''}</small><br>${esc2(String(e.message || '').slice(0, 160))}`).addTo(evLayer);
      }
    }
    applyBadges(); renderCarList(); renderTicker();
  }
  // 호차 카드(아래 배차 추천)에 구역 안 사고·돌발 건수 표시. 카드는 10초마다 다시 그려지므로 그때마다 다시 붙인다
  function applyBadges() {
    document.querySelectorAll('.carcard[data-car]').forEach(card => {
      card.querySelector('.its-badge')?.remove();
      if (!events) return;
      const c = carCount[card.dataset.car] || { acc: 0, all: 0 };
      const b = document.createElement('p'); b.className = 'its-badge' + (c.acc ? ' warn' : '');
      b.textContent = TV('its.badge', { a: c.acc, n: c.all }); card.appendChild(b);
    });
  }

  // ---- 오른쪽 호차 목록: 호차 색 · 이름 · 예약 · 사고. 누르면 그 구역으로 이동하고 나머지는 흐려진다
  function renderCarList() {
    if (!base || !base.zones) { carListEl.innerHTML = ''; return; }
    const rsv = {};
    for (const i of ((typeof data !== 'undefined' && data && data.items) || [])) if (i.car) rsv[i.car] = (rsv[i.car] || 0) + 1;
    carListEl.innerHTML = base.zones.map(z => {
      const c = carCount[z.car] || { acc: 0, all: 0 };
      const meta = [rsv[z.car] ? TV('car.rsv', { n: rsv[z.car] }) : '', events && c.acc ? `<b class="bad">${esc2(TV('car.acc', { n: c.acc }))}</b>` : ''].filter(Boolean).join(' · ');
      return `<button type="button" class="car-item${focusCar === z.car ? ' on' : ''}" data-car="${z.car}" aria-pressed="${focusCar === z.car}" style="--car:${esc2(z.color)}"><i>${z.car}</i><span><b>${esc2(TV('car.label', { n: z.car }))} · ${esc2(z.name)}</b>${meta ? `<small>${meta}</small>` : ''}</span></button>`;
    }).join('');
  }
  carListEl.addEventListener('click', e => { const b = e.target.closest('.car-item'); if (b) toggleFocus(Number(b.dataset.car)); });
  document.getElementById('carTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) selectCar(Number(b.dataset.car)); });

  // ---- 호차 버튼(탭): 전체 / 1호차 … 누르면 그 호차 구역과 정보만 보인다
  function renderTabs() {
    const el2 = document.getElementById('carTabs'); if (!el2 || !base || !base.zones) return;
    el2.innerHTML = `<button type="button" role="tab" data-car="0" aria-selected="${!focusCar}" class="tab-all">${esc2(T('tab.all'))}</button>` + base.zones.map(z =>
      `<button type="button" role="tab" data-car="${z.car}" aria-selected="${focusCar === z.car}" style="--car:${esc2(z.color)}"><i>${z.car}</i>${esc2(TV('car.label', { n: z.car }))}</button>`).join('');
    document.getElementById('carOnly').hidden = !focusCar;
    if (focusCar) document.getElementById('carOnlyText').textContent = TV('car.only', { n: focusCar, name: zoneInfo[focusCar] ? zoneInfo[focusCar].name : '' });
  }
  // 선택한 호차의 상세: 담당 지역 · 예약 · 구역 안 사고
  function renderDetail() {
    const box = document.getElementById('carDetail'); if (!box) return;
    if (!focusCar || !zoneInfo[focusCar]) { box.hidden = true; box.innerHTML = ''; return; }
    const z = zoneInfo[focusCar];
    const items = ((typeof data !== 'undefined' && data && data.items) || []).filter(i => i.car === focusCar).sort((a, b) => (a.pickupDate + a.pickupHour).localeCompare(b.pickupDate + b.pickupHour));
    const accs = (events || []).filter(e => kindOf(e) === 'acc' && e.area && e.area.car === focusCar);
    box.hidden = false;
    box.style.setProperty('--car', z.color);
    box.innerHTML = `<h4><i>${focusCar}</i>${esc2(TV('car.label', { n: focusCar }))} · ${esc2(z.name)}</h4>
      <p class="muted">${esc2(T('car.d.areas'))}: ${z.districts.map(esc2).join(' · ')}</p>
      <p><b>${esc2(T('car.d.rsv'))}</b> ${items.length ? items.map(i => `<br>${esc2(i.pickupDate.slice(5))} ${String(i.pickupHour).padStart(2, '0')}시 · ${esc2(i.district)} · ${esc2(TV('unit.bags', { n: i.bags }))}`).join('') : esc2(T('car.d.none'))}</p>
      <p><b>${esc2(T('car.d.acc'))}</b> ${events ? (accs.length ? accs.slice(0, 5).map(e => `<br>${esc2(fmtDate(e.startDate))} ${esc2(e.roadName || '')} ${esc2(e.roadDrcType || '')}`).join('') : esc2(T('car.d.noacc'))) : esc2(T('car.d.needkey'))}</p>`;
  }

  // ---- LED 전광판: 선택한 호차(또는 전체)에 맞는 긴급 상황을 오른쪽 → 왼쪽으로 흘려 보낸다
  let tickerKey = '';
  function tickerItems() {
    const out = [], sel = focusCar;
    const D = (typeof data !== 'undefined' && data) || null;
    const accs = (events || []).filter(e => kindOf(e) === 'acc');
    const inZone = sel ? (events || []).filter(e => e.area && e.area.car === sel) : (events || []);
    const hasKey = !!store.get(KEY);
    if (!hasKey) out.push({ lv: 'info', t: T('tk.nokey') });
    else if (evErr) out.push({ lv: 'info', t: TV('tk.err', { r: evErr }) });
    else if (events) {
      const a = sel ? inZone.filter(e => kindOf(e) === 'acc') : accs;
      if (a.length) {
        if (sel) out.push({ lv: 'emerg', t: TV('tk.accZone', { n: sel, a: a.length }) });
        else {
          const by = {}; for (const e of a) { const c = e.area && e.area.car ? TV('car.label', { n: e.area.car }) : T('car.none'); by[c] = (by[c] || 0) + 1; }
          out.push({ lv: 'emerg', t: TV('tk.accAll', { n: a.length }) + ' — ' + Object.entries(by).slice(0, 6).map(([k, n]) => TV('tk.accBy', { label: k, n })).join(', ') });
        }
        for (const e of a.slice(0, 4)) out.push({ lv: 'emerg', t: TV('tk.acc', { t: fmtDate(e.startDate), road: e.roadName || '', dir: e.roadDrcType || '', msg: String(e.message || '').slice(0, 40) }).replace(/\s+/g, ' ').trim() + (!sel && e.area && e.area.car ? ` (${TV('car.label', { n: e.area.car })})` : '') });
      } else if (sel) out.push({ lv: 'ok', t: TV('tk.accNone', { n: sel }) });
      const work = inZone.filter(e => kindOf(e) === 'con').length, wea = inZone.filter(e => kindOf(e) === 'wea').length;
      if (work || wea) out.push({ lv: 'info', t: TV('tk.work', { c: work, w: wea }) });
    }
    if (D && D.vehicles) {
      for (const v of D.vehicles) if (v.over && (!sel || v.car === sel)) out.push({ lv: 'emerg', t: TV('tk.over', { car: v.car, date: v.pickupDate.slice(5), slot: v.slot, b: v.bags, m: v.max }) });
      const pending = (D.items || []).filter(i => i.status === '접수' && (!sel || i.car === sel)).length;
      if (pending) out.push({ lv: 'info', t: TV('tk.pending', { n: pending }) });
      if (sel) {
        const mine = D.items.filter(i => i.car === sel); const b = mine.reduce((n, i) => n + i.bags, 0);
        out.push({ lv: 'info', t: TV('tk.rsv', { n: sel, r: mine.length, b }) });
        const moved = mine.filter(i => i.moved).length; if (moved) out.push({ lv: 'info', t: TV('tk.moved', { n: moved }) });
      }
    }
    if (!out.some(x => x.lv === 'emerg') && hasKey && events && !evErr) out.unshift({ lv: 'ok', t: T('tk.ok') });
    return out;
  }
  function renderTicker() {
    const box = document.getElementById('ticker'), track = document.getElementById('tickerTrack'); if (!box || !track) return;
    const items = tickerItems();
    const key = JSON.stringify(items) + '|' + focusCar;
    if (key === tickerKey) return; tickerKey = key; // 내용이 같으면 다시 그리지 않는다(흐르는 중에 처음으로 돌아가지 않게)
    track.innerHTML = items.map(i => `<span class="${i.lv === 'emerg' ? 'emerg' : i.lv === 'ok' ? 'ok' : ''}">${esc2(i.t)}</span>`).join('');
    box.classList.toggle('lv-ok', !items.some(i => i.lv === 'emerg') && items.some(i => i.lv === 'ok'));
    box.classList.toggle('lv-info', !items.some(i => i.lv === 'emerg') && !items.some(i => i.lv === 'ok'));
    document.getElementById('tickerSr').textContent = items.map(i => i.t).join('. ');
    // 속도: 초당 약 90px. 화면 너비 + 글자 너비를 지나가는 시간으로 계산한다
    requestAnimationFrame(() => {
      const view = track.parentElement.clientWidth, w = track.scrollWidth;
      track.style.setProperty('--vw', view + 'px'); track.style.setProperty('--dur', Math.max(12, (view + w) / 90) + 's');
    });
  }

  // ---- 상태 문구 · 사고 목록 · 키 입력
  function keyBox() {
    const box = document.getElementById('itsKeyBox'); if (!box) return;
    const has = !!store.get(KEY);
    box.querySelector('.its-form').hidden = has; box.querySelector('.its-have').hidden = !has;
  }
  function renderStatus() {
    statusEl.className = 'map-status'; logEl.innerHTML = '';
    keyBox();
    if (!base) { statusEl.textContent = T('map.loading'); return; }
    if (!store.get(KEY)) { statusEl.className = 'map-status err'; statusEl.textContent = T('its.noKey'); return; }
    if (evErr) { statusEl.className = 'map-status err'; statusEl.textContent = TV('its.fail', { r: evErr }); return; }
    if (!events) { statusEl.textContent = T('map.loading'); return; }
    const accs = events.filter(e => kindOf(e) === 'acc');
    const when = new Date(eventsAt).toLocaleTimeString(window.i18n.lang === 'en' ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit' });
    statusEl.textContent = TV('its.updated', { t: when, n: events.length, a: accs.length });
    const list = accs.slice(0, 6);
    logEl.innerHTML = list.length
      ? `<p><b>${esc2(T('its.accList'))}</b><br>${list.map(e => `${esc2(fmtDate(e.startDate))} ${esc2(e.roadName || '')} ${esc2(e.roadDrcType || '')}${e.area && e.area.car ? ' · ' + esc2(TV('car.label', { n: e.area.car })) : ''}`).join('<br>')}</p>`
      : `<p>${esc2(T('its.noAcc'))}</p>`;
  }

  async function loadBase() {
    try { const r = await api('/api/livemap?kind=base'); if (r.ok) base = await r.json(); } catch { /* 상태로 표시 */ }
    setZones(); renderStatus(); restyle();
  }
  async function loadTraffic() {
    const key = store.get(KEY);
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
    } else { drawPins(); applyBadges(); renderCarList(); renderDetail(); renderTicker(); }
  });
  document.getElementById('mapRefresh').addEventListener('click', loadTraffic);
  document.getElementById('tickerBtn').addEventListener('click', e => { const box = document.getElementById('ticker'); const on = box.classList.toggle('paused'); e.currentTarget.setAttribute('aria-pressed', String(on)); e.currentTarget.textContent = on ? '▶' : '⏸'; });
  window.addEventListener('resize', () => { tickerKey = ''; renderTicker(); });
  document.getElementById('mapMode').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.mode; store.set('hd-map-mode', mode); restyle(); });
  document.getElementById('itsSave').addEventListener('click', () => {
    const v = document.getElementById('itsKey').value.trim(); if (!v) return;
    store.set(KEY, v); document.getElementById('itsKey').value = ''; evErr = null; events = null; renderStatus(); loadTraffic();
  });
  document.getElementById('itsKey').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('itsSave').click(); } });
  document.getElementById('itsClear').addEventListener('click', () => { store.set(KEY, ''); events = null; evErr = null; drawEvents(); renderStatus(); });
  window.addEventListener('themechange', () => { setTiles(); restyle(); });
  window.addEventListener('langchange', () => { tickerKey = ''; setZones(); restyle(); renderStatus(); if (fitCtl._a) fitCtl._a.title = T('map.fit'); });
  window.addEventListener('resize', () => map.invalidateSize());
  renderStatus();
  restyle();
})();
