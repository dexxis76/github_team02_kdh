// 홍보 배너: public/banner/ 에 banner-1, banner-2 … (jpg·jpeg·webp·png) 를 넣으면 3초마다 넘어간다.
// 넘어갈 때 새 사진은 왼쪽에서 들어오고, 지금 사진은 오른쪽으로 밀려 나간다(왼쪽 → 오른쪽).
// 마우스를 올려도 멈추지 않는다. 사진이 하나도 없으면 배너는 숨겨지고 파란 소개 영역이 그대로 보인다.
(() => {
  const INTERVAL = 4000;
  const DURATION = 700; // 넘어가는 데 걸리는 시간(ms)
  const EXT = ['jpg', 'jpeg', 'webp', 'png'];
  const sec = document.getElementById('banner');
  if (!sec) return;

  let ratio = null; // 첫 사진의 가로:세로 비율에 배너 높이를 맞춘다 (글자가 잘리지 않게)
  const probe = src => new Promise(ok => {
    const i = new Image();
    i.onload = () => { if (!ratio) ratio = i.naturalWidth / i.naturalHeight; ok(src); };
    i.onerror = () => ok(null);
    i.src = src;
  });
  async function findSlides() {
    const found = [];
    for (let n = 1; n <= 8; n++) {
      let hit = null;
      for (const e of EXT) { hit = await probe(`/banner/banner-${n}.${e}`); if (hit) break; }
      if (!hit) break;
      found.push(hit);
    }
    return found;
  }

  findSlides().then(srcs => {
    if (!srcs.length) return;
    const track = document.getElementById('bTrack'), dots = document.getElementById('bDots');
    track.innerHTML = srcs.map((s, i) => `<a class="slide" href="#chat" role="group" aria-roledescription="slide" aria-label="${i + 1} / ${srcs.length}"><img src="${s}" alt="홈드랍 홍보 ${i + 1}" draggable="false"></a>`).join('');
    dots.innerHTML = srcs.map((_, i) => `<button type="button" role="tab" aria-label="${i + 1}번 배너" data-i="${i}"></button>`).join('');
    if (ratio) sec.style.setProperty('--ratio', ratio.toFixed(4));
    sec.hidden = false;
    document.getElementById('hero').hidden = true;

    const slides = [...track.querySelectorAll('.slide')];
    // 윈도우 「애니메이션 효과」가 꺼진 PC 에서도 넘김 모션이 보이도록 항상 움직인다 (요청 사항)
    const reduce = false;
    const ease = `transform ${DURATION}ms cubic-bezier(.4, 0, .2, 1)`;
    let cur = 0, timer = null, busy = false;

    // 처음: 첫 사진만 제자리(0), 나머지는 왼쪽 밖에서 대기
    slides.forEach((s, i) => { s.style.transition = 'none'; s.style.transform = i ? 'translateX(-100%)' : 'translateX(0)'; s.setAttribute('aria-hidden', i ? 'true' : 'false'); });
    const mark = () => dots.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-selected', k === cur ? 'true' : 'false'));
    mark();

    // dir = +1 : 왼쪽 → 오른쪽 (새 사진이 왼쪽에서 들어옴), -1 : 반대
    function go(next, dir = 1) {
      next = (next + slides.length) % slides.length;
      if (next === cur || busy) return;
      busy = true;
      const a = slides[cur], b = slides[next];
      b.style.transition = 'none';
      b.style.transform = `translateX(${-dir * 100}%)`;
      b.offsetWidth; // 시작 위치를 먼저 그리게 한다
      a.style.transition = ease; b.style.transition = ease;
      a.style.transform = `translateX(${dir * 100}%)`;
      b.style.transform = 'translateX(0)';
      a.setAttribute('aria-hidden', 'true'); b.setAttribute('aria-hidden', 'false');
      cur = next; mark();
      setTimeout(() => { busy = false; }, reduce ? 0 : DURATION);
    }

    const stop = () => { clearInterval(timer); timer = null; };
    // 항상 3초마다 넘긴다. 화살표·점을 누르면 그 사진에서 3초를 다시 센다. 브라우저 탭이 숨겨졌을 때만 쉰다.
    const start = () => { stop(); if (slides.length > 1 && !document.hidden) timer = setInterval(() => go(cur + 1, 1), INTERVAL); };

    document.getElementById('bNext').onclick = () => { go(cur + 1, 1); start(); };
    document.getElementById('bPrev').onclick = () => { go(cur - 1, -1); start(); };
    dots.onclick = e => { const b = e.target.closest('button'); if (b) { const i = Number(b.dataset.i); go(i, i > cur ? 1 : -1); start(); } };
    document.addEventListener('visibilitychange', start);

    // 손가락으로 밀기: 오른쪽으로 밀면 다음(왼쪽 → 오른쪽), 왼쪽으로 밀면 이전
    let x0 = null;
    sec.addEventListener('pointerdown', e => { x0 = e.clientX; });
    sec.addEventListener('pointerup', e => {
      if (x0 != null && Math.abs(e.clientX - x0) > 50) { e.clientX > x0 ? go(cur + 1, 1) : go(cur - 1, -1); start(); }
      x0 = null;
    });
    sec.addEventListener('click', e => { if (e.target.closest('.b-arrow, .b-dots')) e.preventDefault(); });

    if (slides.length < 2) sec.classList.add('single');
    start();
  });
})();
