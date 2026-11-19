// 홈드랍 예약·안내 챗봇.
// 규칙(날짜·개수·요금·태그)은 서버 코드가 정하고, AI 는 말을 항목으로 바꾸고 질문에 답하는 일만 한다.
// AI 가 모두 실패하면 규칙 기반 모드로 같은 흐름을 이어 간다.
const { today, addDays, won, validDate, korDate } = require('./_util');
const R = require('./_rules');
const { askAI } = require('./_ai');
const { search } = require('./_docs');
const pub = require('./_public');
const store = require('./_store');

const DEMO_DOC = '홈드랍 데모 규칙';
const CONTACT = '이지드랍 고객센터 02-6010-1220 (홈드랍 전용 번호는 아닙니다)';

const emptyState = () => ({ step: 'idle', slots: {}, flightKey: null });

function cleanState(s) {
  const out = emptyState();
  if (!s || typeof s !== 'object') return out;
  if (['idle', 'collect', 'done'].includes(s.step)) out.step = s.step;
  const k = s.slots || {};
  const pick = ['name', 'phone', 'address', 'district', 'region', 'flightId', 'flightDate', 'terminal', 'depTime', 'airport', 'flightSource', 'flightNote', 'flightKey'];
  for (const f of pick) if (typeof k[f] === 'string') out.slots[f] = k[f].slice(0, 120);
  for (const f of ['checkUs', 'checkMobile', 'checkUm']) if (typeof k[f] === 'boolean') out.slots[f] = k[f];
  for (const f of ['bags', 'large', 'party', 'pickupHour']) if (Number.isInteger(k[f])) out.slots[f] = k[f];
  if (typeof s.flightKey === 'string') out.flightKey = s.flightKey;
  return out;
}

// ---- 지금 물어볼 항목
function pendingGroup(s) {
  if (!s.name || !s.phone) return 'who';
  if (!s.district) return 'address';
  if (!s.flightId || !s.flightDate) return 'flight';
  if (s.flightSource === '시연 값' && (!s.terminal || !s.depTime)) return 'terminal';
  if (s.checkUs == null) return 'checkUs';
  if (s.checkMobile !== true) return 'checkMobile';
  if (s.checkUm == null) return 'checkUm';
  if (!s.bags) return 'bags';
  if (s.large == null) return 'large';
  if (s.party == null) return 'party';
  if (s.pickupHour == null) return 'pickup';
  return 'confirm';
}

const pickupDate = s => addDays(s.flightDate, -1);

function summary(s) {
  const p = R.price(s.bags, s.large);
  return [
    `· 예약자: ${s.name} / ${s.phone}`,
    `· 수거지: ${s.address} (${s.district}, ${s.region}권역)`,
    `· 항공편: ${s.flightId} · ${korDate(s.flightDate)} ${s.depTime} 출발 · ${s.terminal}${s.airport ? ' · ' + s.airport : ''}`,
    `· 짐: 캐리어 ${s.bags}개 (대형 ${s.large}개)`,
    `· 함께 가는 인원: ${s.party}명 (본인 포함)`,
    R.busEligible(s.party)
      ? `· 공항버스 가족 할인권: 데모 규칙상 해당돼요. 왕복 모두 1인 ${won(R.BUS_FARE)} → ${won(R.BUS_FARE * (100 - R.BUS_RATE) / 100)} (${R.BUS_RATE}% 할인 · ${R.BUS_RATE_NOTE}, 데모 값) × ${s.party}명, 예약이 끝나면 함께 발급해요`
      : `· 공항버스 가족 할인권: 3명 이상일 때 발급해요(데모 규칙). 이번 예약은 해당하지 않아요`,
    `· 수거: ${korDate(pickupDate(s))} ${R.hourLabel(R.slotStart(s.pickupHour))}~${R.hourLabel(R.slotStart(s.pickupHour) + 2)} 시간대 — 희망 ${R.hourLabel(s.pickupHour)}, 수거 30분 전 기사님이 연락해요`,
    `· 요금: ${won(p)} (데모 값 · 캐리어 ${s.bags}개 ${won(R.price(s.bags, 0))}${s.large ? ` + 대형 ${s.large}개 ${won(s.large * 5000)}` : ''})`,
  ].join('\n');
}

function promptFor(g, s) {
  const [from, to] = R.bookableRange();
  switch (g) {
    case 'who':
      return { text: s.name ? `${s.name}님, 휴대폰 번호를 알려 주세요. (실제 번호 말고 지어낸 예시로 입력해 주세요)` : '좋아요! 먼저 성함과 휴대폰 번호를 알려 주세요. 데모라서 실제 개인정보 대신 지어낸 예시를 써 주세요.', quick: ['김가상 010-0000-0000'] };
    case 'address':
      return { text: '수거받을 주소를 알려 주세요. 구 이름을 꼭 넣어 주세요. (서울 전체가 데모 범위예요)', quick: ['서울 강남구 테헤란로 1'] };
    case 'flight':
      return { text: s.flightId ? `출발 날짜를 알려 주세요. 예약은 출발 2일 전까지라 ${korDate(from)}~${korDate(to)} 출발편만 예약할 수 있어요.` : `항공편 번호와 출발 날짜를 알려 주세요. (예: KE123, ${korDate(from)}) 예약은 출발 2일 전까지라 ${korDate(from)}~${korDate(to)} 출발편만 예약할 수 있어요.`, quick: [] };
    case 'terminal':
      return { text: `${s.flightNote || '항공편 정보를 확인하지 못했어요.'} 터미널(T1/T2)과 출발 시각을 직접 알려 주세요. (예: T1, 14:25)`, quick: ['T1 14:25', 'T2 14:25'] };
    case 'checkUs':
      return { text: '예약 전에 3가지를 확인할게요. 첫째, 미주 노선(미국·캐나다·괌·사이판·하와이 등)인가요?', quick: ['아니요, 미주 노선이 아니에요', '네, 미주 노선이에요'] };
    case 'checkMobile':
      return { text: s.checkMobile === false ? '먼저 모바일 체크인을 마쳐 주세요. 마치셨으면 「체크인 완료했어요」라고 알려 주세요.' : '둘째, 모바일 체크인을 마치셨나요?', quick: ['네, 마쳤어요', '아니요, 아직이에요'] };
    case 'checkUm':
      return { text: '셋째, 어린이가 부모 없이 혼자 타나요? (UM)', quick: ['아니요', '네, 어린이 혼자 타요'] };
    case 'bags':
      return { text: '캐리어는 모두 몇 개인가요? (한 예약 최대 8개, 데모 값)', quick: ['캐리어 1개', '캐리어 2개', '캐리어 3개', '캐리어 4개'] };
    case 'large':
      return { text: '그중 28인치 이상 대형 캐리어는 몇 개인가요?', quick: ['대형 없어요', '대형 1개', '대형 2개'] };
    case 'party':
      return { text: '함께 공항에 가시는 인원은 본인 포함 몇 명인가요? 3명 이상이면 공항버스 가족 할인권을 예약과 함께 드려요(데모 규칙).', quick: ['1명', '2명', '3명', '4명'] };
    case 'pickup':
      return { text: `수거는 출발 전날(${korDate(pickupDate(s))})에 해요. 희망 시각을 알려 주세요. 오전 8시~오후 8시, 2시간 단위 시간대로 배차해요(데모 값).`, quick: ['오전 10시', '오후 2시', '오후 4시', '오후 6시'] };
    case 'confirm':
      return {
        text: `예약 내용을 확인해 주세요.\n${summary(s)}\n\n넣으면 안 되는 물건\n${R.PROHIBITED.map(x => '· ' + x).join('\n')}\n\n이대로 예약할까요?`,
        quick: ['예, 예약할게요', '수정할래요'],
      };
  }
  return { text: '', quick: [] };
}

// ---- AI 에게 맡기는 일: 말 → 항목, 질문 → 답
const SCHEMA_HELP = `{"intent":"book|ask|yes|no|other","updates":{...},"answer":null,"sources":[]}`;
function buildSystem(s, group) {
  return [
    '너는 「홈드랍 예약·안내 챗봇」의 말 이해 담당이다. 반드시 JSON 객체 하나만 출력한다. 설명·코드블록 금지.',
    `형식: ${SCHEMA_HELP}`,
    'intent: 예약하고 싶다는 말=book, 질문=ask, 확인 질문에 긍정=yes, 부정=no, 그 밖=other.',
    'updates 에는 사용자가 이번 말에서 알려 준 값만 넣는다(없으면 생략): name(성함), phone(숫자와 -), address(주소), flightId(편명 예 KE123), flightDate(YYYY-MM-DD), terminal(T1 또는 T2), depTime(HH:MM 24시간), checkUs(미주 노선이면 true), checkMobile(모바일 체크인 완료면 true), checkUm(어린이 혼자 탑승이면 true), bags(캐리어 총 개수 정수), large(대형 개수 정수), party(함께 가는 인원 본인 포함 정수), pickupHour(희망 수거 시각 0~23 정수).',
    `오늘은 ${today()}이다. 연도 없는 날짜는 오늘 이후 가장 가까운 날로 본다. 물어보지 않은 값을 지어내지 않는다.`,
    `지금 서비스가 묻고 있는 항목은 「${group}」이다. 사용자가 「네」「2개」「강남구」처럼 짧게 답하면 이 항목의 값으로 해석한다. (checkUs/checkMobile/checkUm 은 질문 내용이 「미주 노선인가/체크인 마쳤나/어린이 혼자인가」이다.)`,
    'answer: 사용자가 질문했을 때만 한국어 존댓말로 2~4문장. 아래 [참고 자료]와 [실시간 값] 안의 내용만 쓴다. 없으면 「확인 필요」라고 하고 문의처를 안내한다: ' + CONTACT + '.',
    `요금은 직접 계산하지 말고 [요금] 항목의 값만 쓴다. 홈드랍 데모 요금만 답하고, 이지드랍 요금은 사용자가 이지드랍을 물었을 때만 답한다. ${DEMO_DOC} 의 값에는 「데모 값」이라고 밝힌다. 이지드랍과 홈드랍은 다른 서비스이니 어느 쪽 이야기인지 밝힌다.`,
    '예약 변경·취소·환불, 결제 방법, 분실·파손 책임, 다른 항공사 규정은 자료에 없으면 「확인 필요」로 답한다. 이용 자격을 단정해서 판정하지 않는다.',
    'sources: answer 에 쓴 근거 이름만. 참고 자료의 name 그대로, 또는 「여객편 주간 운항 현황 API」「승객예고 API」. 답이 없으면 빈 배열.',
  ].join('\n');
}

function buildUser(text, s, group, history, docs, extra) {
  const ctx = docs.map((d, i) => `(${i + 1}) name=${d.name} / ${d.section}\n${d.text}`).join('\n\n') || '(관련 자료 없음)';
  return [
    `[요금] 홈드랍 데모 요금(데모 값): 기본 캐리어 1개 20,000원, 1개 추가마다 +10,000원, 대형(28인치 이상) 1개당 +5,000원. 대형 없음 기준: ${R.PRICE_TABLE}. 이 값은 서버가 계산한 것이다.`,
    `[참고 자료]\n${ctx}`,
    extra ? `[실시간 값]\n${extra}` : '[실시간 값] (없음)',
    `[지금까지 받은 항목] ${JSON.stringify(s)}`,
    `[최근 대화]\n${history.map(h => `${h.role === 'user' ? '고객' : '챗봇'}: ${String(h.text).slice(0, 300)}`).join('\n') || '(없음)'}`,
    `[고객의 이번 말] ${text}`,
    `묻고 있는 항목: ${group}`,
  ].join('\n\n');
}

function parseJSON(t) {
  const m = String(t).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('JSON 아님');
  const o = JSON.parse(m[0]);
  if (!o || typeof o !== 'object') throw new Error('JSON 아님');
  return { intent: o.intent || 'other', updates: o.updates && typeof o.updates === 'object' ? o.updates : {}, answer: typeof o.answer === 'string' && o.answer.trim() ? o.answer.trim() : null, sources: Array.isArray(o.sources) ? o.sources.filter(x => typeof x === 'string') : [] };
}

// ---- 규칙 기반 모드 (AI 연결이 끊겨도 같은 흐름)
function ruleUnderstand(text, s, group) {
  const t = text.trim();
  const u = {};
  let intent = 'other';
  if (/짐\s?맡|예약|맡기고|홈드랍\s?(쓰|이용)/.test(t)) intent = 'book';
  if (/[?？]|얼마|어떻게|가능|되나요|안\s?돼|뭐|언제|몇|왜|혼잡|붐비/.test(t)) intent = 'ask';
  const yes = /^(네|예|응|넵|그래|좋아|맞아|맞습니다|예약할게|예, ?예약)/.test(t) || /완료했|마쳤|했어요|했습니다/.test(t);
  const no = /^(아니|아뇨|노|싫|수정|바꿀|다시)/.test(t) || /아직|못\s?했|안\s?했|없어요|없습니다/.test(t);
  if (group === 'confirm') { if (yes && /예약|네|예|응/.test(t)) intent = 'yes'; else if (no) intent = 'no'; }

  const phone = t.match(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/);
  if (phone) u.phone = phone[0].replace(/\D/g, '');
  const fl = t.match(/\b([A-Za-z]{2}|[A-Za-z]\d|\d[A-Za-z])\s?(\d{2,4})([A-Za-z])?\b/);
  if (fl && !/^0\d/.test(fl[0]) && group !== 'terminal' && (group === 'flight' || !s.flightId)) u.flightId = (fl[1] + fl[2] + (fl[3] || '')).toUpperCase();
  const d1 = t.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/), d2 = t.match(/(\d{1,2})\s?월\s?(\d{1,2})\s?일/);
  const yr = Number(today().slice(0, 4));
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (d1) u.flightDate = iso(d1[1], d1[2], d1[3]);
  else if (d2) { let c = iso(yr, d2[1], d2[2]); if (c < today()) c = iso(yr + 1, d2[1], d2[2]); u.flightDate = c; }
  else if (/모레/.test(t)) u.flightDate = addDays(today(), 2);
  else if (/내일/.test(t)) u.flightDate = addDays(today(), 1);
  const term = t.match(/\bT?([12])\s?(터미널|여객)|\bT([12])\b|제\s?([12])\s?여객터미널/i);
  if (term) u.terminal = 'T' + (term[1] || term[3] || term[4]);
  const tm = t.match(/(\d{1,2}):(\d{2})/);
  if (tm && group === 'terminal') u.depTime = `${tm[1].padStart(2, '0')}:${tm[2]}`;
  const bags = t.match(/(?:캐리어|짐)\s?(\d+)\s?개|^(\d+)\s?개$|^(\d+)$/);
  if (bags && (group === 'bags' || /캐리어/.test(t))) u.bags = Number(bags[1] || bags[2] || bags[3]);
  const large = t.match(/대형\s?(\d+)\s?개?/);
  if (large) u.large = Number(large[1]);
  else if (group === 'large') { const n = t.match(/(\d+)/); if (n) u.large = Number(n[1]); else if (/없|0|안/.test(t)) u.large = 0; }
  if (group === 'pickup' || /시/.test(t)) {
    const h = t.match(/(오전|오후|아침|저녁)?\s?(\d{1,2})\s?시/);
    if (h && group === 'pickup') { let n = Number(h[2]); if (/오후|저녁/.test(h[1] || '') && n < 12) n += 12; else if (!h[1] && n >= 1 && n <= 7) n += 12; u.pickupHour = n; }
  }
  const pm = t.match(/(\d+)\s?(명|인)/);
  if (pm && (group === 'party' || /가족|함께|동반|같이/.test(t))) u.party = Number(pm[1]);
  else if (group === 'party') { const n = t.match(/^\s*(\d+)\s*$/); if (n) u.party = Number(n[1]); }
  if (group === 'checkUs') u.checkUs = yes && !/아니|않|없/.test(t) ? true : (no || /아니|않|없/.test(t) ? false : undefined);
  if (group === 'checkMobile') u.checkMobile = /아니|아직|못|안\s?했/.test(t) ? false : (yes || /마쳤|완료/.test(t) ? true : undefined);
  if (group === 'checkUm') u.checkUm = /아니|않|없/.test(t) ? false : (yes ? true : undefined);
  if (R.findDistrict(t) || (group === 'address' && t.length > 4)) u.address = t;
  if (group === 'who' || !s.name) {
    const nm = t.match(/(?:이름은?|성함은?)\s*([가-힣]{2,4})/) || t.match(/^([가-힣]{2,4})(?=\s|$|,|입니다|이에요|예요)/);
    if (nm && !/^(안녕|네|예|아니|짐맡)/.test(nm[1])) u.name = nm[1];
  }
  for (const k of Object.keys(u)) if (u[k] === undefined) delete u[k];
  return { intent, updates: u, answer: null, sources: [] };
}

// 규칙 모드에서 질문에 답하기: 가장 가까운 자료 한 조각을 그대로 보여 준다
function ruleAnswer(text, docs, extra) {
  if (extra && CONGEST.test(text)) return { answer: extra, sources: ['승객예고 API'] };
  if (docs.length) {
    const d = docs[0];
    const body = d.text.replace(/^#.*\n?/gm, '').trim().slice(0, 450);
    return { answer: `${d.name}의 「${d.section}」 내용이에요.\n${body}`, sources: [d.name] };
  }
  return { answer: `자료에 없는 내용이라 확인 필요입니다. 문의처: ${CONTACT}`, sources: [] };
}

// ---- 값 검사 후 반영
function applyUpdates(s, u, errors) {
  const before = { flightId: s.flightId, flightDate: s.flightDate, terminal: s.terminal, depTime: s.depTime };
  if (typeof u.name === 'string') { const v = u.name.trim(); if (/^[가-힣A-Za-z ]{2,12}$/.test(v)) s.name = v; else errors.push('성함은 2~12자로 알려 주세요.'); }
  if (u.phone != null) {
    const d = String(u.phone).replace(/\D/g, '');
    if (/^01[016789]\d{7,8}$/.test(d)) s.phone = d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    else errors.push('휴대폰 번호는 010으로 시작하는 10~11자리로 알려 주세요.');
  }
  if (typeof u.address === 'string' && u.address.trim()) {
    const a = u.address.trim().slice(0, 100);
    const f = R.findDistrict(a);
    if (f) { s.address = a; s.district = f.district; s.region = f.region; }
    else if (R.OUT_OF_SEOUL.test(a) && !/서울/.test(a)) errors.push('수거 지역은 서울 전체까지가 데모 범위예요. 서울 주소로 알려 주세요.');
    else errors.push('구 이름이 들어간 서울 주소로 알려 주세요. (예: 서울 강남구 …)');
  }
  if (typeof u.flightId === 'string') {
    const v = u.flightId.replace(/\s/g, '').toUpperCase();
    if (/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(v)) s.flightId = v; else errors.push('항공편 번호 형식이 달라요. 예: KE123');
  }
  if (typeof u.flightDate === 'string') { if (validDate(u.flightDate)) s.flightDate = u.flightDate; else errors.push('출발 날짜를 알아보지 못했어요. 예: 11월 23일'); }
  if (u.terminal === 'T1' || u.terminal === 'T2') s.terminal = u.terminal;
  if (typeof u.depTime === 'string' && /^\d{1,2}:\d{2}$/.test(u.depTime)) s.depTime = u.depTime.padStart(5, '0');
  for (const k of ['checkUs', 'checkMobile', 'checkUm']) if (typeof u[k] === 'boolean') s[k] = u[k];
  if (u.bags != null) {
    const n = Number(u.bags);
    if (Number.isInteger(n) && n >= 1 && n <= R.MAX_BAGS_PER_BOOKING) { s.bags = n; if (s.large != null && s.large > n) s.large = n; }
    else errors.push(`캐리어는 한 예약에 1~${R.MAX_BAGS_PER_BOOKING}개까지예요(데모 값). 더 많으면 예약을 나눠 주세요.`);
  }
  if (u.large != null) {
    const n = Number(u.large);
    if (Number.isInteger(n) && n >= 0 && (!s.bags || n <= s.bags)) s.large = n; else errors.push('대형 개수는 캐리어 개수보다 많을 수 없어요.');
  }
  if (u.party != null) {
    const n = Number(u.party);
    if (Number.isInteger(n) && n >= 1 && n <= R.MAX_PARTY) s.party = n; else errors.push(`함께 가는 인원은 1~${R.MAX_PARTY}명으로 알려 주세요(데모 값).`);
  }
  if (u.pickupHour != null) {
    const n = Number(u.pickupHour);
    if (R.pickupOk(n)) s.pickupHour = n; else errors.push('수거는 오전 8시~오후 8시 사이로 정해 주세요(데모 값).');
  }
  return before;
}

// 항공편 확인: 실시간 조회 → 실패하면 이유와 시연 값(직접 입력) 안내
async function resolveFlight(s, errors, notes, sources, meta) {
  if (!s.flightId || !s.flightDate) return;
  const key = `${s.flightId}|${s.flightDate}|${s.terminal || ''}|${s.depTime || ''}`;
  if (s.flightKey === key && (s.flightSource === '실시간' || s.terminal)) return;
  const [from, to] = R.bookableRange();
  const chk = R.checkFlightDate(s.flightDate);
  if (!chk.ok) {
    errors.push(chk.code === 'range'
      ? `항공편 정보는 오늘부터 6일 뒤까지만 확인할 수 있어서 ${korDate(s.flightDate)} 편은 「확인 필요」예요. ${korDate(from)}~${korDate(to)} 출발편으로 알려 주세요.`
      : `예약은 출발 2일 전까지예요(데모 값). ${korDate(s.flightDate)} 출발은 마감됐고, ${korDate(from)} 이후 출발편만 예약할 수 있어요.`);
    s.flightDate = null; s.flightKey = null;
    return;
  }
  const userTerm = s.terminal, userTime = s.depTime;
  if (s.flightSource === '시연 값' && userTerm && userTime) { s.flightKey = key; return finishFlight(s, errors); }
  const r = await pub.lookupFlight(s.flightId, s.flightDate);
  meta.flight = r.ok ? { status: '실시간' } : { status: '시연 값', reason: r.reason };
  sources.push('여객편 주간 운항 현황 API');
  if (!r.ok) {
    s.flightSource = '시연 값'; s.flightNote = `여객편 주간 운항 현황 API를 쓸 수 없어요(${r.reason}). 항공편 확인은 시연 값으로 대신할게요.`;
    s.terminal = userTerm || null; s.depTime = userTime || null; s.airport = null;
    s.flightKey = null;
    if (s.terminal && s.depTime) { s.flightKey = key; return finishFlight(s, errors); }
    return;
  }
  if (!r.found) {
    errors.push(`${s.flightId} 편(${korDate(s.flightDate)})은 운항 현황에서 찾지 못했어요. 편명과 날짜를 다시 확인해 주세요.`);
    s.flightId = null; s.flightKey = null; s.flightSource = null; s.terminal = null; s.depTime = null;
    return;
  }
  const f = r.flight;
  if (/결항/.test(f.remark)) {
    errors.push(`${f.flightId} 편은 ${f.remark} 상태예요. 다른 편으로 알려 주세요.`);
    s.flightId = null; s.flightKey = null; return;
  }
  s.flightSource = '실시간'; s.airport = f.airport; s.depTime = f.depTime; s.terminal = f.terminal || userTerm || null;
  s.flightKey = `${s.flightId}|${s.flightDate}|${s.terminal || ''}|${s.depTime}`;
  notes.push(`항공편 확인: ${f.flightId} · ${f.airline} · ${f.airport}행 · ${korDate(s.flightDate)} ${f.depTime} 출발 · ${s.terminal || '터미널 미확인'}${f.remark && f.remark !== '출발' ? ' · ' + f.remark : ''}`);
  if (!s.terminal) { s.flightSource = '시연 값'; s.flightNote = '터미널 정보가 없어요.'; return; }
  if (f.airportCode && R.US_AIRPORTS.has(f.airportCode)) s.checkUs = true;
  return finishFlight(s, errors);
}
function finishFlight(s, errors) {
  if (!R.inServiceHours(s.terminal, s.depTime)) {
    const w = R.TERMINAL_HOURS[s.terminal];
    errors.push(`${s.terminal} 출발 ${s.depTime}은 이용 가능 시간대(${w[0]}~${w[1]}, 데모 값) 밖이에요. 다른 항공편으로 알려 주세요.`);
    s.flightId = null; s.flightKey = null; s.flightSource = null; s.terminal = null; s.depTime = null; s.airport = null;
  }
}

function blockedMessage(s) {
  if (s.checkUs === true) return '이용이 어렵습니다. 항공사에 문의해 주세요. (미주 노선은 홈드랍을 쓸 수 없어요 — 홈드랍 데모 규칙, 데모 값) 잘못 답했다면 「미주 노선 아니에요」라고 알려 주세요.';
  if (s.checkUm === true) return '이용이 어렵습니다. 항공사에 문의해 주세요. (어린이 혼자 탑승(UM)은 항공사 카운터 방문이 필요해요 — 홈드랍 데모 규칙, 데모 값)';
  return null;
}

const CONGEST = /혼잡|붐[비벼빌]|사람\s?많|한산|몰리|피크|시간대/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 만 받아요' });
  const body = req.body || {};
  const text = String(body.message || '').trim().slice(0, 500);
  const history = (Array.isArray(body.history) ? body.history : []).slice(-6).map(h => ({ role: h.role === 'user' ? 'user' : 'bot', text: String(h.text || '').slice(0, 300) }));
  if (!text) return res.status(400).json({ error: '메시지가 비어 있어요' });

  let state = cleanState(body.state);
  const resetNow = /^(__reset|처음부터|새 예약)/.test(text) || (state.step === 'done' && /짐\s?맡|예약/.test(text));
  if (resetNow) state = emptyState();
  const s = state.slots;
  const errors = [], notes = [], sources = [];
  const meta = { mode: 'AI', ai: null, flight: null };

  const group0 = pendingGroup(s);
  const docs = search(text, 3);
  let extra = '';
  if (CONGEST.test(text)) { const c = await pub.getCongestion(0); extra = pub.congestionText(c); meta.congestion = c.live ? '실시간' : `시연 값(${c.reason})`; }

  // 1) AI 로 이해하기 → 2) 안 되면 규칙 기반
  let u;
  const ai = await askAI(buildSystem(s, group0), buildUser(text, s, group0, history, docs, extra), parseJSON);
  if (ai.ok) { u = ai.data; meta.ai = { provider: ai.provider, model: ai.model, tried: ai.tried }; }
  else {
    meta.mode = '규칙 기반'; meta.ai = { provider: null, tried: ai.tried };
    u = ruleUnderstand(text, s, group0);
    if (u.intent === 'ask') { const a = ruleAnswer(text, docs, extra); u.answer = a.answer; u.sources = a.sources; }
  }

  if (resetNow && !/^__reset/.test(text)) u.intent = 'book';
  // 반영
  const wasActive = state.step !== 'idle';
  const before = applyUpdates(s, u.updates, errors);
  if (s.flightId !== before.flightId || s.flightDate !== before.flightDate) {
    if (s.flightSource === '시연 값' || s.flightSource === '실시간') { s.terminal = (u.updates.terminal ? s.terminal : null); s.depTime = (u.updates.depTime ? s.depTime : null); s.airport = null; s.flightSource = null; s.flightKey = null; }
  }
  if (s.flightId && s.flightDate) await resolveFlight(s, errors, notes, sources, meta);

  const changed = Object.keys(u.updates).length > 0;
  const started = wasActive || u.intent === 'book' || changed;
  if (started && state.step === 'idle') state.step = 'collect';

  // 예약 확정
  let reservation = null, replyParts = [];
  const group = pendingGroup(s);
  const blocked = blockedMessage(s);
  if (u.answer) {
    replyParts.push(u.answer);
    const names = [];
    for (const n of u.sources || []) {
      if (/승객예고/.test(n)) names.push('승객예고 API');
      else if (/운항/.test(n)) names.push('여객편 주간 운항 현황 API');
      else { const d = docs.find(x => n.includes(x.name) || x.name.includes(n)); if (d) names.push(d.name); else if (/데모/.test(n)) names.push(DEMO_DOC); }
    }
    if (!names.length) names.push(...docs.slice(0, 1).map(d => d.name));
    sources.push(...names);
  }
  if (errors.length) replyParts.unshift(errors.join('\n'));
  if (notes.length) replyParts.push(notes.join('\n'));

  if (blocked) {
    replyParts.push(blocked); sources.push(DEMO_DOC);
  } else if (state.step === 'done') {
    if (!u.answer) replyParts.push('예약은 이미 완료됐어요. 새로 예약하려면 「새 예약」이라고 말해 주세요.');
  } else if (state.step === 'collect') {
    if (group === 'confirm' && u.intent === 'yes' && !changed && wasActive && group0 === 'confirm') {
      const rec = store.create({
        name: s.name, phone: s.phone, address: s.address, district: s.district, region: s.region,
        flightId: s.flightId, flightDate: s.flightDate, terminal: s.terminal, depTime: s.depTime, airport: s.airport || '',
        bags: s.bags, large: s.large, party: s.party, price: R.price(s.bags, s.large), pickupDate: pickupDate(s), pickupHour: s.pickupHour,
      });
      reservation = rec; state.step = 'done';
      replyParts.push(`예약이 완료됐어요! 태그 번호는 ${rec.tag}예요. ${korDate(rec.pickupDate)} ${R.hourLabel(R.slotStart(rec.pickupHour))}~${R.hourLabel(R.slotStart(rec.pickupHour) + 2)} 사이에 수거하고, 수거 30분 전에 기사님이 연락드려요. 요금 ${won(rec.price)}은 데모 값이에요.`);
      if (rec.voucher) replyParts.push(`공항버스 가족 할인권도 발급했어요! 할인권 번호 ${rec.voucher.code} · 왕복 모두 1인 ${won(rec.voucher.fare)} → ${won(rec.voucher.discounted)} (${rec.voucher.rate}% 할인 · ${R.BUS_RATE_NOTE}) · ${rec.party}명이 쓸 수 있어요. 가는 길은 ${korDate(rec.voucher.validDate)} 출발일 당일(집 → 인천공항), 오는 길은 ${korDate(rec.voucher.returnUntil)}까지 귀국할 때 한 번(인천공항 → 집) 쓸 수 있어요. 모두 데모 값이에요.`);
      else replyParts.push('공항버스 가족 할인권은 함께 가는 인원이 3명 이상일 때 발급해요(데모 규칙). 이번 예약은 해당하지 않아요.');
      sources.push(DEMO_DOC);
    } else if (group === 'confirm' && u.intent === 'no' && group0 === 'confirm' && !changed) {
      replyParts.push('바꿀 내용을 말씀해 주세요. (예: 캐리어 3개로 바꿔 주세요 / 수거는 오후 4시로)');
      replyParts.push('');
    } else {
      const p = promptFor(group, s);
      if (group === 'bags' || group === 'large' || group === 'party' || group === 'confirm') sources.push(DEMO_DOC);
      replyParts.push(p.text); meta.quick = p.quick;
    }
  } else if (!u.answer) {
    replyParts.push('안녕하세요! 홈드랍 예약·안내 챗봇이에요. 집에서 캐리어를 수거해 공항까지 보내 드려요(데모). 「짐 맡기고 싶어요」라고 말하면 예약을 시작하고, 요금·금지 물품·수거 시간도 물어볼 수 있어요.');
    meta.quick = ['짐 맡기고 싶어요', '요금이 얼마예요?', '넣으면 안 되는 물건은?', '언제 수거하러 오나요?'];
  } else {
    meta.quick = ['짐 맡기고 싶어요'];
  }
  if (state.step === 'done') meta.quick = meta.quick || ['새 예약'];
  if (blocked) meta.quick = ['처음부터 다시'];

  let reply = replyParts.filter(x => x !== '').join('\n\n');
  if (u.answer && sources.includes(DEMO_DOC) && !/데모/.test(reply)) reply += '\n\n(홈드랍 데모 규칙의 값은 데모 값이에요.)';
  res.status(200).json({
    reply,
    state, quick: meta.quick || [], sources: [...new Set(sources)],
    meta: { mode: meta.mode, ai: meta.ai, flight: meta.flight, congestion: meta.congestion || null },
    reservation,
  });
};
