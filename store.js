/**
 * 수학 농장 · 저장소
 *
 * 서버가 켜질 때 모든 데이터를 한 번만 읽어서 메모리에 올려 두고,
 * 바뀐 것만 모아서 1초쯤 뒤에 한꺼번에 저장해요. (학생이 버튼을 누를 때마다 DB를 읽지 않아요)
 *
 *  - FIREBASE_KEY 환경 변수가 있으면 → Firebase Firestore 에 저장 (Render 무료 서버에서도 데이터가 남아요)
 *  - 없으면 → data/store.json 파일에 저장 (내 컴퓨터에서 시험해 볼 때)
 *
 * Firestore 구조
 *   farms/{학생키}   { data: 농장 JSON 문자열, name, at }
 *   meta/settings   { data: JSON }   열린차시, 농장하루, 하루차시 …
 *   meta/roster     { data: JSON }   학생 명단 [{no, name, pw}]
 *   logs/{id}       { data: JSON }   풀이 기록 (차시를 끝낼 때마다 문서 1개)
 */
const fs = require('fs');
const path = require('path');

class Store {
  constructor() {
    this.farms = new Map();      // key -> { raw, name, at }
    this.settings = {};
    this.roster = [];
    this.logs = new Map();       // id -> rows[]
    this.dirty = new Set();
    this.timer = null;
    this.flushing = null;
    this.db = null;
    this.file = null;
    this.mode = '';
  }

  async init() {
    const key = process.env.FIREBASE_KEY;
    if (key) {
      const admin = require('firebase-admin');
      let cred;
      try { cred = JSON.parse(key); } catch (e) { throw new Error('FIREBASE_KEY 값이 올바른 JSON 이 아니에요. 서비스 계정 키 파일 내용을 통째로 붙여 넣어 주세요.'); }
      if (cred.private_key) cred.private_key = cred.private_key.replace(/\\n/g, '\n');
      admin.initializeApp({ credential: admin.credential.cert(cred) });
      this.db = admin.firestore();
      this.mode = 'firestore';
      await this.loadFirestore();
    } else {
      const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
      fs.mkdirSync(dir, { recursive: true });
      this.file = path.join(dir, 'store.json');
      this.mode = 'file';
      this.loadFile();
    }
  }

  async loadFirestore() {
    const [farms, meta, logs] = await Promise.all([
      this.db.collection('farms').get(),
      this.db.collection('meta').get(),
      this.db.collection('logs').get()
    ]);
    farms.forEach(d => { const v = d.data(); if (v.data) this.farms.set(d.id, { raw: v.data, name: v.name || '', at: v.at || 0 }); });
    meta.forEach(d => {
      const v = d.data();
      try {
        if (d.id === 'settings') this.settings = JSON.parse(v.data || '{}');
        if (d.id === 'roster') this.roster = JSON.parse(v.data || '[]');
      } catch (e) { console.error('meta 읽기 오류', d.id, e); }
    });
    logs.forEach(d => { try { this.logs.set(d.id, JSON.parse(d.data().data || '[]')); } catch (e) {} });
  }

  loadFile() {
    if (!fs.existsSync(this.file)) return;
    const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    Object.keys(j.farms || {}).forEach(k => this.farms.set(k, j.farms[k]));
    this.settings = j.settings || {};
    this.roster = j.roster || [];
    Object.keys(j.logs || {}).forEach(k => this.logs.set(k, j.logs[k]));
  }

  /* ---------- 농장 ---------- */
  loadFarm(key) {
    const r = this.farms.get(key);
    if (!r) return null;
    try { return JSON.parse(r.raw); } catch (e) { return null; }
  }
  saveFarm(key, farm, name) {
    this.farms.set(key, { raw: JSON.stringify(farm), name: name || '', at: Date.now() });
    this.mark('farm:' + key);
  }
  deleteFarm(key) {
    if (!this.farms.has(key)) return false;
    this.farms.delete(key);
    this.mark('farm:' + key);
    return true;
  }
  farmKeys() { return Array.from(this.farms.keys()); }

  /* ---------- 설정 ---------- */
  getSetting(k) { const v = this.settings[k]; return v === undefined || v === null ? '' : String(v); }
  setSetting(k, v) { this.settings[k] = String(v); this.mark('meta:settings'); }

  /* ---------- 명단 ---------- */
  getRoster() { return this.roster; }
  setRoster(list) { this.roster = list; this.mark('meta:roster'); }

  /* ---------- 풀이 기록 ---------- */
  appendLogs(rows) {
    if (!rows || !rows.length) return;
    const id = 'L' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    this.logs.set(id, rows);
    this.mark('log:' + id);
  }
  allLogRows() {
    const out = [];
    this.logs.forEach(rows => rows.forEach(r => out.push(r)));
    return out;
  }
  /** keep(row) 가 false 인 줄을 지우고, 지운 줄 수를 돌려줘요 */
  filterLogs(keep) {
    let removed = 0;
    this.logs.forEach((rows, id) => {
      const kept = rows.filter(keep);
      if (kept.length === rows.length) return;
      removed += rows.length - kept.length;
      if (kept.length) this.logs.set(id, kept); else this.logs.delete(id);
      this.mark('log:' + id);
    });
    return removed;
  }

  /* ---------- 백업 ---------- */
  snapshot() {
    const farms = {}, logs = {};
    this.farms.forEach((v, k) => { farms[k] = v; });
    this.logs.forEach((v, k) => { logs[k] = v; });
    return { savedAt: new Date().toISOString(), farms, settings: this.settings, roster: this.roster, logs };
  }

  /* ---------- 저장 (모아서 한꺼번에) ---------- */
  mark(k) {
    this.dirty.add(k);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 1000);
  }

  /** 저장은 한 줄로 차례차례 (먼저 바뀐 것이 먼저 저장돼요) */
  flush() {
    this.chain = (this.chain || Promise.resolve()).then(() => this.flushOnce());
    return this.chain;
  }

  async flushOnce() {
    const keys = Array.from(this.dirty);
    this.dirty.clear();
    if (!keys.length) return;
    try {
      await this.write(keys);
    } catch (e) {
      console.error('저장 실패, 5초 뒤 다시 시도해요:', e.message);
      keys.forEach(k => this.dirty.add(k));
      if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 5000);
    }
  }

  async write(keys) {
    if (this.mode === 'file') {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.snapshot()));
      fs.renameSync(tmp, this.file);
      return;
    }
    const db = this.db;
    for (let i = 0; i < keys.length; i += 400) {
      const batch = db.batch();
      keys.slice(i, i + 400).forEach(k => {
        const [type, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
        if (type === 'farm') {
          const r = this.farms.get(id), ref = db.collection('farms').doc(id);
          if (r) batch.set(ref, { data: r.raw, name: r.name, at: r.at }); else batch.delete(ref);
        } else if (type === 'meta') {
          const val = id === 'settings' ? this.settings : this.roster;
          batch.set(db.collection('meta').doc(id), { data: JSON.stringify(val), at: Date.now() });
        } else if (type === 'log') {
          const rows = this.logs.get(id), ref = db.collection('logs').doc(id);
          if (rows) batch.set(ref, { data: JSON.stringify(rows), at: Date.now() }); else batch.delete(ref);
        }
      });
      await batch.commit();
    }
  }
}

module.exports = Store;
