// 홈드랍 데모 규칙 (docs/답변참고문서/청킹/홈드랍_데모규칙_*.md 와 같은 값). 모두 「데모 값」
const { today, addDays, diffDays } = require('./_util');

const MAX_BAGS_PER_BOOKING = 8;
const MAX_BAGS_PER_VEHICLE = 40;

// 서울 25개 구 → 5개 생활권역 (데모 값)
const REGIONS = {
  도심: ['종로구', '중구', '용산구'],
  동북: ['성북구', '강북구', '도봉구', '노원구', '동대문구', '중랑구', '성동구', '광진구'],
  동남: ['강남구', '서초구', '송파구', '강동구'],
  서북: ['은평구', '서대문구', '마포구'],
  서남: ['강서구', '양천구', '영등포구', '구로구', '금천구', '동작구', '관악구'],
};
const DISTRICTS = Object.entries(REGIONS).flatMap(([region, list]) => list.map(d => [d, region]));

// 경기도 31개 시·군 → 4개 생활권역 (데모 값). 시·군 이름(시/군 포함)을 district 로 쓴다
const GG_REGIONS = {
  경기북부: ['고양시', '파주시', '의정부시', '양주시', '동두천시', '포천시', '연천군', '가평군'],
  경기동부: ['구리시', '남양주시', '하남시', '광주시', '양평군', '여주시', '이천시'],
  경기남부: ['수원시', '성남시', '용인시', '오산시', '화성시', '평택시', '안성시'],
  경기서부: ['부천시', '광명시', '시흥시', '안산시', '군포시', '의왕시', '과천시', '안양시', '김포시'],
};
const GG_CITIES = Object.entries(GG_REGIONS).flatMap(([region, list]) => list.map(d => [d, region]));
const OTHER_AREA = /(인천|부산|대구|대전|광주광역|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)/;

function findGyeonggi(a) {
  const hasGG = /경기/.test(a);
  for (const [d, region] of GG_CITIES) if (a.includes(d)) return { district: d, region };
  if (hasGG) for (const [d, region] of GG_CITIES) { const bare = d.slice(0, -1); if (a.includes(bare)) return { district: d, region }; }
  return null;
}
function findSeoul(a) {
  for (const [d, region] of DISTRICTS) if (a.includes(d)) return { district: d, region };
  for (const [d, region] of DISTRICTS) {
    const bare = d.slice(0, -1);
    if (bare.length >= 2 && a.includes(bare)) return { district: d, region };
  }
  return null;
}
// 서울 구 또는 경기도 시·군을 찾는다. 인천·부산 같은 다른 지역 주소는 구 이름이 같아도(예: 인천 중구) 받지 않는다
function findDistrict(address) {
  const a = String(address || '');
  const seoul = /서울/.test(a), gg = /경기/.test(a);
  if (OTHER_AREA.test(a) && !seoul && !gg) return null;
  if (seoul) return findSeoul(a) || findGyeonggi(a);
  return findGyeonggi(a) || findSeoul(a);
}
// 서비스 지역 밖 안내용 (서울·경기 밖의 지역 이름)
const OUT_OF_AREA = OTHER_AREA;

function price(bags, large = 0) {
  if (!bags || bags < 1) return 0;
  return 20000 + (bags - 1) * 10000 + large * 5000;
}
const PRICE_TABLE = Array.from({ length: 8 }, (_, i) => `${i + 1}개 ${price(i + 1).toLocaleString('ko-KR')}원`).join(', ');

// 터미널별 이용 가능한 출발 시간대
const TERMINAL_HOURS = { T1: ['11:00', '23:00'], T2: ['10:00', '22:00'] };
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const inServiceHours = (terminal, depTime) => {
  const w = TERMINAL_HOURS[terminal];
  return !w || !depTime || (toMin(depTime) >= toMin(w[0]) && toMin(depTime) <= toMin(w[1]));
};

// 출발일 규칙: 항공편 조회는 오늘~6일 뒤, 예약은 출발 2일 전까지 → 출발일은 오늘+2 ~ 오늘+6
function checkFlightDate(date) {
  const diff = diffDays(date, today());
  if (diff < 0 || diff > 6) return { ok: false, code: 'range' };
  if (diff < 2) return { ok: false, code: 'deadline' };
  return { ok: true };
}
const bookableRange = () => [addDays(today(), 2), addDays(today(), 6)];

// 수거 시각: 출발 전날 오전 8시~오후 8시, 2시간 단위
const PICKUP_START = 8, PICKUP_END = 20;
const slotStart = h => PICKUP_START + 2 * Math.floor((h - PICKUP_START) / 2);
const slotLabel = h => `${String(h).padStart(2, '0')}:00~${String(h + 2).padStart(2, '0')}:00`;
const pickupOk = h => Number.isInteger(h) && h >= PICKUP_START && h < PICKUP_END;
const hourLabel = h => `${h < 12 ? '오전' : '오후'} ${h <= 12 ? h : h - 12}시`;

// 미주 노선 공항 코드 (항공편 API로 도착지를 알 수 있을 때 자동 확인)
const US_AIRPORTS = new Set('LAX SFO JFK EWR SEA ATL ORD DFW IAD BOS HNL GUM SPN YVR YYZ YUL YYC DTW IAH LAS ONT SAN PDX MSP DEN PHX ANC PHL MIA CLT SLC KOA OGG SJC LGA DCA'.split(' '));

// 공항버스 가족 할인권 (데모 값): 동반 3명 이상, 왕복(가는 길 + 오는 길), 1인 편도 기준 요금 18,000원의 70%
// 70% 는 시행 초기 이용을 늘리기 위한 이벤트 할인율 (정책 제안 시안)
const BUS_MIN_PARTY = 3, BUS_FARE = 18000, BUS_RATE = 70, BUS_RATE_NOTE = '시행 초기 이벤트', MAX_PARTY = 10, BUS_RETURN_DAYS = 30;
const busEligible = party => Number.isInteger(party) && party >= BUS_MIN_PARTY;
function voucherFor(party, tag, flightDate) {
  if (!busEligible(party)) return null;
  const discounted = Math.round(BUS_FARE * (100 - BUS_RATE) / 100);
  const returnUntil = addDays(flightDate, BUS_RETURN_DAYS);
  return {
    code: `BUS-${tag}`, party, rate: BUS_RATE, fare: BUS_FARE, discounted, trips: 2,
    saving: (BUS_FARE - discounted) * party * 2, validDate: flightDate, returnUntil,
    route: '왕복 공항버스 (가는 길: 집 → 인천공항, 오는 길: 인천공항 → 집)', demo: true,
  };
}

const STATUS = ['접수', '배차 완료', '수거 완료', '공항 인도'];

const PROHIBITED = [
  '직접 휴대: 보조배터리·전자담배는 위탁수하물에 넣을 수 없어요(아시아나항공 기준). 라이터는 문서에 없어 확인 필요이니 항공보안365에서 물품명으로 검색해 주세요.',
  '귀중품: 현금·귀금속·노트북 등',
  '위험물: 가스·인화성 물질',
  '운송이 어려운 것: 전동 휠체어, 고가 악기(이지드랍 QA 기준)',
];

module.exports = {
  MAX_BAGS_PER_BOOKING, MAX_BAGS_PER_VEHICLE, REGIONS, GG_REGIONS, findDistrict, OUT_OF_AREA, price, PRICE_TABLE,
  TERMINAL_HOURS, inServiceHours, checkFlightDate, bookableRange, slotStart, slotLabel, pickupOk, hourLabel,
  US_AIRPORTS, STATUS, PROHIBITED, BUS_MIN_PARTY, BUS_FARE, BUS_RATE, BUS_RATE_NOTE, MAX_PARTY, BUS_RETURN_DAYS, busEligible, voucherFor,
};
