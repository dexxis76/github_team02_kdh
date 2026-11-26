// 고객 화면: 챗봇 + 혼잡 시간대
const $ = s => document.querySelector(s);
const msgs = $('#msgs'), quick = $('#quick'), input = $('#input'), sendBtn = $('#send');
let state = null, history = [], busy = false;
try { const saved = JSON.parse(sessionStorage.getItem('hd-chat') || 'null'); if (saved) { state = saved.state; history = saved.history || []; } } catch { /* 저장소를 못 쓰면 새로 시작 */ }

const STEPS = () => [0, 1, 2, 3, 4, 5, 6].map(n => t('step.' + n));
const I = window.i18n;
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
  $('#steps').innerHTML = STEPS().map((label, n) => `<li class="${n < i ? 'done' : n === i ? 'now' : ''}"><i>${n < i ? '✓' : n + 1}</i>${esc(label)}</li>`).join('');
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function chipsFor(m) {
  const out = [];
  (m.sources || []).forEach(n => out.push(`<span class="chip src">${esc(t('chip.src', { n: I.srv(n) }))}</span>`));
  const meta = m.meta || {};
  if (meta.ai && meta.ai.provider) out.push(`<span class="chip live" title="${esc((meta.ai.tried || []).map(t => t.provider + ': ' + (t.ok ? '성공' : t.reason)).join(' → '))}">AI: ${esc(meta.ai.provider)}${meta.ai.model ? ' · ' + esc(meta.ai.model) : ''}</span>`);
  else if (meta.mode === '규칙 기반') out.push(`<span class="chip demo" title="${esc(((meta.ai || {}).tried || []).map(t => t.provider + ': ' + t.reason).join(' / '))}">${esc(t('chip.rule'))}</span>`);
  if (meta.flight) out.push(meta.flight.status === '실시간' ? `<span class="chip live">${esc(t('chip.flightLive'))}</span>` : `<span class="chip demo">${esc(t('chip.flightDemo', { r: meta.flight.reason || '' }))}</span>`);
  if (meta.congestion) out.push(`<span class="chip ${meta.congestion === '실시간' ? 'live' : 'demo'}">${esc(t('chip.cong', { v: I.srv(meta.congestion) }))}</span>`);
  return out.length ? `<div class="chips">${out.join('')}</div>` : '';
}
function resCard(r) {
  if (!r) return '';
  return `<div class="rcard"><div class="tag">${esc(r.tag)}</div><dl>
    <dt>${t('res.name')}</dt><dd>${esc(r.name)} · ${esc(r.phone)}</dd>
    <dt>${t('res.pickup')}</dt><dd>${esc(t('res.pickupV', { date: r.pickupDate, h: String(r.pickupHour).padStart(2, '0'), d: r.district }))}</dd>
    <dt>${t('res.flight')}</dt><dd>${esc(r.flightId)} · ${esc(r.flightDate)} ${esc(r.depTime)} · ${esc(r.terminal)}</dd>
    <dt>${t('res.bags')}</dt><dd>${esc(t('res.bagsV', { b: r.bags, l: r.large, p: I.won(r.price) }))}</dd>
    <dt>${t('res.party')}</dt><dd>${esc(t('res.partyV', { n: r.party }))}</dd></dl></div>${voucherCard(r.voucher)}`;
}
function voucherCard(v) {
  if (!v) return '';
  const round = v.trips === 2;
  return `<div class="ticket" aria-label="${esc(t('voucher.label'))}">
    <div class="ticket-main"><small>${t('voucher.label')} <em>${t('voucher.demo')}</em></small>
      <b>${esc(v.code)}</b>
      <span>${esc(round ? t('voucher.round', { d: v.validDate, r: v.returnUntil }) : t('voucher.one', { route: v.route, d: v.validDate }))}</span></div>
    <div class="ticket-side"><strong>${v.rate}%</strong><span>${esc(t('voucher.fare', { round: round ? t('voucher.round1') : '', a: I.won(v.fare), b: I.won(v.discounted) }))}</span><span>${esc(t('voucher.use', { n: v.party, s: I.won(v.saving) }))}</span></div></div>`;
}
function add(role, text, m) {
  const d = document.createElement('div');
  d.className = 'm ' + (role === 'user' ? 'me' : 'bot');
  d.innerHTML = `<div class="bubble">${esc(text)}</div>${m ? resCard(m.reservation) + chipsFor(m) : ''}`;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return d;
}
let quickList = [];
// 화면에는 현재 언어로 보여 주고, 서버에는 원래 한국어 문장을 보낸다
function setQuick(list) {
  quickList = list || [];
  quick.innerHTML = '';
  quickList.forEach(q => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pill'; b.textContent = I.quickLabel(q); b.onclick = () => send(q, I.quickLabel(q)); quick.appendChild(b); });
}
let lastMeta = null;
function setMode(meta) {
  const el = $('#mode');
  if (!meta) return;
  lastMeta = meta;
  el.removeAttribute('data-i18n');
  if (meta.mode === 'AI' && meta.ai && meta.ai.provider) { el.textContent = t('mode.ai', { p: meta.ai.provider }); el.className = 'mode-chip ai'; }
  else { el.textContent = t('mode.rule'); el.className = 'mode-chip rule'; }
}
function persist() { try { sessionStorage.setItem('hd-chat', JSON.stringify({ state, history: history.slice(-12) })); } catch { /* 무시 */ } }

async function send(text, shown) {
  text = String(text || '').trim();
  if (!text || busy) return;
  busy = true; sendBtn.disabled = true; input.value = ''; setQuick([]);
  add('user', shown || text);
  const typing = add('bot', t('typing')); typing.classList.add('typing');
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: text, state, history: history.slice(-6), lang: I.lang }) });
    const j = await r.json();
    typing.remove();
    if (!r.ok) throw new Error(j.error || t('err.server'));
    state = j.state; history.push({ role: 'user', text }, { role: 'bot', text: j.reply });
    add('bot', j.reply, j); setQuick(j.quick); setMode(j.meta); persist(); renderSteps();
  } catch (e) {
    typing.remove();
    add('bot', t('err.noReply', { msg: e.message }));
    setQuick(['다시 시도']);
  }
  busy = false; sendBtn.disabled = false; input.focus();
}

$('#form').addEventListener('submit', e => { e.preventDefault(); send(input.value); });
document.querySelectorAll('.svc').forEach(b => b.addEventListener('click', () => { document.getElementById('chat').scrollIntoView(); send(b.dataset.q, I.quickLabel(b.dataset.q)); }));

// 첫 화면: 저장된 대화가 있으면 이어서, 없으면 인사
const greetEl = add('bot', t('greet'));
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
  tInfo = null; tFail = false; drawNote();
  try {
    const j = await (await fetch('/api/congestion?day=' + day)).json();
    rows = j.rows; tInfo = { live: j.source === '실시간', date: j.date || '', reason: j.reason || '' };
    drawNote(); drawBars();
  } catch { tFail = true; drawNote(); }
}
let tInfo = null, tFail = false;
function drawNote() {
  const el = $('#trafficNote');
  if (tFail) el.textContent = t('traffic.fail');
  else if (!tInfo) el.textContent = t('traffic.loading');
  else el.innerHTML = tInfo.live ? t('traffic.live', { date: esc(tInfo.date) }) : t('traffic.demo', { reason: esc(tInfo.reason) });
}
function drawBars() {
  const vals = Array.from({ length: 24 }, (_, h) => (rows.find(r => r.hour === h) || {})[term] || 0);
  const max = Math.max(...vals, 1);
  const top = [...vals.keys()].sort((a, b) => vals[b] - vals[a]).slice(0, 3);
  $('#bars').innerHTML = vals.map((v, h) => `<div class="bar ${top.includes(h) && v ? 'peak' : ''}" title="${esc(t('traffic.bar', { h, h2: h + 1, n: I.num(v) }))}"><em>${top.includes(h) && v ? I.num(v) : ''}</em><i style="height:${Math.max(1, Math.round(v / max * 200))}px"></i></div>`).join('');
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

// ---- 언어를 바꾸면 화면에 남아 있는 글자를 다시 그린다 (이미 받은 서버 답변은 그대로 둔다)
window.addEventListener('langchange', () => {
  const greetBubble = greetEl.querySelector('.bubble'); if (greetBubble) greetBubble.textContent = t('greet');
  setQuick(quickList);
  renderSteps();
  if (lastMeta) setMode(lastMeta);
  drawNote(); if (rows.length) drawBars();
});
