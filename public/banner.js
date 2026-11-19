// 홍보 배너: public/banner/ 에 banner-1.jpg, banner-2.jpg … 를 넣으면 마우스를 올려도 멈추지 않고 3초마다 옆으로 넘어간다.
// 사진이 하나도 없으면 배너는 숨겨지고 파란 소개 영역이 그대로 보인다.
(() => {
  const INTERVAL = 3000;
  const EXT = ['jpg', 'jpeg', 'webp', 'png'];
  const sec = document.getElementById('banner');
  if (!sec) return;

  let ratio = null; // 첫 사진의 가로:세로 비율에 배너 높이를 맞춘다 (글자가 잘리지 않게)
  const probe = src => new Promise(ok => { const i = new Image(); i.onload = () => { if (!ratio) ratio = i.naturalWidth / i.naturalHeight; ok(src); }; i.onerror = () => ok(null); i.src = src; });
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

  findSlides().then(slides => {
    if (!slides.length) return;
    const track = document.getElementById('bTrack'), dots = document.getElementById('bDots');
    track.innerHTML = slides.map((s, i) => `<a class="slide" href="#chat" role="group" aria-roledescription="slide" aria-label="${i + 1} / ${slides.length}"><img src="${s}" alt="홈드랍 홍보 ${i + 1}" ${i ? 'loading="lazy"' : ''} draggable="false"></a>`).join('');
    dots.innerHTML = slides.map((_, i) => `<button type="button" role="tab" aria-label="${i + 1}번 배너" data-i="${i}"></button>`).join('');
    if (ratio) sec.style.setProperty('--ratio', ratio.toFixed(4));
    sec.hidden = false;
    document.getElementById('hero').hidden = true;

    let cur = 0, timer = null;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const go = i => {
      cur = (i + slides.length) % slides.length;
      track.style.transform = `translateX(-${cur * 100}%)`;
      dots.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-selected', k === cur ? 'true' : 'false'));
    };
    const stop = () => { clearInterval(timer); timer = null; };
    // 「움직임 줄이기」 설정이 켜져 있으면 미끄러지는 효과만 끄고, 3초마다 바뀌는 것은 그대로 둔다
    if (reduce) track.style.transition = 'none';
    // 항상 3초마다 넘긴다. 화살표·점을 누르면 그 사진에서 3초를 다시 센다. 탭이 숨겨졌을 때만 쉰다.
    const start = () => { stop(); if (slides.length > 1 && !document.hidden) timer = setInterval(() => go(cur + 1), INTERVAL); };

    document.getElementById('bPrev').onclick = () => { go(cur - 1); start(); };
    document.getElementById('bNext').onclick = () => { go(cur + 1); start(); };
    dots.onclick = e => { const b = e.target.closest('button'); if (b) { go(Number(b.dataset.i)); start(); } };
    document.addEventListener('visibilitychange', start);

    // 손가락으로 밀어서 넘기기
    let x0 = null;
    sec.addEventListener('pointerdown', e => { x0 = e.clientX; });
    sec.addEventListener('pointerup', e => { if (x0 != null && Math.abs(e.clientX - x0) > 50) { go(cur + (e.clientX < x0 ? 1 : -1)); start(); } x0 = null; });
    sec.addEventListener('click', e => { if (e.target.closest('.b-arrow, .b-dots')) e.preventDefault(); });

    if (slides.length < 2) sec.classList.add('single');
    go(0); start();
  });
})();
