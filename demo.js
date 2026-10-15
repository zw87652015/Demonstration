/* ILM product demo — frame-based: real ILM screenshots crossfading inside a
   floating app window, with a pan/zoom camera, fake cursor, captions below
   the window and overlay cards.
   One code path for both languages; strings from DEMO_STRINGS[DEMO_LANG],
   frame paths + hotspots from window.FRAMES_<lang> (frames/<lang>/hotspots.js) */
(function () {
  'use strict';
  var LANG = window.DEMO_LANG || 'zh';
  var S = DEMO_STRINGS[LANG];
  var F = window['FRAMES_' + LANG] || { frames: {}, hot: {}, exported: '' };
  var HOT = F.hot || {};

  var params = new URLSearchParams(location.search);
  var SPEED = parseFloat(params.get('speed') || '1');
  var SEEK = parseFloat(params.get('t') || 'NaN');
  var PAUSE = params.get('pause') === '1';
  var LOOP = params.get('loop') === '1';
  var FF = false; // fast-forward (seek) mode: everything instant

  document.body.dataset.lang = LANG;
  window.onerror = function (m) { document.title = 'ERR:' + m; };

  var stage = document.getElementById('stage');
  var EASE = 'cubic-bezier(.22,.61,.36,1)';
  var SPRING = 'cubic-bezier(.34,1.56,.5,1)';

  /* ---------------- stage scaling ---------------- */
  function fit() {
    var s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = 'translate(' + ((innerWidth - 1920 * s) / 2) + 'px,' +
      ((innerHeight - 1080 * s) / 2) + 'px) scale(' + s + ')';
  }
  addEventListener('resize', fit); fit();

  /* ---------------- DOM helpers ---------------- */
  function el(tag, cls, parent, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    (parent || stage).appendChild(e);
    return e;
  }
  function place(e, r) {
    e.style.left = r[0] + 'px'; e.style.top = r[1] + 'px';
    e.style.width = r[2] + 'px'; e.style.height = r[3] + 'px';
  }

  /* ---------------- clock ---------------- */
  var cues = [], sleepers = [], elapsed = 0, clockStarted = false;
  var vNow = 0, vsleep = []; // virtual clock used while seeking (FF)
  function at(t, fn) { cues.push({ t: t, fn: fn }); }
  /* scene list: each scene starts right after the previous one, so a
     duration change never requires editing later cues. */
  var T = 0.35, SCENES = [];
  function scene(id, dur, build) {
    var t0 = T; T += dur;
    SCENES.push({ id: id, t0: t0, dur: dur });
    build(t0);
  }
  var END_T = 0;
  function wait(sec) {
    if (FF) return new Promise(function (r) { vsleep.push({ t: vNow + sec, r: r }); });
    return new Promise(function (r) { sleepers.push({ t: elapsed + sec, r: r }); });
  }
  var lastNow = 0;
  function tick(now) {
    if (!clockStarted) return;
    var dt = (now - lastNow) / 1000; lastNow = now;
    if (document.hidden) { requestAnimationFrame(tick); return; }
    elapsed += dt * SPEED;
    for (var i = sleepers.length - 1; i >= 0; i--) if (sleepers[i].t <= elapsed) { var s = sleepers.splice(i, 1)[0]; s.r(); }
    for (var j = 0; j < cues.length; j++) if (!cues[j].done && cues[j].t <= elapsed) { cues[j].done = true; cues[j].fn(); }
    if (LOOP && elapsed > END_T + 4) { location.reload(); return; }
    requestAnimationFrame(tick);
  }

  /* ---------------- animation helpers ---------------- */
  function applyKf(elm, kf) {
    var last = kf[kf.length - 1];
    Object.keys(last).forEach(function (k) {
      if (k === 'offset' || k === 'easing') return;
      try { elm.style[k] = last[k]; } catch (e) {}
    });
  }
  /* while seeking, jump to the end state but still spend the duration on
     the virtual clock, so ?t= lands where real playback would be */
  function tween(elm, kf, ms, easing) {
    if (FF) { applyKf(elm, kf); return wait(ms / 1000); }
    var a = elm.animate(kf, { duration: ms / SPEED, easing: easing || EASE, fill: 'forwards' });
    return a.finished.catch(function () {});
  }
  function show(elm, ms) { elm.classList.remove('hidden'); return tween(elm, [{ opacity: 0 }, { opacity: 1 }], ms || 400); }
  function hide(elm, ms) {
    return tween(elm, [{ opacity: 1 }, { opacity: 0 }], ms || 400).then(function () {
      elm.classList.add('hidden');
    });
  }
  function pop(elm, ms) {
    elm.classList.remove('hidden');
    return tween(elm, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }], ms || 450, SPRING);
  }
  function fadeOutRemove(elm, ms) {
    return tween(elm, [{ opacity: 1 }, { opacity: 0 }], ms || 300).then(function () { elm.remove(); });
  }

  /* ================= APP WINDOW (real frames) =================
     #win scales the 1920x1080 app to a floating window so the caption bar
     sits underneath it instead of over the figure. Every coordinate inside
     the app (hotspots, cursor, overlays) stays in 1920x1080 frame space. */
  var win = el('div', '', stage); win.id = 'win';
  var app = el('div', '', win); app.id = 'app';
  var zoomer = el('div', 'zoomer', app);           // frames + canvas-space marks
  var framesBox = el('div', 'frames', zoomer);
  var ov = el('div', 'appov', app);                // unzoomed overlays (explorer, chat…)
  var curLayer = el('div', 'curlayer', app);       // follows the camera, above overlays
  var curFrame = null;
  function frameImg(key) {
    var img = document.createElement('img');
    img.className = 'frameimg';
    img.src = F.frames[key];
    return img;
  }
  function setFrame(key, ms) {
    if (!F.frames[key]) return Promise.resolve();
    var img = frameImg(key);
    img.style.opacity = 0;
    framesBox.appendChild(img);
    var old = curFrame;
    curFrame = img;
    return tween(img, [{ opacity: 0 }, { opacity: 1 }], ms || 300).then(function () {
      if (old && old.parentNode === framesBox && old !== curFrame) old.remove();
    });
  }
  curFrame = frameImg('empty'); framesBox.appendChild(curFrame);

  /* ---------------- camera ----------------
     translate+scale with origin 0 0, so moving from one zoom target to the
     next is a smooth pan instead of an origin jump. The target rect is
     centred where possible and the view never leaves the frame. */
  var cam = { tx: 0, ty: 0, s: 1 };
  function camCss(c) { return 'translate(' + c.tx + 'px,' + c.ty + 'px) scale(' + c.s + ')'; }
  function camTo(c, ms) {
    var from = camCss(cam), to = camCss(c);
    cam = c;
    return Promise.all([zoomer, curLayer].map(function (e) {
      return tween(e, [{ transform: from }, { transform: to }], ms || 550);
    }));
  }
  function zoomTo(rect, s, ms) {
    var cx = rect[0] + rect[2] / 2, cy = rect[1] + rect[3] / 2;
    var tx = Math.min(0, Math.max(1920 * (1 - s), 960 - cx * s));
    var ty = Math.min(0, Math.max(1080 * (1 - s), 540 - cy * s));
    return camTo({ tx: tx, ty: ty, s: s }, ms);
  }
  function zoomOut(ms) { return camTo({ tx: 0, ty: 0, s: 1 }, ms || 450); }

  function hot(name, fallback) { return HOT[name] || fallback; }
  function center(r) { return { x: r[0] + r[2] / 2, y: r[1] + r[3] / 2 }; }
  function hotC(name) { return center(HOT[name] || [960, 540, 0, 0]); }

  var CELL = {
    a: hot('cell_a', [235, 256, 408, 240]), b: hot('cell_b', [656, 256, 409, 240]),
    c: hot('cell_c', [1078, 256, 409, 240]), d: hot('cell_d', [235, 544, 595, 385]),
    e: hot('cell_e', [866, 544, 619, 385])
  };
  var pageRect = [CELL.a[0], CELL.a[1], CELL.e[0] + CELL.e[2] - CELL.a[0], CELL.e[1] + CELL.e[3] - CELL.a[1]];
  /* the cell's top-right Inset drop zone, same geometry as
     CellItem._pip_zone_rect (30% x 22%, 1.5 mm margin on a 210 mm page) */
  var MM = pageRect[2] / 210;
  var PIP_ZONE = hot('pip_zone', [CELL.a[0] + CELL.a[2] * .70 - 1.5 * MM, CELL.a[1] + 1.5 * MM, CELL.a[2] * .30, CELL.a[3] * .22]);
  /* x-axis lines [y, x0, x1] measured from the frames before/after Reflow */
  var AX = {
    d0: hot('axis_d_before', [842, 328, 829]), e0: hot('axis_e_before', [882, 934, 1484]),
    d1: hot('axis_d_after', [912, 305, 829]), e1: hot('axis_e_after', [912, 937, 1484])
  };
  var REFLOW_TOGGLE = hot('reflow_toggle', [1866, 140, 42, 24]);
  var REFLOW_CARD = hot('reflow_card', [1526, 120, 394, 62]);

  /* ---------------- cursor ---------------- */
  var cursor = el('div', '', curLayer);
  cursor.id = 'cursor';
  cursor.innerHTML = '<svg width="28" height="36" viewBox="0 0 28 36"><path d="M4 2 L4 28 L10 23 L14 33 L18 31 L14 21 L22 20 Z" fill="#fff" stroke="#1E2433" stroke-width="1.8"/></svg><div class="clickring"></div>';
  var ring = cursor.querySelector('.clickring');
  var curX = 960, curY = 540, curVisible = false;
  function cursorVis(v, ms) {
    if (curVisible === v) return Promise.resolve();
    curVisible = v;
    return tween(cursor, [{ opacity: v ? 0 : 1 }, { opacity: v ? 1 : 0 }], ms || 250);
  }
  function showCursor() { return cursorVis(true); }
  function hideCursor() { return cursorVis(false); }
  function cursorTo(x, y, ms) {
    if (x && x.x !== undefined) { ms = y; y = x.y; x = x.x; }
    cursorVis(true, 200);
    if (ms === undefined) ms = Math.min(650, Math.max(300, Math.hypot(x - curX, y - curY) * .45));
    curX = x; curY = y;
    cursor.style.left = (x - 6) + 'px'; cursor.style.top = (y - 4) + 'px';
    if (FF) { cursor.style.transition = 'none'; return wait(ms / 1000); }
    cursor.style.transition = 'left ' + ms + 'ms ' + EASE + ', top ' + ms + 'ms ' + EASE;
    return wait(ms / 1000);
  }
  function clickFx() {
    if (FF) return wait(.16);
    cursor.animate([{ transform: 'scale(1)' }, { transform: 'scale(.82)' }, { transform: 'scale(1)' }], { duration: 220, easing: EASE });
    ring.animate([{ opacity: .9, transform: 'translate(-50%,-50%) scale(.4)' }, { opacity: 0, transform: 'translate(-50%,-50%) scale(3.4)' }], { duration: 500, easing: 'ease-out', fill: 'forwards' });
    return wait(.16);
  }
  /* drag image trailing below-right of the pointer, like an OS drag */
  function moveGhost(g, x, y, ms) {
    void g.offsetWidth;   // commit the previous position so the transition runs
    g.style.transition = ms && !FF ? 'left ' + ms + 'ms ' + EASE + ', top ' + ms + 'ms ' + EASE : 'none';
    g.style.left = (x + 14) + 'px'; g.style.top = (y + 20) + 'px';
  }
  /* target: hotspot name, [x,y,w,h] rect or {x,y} point */
  function click(target, ms) {
    var p = typeof target === 'string' ? hotC(target)
      : Array.isArray(target) ? center(target) : target;
    return cursorTo(p.x, p.y, ms).then(clickFx);
  }

  /* ---------------- caption + pain→solution kicker ---------------- */
  var capbar = el('div', '', stage); capbar.id = 'capbar';
  var kicker = el('div', 'kicker', capbar);
  var capIn = el('span', 'cap-inner', capbar);
  var capVisible = false;
  function kickerHtml(pain, sol) {
    return (pain ? '<span class="pain">✕ ' + pain + '</span><span class="arr"> → </span>' : '') +
      (sol ? '<span class="sol">✓ ' + sol + '</span>' : '');
  }
  /* caption(key, pain, sol): pain/sol omitted keeps the current kicker */
  function caption(key, pain, sol) {
    var txt = S[key]; if (!txt) return Promise.resolve();
    var kh = pain === undefined && sol === undefined ? null : kickerHtml(pain, sol);
    function apply() { capIn.textContent = txt; if (kh !== null) kicker.innerHTML = kh; }
    if (!capVisible) {
      capVisible = true; apply();
      return tween(capbar, [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }], 500);
    }
    var parts = kh !== null && kh !== kicker.innerHTML ? [capIn, kicker] : [capIn];
    return Promise.all(parts.map(function (p) { return tween(p, [{ opacity: 1 }, { opacity: 0 }], 150); }))
      .then(function () {
        apply();
        return Promise.all(parts.map(function (p) { return tween(p, [{ opacity: 0 }, { opacity: 1 }], 220); }));
      });
  }
  function captionOff() {
    if (!capVisible) return Promise.resolve();
    capVisible = false;
    return tween(capbar, [{ opacity: 1 }, { opacity: 0 }], 350);
  }

  /* flash highlight over a frame-space rect (follows the camera) */
  function flashRect(rect, ms) {
    var fl = el('div', 'hl', zoomer); place(fl, rect);
    return tween(fl, [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], ms || 900)
      .then(function () { fl.remove(); });
  }

  /* ================= shared backdrop ================= */
  function mkBackdrop(z) {
    var b = el('div', 'backdrop', stage); b.style.zIndex = z;
    var g = el('div', 'bggrid', b);
    for (var i = 0; i < 14; i++) {
      var p = el('div', 'panel', g);
      var w = 140 + Math.random() * 260, h = 100 + Math.random() * 200;
      p.style.cssText = 'width:' + w + 'px;height:' + h + 'px;left:' +
        (Math.random() * 1800) + 'px;top:' + (Math.random() * 980) + 'px;';
      p.animate([{ transform: 'translate(0,0)' },
        { transform: 'translate(' + (Math.random() * 60 - 30) + 'px,' + (Math.random() * 40 - 20) + 'px)' }],
        { duration: 6000 + Math.random() * 6000, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
    }
    return b;
  }
  var backdrop = mkBackdrop(100);
  var black = el('div', '', stage); black.style.cssText = 'position:absolute;inset:0;background:#000;z-index:9500;';
  at(0.05, function () {
    tween(black, [{ opacity: 1 }, { opacity: 0 }], 350).then(function () { black.remove(); });
  });

  /* ================= C0 COLD OPEN — the payoff first =================
     The five panels of the real exported figure start scattered (the
     "PowerPoint" state) and snap into the finished layout. */
  var EXP_W = 2480, EXP_H = 1418;
  var PIECES = [
    { r: [0, 0, 811, 461], m: [-150, 70, -7, .86] },
    { r: [835, 0, 811, 461], m: [40, -95, 5, 1.08] },
    { r: [1669, 0, 811, 461], m: [170, 55, -4, .8] },
    { r: [0, 476, 1240, 942], m: [-110, 95, 3.5, .9] },
    { r: [1252, 476, 1228, 942], m: [130, -40, -6, 1.12] }
  ];
  var COLD_W = 1080, COLD_K = COLD_W / EXP_W, COLD_H = Math.round(EXP_H * COLD_K);
  var coldWrap = el('div', 'cold', backdrop);
  coldWrap.style.cssText = 'left:' + (960 - COLD_W / 2) + 'px;top:' + (500 - COLD_H / 2) + 'px;width:' + COLD_W + 'px;height:' + COLD_H + 'px';
  var coldSheet = el('div', 'cold-sheet', coldWrap); coldSheet.style.opacity = 0;
  var coldPieces = PIECES.map(function (p) {
    var e = el('div', 'piece', coldWrap);
    place(e, p.r.map(function (v) { return v * COLD_K; }));
    e.style.backgroundImage = 'url("' + F.exported + '")';
    e.style.backgroundSize = COLD_W + 'px ' + COLD_H + 'px';
    e.style.backgroundPosition = (-p.r[0] * COLD_K) + 'px ' + (-p.r[1] * COLD_K) + 'px';
    e.style.opacity = 0;
    return e;
  });
  var coldLine = el('div', 'cold-line', backdrop, S.cold_line); coldLine.style.opacity = 0;

  scene('cold', 2.9, function (t0) {
    at(t0, function () {
      coldPieces.forEach(function (e, i) {
        var m = PIECES[i].m;
        var messy = 'translate(' + m[0] + 'px,' + m[1] + 'px) rotate(' + m[2] + 'deg) scale(' + m[3] + ')';
        wait(i * .07).then(function () {
          return tween(e, [{ opacity: 0, transform: messy + ' translateY(30px)' }, { opacity: 1, transform: messy }], 380);
        }).then(function () { return wait(.55 - i * .07); }).then(function () {
          e.classList.add('snapped');
          return tween(e, [{ transform: messy }, { transform: 'none' }], 520, SPRING);
        });
      });
      wait(1.35).then(function () {
        tween(coldSheet, [{ opacity: 0 }, { opacity: 1 }], 300);
        return tween(coldLine, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'translateY(0)' }], 400);
      });
      wait(2.45).then(function () {
        tween(coldWrap, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.94)' }], 420);
        tween(coldLine, [{ opacity: 1 }, { opacity: 0 }], 300);
      });
    });
  });

  /* ================= S0 HOOK — the pain ================= */
  function painArt(n) {
    if (n === 1)
      return '<div class="pr" style="left:26px;top:44px;width:92px;height:112px;transform:rotate(-3deg)"></div>' +
        '<div class="pr" style="left:142px;top:60px;width:106px;height:92px;transform:rotate(2deg);animation-duration:1.4s"></div>' +
        '<div class="pr" style="left:268px;top:30px;width:76px;height:126px;transform:rotate(-2deg);animation-duration:.9s"></div>' +
        '<div class="dashline" style="top:26px"></div>';
    if (n === 2)
      return '<div class="pletters"><span style="font-family:Georgia,serif;font-size:62px">a</span>' +
        '<span style="font-family:Arial,sans-serif;font-size:36px;font-weight:700">B</span>' +
        '<span style="font-family:\'Times New Roman\',serif;font-size:48px;font-style:italic">(c)</span></div>' +
        '<div class="pchips"><i>7 pt</i><i>13 pt</i><i>10 pt</i></div>';
    if (n === 3)
      return '<svg viewBox="0 0 360 200" class="pchart" fill="none">' +
        '<path d="M30 30 V140 H160" stroke="#9AA5B1" stroke-width="2"/>' +
        '<polyline points="36,120 70,90 104,110 138,70 156,86" stroke="#7C8B99" stroke-width="2.5"/>' +
        '<path d="M200 55 V165 H330" stroke="#9AA5B1" stroke-width="2"/>' +
        '<polyline points="206,145 240,110 274,132 308,96 326,112" stroke="#7C8B99" stroke-width="2.5"/>' +
        '<line x1="18" y1="140" x2="172" y2="140" stroke="#EF4444" stroke-width="2" stroke-dasharray="7 6"/>' +
        '<line x1="188" y1="165" x2="342" y2="165" stroke="#EF4444" stroke-width="2" stroke-dasharray="7 6"/>' +
        '<path d="M180 140 V165" stroke="#EF4444" stroke-width="2"/>' +
        '<path d="M176 147 L180 140 L184 147 M176 158 L180 165 L184 158" stroke="#EF4444" stroke-width="2"/></svg>';
    return '<div class="flowchips">' + S.pain4_flow + '</div>' +
      '<svg class="rot" viewBox="0 0 24 24" fill="none" stroke="#8A97A3" stroke-width="2" stroke-linecap="round">' +
      '<path d="M20.5 12 a8.5 8.5 0 1 1 -2.6 -6.1"/><path d="M18.5 2.5 L18 6.5 L14.5 5"/></svg>' +
      '<div class="stamp">' + S.pain4_stamp + '</div>';
  }

  var hq = el('div', 'hook-q', backdrop, S.hook_q); hq.style.opacity = 0;
  var prow = el('div', 'pain-row', backdrop);
  var pcards = [];
  for (var pi = 1; pi <= 4; pi++) {
    var pc = el('div', 'pain-card', prow,
      '<div class="x-badge">✕</div><div class="pcanvas">' + painArt(pi) + '</div>' +
      '<div class="pain-title">' + S['pain' + pi] + '</div>');
    pc.style.opacity = 0;
    pcards.push(pc);
  }
  var ans = el('div', 'hook-ans', backdrop, S.hook_ans); ans.style.opacity = 0;

  scene('hook', 5.8, function (t0) {
    at(t0, function () {
      tween(hq, [{ opacity: 0, transform: 'translateY(30px)' },
        { opacity: 1, transform: 'translateY(0)' }], 500);
      pcards.forEach(function (c, i) {
        wait(0.45 + i * .22).then(function () {
          return tween(c, [{ opacity: 0, transform: 'translateY(40px)' },
            { opacity: 1, transform: 'translateY(0)' }], 480);
        });
        wait(3.0 + i * .1).then(function () {
          return pop(c.querySelector('.x-badge'), 340);
        });
      });
      wait(4.3).then(function () {
        pcards.forEach(function (c) {
          tween(c, [{ opacity: 1, transform: 'scale(1)' },
            { opacity: 0, transform: 'scale(.86)' }], 450);
        });
        tween(hq, [{ opacity: 1 }, { opacity: 0 }], 400);
        return wait(.1).then(function () { return pop(ans, 480); });
      });
    });
  });

  /* ================= S1 BRAND ================= */
  var tw = el('div', 'title-wrap', backdrop);
  var icon = el('img', 'title-icon', tw); icon.src = 'assets/icon.svg';
  icon.style.width = '150px'; icon.style.height = '150px';
  var ttl = el('div', 'title-main', tw,
    '<span class="ilm lit">I</span>mage <span class="ilm lit">L</span>ayout <span class="ilm lit">M</span>anager');
  ttl.style.fontSize = '80px';
  var tag = el('div', 'title-tag', tw, S.tagline);
  var srow = el('div', 'store-row', tw);
  var badge = el('img', 'store-badge', srow);
  badge.src = 'assets/ms-store-badge-' + LANG + '.svg';
  var spill = el('div', 'store-pill', srow,
    '<svg viewBox="0 0 24 24" fill="none" stroke="#9FB3C8" stroke-width="2.2" stroke-linecap="round">' +
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 L21 21"/></svg>' +
    '<span>' + S.store_search + '</span><b class="store-q"></b>');
  var sQ = spill.querySelector('.store-q');
  var sCaret = el('span', 'caret', spill);
  [icon, ttl, tag, srow].forEach(function (e) { e.style.opacity = '0'; });

  scene('brand', 3.4, function (t0) {
    at(t0, function () {
      tween(ans, [{ opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-160px)' }], 450);
      wait(.2).then(function () { return pop(icon, 520); });
      wait(.4).then(function () {
        return tween(ttl, [{ opacity: 0, transform: 'translateY(28px)' },
          { opacity: 1, transform: 'translateY(0)' }], 500);
      });
      wait(.7).then(function () { return tween(tag, [{ opacity: 0 }, { opacity: 1 }], 400); });
      wait(.95).then(function () {
        return tween(srow, [{ opacity: 0, transform: 'translateY(18px)' },
          { opacity: 1, transform: 'translateY(0)' }], 420);
      });
      wait(1.3).then(function () {
        var q = S.store_query, i = 0;
        (function step() {
          if (i < q.length) {
            sQ.textContent = q.slice(0, ++i);
            wait(.02).then(step);
          } else {
            wait(.3).then(function () {
              return tween(sCaret, [{ opacity: 1 }, { opacity: 0 }], 250);
            });
          }
        })();
      });
    });
    at(t0 + 2.85, function () {
      tween(tw, [{ opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(1.06)' }], 550);
      tween(backdrop, [{ opacity: 1 }, { opacity: 0 }], 600)
        .then(function () { backdrop.classList.add('hidden'); });
      show(app, 550); tween(win, [{ transform: 'scale(.80)' }, { transform: 'scale(.84)' }], 600);
    });
  });

  /* ================= A1 DROP IN, ONE CLICK ================= */
  scene('a1', 8.0, function (t0) {
    var explorer;
    at(t0, function () { caption('cap_a1', S.k1_pain, S.k1_sol); });
    at(t0 + .1, function () {
      explorer = el('div', 'ovcard explorer hidden', ov);
      explorer.style.left = '110px'; explorer.style.top = '140px';
      explorer.innerHTML = '<div class="ex-title">📁 ' + S.explorer_title + '<span style="margin-left:auto;color:#999">— ▢ ✕</span></div>';
      var exb = el('div', 'ex-body', explorer);
      [['river.jpg', 'assets/river.jpg'], ['fields.jpg', 'assets/fields.jpg'], ['coast.jpg', 'assets/coast.jpg'],
       ['response.ilmplot.svg', 'assets/response.ilmplot.svg'], ['comparison.ilmplot.svg', 'assets/comparison.ilmplot.svg']]
        .forEach(function (f) {
          var t = el('div', 'filetile', exb);
          t.innerHTML = '<img class="ft-img" src="' + f[1] + '">' + f[0];
        });
      show(explorer, 300);
    });
    at(t0 + .6, function () {
      var mq = el('div', 'sel-marquee', ov);
      var x0 = 125, y0 = 190;
      cursorTo(x0, y0, 400).then(function () {
        mq.style.cssText = 'left:' + x0 + 'px;top:' + y0 + 'px;width:0;height:0;';
        if (!FF) cursor.style.transition = 'left 600ms ' + EASE + ', top 600ms ' + EASE;
        cursor.style.left = (x0 + 490 - 6) + 'px'; cursor.style.top = (y0 + 250 - 4) + 'px';
        curX = x0 + 490; curY = y0 + 250;
        return tween(mq, [{ width: '0px', height: '0px' }, { width: '490px', height: '250px' }], 600);
      }).then(function () {
        explorer.querySelectorAll('.filetile').forEach(function (t, i) {
          wait(i * .05).then(function () { t.classList.add('sel'); });
        });
        return wait(.35);
      }).then(function () {
        mq.remove();
        var ghost = el('div', 'dragghost', ov);
        ghost.innerHTML = '<img src="assets/river.jpg"><div class="badge">5</div>';
        moveGhost(ghost, curX, curY);
        tween(ghost, [{ opacity: 0 }, { opacity: 1 }], 180);
        var dest = center(CELL.c);
        moveGhost(ghost, dest.x, dest.y, 650);
        return cursorTo(dest, 650).then(function () {
          fadeOutRemove(ghost, 180);
          setFrame('imported-gap0', 300);
          return wait(.3).then(function () { return hide(explorer, 280); });
        });
      });
    });
    at(t0 + 3.6, function () {
      var tb = hot('tb_autolayout', [864, 68, 129, 35]);
      zoomTo([tb[0] - 200, tb[1] - 30, tb[2] + 400, tb[3] + 200], 1.7, 500).then(function () {
        return click(tb, 450).then(function () {
          setFrame('autolayout', 300);
        });
      });
    });
    at(t0 + 4.9, function () {
      zoomOut(450).then(function () { flashRect(pageRect, 650); return wait(.2); }).then(function () {
        return click(hot('tb_label_in', [497, 68, 168, 35]), 420).then(function () {
          setFrame('labels', 300);
          return wait(.35);
        });
      }).then(function () {
        hideCursor();
        /* labels a–c on row 1 and d–e on row 2 */
        return zoomTo([CELL.a[0] - 10, CELL.a[1] - 10, CELL.c[0] + CELL.c[2] - CELL.a[0] + 20, 330], 1.45, 550);
      }).then(function () { return wait(.7); }).then(function () { return zoomOut(450); });
    });
  });

  /* ================= A2 ANNOTATIONS ================= */
  scene('a2', 7.8, function (t0) {
    at(t0, function () { caption('cap_a2', S.k2_pain, S.k2_sol); });
    at(t0 + .1, function () {
      click(CELL.b).then(function () {
        return setFrame('cell-b-selected', 250);
      }).then(function () {
        var sb = hot('scale_bar_chk', [1526, 198, 120, 18]);
        var sec = hot('scale_bar_section', [1548, 158, 346, 435]);
        return zoomTo([sb[0] - 20, sec[1], sec[0] + sec[2] - sb[0] + 20, 260], 1.8, 500).then(function () {
          return click(sb, 450);
        }).then(function () { return setFrame('scalebar', 250); });
      }).then(function () {
        return wait(.25).then(function () {
          hideCursor();
          /* pan straight from the checkbox to the new bar on panel b */
          var b = CELL.b;
          return zoomTo([b[0] + b[2] * .45, b[1] + b[3] * .45, b[2] * .55, b[3] * .55], 2.2, 650);
        });
      }).then(function () { return wait(.6); }).then(function () { return zoomOut(450); })
        .then(function () { return insetDrop(); })
        .then(function () {
          hideCursor();
          var a = CELL.a;
          return zoomTo([a[0], a[1], a[2], a[3]], 1.9, 550);
        }).then(function () { return wait(.6); }).then(function () { return zoomOut(450); });
    });
  });

  /* drag a file onto cell a: replace border first, then the top-right
     Inset zone takes over (mirrors CellItem._draw_pip_drop_zone) */
  function insetDrop() {
    var ex = el('div', 'ovcard explorer mini hidden', ov);
    ex.style.left = '300px'; ex.style.top = '600px';
    ex.innerHTML = '<div class="ex-title">📁 ' + S.explorer_title + '</div>';
    var tile = el('div', 'filetile', el('div', 'ex-body', ex));
    tile.innerHTML = '<img class="ft-img" src="assets/river-detail.jpg">river-detail.jpg';
    var a = CELL.a, zone, ind, ghost;
    return show(ex, 280).then(function () {
      return click(center([320 + 4, 600 + 66, 96, 62]), 500);
    }).then(function () {
      tile.classList.add('sel');
      ghost = el('div', 'dragghost', ov);
      ghost.innerHTML = '<img src="assets/river-detail.jpg">';
      moveGhost(ghost, curX, curY);
      var p = center(a);
      moveGhost(ghost, p.x, p.y, 500);
      return cursorTo(p, 500);
    }).then(function () {
      zone = el('div', 'pipzone', zoomer, S.pip_zone); place(zone, PIP_ZONE);
      ind = el('div', 'dropind', zoomer); place(ind, a);
      tween(zone, [{ opacity: 0 }, { opacity: 1 }], 150);
      return wait(.35);
    }).then(function () {
      /* lower-left of the zone keeps its centred label readable */
      var z = { x: PIP_ZONE[0] + PIP_ZONE[2] * .2, y: PIP_ZONE[1] + PIP_ZONE[3] * .78 };
      moveGhost(ghost, z.x, z.y, 380);
      return cursorTo(z, 380);
    }).then(function () {
      zone.classList.add('hover');
      return tween(ind, [{ left: a[0] + 'px', top: a[1] + 'px', width: a[2] + 'px', height: a[3] + 'px' },
        { left: PIP_ZONE[0] + 'px', top: PIP_ZONE[1] + 'px', width: PIP_ZONE[2] + 'px', height: PIP_ZONE[3] + 'px' }], 160);
    }).then(function () { return wait(.3); }).then(function () {
      clickFx();
      [zone, ind, ghost].forEach(function (e) { e.remove(); });
      hide(ex, 250).then(function () { ex.remove(); });
      return setFrame('pip', 280);
    });
  }

  /* ================= A3a PLOT EDITOR ================= */
  scene('a3a', 4.8, function (t0) {
    at(t0, function () { caption('cap_a3a', S.k3a_pain, S.k3a_sol); });
    at(t0 + .15, function () {
      cursorTo(center(CELL.d), 500).then(clickFx).then(clickFx).then(function () {
        setFrame('plot-d-selected', 250);
        hideCursor();
        var ed = el('div', 'ovcard ploted', ov);
        ed.innerHTML = '<img src="' + F.frames['editor'] + '">';
        return tween(ed, [{ transform: 'translateY(900px)', opacity: 0 },
          { transform: 'translateY(0)', opacity: 1 }], 650, SPRING)
          .then(function () { return wait(2.3); })
          .then(function () {
            return tween(ed, [{ transform: 'translateY(0)', opacity: 1 },
              { transform: 'translateY(900px)', opacity: 0 }], 550);
          }).then(function () { ed.remove(); });
      });
    });
  });

  /* ================= A3b REFLOW — the real canvas, before → after ================= */
  scene('a3b', 7.2, function (t0) {
    var gd, ge, pill, arrow;
    /* each guide runs past its plot into the gap between d and e, where a
       red arrow spans the vertical offset */
    var GAP_X = Math.round((CELL.d[0] + CELL.d[2] + AX.e0[1]) / 2);
    function guide(ax, x0, x1) {
      var g = el('div', 'guide', zoomer);
      g.style.left = x0 + 'px'; g.style.top = (ax[0] - 2) + 'px'; g.style.width = (x1 - x0) + 'px';
      return g;
    }
    at(t0, function () { caption('cap_a3b', S.k3_pain, S.k3_sol); });
    at(t0 + .2, function () {
      gd = guide(AX.d0, AX.d0[1], GAP_X + 20); ge = guide(AX.e0, GAP_X - 20, AX.e0[2]);
      [gd, ge].forEach(function (g) {
        tween(g, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], 500);
      });
      arrow = el('div', 'garrow hidden', zoomer, '<i class="up"></i><i class="dn"></i>');
      place(arrow, [GAP_X - 9, AX.d0[0], 18, AX.e0[0] - AX.d0[0]]);
      wait(.4).then(function () { return show(arrow, 250); });
      /* the empty lower-right corner of plot d, just above its axis */
      pill = el('div', 'gpill', zoomer, '✕ ' + S.axes_off);
      pill.style.right = (1920 - AX.d0[2] + 24) + 'px'; pill.style.top = (AX.d0[0] - 52) + 'px';
      wait(.35).then(function () { return pop(pill, 380); });
    });
    at(t0 + 1.2, function () {
      click(REFLOW_TOGGLE, 650).then(function () {
        setFrame('reflow-on', 300);
        flashRect(REFLOW_CARD, 700);
        var y = AX.d1[0];
        [[gd, AX.d1, AX.d1[1], GAP_X + 20], [ge, AX.e1, GAP_X - 20, AX.e1[2]]].forEach(function (p) {
          p[0].classList.add('ok');
          tween(p[0], [{ top: p[0].style.top, left: p[0].style.left, width: p[0].style.width },
            { top: (p[1][0] - 2) + 'px', left: p[2] + 'px', width: (p[3] - p[2]) + 'px' }], 600);
        });
        tween(arrow, [{ top: arrow.style.top, height: arrow.style.height, opacity: 1 },
          { top: y + 'px', height: '0px', opacity: 0 }], 450);
        pill.classList.add('ok'); pill.textContent = '✓ ' + S.axes_ok;
        tween(pill, [{ top: pill.style.top }, { top: (y - 52) + 'px' }], 600);
        return wait(.8);
      }).then(function () {
        hideCursor();
        var d = CELL.d, e = CELL.e;
        return zoomTo([d[0], AX.d1[0] - 210, e[0] + e[2] - d[0], 300], 1.5, 650);
      }).then(function () { return wait(1.7); }).then(function () {
        return zoomOut(500);
      }).then(function () {
        [gd, ge, pill, arrow].forEach(function (g) { fadeOutRemove(g, 300); });
      });
    });
  });

  /* ================= A4 UNIFIED TYPE ================= */
  scene('a4', 4.0, function (t0) {
    at(t0, function () { caption('cap_a4', S.k4_pain, S.k4_sol); });
    at(t0 + .2, function () {
      hideCursor();
      var card = el('div', 'ovcard typo-card hidden', stage);
      card.innerHTML = '<div class="card-title" style="position:absolute;left:28px;top:0">' + S.typo_title + '</div>' +
        '<div class="typo-left"><div style="height:52px"></div>' +
        '<div class="snip"><span class="txt" style="font-size:18px">Time (h)</span><span class="ptchip">7.3 pt</span></div>' +
        '<div class="snip"><span class="txt" style="font-size:34px">Reference (a.u.)</span><span class="ptchip">13.6 pt</span></div>' +
        '<div class="snip"><span class="txt" style="font-size:26px">Baseline</span><span class="ptchip">10.4 pt</span></div>' +
        '<span class="typo-pill" id="tp-pill">' + S.typo_group + '</span></div>' +
        '<div class="typo-right"><div class="embox"><span class="bigA">Aa</span>' +
        '<div class="vbr"><span>12 pt</span></div></div>' +
        '<div class="typo-line">' + S.typo_line + '</div></div>';
      show(card, 320); tween(card, [{ transform: 'scale(.94)' }, { transform: 'scale(1)' }], 450);
      var pill = card.querySelector('#tp-pill');
      var txts = card.querySelectorAll('.snip .txt');
      wait(.8).then(function () {
        return tween(pill, [{ opacity: 0, transform: 'translateX(-30px)' }, { opacity: 1, transform: 'translateX(0)' }], 380);
      }).then(function () {
        txts.forEach(function (t) {
          tween(t, [{ fontSize: t.style.fontSize }, { fontSize: '26px' }], 600);
        });
        card.querySelectorAll('.ptchip').forEach(function (c2, i) {
          wait(i * .1 + .3).then(function () { c2.classList.add('on'); c2.textContent = '9 pt'; });
        });
      });
      wait(3.4).then(function () { return hide(card, 380).then(function () { card.remove(); }); });
    });
  });

  /* ================= A5 AI / MCP → History ================= */
  scene('a5', 9.8, function (t0) {
    var chat;
    at(t0, function () {
      caption('cap_a5', S.k5_pain, S.k5_sol);
      hideCursor();
      chat = el('div', 'chat', ov);
      chat.innerHTML = '<div class="chat-head">Claude · MCP: imagelayout <span class="greendot"></span></div>' +
        '<div class="chat-body"></div>';
      tween(chat, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], 480);
    });
    at(t0 + .6, function () {
      var bodyEl = chat.querySelector('.chat-body');
      var ub = el('div', 'bubble user', bodyEl); var ut = el('span', '', ub); el('span', 'caret', ub);
      var txt = S.ai_prompt, i2 = 0;
      var per = (LANG === 'zh' ? 2.1 : 2.2) / txt.length;
      new Promise(function (res) {
        (function type() {
          if (i2 <= txt.length) { ut.textContent = txt.slice(0, i2); i2 += 2; wait(per * 2).then(type); }
          else { ut.textContent = txt; ub.querySelector('.caret').remove(); res(); }
        })();
      }).then(function () {
        /* real MCP tool names (src/agent/tool_specs.py); arguments summarised */
        var calls = [
          ['project_new', '210 × 133 mm · 600 DPI', 'empty'],
          ['cell_add', 'row 1 → 3 cells', null],
          ['image_import', '× 5', 'imported-gap0'],
          ['auto_layout', '', 'autolayout'],
          ['auto_label_cells', 'a–e', 'labels'],
          ['cell_set_scale_bar', 'b · 50 m', 'scalebar'],
          ['pip_add', 'a · river-detail.jpg', 'pip'],
          ['cell_set_properties', 'd, e · plot_reflow', 'reflow-on'],
          ['project_export', 'figure.tiff · TIFF', 'final']
        ];
        var p = Promise.resolve();
        calls.forEach(function (c) {
          p = p.then(function () {
            var row = el('div', 'toolrow', bodyEl);
            row.innerHTML = '<span class="st"><span class="spin-ic"></span></span><b>' + c[0] + '</b>' +
              (c[1] ? '<span class="args">' + c[1] + '</span>' : '');
            tween(row, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], 220);
            return wait(.26).then(function () {
              if (c[2]) setFrame(c[2], 220);
              row.querySelector('.st').innerHTML = '<span class="check-ic">✓</span>';
              return wait(.17);
            });
          });
        });
        return p.then(function () { return pop(el('div', 'bubble ai', bodyEl, S.ai_reply), 380); });
      }).then(function () { return wait(.6); }).then(function () {
        tween(chat, [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], 450)
          .then(function () { chat.remove(); });
        caption('cap_a5b');
        return setFrame('history-tab', 300);
      }).then(function () {
        return zoomTo([0, 110, 240, 540], 1.8, 600);
      });
    });
  });

  /* ================= A6 EXPORT ================= */
  scene('a6', 8.2, function (t0) {
    at(t0, function () {
      caption('cap_export', S.k6_pain, S.k6_sol);
      zoomOut(450);
      setFrame('final', 350);
    });
    at(t0 + .5, function () {
      click(hot('tb_export', [1792, 68, 108, 35]), 550).then(function () {
        var mr = hot('export_menu', [1792, 103, 276, 252]).slice();
        mr[0] = Math.min(mr[0], 1914 - mr[2]);   // Qt keeps popups on screen
        var menu = el('img', 'menuov', zoomer);
        menu.src = F.frames['menu'];
        place(menu, mr);
        tween(menu, [{ opacity: 0 }, { opacity: 1 }], 250);
        var it = hot('export_pdf_item', [4, 4, mr[2] - 10, 30]);
        return wait(.4).then(function () {
          return click({ x: mr[0] + it[0] + it[2] / 2, y: mr[1] + it[1] + it[3] / 2 }, 380);
        }).then(function () { return wait(.4); }).then(function () { return fadeOutRemove(menu, 250); });
      }).then(function () {
        hideCursor();
        var dark = el('div', 'backdrop', stage); dark.style.opacity = 0; dark.style.zIndex = 610;
        tween(dark, [{ opacity: 0 }, { opacity: .96 }], 600);
        tween(app, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.9)', opacity: 0 }], 600);
        var SW = 1300, IW = SW - 48, IH = Math.round(IW * EXP_H / EXP_W);
        var sheet = el('div', 'sheet', stage);
        sheet.style.cssText = 'left:' + (960 - SW / 2) + 'px;top:36px;width:' + SW + 'px;height:' + (IH + 48) + 'px;opacity:0';
        var inner = el('div', 'sheet-inner', sheet);
        var img = el('img', '', inner); img.src = F.exported;
        var vchip = el('div', 'vchip', sheet, S.vector_chip); vchip.style.opacity = 0;
        var brow = el('div', 'brow', stage);
        brow.style.top = (36 + IH + 48 + 26) + 'px';
        ['PDF', 'SVG', 'TIFF', 'PNG', 'JPEG'].forEach(function (f) {
          el('span', 'format-badge', brow, f).style.opacity = 0;
        });
        el('span', 'format-badge size', brow, S.size_chip).style.opacity = 0;
        return tween(sheet, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }], 750, SPRING)
          .then(function () {
            Array.prototype.forEach.call(brow.children, function (b, i) {
              wait(i * .07).then(function () { pop(b, 320); });
            });
            return wait(.9);
          }).then(function () {
            /* close-up on panel d's tick labels */
            img.style.transformOrigin = '22% 92%';
            pop(vchip, 350);
            return tween(img, [{ transform: 'scale(1)' }, { transform: 'scale(2.6)' }], 800);
          }).then(function () { return wait(1.3); }).then(function () {
            hide(vchip, 250);
            return tween(img, [{ transform: 'scale(2.6)' }, { transform: 'scale(1)' }], 650);
          });
      });
    });
  });

  /* ================= OUTRO ================= */
  var CARD_ICONS = [
    '<svg viewBox="0 0 44 44" fill="none" stroke="#3CC6E0" stroke-width="2">' +
      '<rect x="3" y="5" width="12" height="15" rx="2"/><rect x="16" y="5" width="12" height="15" rx="2"/>' +
      '<rect x="29" y="5" width="12" height="15" rx="2"/>' +
      '<rect x="3" y="24" width="19" height="15" rx="2"/><rect x="24" y="24" width="17" height="15" rx="2"/></svg>',
    '<svg viewBox="0 0 44 44" fill="none" stroke="#3CC6E0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M6 4 V36 H40"/><polyline points="10,28 18,18 26,23 34,10 40,14"/></svg>',
    '<svg viewBox="0 0 44 44" fill="none" stroke="#3CC6E0" stroke-width="2" stroke-linejoin="round">' +
      '<path d="M10 4 H28 L36 12 V40 H10 Z"/><path d="M28 4 V12 H36"/>' +
      '<path d="M15 20 H29 M15 26 H29 M15 32 H23"/></svg>',
    '<svg viewBox="0 0 44 44" fill="none" stroke="#3CC6E0" stroke-width="2" stroke-linejoin="round">' +
      '<path d="M5 9 H28 a5 5 0 0 1 5 5 V22 a5 5 0 0 1 -5 5 H15 L9 33 V27 H5 a5 5 0 0 1 -5 -5 V14 a5 5 0 0 1 5 -5 Z"/>' +
      '<path d="M37 3 L39.5 9.5 L46 12 L39.5 14.5 L37 21 L34.5 14.5 L28 12 L34.5 9.5 Z"/></svg>'
  ];
  scene('outro', 8.0, function (t0) {
    at(t0, function () {
      captionOff(); hideCursor();
      var dark2 = mkBackdrop(700);
      dark2.style.opacity = 0;
      var icw = el('div', 'outro-icon', dark2);
      var ic = el('img', '', icw); ic.src = 'assets/icon.svg';
      ic.style.cssText = 'width:120px;height:120px;display:block;opacity:0';
      var t2 = el('div', 'outro-title', dark2,
        '<span class="ilm">I</span>mage <span class="ilm">L</span>ayout <span class="ilm">M</span>anager');
      t2.style.opacity = 0;
      var mo = el('div', 'outro-motto', dark2);
      S.motto_parts.forEach(function (pt) {
        (pt[0] + pt[1]).trim().split(/\s+/).forEach(function (wd, wi) {
          var s = el('span', 'mword', mo);
          s.innerHTML = wi === 0 ? '<span class="ilm">' + wd[0] + '</span>' + wd.slice(1) : wd;
          s.style.opacity = 0;
          mo.appendChild(document.createTextNode(' '));
        });
      });
      var cards = el('div', 'outro-cards', dark2);
      for (var ci = 1; ci <= 4; ci++) {
        el('div', 'outro-card', cards,
          '<div class="bar"></div>' + CARD_ICONS[ci - 1] +
          '<div class="ct">' + S['card' + ci + '_t'] + '</div>' +
          '<div class="cs">' + S['card' + ci + '_s'] + '</div>');
      }
      var cta = el('div', 'cta', dark2,
        '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 3 V15 M6 10 L12 16 L18 10 M4 20 H20"/></svg>' +
        '<span>luojiajiang.uk/image-layout-manager</span>');
      var meta = el('div', 'outro-meta', dark2, S.outro_meta);

      tween(dark2, [{ opacity: 0 }, { opacity: 1 }], 550);
      wait(.3).then(function () { pop(ic, 550); });
      wait(.48).then(function () {
        tween(t2, [{ opacity: 0, transform: 'translateY(30px)' },
          { opacity: 1, transform: 'translateY(0)' }], 500);
      });
      mo.querySelectorAll('.mword').forEach(function (e, i) {
        wait(.85 + i * .055).then(function () {
          tween(e, [{ opacity: 0, transform: 'translateY(16px)' },
            { opacity: 1, transform: 'translateY(0)' }], 380);
        });
      });
      var tIlms = t2.querySelectorAll('.ilm'), mIlms = mo.querySelectorAll('.ilm');
      [1.4, 1.55, 1.7].forEach(function (ts, i) {
        wait(ts).then(function () {
          [tIlms[i], mIlms[i]].forEach(function (e) {
            e.classList.add('lit');
            if (!FF) e.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' },
              { transform: 'scale(1)' }], { duration: 400, easing: EASE });
          });
        });
      });
      Array.prototype.forEach.call(cards.children, function (card, i) {
        wait(2.05 + i * .1).then(function () {
          tween(card, [{ opacity: 0, transform: 'translateY(40px)' },
            { opacity: 1, transform: 'translateY(0)' }], 480);
          tween(card.querySelector('.bar'),
            [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 520);
        });
      });
      wait(2.8).then(function () {
        tween(cta, [{ opacity: 0, transform: 'translateX(-50%) scale(.6)' },
          { opacity: 1, transform: 'translateX(-50%) scale(1)' }], 450, SPRING)
          .then(function () { cta.classList.add('shine'); });
      });
      wait(3.05).then(function () { tween(meta, [{ opacity: 0 }, { opacity: 1 }], 480); });
    });
  });
  END_T = T;

  /* ---------------- boot / seek ---------------- */
  cues.sort(function (a, b) { return a.t - b.t; });
  function start() {
    clockStarted = true; lastNow = performance.now();
    requestAnimationFrame(tick);
  }
  function boot() {
    if (!isNaN(SEEK)) {
      FF = true;
      (async function () {
        var qi = 0;
        while (true) {
          var nextCue = null;
          while (qi < cues.length && cues[qi].done) qi++;
          if (qi < cues.length && cues[qi].t <= SEEK) nextCue = cues[qi];
          var best = null;
          for (var i = vsleep.length - 1; i >= 0; i--) {
            var s = vsleep[i];
            if (s.t <= SEEK && (!best || s.t < best.t)) best = s;
          }
          if (!nextCue && !best) break;
          if (nextCue && (!best || nextCue.t <= best.t)) {
            vNow = Math.max(vNow, nextCue.t);
            nextCue.done = true; qi++;
            try { nextCue.fn(); } catch (e) { document.title = 'ERR:' + e; }
          } else {
            vNow = Math.max(vNow, best.t);
            vsleep.splice(vsleep.indexOf(best), 1);
            best.r();
          }
          for (var k = 0; k < 20; k++) await Promise.resolve();
        }
        for (var m = 0; m < vsleep.length; m++) {
          (function (s) { sleepers.push({ t: SEEK + Math.max(0, s.t - vNow), r: s.r }); })(vsleep[m]);
        }
        vsleep.length = 0;
        elapsed = SEEK; FF = false;
        if (!PAUSE) start();
      })();
    } else start();
  }
  /* warm the image cache (don't gate the clock on it — headless virtual
     time can outrun real decode and stall the boot) */
  Object.keys(F.frames).forEach(function (k) { new Image().src = F.frames[k]; });
  if (F.exported) new Image().src = F.exported;
  new Image().src = 'assets/river-detail.jpg';
  boot();
})();
