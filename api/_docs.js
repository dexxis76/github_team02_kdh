// docs/답변참고문서/청킹 만 읽는다 (원본·청킹전은 읽지 않는다)
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'docs', '답변참고문서', '청킹');
let CHUNKS = null;

function load() {
  if (CHUNKS) return CHUNKS;
  CHUNKS = [];
  let files = [];
  try { files = fs.readdirSync(DIR).filter(f => f.endsWith('.md')); } catch { /* 폴더가 없으면 빈 목록 */ }
  for (const f of files) {
    const raw = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r/g, '');
    const lines = raw.split('\n');
    const head = (lines[0] || '').replace(/^출처:\s*/, '');
    const [docPart, secPart] = head.split(' · ');
    const name = (docPart || f).replace(/^#+\s*/, '').trim();
    const section = (secPart || '').replace(/^#+\s*/, '').trim();
    const kw = (lines[1] || '').replace(/^키워드:\s*/, '');
    const body = lines.slice(2).join('\n').trim();
    CHUNKS.push({ file: f, name, section, kw, body });
  }
  return CHUNKS;
}

const grams = s => {
  const t = String(s).replace(/[^가-힣A-Za-z0-9]/g, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2).toLowerCase());
  return out;
};

// 이지드랍 요금은 고객이 물었을 때만 쓴다
function search(query, k = 3) {
  const q = grams(query);
  if (!q.size) return [];
  const asksFee = /요금|가격|얼마|비용|돈/.test(query);
  const asksEz = /이지\s?드랍/.test(query);
  const scored = [];
  for (const c of load()) {
    if (asksFee && !asksEz && /요금과대상|초과요금|삼성역/.test(c.file)) continue;
    const kw = grams(c.kw), ti = grams(c.name + c.section), bo = grams(c.body.slice(0, 1500));
    let s = 0;
    for (const g of q) s += (kw.has(g) ? 3 : 0) + (ti.has(g) ? 2 : 0) + (bo.has(g) ? 1 : 0);
    if (s > 0) scored.push({ s, c });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map(({ c }) => ({
    name: c.name, section: c.section, file: c.file, text: c.body.length > 800 ? c.body.slice(0, 800) + '…' : c.body,
  }));
}

const count = () => load().length;
module.exports = { search, count };
