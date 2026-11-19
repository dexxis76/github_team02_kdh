// 고객 화면: 챗봇 + 혼잡 시간대
const $ = s => document.querySelector(s);
const msgs = $('#msgs'), quick = $('#quick'), input = $('#input'), sendBtn = $('#send');
let state = null, history = [], busy = false;
try { const saved = JSON.parse(sessionStorage.getItem('hd-chat') || 'null'); if (saved) { state = saved.state; history = saved.history || []; } } catch { /* 저장소를 못 쓰면 새로 시작 */ }

const STEPS = ['말 걸기', '고객 정보', '항공편', '사전 확인', '짐', '수거 시각', '예약 확인'];
function stepIndex() {
  const s = (state && state.slots) || {};
  if (state && state.step === 'done') return 7;
  if (!state || state.step === 'idle') return 0;
  if (!s.name || !s.phone || !s.district) return 1;
  if (!s.flightId || !s.flightDate || (s.flightSource === '시연 값' && (!s.terminal || !s.depTime))) return 2;
  if (s.checkUs == null || s.checkMobile !== true || s.checkUm == null) return 3;
  if (!s.bags || s.large == null || s.party == null) return 4;
  if (s.pickupHour == null) return 5;
  return 6;
}
function renderSteps() {
  const i = stepIndex();
  $('#steps').innerHTML = STEPS.map((t, n) => `<li class="${n < i ? 'done' : n === i ? 'now' : ''}"><i>${n < i ? '✓' : n + 1}</i>${t}</li>`).join('');
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function chipsFor(m) {
  const out = [];
  (m.sources || []).forEach(n => out.push(`<span class="chip src">근거: ${esc(n)}</span>`));
  const meta = m.meta || {};
  if (meta.ai && meta.ai.provider) out.push(`<span class="chip live" title="${esc((meta.ai.tried || []).map(t => t.provider + ': ' + (t.ok ? '성공' : t.reason)).join(' → '))}">AI: ${esc(meta.ai.provider)}${meta.ai.model ? ' · ' + esc(meta.ai.model) : ''}</span>`);
  else if (meta.mode === '규칙 기반') out.push(`<span class="chip demo" title="${esc(((meta.ai || {}).tried || []).map(t => t.provider + ': ' + t.reason).join(' / '))}">규칙 기반 모드 · AI 연결 안 됨</span>`);
  if (meta.flight) out.push(meta.flight.status === '실시간' ? '<span class="chip live">항공편: 실시간</span>' : `<span class="chip demo">항공편: 시연 값 (${esc(meta.flight.reason || '')})</span>`);
  if (meta.congestion) out.push(`<span class="chip ${meta.congestion === '실시간' ? 'live' : 'demo'}">혼잡: ${esc(meta.congestion)}</span>`);
  return out.length ? `<div class="chips">${out.join('')}</div>` : '';
}
function resCard(r) {
  if (!r) return '';
  return `<div class="rcard"><div class="tag">${esc(r.tag)}</div><dl>
    <dt>예약자</dt><dd>${esc(r.name)} · ${esc(r.phone)}</dd>
    <dt>수거</dt><dd>${esc(r.pickupDate)} ${String(r.pickupHour).padStart(2, '0')}시 희망 · ${esc(r.district)}</dd>
    <dt>항공편</dt><dd>${esc(r.flightId)} · ${esc(r.flightDate)} ${esc(r.depTime)} · ${esc(r.terminal)}</dd>
    <dt>짐 / 요금</dt><dd>캐리어 ${r.bags}개(대형 ${r.large}개) · ${Number(r.price).toLocaleString('ko-KR')}원 (데모 값)</dd>
    <dt>동반 인원</dt><dd>${r.party}명</dd></dl></div>${voucherCard(r.voucher)}`;
}
function voucherCard(v) {
  if (!v) return '';
  const w = n => Number(n).toLocaleString('ko-KR') + '원';
  return `<div class="ticket" aria-label="공항버스 가족 할인권">
    <div class="ticket-main"><small>공항버스 가족 할인권 <em>데모 값</em></small>
      <b>${esc(v.code)}</b>
      <span>${v.trips === 2 ? `왕복 공항버스 · 가는 길 ${esc(v.validDate)} 당일 · 오는 길 ${esc(v.returnUntil)}까지` : `${esc(v.route)} · ${esc(v.validDate)} 출발일 당일`}</span></div>
    <div class="ticket-side"><strong>${v.rate}%</strong><span>${v.trips === 2 ? '왕복 ' : ''}1인 ${w(v.fare)} → ${w(v.discounted)}</span><span>${v.party}명 사용 · ${w(v.saving)} 절약</span></div></div>`;
}
function add(role, text, m) {
  const d = document.createElement('div');
  d.className = 'm ' + (role === 'user' ? 'me' : 'bot');
  d.innerHTML = `<div class="bubble">${esc(text)}</div>${m ? resCard(m.reservation) + chipsFor(m) : ''}`;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return d;
}
function setQuick(list) {
  quick.innerHTML = '';
  (list || []).forEach(q => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pill'; b.textContent = q; b.onclick = () => send(q); quick.appendChild(b); });
}
function setMode(meta) {
  const el = $('#mode');
  if (!meta) return;
  if (meta.mode === 'AI' && meta.ai && meta.ai.provider) { el.textContent = `AI · ${meta.ai.provider}`; el.className = 'mode-chip ai'; }
  else { el.textContent = '규칙 기반 모드'; el.className = 'mode-chip rule'; }
}
function persist() { try { sessionStorage.setItem('hd-chat', JSON.stringify({ state, history: history.slice(-12) })); } catch { /* 무시 */ } }

async function send(text) {
  text = String(text || '').trim();
  if (!text || busy) return;
  busy = true; sendBtn.disabled = true; input.value = ''; setQuick([]);
  add('user', text);
  const typing = add('bot', '답을 쓰고 있어요…'); typing.classList.add('typing');
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: text, state, history: history.slice(-6) }) });
    const j = await r.json();
    typing.remove();
    if (!r.ok) throw new Error(j.error || '서버 오류');
    state = j.state; history.push({ role: 'user', text }, { role: 'bot', text: j.reply });
    add('bot', j.reply, j); setQuick(j.quick); setMode(j.meta); persist(); renderSteps();
  } catch (e) {
    typing.remove();
    add('bot', `답을 받지 못했어요. ${e.message}\n잠시 뒤 다시 보내 주세요.`);
    setQuick(['다시 시도']);
  }
  busy = false; sendBtn.disabled = false; input.focus();
}

$('#form').addEventListener('submit', e => { e.preventDefault(); send(input.value); });
document.querySelectorAll('.svc').forEach(b => b.addEventListener('click', () => { document.getElementById('chat').scrollIntoView(); send(b.dataset.q); }));

// 첫 화면: 저장된 대화가 있으면 이어서, 없으면 인사
const GREET = '안녕하세요! 홈드랍 예약·안내 챗봇이에요. 집에서 캐리어를 수거해 공항까지 보내 드려요(데모). 「짐 맡기고 싶어요」라고 말하면 예약을 시작해요. 요금·금지 물품·수거 시간도 물어보세요.';
add('bot', GREET);
if (history.length) {
  history.forEach(h => add(h.role === 'user' ? 'user' : 'bot', h.text));
  setQuick(state && state.step === 'done' ? ['새 예약'] : []);
} else {
  setQuick(['짐 맡기고 싶어요', '요금이 얼마예요?', '넣으면 안 되는 물건은?', '언제 수거하러 오나요?']);
}
renderSteps();

// ---- 혼잡 시간대 (승객예고 API, 실패하면 시연 값)
let term = 't1', day = 0, rows = [];
async function loadTraffic() {
  $('#trafficNote').textContent = '불러오는 중…';
  try {
    const j = await (await fetch('/api/congestion?day=' + day)).json();
    rows = j.rows;
    $('#trafficNote').innerHTML = j.source === '실시간'
      ? `출처: 인천국제공항공사 승객예고 API · <b class="ok">실시간</b> 예상치(${esc(j.date || '')}). 실측이 아니에요.`
      : `승객예고 API를 쓸 수 없어요(<b class="bad">${esc(j.reason)}</b>). 아래는 <b>시연 값</b>이에요.`;
    drawBars();
  } catch { $('#trafficNote').textContent = '혼잡 정보를 불러오지 못했어요.'; }
}
function drawBars() {
  const vals = Array.from({ length: 24 }, (_, h) => (rows.find(r => r.hour === h) || {})[term] || 0);
  const max = Math.max(...vals, 1);
  const top = [...vals.keys()].sort((a, b) => vals[b] - vals[a]).slice(0, 3);
  $('#bars').innerHTML = vals.map((v, h) => `<div class="bar ${top.includes(h) && v ? 'peak' : ''}" title="${h}~${h + 1}시 ${v.toLocaleString('ko-KR')}명"><em>${top.includes(h) && v ? v.toLocaleString('ko-KR') : ''}</em><i style="height:${Math.max(1, Math.round(v / max * 200))}px"></i></div>`).join('');
  $('#axis').innerHTML = vals.map((_, h) => `<span>${h}</span>`).join('');
}
$('#tb').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.t) { term = b.dataset.t; }
  if (b.dataset.d) { day = Number(b.dataset.d); }
  document.querySelectorAll('#tb .pill').forEach(x => x.classList.toggle('sel', x.dataset.t === term || (x.dataset.d != null && Number(x.dataset.d) === day)));
  if (b.dataset.d) loadTraffic(); else drawBars();
});
loadTraffic();
