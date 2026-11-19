/**
 * 수학 농장 · 서버 (GitHub + Render)
 *
 * 필요한 환경 변수 (Render → Environment)
 *   TEACHER_PASSWORD   선생님 로그인 비밀번호 (꼭 정하기)
 *   SESSION_SECRET     로그인 유지용 비밀 문자열 (Render 에서 'Generate' 로 아무 값이나)
 *   FIREBASE_KEY       Firebase 서비스 계정 키(JSON) 내용 전체. 없으면 data/store.json 파일에 저장
 *   TEACHER_NAME       (선택) 선생님 이름. 기본 '선생님'
 */
const express = require('express');
const compression = require('compression');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Store = require('./store');
const createGame = require('./game');

const PORT = process.env.PORT || 3000;
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || '';
const TEACHER_NAME = process.env.TEACHER_NAME || '선생님';
const SECRET = process.env.SESSION_SECRET || ('mf-' + TEACHER_PASSWORD + '-secret');
const PUB = path.join(__dirname, 'public');

/* ---------- 설정 · 문제 파일 읽기 (Apps Script 파일을 그대로 넣어도 돼요) ---------- */
function loadSettings() {
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'settings.js'), 'utf8'), ctx, { filename: 'settings.js' });
  return ctx;
}

function loadQuestions() {
  const dir = path.join(__dirname, 'questions');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(js|gs)$/i.test(f)).sort() : [];
  const out = [], seen = {}, warns = [];
  files.forEach(f => {
    const ctx = vm.createContext({ QBANK: [], console });
    try {
      vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
    } catch (e) {
      warns.push(f + ' 파일을 읽을 수 없어요: ' + e.message);
      return;
    }
    (ctx.QBANK || []).forEach(L => {
      if (!L || !L.id) { warns.push(f + ': id 가 없는 차시가 있어요'); return; }
      if (seen[L.id] !== undefined) { warns.push(f + ': "' + L.id + '" 차시가 다른 파일에도 있어서 이 파일 것으로 바꿨어요'); out[seen[L.id]] = L; return; }
      seen[L.id] = out.length;
      out.push(L);
    });
  });
  return { list: out, files, warns };
}

/* ---------- 로그인 쿠키 ---------- */
function sign(s) { return crypto.createHmac('sha256', SECRET).update(s).digest('base64url'); }
function pwOf(key) {
  if (key === 'teacher') return TEACHER_PASSWORD;
  const s = store.getRoster().find(x => game.keyOf(x.no) === key);
  return s ? String(s.pw) : null;
}
function makeToken(key) {
  const pw = pwOf(key);
  return Buffer.from(key).toString('base64url') + '.' + sign(key + '|' + pw);
}
function readCookie(req, name) {
  const h = req.headers.cookie || '';
  const m = h.split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
/** 쿠키 → 로그인한 진짜 사람 (비밀번호를 바꾸면 그 학생은 다시 로그인해야 해요) */
function realMe(req) {
  const t = readCookie(req, 'mf');
  if (!t || t.indexOf('.') < 0) return null;
  const [k64, sig] = t.split('.');
  let key;
  try { key = Buffer.from(k64, 'base64url').toString(); } catch (e) { return null; }
  const pw = pwOf(key);
  if (!pw) return null;
  const good = sign(key + '|' + pw);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  if (key === 'teacher') return { key: 'teacher', email: 'teacher', name: TEACHER_NAME, teacher: true };
  const s = store.getRoster().find(x => game.keyOf(x.no) === key);
  return { key, email: key, name: s.name, no: s.no, teacher: false };
}
function setCookie(req, res, val, maxAge, name) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const c = (name || 'mf') + '=' + encodeURIComponent(val) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secure ? '; Secure' : '');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}
/** 선생님이 /admin 에서 '이 학생으로 보기'를 눌렀을 때만 학생으로 접속 (쿠키 mf_as, 2시간) */
const AS_TTL = 60 * 60 * 2;
/** 누구로 보일지: 진짜 선생님 + mf_as 쿠키가 있을 때만 그 학생. 학생이 mf_as 를 만들어 넣어도 무시돼요 */
function whoAmI(req) {
  const me = realMe(req);
  if (!me || !me.teacher) return me;
  const k = readCookie(req, 'mf_as');
  if (!k) return me;
  const s = store.getRoster().find(x => game.keyOf(x.no) === k);
  if (!s) return me;
  return { key: k, email: k, name: s.name, no: s.no, teacher: false, viaTeacher: true };
}

/* ---------- 화면 만들기: Apps Script 의 index + include 를 한 장으로 ---------- */
let PAGE = null;
function buildPage() {
  const idx = path.join(PUB, 'index.html');
  if (!fs.existsSync(idx)) return null;
  let html = fs.readFileSync(idx, 'utf8');
  const missing = [];
  html = html.replace(/<\?!=\s*include\(\s*['"]([\w\-]+)['"]\s*\)\s*;?\s*\?>/g, (m, name) => {
    const f = path.join(PUB, name + '.html');
    if (!fs.existsSync(f)) { missing.push(name + '.html'); return '<!-- ' + name + '.html 이 없어요 -->'; }
    return fs.readFileSync(f, 'utf8');
  });
  if (missing.length) console.warn('[주의] public 폴더에 없는 파일:', missing.join(', '));
  html = html.replace(/<\?!=\s*bootJson\s*\?>/, '__BOOT_JSON__');
  // Apps Script 가 붙여 주던 것들 + google.script.run 대신 서버를 부르는 net.js
  const headAdd = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">' +
    (/<title>/i.test(html) ? '' : '<title>수학 농장</title>') +
    '<script src="/net.js"></script>';
  html = /<head>/i.test(html) ? html.replace(/<head>/i, '<head>' + headAdd) : headAdd + html;
  html = html.replace('구글 계정으로 자동 로그인됐어요', '로그인됐어요');
  return { html, missing };
}

function bootJson(boot) {
  return JSON.stringify(boot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/* ---------- 옛 Apps Script 시트 붙여 넣기 → 서버 데이터 ---------- */
function parseTsv(text) {
  return String(text || '').split(/\r?\n/).filter(l => l.trim()).map(l => l.split('\t'));
}
function parseJsonCell(s) {
  s = String(s || '').trim();
  try { return JSON.parse(s); } catch (e) {}
  if (s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s.slice(1, -1).replace(/""/g, '"')); } catch (e) {}
  }
  return null;
}
function doImport(body) {
  const roster = store.getRoster();
  const byName = {};
  roster.forEach(s => { (byName[s.name] = byName[s.name] || []).push(s); });
  const mailToKey = {}, report = { farms: 0, logs: 0, settings: 0, skipped: [] };

  parseTsv(body.farms).forEach(cols => {
    const email = String(cols[0] || '').trim().toLowerCase();
    if (!email || email === '이메일') return;
    const F = parseJsonCell(cols[1]);
    const name = String(cols[2] || '').trim();
    if (!F) { report.skipped.push((name || email) + ' (농장 데이터를 읽을 수 없음)'); return; }
    const nm = name || (F.name || '').replace(/의 농장$/, '');
    if (!byName[nm] && (nm === TEACHER_NAME || nm === '선생님')) {
      mailToKey[email] = 'teacher';
      game.importFarm_('teacher', F, TEACHER_NAME);
      report.farms++;
      return;
    }
    const hit = byName[nm];
    if (!hit) { report.skipped.push(nm + ' (명단에 없는 이름)'); return; }
    if (hit.length > 1) { report.skipped.push(nm + ' (명단에 같은 이름이 둘 이상)'); return; }
    const key = game.keyOf(hit[0].no);
    mailToKey[email] = key;
    game.importFarm_(key, F, hit[0].name);
    report.farms++;
  });

  parseTsv(body.settings).forEach(cols => {
    const k = String(cols[0] || '').trim();
    if (!k || k === '항목') return;
    store.setSetting(k, String(cols[1] || '').trim());
    report.settings++;
  });

  const logRows = [];
  parseTsv(body.logs).forEach(cols => {
    if (cols.length < 11 || cols[0] === '시각') return;
    const email = String(cols[1] || '').trim().toLowerCase();
    let key = mailToKey[email];
    if (!key) { const h = byName[String(cols[2] || '').trim()]; if (h && h.length === 1) key = game.keyOf(h[0].no); }
    if (!key && String(cols[3]) !== '교사') return;
    logRows.push([cols[0], key || 'teacher', cols[2], cols[3], cols[4], Number(cols[5]), cols[6], cols[7], cols[8], cols[9], Number(cols[10]) || 1, cols[11] || '']);
  });
  if (logRows.length) {
    if (body.replaceLogs) store.filterLogs(() => false);
    for (let i = 0; i < logRows.length; i += 400) store.appendLogs(logRows.slice(i, i + 400));
    report.logs = logRows.length;
  }
  return report;
}

/* ---------- 시작 ---------- */
const store = new Store();
let game;
const recent = new Map();   // 같은 요청을 두 번 받으면(인터넷이 끊겨 다시 보낸 경우) 처음 결과를 그대로 돌려줘요
const fails = new Map();    // 비밀번호를 여러 번 틀리면 잠깐 막기

async function main() {
  await store.init();
  const S = loadSettings();
  game = createGame(S, store);
  const Q = loadQuestions();
  game.setQuestions(Q.list);
  console.log('저장 방식:', store.mode, '| 학생', store.getRoster().length, '명 | 농장', store.farmKeys().length, '개');
  console.log('문제 파일:', Q.files.join(', ') || '(없음)', '→ 차시', Q.list.length, '개');
  Q.warns.forEach(w => console.warn('[문제 파일]', w));
  try { game.checkQuestionBank_(); } catch (e) { console.warn(e.message); }
  if (!TEACHER_PASSWORD) console.warn('[주의] TEACHER_PASSWORD 환경 변수가 없어서 선생님 로그인이 안 돼요.');
  PAGE = buildPage();
  if (!PAGE) console.warn('[주의] public/index.html 이 없어요. Apps Script 의 HTML 파일을 public 폴더에 넣어 주세요.');

  const app = express();
  app.set('trust proxy', 1);
  app.use(compression());
  app.use(express.json({ limit: '3mb' }));

  app.get('/healthz', (req, res) => res.send('ok'));
  app.get('/net.js', (req, res) => { res.set('Cache-Control', 'public, max-age=300'); res.sendFile(path.join(PUB, 'net.js')); });

  /* 첫 화면: 로그인했으면 농장, 아니면 로그인 화면 */
  app.get('/', (req, res) => {
    const me = whoAmI(req);
    if (!me) return res.redirect('/login');
    if (!PAGE) return res.status(500).send('public/index.html 이 없어요. 설치 안내를 확인해 주세요.');
    let boot;
    try { boot = game.buildBoot_(me); } catch (e) { boot = { error: String(e && e.message || e) }; }
    res.set('Cache-Control', 'no-store');
    let html = PAGE.html.replace('__BOOT_JSON__', () => bootJson(boot));
    if (me.viaTeacher) {
      const bar = '<div style="position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#c0392b;color:#fff;padding:8px 12px;font:600 14px Pretendard,system-ui,sans-serif;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap">' +
        '👀 선생님 모드 · ' + String(me.name).replace(/[&<>"']/g, '') + ' 학생의 농장으로 접속 중이에요 (문제를 풀면 이 학생의 기록이 돼요)' +
        '<a href="/admin/exit-as" style="background:#fff;color:#c0392b;padding:5px 12px;border-radius:7px;text-decoration:none">선생님으로 돌아가기</a></div>';
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => bar + '</body>') : html + bar;
    }
    res.type('html').send(html);
  });

  app.get('/login', (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(PUB, 'login.html')); });

  app.post('/login', (req, res) => {
    const b = req.body || {};
    const key = b.role === 'teacher' ? 'teacher' : game.keyOf(String(b.no || '').trim());
    const f = fails.get(key);
    if (f && f.n >= 5 && Date.now() - f.t < 30000) return res.json({ ok: false, e: '여러 번 틀려서 30초 동안 쉬어요. 잠시 뒤에 다시 해 보세요.' });
    const pw = pwOf(key);
    if (b.role === 'teacher' && !pw) return res.json({ ok: false, e: '서버에 선생님 비밀번호(TEACHER_PASSWORD)가 아직 없어요.' });
    if (!pw || String(b.pw || '').trim() !== String(pw)) {
      fails.set(key, { n: (f && Date.now() - f.t < 30000 ? f.n : 0) + 1, t: Date.now() });
      return res.json({ ok: false, e: b.role === 'teacher' ? '비밀번호가 맞지 않아요.' : '번호나 비밀번호가 맞지 않아요.' });
    }
    fails.delete(key);
    setCookie(req, res, makeToken(key), 60 * 60 * 24 * 200);
    res.json({ ok: true });
  });

  app.get('/logout', (req, res) => { setCookie(req, res, '', 0); setCookie(req, res, '', 0, 'mf_as'); res.redirect('/login'); });

  /* google.script.run 대신 부르는 곳: POST /api/api_xxx  { args: [...], rid } */
  app.post('/api/:fn', (req, res) => {
    const me = whoAmI(req);
    if (!me) return res.status(401).json({ ok: false, e: '로그인이 풀렸어요. 새로고침해 주세요.' });
    const fn = game.API[req.params.fn];
    if (!fn) return res.json({ ok: false, e: '없는 기능이에요: ' + req.params.fn });
    const rid = me.key + ':' + String((req.body && req.body.rid) || '');
    if (req.body && req.body.rid && recent.has(rid)) return res.json(recent.get(rid));
    let out;
    try {
      const args = Array.isArray(req.body && req.body.args) ? req.body.args : [];
      out = { ok: true, r: fn(me, ...args) };
    } catch (e) {
      if (!(e instanceof game.UserError)) console.error('[오류]', req.params.fn, me.key, e);
      out = { ok: false, e: String(e && e.message || e) };
    }
    if (req.body && req.body.rid) {
      recent.set(rid, out);
      if (recent.size > 600) recent.delete(recent.keys().next().value);
    }
    res.json(out);
  });

  /* ---------- 선생님 관리 화면 (/admin) ---------- */
  function teacherGate(req, res, next) {
    const me = realMe(req);
    if (!me || !me.teacher) return res.status(401).json({ ok: false, e: '선생님으로 로그인해 주세요.' });
    next();
  }
  app.get('/admin', (req, res) => {
    const me = realMe(req);
    if (!me || !me.teacher) return res.redirect('/login?admin=1');
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(PUB, 'admin.html'));
  });
  app.get('/admin/roster', teacherGate, (req, res) => {
    const q = game.getQuestions();
    res.json({
      ok: true, roster: store.getRoster(), mode: store.mode,
      joined: store.farmKeys(),
      lessons: q.map(L => ({ id: L.id, title: L.title })),
      missing: PAGE ? PAGE.missing : ['index.html']
    });
  });
  app.post('/admin/roster', teacherGate, (req, res) => {
    const list = Array.isArray(req.body.roster) ? req.body.roster : [];
    const seen = {}, out = [];
    for (const s of list) {
      const no = String(s.no || '').trim(), name = String(s.name || '').trim(), pw = String(s.pw || '').trim();
      if (!no && !name) continue;
      if (!/^\d{1,3}$/.test(no)) return res.json({ ok: false, e: '번호는 숫자로 적어 주세요: ' + (no || name) });
      if (!name) return res.json({ ok: false, e: no + '번 이름이 비어 있어요.' });
      if (!pw) return res.json({ ok: false, e: no + '번 ' + name + ' 비밀번호가 비어 있어요.' });
      if (seen[no]) return res.json({ ok: false, e: no + '번이 두 번 있어요.' });
      seen[no] = 1;
      out.push({ no: Number(no), name, pw });
    }
    out.sort((a, b) => a.no - b.no);
    store.setRoster(out);
    res.json({ ok: true, roster: out });
  });
  /* 선생님이 필요할 때만 정해진 학생의 농장으로 들어가기 (2시간 뒤 자동 해제) */
  app.post('/admin/as', teacherGate, (req, res) => {
    const no = String((req.body && req.body.no) || '').trim();
    const s = store.getRoster().find(x => String(x.no) === no);
    if (!s) return res.json({ ok: false, e: '명단에 없는 번호예요.' });
    setCookie(req, res, game.keyOf(s.no), AS_TTL, 'mf_as');
    console.log('[선생님 접속]', s.no + '번', s.name, '의 농장으로 접속');
    res.json({ ok: true });
  });
  app.get('/admin/exit-as', (req, res) => {
    setCookie(req, res, '', 0, 'mf_as');
    res.redirect(realMe(req) ? '/admin' : '/login');
  });
  app.post('/admin/import', teacherGate, (req, res) => {
    try { res.json({ ok: true, report: doImport(req.body || {}) }); }
    catch (e) { res.json({ ok: false, e: e.message }); }
  });
  app.get('/admin/backup', teacherGate, (req, res) => {
    const d = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    res.setHeader('Content-Disposition', 'attachment; filename="math-farm-backup-' + d + '.json"');
    res.json(store.snapshot());
  });

  app.use((req, res) => res.status(404).send('없는 주소예요.'));

  const server = app.listen(PORT, () => console.log('수학 농장 서버가 켜졌어요: 포트', PORT));

  // 서버가 꺼질 때(재배포, 무료 서버 잠들기) 아직 저장 안 된 것을 마저 저장
  async function shutdown(sig) {
    console.log(sig, '→ 저장하고 끌게요');
    server.close();
    try { await store.flush(); } catch (e) { console.error(e); }
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(e => { console.error('서버를 켤 수 없어요:', e); process.exit(1); });
