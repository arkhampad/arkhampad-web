// @ts-nocheck
/* Arena brain: 24 small agents plus an online-learning brain. Same code as the backtest. */
export const ArenaBrain = (function () {
  var clamp = function (v) { return v > 1 ? 1 : v < -1 ? -1 : (isFinite(v) ? v : 0); };
  var mean = function (a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; };
  var std = function (a) { var m = mean(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / (a.length || 1)) || 1e-9; };
  var ema = function (a, n) { var k = 2 / (n + 1), e = a[0]; for (var i = 1; i < a.length; i++) e = a[i] * k + e * (1 - k); return e; };
  function emaSeries(a, n) { var k = 2 / (n + 1), e = a[0], o = [e]; for (var i = 1; i < a.length; i++) { e = a[i] * k + e * (1 - k); o.push(e); } return o; }
  function rets(c, n) { var o = []; for (var i = Math.max(1, c.length - n); i < c.length; i++) o.push(c[i].c / c[i - 1].c - 1); return o; }
  function rsi(c, n) { var g = 0, l = 0; for (var i = Math.max(1, c.length - n); i < c.length; i++) { var d = c[i].c - c[i - 1].c; if (d > 0) g += d; else l -= d; } return l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l); }
  function volz(c, h) { return std(rets(c, 120)) * Math.sqrt(h) || 1e-9; }

  var AGENTS = [
    { id: "mom1", name: "Momentum 1x", group: "Price", f: function (c, h) { var n = h; var r = c[c.length - 1].c / c[c.length - 1 - n].c - 1; return clamp(r / volz(c, h)); } },
    { id: "mom2", name: "Momentum 2x", group: "Price", f: function (c, h) { var n = 2 * h; var r = c[c.length - 1].c / c[c.length - 1 - n].c - 1; return clamp(r / (volz(c, h) * 1.4)); } },
    { id: "mom4", name: "Momentum 4x", group: "Price", f: function (c, h) { var n = Math.min(4 * h, c.length - 2); var r = c[c.length - 1].c / c[c.length - 1 - n].c - 1; return clamp(r / (volz(c, h) * 2)); } },
    { id: "rev", name: "Snap back", group: "Price", f: function (c, h) { var w = c.slice(-4 * h).map(function (x) { return x.c; }); return clamp(-(w[w.length - 1] - mean(w)) / (2 * std(w))); } },
    { id: "accel", name: "Acceleration", group: "Price", f: function (c, h) { var a = c[c.length - 1].c / c[c.length - 1 - h].c - 1, b = c[c.length - 1 - h].c / c[c.length - 1 - 2 * h].c - 1; return clamp((a - b) / volz(c, h)); } },
    { id: "spike", name: "Spike fade", group: "Price", f: function (c, h) { var r = c[c.length - 1].c / c[c.length - 2].c - 1; var z = r / (std(rets(c, 120)) || 1e-9); return Math.abs(z) > 2.5 ? clamp(-z / 5) : 0; } },
    { id: "streak", name: "Streak fade", group: "Price", f: function (c) { var k = 0, d = c[c.length - 1].c >= c[c.length - 1].o ? 1 : -1; for (var i = c.length - 1; i >= 0 && k < 8; i--) { var x = c[i].c >= c[i].o ? 1 : -1; if (x !== d) break; k++; } return k >= 4 ? clamp(-d * (k - 3) / 4) : 0; } },
    { id: "rsi14", name: "RSI 14", group: "Indicators", f: function (c) { return clamp(-(rsi(c, 14) - 50) / 30); } },
    { id: "rsi7", name: "RSI 7", group: "Indicators", f: function (c) { return clamp(-(rsi(c, 7) - 50) / 30); } },
    { id: "stoch", name: "Stochastic", group: "Indicators", f: function (c) { var w = c.slice(-14), hi = -1e18, lo = 1e18; for (var i = 0; i < w.length; i++) { if (w[i].h > hi) hi = w[i].h; if (w[i].l < lo) lo = w[i].l; } var k = hi === lo ? 50 : (c[c.length - 1].c - lo) / (hi - lo) * 100; return clamp(-(k - 50) / 40); } },
    { id: "macd", name: "MACD", group: "Indicators", f: function (c) { var cl = c.slice(-80).map(function (x) { return x.c; }); var e12 = emaSeries(cl, 12), e26 = emaSeries(cl, 26); var m = e12.map(function (v, i) { return v - e26[i]; }); var sig = ema(m, 9); return clamp((m[m.length - 1] - sig) / (std(cl) * 0.05)); } },
    { id: "emax", name: "EMA 9/21", group: "Indicators", f: function (c) { var cl = c.slice(-60).map(function (x) { return x.c; }); return clamp((ema(cl, 9) - ema(cl, 21)) / (std(cl) * 0.5)); } },
    { id: "bbfade", name: "Bollinger fade", group: "Indicators", f: function (c) { var w = c.slice(-20).map(function (x) { return x.c; }); var b = (w[w.length - 1] - mean(w)) / (2 * std(w)); return clamp(-b); } },
    { id: "bbbreak", name: "Bollinger break", group: "Indicators", f: function (c) { var w = c.slice(-20).map(function (x) { return x.c; }); var b = (w[w.length - 1] - mean(w)) / (2 * std(w)); return Math.abs(b) > 1 ? clamp(b - (b > 0 ? 1 : -1)) * 2 : 0; } },
    { id: "vwap", name: "VWAP gap", group: "Indicators", f: function (c) { var w = c.slice(-30), pv = 0, v = 0; for (var i = 0; i < w.length; i++) { pv += w[i].c * w[i].v; v += w[i].v; } var vw = v ? pv / v : w[w.length - 1].c; return clamp(-(w[w.length - 1].c / vw - 1) / (std(rets(c, 60)) * 3)); } },
    { id: "volsurge", name: "Volume surge", group: "Volume", f: function (c) { var vs = c.slice(-31, -1).map(function (x) { return x.v; }); var r = c[c.length - 1].v / (mean(vs) || 1); var d = c[c.length - 1].c >= c[c.length - 1].o ? 1 : -1; return clamp(d * (r - 1) / 3); } },
    { id: "obv", name: "On-balance volume", group: "Volume", f: function (c) { var w = c.slice(-20), o = 0, tot = 0; for (var i = 1; i < w.length; i++) { var s = w[i].c > w[i - 1].c ? 1 : w[i].c < w[i - 1].c ? -1 : 0; o += s * w[i].v; tot += w[i].v; } return clamp(tot ? o / tot * 2 : 0); } },
    { id: "volmom", name: "Volume-weighted move", group: "Volume", f: function (c) { var w = c.slice(-10), s = 0, t = 0; for (var i = 0; i < w.length; i++) { s += (w[i].c - w[i].o) * w[i].v; t += Math.abs(w[i].c - w[i].o) * w[i].v; } return clamp(t ? s / t : 0); } },
    { id: "buyers", name: "Buyer pressure", group: "Flow", f: function (c) { var w = c.slice(-10), s = 0, t = 0; for (var i = 0; i < w.length; i++) { var rg = w[i].h - w[i].l || 1e-9; s += ((w[i].c - w[i].l) / rg * 2 - 1) * w[i].v; t += w[i].v; } return clamp(t ? s / t * 1.5 : 0); } },
    { id: "clv", name: "Close location", group: "Flow", f: function (c) { var x = c[c.length - 1], rg = x.h - x.l || 1e-9; return clamp(((x.c - x.l) / rg * 2 - 1)); } },
    { id: "wick", name: "Wick rejection", group: "Flow", f: function (c) { var x = c[c.length - 1], rg = x.h - x.l || 1e-9; var up = (x.h - Math.max(x.o, x.c)) / rg, dn = (Math.min(x.o, x.c) - x.l) / rg; return clamp((dn - up) * 1.5); } },
    { id: "body3", name: "Candle bodies", group: "Flow", f: function (c) { var w = c.slice(-3), s = 0; for (var i = 0; i < w.length; i++) { s += (w[i].c - w[i].o) / (w[i].h - w[i].l || 1e-9); } return clamp(s / 2); } },
    { id: "struct", name: "Highs and lows", group: "Structure", f: function (c, h) { var a = c.slice(-h * 2 - 1, -h), b = c.slice(-h); var ha = Math.max.apply(null, a.map(function (x) { return x.h; })), hb = Math.max.apply(null, b.map(function (x) { return x.h; })); var la = Math.min.apply(null, a.map(function (x) { return x.l; })), lb = Math.min.apply(null, b.map(function (x) { return x.l; })); return clamp(((hb > ha ? 1 : -1) + (lb > la ? 1 : -1)) / 2); } },
    { id: "range", name: "Range position", group: "Structure", f: function (c) { var w = c.slice(-30), hi = -1e18, lo = 1e18; for (var i = 0; i < w.length; i++) { if (w[i].h > hi) hi = w[i].h; if (w[i].l < lo) lo = w[i].l; } return clamp(-((c[c.length - 1].c - lo) / (hi - lo || 1) - 0.5) * 2); } }
  ];

  function features(c, h) {
    var x = new Array(AGENTS.length);
    for (var i = 0; i < AGENTS.length; i++) { try { x[i] = AGENTS[i].f(c, h); } catch (e) { x[i] = 0; } if (!isFinite(x[i])) x[i] = 0; }
    return x;
  }

  // Brain: online logistic regression over the agents' scores, with L2 and a small learning rate.
  function Brain(n, lr, l2) { this.w = new Array(n).fill(0); this.b = 0; this.lr = lr || 0.02; this.l2 = l2 || 0.001; this.n = 0; }
  Brain.prototype.p = function (x) { var z = this.b; for (var i = 0; i < x.length; i++) z += this.w[i] * x[i]; return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z)))); };
  Brain.prototype.learn = function (x, up) { var e = (up ? 1 : 0) - this.p(x); for (var i = 0; i < x.length; i++) this.w[i] += this.lr * (e * x[i] - this.l2 * this.w[i]); this.b += this.lr * e * 0.2; this.n++; };

  return { AGENTS: AGENTS, features: features, Brain: Brain };
})();
