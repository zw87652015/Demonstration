/* ILM product demo — frame-based: real ILM screenshots crossfading, with
   zoom-ins, fake cursor, captions and overlay cards.
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

  /* ---------------- clock ---------------- */
  var cues = [], sleepers = [], elapsed = 0, clockStarted = false;
  var vNow = 0, vsleep = []; // virtual clock used while seeking (FF)
  function at(t, fn) { cues.push({ t: t, fn: fn }); }
  /* scene list: each scene starts right after the previous one, so a
     duration change never requires editing later cues. Scenes begin
     after the 1.0 s initial black; the loop reloads 6 s after the
     last scene ends. */
  var T = 1.0, SCENES = [];
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
    if (LOOP && elapsed > END_T) { location.reload(); return; }
    requestAnimationFrame(tick);
  }

  /* ---------------- animation helpers ---------------- */
  var KF_PROP = { opacity: 'opacity', transform: 'transform', clipPath: 'clipPath', width: 'width', height: 'height', left: 'left', top: 'top', fontSize: 'fontSize' };
  function applyKf(elm, kf) {
    var last = kf[kf.length - 1];
    Object.keys(last).forEach(function (k) {
      var prop = KF_PROP[k] || k;
      try { elm.style[prop] = last[k]; } catch (e) {}
    });
  }
  function tween(elm, kf, ms, easing) {
    if (FF) { applyKf(elm, kf); return Promise.resolve(); }
    var a = elm.animate(kf, { duration: ms, easing: easing || EASE, fill: 'forwards' });
    return a.finished.catch(function () {});
  }
  function tweenNum(from, to, ms, fn, easing) {
    if (FF) { fn(to); return Promise.resolve(); }
    return new Promise(function (res) {
      var t0 = performance.now();
      (function step(now) {
        var p = Math.min(1, (now - t0) / ms);
        var e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        fn(from + (to - from) * e);
        if (p < 1 && elapsed < 1e9) requestAnimationFrame(step); else res();
      })(t0);
    });
  }
  function show(elm, ms) { elm.classList.remove('hidden'); return tween(elm, [{ opacity: 0 }, { opacity: 1 }], ms || 400); }
  function hide(elm, ms) { return tween(elm, [{ opacity: 1 }, { opacity: 0 }], ms || 400).then(function () { elm.classList.add('hidden'); elm.style.opacity = ''; }); }
  function pop(elm, ms) {
    elm.classList.remove('hidden');
    return tween(elm, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }], ms || 450, SPRING);
  }

  /* ================= APP WINDOW (real frames) ================= */
  var app = el('div', '', stage); app.id = 'app';
  var zoomer = el('div', 'zoomer', app);
  var framesBox = el('div', 'frames', zoomer);
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
    img.style.zIndex = 2; img.style.opacity = 0;
    framesBox.appendChild(img);
    var old = curFrame;
    curFrame = img;
    var done = tween(img, [{ opacity: 0 }, { opacity: 1 }], ms || 300);
    return done.then(function () {
      while (framesBox.children.length > 1 && framesBox.firstChild !== curFrame)
        framesBox.removeChild(framesBox.firstChild);
      if (old && old.parentNode === framesBox && old !== curFrame) old.remove();
    });
  }
  // initial frame
  curFrame = frameImg('empty'); framesBox.appendChild(curFrame);

  /* ---------------- zoom ---------------- */
  var curZoom = 1;
  function zoomTo(rect, scale, ms) {
    var cx = rect[0] + rect[2] / 2, cy = rect[1] + rect[3] / 2;
    zoomer.style.transformOrigin = cx + 'px ' + cy + 'px';
    curZoom = scale;
    return tween(zoomer, [{ transform: 'scale(' + (FF ? scale : 1) + ')' },
      { transform: 'scale(' + scale + ')' }], ms || 500);
  }
  function zoomOut(ms) {
    curZoom = 1;
    return tween(zoomer, [{ transform: 'scale(1)' }], ms || 450);
  }
  function hot(name) { return HOT[name]; }
  function hotC(name) {
    var r = HOT[name] || [0, 0, 0, 0];
    return { x: r[0] + r[2] / 2, y: r[1] + r[3] / 2 };
  }
  /* element rect in 1920x1080 stage coordinates */
  function stageRectOf(elm) {
    var r = elm.getBoundingClientRect(), s = stage.getBoundingClientRect();
    var k = s.width / 1920 || 1;
    return [(r.left - s.left) / k, (r.top - s.top) / k, r.width / k, r.height / k];
  }

  /* ---------------- cursor (inside the zoomer) ---------------- */
  var cursor = el('div', '', zoomer);
  cursor.id = 'cursor';
  cursor.innerHTML = '<svg width="28" height="36" viewBox="0 0 28 36"><path d="M4 2 L4 28 L10 23 L14 33 L18 31 L14 21 L22 20 Z" fill="#fff" stroke="#1E2433" stroke-width="1.8"/></svg><div class="clickring"></div>';
  var ring = cursor.querySelector('.clickring');
  var curX = 960, curY = 540, curVisible = false;
  function cursorTo(x, y, ms) {
    if (x && x.x !== undefined) { y = x.y; x = x.x; }
    if (!curVisible) { curVisible = true; cursor.style.opacity = '1'; }
    var dx = x - curX, dy = y - curY;
    if (ms === undefined) ms = Math.min(600, Math.max(300, Math.hypot(dx, dy) * .45));
    curX = x; curY = y;
    cursor.style.left = (x - 6) + 'px'; cursor.style.top = (y - 4) + 'px';
    if (FF) return Promise.resolve();
    cursor.style.transition = 'left ' + ms + 'ms ' + EASE + ', top ' + ms + 'ms ' + EASE;
    return wait(ms / 1000);
  }
  function clickFx() {
    if (FF) return Promise.resolve();
    cursor.animate([{ transform: 'scale(1)' }, { transform: 'scale(.82)' }, { transform: 'scale(1)' }], { duration: 220, easing: EASE });
    ring.animate([{ opacity: .9, transform: 'translate(-50%,-50%) scale(.4)' }, { opacity: 0, transform: 'translate(-50%,-50%) scale(3.4)' }], { duration: 500, easing: 'ease-out', fill: 'forwards' });
    return wait(.16);
  }
  function click(target, opts) {
    var p = target && target.x !== undefined ? target : hotC(target);
    return cursorTo(p.x, p.y, opts && opts.ms).then(clickFx);
  }
  function showCursor() {
    if (curVisible) return Promise.resolve();
    curVisible = true;
    return tween(cursor, [{ opacity: 0 }, { opacity: 1 }], 300);
  }
  function hideCursor() {
    if (!curVisible) return Promise.resolve();
    curVisible = false;
    return tween(cursor, [{ opacity: 1 }, { opacity: 0 }], 300);
  }

  /* ---------------- caption / chapter kicker ---------------- */
  var capbar = el('div', '', stage); capbar.id = 'capbar';
  var kicker = el('div', 'kicker', capbar);
  var capIn = el('span', 'cap-inner', capbar);
  var capVisible = false;
  function caption(key) {
    var txt = S[key]; if (!txt) return Promise.resolve();
    capIn.textContent = txt;
    if (!capVisible) { capVisible = true; return tween(capbar, [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }], 500); }
    return tween(capIn, [{ opacity: 1 }, { opacity: 0 }], 150).then(function () {
      capIn.textContent = txt;
      return tween(capIn, [{ opacity: 0 }, { opacity: 1 }], 200);
    });
  }
  function captionOff() {
    if (!capVisible) return Promise.resolve();
    capVisible = false;
    return tween(capbar, [{ opacity: 1 }, { opacity: 0 }], 350);
  }
  /* kicker: "✕ pain → ✓ solution" (pain struck through, solution teal) */
  function kickerSet(pain, sol) {
    kicker.innerHTML = (pain ? '<span class="pain">✕ ' + pain + '</span>' +
      '<span class="arr"> → </span>' : '') +
      (sol ? '<span class="sol">✓ ' + sol + '</span>' : '');
  }

  /* flash highlight over a stage-space rect (inside zoomer) */
  function flashRect(rect, ms) {
    var fl = el('div', 'hl', zoomer);
    fl.style.cssText = 'left:' + rect[0] + 'px;top:' + rect[1] + 'px;width:' +
      rect[2] + 'px;height:' + rect[3] + 'px';
    return tween(fl, [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], ms || 900)
      .then(function () { fl.remove(); });
  }

  var pageRect = (function () {
    var a = HOT.cell_a || [0, 0, 0, 0], e = HOT.cell_e || a;
    return [a[0], a[1], (e[0] + e[2]) - a[0], (e[1] + e[3]) - a[1]];
  })();

  /* ================= shared backdrop ================= */
  function mkBackdrop(z) {
    var b = el('div', 'backdrop', stage); b.style.zIndex = z;
    var g = el('div', 'bggrid', b);
    for (var i = 0; i < 14; i++) {
      var p = el('div', 'panel', g);
      var w = 140 + Math.random() * 260, h = 100 + Math.random() * 200;
      p.style.cssText = 'width:' + w + 'px;height:' + h + 'px;left:' +
        (Math.random() * 1800) + 'px;top:' + (Math.random() * 980) + 'px;';
      (function (pp) {
        pp.animate([{ transform: 'translate(0,0)' },
          { transform: 'translate(' + (Math.random() * 60 - 30) + 'px,' + (Math.random() * 40 - 20) + 'px)' }],
          { duration: 6000 + Math.random() * 6000, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
      })(p);
    }
    return b;
  }
  var backdrop = mkBackdrop(100);
  var black = el('div', '', stage); black.style.cssText = 'position:absolute;inset:0;background:#000;z-index:9000;';
  at(0.8, function () {
    tween(black, [{ opacity: 1 }, { opacity: 0 }], 700).then(function () { black.remove(); });
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

  scene('hook', 9.0, function (t0) {
    at(t0 + .3, function () {
      tween(hq, [{ opacity: 0, transform: 'translateY(30px)' },
        { opacity: 1, transform: 'translateY(0)' }], 600);
      pcards.forEach(function (c, i) {
        wait(0.9 + i * .35).then(function () {
          return tween(c, [{ opacity: 0, transform: 'translateY(40px)' },
            { opacity: 1, transform: 'translateY(0)' }], 550);
        });
        wait(5.7 + i * .12).then(function () {
          return pop(c.querySelector('.x-badge'), 380);
        });
      });
      wait(7.6).then(function () {
        pcards.forEach(function (c) {
          tween(c, [{ opacity: 1, transform: 'scale(1)' },
            { opacity: 0, transform: 'scale(.86)' }], 600);
        });
        tween(hq, [{ opacity: 1 }, { opacity: 0 }], 500);
        return wait(.1).then(function () { return pop(ans, 550); });
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

  scene('brand', 5.0, function (t0) {
    at(t0, function () {
      tween(ans, [{ opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-160px)' }], 500);
      wait(.35).then(function () { return pop(icon, 600); });
      wait(.6).then(function () {
        return tween(ttl, [{ opacity: 0, transform: 'translateY(28px)' },
          { opacity: 1, transform: 'translateY(0)' }], 600);
      });
      wait(1.0).then(function () { return tween(tag, [{ opacity: 0 }, { opacity: 1 }], 500); });
      wait(1.5).then(function () {
        return tween(srow, [{ opacity: 0, transform: 'translateY(18px)' },
          { opacity: 1, transform: 'translateY(0)' }], 500);
      });
      wait(2.05).then(function () {
        var q = S.store_query, i = 0;
        (function step() {
          if (i < q.length) {
            sQ.textContent = q.slice(0, ++i);
            wait(.025).then(step);
          } else {
            wait(.4).then(function () {
              return tween(sCaret, [{ opacity: 1 }, { opacity: 0 }], 250);
            });
          }
        })();
      });
    });
    at(t0 + 4.4, function () {
      tween(tw, [{ opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(1.06)' }], 600);
      tween(backdrop, [{ opacity: 1 }, { opacity: 0 }], 650)
        .then(function () { backdrop.classList.add('hidden'); });
      show(app); tween(app, [{ transform: 'scale(.96)' }, { transform: 'scale(1)' }], 650);
      showCursor();
    });
  });

  /* ================= A1 DROP IN, ONE CLICK ================= */
  scene('a1', 8.0, function (t0) {
    var explorer;
    at(t0, function () { kickerSet(S.k1_pain, S.k1_sol); caption('cap_a1'); });
    at(t0 + .3, function () {
      explorer = el('div', 'ovcard explorer hidden', stage);
      explorer.style.left = '110px'; explorer.style.top = '140px';
      explorer.innerHTML = '<div class="ex-title">📁 ' + S.explorer_title + '<span style="margin-left:auto;color:#999">— ▢ ✕</span></div>';
      var exb = el('div', 'ex-body', explorer);
      [['river.jpg', 'assets/river.jpg'], ['fields.jpg', 'assets/fields.jpg'], ['coast.jpg', 'assets/coast.jpg'],
       ['response.ilmplot.svg', 'assets/response.ilmplot.svg'], ['comparison.ilmplot.svg', 'assets/comparison.ilmplot.svg']]
        .forEach(function (f) {
          var t = el('div', 'filetile', exb);
          t.innerHTML = '<img class="ft-img" src="' + f[1] + '">' + f[0];
        });
      show(explorer);
    });
    at(t0 + 1.0, function () {
      var mq = el('div', 'sel-marquee', stage);
      var x0 = 125, y0 = 190;
      cursorTo(x0 + 96, y0 + 60, 400).then(function () {
        mq.style.cssText = 'left:' + x0 + 'px;top:' + y0 + 'px;width:0;height:0;';
        return tween(mq, [{ width: '0px', height: '0px' }, { width: '490px', height: '250px' }], 600);
      }).then(function () {
        explorer.querySelectorAll('.filetile').forEach(function (t, i) {
          wait(i * .06).then(function () { t.classList.add('sel'); });
        });
        return wait(.4);
      }).then(function () {
        mq.remove();
        var ghost = el('div', 'dragghost', stage);
        ghost.innerHTML = '<img src="assets/river.jpg"><div class="badge">5</div>';
        ghost.style.cssText = 'left:' + (curX - 36) + 'px;top:' + (curY - 23) + 'px;opacity:0';
        tween(ghost, [{ opacity: 0 }, { opacity: 1 }], 200);
        var a = hotC('cell_a'), c = hotC('cell_c');
        return cursorTo(a.x, a.y, 450).then(function () {
          return cursorTo(c.x, c.y, 400);
        }).then(function () {
          hide(ghost, 200).then(function () { ghost.remove(); });
          setFrame('imported-gap0', 300);
          return wait(.5).then(function () { return hide(explorer, 300); });
        });
      });
    });
    at(t0 + 4.2, function () {
      var tb = hot('tb_autolayout') || [748, 68, 109, 35];
      zoomTo([tb[0] - 60, tb[1] - 40, tb[2] + 500, tb[3] + 240], 1.5, 500).then(function () {
        return click(tb).then(function () {
          setFrame('autolayout', 300);
          flashRect(pageRect, 700);
        });
      });
    });
    at(t0 + 5.8, function () {
      return zoomOut(450).then(function () {
        return click(hot('tb_label_in') || [474, 68, 135, 35]).then(function () {
          setFrame('labels', 300);
        });
      }).then(function () { return wait(.5).then(hideCursor); });
    });
  });

  /* ================= A2 ANNOTATIONS ================= */
  scene('a2', 6.0, function (t0) {
    at(t0, function () { kickerSet(null, S.k2_sol); caption('cap_a2'); });
    at(t0 + .2, function () {
      click(hot('cell_b')).then(function () {
        return setFrame('cell-b-selected', 300);
      }).then(function () {
        var sbz = hot('scale_bar_section') || hot('scale_bar_chk');
        var sb = hot('scale_bar_chk') || sbz;
        return zoomTo(sbz, 1.6, 500).then(function () {
          return click(sb).then(function () {
            return setFrame('scalebar', 300);
          });
        });
      }).then(function () { return wait(.4).then(function () { return zoomOut(450); }); })
        .then(function () {
          var ca = hot('cell_a') || [234, 231, 410, 280];
          return click(ca).then(function () {
            setFrame('cell-a-selected', 300);
            var rx = ca[0] + ca[2] * .30, ry = ca[1] + ca[3] * .55;
            var rw = ca[2] * .30, rh = ca[3] * .37;
            var mq = el('div', 'sel-marquee', zoomer);
            mq.style.cssText = 'left:' + rx + 'px;top:' + ry + 'px;width:0;height:0;border-style:solid';
            return cursorTo(rx, ry, 400).then(function () {
              return tween(mq, [{ width: '0px', height: '0px' },
                { width: rw + 'px', height: rh + 'px' }], 600);
            }).then(function () {
              mq.remove();
              return setFrame('pip', 300);
            });
          });
        }).then(function () { return wait(.5).then(hideCursor); });
    });
  });

  /* ================= A3 PLOTS & REFLOW ================= */
  scene('a3', 8.0, function (t0) {
    var ploted;
    at(t0, function () { kickerSet(S.k3_pain, S.k3_sol); caption('cap_a3a'); });
    at(t0 + .3, function () {
      var cd = hot('cell_d') || [234, 523, 620, 465];
      cursorTo(cd[0] + cd[2] / 2, cd[1] + cd[3] / 2, 500)
        .then(clickFx).then(clickFx).then(function () {
          setFrame('plot-d-selected', 250);
          hideCursor();
          ploted = el('div', 'ovcard ploted hidden', stage);
          ploted.innerHTML = '<img src="' + F.frames['editor'] + '" style="width:100%;height:100%;object-fit:contain;display:block">';
          ploted.classList.remove('hidden');
          tween(ploted, [{ transform: 'translateY(900px)', opacity: 0 },
            { transform: 'translateY(0)', opacity: 1 }], 700, SPRING);
          return wait(2.0).then(function () {
            return tween(ploted, [{ transform: 'translateY(0)', opacity: 1 },
              { transform: 'translateY(900px)', opacity: 0 }], 600)
              .then(function () { ploted.remove(); });
          });
        });
    });
    at(t0 + 4.4, function () {
      caption('cap_a3b');
      showCursor();
      var RC_W = 1720, PAD = 40, iw = RC_W - PAD * 2;
      var ihOn = Math.round(iw * 633 / 2123);          // ON is the taller
      var card = el('div', 'ovcard reflow-card hidden', stage);
      card.style.left = ((1920 - RC_W) / 2) + 'px';
      card.style.width = RC_W + 'px';
      card.innerHTML =
        '<div class="rf-head"><div class="card-title">' + S.reflow_title + '</div>' +
        '<div class="rf-chip" id="rf-chip">' + S.chip_reflow_off + '</div></div>' +
        '<div class="rf-box" style="width:' + iw + 'px;height:' + ihOn + 'px">' +
        '<img class="rf-img" src="assets/Reflow-off.webp">' +
        '<img class="rf-img rf-on" src="assets/Reflow-on.webp">' +
        '<div class="rf-line"></div></div>';
      show(card, 400);
      var chip = card.querySelector('#rf-chip');
      wait(.5).then(function () {
        var cr2 = stageRectOf(chip);
        return cursorTo(cr2[0] + cr2[2] / 2, cr2[1] + cr2[3] / 2, 500);
      }).then(clickFx).then(function () {
        chip.classList.add('on'); chip.textContent = S.chip_reflow_on;
        setFrame('reflow-on', 300);      // app state advances under the card
        var on = card.querySelector('.rf-on'), line = card.querySelector('.rf-line');
        tween(line, [{ left: '0px', opacity: 1 }, { left: iw + 'px', opacity: 1 }], 1200);
        return tween(on, [{ clipPath: 'inset(0 100% 0 0)' },
          { clipPath: 'inset(0 0% 0 0)' }], 1200);
      }).then(function () {
        tween(card.querySelector('.rf-line'), [{ opacity: 1 }, { opacity: 0 }], 300);
        return wait(1.2).then(function () {
          hideCursor();
          return hide(card, 450).then(function () { card.remove(); });
        });
      });
    });
  });

  /* ================= A4 UNIFIED TYPE ================= */
  scene('a4', 4.5, function (t0) {
    at(t0, function () { kickerSet(S.k4_pain, S.k4_sol); caption('cap_a4'); });
    at(t0 + .3, function () {
      hideCursor();
      var card = el('div', 'ovcard typo-card hidden', stage);
      card.innerHTML = '<div class="card-title" style="position:absolute;left:28px;top:0">' + S.typo_title + '</div>' +
        '<div class="typo-left"><div style="height:52px"></div>' +
        '<div class="snip"><span class="txt" style="font-size:18px">Time (h)</span><span class="ptchip">7.3 pt</span></div>' +
        '<div class="snip"><span class="txt" style="font-size:34px">Reference (a.u.)</span><span class="ptchip">13.6 pt</span></div>' +
        '<div class="snip"><span class="txt" style="font-size:26px">Baseline</span><span class="ptchip">10.4 pt</span></div>' +
        '<span class="typo-pill" id="tp-pill">' + S.typo_group + '</span></div>' +
        '<div class="typo-right"><div style="display:flex;align-items:center;gap:26px"><span class="bigA">a</span>' +
        '<div class="ruler"><div class="rt">12 pt</div></div></div>' +
        '<div class="typo-line">' + S.typo_line + '</div></div>';
      show(card, 350); tween(card, [{ transform: 'scale(.94)' }, { transform: 'scale(1)' }], 500);
      var pill = card.querySelector('#tp-pill');
      var txts = card.querySelectorAll('.snip .txt');
      wait(.9).then(function () {
        return tween(pill, [{ opacity: 0, transform: 'translateX(-30px)' }, { opacity: 1, transform: 'translateX(0)' }], 400);
      }).then(function () {
        txts.forEach(function (t) {
          tween(t, [{ fontSize: t.style.fontSize }, { fontSize: '26px' }], 600);
        });
        card.querySelectorAll('.ptchip').forEach(function (c2, i) {
          wait(i * .1 + .3).then(function () { c2.classList.add('on'); c2.textContent = '9 pt'; });
        });
      });
      wait(3.9).then(function () { return hide(card, 400).then(function () { card.remove(); }); });
    });
  });

  /* ================= A5 EDIT ANYTIME / AI ================= */
  scene('a5', 9.0, function (t0) {
    var chat;
    at(t0, function () { kickerSet(S.k5_pain, S.k5_sol); caption('cap_a5'); });
    at(t0 + .2, function () {
      var cc = hot('cell_c') || [1078, 231, 410, 280];
      return cursorTo(cc[0] + cc[2] / 2, cc[1] + cc[3] / 2, 500).then(clickFx).then(function () {
        var bx = el('div', 'hl outline', zoomer);
        bx.style.cssText = 'left:' + cc[0] + 'px;top:' + cc[1] + 'px;width:' + cc[2] + 'px;height:' + cc[3] + 'px';
        return wait(.4).then(function () {
          bx.remove();
          return setFrame('split-c', 300);
        });
      }).then(function () {
        return wait(.6).then(function () {
          return click(hot('tb_undo') || [19, 68, 83, 35]);
        });
      }).then(function () {
        return setFrame('autolayout', 300);
      });
    });
    at(t0 + 2.8, function () {
      setFrame('empty', 300);
      chat = el('div', 'chat', stage);
      chat.innerHTML = '<div class="chat-head">Claude · MCP: imagelayout <span class="greendot"></span></div>' +
        '<div class="chat-body" id="chat-body"></div>';
      return tween(chat, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], 500);
    });
    at(t0 + 3.5, function () {
      hideCursor();
      var bodyEl = chat.querySelector('#chat-body');
      var ub = el('div', 'bubble user', bodyEl); var ut = el('span', '', ub); el('span', 'caret', ub);
      var txt = S.ai_prompt, i2 = 0;
      var per = LANG === 'zh' ? .030 : .015;
      return new Promise(function (res) {
        (function type() {
          if (i2 <= txt.length) { ut.textContent = txt.slice(0, i2); i2++; wait(per).then(type); }
          else { ub.querySelector('.caret').remove(); res(); }
        })();
      }).then(function () {
        var calls = [
          ['project_new {"page_size":{"w":210,"h":133},"dpi":600}', null],
          ['cell_add {"row_index":0}', null],
          ['image_import river.jpg … ×5', function () { setFrame('imported-gap0', 300); }],
          ['auto_layout', function () { setFrame('autolayout', 300); }],
          ['auto_label_cells {"scheme":"a"}', function () { setFrame('labels', 300); }],
          ['cell_set_scale_bar {"cell":"b","length":50,"unit":"m"}', function () { setFrame('scalebar', 300); }],
          ['project_export {"format":"TIFF"}', function () { setFrame('final', 300); }]
        ];
        var p = Promise.resolve();
        calls.forEach(function (pair) {
          p = p.then(function () {
            var row = el('div', 'toolrow', bodyEl);
            row.innerHTML = '<span class="st"><span class="spin-ic"></span></span><span>' + pair[0] + '</span>';
            tween(row, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], 250);
            if (pair[1]) pair[1]();
            return wait(.25).then(function () {
              row.querySelector('.st').innerHTML = '<span class="check-ic">✓</span>';
              return wait(.15);
            });
          });
        });
        return p.then(function () {
          var ab = el('div', 'bubble ai', bodyEl, S.ai_reply);
          return pop(ab, 400);
        });
      }).then(function () {
        return wait(1.0).then(function () {
          return tween(chat, [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], 500)
            .then(function () { chat.remove(); });
        });
      });
    });
  });

  /* ================= A6 EXPORT ================= */
  scene('a6', 8.5, function (t0) {
    at(t0, function () { kickerSet(null, S.k6_sol); caption('cap_export'); });
    at(t0 + .2, function () {
      var tb = hot('tb_export') || [1807, 68, 93, 35];
      click(tb).then(function () {
        // composite the real popup capture over the final frame
        var mr = hot('export_menu') || [1790, 100, 250, 260];
        var menu = el('img', 'menuov', zoomer);
        menu.src = F.frames['menu'];
        menu.style.cssText = 'position:absolute;left:' + mr[0] + 'px;top:' +
          mr[1] + 'px;width:' + mr[2] + 'px;height:' + mr[3] + 'px;z-index:80;' +
          'box-shadow:0 16px 50px rgba(0,0,0,.4);border-radius:4px;opacity:0';
        tween(menu, [{ opacity: 0 }, { opacity: 1 }], 300);
        var it = hot('export_pdf_item') || [4, 4, mr[2] - 10, 30];
        var p = { x: mr[0] + it[0] + it[2] / 2, y: mr[1] + it[1] + it[3] / 2 };
        return wait(.5).then(function () {
          return cursorTo(p.x, p.y, 400).then(clickFx);
        }).then(function () {
          return wait(.6).then(function () {
            return hide(menu, 300).then(function () { menu.remove(); });
          });
        });
      }).then(function () {
        return wait(.5).then(function () {
          hideCursor();
          var dark = el('div', 'backdrop', stage); dark.style.opacity = 0; dark.style.zIndex = 610;
          tween(dark, [{ opacity: 0 }, { opacity: .94 }], 700);
          tween(app, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.9)', opacity: 0 }], 700);
          var sheet = el('div', 'sheet', stage);
          sheet.style.cssText = 'left:480px;top:60px;width:960px;height:548px;opacity:0;transform:scale(.5)';
          sheet.innerHTML = '<img src="' + F.exported + '">';
          return tween(sheet, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }], 800, SPRING)
            .then(function () { return wait(.7); });
        });
      }).then(function () {
        var brow = el('div', '', stage);
        brow.style.cssText = 'position:absolute;left:0;right:0;bottom:330px;text-align:center;z-index:640';
        ['PDF', 'SVG', 'TIFF', 'PNG', 'JPEG'].forEach(function (f, i) {
          var b = el('span', 'format-badge', brow, f); b.style.margin = '0 10px'; b.style.opacity = 0;
          wait(i * .08).then(function () { pop(b, 350); });
        });
        var line = el('div', '', stage, S.export_line);
        line.style.cssText = 'position:absolute;left:0;right:0;bottom:272px;text-align:center;color:#9FB3C8;font-size:26px;z-index:640;opacity:0';
        wait(.5).then(function () { tween(line, [{ opacity: 0 }, { opacity: 1 }], 400); });
      });
    });
  });

  /* ================= S8 OUTRO ================= */
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
  /* ================= S8 OUTRO (delays ×0.65 ≈ 3.5 s build + hold) ================= */
  scene('outro', 9.5, function (t0) {
    at(t0, function () {
    captionOff(); hideCursor();
    var dark2 = el('div', 'backdrop', stage);
    dark2.style.opacity = 0; dark2.style.zIndex = 700;
    var grid2 = el('div', 'bggrid', dark2);
    for (var i = 0; i < 14; i++) {
      var p = el('div', 'panel', grid2);
      var w = 140 + Math.random() * 260, h = 100 + Math.random() * 200;
      p.style.cssText = 'width:' + w + 'px;height:' + h + 'px;left:' +
        (Math.random() * 1800) + 'px;top:' + (Math.random() * 980) + 'px;';
      (function (pp) {
        pp.animate([{ transform: 'translate(0,0)' },
          { transform: 'translate(' + (Math.random() * 60 - 30) + 'px,' + (Math.random() * 40 - 20) + 'px)' }],
          { duration: 6000 + Math.random() * 6000, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
      })(p);
    }
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
        s.innerHTML = wi === 0 ?
          '<span class="ilm">' + wd[0] + '</span>' + wd.slice(1) : wd;
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

    tween(dark2, [{ opacity: 0 }, { opacity: 1 }], 600);
    wait(.33).then(function () { pop(ic, 600); });
    wait(.52).then(function () {
      tween(t2, [{ opacity: 0, transform: 'translateY(30px)' },
        { opacity: 1, transform: 'translateY(0)' }], 550);
    });
    mo.querySelectorAll('.mword').forEach(function (e, i) {
      wait(.91 + i * .06).then(function () {
        tween(e, [{ opacity: 0, transform: 'translateY(16px)' },
          { opacity: 1, transform: 'translateY(0)' }], 400);
      });
    });
    var tIlms = t2.querySelectorAll('.ilm'), mIlms = mo.querySelectorAll('.ilm');
    [1.5, 1.66, 1.82].forEach(function (ts, i) {
      wait(ts).then(function () {
        [tIlms[i], mIlms[i]].forEach(function (e) {
          e.classList.add('lit');
          if (!FF) e.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' },
            { transform: 'scale(1)' }], { duration: 400, easing: EASE });
        });
      });
    });
    Array.prototype.forEach.call(cards.children, function (card, i) {
      wait(2.21 + i * .1).then(function () {
        tween(card, [{ opacity: 0, transform: 'translateY(40px)' },
          { opacity: 1, transform: 'translateY(0)' }], 500);
        tween(card.querySelector('.bar'),
          [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 550);
      });
    });
    wait(2.99).then(function () {
      tween(cta, [{ opacity: 0, transform: 'translateX(-50%) scale(.6)' },
        { opacity: 1, transform: 'translateX(-50%) scale(1)' }], 450, SPRING)
        .then(function () { cta.classList.add('shine'); });
    });
    wait(3.25).then(function () { tween(meta, [{ opacity: 0 }, { opacity: 1 }], 500); });
    });
  });
  END_T = T;          // loop reload at the end of the outro hold

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
            try { nextCue.fn(); } catch (e) {}
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
  // warm the image cache (don't gate the clock on it — headless virtual
  // time can outrun real decode and stall the boot)
  Object.keys(F.frames).forEach(function (k) {
    var im = new Image(); im.src = F.frames[k];
  });
  if (F.exported) { var ex = new Image(); ex.src = F.exported; }
  ['assets/Reflow-off.webp', 'assets/Reflow-on.webp'].forEach(function (u) {
    var ri = new Image(); ri.src = u;
  });
  boot();
})();
