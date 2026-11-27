// 수거 차량 12대(1~12호차)의 기본 담당 구역. 이 파일만 고치면 기본 구역이 바뀐다(바꾼 뒤 python3 tools/build-zones.py 로 지도 외곽선도 갱신). 모두 데모 값.
// 만든 방법: 서울 25개 구·경기도 31개 시·군을 ①실제로 맞닿은 지역끼리 이어지고 ②지리적으로 뭉치게, ③작업량이 12대에 비슷하도록 계산했다.
// 작업량 = 인구 어림값(예약이 인구에 비례한다는 가정) × (5.5 + 공항까지 직선거리 4km당 1). 멀수록 이동 시간이 길어 한 곳당 부담이 크므로
// 먼 지역은 작게, 가까운 지역은 크게 묶인다. 호차별 약 7~9퍼센트(최대/최소 약 1.3배).
// 실제 수요 데이터가 아니라서 운영하면서 예약이 쌓이면 다시 계산하는 게 좋다.
// 실제 예약이 몰려 한 호차에 일이 쏠리면 배차 때 이웃 호차로 일부를 넘긴다(_store.js 의 dispatch).
const ZONES = [
  { car: 1, name: '고양권', color: '#8b5cf6',
    districts: ['고양시', '파주시', '김포시'] },
  { car: 2, name: '부천권', color: '#0ea5e9',
    districts: ['양천구', '구로구', '부천시', '시흥시', '광명시'] },
  { car: 3, name: '강서권', color: '#f97316',
    districts: ['종로구', '은평구', '서대문구', '마포구', '강서구', '영등포구'] },
  { car: 4, name: '수원권', color: '#ec4899',
    districts: ['수원시', '안산시', '군포시', '의왕시'] },
  { car: 5, name: '안양권', color: '#14b8a6',
    districts: ['서초구', '금천구', '동작구', '관악구', '안양시', '과천시'] },
  { car: 6, name: '강남권', color: '#84cc16',
    districts: ['중구', '용산구', '성동구', '광진구', '강남구', '강동구'] },
  { car: 7, name: '성북권', color: '#eab308',
    districts: ['성북구', '강북구', '도봉구', '동대문구', '중랑구', '구리시'] },
  { car: 8, name: '화성권', color: '#6366f1',
    districts: ['화성시', '평택시', '오산시', '안성시'] },
  { car: 9, name: '노원권', color: '#ef4444',
    districts: ['노원구', '의정부시', '양주시', '포천시', '동두천시', '가평군', '연천군'] },
  { car: 10, name: '남양주권', color: '#06b6d4',
    districts: ['송파구', '남양주시', '하남시'] },
  { car: 11, name: '성남권', color: '#a16207',
    districts: ['성남시', '광주시', '양평군'] },
  { car: 12, name: '용인권', color: '#64748b',
    districts: ['용인시', '이천시', '여주시'] },
];
const OF = {};
for (const z of ZONES) for (const d of z.districts) OF[d] = z;

const zoneOf = district => OF[district] || null; // 구역 밖(또는 모르는 지역)이면 null
module.exports = { ZONES, zoneOf };
