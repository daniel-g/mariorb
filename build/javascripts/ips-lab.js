// Interacting particle systems lab.
// One generator on the ring Z_L,
//   L f(eta) = sum_x sum_r p(r) eta_x (alpha + sigma eta_{x+r}) [f(eta^{x,x+r}) - f(eta)],
// with p(r) = 1/(2R) for 1 <= |r| <= R. sigma = 0 is IRW, -1 is SEP(alpha), +1 is SIP(alpha).
// The dynamics is simulated exactly (Gillespie, site rates kept in a Fenwick tree).
(function () {
  'use strict';

  // ---------- engine ----------

  function Engine(eta, sigma, alpha, R) {
    this.L = eta.length;
    this.eta = eta;
    this.N = 0;
    for (var i = 0; i < this.L; i++) this.N += eta[i];
    this.rate = new Float64Array(this.L);
    this.tree = new Float64Array(this.L + 1);
    this.topBit = 1;
    while (this.topBit * 2 <= this.L) this.topBit *= 2;
    this.t = 0;
    this.jumps = 0;
    // time integrals of the occupations, for time-averaged pictures
    this.acc = new Float64Array(this.L);
    this.last = new Float64Array(this.L);
    this.setParams(sigma, alpha, R);
  }

  // mean occupation over [T0, T]; resets the integrals unless peek is set
  Engine.prototype.average = function (T, T0, peek) {
    var L = this.L, out = new Float32Array(L), span = T - T0;
    for (var x = 0; x < L; x++) {
      var a = this.acc[x] + this.eta[x] * (T - this.last[x]);
      out[x] = span > 0 ? a / span : this.eta[x];
      if (!peek) { this.acc[x] = 0; this.last[x] = T; }
    }
    return out;
  };

  Engine.prototype.setParams = function (sigma, alpha, R) {
    this.sigma = sigma;
    this.alpha = alpha;
    this.R = R;
    this.p = 1 / (2 * R);
    this.w = new Float64Array(2 * R);
    this.y = new Int32Array(2 * R);
    this.rebuild();
    this.tNext = this.t + this.holding();
  };

  Engine.prototype.siteRate = function (x) {
    var e = this.eta, n = e[x];
    if (n === 0) return 0;
    var L = this.L, a = this.alpha, s = this.sigma, sum = 0;
    for (var r = 1; r <= this.R; r++) {
      var w1 = a + s * e[(x + r) % L];
      var w2 = a + s * e[(x - r + L) % L];
      if (w1 > 0) sum += w1;
      if (w2 > 0) sum += w2;
    }
    return n * sum * this.p;
  };

  Engine.prototype.rebuild = function () {
    var L = this.L, tr = this.tree, i, j;
    tr.fill(0);
    this.total = 0;
    for (i = 0; i < L; i++) {
      this.rate[i] = this.siteRate(i);
      this.total += this.rate[i];
    }
    for (i = 1; i <= L; i++) {
      tr[i] += this.rate[i - 1];
      j = i + (i & -i);
      if (j <= L) tr[j] += tr[i];
    }
  };

  Engine.prototype.add = function (x, d) {
    for (var i = x + 1; i <= this.L; i += i & -i) this.tree[i] += d;
  };

  Engine.prototype.update = function (x) {
    var nr = this.siteRate(x), d = nr - this.rate[x];
    if (d !== 0) {
      this.rate[x] = nr;
      this.add(x, d);
      this.total += d;
    }
  };

  // site x with prefix(x) <= u < prefix(x+1)
  Engine.prototype.pick = function (u) {
    var pos = 0, tr = this.tree, L = this.L;
    for (var b = this.topBit; b > 0; b >>= 1) {
      var nx = pos + b;
      if (nx <= L && tr[nx] <= u) { pos = nx; u -= tr[nx]; }
    }
    if (pos < L && this.rate[pos] > 0) return pos;
    // rounding fallback: last site with positive rate
    for (var x = L - 1; x >= 0; x--) if (this.rate[x] > 0) return x;
    return -1;
  };

  Engine.prototype.holding = function () {
    return this.total > 1e-12 ? -Math.log(1 - Math.random()) / this.total : Infinity;
  };

  // perform the jump scheduled at tNext
  Engine.prototype.jump = function () {
    if (!isFinite(this.tNext)) return false;
    var x = this.pick(Math.random() * this.total);
    if (x < 0) { this.tNext = Infinity; return false; }
    var e = this.eta, L = this.L, a = this.alpha, s = this.sigma, R = this.R;
    var w = this.w, y = this.y, wsum = 0, j, k = 0;
    for (var r = 1; r <= R; r++) {
      y[k] = (x + r) % L; w[k] = Math.max(0, a + s * e[y[k]]); wsum += w[k]; k++;
      y[k] = (x - r + L) % L; w[k] = Math.max(0, a + s * e[y[k]]); wsum += w[k]; k++;
    }
    var u = Math.random() * wsum, cum = 0, to = -1;
    for (j = 0; j < k; j++) {
      if (w[j] <= 0) continue;
      cum += w[j];
      to = y[j];
      if (u < cum) break;
    }
    var tj = this.tNext, acc = this.acc, last = this.last;
    acc[x] += e[x] * (tj - last[x]); last[x] = tj;
    acc[to] += e[to] * (tj - last[to]); last[to] = tj;
    e[x]--;
    e[to]++;
    for (j = -R; j <= R; j++) {
      this.update((x + j + L) % L);
      this.update((to + j + L) % L);
    }
    this.t = this.tNext;
    this.jumps++;
    if (this.jumps % 200000 === 0) this.rebuild();
    this.tNext = this.t + this.holding();
    return true;
  };

  // ---------- exact mean: E[eta_x(t)] solves the discrete heat equation ----------
  // d/dt m_x = alpha sum_r p(r) (m_{x+r} - m_x), for every sigma (the sigma terms cancel by symmetry of p).

  function MeanProfile(L) {
    this.L = L;
    this.cos = new Float64Array(L);
    this.sin = new Float64Array(L);
    for (var m = 0; m < L; m++) {
      this.cos[m] = Math.cos(2 * Math.PI * m / L);
      this.sin[m] = Math.sin(2 * Math.PI * m / L);
    }
    this.A = new Float64Array(L);
    this.B = new Float64Array(L);
    this.lam = new Float64Array(L);
    this.t0 = 0;
  }

  MeanProfile.prototype.setParams = function (alpha, R) {
    this.alpha = alpha;
    for (var k = 0; k < this.L; k++) {
      var s = 0;
      for (var r = 1; r <= R; r++) s += 1 - this.cos[(k * r) % this.L];
      this.lam[k] = s / R; // sum over +-r of p(r) (1 - cos) with p = 1/(2R)
    }
  };

  MeanProfile.prototype.anchor = function (profile, t0) {
    var L = this.L;
    for (var k = 0; k < L; k++) {
      var a = 0, b = 0;
      for (var x = 0; x < L; x++) {
        var m = (k * x) % L;
        a += profile[x] * this.cos[m];
        b += profile[x] * this.sin[m];
      }
      this.A[k] = a;
      this.B[k] = b;
    }
    this.t0 = t0;
  };

  MeanProfile.prototype.evaluate = function (t, out) {
    var L = this.L, dt = Math.max(0, t - this.t0);
    out.fill(0);
    for (var k = 0; k < L; k++) {
      var f = Math.exp(-this.alpha * this.lam[k] * dt) / L;
      if (k > 0 && f < 1e-12) continue;
      var a = this.A[k] * f, b = this.B[k] * f;
      for (var x = 0; x < L; x++) {
        var m = (k * x) % L;
        out[x] += a * this.cos[m] + b * this.sin[m];
      }
    }
  };

  // ---------- equilibrium laws ----------

  // variance of one site under the product invariant measure of density rho
  function localVariance(rho, alpha, sigma) {
    return Math.max(0, rho * (alpha + sigma * rho) / alpha);
  }

  // one-site law of the invariant measure on the ring with exactly N particles
  // (Polya urn with weights alpha + sigma eta_x):
  // P(k+1)/P(k) = (N-k)/(k+1) * (alpha + sigma k) / ((L-1) alpha + sigma (N-k-1))
  function ringLaw(N, L, alpha, sigma) {
    var P = new Float64Array(N + 1);
    var kmin = 0, kmax = N;
    if (sigma < 0) {
      kmin = Math.max(0, N - (L - 1) * alpha);
      kmax = Math.min(N, alpha);
    }
    var logP = new Float64Array(N + 1), top = 0, k;
    for (k = kmin; k < kmax; k++) {
      logP[k + 1] = logP[k] + Math.log(N - k) - Math.log(k + 1) +
        Math.log(alpha + sigma * k) - Math.log((L - 1) * alpha + sigma * (N - k - 1));
      if (logP[k + 1] > top) top = logP[k + 1];
    }
    var z = 0;
    for (k = kmin; k <= kmax; k++) { P[k] = Math.exp(logP[k] - top); z += P[k]; }
    for (k = kmin; k <= kmax; k++) P[k] /= z;
    return P;
  }

  // ---------- initial configurations ----------

  function fillProfile(f, N, cap) {
    var L = f.length, total = 0, x, eta = new Int32Array(L), placed = 0, peak = 0;
    for (x = 0; x < L; x++) { total += f[x]; if (f[x] > f[peak]) peak = x; }
    var target = new Float64Array(L);
    for (x = 0; x < L; x++) {
      target[x] = N * f[x] / total;
      eta[x] = Math.min(cap, Math.floor(target[x]));
      placed += eta[x];
    }
    var order = [];
    for (x = 0; x < L; x++) order.push(x);
    order.sort(function (i, j) { return (target[j] - eta[j]) - (target[i] - eta[i]); });
    for (var i = 0; i < L && placed < N; i++) {
      if (eta[order[i]] < cap && target[order[i]] > eta[order[i]]) { eta[order[i]]++; placed++; }
    }
    // whatever the cap pushed out goes to the free sites closest to the peak
    var dist = function (z) { var d = Math.abs(z - peak); return Math.min(d, L - d); };
    order.sort(function (i, j) { return dist(i) - dist(j); });
    while (placed < N) {
      for (i = 0; i < L && placed < N; i++) {
        if (eta[order[i]] < cap) { eta[order[i]]++; placed++; }
      }
    }
    return eta;
  }

  function initialConfiguration(type, N, L, alpha, sigma) {
    var cap = sigma < 0 ? alpha : Infinity, f = new Float64Array(L), x;
    if (type === 'equilibrium') {
      var eta = new Int32Array(L), wsum = L * alpha;
      for (var n = 0; n < N; n++) {
        var u = Math.random() * wsum, acc = 0;
        for (x = 0; x < L - 1; x++) {
          acc += alpha + sigma * eta[x];
          if (u < acc) break;
        }
        eta[x]++;
        wsum += sigma;
      }
      return eta;
    }
    for (x = 0; x < L; x++) {
      if (type === 'bump') f[x] = 1 + 0.8 * Math.cos(2 * Math.PI * (x - L / 2) / L);
      else if (type === 'half') f[x] = (x >= L / 4 && x < 3 * L / 4) ? 1 : 0;
      else if (type === 'one') f[x] = (x === Math.floor(L / 2)) ? 1 : 0;
      else f[x] = 1;
    }
    return fillProfile(f, N, cap);
  }

  var api = {
    Engine: Engine, MeanProfile: MeanProfile, ringLaw: ringLaw,
    localVariance: localVariance, initialConfiguration: initialConfiguration
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  // ---------- page ----------

  var NAVY = '#0C1A2E', GOLD = '#EFD99A', STEEL = '#8BA3C0', DOT = 'rgba(143,179,220,0.88)';
  var OFFWHITE = '#F0F4FA';

  var SPEEDS = { jumpSpeed: 2000, realSpeed: 5, logSpeed: 0.3 };
  var PRESETS = {
    condensation: { sigma: 1, alpha: 0.01, N: 240, L: 40, R: 1, init: 'even', clock: 'log', logSpeed: 0.3, sqrt: false },
    hydro: { sigma: 0, alpha: 1, N: 3000, L: 150, R: 1, init: 'bump', clock: 'real', realSpeed: 150, sqrt: false },
    exclusion: { sigma: -1, alpha: 1, N: 60, L: 120, R: 1, init: 'half', clock: 'real', realSpeed: 80, sqrt: false },
    fluctuations: { sigma: 1, alpha: 4, N: 300, L: 150, R: 1, init: 'equilibrium', clock: 'real', realSpeed: 4, sqrt: false }
  };
  // what the speed slider means under each clock: [state key, label, min, max]
  var CLOCKS = {
    real: ['realSpeed', 'Time units per second', 1e-3, 1e4],
    log: ['logSpeed', 'Decades of t per second', 0.02, 2],
    jump: ['jumpSpeed', 'Jumps per second', 1, 1e6]
  };

  var ALPHA_RANGE = { '1': [0.005, 50], '0': [0.1, 10], '-1': [1, 8] };
  var N_MAX = 3000;

  function fmt(v) {
    if (v === 0) return '0';
    if (!isFinite(v)) return '∞';
    var a = Math.abs(v);
    if (a >= 1e5 || a < 1e-3) return v.toExponential(1).replace('e+', 'e');
    if (a >= 100) return Math.round(v).toString();
    return v.toPrecision(3).replace(/\.?0+$/, '');
  }

  function fmtAlpha(a) {
    if (a < 0.1) return a.toFixed(3).replace(/0+$/, '');
    if (a < 1) return a.toFixed(2).replace(/0+$/, '');
    if (a < 10) return (Math.round(a * 10) / 10).toString();
    return Math.round(a).toString();
  }

  function fmtCount(n) {
    if (n < 1e4) return n.toString();
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e5 ? 1 : 0) + 'k';
    return (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + 'M';
  }

  function setupCanvas(canvas) {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h, dpr: dpr };
  }

  // navy -> steel -> light steel -> gold
  var LUT = (function () {
    var stops = [[12, 26, 46], [44, 78, 120], [143, 179, 220], [239, 217, 154]];
    var out = [];
    for (var i = 0; i < 256; i++) {
      var s = i / 255 * (stops.length - 1), j = Math.min(stops.length - 2, Math.floor(s)), f = s - j;
      out.push([0, 1, 2].map(function (c) { return Math.round(stops[j][c] + f * (stops[j + 1][c] - stops[j][c])); }));
    }
    return out;
  })();

  function init() {
    var root = document.getElementById('ips-lab');
    if (!root) return;
    var $ = function (id) { return document.getElementById(id); };

    var S = Object.assign({}, SPEEDS, PRESETS.condensation);
    S.playing = true;

    var eng, heat, mean, localAvg, law, histEMA, kymoTimes, history, marks, capped, jumpAcc;
    var views = {};

    // ----- controls -----
    var modelBtns = root.querySelectorAll('[data-sigma]');
    var alphaIn = $('ips-alpha'), nIn = $('ips-n'), lIn = $('ips-l'), rIn = $('ips-r');
    var initIn = $('ips-init'), speedIn = $('ips-speed'), sqrtIn = $('ips-sqrt');
    var clockBtns = root.querySelectorAll('[data-clock]');
    var playBtn = $('ips-play'), stepBtn = $('ips-step'), restartBtn = $('ips-restart');

    function alphaToSlider(a) {
      var r = ALPHA_RANGE[String(S.sigma)];
      if (S.sigma < 0) return (a - r[0]) / (r[1] - r[0]) * 1000;
      return Math.log(a / r[0]) / Math.log(r[1] / r[0]) * 1000;
    }
    function sliderToAlpha(v) {
      var r = ALPHA_RANGE[String(S.sigma)];
      if (S.sigma < 0) return Math.round(r[0] + v / 1000 * (r[1] - r[0]));
      var a = r[0] * Math.pow(r[1] / r[0], v / 1000);
      var mag = Math.pow(10, Math.floor(Math.log10(a)) - 1);
      return Math.round(a / mag) * mag; // two significant digits
    }
    function nToSlider(n) { return Math.log(n) / Math.log(N_MAX) * 1000; }
    function sliderToN(v) { return Math.max(1, Math.round(Math.pow(N_MAX, v / 1000))); }
    function speedToSlider(s) { var c = CLOCKS[S.clock]; return Math.log(s / c[2]) / Math.log(c[3] / c[2]) * 1000; }
    function sliderToSpeed(v) { var c = CLOCKS[S.clock]; return c[2] * Math.pow(c[3] / c[2], v / 1000); }

    function clampAlpha() {
      var r = ALPHA_RANGE[String(S.sigma)];
      S.alpha = Math.min(r[1], Math.max(r[0], S.alpha));
      if (S.sigma < 0) S.alpha = Math.round(S.alpha);
    }
    function maxN() { return S.sigma < 0 ? Math.min(N_MAX, S.alpha * S.L) : N_MAX; }

    function syncControls() {
      modelBtns.forEach(function (b) { b.classList.toggle('active', Number(b.dataset.sigma) === S.sigma); });
      clockBtns.forEach(function (b) { b.classList.toggle('active', b.dataset.clock === S.clock); });
      alphaIn.step = S.sigma < 0 ? String(1000 / 7) : '1';
      alphaIn.value = alphaToSlider(S.alpha);
      nIn.value = nToSlider(S.N);
      lIn.value = S.L;
      rIn.value = S.R;
      initIn.value = S.init;
      speedIn.value = speedToSlider(S[CLOCKS[S.clock][0]]);
      sqrtIn.checked = S.sqrt;
      $('ips-alpha-val').textContent = fmtAlpha(S.alpha);
      $('ips-n-val').textContent = S.N;
      $('ips-l-val').textContent = S.L;
      $('ips-r-val').textContent = S.R;
      $('ips-speed-label').textContent = CLOCKS[S.clock][1];
      $('ips-speed-val').textContent = fmt(S[CLOCKS[S.clock][0]]);
      $('ips-rho-val').textContent = fmt(S.N / S.L);
      playBtn.textContent = S.playing ? 'Pause' : 'Play';
      renderRate();
    }

    function renderRate() {
      var a = fmtAlpha(S.alpha), tex;
      if (S.sigma > 0) tex = '\\eta_x\\,(' + a + ' + \\eta_y)';
      else if (S.sigma < 0) tex = '\\eta_x\\,(' + a + ' - \\eta_y)';
      else tex = (a === '1' ? '' : a + '\\,') + '\\eta_x';
      tex = 'p(y-x)\\,' + tex + ',\\qquad ' + (S.R === 1 ? 'p(\\pm 1) = \\tfrac12'
        : 'p(\\pm r) = \\tfrac{1}{' + 2 * S.R + '}\\ \\text{for}\\ 1\\le r\\le ' + S.R);
      var el = $('ips-rate');
      if (window.katex) window.katex.render(tex, el, { throwOnError: false });
      else el.textContent = tex;
    }

    // ----- simulation lifecycle -----
    function restart() {
      clampAlpha();
      S.N = Math.min(S.N, maxN());
      var eta = initialConfiguration(S.init, S.N, S.L, S.alpha, S.sigma);
      eng = new Engine(eta, S.sigma, S.alpha, S.R);
      heat = new MeanProfile(S.L);
      heat.setParams(S.alpha, S.R);
      heat.anchor(Float64Array.from(eta), 0);
      mean = new Float64Array(S.L);
      localAvg = new Float64Array(S.L);
      law = ringLaw(S.N, S.L, S.alpha, S.sigma);
      histEMA = null;
      history = [];
      marks = [];
      kymoTimes = [];
      capped = false;
      jumpAcc = 0;
      views.clockT = 0;
      views.scale = null;
      views.fscale = null;
      clearKymo();
      syncControls();
      draw();
    }

    // sigma, alpha, R act on the running configuration when it is admissible
    function changeDynamics() {
      clampAlpha();
      var admissible = true;
      if (S.sigma < 0) {
        for (var x = 0; x < eng.L; x++) if (eng.eta[x] > S.alpha) { admissible = false; break; }
      }
      if (!admissible) { restart(); return; }
      var t = S.clock === 'jump' ? eng.t : views.clockT;
      heat.evaluate(t, mean);
      heat.setParams(S.alpha, S.R);
      heat.anchor(mean, t);
      eng.t = t;
      eng.setParams(S.sigma, S.alpha, S.R);
      law = ringLaw(S.N, S.L, S.alpha, S.sigma);
      histEMA = null;
      marks.push(t);
      syncControls();
      draw();
    }

    function advance(dt) {
      var CAP = 120000, n = 0;
      capped = false;
      if (S.clock === 'jump') {
        jumpAcc += S.jumpSpeed * dt;
        var k = Math.floor(jumpAcc);
        jumpAcc -= k;
        if (k > CAP) { k = CAP; jumpAcc = 0; capped = true; }
        for (n = 0; n < k; n++) if (!eng.jump()) break;
        views.clockT = eng.t;
      } else {
        // real clock: t grows linearly; log clock: every decade of t takes the same wall time
        var target = S.clock === 'real' ? views.clockT + S.realSpeed * dt
                                        : Math.max(views.clockT, 0.01) * Math.pow(10, S.logSpeed * dt);
        while (eng.tNext <= target && n < CAP) { eng.jump(); n++; }
        if (n >= CAP) { capped = true; target = eng.t; }
        views.clockT = target;
      }
      return n;
    }

    function stepOnce() {
      S.playing = false;
      eng.jump();
      views.clockT = eng.t;
      syncControls();
      pushKymoRow();
      draw();
    }

    // ----- derived quantities -----
    function computeStats(t) {
      var L = S.L, e = eng.eta, x, maxEta = 0, empty = 0, sq = 0, pred = 0;
      heat.evaluate(t, mean);
      var h = Math.max(1, Math.round(L / 40)), acc = 0;
      for (x = -h; x <= h; x++) acc += e[(x + L) % L];
      for (x = 0; x < L; x++) {
        localAvg[x] = acc / (2 * h + 1);
        acc += e[(x + h + 1) % L] - e[(x - h + L) % L];
        if (e[x] > maxEta) maxEta = e[x];
        if (e[x] === 0) empty++;
        var d = e[x] - mean[x];
        sq += d * d;
        pred += localVariance(Math.max(0, mean[x]), S.alpha, S.sigma);
      }
      return { maxEta: maxEta, empty: empty / L, share: maxEta / Math.max(1, S.N), varObs: sq / L, varPred: pred / L };
    }

    // ----- drawing -----
    function draw() {
      var t = views.clockT || 0;
      var st = computeStats(t);
      drawParticles(st);
      drawFluct(st);
      drawHist();
      drawOrder(st, t);
      $('ips-t').textContent = fmt(t);
      $('ips-jumps').textContent = fmtCount(eng.jumps);
      $('ips-total').textContent = fmt(eng.total);
      $('ips-capped').hidden = !capped;
      $('ips-var-obs').textContent = fmt(st.varObs);
      $('ips-var-pred').textContent = fmt(st.varPred);
      views.stats = st;
    }

    function drawParticles(st) {
      var v = views.particles, ctx = v.ctx, W = v.w, H = v.h, L = S.L, e = eng.eta;
      var top = 16, base = H - 14, x, k;
      var maxMean = 0;
      for (x = 0; x < L; x++) maxMean = Math.max(maxMean, mean[x]);
      var target = S.sigma < 0 ? S.alpha : Math.max(2 * S.N / L + 2, maxMean * 1.3, st.maxEta * 1.05);
      views.scale = views.scale ? views.scale + (target - views.scale) * 0.12 : target;
      if (views.scale < target && st.maxEta > views.scale) views.scale = target;
      var scale = views.scale, span = base - top;
      var yOf = S.sqrt ? function (n) { return base - Math.sqrt(Math.max(0, n) / scale) * span; }
                       : function (n) { return base - n / scale * span; };

      ctx.fillStyle = NAVY;
      ctx.fillRect(0, 0, W, H);
      var dx = W / L, unit = span / scale;
      var dotR = Math.min(4.2, dx * 0.36, unit * 0.45);
      var useDots = !S.sqrt && dotR >= 1.1 && unit >= 2.2;

      ctx.fillStyle = DOT;
      if (useDots) {
        ctx.beginPath();
        for (x = 0; x < L; x++) {
          var cx = (x + 0.5) * dx;
          for (k = 0; k < e[x]; k++) {
            var cy = base - (k + 0.5) * unit;
            if (cy < top - unit) break;
            ctx.moveTo(cx + dotR, cy);
            ctx.arc(cx, cy, dotR, 0, 2 * Math.PI);
          }
        }
        ctx.fill();
      } else {
        var bw = Math.max(1, dx * 0.72);
        for (x = 0; x < L; x++) {
          if (e[x] === 0) continue;
          var y = Math.max(top - 6, yOf(e[x]));
          ctx.fillRect((x + 0.5) * dx - bw / 2, y, bw, base - y);
        }
      }

      // baseline and a tick for the scale
      ctx.strokeStyle = 'rgba(139,163,192,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, base + 0.5); ctx.lineTo(W, base + 0.5); ctx.stroke();

      function curve(arr, color, width, dash) {
        ctx.save();
        ctx.strokeStyle = color; ctx.lineWidth = width;
        if (dash) ctx.setLineDash(dash);
        ctx.beginPath();
        for (var i = 0; i < L; i++) {
          var px = (i + 0.5) * dx, py = yOf(arr[i]);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      }
      if ($('ips-show-avg').checked) curve(localAvg, 'rgba(240,244,250,0.75)', 1.3);
      curve(mean, GOLD, 2);

      ctx.fillStyle = STEEL;
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText((S.sqrt ? '√ scale, top = ' : 'top = ') + fmt(scale) + (scale === 1 ? ' particle' : ' particles'), W - 8, 12);
    }

    function drawFluct(st) {
      var v = views.fluct, ctx = v.ctx, W = v.w, H = v.h, L = S.L, e = eng.eta, x;
      ctx.fillStyle = NAVY;
      ctx.fillRect(0, 0, W, H);
      var mid = H / 2, maxDev = 1, band = new Float64Array(L);
      for (x = 0; x < L; x++) {
        band[x] = 2 * Math.sqrt(localVariance(Math.max(0, mean[x]), S.alpha, S.sigma));
        maxDev = Math.max(maxDev, Math.abs(e[x] - mean[x]), band[x]);
      }
      var tgt = maxDev * 1.1;
      views.fscale = views.fscale ? views.fscale + (tgt - views.fscale) * 0.1 : tgt;
      if (views.fscale < maxDev) views.fscale = tgt;
      var k = (mid - 10) / views.fscale, dx = W / L, bw = Math.max(1, dx * 0.72);

      ctx.fillStyle = 'rgba(239,217,154,0.05)';
      ctx.beginPath();
      for (x = 0; x < L; x++) ctx.lineTo((x + 0.5) * dx, mid - band[x] * k);
      for (x = L - 1; x >= 0; x--) ctx.lineTo((x + 0.5) * dx, mid + band[x] * k);
      ctx.fill();

      ctx.fillStyle = DOT;
      for (x = 0; x < L; x++) {
        var d = (e[x] - mean[x]) * k;
        if (d >= 0) ctx.fillRect((x + 0.5) * dx - bw / 2, mid - d, bw, d);
        else ctx.fillRect((x + 0.5) * dx - bw / 2, mid, bw, -d);
      }
      ctx.strokeStyle = 'rgba(239,217,154,0.7)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      [-1, 1].forEach(function (sgn) {
        ctx.beginPath();
        for (x = 0; x < L; x++) {
          var py = mid - sgn * band[x] * k;
          if (x === 0) ctx.moveTo((x + 0.5) * dx, py); else ctx.lineTo((x + 0.5) * dx, py);
        }
        ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(139,163,192,0.35)';
      ctx.beginPath(); ctx.moveTo(0, mid + 0.5); ctx.lineTo(W, mid + 0.5); ctx.stroke();
    }

    function drawHist() {
      var v = views.hist, ctx = v.ctx, W = v.w, H = v.h, N = S.N, e = eng.eta, k;
      var fresh = !histEMA;
      if (fresh) histEMA = new Float64Array(N + 1);
      var counts = new Float64Array(N + 1);
      for (var x = 0; x < S.L; x++) counts[e[x]] += 1 / S.L;
      for (k = 0; k <= N; k++) histEMA[k] = fresh ? counts[k] : 0.92 * histEMA[k] + 0.08 * counts[k];

      // display range: enough to hold 99.9% of the law and the current maximum
      var cum = 0, kTop = 0;
      for (k = 0; k <= N; k++) { cum += law[k]; if (cum < 0.999) kTop = k + 1; }
      for (k = N; k > kTop; k--) if (counts[k] > 0) { kTop = k; break; }
      kTop = Math.max(kTop, 4);
      var B = Math.min(kTop + 1, 36), width = Math.ceil((kTop + 1) / B);
      B = Math.ceil((kTop + 1) / width);
      var obs = new Float64Array(B), th = new Float64Array(B);
      for (k = 0; k <= N; k++) {
        var b = Math.min(B - 1, Math.floor(k / width));
        obs[b] += histEMA[k];
        th[b] += law[k];
      }
      var top = 18, base = H - 18, span = base - top, maxv = 0;
      for (b = 0; b < B; b++) maxv = Math.max(maxv, Math.sqrt(obs[b]), Math.sqrt(th[b]));
      maxv = Math.max(maxv, 0.05);
      ctx.fillStyle = NAVY;
      ctx.fillRect(0, 0, W, H);
      var left = 8, bwid = (W - 2 * left) / B;
      ctx.fillStyle = DOT;
      for (b = 0; b < B; b++) {
        var hgt = Math.sqrt(obs[b]) / maxv * span;
        ctx.fillRect(left + b * bwid + 1, base - hgt, Math.max(1, bwid - 2), hgt);
      }
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (b = 0; b < B; b++) {
        var y = base - Math.sqrt(th[b]) / maxv * span;
        ctx.moveTo(left + b * bwid, y);
        ctx.lineTo(left + (b + 1) * bwid, y);
      }
      ctx.stroke();
      ctx.fillStyle = STEEL;
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('0', left, H - 5);
      ctx.textAlign = 'right';
      ctx.fillText(String(kTop) + (width > 1 ? '  (bins of ' + width + ')' : ''), W - left, H - 5);
      ctx.fillText('√ scale', W - left, 12);
    }

    // The space-time panel keeps the whole run. Each row is the occupation averaged
    // over the time spanned by `stride` frames; when the buffer fills, neighbouring
    // rows are merged and the stride doubles, so every row covers the same number of
    // frames and under the log clock the vertical axis is log t.
    var KYMO_MAX = 480, kymoRows = [], kymoDur = [], kymoMax = 0, kymoT0 = 0;
    var kymoStride = 1, kymoCount = 0, kymoOff = document.createElement('canvas');

    function clearKymo() {
      kymoRows = [];
      kymoDur = [];
      kymoTimes = [];
      kymoMax = 0;
      kymoT0 = 0;
      kymoStride = 1;
      kymoCount = 0;
      kymoLastLog = null;
      renderKymo();
    }

    // under the log clock a new row starts every 0.005 decades of t, whatever the frame rate
    var kymoLastLog = null;
    function tickKymo() {
      if (S.clock !== 'log') { pushKymoRow(); return; }
      var lt = Math.log10(Math.max(views.clockT, 1e-9));
      if (kymoLastLog === null || lt - kymoLastLog >= 0.005) { kymoLastLog = lt; pushKymoRow(); }
      else renderKymo();
    }

    function pushKymoRow() {
      if (++kymoCount < kymoStride) { renderKymo(); return; }
      var T = views.clockT, row = eng.average(T, kymoT0);
      kymoDur.push(T - kymoT0);
      kymoT0 = T;
      kymoCount = 0;
      for (var x = 0; x < row.length; x++) if (row[x] > kymoMax) kymoMax = row[x];
      kymoRows.push(row);
      kymoTimes.push(T);
      if (kymoRows.length >= KYMO_MAX) {
        kymoStride *= 2;
        var rows = [], dur = [], times = [];
        for (var i = 0; i < kymoRows.length; i += 2) {
          if (i + 1 === kymoRows.length) { rows.push(kymoRows[i]); dur.push(kymoDur[i]); times.push(kymoTimes[i]); break; }
          var a = kymoDur[i], b = kymoDur[i + 1], w = a + b, m = new Float32Array(row.length);
          for (x = 0; x < row.length; x++) m[x] = w > 0 ? (kymoRows[i][x] * a + kymoRows[i + 1][x] * b) / w : kymoRows[i + 1][x];
          rows.push(m); dur.push(w); times.push(kymoTimes[i + 1]);
        }
        kymoRows = rows; kymoDur = dur; kymoTimes = times;
      }
      renderKymo();
    }

    function renderKymo() {
      var v = views.kymo, ctx = v.ctx, L = S.L, rows = kymoRows, dur = kymoDur;
      if (kymoCount > 0 && eng) { // the row still being filled
        rows = rows.concat([eng.average(views.clockT, kymoT0, true)]);
        dur = dur.concat([views.clockT - kymoT0]);
      }
      var n = rows.length;
      ctx.fillStyle = NAVY;
      ctx.fillRect(0, 0, v.w, v.h);
      $('ips-kymo-top').textContent = n ? 't = ' + fmt(kymoTimes.length ? kymoTimes[0] : views.clockT) : '';
      $('ips-kymo-bottom').textContent = n ? 't = ' + fmt(views.clockT) : '';
      if (!n) return;
      // square-root colour scale, normalised over the whole history; when there are
      // more rows than pixels, each pixel row shows the mean occupation of its rows
      var ref = S.sigma < 0 ? S.alpha : Math.max(2.5 * S.N / L, kymoMax, 1);
      var M = Math.min(n, v.canvas.height), mean = new Float64Array(L);
      kymoOff.width = L;
      kymoOff.height = M;
      var octx = kymoOff.getContext('2d'), img = octx.createImageData(L, M), d = img.data;
      for (var j = 0; j < M; j++) {
        var i0 = Math.floor(j * n / M), i1 = Math.max(i0 + 1, Math.floor((j + 1) * n / M)), x, i, wsum = 0;
        mean.fill(0);
        for (i = i0; i < i1; i++) {
          var w = dur[i] > 0 ? dur[i] : 1e-12;
          wsum += w;
          for (x = 0; x < L; x++) mean[x] += rows[i][x] * w;
        }
        for (x = 0; x < L; x++) {
          var col = LUT[Math.round(Math.sqrt(Math.min(1, mean[x] / wsum / ref)) * 255)], o = (j * L + x) * 4;
          d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      var hgt = Math.min(v.h, n * 2);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(kymoOff, 0, 0, L, M, 0, 0, v.w, hgt);
      if (v.w / L >= 6) { // faint site separators when columns are wide
        ctx.strokeStyle = 'rgba(12,26,46,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (x = 1; x < L; x++) { var px = Math.round(x * v.w / L) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, hgt); }
        ctx.stroke();
      }
    }

    function drawOrder(st, t) {
      if (t > 0 && (history.length === 0 || t >= history[history.length - 1][0] * 1.015)) {
        history.push([t, st.share, st.empty]);
      }
      var v = views.order, ctx = v.ctx, W = v.w, H = v.h;
      ctx.fillStyle = NAVY;
      ctx.fillRect(0, 0, W, H);
      var left = 30, right = W - 8, top = 10, base = H - 22;
      ctx.strokeStyle = 'rgba(139,163,192,0.25)';
      ctx.lineWidth = 1;
      ctx.fillStyle = STEEL;
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'right';
      [0, 0.5, 1].forEach(function (q) {
        var y = base - q * (base - top);
        ctx.beginPath(); ctx.moveTo(left, y + 0.5); ctx.lineTo(right, y + 0.5); ctx.stroke();
        ctx.fillText(String(q), left - 5, y + 4);
      });
      if (history.length === 0 || t <= 0) return;
      var t0 = history[0][0], l0 = Math.log10(t0), l1 = Math.log10(Math.max(t, t0 * 10));
      var X = function (tt) { return left + (Math.log10(tt) - l0) / (l1 - l0) * (right - left); };
      var Y = function (q) { return base - q * (base - top); };

      // decade ticks
      ctx.textAlign = 'center';
      for (var dcd = Math.ceil(l0); dcd <= l1; dcd++) {
        var xt = X(Math.pow(10, dcd));
        ctx.beginPath(); ctx.moveTo(xt + 0.5, base); ctx.lineTo(xt + 0.5, base + 4); ctx.stroke();
        ctx.fillText('10' + superscript(dcd), xt, H - 6);
      }
      // equilibrium fraction of empty sites on this ring
      ctx.strokeStyle = 'rgba(143,179,220,0.55)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(left, Y(law[0]) + 0.5); ctx.lineTo(right, Y(law[0]) + 0.5); ctx.stroke();
      ctx.setLineDash([]);
      marks.forEach(function (m) {
        if (m <= t0) return;
        ctx.strokeStyle = 'rgba(240,244,250,0.3)';
        ctx.beginPath(); ctx.moveTo(X(m) + 0.5, top); ctx.lineTo(X(m) + 0.5, base); ctx.stroke();
      });
      function series(idx, color) {
        ctx.strokeStyle = color; ctx.lineWidth = 1.8;
        ctx.beginPath();
        history.forEach(function (h, i) { if (i === 0) ctx.moveTo(X(h[0]), Y(h[idx])); else ctx.lineTo(X(h[0]), Y(h[idx])); });
        ctx.lineTo(X(t), Y(idx === 1 ? st.share : st.empty));
        ctx.stroke();
      }
      series(2, DOT);
      series(1, GOLD);
    }

    function superscript(n) {
      var map = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
      return String(n).split('').map(function (c) { return map[c]; }).join('');
    }

    // ----- layout -----
    function layout() {
      ['particles', 'fluct', 'hist', 'kymo', 'order'].forEach(function (name) {
        var c = $('ips-' + name);
        var v = setupCanvas(c);
        v.canvas = c;
        views[name] = v;
      });
      views.fscale = null;
      if (eng) { renderKymo(); draw(); }
    }

    // ----- events -----
    modelBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        S.sigma = Number(b.dataset.sigma);
        changeDynamics();
      });
    });
    clockBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        S.clock = b.dataset.clock;
        views.clockT = eng.t;
        syncControls();
      });
    });
    alphaIn.addEventListener('input', function () {
      S.alpha = sliderToAlpha(Number(alphaIn.value));
      $('ips-alpha-val').textContent = fmtAlpha(S.alpha);
      renderRate();
    });
    alphaIn.addEventListener('change', changeDynamics);
    rIn.addEventListener('input', function () { S.R = Number(rIn.value); $('ips-r-val').textContent = S.R; renderRate(); });
    rIn.addEventListener('change', changeDynamics);
    nIn.addEventListener('input', function () {
      S.N = Math.min(sliderToN(Number(nIn.value)), maxN());
      $('ips-n-val').textContent = S.N;
      $('ips-rho-val').textContent = fmt(S.N / S.L);
    });
    nIn.addEventListener('change', restart);
    lIn.addEventListener('input', function () { S.L = Number(lIn.value); $('ips-l-val').textContent = S.L; });
    lIn.addEventListener('change', restart);
    initIn.addEventListener('change', function () { S.init = initIn.value; restart(); });
    speedIn.addEventListener('input', function () {
      var s = sliderToSpeed(Number(speedIn.value));
      S[CLOCKS[S.clock][0]] = s;
      $('ips-speed-val').textContent = fmt(s);
    });
    sqrtIn.addEventListener('change', function () { S.sqrt = sqrtIn.checked; views.scale = null; draw(); });
    $('ips-show-avg').addEventListener('change', draw);
    playBtn.addEventListener('click', function () { S.playing = !S.playing; syncControls(); });
    stepBtn.addEventListener('click', stepOnce);
    restartBtn.addEventListener('click', restart);

    function loadPreset(name) {
      Object.assign(S, SPEEDS, PRESETS[name]);
      S.playing = true;
      restart();
    }
    document.querySelectorAll('[data-preset]').forEach(function (b) {
      b.addEventListener('click', function () {
        loadPreset(b.dataset.preset);
        if (b.dataset.scroll !== undefined) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(layout, 150);
    });

    layout();
    restart();

    // the simulation only runs while the lab is on screen, to spare batteries
    var onScreen = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
      }).observe(root);
    }

    var last = performance.now();
    function frame(now) {
      var dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (S.playing && onScreen) {
        var n = advance(dt);
        if (n > 0 || S.clock !== 'jump') {
          tickKymo();
          draw();
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
