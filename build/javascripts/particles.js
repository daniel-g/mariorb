document.addEventListener('DOMContentLoaded', function() {
  var canvas = document.getElementById('particles');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var hero = canvas.parentElement;

  var CELL = 28;           // lattice spacing in CSS px
  var DENSITY = 0.22;      // Bernoulli occupancy probability
  var RATE_PER_PARTICLE = 3.8; // exponential jump attempts per second, per particle
  var MOVE_S = 0.22;       // seconds for a hop to an empty site
  var BOUNCE_S = 0.16;     // seconds for a blocked out-and-back nudge
  var BOUNCE_DEPTH = 0.28; // fraction of a cell a blocked particle pokes toward its target
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var LINE_DIRS = [[1, 0], [0, 1]]; // draw each neighbor edge once

  var dpr, cols, rows, cellPx, occ, particles, t, timeToNext;

  function idx(gx, gy) { return gy * cols + gx; }
  function wrap(gx, gy) { return [((gx % cols) + cols) % cols, ((gy % rows) + rows) % rows]; }

  // Continuous-time SSEP: each particle has an independent rate-lambda
  // exponential clock. Their superposition is one global clock of rate
  // N*lambda; at each event a particle and direction are chosen uniformly.
  function sampleExp(rate) {
    return -Math.log(1 - Math.random()) / rate;
  }

  function totalRate() {
    return particles.length * RATE_PER_PARTICLE;
  }

  function seed() {
    occ = new Int32Array(cols * rows).fill(-1);
    particles = [];
    var id = 0;
    for (var gy = 0; gy < rows; gy++) {
      for (var gx = 0; gx < cols; gx++) {
        if (Math.random() < DENSITY) {
          var p = {
            id: id, gx: gx, gy: gy, x: 0, y: 0,
            r: 4 + Math.random() * 3,
            anim: null // { kind: 'move'|'bounce', ... }
          };
          occ[idx(gx, gy)] = id;
          particles.push(p);
          id++;
        }
      }
    }
    t = 0;
    timeToNext = sampleWait();
  }

  function sampleWait() {
    var R = totalRate();
    return R > 0 ? sampleExp(R) : Infinity;
  }

  function siteToPx(gx, gy) {
    return [(gx + 0.5) * cellPx, (gy + 0.5) * cellPx];
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    var w = hero.offsetWidth, h = hero.offsetHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.max(4, Math.floor(w / CELL));
    rows = Math.max(4, Math.floor(h / CELL));
    cellPx = Math.min(w / cols, h / rows);
    seed();
  }
  resize();
  window.addEventListener('resize', resize);

  function easeInOut(x) {
    return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  }

  // Fire one SSEP event: uniform particle, uniform direction, hop-or-bounce.
  function doEvent() {
    var p = particles[(Math.random() * particles.length) | 0];
    var d = DIRS[(Math.random() * DIRS.length) | 0];
    var target = wrap(p.gx + d[0], p.gy + d[1]);
    var tx = target[0], ty = target[1];
    var to = idx(tx, ty);

    if (occ[to] === -1) {
      occ[idx(p.gx, p.gy)] = -1;
      occ[to] = p.id;
      var wrapped = Math.abs(p.gx - tx) > 1 || Math.abs(p.gy - ty) > 1;
      p.anim = { kind: 'move', fgx: p.gx, fgy: p.gy, t0: t, dur: wrapped ? 0.0001 : MOVE_S };
      p.gx = tx; p.gy = ty;
    } else {
      p.anim = { kind: 'bounce', dgx: d[0], dgy: d[1], t0: t, dur: BOUNCE_S };
    }
  }

  function updateVisual(p) {
    var a = p.anim;
    if (!a) {
      var c = siteToPx(p.gx, p.gy);
      p.x = c[0]; p.y = c[1];
      return;
    }
    var prog = Math.min((t - a.t0) / a.dur, 1);
    if (a.kind === 'move') {
      var from = siteToPx(a.fgx, a.fgy);
      var to = siteToPx(p.gx, p.gy);
      var e = easeInOut(prog);
      p.x = from[0] + (to[0] - from[0]) * e;
      p.y = from[1] + (to[1] - from[1]) * e;
    } else {
      var home = siteToPx(p.gx, p.gy);
      var amt = Math.sin(prog * Math.PI) * BOUNCE_DEPTH * cellPx;
      p.x = home[0] + a.dgx * amt;
      p.y = home[1] + a.dgy * amt;
    }
    if (prog >= 1) p.anim = null;
  }

  var last = performance.now();
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    t += dt;

    timeToNext -= dt;
    var guard = 0;
    while (timeToNext <= 0 && guard < 1000) {
      doEvent();
      timeToNext += sampleWait();
      guard++;
    }

    for (var i = 0; i < particles.length; i++) updateVisual(particles[i]);

    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      for (var n = 0; n < LINE_DIRS.length; n++) {
        var nb = wrap(p.gx + LINE_DIRS[n][0], p.gy + LINE_DIRS[n][1]);
        if (occ[idx(nb[0], nb[1])] === -1) continue;
        var q = siteToPx(nb[0], nb[1]);
        if (Math.abs(q[0] - p.x) > (cellPx * cols) / 2) continue;
        if (Math.abs(q[1] - p.y) > (cellPx * rows) / 2) continue;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q[0], q[1]);
        ctx.strokeStyle = 'rgba(143,179,220,0.15)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }

    var path = new Path2D();
    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      path.moveTo(p.x + p.r, p.y);
      path.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(143,179,220,0.6)';
    ctx.fill(path);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
});
