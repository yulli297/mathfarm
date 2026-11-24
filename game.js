/**
 * 수학 농장 · 게임 규칙 (Apps Script 04_농장 · 05_문제 · 06_교사 를 서버용으로 옮긴 것)
 *
 * 달라진 점
 *  - 시트 대신 메모리 + Firestore(store.js) 에 저장해요.
 *  - 서버 한 대가 차례대로 처리하기 때문에 '줄 세우기(잠금)'가 필요 없어요. → 24명이 동시에 눌러도 기다리지 않아요.
 *  - 이메일 대신 '학생 키'(n + 번호, 예: n7)로 학생을 구분해요. 화면 코드가 쓰는 이름(email)은 그대로 두었어요.
 *  - 동물 위치 기억(2026-11-19 변경): 배치 목록·동전 받기에 섞여 온 동물 위치를 a.p = [x, y, 방향, 시각] 으로 저장해요.
 */
module.exports = function createGame(S, store) {
  const CFG = S.CFG;
  const { payClass_, isSpecial_, dailyAmount_, levelInfo_, legendChance_, clientCfg_ } = S;
  let QBANK = [];
  let LMAP = {};

  function setQuestions(list) {
    QBANK = list;
    LMAP = {};
    list.forEach(L => { LMAP[L.id] = L; });
  }
  function lessonMap_() { return LMAP; }

  /* ================= 공통 ================= */

  function today_() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: CFG.TZ || 'Asia/Seoul' });
  }
  function newId_(p) {
    return p + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
  }
  function getSetting_(k) { return store.getSetting(k); }
  function setSetting_(k, v) { store.setSetting(k, v); }

  class UserError extends Error {}
  function fail(msg) { throw new UserError(msg); }

  /** 명단: [{ no, name, pw }] → 화면용 { no, name, email(=키) } */
  function roster_() {
    return store.getRoster().map(s => ({ no: s.no, name: s.name, email: keyOf(s.no) }));
  }
  function keyOf(no) { return 'n' + String(no).trim(); }
  function findStudent_(key) {
    const list = roster_();
    for (let i = 0; i < list.length; i++) if (list[i].email === key) return list[i];
    return null;
  }

  /* ================= 04_농장 ================= */

  function farmDay_() { return Number(getSetting_('농장하루')) || 0; }
  function dayKey_(n) { return 'D' + n; }

  function landRect_(barn) {
    const l = CFG.LAND[barn], W = CFG.WORLD;
    return { x: Math.round((W[0] - l[0]) / 2), y: Math.round((W[1] - l[1]) / 2), w: l[0], h: l[1] };
  }

  function newFarm_(me) {
    const L = landRect_(0), b = CFG.BARN[0];
    return fixGarden_({
      v: 1,
      name: me.name + '의 농장',
      gold: 0,
      barn: 0,
      objs: [{ id: 'barn', k: 'barn', x: Math.round(L.x + L.w / 2 - b.w / 2), y: L.y + 12 }],
      animals: [],
      storage: { animals: [], items: [] },
      lessons: 0,
      pity: 0,
      capBonus: 0,
      bonusLessons: {},
      done: {},
      reopened: [],
      introDone: false,
      cur: null,
      g: null
    });
  }

  function fixFarm_(F) {
    F.gold = Math.max(0, Math.floor(Number(F.gold) || 0));
    F.barn = Math.min(CFG.BARN.length - 1, Math.max(0, F.barn | 0));
    F.objs = F.objs || [];
    F.animals = F.animals || [];
    F.storage = F.storage || {};
    F.storage.animals = F.storage.animals || [];
    F.storage.items = F.storage.items || [];
    F.lessons = F.lessons | 0;
    F.pity = F.pity | 0;
    F.capBonus = Math.max(0, F.capBonus | 0);
    F.bonusLessons = F.bonusLessons || {};
    F.done = F.done || {};
    F.reopened = F.reopened || [];
    fixGarden_(F);
    if (!F.objs.some(o => o.k === 'barn')) {
      const L = landRect_(F.barn), b = CFG.BARN[F.barn];
      F.objs.unshift({ id: 'barn', k: 'barn', x: Math.round(L.x + L.w / 2 - b.w / 2), y: L.y + 12 });
    }
    return F;
  }

  function cap_(F) { return CFG.BARN[F.barn].cap + (F.capBonus | 0); }

  function farmView_(F) {
    const lv = levelInfo_(F.lessons), day = farmDay_();
    return {
      name: F.name, gold: F.gold, barn: F.barn, cap: cap_(F), capBonus: F.capBonus | 0,
      objs: F.objs, animals: F.animals, storage: F.storage,
      lessons: F.lessons, level: lv.level, toNext: lv.toNext, need: lv.need, maxLevel: lv.max,
      introDone: !!F.introDone, today: dayKey_(day), day: day, g: gardenView_(F, day)
    };
  }

  function ownedSet_(F) {
    const s = {};
    F.animals.concat(F.storage.animals).forEach(a => { s[a.t] = (s[a.t] || 0) + 1; });
    return s;
  }

  function dims_(F, k) { return k === 'barn' ? CFG.BARN[F.barn] : CFG.ITEMS[k]; }

  function clampObj_(F, o) {
    const d = dims_(F, o.k), L = landRect_(F.barn);
    o.x = Math.max(L.x - 4, Math.min(L.x + L.w + 4 - d.w, Math.round(Number(o.x) || 0)));
    o.y = Math.max(L.y - Math.round(d.h * 0.6), Math.min(L.y + L.h + 2 - d.h, Math.round(Number(o.y) || 0)));
  }

  /**
   * 배치 조정에서 옮긴 위치를 반영
   * 물건: { id, k, x, y } / 동물: { id, a: 1, x, y, f } (x, y = 동물 발 가운데) → a.p = [x, y, 방향(0/1), 시각]
   */
  function applyLayout_(F, layout) {
    if (!Array.isArray(layout) || !layout.length) return;
    const map = {}, amap = {};
    F.objs.forEach(o => { map[o.id] = o; });
    F.animals.forEach(a => { amap[a.id] = a; });
    const L = landRect_(F.barn), now = Date.now();
    layout.forEach(p => {
      if (!p) return;
      if (p.a) {
        const a = amap[p.id];
        if (!a) return;
        const x = Math.round(Number(p.x)), y = Math.round(Number(p.y));
        if (isNaN(x) || isNaN(y)) return;
        a.p = [
          Math.max(L.x, Math.min(L.x + L.w, x)),
          Math.max(L.y, Math.min(L.y + L.h, y)),
          p.f ? 1 : 0,
          now
        ];
        return;
      }
      const o = map[p.id];
      if (!o) return;
      if ((o.k === 'fence' || o.k === 'fenceV') && (p.k === 'fence' || p.k === 'fenceV')) o.k = p.k;
      o.x = p.x; o.y = p.y;
      clampObj_(F, o);
    });
  }

  function findIdx_(list, id) {
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  /* ---------- 서버 함수에 쓰는 준비물: 누구인지 + 그 사람의 농장 ---------- */
  function ctx_(me) {
    const raw = store.loadFarm(me.key);
    const c = {
      me: me,
      F: raw ? fixFarm_(raw) : newFarm_(me),
      save() { store.saveFarm(me.key, c.F, me.name); }
    };
    if (!raw) c.save();
    return c;
  }

  /* ---------- 학생 화면에서 부르는 함수 ---------- */

  /** 동물 머리 위 동전 받기. pos = 동물 위치(배치 목록 모양)를 같이 보내면 함께 저장해요 */
  function api_collect(me, ids, pos) {
    if (!Array.isArray(ids)) ids = [ids];
    const c = ctx_(me), F = c.F, day = dayKey_(farmDay_());
    let total = 0;
    if (Array.isArray(pos)) applyLayout_(F, pos);   // 동물 위치도 함께 저장 (따로 서버를 부르지 않아요)
    ids.forEach(id => {
      const i = findIdx_(F.animals, id);
      if (i < 0) return;
      const a = F.animals[i];
      if (a.c === day) return;
      const amt = dailyAmount_(a.t, a.id, day);
      a.c = day;
      F.gold += amt;
      total += amt;
    });
    if (total || Array.isArray(pos)) c.save();
    return { gold: F.gold, amt: total };
  }

  function api_saveLayout(me, layout) {
    const c = ctx_(me);
    applyLayout_(c.F, layout);
    c.save();
    return farmView_(c.F);
  }

  function api_buyItem(me, k, an, x, y, layout) {
    const c = ctx_(me), F = c.F, it = CFG.ITEMS[k];
    if (!it || k === 'fenceV' || it.special) fail('없는 물건이에요.');
    if (F.gold < it.price) fail('골드가 부족해요.');
    applyLayout_(F, layout);
    const o = { id: newId_('o'), k: k, x: x, y: y };
    if (k === 'statue') {
      if (!an || !ownedSet_(F)[an]) fail('내가 가진 동물만 동상으로 만들 수 있어요.');
      o.an = an;
    }
    clampObj_(F, o);
    F.objs.push(o);
    F.gold -= it.price;
    c.save();
    return { farm: farmView_(F), id: o.id };
  }

  function api_sellItem(me, id, layout) {
    const c = ctx_(me), F = c.F;
    applyLayout_(F, layout);
    const i = findIdx_(F.objs, id);
    if (i < 0 || F.objs[i].k === 'barn') fail('팔 수 없는 물건이에요.');
    const it = CFG.ITEMS[F.objs[i].k];
    if (it.special) fail('특별한 물건은 팔 수 없어요. 보관함에 넣을 수는 있어요.');
    F.gold += Math.floor(it.price / 2);
    F.objs.splice(i, 1);
    c.save();
    return farmView_(F);
  }

  function api_storeItem(me, id, layout) {
    const c = ctx_(me), F = c.F;
    applyLayout_(F, layout);
    const i = findIdx_(F.objs, id);
    if (i < 0 || F.objs[i].k === 'barn') fail('보관할 수 없는 물건이에요.');
    const o = F.objs.splice(i, 1)[0];
    const s = { k: o.k === 'fenceV' ? 'fence' : o.k };
    if (o.an) s.an = o.an;
    F.storage.items.push(s);
    c.save();
    return farmView_(F);
  }

  function api_placeItem(me, idx, x, y) {
    const c = ctx_(me), F = c.F, s = F.storage.items[idx];
    if (!s) fail('보관함에 없는 물건이에요.');
    F.storage.items.splice(idx, 1);
    const o = { id: newId_('o'), k: s.k, x: x, y: y };
    if (s.an) o.an = s.an;
    clampObj_(F, o);
    F.objs.push(o);
    c.save();
    return { farm: farmView_(F), id: o.id };
  }

  function api_storeAnimal(me, id, layout) {
    const c = ctx_(me), F = c.F;
    applyLayout_(F, layout);
    const i = findIdx_(F.animals, id);
    if (i < 0) fail('농장에 없는 동물이에요.');
    F.storage.animals.push(F.animals.splice(i, 1)[0]);
    c.save();
    return farmView_(F);
  }

  function api_takeOutAnimal(me, id) {
    const c = ctx_(me), F = c.F;
    const i = findIdx_(F.storage.animals, id);
    if (i < 0) fail('보관함에 없는 동물이에요.');
    if (F.animals.length >= cap_(F)) fail('농장 자리가 부족해요. 건물을 업그레이드하면 더 키울 수 있어요.');
    const a = F.storage.animals.splice(i, 1)[0];
    delete a.p;   // 꺼낸 동물은 새 자리에 나와요
    F.animals.push(a);
    c.save();
    return farmView_(F);
  }

  function api_upgradeBarn(me) {
    const c = ctx_(me), F = c.F, nx = CFG.BARN[F.barn + 1];
    if (!nx) fail('가장 큰 농장까지 다 지었어요.');
    if (F.gold < nx.cost) fail('골드가 ' + (nx.cost - F.gold).toLocaleString() + ' 부족해요.');
    const b = F.objs[findIdx_(F.objs, 'barn')], old = CFG.BARN[F.barn];
    const cx = b.x + old.w / 2, bottom = b.y + old.h;
    F.gold -= nx.cost;
    F.barn++;
    const L = landRect_(F.barn);
    b.x = Math.max(L.x + 2, Math.min(L.x + L.w - 2 - nx.w, Math.round(cx - nx.w / 2)));
    b.y = Math.max(L.y + 2, Math.round(bottom - nx.h));
    fixGarden_(F);
    c.save();
    return farmView_(F);
  }

  function api_rename(me, name) {
    const c = ctx_(me);
    const v = String(name || '').replace(/[<>]/g, '').trim();
    if (!v) fail('농장 이름을 입력해 주세요.');
    if (v.length > 12) fail('농장 이름은 12글자까지 쓸 수 있어요.');
    c.F.name = v;
    c.save();
    return farmView_(c.F);
  }

  function api_finishIntro(me) {
    const c = ctx_(me);
    c.F.introDone = true;
    c.save();
    return farmView_(c.F);
  }

  function addAnimal_(F, t) {
    const a = { id: newId_('a'), t: t, c: '' };
    if (F.animals.length < cap_(F)) { F.animals.push(a); return 'farm'; }
    F.storage.animals.push(a);
    return 'storage';
  }

  /* ---------- 텃밭 ---------- */

  function newPlot_() { return { c: '', p: -1, eco: 0, t: -1, h: -1 }; }
  function plotCount_(F) { return CFG.PLOTS[F.barn] || CFG.PLOTS[CFG.PLOTS.length - 1] || 1; }

  function fixGarden_(F) {
    const g = F.g = F.g || {};
    g.plots = g.plots || [];
    const n = plotCount_(F);
    while (g.plots.length < n) g.plots.push(newPlot_());
    g.inv = g.inv || {};
    g.dex = g.dex || {};
    if (typeof g.sd !== 'number') g.sd = -1;
    if (!g.ev) g.ev = null;
    g.award = !!g.award;
    return F;
  }

  function plotState_(g, pl, day) {
    if (pl.t >= 0) return day > pl.t ? 'heal' : 'tired';
    if (pl.h >= 0 && day <= pl.h) return 'rest';
    if (!pl.c) return 'empty';
    return g.sd > pl.p ? 'ready' : 'grow';
  }

  function gardenView_(F, day) {
    const g = F.g, n = plotCount_(F);
    const ev = g.ev && g.ev.d === day && g.ev.k && g.ev.a === null ? { k: g.ev.k } : null;
    return {
      plots: g.plots.slice(0, n).map(pl => ({ c: pl.c, eco: pl.eco, p: pl.p, st: plotState_(g, pl, day) })),
      inv: g.inv, dex: g.dex, ev: ev, award: g.award, sd: g.sd
    };
  }

  function gctx_(c, i) {
    const F = c.F, day = farmDay_(), g = F.g;
    i = Math.floor(Number(i));
    if (!(i >= 0 && i < plotCount_(F))) fail('없는 텃밭 칸이에요.');
    return { F: F, g: g, day: day, i: i, pl: g.plots[i], st: plotState_(g, g.plots[i], day) };
  }

  function hasAnimal_(F, list) {
    const own = ownedSet_(F);
    return (list || []).some(t => own[t]);
  }
  function onFarm_(F, list) { return F.animals.some(a => list.indexOf(a.t) >= 0); }

  function addCrop_(g, crop, eco, n) {
    const key = crop + '|' + (eco ? 1 : 0);
    g.inv[key] = (g.inv[key] | 0) + n;
    const d = g.dex[crop] = g.dex[crop] || { h: 0, e: 0 };
    d.h++;
    if (eco) d.e++;
  }

  function checkAward_(F) {
    const g = F.g;
    if (g.award) return false;
    const need = CFG.MARKS[CFG.MARKS.length - 1];
    const all = CFG.MAIN.every(k => g.dex[k] && g.dex[k].e >= need);
    if (!all) return false;
    g.award = true;
    F.storage.items.push({ k: CFG.AWARD });
    return true;
  }

  function iga_(w) { const s = String(w), ch = s.charCodeAt(s.length - 1) - 0xAC00; return (ch >= 0 && ch <= 11171 && ch % 28) ? '이' : '가'; }

  function api_plant(me, i, crop, opt) {
    const c = ctx_(me), x = gctx_(c, i), C = CFG.CROPS[crop];
    if (x.st !== 'empty') fail('지금은 이 칸에 심을 수 없어요.');
    if (!C) fail('없는 작물이에요.');
    let fb;
    if (C.side) {
      x.g.plots[x.i] = { c: crop, p: x.day, eco: 1, t: -1, h: -1 };
      fb = { ok: true, side: true, c: crop };
    } else {
      if (C.opts.indexOf(opt) < 0) fail('이 작물에 쓸 수 없는 방법이에요.');
      const O = CFG.OPTS[opt];
      if (O.need && O.need.length && !hasAnimal_(x.F, O.need)) fail(CFG.NAMES[O.need[0]] + iga_(CFG.NAMES[O.need[0]]) + ' 있어야 고를 수 있어요.');
      if (O.eco) {
        x.g.plots[x.i] = { c: crop, p: x.day, eco: 1, t: -1, h: -1 };
        fb = { ok: true, c: crop, opt: opt, why: O.why };
      } else {
        addCrop_(x.g, crop, false, 1);
        const pl = newPlot_(); pl.t = x.day;
        x.g.plots[x.i] = pl;
        fb = { ok: false, c: crop, opt: opt, why: O.why, got: { c: crop, n: 1, eco: false } };
      }
    }
    c.save();
    return { farm: farmView_(x.F), fb: fb };
  }

  function api_harvest(me, i) {
    const c = ctx_(me), x = gctx_(c, i), F = x.F, g = x.g, pl = x.pl;
    if (x.st !== 'ready') fail(x.st === 'grow' ? '다음 차시 문제를 다 풀면 수확할 수 있어요.' : '수확할 작물이 없어요.');
    if (!g.ev || g.ev.d !== x.day) {
      const keys = Object.keys(CFG.EVENTS);
      g.ev = { d: x.day, k: Math.random() < CFG.EVENT_P ? pick_(keys) : '', a: null };
    }
    if (g.ev.k && g.ev.a === null) {
      c.save();
      return { farm: farmView_(F), event: { k: g.ev.k } };
    }
    const badDay = !!(g.ev.k && g.ev.a === 'bad');
    const eco = !!pl.eco && !badDay, C = CFG.CROPS[pl.c], bonus = [];
    let n = 1;
    if (eco) {
      if (!C.side && C.buddy) {
        const nb = [g.plots[x.i - 1], g.plots[x.i + 1]].some((q, k) => {
          const idx = x.i + (k ? 1 : -1);
          return q && idx < plotCount_(F) && q.c === C.buddy && q.t < 0;
        });
        if (nb && Math.random() < CFG.BONUS_P) { n++; bonus.push('buddy'); }
      }
      if (onFarm_(F, CFG.MANURE) && Math.random() < CFG.BONUS_P) { n++; bonus.push('manure'); }
      if (F.barn >= CFG.COMPOST_SHED && Math.random() < CFG.BONUS_P) { n++; bonus.push('shed'); }
    }
    const before = (g.dex[pl.c] && g.dex[pl.c].e) | 0;
    addCrop_(g, pl.c, eco, n);
    const after = g.dex[pl.c].e;
    let mark = 0;
    CFG.MARKS.forEach((m, k) => { if (before < m && after >= m) mark = k + 1; });
    const np = newPlot_();
    if (badDay) np.t = x.day;
    g.plots[x.i] = np;
    const award = checkAward_(F);
    c.save();
    return { farm: farmView_(F), got: { c: pl.c, n: n, eco: eco, bonus: bonus, mark: mark, tired: badDay }, award: award };
  }

  function api_eventAnswer(me, opt) {
    const c = ctx_(me), F = c.F, g = F.g, day = farmDay_();
    if (!g.ev || g.ev.d !== day || !g.ev.k || g.ev.a !== null) fail('지금 대처할 일이 없어요.');
    const E = CFG.EVENTS[g.ev.k];
    if (E.opts.indexOf(opt) < 0) fail('고를 수 없는 방법이에요.');
    const O = CFG.OPTS[opt];
    g.ev.a = O.eco ? 'good' : 'bad';
    c.save();
    return { farm: farmView_(F), fb: { ok: !!O.eco, opt: opt, why: O.why } };
  }

  function api_heal(me, i, opt) {
    const c = ctx_(me), x = gctx_(c, i);
    if (x.st !== 'heal') fail(x.st === 'tired' ? '땅 살리기는 다음 차시부터 할 수 있어요.' : '지금은 땅 살리기를 할 수 없어요.');
    if (CFG.HEAL.indexOf(opt) < 0) fail('고를 수 없는 방법이에요.');
    const O = CFG.OPTS[opt];
    if (O.eco) { x.pl.t = -1; x.pl.h = x.day; }
    else x.pl.t = x.day;
    c.save();
    return { farm: farmView_(x.F), fb: { ok: !!O.eco, opt: opt, why: O.why } };
  }

  function api_feed(me, aid, key) {
    const c = ctx_(me), F = c.F, g = F.g, dk = dayKey_(farmDay_());
    if (!(g.inv[key] > 0)) fail('창고에 그 작물이 없어요.');
    const i = findIdx_(F.animals, aid);
    if (i < 0) fail('농장에 있는 동물에게만 줄 수 있어요.');
    const a = F.animals[i];
    if (a.e === dk) fail('이 동물은 이번 차시에 벌써 먹었어요.');
    const crop = String(key).split('|')[0], eco = String(key).split('|')[1] === '1';
    const C = CFG.CROPS[crop];
    if (!C) fail('없는 작물이에요.');
    const fav = (C.fav || []).indexOf(a.t) >= 0;
    const pct = CFG.FEED.base + (eco ? CFG.FEED.eco : 0) + (fav ? CFG.FEED.fav : 0);
    const amt = Math.max(1, Math.round(dailyAmount_(a.t, a.id, dk) * pct));
    g.inv[key]--;
    if (!g.inv[key]) delete g.inv[key];
    a.e = dk;
    F.gold += amt;
    c.save();
    return { farm: farmView_(F), amt: amt, fav: fav, eco: eco };
  }

  /* ================= 05_문제 ================= */

  function checkQuestionBank_() {
    const seen = {}, errs = [];
    QBANK.forEach((L, li) => {
      const tag = (L.id || ('#' + (li + 1)));
      if (!L.id) errs.push(tag + ': id 가 없어요');
      if (seen[L.id]) errs.push(tag + ': 같은 id 가 두 번 있어요');
      seen[L.id] = 1;
      if (!L.q || L.q.length !== 10) { errs.push(tag + ': 문제가 10개가 아니에요'); return; }
      L.q.forEach((q, i) => {
        if (i < 7) {
          if (!q.text || q.answer === undefined) errs.push(tag + ' ' + (i + 1) + '번: text 나 answer 가 없어요');
        } else {
          ['basic', 'adv'].forEach(k => {
            if (!q[k] || !q[k].text || q[k].answer === undefined) errs.push(tag + ' ' + (i + 1) + '번: ' + k + ' 문제가 비어 있어요');
          });
        }
      });
    });
    if (errs.length) fail('문제 은행 확인 필요\n' + errs.join('\n'));
    return true;
  }

  function qAt_(L, idx, choice) {
    const q = L.q[idx];
    if (idx >= 7) {
      const v = q[choice === 'adv' ? 'adv' : 'basic'];
      return { no: idx + 1, lv: choice === 'adv' ? '사고력' : '기본', concept: v.concept || q.concept || '', text: v.text, choices: v.choices || null, answer: v.answer, hint: v.hint || '' };
    }
    return { no: idx + 1, lv: q.lv || (idx < 4 ? '기초' : '기본'), concept: q.concept || '', text: q.text, choices: q.choices || null, answer: q.answer, hint: q.hint || '' };
  }

  function norm_(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[\s,]/g, '').replace(/[−–—]/g, '-').replace(/×/g, 'x').toLowerCase();
  }

  function checkAnswer_(ans, answer) {
    const a = norm_(ans);
    if (!a) return false;
    const list = Array.isArray(answer) ? answer : [answer];
    return list.some(x => {
      const b = norm_(x);
      if (a === b) return true;
      const na = Number(a), nb = Number(b);
      return b !== '' && !isNaN(na) && !isNaN(nb) && na === nb;
    });
  }

  function shownAnswer_(answer) { return String(Array.isArray(answer) ? answer[0] : answer); }

  function isNumericAnswer_(answer) {
    const list = Array.isArray(answer) ? answer : [answer];
    return list.every(x => /^-?[\d.,]+$/.test(String(x).trim()));
  }

  function quizMenu_(F) {
    const open = getSetting_('열린차시'), Lm = lessonMap_(), list = [];
    if (open && Lm[open]) {
      list.push({ id: open, title: Lm[open].title, unit: Lm[open].unit || '', kind: 'today',
        status: F.cur && F.cur.lesson === open ? 'doing' : (F.done[open] && F.reopened.indexOf(open) < 0 ? 'review' : 'ready') });
    }
    F.reopened.forEach(id => {
      if (id === open || !Lm[id]) return;
      list.push({ id: id, title: Lm[id].title, unit: Lm[id].unit || '', kind: 'reopen',
        status: F.cur && F.cur.lesson === id ? 'doing' : 'ready' });
    });
    if (F.cur && Lm[F.cur.lesson] && !list.some(x => x.id === F.cur.lesson)) {
      list.unshift({ id: F.cur.lesson, title: Lm[F.cur.lesson].title, unit: Lm[F.cur.lesson].unit || '', kind: F.cur.review ? 'review' : 'doing', status: 'doing' });
    }
    // 다 푼 지난 차시는 복습용으로 언제든 다시 풀 수 있어요 (보상·기록 없음)
    QBANK.forEach(L => {
      if (!F.done[L.id] || list.some(x => x.id === L.id)) return;
      list.push({ id: L.id, title: L.title, unit: L.unit || '', kind: 'review', status: 'review', best: F.done[L.id].correct });
    });
    return { list: list, last: F.lastResult || null };
  }

  function quizView_(F) {
    const cur = F.cur;
    if (!cur) return null;
    const L = lessonMap_()[cur.lesson];
    if (!L) return null;
    const v = {
      lesson: cur.lesson, title: L.title, unit: L.unit || '', idx: cur.idx, choice: cur.choice, review: !!cur.review,
      res: cur.res.map(r => r ? (r.ok ? 1 : 0) : null)
    };
    if (cur.offers.length) {
      const o = cur.offers[0];
      v.step = 'offer';
      v.offer = { kind: o.kind, why: o.why, cands: o.cands, room: F.animals.length < cap_(F) };
    } else if (cur.idx === 7 && !cur.choice) {
      v.step = 'choose';
    } else {
      const q = qAt_(L, cur.idx, cur.choice);
      v.step = 'q';
      v.q = { no: q.no, lv: q.lv, text: q.text, choices: q.choices, num: isNumericAnswer_(q.answer) };
      v.tries = cur.tries;
      v.maxTry = CFG.MAX_TRY;
      if (cur.tries > 0) v.hint = q.hint;
    }
    return v;
  }

  /** 문제 파일에서 지워진 차시를 풀던 중이면 풀던 것을 정리해요 (오류로 화면이 멈추지 않게) */
  function dropLostQuiz_(c) {
    if (c.F.cur && !lessonMap_()[c.F.cur.lesson]) { c.F.cur = null; c.save(); }
  }

  function api_quizMenu(me) {
    const c = ctx_(me);
    dropLostQuiz_(c);
    return quizMenu_(c.F);
  }

  function api_startQuiz(me, id) {
    const c = ctx_(me), F = c.F, L = lessonMap_()[id];
    if (!L) fail('없는 차시예요.');
    if (F.cur) {
      if (F.cur.lesson !== id) fail('먼저 풀고 있던 차시를 끝내 주세요.');
      return { view: quizView_(F) };
    }
    const open = getSetting_('열린차시');
    const reopened = F.reopened.indexOf(id) >= 0;
    const fresh = reopened || (id === open && !F.done[id]);
    const review = !fresh && !!F.done[id];
    if (!fresh && !review) fail('아직 열리지 않은 차시예요.');
    F.cur = {
      review: review,
      lesson: id, idx: 0, tries: 0, choice: null,
      res: [null, null, null, null, null, null, null, null, null, null],
      offers: [], got: [], gotIds: [], log: [],
      pity0: F.pity | 0,
      xp: id === open && !F.done[id],
      at: Date.now()
    };
    c.save();
    return { view: quizView_(F) };
  }

  function api_chooseLevel(me, choice) {
    const c = ctx_(me), F = c.F, cur = F.cur;
    if (!cur) fail('풀고 있는 차시가 없어요.');
    if (cur.idx === 7 && !cur.choice && (choice === 'basic' || choice === 'adv')) {
      cur.choice = choice;
      c.save();
    }
    return { view: quizView_(F) };
  }

  /** 답 제출. 도전 횟수도 농장 데이터에 바로 기억해요 (새로고침해도 기회가 다시 늘어나지 않아요) */
  function api_submit(me, ans) {
    const c = ctx_(me), F = c.F, cur = F.cur;
    if (!cur) fail('풀고 있는 차시가 없어요.');
    if (!lessonMap_()[cur.lesson]) { dropLostQuiz_(c); fail('풀던 차시가 없어졌어요. 선생님께 말씀드려 주세요.'); }
    if (cur.offers.length || (cur.idx === 7 && !cur.choice) || cur.idx >= 10) return { view: quizView_(F) };
    if (!String(ans === null || ans === undefined ? '' : ans).trim()) fail('답을 입력해 주세요.');
    const q = qAt_(lessonMap_()[cur.lesson], cur.idx, cur.choice);
    const ok = checkAnswer_(ans, q.answer);
    cur.tries = (cur.tries | 0) + 1;
    if (!ok && cur.tries < CFG.MAX_TRY) {
      c.save();
      return { ok: false, tries: cur.tries, hint: q.hint, left: CFG.MAX_TRY - cur.tries, view: quizView_(F) };
    }
    const out = { ok: ok, tries: cur.tries };
    cur.res[cur.idx] = { ok: ok, first: ok && cur.tries === 1, tries: cur.tries };
    cur.log = cur.log || [];
    cur.log.push([Date.now(), me.key, me.name, me.teacher ? '교사' : '학생', cur.lesson, q.no, q.lv, q.concept,
      ok && cur.tries === 1 ? 'O' : 'X', ok ? 'O' : 'X', cur.tries, String(ans)]);
    if (!ok) out.reveal = shownAnswer_(q.answer);
    rewardAfter_(F, cur);
    cur.idx++;
    cur.tries = 0;
    out.next = true;
    if (cur.idx >= 10 && !cur.offers.length) out.result = finishQuiz_(F);
    c.save();
    out.view = quizView_(F);
    if (out.result) { out.farm = farmView_(F); out.menu = quizMenu_(F); }
    return out;
  }

  function api_pickAnimal(me, t) {
    const c = ctx_(me), F = c.F, cur = F.cur;
    if (!cur || !cur.offers.length) fail('고를 동물이 없어요.');
    const o = cur.offers[0];
    if (o.cands.indexOf(t) < 0) fail('후보에 없는 동물이에요.');
    cur.offers.shift();
    if (CFG.ANIMALS.l.indexOf(t) >= 0) F.pity = 0;
    const where = addAnimal_(F, t);
    cur.got.push(t);
    const added = where === 'farm' ? F.animals[F.animals.length - 1] : F.storage.animals[F.storage.animals.length - 1];
    (cur.gotIds = cur.gotIds || []).push(added.id);
    const out = { where: where, t: t };
    if (cur.idx >= 10 && !cur.offers.length) {
      out.result = finishQuiz_(F);
      out.menu = quizMenu_(F);
    }
    c.save();
    out.view = quizView_(F);
    out.farm = farmView_(F);
    return out;
  }

  function rewardAfter_(F, cur) {
    if (cur.review) return;   // 복습은 동물·보너스 없음
    const i = cur.idx, r = cur.res;
    function okCount(a, b) { let n = 0; for (let k = a; k <= b; k++) if (r[k] && r[k].ok) n++; return n; }
    if (i === 9 && cur.choice === 'adv' && r[7] && r[7].first && r[8] && r[8].first && r[9] && r[9].first) grantCapBonus_(F, cur);
    if (i === 3 && okCount(0, 3) >= CFG.ZONE_NEED) cur.offers.push(makeOffer_(F, 'b'));
    if (i === 6 && okCount(4, 6) >= CFG.ZONE_NEED) cur.offers.push(makeOffer_(F, 'm'));
    if (i >= 7 && cur.choice === 'adv' && r[i].ok) cur.offers.push(makeOffer_(F, 't'));
    if (i === 9 && cur.choice === 'basic' && okCount(7, 9) >= CFG.ZONE_NEED) cur.offers.push(makeOffer_(F, 'm8'));
  }

  function grantCapBonus_(F, cur) {
    F.bonusLessons = F.bonusLessons || {};
    if (F.bonusLessons[cur.lesson]) return;
    F.bonusLessons[cur.lesson] = 1;
    F.capBonus = (F.capBonus | 0) + CFG.ADV_CAP_BONUS;
    cur.capUp = (cur.capUp | 0) + CFG.ADV_CAP_BONUS;
  }

  function pick_(list) { return list[Math.floor(Math.random() * list.length)]; }
  function pick2_(list) {
    const a = list.slice(), out = [];
    while (out.length < 2 && a.length) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
    return out;
  }

  function makeOffer_(F, kind) {
    const A = CFG.ANIMALS;
    if (kind === 'b') return { kind: 'b', why: '기초 1~4번을 잘 풀었어요!', cands: pick2_(A.b) };
    if (kind === 'm') return { kind: 'm', why: '기본 5~7번을 잘 풀었어요!', cands: pick2_(A.m) };
    if (kind === 'm8') return { kind: 'm', why: '8~10번 기본 문제를 잘 풀었어요!', cands: pick2_(A.m) };
    const own = ownedSet_(F);
    ((F.cur && F.cur.offers) || []).forEach(o => { o.cands.forEach(t => { if (isSpecial_(t)) own[t] = 1; }); });
    const leg = A.l.filter(t => !own[t]);
    const gold = A.g.filter(t => !own[t]);
    F.pity = (F.pity | 0) + 1;
    const p = legendChance_(levelInfo_(F.lessons).level);
    if (leg.length && (F.pity >= CFG.PITY || Math.random() < p)) {
      return { kind: 'l', why: '전설의 동물이 나타났어요!', cands: [pick_(leg), pick_(A.t)] };
    }
    if (gold.length && Math.random() < CFG.GOLD_P) {
      return { kind: 'g', why: '황금 동물이 나타났어요!', cands: [pick_(gold), pick_(A.t)] };
    }
    return { kind: 't', why: '사고력 문제를 맞혔어요!', cands: pick2_(A.t) };
  }

  function finishQuiz_(F) {
    const cur = F.cur, L = lessonMap_()[cur.lesson];
    let correct = 0, first = 0;
    cur.res.forEach(r => { if (r && r.ok) correct++; if (r && r.first) first++; });
    if (cur.review) {
      // 복습: 경험치·골드·동물·텃밭·정답률 기록에 영향 없이 결과만 보여 줘요
      F.cur = null;
      return { lesson: cur.lesson, title: L.title, correct: correct, first: first, got: [], review: true,
        best: F.done[cur.lesson] ? F.done[cur.lesson].correct : 0 };
    }
    const before = levelInfo_(F.lessons).level;
    if (cur.xp) F.lessons++;
    const after = levelInfo_(F.lessons);
    const levelGold = after.level > before ? (after.level - before) * CFG.LEVEL_GOLD : 0;
    if (levelGold) F.gold += levelGold;
    F.done[cur.lesson] = { at: today_(), correct: correct, first: first, xp: !!cur.xp, choice: cur.choice };
    F.reopened = F.reopened.filter(x => x !== cur.lesson);
    F.g.sd = farmDay_();
    const res = {
      lesson: cur.lesson, title: L.title, correct: correct, first: first, got: cur.got,
      xp: !!cur.xp, levelUp: after.level > before ? after.level : 0, levelGold: levelGold,
      level: after.level, toNext: after.toNext,
      capUp: cur.capUp | 0, cap: cap_(F)
    };
    store.appendLogs(cur.log || []);
    F.cur = null;
    F.lastResult = res;
    return res;
  }

  /* ================= 06_교사 ================= */

  function teacherOnly_(me) {
    if (!me.teacher) fail('선생님만 쓸 수 있어요.');
    return me;
  }

  function api_teacherData(me) {
    teacherOnly_(me);
    checkQuestionBank_();
    const roster = roster_(), open = getSetting_('열린차시');

    const students = roster.map(s => {
      const raw = store.loadFarm(s.email);
      if (!raw) return { no: s.no, name: s.name, email: s.email, joined: false };
      const F = fixFarm_(raw);
      const lv = levelInfo_(F.lessons);
      return {
        no: s.no, name: s.name, email: s.email, joined: true,
        farmName: F.name, level: lv.level, lessons: F.lessons, gold: F.gold, barn: F.barn,
        onFarm: F.animals.length, inStore: F.storage.animals.length, dex: ownedSet_(F),
        done: F.done, reopened: F.reopened, doing: F.cur ? F.cur.lesson : '', pity: F.pity,
        doingInfo: F.cur ? { idx: F.cur.idx, got: (F.cur.got || []).length, capUp: F.cur.capUp | 0 } : null
      };
    });

    const perQ = {};
    store.allLogRows().forEach(r => {
      const email = String(r[1]), lesson = String(r[4]), no = Number(r[5]);
      if (String(r[3]) === '교사' || email === 'teacher') return;
      perQ[lesson] = perQ[lesson] || {};
      perQ[lesson][email] = perQ[lesson][email] || {};
      perQ[lesson][email][no] = { f: r[8] === 'O' ? 1 : 0, ok: r[9] === 'O' ? 1 : 0, t: Number(r[10]) || 1, lv: String(r[6]), c: String(r[7]) };
    });

    const lessons = QBANK.map(L => ({
      id: L.id, unit: L.unit || '', title: L.title,
      q: L.q.map((q, i) => {
        if (i < 7) return { no: i + 1, lv: q.lv || (i < 4 ? '기초' : '기본'), concept: q.concept || '', text: q.text, answer: shownAnswer_(q.answer), hint: q.hint || '' };
        return {
          no: i + 1,
          basic: { concept: q.basic.concept || '', text: q.basic.text, answer: shownAnswer_(q.basic.answer), hint: q.basic.hint || '' },
          adv: { concept: q.adv.concept || '', text: q.adv.text, answer: shownAnswer_(q.adv.answer), hint: q.adv.hint || '' }
        };
      })
    }));

    return { open: open, lessons: lessons, students: students, perQ: perQ, today: today_(), pity: CFG.PITY, day: farmDay_() };
  }

  /** 오늘 풀 차시 열기 / 닫기. 새 차시를 열면 농장의 '하루'가 지나가요. */
  function api_setOpenLesson(me, id) {
    teacherOnly_(me);
    if (id && !lessonMap_()[id]) fail('없는 차시예요.');
    setSetting_('열린차시', id || '');
    if (id && id !== getSetting_('하루차시')) {
      setSetting_('농장하루', farmDay_() + 1);
      setSetting_('하루차시', id);
    }
    return api_teacherData(me);
  }

  function editStudentFarm_(key, fn) {
    const s = findStudent_(key);
    if (!s) fail('명단에 없는 학생이에요.');
    const raw = store.loadFarm(key);
    const F = raw ? fixFarm_(raw) : newFarm_(s);
    fn(F);
    store.saveFarm(key, F, s.name);
  }

  function api_reopen(me, key, id, on) {
    teacherOnly_(me);
    if (!lessonMap_()[id]) fail('없는 차시예요.');
    editStudentFarm_(String(key), F => {
      F.reopened = F.reopened.filter(x => x !== id);
      if (on) F.reopened.push(id);
    });
    return api_teacherData(me);
  }

  /** 학생이 풀고 있는 차시를 처음부터 다시 풀게 초기화.
   *  이번에 풀면서 받은 동물·최대 마릿수 보너스·전설 카운트도 차시 시작 전으로 되돌려요.
   *  (풀이 기록은 차시를 끝낼 때만 저장되므로 따로 지울 것이 없어요) */
  function api_resetCurrent(me, key, lessonId) {
    teacherOnly_(me);
    let info = null;
    editStudentFarm_(String(key), F => {
      const cur = F.cur;
      if (!cur) fail('이 학생은 지금 풀고 있는 차시가 없어요.');
      if (lessonId && cur.lesson !== lessonId) fail('그 사이에 학생이 다른 차시를 풀고 있어요. 화면을 새로 불러와 주세요.');
      let removed = 0;
      const ids = cur.gotIds || [];
      if (ids.length) {
        ids.forEach(id => {
          let i = findIdx_(F.animals, id);
          if (i >= 0) { F.animals.splice(i, 1); removed++; return; }
          i = findIdx_(F.storage.animals, id);
          if (i >= 0) { F.storage.animals.splice(i, 1); removed++; }
        });
      } else {
        // 예전 방식으로 시작한 차시: 받은 동물 종류로 가장 최근 것부터 지워요
        (cur.got || []).forEach(t => {
          const take = list => { for (let i = list.length - 1; i >= 0; i--) if (list[i].t === t) { list.splice(i, 1); return true; } return false; };
          if (take(F.storage.animals) || take(F.animals)) removed++;
        });
      }
      if (cur.capUp) {
        F.capBonus = Math.max(0, (F.capBonus | 0) - (cur.capUp | 0));
        if (F.bonusLessons) delete F.bonusLessons[cur.lesson];
      }
      if (typeof cur.pity0 === 'number') F.pity = cur.pity0;
      // 보너스가 줄어 농장이 넘치면 넘친 동물은 보관함으로
      while (F.animals.length > cap_(F)) F.storage.animals.push(F.animals.pop());
      info = { lesson: cur.lesson, removed: removed };
      F.cur = null;
    });
    const d = api_teacherData(me);
    d.resetCur = info;
    return d;
  }

  function api_setGold(me, key, gold) {
    teacherOnly_(me);
    const g = Math.floor(Number(gold));
    if (isNaN(g) || g < 0) fail('0 이상의 숫자를 넣어 주세요.');
    editStudentFarm_(String(key), F => { F.gold = g; });
    return api_teacherData(me);
  }

  function api_teacherTool(me, kind) {
    teacherOnly_(me);
    const c = ctx_(me), F = c.F;
    if (kind === 'refill') F.animals.concat(F.storage.animals).forEach(a => { a.c = ''; a.e = ''; });
    else if (kind === 'garden') {
      F.g.plots.forEach(pl => {
        if (pl.p >= 0) pl.p--;
        if (pl.t >= 0) pl.t--;
        if (pl.h >= 0) pl.h--;
      });
      F.g.sd = farmDay_();
      F.g.ev = null;
    }
    else if (kind === 'gold') F.gold += 10000;
    else if (kind === 'redo') { F.done = {}; F.cur = null; F.lastResult = null; }
    else if (kind === 'reset') { c.F = newFarm_(me); c.F.introDone = false; }
    else fail('알 수 없는 도구예요.');
    c.save();
    return { farm: farmView_(c.F), quiz: quizMenu_(c.F) };
  }

  /** 학생 농장 초기화. keys: 'ALL' 또는 학생 키 목록 */
  function api_resetFarms(me, keys, clearLog) {
    teacherOnly_(me);
    const all = keys === 'ALL', want = {};
    if (!all) {
      if (!Array.isArray(keys) || !keys.length) fail('초기화할 학생을 골라 주세요.');
      keys.forEach(e => { want[String(e).trim()] = 1; });
    }
    const hit = k => { k = String(k || '').trim(); return !!k && k !== 'teacher' && (all || !!want[k]); };
    let farms = 0;
    store.farmKeys().forEach(k => { if (hit(k) && store.deleteFarm(k)) farms++; });
    const logs = clearLog ? store.filterLogs(r => !hit(r[1])) : 0;
    const d = api_teacherData(me);
    d.resetInfo = { farms: farms, logs: logs };
    return d;
  }

  /* ================= 03_웹앱 ================= */

  function buildBoot_(me) {
    const c = ctx_(me);
    dropLostQuiz_(c);
    return {
      me: { name: me.name, teacher: !!me.teacher },
      farm: farmView_(c.F),
      quiz: quizMenu_(c.F),
      cfg: clientCfg_()
    };
  }

  function api_boot(me) { return buildBoot_(me); }

  /* ================= 옛 데이터 가져오기 (Apps Script 시트 → 서버) ================= */
  /** 가져온 농장 하나를 저장 (fixFarm_ 으로 빠진 칸을 채워요) */
  function importFarm_(key, F, name) {
    store.saveFarm(key, fixFarm_(F), name);
  }

  const API = {
    api_boot, api_collect, api_saveLayout, api_buyItem, api_sellItem, api_storeItem, api_placeItem,
    api_storeAnimal, api_takeOutAnimal, api_upgradeBarn, api_rename, api_finishIntro,
    api_plant, api_harvest, api_eventAnswer, api_heal, api_feed,
    api_quizMenu, api_startQuiz, api_chooseLevel, api_submit, api_pickAnimal,
    api_teacherData, api_setOpenLesson, api_reopen, api_resetCurrent, api_setGold, api_teacherTool, api_resetFarms
  };

  return { API, UserError, setQuestions, buildBoot_, checkQuestionBank_, keyOf, importFarm_, fixFarm_, getQuestions: () => QBANK };
};
