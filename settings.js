/**
 * 수학 농장 · 설정 (= Apps Script 의 01_설정.gs 와 똑같은 내용)
 * 게임 규칙에 쓰이는 숫자는 모두 여기에서 바꿀 수 있어요.
 * Apps Script 에서 숫자를 바꿔 썼다면, 01_설정.gs 내용을 통째로 이 파일에 붙여 넣어도 돼요.
 * (CFG 와 아래 함수들 이름만 그대로면 서버가 알아서 읽어요. 단, 시트 이름 같은 칸은 이제 쓰지 않아요.)
 */
var CFG = {
  TZ: 'Asia/Seoul',

  // 시트 이름 (서버판에서는 쓰지 않아요. 지워도 괜찮아요)
  SHEET_STUDENTS: '학생명단',
  SHEET_TEACHERS: '교사',
  SHEET_SETTINGS: '설정',
  SHEET_FARMS: '농장데이터',
  SHEET_LOG: '풀이기록',

  // 문제 풀이
  MAX_TRY: 3,            // 한 문제에 도전할 수 있는 횟수 (틀리면 힌트 → 다시 도전)
  ZONE_NEED: 2,          // 1~4번, 5~7번, 8~10번(기본) 구간에서 동물을 받으려면 맞혀야 하는 문제 수

  // 특별한 동물
  LEGEND_MIN: 0.03,      // 농장 레벨 1~LEGEND_FLAT 일 때 전설 확률
  LEGEND_FLAT: 3,        // 이 레벨까지는 LEGEND_MIN 으로 그대로 유지
  LEGEND_MAX: 0.10,      // 농장 레벨 10일 때 전설 확률 (레벨 4부터 10까지 일정하게 올라요)
  PITY: 20,              // 사고력 뽑기 20번째에는 전설 확정 (전설을 받으면 다시 0부터)
  GOLD_P: 0.10,          // 사고력 뽑기에서 황금 동물이 나올 확률

  // 사고력 보너스: 8~10번 사고력 문제 3개를 모두 '한 번에' 맞히면 농장 최대 마릿수가 이만큼 늘어나요
  // (같은 차시에서는 한 번만, 건물을 업그레이드해도 그대로 유지돼요)
  ADV_CAP_BONUS: 1,

  // 농장 레벨: 레벨 n이 되려면 누적 몇 차시를 완료해야 하는지 (앞에서부터 레벨 1, 2, 3 ...)
  // 1~3레벨은 1차시마다, 4~7레벨은 2차시마다, 8~10레벨은 3차시마다 오름
  LEVEL_AT: [0, 1, 2, 3, 5, 7, 9, 11, 14, 17],

  // 레벨업 보상: 농장 레벨이 한 단계 오를 때마다 받는 골드 (한 번에 두 단계가 오르면 두 번 받아요)
  LEVEL_GOLD: 300,

  // 하루에 한 번 받는 골드 (최소, 최대)
  PAY: { b: [15, 20], m: [20, 25], t: [30, 35], s: [50, 50] },

  // 농장 건물 (cap = 최대 마릿수, cost = 업그레이드 비용)
  BARN: [
    { name: '작은 오두막', cap: 6,  cost: 0,     w: 44,  h: 38 },
    { name: '나무 헛간',   cap: 15, cost: 1000,  w: 58,  h: 48 },
    { name: '빨간 헛간',   cap: 25, cost: 5000,  w: 80,  h: 64 },
    { name: '대농장',      cap: 40, cost: 14000, w: 106, h: 78 }
  ],
  // 건물 단계별 내 땅 크기 (가로, 세로)
  LAND: [[220, 140], [300, 200], [390, 260], [490, 340]],
  WORLD: [512, 352],

  // 동물 종류
  ANIMALS: {
    b: ['dog', 'cat', 'chicken', 'duck'],          // 기초
    m: ['cow', 'goat', 'sheep', 'horse'],          // 기본
    t: ['wolf', 'platy', 'parrot', 'otter'],       // 사고력
    g: ['gchicken', 'gsheep'],                     // 황금
    l: ['wdragon', 'unicorn', 'kumiho', 'phoenix'] // 전설
  },
  NAMES: {
    dog: '강아지', cat: '고양이', chicken: '닭', duck: '오리',
    cow: '소', goat: '염소', sheep: '양', horse: '말',
    wolf: '늑대', platy: '오리너구리', parrot: '앵무새', otter: '수달',
    gchicken: '황금닭', gsheep: '황금양',
    wdragon: '용', unicorn: '유니콘', kumiho: '구미호', phoenix: '불사조'
  },

  // 상점 (price = 가격, w/h = 그림 크기라서 바꾸지 마세요)
  ITEMS: {
    path:     { name: '흙길',          price: 30,    w: 16, h: 16 },
    fence:    { name: '울타리',        price: 60,    w: 34, h: 12 },
    fenceV:   { name: '울타리',        price: 60,    w: 6,  h: 40 },
    flower:   { name: '꽃밭',          price: 100,   w: 18, h: 10 },
    tspring:  { name: '벚꽃나무',      price: 300,   w: 24, h: 28 },
    tsummer:  { name: '소나무',        price: 300,   w: 24, h: 30 },
    tfall:    { name: '단풍나무',      price: 300,   w: 24, h: 28 },
    twinter:  { name: '눈 덮인 나무',  price: 300,   w: 24, h: 28 },
    scare:    { name: '허수아비',      price: 400,   w: 20, h: 30 },
    lantern:  { name: '등불',          price: 500,   w: 10, h: 24 },
    bench:    { name: '벤치',          price: 800,   w: 22, h: 14 },
    arch:     { name: '꽃 아치',       price: 2000,  w: 32, h: 32 },
    gazebo:   { name: '정자',          price: 4000,  w: 48, h: 46 },
    windmill: { name: '풍차',          price: 5000,  w: 40, h: 62 },
    fountain: { name: '분수',          price: 6000,  w: 38, h: 30 },
    balloon:  { name: '열기구',        price: 8000,  w: 28, h: 50 },
    statue:   { name: '황금 동물 동상', price: 15000, w: 36, h: 42 },
    // 상점에서 팔지 않는 특별한 물건 (작물 5종을 모두 유기농으로 키우면 보관함으로 받아요)
    greenhouse: { name: '친환경 온실', price: 0, w: 44, h: 38, special: true }
  },

  /* ================= 텃밭 (실과 · 친환경 농업) =================
   * 농장의 '하루'는 선생님이 새 차시를 여는 순간 지나가요. (동물 동전, 먹이, 텃밭 모두 같은 기준)
   *  - 친환경 농법으로 심으면: 다음 차시 문제를 다 푼 뒤 수확
   *  - 친환경이 아닌 방법이면: 바로 1개 수확, 대신 땅이 지쳐서 다음 차시에 '땅 살리기'를 해야 그다음 차시부터 다시 심을 수 있어요
   */
  PLOTS: [1, 2, 3, 3],      // 건물 단계별 텃밭 칸 수 (작은 오두막, 나무 헛간, 빨간 헛간, 대농장)
  COMPOST_SHED: 3,          // 이 건물 단계부터 '퇴비 창고' 보너스 (대농장)
  BONUS_P: 0.3,             // 친환경 수확 때 +1개 확률 (짝꿍 작물 / 동물 똥 퇴비 / 퇴비 창고 각각 따로 굴려요)
  EVENT_P: 0.4,             // 수확하는 날 텃밭에 사건(진딧물·잡초·가뭄)이 생길 확률 (하루에 한 번)
  MANURE: ['chicken', 'cow', 'goat', 'sheep', 'horse'],  // 이 동물이 농장에 있으면 '동물 똥 퇴비' 보너스
  FEED: { base: 0.5, eco: 0.25, fav: 0.25 },  // 먹이 골드 = 그 동물 하루 골드 × (기본 + 친환경 작물 + 좋아하는 작물)
  MARKS: [2, 3],            // 같은 작물을 친환경으로 2번 수확하면 '무농약', 3번이면 '유기농'
  AWARD: 'greenhouse',      // 주 작물 5종이 모두 유기농이 되면 받는 특별한 물건

  // 주 작물: opts = 고를 수 있는 농법 (OPTS 의 이름), fav = 좋아하는 동물, buddy = 짝꿍 작물
  CROPS: {
    rice:    { name: '벼',     fav: ['chicken', 'duck'], buddy: '',         opts: ['duck', 'snail', 'herbicide', 'chem'] },
    cabbage: { name: '배추',   fav: ['cow', 'goat'],     buddy: 'scallion', opts: ['ladybug', 'net', 'pesticide', 'chem'] },
    carrot:  { name: '당근',   fav: ['horse', 'sheep'],  buddy: 'scallion', opts: ['straw', 'weeding', 'herbicide', 'chem'] },
    corn:    { name: '옥수수', fav: ['parrot', 'chicken'], buddy: 'bean',   opts: ['compost', 'rain', 'growth', 'chem'] },
    tomato:  { name: '토마토', fav: ['dog', 'otter'],    buddy: 'basil',    opts: ['garlic', 'compost', 'growth', 'pesticide'] },
    // 짝꿍 작물: 그 자체가 친환경 방법이라 농법을 고르지 않아요. 주 작물 바로 옆 칸에 있으면 주 작물 수확 +1 확률
    basil:    { name: '바질', side: true, fav: [], desc: '토마토 옆에 심으면 향기로 해충을 쫓아요' },
    scallion: { name: '쪽파', side: true, fav: [], desc: '배추·당근 옆에 심으면 냄새로 해충을 막아요' },
    bean:     { name: '콩',   side: true, fav: [], desc: '옥수수 옆에 심으면 땅에 양분(질소)을 채워 줘요' }
  },
  MAIN: ['rice', 'cabbage', 'carrot', 'corn', 'tomato'],
  SIDE: ['basil', 'scallion', 'bean'],

  // 농법·대처 방법 (eco = 친환경인지, need = 이 동물이 있어야 고를 수 있음, why = 고른 뒤 보여 주는 설명)
  OPTS: {
    duck:      { t: '오리 농법', d: '논에 오리를 풀어 키워요', eco: true, need: ['duck'], why: '오리가 잡초와 벌레를 먹고, 오리 똥은 거름이 돼요. 농약 없이 벼를 키우는 친환경 농법이에요.' },
    snail:     { t: '우렁이 농법', d: '논에 우렁이를 넣어요', eco: true, why: '우렁이가 어린 잡초를 먹어 치워서 제초제가 필요 없어요.' },
    ladybug:   { t: '무당벌레 풀어 주기', d: '진딧물을 먹는 곤충을 데려와요', eco: true, why: '무당벌레는 진딧물의 천적이에요. 천적을 이용하면 농약 없이 해충을 줄일 수 있어요.' },
    net:       { t: '그물망 씌우기', d: '벌레가 못 들어오게 덮어요', eco: true, why: '촘촘한 그물망을 씌우면 나비가 알을 낳지 못해 배추벌레가 줄어요.' },
    straw:     { t: '볏짚 덮어 주기', d: '흙 위를 볏짚으로 덮어요', eco: true, why: '볏짚으로 흙을 덮으면 잡초가 덜 나고 흙이 촉촉하게 유지돼요. 볏짚은 나중에 거름이 돼요.' },
    weeding:   { t: '손으로 김매기', d: '잡초를 직접 뽑아요', eco: true, why: '힘은 들지만 약을 쓰지 않아서 흙과 물이 깨끗하게 지켜져요.' },
    compost:   { t: '퇴비 주기', d: '낙엽·동물 똥을 썩혀 만든 거름을 줘요', eco: true, why: '퇴비는 흙을 폭신하게 하고 흙 속 생물을 늘려 땅을 건강하게 만들어요.' },
    rain:      { t: '빗물 모아 주기', d: '빗물 저금통에 모은 물을 줘요', eco: true, why: '빗물을 모아 쓰면 지하수를 아끼고 물을 아껴 쓰는 친환경 농사가 돼요.' },
    garlic:    { t: '마늘·고추 즙 뿌리기', d: '천연 재료로 벌레를 쫓아요', eco: true, why: '마늘과 고추처럼 자연에서 얻은 재료로 만든 천연 방제제는 환경을 해치지 않아요.' },
    herbicide: { t: '제초제 뿌리기', d: '잡초를 한 번에 없애요', eco: false, why: '제초제는 잡초를 빨리 없애지만 흙과 물을 오염시키고 땅을 지치게 해요.' },
    pesticide: { t: '살충제 뿌리기', d: '벌레를 한 번에 없애요', eco: false, why: '살충제는 해충뿐 아니라 꿀벌·무당벌레 같은 이로운 곤충까지 죽이고, 작물에 남을 수 있어요.' },
    chem:      { t: '화학 비료 듬뿍 주기', d: '작물이 금방 쑥쑥 자라요', eco: false, why: '화학 비료를 너무 많이 주면 흙이 딱딱해지고 흙 속 생물이 줄어요.' },
    growth:    { t: '성장 촉진제 뿌리기', d: '열매가 빨리 커져요', eco: false, why: '성장 촉진제 같은 화학 약품은 작물과 흙에 남을 수 있어서 친환경 농업에서는 쓰지 않아요.' },
    // 땅 살리기
    healCompost: { t: '퇴비 넣기', d: '잘 썩은 거름을 흙에 섞어요', eco: true, why: '퇴비를 넣으면 흙 속 생물이 다시 늘어나 땅이 건강해져요.' },
    healBean:    { t: '콩 심어 갈아엎기', d: '콩을 길러 흙에 섞어요 (녹비 작물)', eco: true, why: '콩 뿌리에 사는 뿌리혹박테리아가 공기 속 질소를 땅에 채워 줘요. 이렇게 땅을 살리는 작물을 녹비 작물이라고 해요.' },
    healChem:    { t: '화학 비료 더 넣기', d: '비료로 영양을 채워요', eco: false, why: '지친 땅에 화학 비료를 더 넣으면 흙이 더 딱딱해지고 흙 속 생물이 줄어요. 한 차시 더 쉬어야 해요.' },
    healPoison:  { t: '흙 소독약 뿌리기', d: '흙 속 벌레와 균을 없애요', eco: false, why: '소독약은 나쁜 균뿐 아니라 흙을 살리는 좋은 생물까지 없애요. 한 차시 더 쉬어야 해요.' },
    // 사건 대처
    pump:        { t: '지하수 펑펑 끌어 쓰기', d: '물을 마음껏 줘요', eco: false, why: '지하수를 함부로 많이 쓰면 땅속 물이 마르고 땅이 내려앉을 수 있어요.' },
    mulch:       { t: '볏짚 덮어 촉촉하게', d: '흙이 마르지 않게 덮어요', eco: true, why: '볏짚으로 흙을 덮으면 물이 덜 날아가서 물을 아낄 수 있어요.' }
  },
  HEAL: ['healCompost', 'healBean', 'healChem', 'healPoison'],
  EVENTS: {
    aphid:   { t: '진딧물이 생겼어요!', d: '잎 뒤에 작은 벌레가 잔뜩 붙었어요. 어떻게 할까요?', opts: ['ladybug', 'garlic', 'pesticide'] },
    weeds:   { t: '잡초가 무성해요!', d: '작물보다 잡초가 더 크게 자랐어요. 어떻게 할까요?', opts: ['weeding', 'straw', 'herbicide'] },
    drought: { t: '비가 오지 않아 땅이 말랐어요!', d: '흙이 바싹 말랐어요. 어떻게 할까요?', opts: ['rain', 'mulch', 'pump'] }
  }
};

/** 동물이 어느 등급인지 (골드 계산용) */
function payClass_(t) {
  var A = CFG.ANIMALS;
  if (A.b.indexOf(t) >= 0) return 'b';
  if (A.m.indexOf(t) >= 0) return 'm';
  if (A.t.indexOf(t) >= 0) return 't';
  return 's';
}

function isSpecial_(t) {
  return CFG.ANIMALS.g.indexOf(t) >= 0 || CFG.ANIMALS.l.indexOf(t) >= 0;
}

/**
 * 동물마다 그날 받을 골드. 동물 번호와 날짜로 정해지기 때문에
 * 화면에서 미리 보여 주는 숫자와 서버가 주는 숫자가 항상 같아요.
 */
function dailyAmount_(t, id, day) {
  var r = CFG.PAY[payClass_(t)], s = id + '|' + day, h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return r[0] + (Math.abs(h) % (r[1] - r[0] + 1));
}

/** 누적 차시 수 → 레벨 정보 */
function levelInfo_(n) {
  var at = CFG.LEVEL_AT, lv = 1;
  for (var i = 0; i < at.length; i++) if (n >= at[i]) lv = i + 1;
  var max = lv >= at.length;
  return {
    level: lv,
    toNext: max ? 0 : at[lv] - n,
    need: max ? 0 : at[lv] - at[lv - 1],
    max: max
  };
}

/** 레벨에 따른 전설 확률 */
function legendChance_(level) {
  if (level <= CFG.LEGEND_FLAT) return CFG.LEGEND_MIN;
  return CFG.LEGEND_MIN + (CFG.LEGEND_MAX - CFG.LEGEND_MIN) * (level - CFG.LEGEND_FLAT) / (10 - CFG.LEGEND_FLAT);
}

/** 화면에 넘겨 줄 설정값 */
function clientCfg_() {
  return {
    MAX_TRY: CFG.MAX_TRY, ZONE_NEED: CFG.ZONE_NEED, PAY: CFG.PAY, BARN: CFG.BARN, LAND: CFG.LAND,
    ANIMALS: CFG.ANIMALS, NAMES: CFG.NAMES, ITEMS: CFG.ITEMS, LEVEL_AT: CFG.LEVEL_AT,
    LEVEL_GOLD: CFG.LEVEL_GOLD, ADV_CAP_BONUS: CFG.ADV_CAP_BONUS,
    GARDEN: gardenClientCfg_()
  };
}

/** 텃밭 설정 중 화면에 필요한 것만 (어느 방법이 친환경인지는 보내지 않아요 — 고른 뒤 서버가 알려 줘요) */
function gardenClientCfg_() {
  var opts = {};
  Object.keys(CFG.OPTS).forEach(function (k) { var o = CFG.OPTS[k]; opts[k] = { t: o.t, d: o.d, need: o.need || [] }; });
  var events = {};
  Object.keys(CFG.EVENTS).forEach(function (k) { var e = CFG.EVENTS[k]; events[k] = { t: e.t, d: e.d, opts: e.opts }; });
  return {
    PLOTS: CFG.PLOTS, COMPOST_SHED: CFG.COMPOST_SHED, MANURE: CFG.MANURE, FEED: CFG.FEED, MARKS: CFG.MARKS,
    CROPS: CFG.CROPS, MAIN: CFG.MAIN, SIDE: CFG.SIDE, OPTS: opts, HEAL: CFG.HEAL, EVENTS: events
  };
}
