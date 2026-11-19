/**
 * 수학 농장 · 서버 부르기
 * Apps Script 의 google.script.run 과 똑같이 쓸 수 있게 만든 것이에요.
 * 그래서 화면 코드(app, farm, quiz, teacher, extras)는 하나도 고치지 않아도 돼요.
 *
 *  google.script.run.withSuccessHandler(ok).withFailureHandler(fail).api_xxx(인자들)
 *    → POST /api/api_xxx  { args: [인자들], rid: 요청 번호 }
 *
 * 인터넷이 잠깐 끊기거나 느리면 같은 요청 번호로 최대 4번까지 다시 보내요.
 * (서버는 같은 번호를 두 번 받으면 처음 결과를 돌려주기 때문에, 골드가 두 번 빠지는 일은 없어요)
 */
(function () {
  var TIMEOUT = 20000, MAX_TRY = 4;

  function call(fn, args, ok, fail) {
    var rid = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
    var body = JSON.stringify({ args: args, rid: rid });
    var tries = 0;
    function go() {
      tries++;
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
      fetch('/api/' + fn, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: body, signal: ctl ? ctl.signal : undefined
      }).then(function (res) {
        clearTimeout(timer);
        if (res.status === 401) { var e = new Error('로그인이 풀렸어요. 새로고침해 주세요.'); e.noRetry = true; throw e; }
        if (!res.ok) throw new Error('서버 응답 ' + res.status);
        return res.json();
      }).then(function (j) {
        if (j.ok) { if (ok) ok(j.r); }
        else if (fail) fail(new Error(j.e));
      }).catch(function (err) {
        clearTimeout(timer);
        if (err && err.noRetry) {
          if (fail) fail(err);
          setTimeout(function () { location.href = '/login'; }, 1500);
          return;
        }
        if (tries < MAX_TRY) { setTimeout(go, 700 * tries); return; }
        if (fail) fail(new Error('인터넷 연결이 느려요. 잠시 뒤에 다시 눌러 주세요.'));
      });
    }
    go();
  }

  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
        if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
        if (name === 'withUserObject') return function () { return runner(ok, fail); };
        return function () { call(String(name), [].slice.call(arguments), ok, fail); };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = { run: runner(null, null), host: { close: function () {} } };
})();
