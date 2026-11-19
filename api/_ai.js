// AI 는 CLAUDE_API_KEY → GROQ_API_KEY → GEMINI_API_KEY 순서로 부른다.
// 앞이 실패하면(키 비어 있음 · 오류 · 시간 초과) 다음으로 넘어가고, 어느 AI 가 답했는지 돌려준다.
const { fetchT, isTimeout } = require('./_util');

const TIMEOUT = 15000;
// 모델 이름은 키로 모델 목록을 조회해 정한다. 목록에 있는 것 중 앞의 것을 쓴다.
const PREFER = {
  claude: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  // gemini-2.5-flash 는 목록에는 있지만 신규 키에는 404 라서 뺐다
  gemini: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash'],
};
const KEYS = { claude: 'CLAUDE_API_KEY', groq: 'GROQ_API_KEY', gemini: 'GEMINI_API_KEY' };
const LABEL = { claude: 'Claude', groq: 'Groq', gemini: 'Gemini' };

const modelCache = {};
const last = { provider: null, model: null, at: null, tried: [] };

async function listModels(p, key) {
  if (p === 'claude') {
    const r = await fetchT('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }, 10000);
    if (!r.ok) throw new Error('모델 목록 ' + r.status);
    return (await r.json()).data.map(x => x.id);
  }
  if (p === 'groq') {
    const r = await fetchT('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + key } }, 10000);
    if (!r.ok) throw new Error('모델 목록 ' + r.status);
    return (await r.json()).data.map(x => x.id);
  }
  const r = await fetchT('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': key } }, 10000);
  if (!r.ok) throw new Error('모델 목록 ' + r.status);
  return (await r.json()).models.filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace('models/', ''));
}
// 목록에 있는 선호 모델을 앞에서부터 최대 2개 (목록에 있어도 404 일 수 있어 하나가 막히면 다음 모델을 쓴다)
async function pickModels(p, key) {
  const c = modelCache[p];
  if (c && Date.now() - c.at < 3600e3) return c.models;
  let models = PREFER[p].slice(0, 2);
  try {
    const ids = await listModels(p, key);
    const found = PREFER[p].filter(m => ids.includes(m));
    if (found.length) models = found.slice(0, 2);
  } catch { /* 목록 조회가 안 되면 기본 이름으로 시도 */ }
  modelCache[p] = { at: Date.now(), models };
  return models;
}

const RUN = {
  async claude(key, model, system, user) {
    const r = await fetchT('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 900, system, messages: [{ role: 'user', content: user }] }),
    }, TIMEOUT);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || 'HTTP ' + r.status), { status: r.status });
    return (j.content || []).map(c => c.text || '').join('');
  },
  async groq(key, model, system, user) {
    const r = await fetchT('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_completion_tokens: 1800, reasoning_effort: 'low', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    }, TIMEOUT);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || 'HTTP ' + r.status), { status: r.status });
    return j.choices[0].message.content || '';
  },
  async gemini(key, model, system, user) {
    const r = await fetchT(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1500 } }),
    }, TIMEOUT);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || 'HTTP ' + r.status), { status: r.status });
    return ((j.candidates || [])[0] || {}).content.parts.map(p => p.text || '').join('');
  },
};

// parse(text) 가 객체를 돌려주면 성공. 던지면 그 AI 는 실패로 보고 다음으로 넘어간다.
async function askAI(system, user, parse) {
  const tried = [];
  for (const p of ['claude', 'groq', 'gemini']) {
    const key = process.env[KEYS[p]];
    if (!key) { tried.push({ provider: LABEL[p], ok: false, reason: '키 비어 있음' }); continue; }
    let models;
    try { models = await pickModels(p, key); } catch { models = PREFER[p].slice(0, 1); }
    for (const model of models) {
      try {
        const text = await RUN[p](key, model, system, user);
        const data = parse(text);
        tried.push({ provider: LABEL[p], model, ok: true });
        Object.assign(last, { provider: LABEL[p], model, at: new Date().toISOString(), tried });
        return { ok: true, data, provider: LABEL[p], model, tried };
      } catch (e) {
        const reason = isTimeout(e) ? '시간 초과' : e.status === 404 ? '모델 없음(404)' : e.status === 401 || e.status === 403 ? '키 거부됨' : e.status === 429 ? '한도 초과' : e.status === 503 ? '서버 혼잡(503)' : e.message.slice(0, 60);
        if (e.status === 404) delete modelCache[p]; // 404 → 모델 이름부터 의심
        tried.push({ provider: LABEL[p], model, ok: false, reason });
        if (e.status === 401 || e.status === 403) break; // 키 문제면 같은 키로 다른 모델을 시도해 봐야 소용없다
      }
    }
  }
  Object.assign(last, { provider: null, model: null, at: new Date().toISOString(), tried });
  return { ok: false, tried };
}

const keyStatus = () => Object.fromEntries(Object.entries(KEYS).map(([p, n]) => [n, process.env[n] ? '값 있음' : '비어 있음']));
module.exports = { askAI, last, keyStatus, KEYS };
