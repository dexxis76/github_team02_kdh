// 관리자 화면: 예약 표 · 배차 보드 · 연결 상태
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STATUS = ['접수', '배차 완료', '수거 완료', '공항 인도']; // 서버와 주고받는 값이라 한국어 그대로 두고, 화면에서만 바꿔 보여 준다
const I = window.i18n;
const stName = s => window.t('st.' + s);
let connData = null, connFail = false, loadFail = false;
let data = null, filter = '전체';

const hh = h => `${String(h).padStart(2, '0')}:00`;
const stClass = s => 's' + (STATUS.indexOf(s) + 1);

// ---- 비밀번호 확인: 서버(API)가 헤더의 비밀번호를 검사한다. 입력한 값은 이 탭에만 기억한다(탭을 닫으면 사라짐)
let pw = null, timer = null;
try { pw = sessionStorage.getItem('hd-admin'); } catch { /* 저장소를 못 쓰면 매번 입력 */ }
const api = (url, opts = {}) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), 'x-admin-password': pw || '' } });
function showGate(msgKey) {
  clearInterval(timer); timer = null; pw = null; data = null; connData = null;
  try { sessionStorage.removeItem('hd-admin'); } catch { /* 무시 */ }
  $('#app').hidden = true; $('#gate').hidden = false;
  const err = $('#gateErr'); err.hidden = !msgKey; if (msgKey) err.textContent = window.t(msgKey);
  $('#gatePw').value = ''; $('#gatePw').focus();
}
function showApp() {
  $('#gate').hidden = true; $('#app').hidden = false;
  load(); conn();
  clearInterval(timer); timer = setInterval(() => { load(); conn(); }, 10000);
}
$('#gateForm').addEventListener('submit', async e => {
  e.preventDefault();
  const typed = $('#gatePw').value;
  try {
    const r = await fetch('/api/reservations', { headers: { 'x-admin-password': typed } });
    if (r.status === 401) return showGate('gate.wrong');
    if (!r.ok) return showGate('gate.error');
    pw = typed;
    try { sessionStorage.setItem('hd-admin', typed); } catch { /* 무시 */ }
    data = await r.json(); loadFail = false; showApp();
  } catch { showGate('gate.error'); }
});

async function load() {
  try { const r = await api('/api/reservations'); if (r.status === 401) return showGate('gate.wrong'); data = await r.json(); loadFail = false; render(); } catch { loadFail = true; $('#storage').textContent = window.t('adm.loadFail'); }
}
async function patch(body) {
  const r = await api('/api/reservations', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401) return showGate('gate.wrong');
  if (r.ok) { data = await r.json(); render(); }
}

function render() {
  if (!data) return;
  const t = window.t;
  $('#storage').textContent = t('adm.storage', { s: data.storage });
  const c = Object.fromEntries(STATUS.map(s => [s, data.items.filter(i => i.status === s).length]));
  const bags = data.items.reduce((a, i) => a + i.bags, 0);
  $('#tiles').innerHTML = `
    <div class="tile blue"><small>${t('tile.all')}</small><b>${t('unit.cases', { n: data.items.length })}</b></div>
    <div class="tile"><small>${t('tile.pending')}</small><b>${t('unit.cases', { n: c['접수'] })}</b></div>
    <div class="tile"><small>${t('tile.bags')}</small><b>${t('unit.bags', { n: bags })}</b></div>
    <div class="tile"><small>${t('tile.veh')}</small><b>${t('unit.cars', { n: data.vehicles.length })}</b></div>`;

  $('#veh').innerHTML = data.vehicles.length ? data.vehicles.map(v => {
    const pend = v.statuses.includes('접수');
    return `<article class="veh"><h4>${esc(v.pickupDate)} · ${esc(v.slot)}</h4>
      <p>${esc(t('adm.region', { r: v.region }))} (${v.districts.map(esc).join(', ')})</p>
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${v.max}" aria-valuenow="${v.bags}" aria-label="${esc(t('veh.bagsLabel', { b: v.bags, m: v.max }))}"><i style="width:${Math.round(v.bags / v.max * 100)}%"></i></div>
      <p>${t('veh.count', { b: v.bags, m: v.max, n: v.tags.length })}</p>
      <p>${v.tags.map(esc).join(' · ')}</p>
      <div class="row"><span class="st ${stClass(v.statuses[v.statuses.length - 1])}">${esc(v.statuses.map(stName).join(' / '))}</span>
      <button class="mini" data-v="${esc(v.id)}" ${pend ? '' : 'disabled'}>${t('veh.setDispatched')}</button></div></article>`;
  }).join('') : `<div class="empty" style="grid-column:1/-1">${t('veh.empty')}</div>`;

  $('#filter').innerHTML = ['전체', ...STATUS].map(s => `<button class="pill ${filter === s ? 'on' : ''}" data-f="${s}" style="height:40px;min-width:0;font-size:14px">${esc(t('st.' + s))}${s === '전체' ? '' : ' ' + c[s]}</button>`).join('');
  const list = data.items.filter(i => filter === '전체' || i.status === filter);
  $('#rows').innerHTML = list.length ? list.map(i => {
    const idx = STATUS.indexOf(i.status), next = STATUS[idx + 1];
    return `<tr><td class="tagc">${esc(i.tag)}${i.demo ? `<span class="demo-tag">${t('row.demoData')}</span>` : ''}</td>
      <td>${esc(i.name)}<br><small style="color:var(--mute)">${esc(i.phone)}</small></td>
      <td>${esc(i.district)} <small style="color:var(--mute)">${esc(t('adm.region', { r: i.region }))}</small></td>
      <td>${esc(i.pickupDate)}<br><small style="color:var(--mute)">${esc(t('row.wish', { h: hh(i.pickupHour) }))}</small></td>
      <td>${esc(i.flightId)}<br><small style="color:var(--mute)">${esc(i.flightDate)} ${esc(i.depTime)} · ${esc(i.terminal)}</small></td>
      <td>${t('unit.bags', { n: i.bags })}${i.large ? ` <small style="color:var(--mute)">${esc(t('row.large', { n: i.large }))}</small>` : ''}</td>
      <td>${i.party ? t('unit.people', { n: i.party }) : '-'}</td>
      <td>${I.won(i.price)}</td>
      <td>${i.voucher ? `<span class="tagc" style="color:var(--arr)">${esc(i.voucher.code)}</span><br><small style="color:var(--mute)">${esc(t('row.voucher', { round: i.voucher.trips === 2 ? t('voucher.round1') : '', r: i.voucher.rate, p: i.voucher.party }))}</small>` : `<small style="color:var(--mute)">${t('row.na')}</small>`}</td>
      <td><span class="st ${stClass(i.status)}">${esc(stName(i.status))}</span></td>
      <td>${next ? `<button class="mini" data-t="${esc(i.tag)}" data-s="${esc(next)}">${esc(t('st.next', { s: stName(next) }))}</button>` : `<button class="mini" disabled>${t('st.done')}</button>`}</td></tr>`;
  }).join('') : `<tr><td colspan="11" style="text-align:center;color:var(--sub);padding:32px">${t('row.empty')}</td></tr>`;
  window.dispatchEvent(new Event('admin-render'));
}

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.f) { filter = b.dataset.f; render(); }
  else if (b.dataset.t) patch({ tag: b.dataset.t, status: b.dataset.s });
  else if (b.dataset.v) patch({ vehicle: b.dataset.v, status: '배차 완료' });
});

async function conn() {
  try { const r = await api('/api/status'); if (r.status === 401) return showGate('gate.wrong'); connData = await r.json(); connFail = false; } catch { connFail = true; }
  renderConn();
}
function renderConn() {
  const t = window.t, j = connData;
  if (connFail || !j) { if (connFail) $('#conn').textContent = t('conn.fail'); return; }
  const keys = Object.entries(j.keys).map(([k, v]) => `${esc(k)}: <span class="${v === '값 있음' ? 'ok' : 'bad'}">${esc(t('v.' + v))}</span>`).join('<br>');
  const ai = j.lastAI && j.lastAI.provider ? `<span class="ok">${esc(j.lastAI.provider)} · ${esc(j.lastAI.model)}</span> (${esc((j.lastAI.at || '').slice(11, 19))})` : (j.lastAI && j.lastAI.at ? `<span class="bad">${t('conn.allFail')}</span>` : t('conn.none'));
  const pub = o => o ? (o.ok ? `<span class="ok">${t('conn.ok')}</span> ${o.ms}ms` : `<span class="bad">${esc(o.reason)}</span> ${t('conn.fallback')}`) : t('conn.none');
  $('#conn').innerHTML = `
      <div><b>${t('conn.keys')}</b>${keys}</div>
      <div><b>${t('conn.ai')}</b>${j.aiOrder.join(' → ')}<br>${t('conn.last', { v: ai })}</div>
      <div><b>${t('conn.flightApi')}</b>${pub(j.lastPublic.flights)}</div>
      <div><b>${t('conn.noticeApi')}</b>${pub(j.lastPublic.notice)}</div>
      <div><b>${t('conn.docs')}</b>${t('conn.docsV', { n: j.docs })}</div>`;
}
// 저장된 비밀번호가 있으면 바로 열어 보고, 맞지 않으면 입력창을 보여 준다
if (pw) { api('/api/reservations').then(r => (r.ok ? showApp() : showGate())).catch(() => showGate()); } else { $('#gatePw').focus(); }

window.addEventListener('langchange', () => { if (loadFail) $('#storage').textContent = window.t('adm.loadFail'); render(); renderConn(); });
