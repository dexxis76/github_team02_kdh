// 관리자 화면: 예약 표 · 배차 보드 · 연결 상태
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STATUS = ['접수', '배차 완료', '수거 완료', '공항 인도'];
let data = null, filter = '전체';

const hh = h => `${String(h).padStart(2, '0')}:00`;
const stClass = s => 's' + (STATUS.indexOf(s) + 1);

async function load() {
  try { data = await (await fetch('/api/reservations')).json(); render(); } catch { $('#storage').textContent = '예약을 불러오지 못했어요.'; }
}
async function patch(body) {
  const r = await fetch('/api/reservations', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (r.ok) { data = await r.json(); render(); }
}

function render() {
  $('#storage').textContent = `저장 위치: ${data.storage}`;
  const c = Object.fromEntries(STATUS.map(s => [s, data.items.filter(i => i.status === s).length]));
  const bags = data.items.reduce((a, i) => a + i.bags, 0);
  $('#tiles').innerHTML = `
    <div class="tile blue"><small>전체 예약</small><b>${data.items.length}건</b></div>
    <div class="tile"><small>접수 대기</small><b>${c['접수']}건</b></div>
    <div class="tile"><small>캐리어 합계</small><b>${bags}개</b></div>
    <div class="tile"><small>배차 차량</small><b>${data.vehicles.length}대</b></div>`;

  $('#veh').innerHTML = data.vehicles.length ? data.vehicles.map(v => {
    const pend = v.statuses.includes('접수');
    return `<article class="veh"><h4>${esc(v.pickupDate)} · ${esc(v.slot)}</h4>
      <p>${esc(v.region)}권역 (${v.districts.map(esc).join(', ')})</p>
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${v.max}" aria-valuenow="${v.bags}" aria-label="캐리어 ${v.bags}개 / ${v.max}개"><i style="width:${Math.round(v.bags / v.max * 100)}%"></i></div>
      <p><b>${v.bags}</b> / ${v.max}개 · 예약 ${v.tags.length}건</p>
      <p>${v.tags.map(esc).join(' · ')}</p>
      <div class="row"><span class="st ${stClass(v.statuses[v.statuses.length - 1])}">${esc(v.statuses.join(' / '))}</span>
      <button class="mini" data-v="${esc(v.id)}" ${pend ? '' : 'disabled'}>배차 완료로 바꾸기</button></div></article>`;
  }).join('') : '<div class="empty" style="grid-column:1/-1">아직 묶을 예약이 없어요. 고객 화면에서 예약하면 여기에 나타나요.</div>';

  $('#filter').innerHTML = ['전체', ...STATUS].map(s => `<button class="pill ${filter === s ? 'on' : ''}" data-f="${s}" style="height:40px;min-width:0;font-size:14px">${s}${s === '전체' ? '' : ' ' + c[s]}</button>`).join('');
  const list = data.items.filter(i => filter === '전체' || i.status === filter);
  $('#rows').innerHTML = list.length ? list.map(i => {
    const idx = STATUS.indexOf(i.status), next = STATUS[idx + 1];
    return `<tr><td class="tagc">${esc(i.tag)}${i.demo ? '<span class="demo-tag">데모 데이터</span>' : ''}</td>
      <td>${esc(i.name)}<br><small style="color:var(--mute)">${esc(i.phone)}</small></td>
      <td>${esc(i.district)} <small style="color:var(--mute)">${esc(i.region)}권역</small></td>
      <td>${esc(i.pickupDate)}<br><small style="color:var(--mute)">${hh(i.pickupHour)} 희망</small></td>
      <td>${esc(i.flightId)}<br><small style="color:var(--mute)">${esc(i.flightDate)} ${esc(i.depTime)} · ${esc(i.terminal)}</small></td>
      <td>${i.bags}개${i.large ? ` <small style="color:var(--mute)">(대형 ${i.large})</small>` : ''}</td>
      <td>${Number(i.price).toLocaleString('ko-KR')}원</td>
      <td><span class="st ${stClass(i.status)}">${esc(i.status)}</span></td>
      <td>${next ? `<button class="mini" data-t="${esc(i.tag)}" data-s="${esc(next)}">${esc(next)}으로</button>` : '<button class="mini" disabled>완료</button>'}</td></tr>`;
  }).join('') : '<tr><td colspan="9" style="text-align:center;color:var(--sub);padding:32px">해당하는 예약이 없어요.</td></tr>';
}

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.f) { filter = b.dataset.f; render(); }
  else if (b.dataset.t) patch({ tag: b.dataset.t, status: b.dataset.s });
  else if (b.dataset.v) patch({ vehicle: b.dataset.v, status: '배차 완료' });
});

async function conn() {
  try {
    const j = await (await fetch('/api/status')).json();
    const keys = Object.entries(j.keys).map(([k, v]) => `${esc(k)}: <span class="${v === '값 있음' ? 'ok' : 'bad'}">${v}</span>`).join('<br>');
    const ai = j.lastAI && j.lastAI.provider ? `<span class="ok">${esc(j.lastAI.provider)} · ${esc(j.lastAI.model)}</span> (${esc((j.lastAI.at || '').slice(11, 19))})` : (j.lastAI && j.lastAI.at ? '<span class="bad">모두 실패 → 규칙 기반</span>' : '아직 호출 없음');
    const pub = (n, o) => o ? (o.ok ? `<span class="ok">성공(실시간)</span> ${o.ms}ms` : `<span class="bad">${esc(o.reason)}</span> → 시연 값`) : '아직 호출 없음';
    $('#conn').innerHTML = `
      <div><b>키 이름</b>${keys}</div>
      <div><b>AI 순서</b>${j.aiOrder.join(' → ')}<br>마지막 응답: ${ai}</div>
      <div><b>여객편 주간 운항 현황 API</b>${pub('f', j.lastPublic.flights)}</div>
      <div><b>승객예고 API</b>${pub('n', j.lastPublic.notice)}</div>
      <div><b>답변 참고 문서</b>${j.docs}조각 (docs/답변참고문서/청킹)</div>`;
  } catch { $('#conn').textContent = '연결 상태를 불러오지 못했어요.'; }
}
load(); conn();
setInterval(() => { load(); conn(); }, 10000);
