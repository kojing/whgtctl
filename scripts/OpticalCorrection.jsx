/*
  OpticalCorrection.jsx  v0.4
  Illustrator 用：塗りパスで組んだ文字のウェイト変更・太さの均一化・縦横比・光学補正

  使い方
    1. 1文字＝1グループにまとめた文字を選択（複数可）。
       グループに入っていないパスを選んだ場合は、それらをまとめて 1 文字として扱います。
    2. ファイル > スクリプト > その他のスクリプト… でこのファイルを実行。
    3. ダイアログでスライダーを調整（プレビュー可）→ OK。キャンセルで元に戻ります。

  前提
    - 塗りのある閉じたパス（複合パス可）を対象にします。線・開いたパス・クリッピングパスは無視します。
    - ベースラインとキャップハイト（かなは字面の上下）は選択範囲から自動検出し、ダイアログで修正できます。
    - 1 回の実行で選んだ文字を「同じ書体」とみなし、標準ステム（StdVW / StdHW）を共通で求めます。
*/

#target illustrator

/* ====================================================================== */
/* ES3 用の最小ポリフィル                                                   */
/* ====================================================================== */
if (!Array.prototype.forEach) Array.prototype.forEach = function (f) { for (var i = 0; i < this.length; i++) f(this[i], i, this); };
if (!Array.prototype.map) Array.prototype.map = function (f) { var r = []; for (var i = 0; i < this.length; i++) r.push(f(this[i], i, this)); return r; };
if (!Array.prototype.filter) Array.prototype.filter = function (f) { var r = []; for (var i = 0; i < this.length; i++) if (f(this[i], i, this)) r.push(this[i]); return r; };
if (!Array.prototype.some) Array.prototype.some = function (f) { for (var i = 0; i < this.length; i++) if (f(this[i], i, this)) return true; return false; };
if (!Array.prototype.reduce) Array.prototype.reduce = function (f, v) { for (var i = 0; i < this.length; i++) v = f(v, this[i], i, this); return v; };
if (!Array.prototype.indexOf) Array.prototype.indexOf = function (x) { for (var i = 0; i < this.length; i++) if (this[i] === x) return i; return -1; };
function hyp(a, b) { return Math.sqrt(a * a + b * b); }

/* ====================================================================== */
/* 幾何ユーティリティ                                                       */
/* ====================================================================== */
var KAPPA = 0.5523;
function median(v) { if (!v.length) return 0; var c = v.slice().sort(function (a, b) { return a - b; }); return c[Math.floor(c.length / 2)]; }
function polyArea(poly) { var s = 0; for (var i = 0; i < poly.length; i++) { var a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
function Cv(a, c1, c2, b) { return { a: a, c1: c1, c2: c2, b: b, line: false }; }
function reverseC(segs) { var r = []; for (var i = segs.length - 1; i >= 0; i--) { var g = segs[i]; r.push({ a: g.b, c1: g.c2, c2: g.c1, b: g.a, line: g.line }); } return r; }
function bez(g, t) { var u = 1 - t; return [u * u * u * g.a[0] + 3 * u * u * t * g.c1[0] + 3 * u * t * t * g.c2[0] + t * t * t * g.b[0], u * u * u * g.a[1] + 3 * u * u * t * g.c1[1] + 3 * u * t * t * g.c2[1] + t * t * t * g.b[1]]; }
function bezD(g, t) { var u = 1 - t; return [3 * u * u * (g.c1[0] - g.a[0]) + 6 * u * t * (g.c2[0] - g.c1[0]) + 3 * t * t * (g.b[0] - g.c2[0]), 3 * u * u * (g.c1[1] - g.a[1]) + 6 * u * t * (g.c2[1] - g.c1[1]) + 3 * t * t * (g.b[1] - g.c2[1])]; }
function nrm(v) { var l = hyp(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
function segTan(g, t) {
  if (g.line) return nrm([g.b[0] - g.a[0], g.b[1] - g.a[1]]);
  var d = bezD(g, t);
  if (hyp(d[0], d[1]) < 1e-6) d = [g.b[0] - g.a[0], g.b[1] - g.a[1]];
  return nrm(d);
}
function startTan(g) { return segTan(g, 0.001); }
function endTan(g) { return segTan(g, 0.999); }
function flattenSegs(segs, k) { var pts = []; segs.forEach(function (g) { var n = g.line ? 1 : k; for (var j = 0; j < n; j++) pts.push(bez(g, j / n)); }); return pts; }
function splitBez(g, t) {
  var lerp = function (p, q, u) { return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]; };
  var p01 = lerp(g.a, g.c1, t), p12 = lerp(g.c1, g.c2, t), p23 = lerp(g.c2, g.b, t), q0 = lerp(p01, p12, t), q1 = lerp(p12, p23, t), m = lerp(q0, q1, t);
  return [Cv(g.a, p01, q0, m), Cv(m, q1, p23, g.b)];
}
function extremaTs(g) {
  var ts = [];
  for (var k = 0; k < 2; k++) {
    var p0 = g.c1[k] - g.a[k], p1 = g.c2[k] - g.c1[k], p2 = g.b[k] - g.c2[k];
    var qa = p0 - 2 * p1 + p2, qb = p1 - p0, qc = p0;
    if (Math.abs(qa) < 1e-9) { if (Math.abs(qb) > 1e-9) ts.push(-qc / (2 * qb)); }
    else { var D = qb * qb - qa * qc; if (D >= 0) { var r = Math.sqrt(D); ts.push((-qb + r) / qa); ts.push((-qb - r) / qa); } }
  }
  ts = ts.filter(function (t) { return t > 0.03 && t < 0.97; }).sort(function (a, b) { return a - b; });
  return ts.filter(function (t, i, arr) { return i === 0 || t - arr[i - 1] > 0.03; });
}
function addExtrema(segs) {
  var out = [], added = 0;
  segs.forEach(function (g) {
    if (g.line) { out.push(g); return; }
    var ts = extremaTs(g), cur = g, prev = 0;
    ts.forEach(function (t) { var u = (t - prev) / (1 - prev), sp = splitBez(cur, u); out.push(sp[0]); cur = sp[1]; prev = t; added++; });
    out.push(cur);
  });
  return { segs: out, added: added };
}
function windingAt(cs, x, y) {
  var w = 0;
  for (var c = 0; c < cs.length; c++) {
    var P = cs[c], n = P.length, bb = P.bb;
    if (bb && (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3])) continue;   // 外接矩形の外なら寄与 0
    for (var i = 0; i < n; i++) {
      var a = P[i], b = P[(i + 1) % n], isl = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
      if (a[1] <= y) { if (b[1] > y && isl > 0) w++; }
      else if (b[1] <= y && isl < 0) w--;
    }
  }
  return w;
}
function rayHits(edges, qx, qy, nx, ny) {
  var hits = [];
  for (var k = 0; k < edges.length; k++) {
    var e = edges[k], ex = e[2] - e[0], ey = e[3] - e[1], den = nx * ey - ny * ex;
    if (Math.abs(den) < 1e-9) continue;
    var ax = e[0] - qx, ay = e[1] - qy, t = (ax * ey - ay * ex) / den, u = (ax * ny - ay * nx) / den;
    if (t > 1e-6 && u >= 0 && u < 1) hits.push([t, (ex * ny - ey * nx) > 0 ? 1 : -1]);
  }
  hits.sort(function (a, b) { return a[0] - b[0]; });
  return hits;
}
function rayExit(cs, edges, qx, qy, nx, ny) {
  var w = windingAt(cs, qx, qy); if (w === 0) return 0;
  var hits = rayHits(edges, qx, qy, nx, ny);
  for (var h = 0; h < hits.length; h++) { w += hits[h][1]; if (w === 0) return hits[h][0]; }
  return 1200;
}
// 外側の空き：向かい合う辺（レイにほぼ直交する辺）に当たるまでの距離。内角の隣の辺はかすめるだけなので数えない
function rayEnter(cs, edges, qx, qy, nx, ny) {
  var w = windingAt(cs, qx, qy); if (w !== 0) return 0;
  var best = 1000;
  for (var k = 0; k < edges.length; k++) {
    var e = edges[k], ex = e[2] - e[0], ey = e[3] - e[1], den = nx * ey - ny * ex, el = hyp(ex, ey);
    if (Math.abs(den) < 1e-9 || el < 1e-9) continue;
    var ax = e[0] - qx, ay = e[1] - qy, t = (ax * ey - ay * ex) / den, u = (ax * ny - ay * nx) / den;
    if (t > 1e-6 && u >= 0 && u < 1 && t < best && Math.abs(den) / el > 0.6) best = t;
  }
  return best;
}
function smoothstepCos(d, R) { return d >= R ? 0 : (1 + Math.cos(Math.PI * d / R)) / 2; }

/* ====================================================================== */
/* 解析（座標は「メトリクス高さ = 700u」に正規化済み、y 上向き）            */
/* ====================================================================== */
var ENG = { STEP: 9, FLAT: 10, SAMP: 12, BALL: false, TENS: 0.5, FREE: false, CSPLIT: 0 };
// 内接円（shrinking ball）：p で輪郭に接し、内側に向かって他の輪郭点に触れるまで膨らませた円の直径＝その点での画の太さ
function ballWidth(pts, px, py, nx, ny, cap) {
  var r = cap / 2;
  for (var i = 0; i < pts.length; i++) {
    var dx = pts[i][0] - px, dy = pts[i][1] - py, dn = dx * nx + dy * ny;
    if (dn <= 1e-3) continue;
    var d2 = dx * dx + dy * dy;
    if (d2 < 4) continue;                                  // 自分のすぐ隣の点は除く
    var rr = d2 / (2 * dn); if (rr < r) r = rr;
  }
  return 2 * r;
}

// contours: [{segs:[...]}]  m: {ft, fb, mid, band, spanK}
// 元の形だけで決まる分割（どのウェイトでも同じ位置で割れるので頂点数が揃う）
function splitByTurn(segs, deg) {
  var out = [], added = 0;
  segs.forEach(function (g) {
    if (g.line) { out.push(g); return; }
    var a = startTan(g), b = endTan(g), ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180 / Math.PI;
    var k = Math.max(1, Math.ceil(ang / deg - 0.05)), cur = g;
    for (var j = 1; j < k; j++) { var sp = splitBez(cur, 1 / (k - j + 1)); out.push(sp[0]); cur = sp[1]; added++; }
    out.push(cur);
  });
  return { segs: out, added: added };
}
function analyzeGlyph(contours, m, opts) {
  var added = 0, noEx = opts && opts.compat;
  var C = contours.map(function (segs) {
    if (noEx) { if (!ENG.CSPLIT) return segs; var r2 = splitByTurn(segs, ENG.CSPLIT); added += r2.added; return r2.segs; }
    var r = addExtrema(segs); added += r.added; return r.segs; });
  var flat = C.map(function (segs) {
    var p = [];
    segs.forEach(function (g) {
      var k = g.line ? Math.max(1, Math.ceil(hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) / ENG.STEP)) : ENG.FLAT;
      for (var j = 0; j < k; j++) p.push(bez(g, j / k));
    });
    return p;
  });
  flat.forEach(function (P) {
    var bb = [1e9, 1e9, -1e9, -1e9];
    P.forEach(function (q) { if (q[0] < bb[0]) bb[0] = q[0]; if (q[1] < bb[1]) bb[1] = q[1]; if (q[0] > bb[2]) bb[2] = q[0]; if (q[1] > bb[3]) bb[3] = q[1]; });
    P.bb = bb;
  });
  var ins = function (x, y) { return windingAt(flat, x, y) !== 0; };
  var edges = [];
  flat.forEach(function (P) { for (var i = 0; i < P.length; i++) { var a = P[i], b = P[(i + 1) % P.length]; edges.push([a[0], a[1], b[0], b[1]]); } });
  // 内接円用の輪郭点（細かめに）
  var bpts = [];
  if (ENG.BALL) C.forEach(function (segs) { segs.forEach(function (g) {
    var L = g.line ? hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) : hyp(g.c1[0] - g.a[0], g.c1[1] - g.a[1]) + hyp(g.c2[0] - g.c1[0], g.c2[1] - g.c1[1]) + hyp(g.b[0] - g.c2[0], g.b[1] - g.c2[1]);
    var k = Math.max(2, Math.ceil(L / 4)); for (var j = 0; j < k; j++) bpts.push(bez(g, j / k));
  }); });
  var SEG = C.map(function (segs, ci) {
    return segs.map(function (g, si) {
      var len = g.line ? hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) : 0;
      var k = g.line ? Math.max(2, Math.ceil(len / ENG.STEP)) : ENG.SAMP, sm = [];
      for (var j = 0; j <= k; j++) {
        var t = (j + 0.5) / (k + 1), P = bez(g, t), T = segTan(g, t);
        var s = { x: P[0], y: P[1], tx: T[0], ty: T[1], t: t, nx: -T[1], ny: T[0] };
        s.vis = ins(s.x + s.nx * 1.5, s.y + s.ny * 1.5) && !ins(s.x - s.nx * 1.5, s.y - s.ny * 1.5);
        if (s.vis) {
          s.wr = rayExit(flat, edges, s.x + s.nx * 0.75, s.y + s.ny * 0.75, s.nx, s.ny) + 0.75;
          s.w = ENG.BALL ? Math.min(s.wr, ballWidth(bpts, s.x, s.y, s.nx, s.ny, s.wr)) : s.wr;
          s.gap = rayEnter(flat, edges, s.x - s.nx * 0.75, s.y - s.ny * 0.75, -s.nx, -s.ny) + 0.75;
          // 反対側の輪郭のさらに外：文字の外側か、別の画との間（カウンター）か
          s.gapOpp = rayEnter(flat, edges, s.x + s.nx * (s.wr + 0.75), s.y + s.ny * (s.wr + 0.75), s.nx, s.ny) + 0.75;
        }
        sm.push(s);
      }
      var t0 = startTan(g), t1 = endTan(g), ang = Math.atan2(Math.abs(t0[1]), Math.abs(t0[0])) * 180 / Math.PI;
      return { ci: ci, si: si, g: g, sm: sm, n0: [-t0[1], t0[0]], n1: [-t1[1], t1[0]], t0: t0, t1: t1, cls: g.line ? (ang < 15 ? 'h' : (ang > 75 ? 'v' : 'd')) : 'c' };
    });
  });
  var xs = [];
  C.forEach(function (segs) { segs.forEach(function (g) { xs.push(g.a[0]); }); });
  return { m: m, C: C, flat: flat, ins: ins, SEG: SEG, edges: edges, addedEx: added, cx: (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2 };
}
function glyphVerticalWidths(A) {
  var v = [];
  A.SEG.forEach(function (segs) { segs.forEach(function (S) { S.sm.forEach(function (s) { if (s.vis && Math.abs(s.ty) > 0.97 && s.w < 600) v.push(s.w); }); }); });
  return v;
}
function finishGlyph(A, Wm) {
  var m = A.m, all = [], CAPD = 1.1 * Wm, CAPW = 1.33 * Wm;
  A.SEG.forEach(function (segs) { segs.forEach(function (S) { all.push(S); }); });
  // 端（キャップ）判定：内側へのレイが長く、接線方向の両側に塗りがない
  all.forEach(function (S) {
    S.sm.forEach(function (s) {
      if (!s.vis) return;
      s.cap = (s.wr || s.w) > CAPW && !A.ins(s.x + s.tx * CAPD + s.nx * 2, s.y + s.ty * CAPD + s.ny * 2) && !A.ins(s.x - s.tx * CAPD + s.nx * 2, s.y - s.ty * CAPD + s.ny * 2);
    });
  });
  all.forEach(function (S) {
    var vis = S.sm.filter(function (s) { return s.vis; }), body = vis.filter(function (s) { return !s.cap; });
    S.visFrac = vis.length / S.sm.length;
    S.capFrac = vis.length ? (vis.length - body.length) / vis.length : 0;
    var good = body.filter(function (s) { return s.w < 1.6 * Wm; });
    var shortR = body.filter(function (s) { return (s.wr || s.w) < 1.6 * Wm; });
    S.longFrac = body.length ? 1 - shortR.length / body.length : 0;
    S.hidden = S.visFrac < 0.25;
    S.isCap = !S.hidden && S.capFrac > 0.5;
    S.coincide = !S.hidden && !S.isCap && S.longFrac > 0.6;
    var g = S.g, tolM = 0.003 * 700;
    S.onMetric = g.line && S.cls === 'h' && ((Math.abs(g.a[1] - m.ft) < tolM && Math.abs(g.b[1] - m.ft) < tolM) || (Math.abs(g.a[1] - m.fb) < tolM && Math.abs(g.b[1] - m.fb) < tolM));
    if (g.line) {
      S.w = median(good.map(function (s) { return s.w; })) || Wm;
      S.gap = median(good.map(function (s) { return s.gap; })) || 1000;
      S.gapOpp = median(good.map(function (s) { return s.gapOpp; })) || 1000;
      var hy = good.map(function (s) { return s.y + s.ny * S.w; });
      S.opp = S.cls === 'h' && hy.length > 0 && hy.filter(function (y) { return Math.abs(y - m.ft) < tolM * 1.5 || Math.abs(y - m.fb) < tolM * 1.5; }).length > hy.length / 2;
    } else {
      S.sm.forEach(function (s, i) {
        var v = [], gv = [], ov = [];
        for (var d = -3; d <= 3; d++) { var o = S.sm[i + d]; if (o && o.vis && !o.cap && o.w < 1.6 * Wm) { v.push(o.w); gv.push(o.gap); ov.push(o.gapOpp); } }
        s.wf = v.length ? median(v) : null; s.gf = gv.length ? median(gv) : 1000; s.gof = ov.length ? median(ov) : 1000;
      });
      var known = S.sm.filter(function (s) { return s.wf !== null; });
      S.sm.forEach(function (s) {
        if (s.wf !== null) return;
        var best = null, bd = 9;
        known.forEach(function (o) { var d = Math.abs(o.t - s.t); if (d < bd) { bd = d; best = o; } });
        s.wf = best ? best.wf : Wm; s.gf = best ? best.gf : 1000; s.gof = best ? best.gof : 1000;
      });
      S.opp = false;
    }
  });
  // 隠れた辺・一致する辺の追従先
  all.forEach(function (S) {
    if (!(S.hidden || S.coincide) || !S.g.line) return;
    var g = S.g, mx = (g.a[0] + g.b[0]) / 2, my = (g.a[1] + g.b[1]) / 2, best = null, bd = 1e9;
    all.forEach(function (O) {
      if (O.ci === S.ci || !O.g.line || O.hidden || O.coincide || O.isCap) return;
      if (Math.abs(S.t0[0] * O.t0[1] - S.t0[1] * O.t0[0]) > 0.05) return;
      var og = O.g, ox = og.b[0] - og.a[0], oy = og.b[1] - og.a[1], ol = hyp(ox, oy);
      var u = ((mx - og.a[0]) * ox + (my - og.a[1]) * oy) / (ol * ol); if (u < -0.2 || u > 1.2) return;
      var d = Math.abs((mx - og.a[0]) * oy - (my - og.a[1]) * ox) / ol;
      if (S.coincide && d > 2) return;
      if (S.hidden && d > 1.6 * Wm) return;
      if (d < bd) { bd = d; best = O; }
    });
    S.follow = best;
  });
  // オーバーシュート候補
  var vs = [];
  all.forEach(function (S) { S.sm.forEach(function (s) { if (s.vis) vs.push({ s: s, seg: S }); }); });
  var feats = [];
  for (var pass = 0; pass < 2; pass++) {
    var sgn = pass === 0 ? 1 : -1;
    var pool = vs.filter(function (o) { return sgn > 0 ? o.s.y >= m.ft - m.band : o.s.y <= m.fb + m.band; });
    pool.sort(function (a, b) { return a.s.x - b.s.x; });
    var grp = [];
    var flush = function () {
      if (!grp.length) return;
      var mn = grp[0].s.x, mx = grp[grp.length - 1].s.x, cx = 0, ey = sgn > 0 ? -1e9 : 1e9, curved = false;
      grp.forEach(function (o) { cx += o.s.x; if (sgn > 0 ? o.s.y > ey : o.s.y < ey) ey = o.s.y; if (!o.seg.g.line) curved = true; });
      cx /= grp.length;
      var span = mx - mn, apex = false;
      if (!curved) {
        var yy = ey - sgn * 2.5 * Wm, runs = 0, inside = false;
        for (var xx = cx - 2 * Wm; xx <= cx + 2 * Wm; xx += 4) { var v = A.ins(xx, yy); if (v && !inside) runs++; inside = v; }
        apex = runs >= 2 && span < 1.4 * Wm;
      }
      if (span < m.spanK * Wm && (curved || apex)) feats.push({ x: cx, y: ey, s: sgn, kind: curved ? 'curve' : 'apex' });
      grp = [];
    };
    for (var q = 0; q < pool.length; q++) { if (grp.length && pool[q].s.x - grp[grp.length - 1].s.x > 30) flush(); grp.push(pool[q]); }
    flush();
  }
  A.feats = feats;
  var band = 0.12 * (m.ft - m.fb);
  A.ocC = A.SEG.map(function (segs) {
    var len = 0, tot = 0;
    segs.forEach(function (S) { var l = hyp(S.g.b[0] - S.g.a[0], S.g.b[1] - S.g.a[1]); if (!S.hidden) tot += l; });
    segs.forEach(function (S) {
      if (S.cls !== 'h' || S.hidden || !S.g.line) return;
      var cy = (S.g.a[1] + S.g.b[1]) / 2 + S.n0[1] * S.w / 2;
      if (Math.abs(cy - m.mid) < band && S.w < 1.6 * Wm) len += hyp(S.g.b[0] - S.g.a[0], S.g.b[1] - S.g.a[1]);
    });
    return tot > 0 && len / tot > 0.5;
  });
  A.all = all;
  return A;
}
function computeStems(glyphs, Wm) {
  var V = [], H = [];
  glyphs.forEach(function (A) {
    A.all.forEach(function (S) {
      if (S.hidden || S.isCap || S.coincide) return;
      if (S.g.line) { if (S.cls === 'v') V.push(S.w); else if (S.cls === 'h') H.push(S.w); return; }
      S.sm.forEach(function (s) { if (!s.vis || s.cap) return; if (Math.abs(s.ty) > 0.995) V.push(s.wf); else if (Math.abs(s.tx) > 0.995) H.push(s.wf); });
    });
  });
  var v = median(V) || Wm, h = median(H) || v;
  return { V: v, H: h, ratio: h / v };
}

/* ====================================================================== */
/* 目標の太さ（縦横の異方性モデル）と変形                                   */
/* ====================================================================== */
function stemModel(ST, p) { var Vt = ST.V * p.W; return { stdV: ST.V, stdH: ST.H, Vt: Vt, Ht: Vt * p.ratio }; }
function targetFor(w, nx, ny, M, p) {
  var a = nx * nx, b = ny * ny, std = a * M.stdV + b * M.stdH, tgt = a * M.Vt + b * M.Ht;
  var prop = w * tgt / std;
  var dev = Math.abs(w - std) / std, inTol = dev <= p.tol ? 1 : Math.max(0, 1 - (dev - p.tol) / 0.15);
  var wt = prop + (tgt - prop) * p.uni * inTol;
  var s2 = 2 * nx * ny; wt *= 1 - p.dg * s2 * s2;
  return wt;
}
// 太る量の配分：文字の外側を向いた辺と、内側（カウンター）を向いた辺で分ける
function shareK(gap, gapOpp, p, nx, ny) {
  var ex = p.outX === undefined ? (p.out === undefined ? 0.5 : p.out) : p.outX, ey = p.outY === undefined ? ex : p.outY;
  var e = (nx === undefined) ? ex : nx * nx * ex + ny * ny * ey;
  var oe = gap >= 900, oo = (gapOpp === undefined ? 1000 : gapOpp) >= 900;
  if (oe && !oo) return 2 * e;
  if (!oe && oo) return 2 * (1 - e);
  return 1;
}
function dFrom(w, gap, nx, ny, k, M, p) {
  var wt = targetFor(w, nx, ny, M, p), d = k * (w - wt) / 2;
  if (d < 0 && gap < 900) { var room = Math.max(0, (gap - p.mg * M.Vt) / 2); if (-d > room) d = -room; }
  return d;
}
function constF(v) { return function () { return v; }; }
function segDFun(S, M, p) {
  if (S.onMetric) return constF(0);
  var k = S.opp ? 2 : 1;
  if (S.g.line) return constF(dFrom(S.w, S.gap, S.n0[0], S.n0[1], S.opp ? 2 : shareK(S.gap, S.gapOpp, p, S.n0[0], S.n0[1]), M, p));
  var ds = S.dsm || S.sm.map(function (s) { return { t: s.t, d: dFrom(s.wf, s.gf, s.nx, s.ny, shareK(s.gf, s.gof, p, s.nx, s.ny), M, p) }; });
  var part = function (lo, hi) { return median(ds.filter(function (o) { return o.t >= lo && o.t <= hi; }).map(function (o) { return o.d; })); };
  var d0 = part(0, 0.3), dm = part(0.35, 0.65), d1 = part(0.7, 1);
  return function (t) { var u = 1 - t; return d0 * u * (1 - 2 * t) + dm * 4 * t * u + d1 * t * (2 * t - 1); };
}
function lineX(p1, d1, p2, d2) {
  var den = d1[0] * d2[1] - d1[1] * d2[0]; if (Math.abs(den) < 1e-6) return null;
  var t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den; return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}
function leftN(v) { var n = nrm(v); return [-n[1], n[0]]; }
// 曲線のオフセット：真のオフセット点列に、端点と端の接線方向を固定した 3 次ベジェを最小二乗で当てはめる（Schneider 法）
function fitFixedTangents(Q, us, a2, b2, t0, t1) {
  // B(u) = a2*B0 + (a2 + al1*t0)*B1 + (b2 + al2*t1)*B2 + b2*B3, t1 は b2 から内側へ向く単位ベクトル
  var C00 = 0, C01 = 0, C11 = 0, X0 = 0, X1 = 0;
  for (var i = 0; i < Q.length; i++) {
    var u = us[i], v = 1 - u, B0 = v * v * v, B1 = 3 * u * v * v, B2 = 3 * u * u * v, B3 = u * u * u;
    var A1 = [t0[0] * B1, t0[1] * B1], A2 = [t1[0] * B2, t1[1] * B2];
    C00 += A1[0] * A1[0] + A1[1] * A1[1]; C01 += A1[0] * A2[0] + A1[1] * A2[1]; C11 += A2[0] * A2[0] + A2[1] * A2[1];
    var tx = Q[i][0] - (a2[0] * (B0 + B1) + b2[0] * (B2 + B3)), ty = Q[i][1] - (a2[1] * (B0 + B1) + b2[1] * (B2 + B3));
    X0 += A1[0] * tx + A1[1] * ty; X1 += A2[0] * tx + A2[1] * ty;
  }
  var det = C00 * C11 - C01 * C01, chord = hyp(b2[0] - a2[0], b2[1] - a2[1]), al1, al2;
  if (Math.abs(det) > 1e-9) { al1 = (X0 * C11 - X1 * C01) / det; al2 = (C00 * X1 - C01 * X0) / det; }
  else { al1 = al2 = chord / 3; }
  var eps = 1e-3 * chord;
  if (!(al1 > eps) || !(al2 > eps) || al1 > 2 * chord || al2 > 2 * chord) { al1 = al2 = chord / 3; }
  return { a: a2, c1: [a2[0] + t0[0] * al1, a2[1] + t0[1] * al1], c2: [b2[0] + t1[0] * al2, b2[1] + t1[1] * al2], b: b2, line: false };
}
function distToCurve(cand, Q) {
  var best = 1e9, prevR = bez(cand, 0);
  for (var k = 1; k <= 32; k++) {
    var R = bez(cand, k / 32), sx = R[0] - prevR[0], sy = R[1] - prevR[1], sl = sx * sx + sy * sy;
    var u = sl > 0 ? Math.max(0, Math.min(1, ((Q[0] - prevR[0]) * sx + (Q[1] - prevR[1]) * sy) / sl)) : 0;
    var dd = hyp(prevR[0] + sx * u - Q[0], prevR[1] + sy * u - Q[1]); if (dd < best) best = dd; prevR = R;
  }
  return best;
}
function offsetCurve(g, a2, b2, D, tol, depth, out, tanA, tanB) {
  var N = 12, Q = [], us = [], L = 0, prev = a2;
  for (var j = 1; j < N; j++) {
    var t = j / N, P = bez(g, t), T = segTan(g, t), d = D(t), q = [P[0] - T[1] * d, P[1] + T[0] * d];
    L += hyp(q[0] - prev[0], q[1] - prev[1]); Q.push(q); us.push(L); prev = q;
  }
  L += hyp(b2[0] - prev[0], b2[1] - prev[1]);
  for (var j2 = 0; j2 < us.length; j2++) us[j2] = L > 0 ? us[j2] / L : (j2 + 1) / N;
  var t0 = tanA || startTan(g), te = tanB || endTan(g), t1 = [-te[0], -te[1]];
  var cand = fitFixedTangents(Q, us, a2, b2, t0, t1), err = 0;
  // 張りの保持：ハンドル長を「元の曲線の張り（ハンドル長 / 弦）」で決め、最小二乗の結果と混ぜる
  var tk = ENG.TENS === undefined ? 0 : ENG.TENS;
  if (tk > 0) {
    var ch0 = hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]), ch1 = hyp(b2[0] - a2[0], b2[1] - a2[1]);
    if (ch0 > 1e-6) {
      var la = hyp(g.c1[0] - g.a[0], g.c1[1] - g.a[1]) * ch1 / ch0, lb = hyp(g.b[0] - g.c2[0], g.b[1] - g.c2[1]) * ch1 / ch0;
      var fa = hyp(cand.c1[0] - a2[0], cand.c1[1] - a2[1]), fb = hyp(cand.c2[0] - b2[0], cand.c2[1] - b2[1]);
      var na = fa + (la - fa) * tk, nb = fb + (lb - fb) * tk;
      cand = { a: a2, c1: [a2[0] + t0[0] * na, a2[1] + t0[1] * na], c2: [b2[0] + t1[0] * nb, b2[1] + t1[1] * nb], b: b2, line: false };
    }
  }
  for (var k = 0; k < Q.length; k++) { var e = distToCurve(cand, Q[k]); if (e > err) err = e; }
  if (err <= tol || depth >= (tol < 0 ? 0 : 2)) { out.push(cand); return; }
  var sp = splitBez(g, 0.5), Pm = sp[0].b, Tm = segTan(g, 0.5), dmid = D(0.5), M2 = [Pm[0] - Tm[1] * dmid, Pm[1] + Tm[0] * dmid];
  offsetCurve(sp[0], a2, M2, function (t) { return D(t / 2); }, tol, depth + 1, out);
  offsetCurve(sp[1], M2, b2, function (t) { return D(0.5 + t / 2); }, tol, depth + 1, out);
}
function deformGlyph(A, ST, p) {
  var M = stemModel(ST, p), m = A.m;
  // なめらかにつながる曲線の連なりでは、区間をまたいでオフセット量をならす（区間ごとの食い違いで波打たないように）
  var sw = p.smooth === undefined ? 5 : p.smooth;
  A.SEG.forEach(function (segs) {
    var n = segs.length, chain = [], used = [];
    segs.forEach(function (S) { S.dsm = null; });
    if (!sw) return;
    var ok = function (S) { return !S.g.line && !S.hidden && !S.isCap && !S.coincide && !S.onMetric; };
    var smoothJoin = function (P, N) { return (P.t1[0] * N.t0[0] + P.t1[1] * N.t0[1]) > 0.985; };
    for (var i = 0; i < n; i++) {
      if (used[i] || !ok(segs[i])) continue;
      var st = i, guard = 0;
      while (guard++ < n) { var pv = (st - 1 + n) % n; if (pv === i || used[pv] || !ok(segs[pv]) || !smoothJoin(segs[pv], segs[st])) break; st = pv; }
      var run = [], j = st; guard = 0;
      while (guard++ < n) { run.push(j); used[j] = true; var nx = (j + 1) % n; if (nx === st || used[nx] || !ok(segs[nx]) || !smoothJoin(segs[j], segs[nx])) break; j = nx; }
      var flat = [];
      run.forEach(function (si) { var S = segs[si]; S.sm.forEach(function (sm) { flat.push({ S: S, t: sm.t, d: dFrom(sm.wf, sm.gf, sm.nx, sm.ny, shareK(sm.gf, sm.gof, p, sm.nx, sm.ny), M, p) }); }); });
      var closed = run.length === n;
      var sm2 = flat.map(function (o, k) {
        var sum = 0, wsum = 0;
        for (var q = -sw * 2; q <= sw * 2; q++) {
          var kk = k + q; if (closed) kk = (kk + flat.length) % flat.length; else if (kk < 0 || kk >= flat.length) continue;
          var w = Math.exp(-q * q / (2 * sw * sw)); sum += flat[kk].d * w; wsum += w;
        }
        return sum / wsum;
      });
      flat.forEach(function (o, k) { if (!o.S.dsm) o.S.dsm = []; o.S.dsm.push({ t: o.t, d: sm2[k] }); });
    }
  });
  var DF = A.SEG.map(function (segs) { return segs.map(function (S) { return (S.hidden || S.coincide || S.isCap) ? null : segDFun(S, M, p); }); });
  A.SEG.forEach(function (segs, ci) {
    segs.forEach(function (S, si) {
      if (DF[ci][si] || S.isCap) return;
      if (S.follow) { var F = S.follow, f = DF[F.ci][F.si], v = f ? (f(0) + f(1)) / 2 : 0; DF[ci][si] = constF(v * (F.n0[0] * S.n0[0] + F.n0[1] * S.n0[1])); }
      else DF[ci][si] = constF(0);
    });
  });
  // 短い辺（つなぎ目の数ユニットの辺など）は自前で測らず、前後の辺から補間する
  var tinyL = (p.tiny === undefined ? 0.35 : p.tiny) * ST.V;
  A.SEG.forEach(function (segs, ci) {
    segs.forEach(function (S, si) {
      var g = S.g, L = g.line ? hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) : (hyp(g.c1[0] - g.a[0], g.c1[1] - g.a[1]) + hyp(g.c2[0] - g.c1[0], g.c2[1] - g.c1[1]) + hyp(g.b[0] - g.c2[0], g.b[1] - g.c2[1]));
      S.tiny = (L < tinyL || (S.coincide && !S.follow)) && !S.isCap;
      if (S.tiny) DF[ci][si] = null;
    });
  });
  A.SEG.forEach(function (segs, ci) {
    var n = segs.length;
    for (var pass = 0; pass < 4; pass++) {
      segs.forEach(function (S, si) {
        if (!S.tiny || DF[ci][si]) return;
        var j, pv = null, nx = null;
        for (j = 1; j < n; j++) { var a = segs[(si - j + n) % n]; if (!a.tiny && !a.isCap && DF[ci][(si - j + n) % n]) { pv = DF[ci][(si - j + n) % n]; break; } }
        for (j = 1; j < n; j++) { var b = segs[(si + j) % n]; if (!b.tiny && !b.isCap && DF[ci][(si + j) % n]) { nx = DF[ci][(si + j) % n]; break; } }
        if (pv || nx) { var v0 = pv ? pv(1) : nx(0), v1 = nx ? nx(0) : pv(1); DF[ci][si] = (function (a0, a1) { return function (t) { return a0 + (a1 - a0) * t; }; })(v0, v1); }
        else if (pass === 3) DF[ci][si] = constF(0);
      });
    }
  });
  A.SEG.forEach(function (segs, ci) {
    var n = segs.length;
    for (var pass = 0; pass < 3; pass++) {
      segs.forEach(function (S, si) {
        if (DF[ci][si]) return;
        var pv = DF[ci][(si - 1 + n) % n], nx = DF[ci][(si + 1) % n], vals = [];
        if (pv) vals.push(pv(1)); if (nx) vals.push(nx(0));
        if (S.g.line) { if (vals.length || pass === 2) { var av = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : 0; DF[ci][si] = constF(S.isCap ? av * (p.ext === undefined ? 0 : p.ext) : 0); } return; }
        if (vals.length || pass === 2) DF[ci][si] = constF(vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : 0);
      });
    }
  });
  var dxw = (M.Vt - M.stdV) / 2 * p.cp;
  var vshift = function (x, y, ci) {
    var v = A.ocC[ci] ? p.oc : 0;
    A.feats.forEach(function (F) {
      if (F.kind === 'curve') { var tt = (y - m.mid) / (F.y - m.mid); if (tt > 0) v += F.s * p.os * Math.min(1, tt); }
      else if (Math.abs(x - F.x) < 1.6 * ST.V && Math.abs(y - F.y) < 0.3 * ST.V) v += F.s * p.os;
    });
    return v;
  };
  var hshift = function (x) { return x > A.cx + 1 ? dxw : (x < A.cx - 1 ? -dxw : 0); };
  var post = function (pt, ci) { return [pt[0] + hshift(pt[0]), pt[1] + vshift(pt[0], pt[1], ci)]; };
  var out = A.SEG.map(function (segs, ci) {
    var n = segs.length, disp = [], dAt = [], i;
    for (i = 0; i < n; i++) {
      var Pv = segs[(i - 1 + n) % n], Nx = segs[i], d1 = DF[ci][(i - 1 + n) % n](1), d2 = DF[ci][i](0);
      var n1 = Pv.n1, n2 = Nx.n0, corner = (Pv.t1[0] * Nx.t0[0] + Pv.t1[1] * Nx.t0[1]) < 0.985, v, dd, nn;
      if (corner) {
        var det = n1[0] * n2[1] - n1[1] * n2[0];
        if (Math.abs(det) > 0.15) {
          v = [(d1 * n2[1] - n1[1] * d2) / det, (n1[0] * d2 - d1 * n2[0]) / det];
          var lim = (p.ml === undefined ? 2 : p.ml) * Math.max(Math.abs(d1), Math.abs(d2)) + 0.5, l = hyp(v[0], v[1]); if (l > lim) v = [v[0] / l * lim, v[1] / l * lim];
        } else { dd = (d1 + d2) / 2; nn = nrm([n1[0] + n2[0], n1[1] + n2[1]]); v = [nn[0] * dd, nn[1] * dd]; }
      } else { dd = (d1 + d2) / 2; nn = nrm([n1[0] + n2[0], n1[1] + n2[1]]); v = [nn[0] * dd, nn[1] * dd]; }
      disp.push([Nx.g.a[0] + v[0], Nx.g.a[1] + v[1]]);
      dAt.push(corner ? null : (d1 + d2) / 2);
    }
    // 反転した辺（オフセットで向きが逆になった辺）を畳み、前後の辺の延長線の交点でつなぐ＝スワローテール除去
    var drop = [];
    for (i = 0; i < n; i++) drop.push(false);
    for (var it = 0; it < (p.noST ? 0 : 3); it++) {
      var changed = false;
      for (i = 0; i < n; i++) {
        if (drop[i]) continue;
        var g0 = segs[i].g, a0 = disp[i], b0 = disp[(i + 1) % n];
        var ox = g0.b[0] - g0.a[0], oy = g0.b[1] - g0.a[1], ol2 = ox * ox + oy * oy;
        if (ol2 < 1e-6) continue;
        if ((b0[0] - a0[0]) * ox + (b0[1] - a0[1]) * oy > 0.02 * ol2) continue;
        var pi = (i - 1 + n) % n, ni = (i + 1) % n, guard = 0;
        while (drop[pi] && guard++ < n) pi = (pi - 1 + n) % n;
        guard = 0;
        while (drop[ni] && guard++ < n) ni = (ni + 1) % n;
        if (pi === i || ni === i || pi === ni) continue;
        var X = lineX(disp[i], segs[pi].t1, disp[(i + 1) % n], segs[ni].t0);
        var mid = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
        if (!X || hyp(X[0] - mid[0], X[1] - mid[1]) > 3 * ST.V) X = mid;
        drop[i] = true; changed = true;
        for (var k2 = i; ; k2 = (k2 + 1) % n) { disp[k2] = X; if (k2 === (i + 1) % n) break; }
        // 畳んだ辺に挟まれた区間の端点もそろえる
        var q = (i - 1 + n) % n; while (drop[q] && q !== i) { disp[q] = X; q = (q - 1 + n) % n; }
      }
      if (!changed) break;
    }
    // ずらした後の曲線の端の向き：真のオフセット曲線の接線。なめらかな点では両側の向きを平均して揃える
    var Gs = [], TA = [], TB = [];
    var offPt = function (g, G, t) { var P = bez(g, t), T = segTan(g, t), d = G(t); return [P[0] - T[1] * d, P[1] + T[0] * d]; };
    var offTan = function (g, G, t0_, t1_) { var A1 = offPt(g, G, t0_), B1 = offPt(g, G, t1_); return nrm([B1[0] - A1[0], B1[1] - A1[1]]); };
    for (i = 0; i < n; i++) {
      var Si = segs[i];
      if (Si.g.line || drop[i]) { Gs.push(null); continue; }
      var Fi = DF[ci][i], sAi = dAt[i], sBi = dAt[(i + 1) % n], e0i = sAi === null ? 0 : sAi - Fi(0), e1i = sBi === null ? 0 : sBi - Fi(1);
      Gs.push((function (F_, a_, b_) { return function (t) { return F_(t) + a_ * (1 - t) + b_ * t; }; })(Fi, e0i, e1i));
    }
    if (ENG.FREE) {
      var near = function (u, v) { return u[0] * v[0] + u[1] * v[1] > Math.cos(25 * Math.PI / 180); };
      for (i = 0; i < n; i++) {
        if (Gs[i]) { var ta = offTan(segs[i].g, Gs[i], 0, 0.01); TA[i] = near(ta, segs[i].t0) ? ta : null; }
        if (Gs[i]) { var tb = offTan(segs[i].g, Gs[i], 0.99, 1); TB[i] = near(tb, segs[i].t1) ? tb : null; }
      }
      for (i = 0; i < n; i++) {
        var pv = (i - 1 + n) % n;
        if (dAt[i] === null) continue;                      // 角はそれぞれの向きのまま
        if (Gs[i] && Gs[pv] && TA[i] && TB[pv]) { var av = nrm([TA[i][0] + TB[pv][0], TA[i][1] + TB[pv][1]]); TA[i] = av; TB[pv] = av; }
        else if (Gs[i] && !Gs[pv]) TA[i] = null;            // 直線となめらかにつながる側は直線の向きを保つ
        else if (Gs[pv] && !Gs[i]) TB[pv] = null;
      }
    }
    var res = [];
    segs.forEach(function (S, i2) {
      if (drop[i2]) {
        if (!p.compat) return;
        var X2 = disp[i2];                                   // 互換モード：点を消さず、長さ 0 の辺として残す
        res.push({ a: X2, c1: X2, c2: disp[(i2 + 1) % n], b: disp[(i2 + 1) % n], line: S.g.line });
        return;
      }
      var a2 = disp[i2], b2 = disp[(i2 + 1) % n];
      if (S.g.line) { res.push({ a: a2, c1: a2, c2: b2, b: b2, line: true }); return; }
      var G = Gs[i2];
      var parts = []; offsetCurve(S.g, a2, b2, G, p.compat ? -1 : p.prec, 0, parts, TA[i2] || null, TB[i2] || null);
      parts.forEach(function (q) { res.push(q); });
    });
    return res.map(function (g) { var a = post(g.a, ci), b = post(g.b, ci); return { a: a, c1: g.line ? a : post(g.c1, ci), c2: g.line ? b : post(g.c2, ci), b: b, line: g.line }; });
  });
  return out;
}
/* ====================================================================== */
/* Illustrator との入出力                                                   */
/* ====================================================================== */
function samePt(p, q) { return Math.abs(p[0] - q[0]) < 1e-4 && Math.abs(p[1] - q[1]) < 1e-4; }
function pathToSegs(pi, T) {
  var pts = pi.pathPoints, n = pts.length, segs = [];
  for (var i = 0; i < n; i++) {
    var A = pts[i], B = pts[(i + 1) % n];
    var a = T.fwd(A.anchor), c1 = T.fwd(A.rightDirection), c2 = T.fwd(B.leftDirection), b = T.fwd(B.anchor);
    var line = samePt(a, c1) && samePt(b, c2);
    segs.push(line ? { a: a, c1: a, c2: b, b: b, line: true } : Cv(a, c1, c2, b));
  }
  return segs;
}
function snapshotPath(pi) {
  var pts = pi.pathPoints, r = [];
  for (var i = 0; i < pts.length; i++) r.push({ a: pts[i].anchor, l: pts[i].leftDirection, r: pts[i].rightDirection, t: pts[i].pointType });
  return r;
}
function restorePath(pi, snap) {
  var anchors = snap.map(function (o) { return o.a; });
  pi.setEntirePath(anchors);
  for (var i = 0; i < snap.length; i++) { var q = pi.pathPoints[i]; q.anchor = snap[i].a; q.leftDirection = snap[i].l; q.rightDirection = snap[i].r; q.pointType = snap[i].t; }
}
function writeSegs(pi, segs, T, keepTypes) {
  var n = segs.length, anchors = [], i;
  for (i = 0; i < n; i++) anchors.push(T.inv(segs[i].a));
  pi.setEntirePath(anchors);
  for (i = 0; i < n; i++) {
    var g = segs[i], gp = segs[(i - 1 + n) % n], q = pi.pathPoints[i];
    q.anchor = T.inv(g.a);
    q.rightDirection = T.inv(g.line ? g.a : g.c1);
    q.leftDirection = T.inv(gp.line ? g.a : gp.c2);
    var tin = nrm([g.a[0] - (gp.line ? gp.a : gp.c2)[0], g.a[1] - (gp.line ? gp.a : gp.c2)[1]]);
    var tout = nrm([(g.line ? g.b : g.c1)[0] - g.a[0], (g.line ? g.b : g.c1)[1] - g.a[1]]);
    q.pointType = (keepTypes && keepTypes.length === n) ? keepTypes[i] : ((!g.line && !gp.line && (tin[0] * tout[0] + tin[1] * tout[1]) > 0.999) ? PointType.SMOOTH : PointType.CORNER);
  }
}
// グリフ（グループ or 選択パスの集合）から塗りの閉パスを集める
function collectPaths(item, out) {
  var t = item.typename;
  if (t === 'GroupItem') {
    if (item.clipped) { for (var c = 0; c < item.pageItems.length; c++) if (!(item.pageItems[c].typename === 'PathItem' && item.pageItems[c].clipping)) collectPaths(item.pageItems[c], out); return; }
    for (var i = 0; i < item.pageItems.length; i++) collectPaths(item.pageItems[i], out);
  } else if (t === 'CompoundPathItem') {
    var members = [];
    for (var j = 0; j < item.pathItems.length; j++) { var pj = item.pathItems[j]; if (pj.closed && pj.pathPoints.length > 1) members.push(pj); }
    if (members.length) out.push({ compound: true, paths: members });
  } else if (t === 'PathItem') {
    if (item.closed && item.filled && !item.clipping && !item.guides && item.pathPoints.length > 1) out.push({ compound: false, paths: [item] });
  }
}
function boundsOf(entries) {
  var l = 1e9, r = -1e9, tp = -1e9, b = 1e9;
  entries.forEach(function (e) { e.paths.forEach(function (pi) { var gb = pi.geometricBounds; if (gb[0] < l) l = gb[0]; if (gb[2] > r) r = gb[2]; if (gb[1] > tp) tp = gb[1]; if (gb[3] < b) b = gb[3]; }); });
  return { l: l, r: r, t: tp, b: b };
}
function modeValue(vals, tol) {
  var best = vals[0], bc = 0;
  vals.forEach(function (v) { var c = 0; vals.forEach(function (w) { if (Math.abs(w - v) <= tol) c++; }); if (c > bc) { bc = c; best = v; } });
  var near = vals.filter(function (w) { return Math.abs(w - best) <= tol; });
  return median(near);
}

/* ====================================================================== */
/* 実行                                                                     */
/* ====================================================================== */
function buildJob(sel) {
  var glyphs = [], loose = [];
  for (var i = 0; i < sel.length; i++) {
    var it = sel[i];
    if (it.typename === 'GroupItem') { var e = []; collectPaths(it, e); if (e.length) glyphs.push({ name: it.name || ('グループ ' + (glyphs.length + 1)), entries: e }); }
    else collectPaths(it, loose);
  }
  if (loose.length) glyphs.push({ name: '選択パス', entries: loose });
  glyphs.forEach(function (G) { G.bounds = boundsOf(G.entries); });
  return glyphs;
}
function detectMetrics(glyphs) {
  var tops = glyphs.map(function (G) { return G.bounds.t; }), bots = glyphs.map(function (G) { return G.bounds.b; });
  var h = median(glyphs.map(function (G) { return G.bounds.t - G.bounds.b; })) || 1;
  return { base: modeValue(bots, h * 0.01), top: modeValue(tops, h * 0.01) };
}
function analyzeJob(glyphs, met, script, compat) {
  var H = met.top - met.base; if (H <= 0) throw new Error('メトリクスの上端がベースラインより下になっています。');
  var s = 700 / H;
  var m = script === 'kana' ? { ft: 700, fb: 0, mid: 350, band: 50, spanK: 4 } : { ft: 700, fb: 0, mid: 350, band: 4, spanK: 2 };
  var widths = [];
  glyphs.forEach(function (G) {
    var ox = (G.bounds.l + G.bounds.r) / 2;
    G.T = {
      fwd: function (pt) { return [(pt[0] - ox) * s, (pt[1] - met.base) * s]; },
      inv: function (pt) { return [pt[0] / s + ox, pt[1] / s + met.base]; }
    };
    G.snaps = []; G.rev = [];
    var contours = [], owners = [];
    G.entries.forEach(function (e) {
      var segsList = e.paths.map(function (pi) { return pathToSegs(pi, G.T); });
      // 向きを揃える：単独パスは反時計回り、複合パスは入れ子の深さで外形／穴を判定
      var polys = segsList.map(function (sg) { return flattenSegs(sg, 8); });
      segsList.forEach(function (sg, k) {
        var depth = 0;
        if (e.compound) {
          var pt = polys[k][0];
          polys.forEach(function (P, j) { if (j !== k && windingAt([P], pt[0], pt[1]) !== 0) depth++; });
        }
        var wantPos = depth % 2 === 0, isPos = polyArea(polys[k]) >= 0;
        var segs = (wantPos === isPos) ? sg : reverseC(sg);
        contours.push(segs); owners.push(e.paths[k]); G.rev.push(wantPos !== isPos);
        G.snaps.push({ path: e.paths[k], snap: snapshotPath(e.paths[k]) });
      });
    });
    G.owners = owners;
    G.A = analyzeGlyph(contours, m, { compat: compat });
    widths = widths.concat(glyphVerticalWidths(G.A));
  });
  var Wm = median(widths) || 90;
  glyphs.forEach(function (G) { finishGlyph(G.A, Wm); });
  var ST = computeStems(glyphs.map(function (G) { return G.A; }), Wm);
  return { glyphs: glyphs, ST: ST, scale: s, Wm: Wm, compat: compat };
}
function applyJob(job, p) {
  var added = 0, total = 0;
  job.glyphs.forEach(function (G) {
    var out = deformGlyph(G.A, job.ST, p);
    out.forEach(function (segs, k) {
      if (job.compat) {
        // 互換モード：元のパスと同じ向き・始点・点の種類で書き戻す（元のパスや他のウェイトと補間できる）
        var w = G.rev[k] ? reverseC(segs) : segs;
        writeSegs(G.owners[k], w, G.T, G.snaps[k].snap.map(function (o) { return o.t; }));
        total += w.length;
      } else { writeSegs(G.owners[k], segs, G.T); total += segs.length; }
    });
    G.A.C.forEach(function (segs) { added -= segs.length; });
  });
  return total;
}
function restoreJob(job) { job.glyphs.forEach(function (G) { G.snaps.forEach(function (o) { restorePath(o.path, o.snap); }); }); }

/* ====================================================================== */
/* ダイアログ                                                               */
/* ====================================================================== */
function runDialog(glyphs) {
  var met = detectMetrics(glyphs), script = 'latin', job = null;
  var P = { W: 100, uni: 0, tol: 30, ratio: 94, dg: 0, mg: 35, cp: 0, ext: 50, ox: 50, oy: 10, os: 0, oc: 0, prec: 2 };
  var DEF = {}; for (var k in P) DEF[k] = P[k];

  var dlg = new Window('dialog', '光学補正 / ウェイト調整');
  dlg.orientation = 'column'; dlg.alignChildren = 'fill';
  var info = dlg.add('statictext', undefined, '', { multiline: true }); info.preferredSize = [420, 34];
  var status = dlg.add('statictext', undefined, '準備中…'); status.preferredSize = [420, 18];
  var errShown = false, nUpd = 0, lastEnd = 0, busy = false;
  // ScriptUI はイベント処理中のエラーを表示しないため、すべてのハンドラをここで包んで表示する
  function safe(fn) {
    return function () {
      try { fn.apply(this, arguments); }
      catch (e) {
        busy = false;
        status.text = 'エラー: ' + e.message + (e.line ? '（行 ' + e.line + '）' : '');
        if (!errShown) { errShown = true; alert('プレビュー更新でエラーが発生しました\n' + e.message + (e.line ? '\n行 ' + e.line : '')); }
      }
    };
  }
  function now() { return new Date().getTime(); }

  var mp = dlg.add('panel', undefined, 'メトリクス（ドキュメント座標・pt）'); mp.orientation = 'row'; mp.alignChildren = 'center';
  mp.add('statictext', undefined, '書体');
  var dd = mp.add('dropdownlist', undefined, ['欧文', 'かな']); dd.selection = 0;
  mp.add('statictext', undefined, 'ベースライン');
  var eBase = mp.add('edittext', undefined, met.base.toFixed(2)); eBase.characters = 8;
  mp.add('statictext', undefined, '上端');
  var eTop = mp.add('edittext', undefined, met.top.toFixed(2)); eTop.characters = 8;

  var sliders = {};
  function addSlider(panel, key, label, min, max, unit) {
    var g = panel.add('group'); g.orientation = 'row'; g.alignChildren = 'center';
    var st = g.add('statictext', undefined, label); st.preferredSize = [200, 20];
    var sl = g.add('slider', undefined, P[key], min, max); sl.preferredSize = [160, 20];
    var et = g.add('edittext', undefined, String(P[key])); et.characters = 5;
    g.add('statictext', undefined, unit);
    // ドラッグ中も間引いて更新する（環境によっては onChange が来ないことがあるため）
    sl.onChanging = safe(function () {
      var v = Math.round(sl.value); if (v === P[key]) return;
      P[key] = v; et.text = String(v);
      if (!busy && now() - lastEnd > 250) refresh();
    });
    sl.onChange = safe(function () { P[key] = Math.round(sl.value); et.text = String(P[key]); refresh(); });
    et.onChange = safe(function () { var v = parseFloat(et.text); if (isNaN(v)) v = P[key]; v = Math.max(min, Math.min(max, v)); P[key] = v; sl.value = v; et.text = String(v); refresh(); });
    sliders[key] = { sl: sl, et: et };
  }
  var pw = dlg.add('panel', undefined, 'ウェイト'); pw.alignChildren = 'fill';
  var wb = pw.add('group'); wb.orientation = 'row';
  var presetsW = [['Thin', 45], ['Light', 70], ['Regular', 100], ['Bold', 135], ['Black', 170]];
  presetsW.forEach(function (pr) { var b = wb.add('button', undefined, pr[0]); b.preferredSize = [76, 24]; b.onClick = safe(function () { setVal('W', pr[1]); refresh(); }); });
  addSlider(pw, 'W', '縦画の太さ（元の StdVW 比）', 30, 200, '%');
  addSlider(pw, 'mg', 'カウンター保護（最小の空き）', 0, 80, '%');
  addSlider(pw, 'cp', 'カウンター保持（字幅で吸収）', 0, 100, '%');
  addSlider(pw, 'ext', '線端の伸び（太った量に対して）', 0, 100, '%');
  addSlider(pw, 'ox', '外側へ太る割合（左右の輪郭）', 0, 100, '%');
  addSlider(pw, 'oy', '外側へ太る割合（上下の輪郭）', 0, 100, '%');
  var pu = dlg.add('panel', undefined, '太さの均一化'); pu.alignChildren = 'fill';
  addSlider(pu, 'uni', '揃える強さ', 0, 100, '%');
  addSlider(pu, 'tol', '揃える範囲（基準からのずれ）', 5, 80, '%');
  var pr2 = dlg.add('panel', undefined, '縦横の比率'); pr2.alignChildren = 'fill';
  addSlider(pr2, 'ratio', '横画 / 縦画', 30, 130, '%');
  addSlider(pr2, 'dg', '斜画を細く', 0, 30, '%');
  var po = dlg.add('panel', undefined, '光学補正・精度（u = メトリクス高さの 1/700）'); po.alignChildren = 'fill';
  addSlider(po, 'os', 'オーバーシュート（頂点・曲線）', 0, 30, 'u');
  addSlider(po, 'oc', '光学的中心（中央の横画）', 0, 40, 'u');
  addSlider(po, 'prec', '曲線の許容誤差（互換オフ時）', 1, 8, 'u');

  var bottom = dlg.add('group'); bottom.orientation = 'row'; bottom.alignment = 'fill';
  var cbPrev = bottom.add('checkbox', undefined, 'プレビュー'); cbPrev.value = true;
  var cbCompat = bottom.add('checkbox', undefined, '頂点数を揃える（ウェイト間で互換）'); cbCompat.value = true;
  var bUpd = bottom.add('button', undefined, 'プレビュー更新');
  var bReset = bottom.add('button', undefined, 'リセット');
  var sp = bottom.add('group'); sp.alignment = 'fill';
  var bCancel = bottom.add('button', undefined, 'キャンセル', { name: 'cancel' });
  var bOk = bottom.add('button', undefined, 'OK', { name: 'ok' });

  function setVal(key, v) { P[key] = v; if (sliders[key]) { sliders[key].sl.value = v; sliders[key].et.text = String(v); } }
  function params() {
    return { W: P.W / 100, uni: P.uni / 100, tol: P.tol / 100, ratio: P.ratio / 100, dg: P.dg / 100, mg: P.mg / 100, cp: P.cp / 100, ext: P.ext / 100, outX: P.ox / 100, outY: P.oy / 100, tiny: 0.35, smooth: 5, os: P.os, oc: P.oc, prec: P.prec, compat: cbCompat.value };
  }
  var dirty = false;
  function reanalyze() {
    if (job && dirty) { restoreJob(job); dirty = false; }
    met = { base: parseFloat(eBase.text), top: parseFloat(eTop.text) };
    script = dd.selection.index === 1 ? 'kana' : 'latin';
    job = analyzeJob(glyphs, met, script, cbCompat.value);
    var u2pt = 1 / job.scale;
    info.text = (job.compat ? '［頂点数を保持］' : '［点の追加あり］') + 'グリフ ' + glyphs.length + ' 個 ／ StdVW ' + (job.ST.V * u2pt).toFixed(1) + ' pt ・ StdHW ' + (job.ST.H * u2pt).toFixed(1) + ' pt（横/縦 ' + Math.round(job.ST.ratio * 100) + '%）';
  }
  function refresh() {
    if (!job || busy) return;
    busy = true;
    var t0 = now();
    if (!cbPrev.value) {
      if (dirty) { restoreJob(job); dirty = false; app.redraw(); }
      status.text = 'プレビュー：オフ';
      busy = false; lastEnd = now(); return;
    }
    status.text = '更新中…'; dlg.update && dlg.update();
    if (dirty) restoreJob(job);
    var n = applyJob(job, params()); dirty = true;
    app.redraw();
    nUpd++; lastEnd = now(); busy = false;
    status.text = 'プレビュー更新 ' + nUpd + ' 回目 ・ ' + ((lastEnd - t0) / 1000).toFixed(1) + ' 秒 ・ 縦画 ' + P.W + '% ・ アンカー ' + n;
  }
  // 欧文は上下の輪郭を内側へ（x ハイト・キャップを保つ）、かなは内外に半分ずつ
  dd.onChange = safe(function () { var oy = dd.selection.index === 1 ? 50 : 10; setVal('oy', oy); DEF.oy = oy; reanalyze(); refresh(); });
  eBase.onChange = eTop.onChange = safe(function () { reanalyze(); refresh(); });
  cbPrev.onClick = safe(refresh);
  bUpd.onClick = safe(refresh);
  cbCompat.onClick = safe(function () { reanalyze(); refresh(); });
  bReset.onClick = safe(function () { for (var k2 in DEF) setVal(k2, DEF[k2]); setVal('ratio', Math.round(job.ST.ratio * 100)); refresh(); });

  reanalyze();
  setVal('ratio', Math.round(job.ST.ratio * 100)); DEF.ratio = P.ratio;
  refresh();

  var res = dlg.show();
  if (res === 1) { if (dirty) restoreJob(job); applyJob(job, params()); }
  else if (dirty) restoreJob(job);
  app.redraw();
}

function main() {
  if (app.documents.length === 0) { alert('ドキュメントが開かれていません。'); return; }
  var sel = app.activeDocument.selection;
  if (!sel || sel.length === 0) { alert('文字（グループ）を選択してから実行してください。'); return; }
  var glyphs = buildJob(sel);
  if (!glyphs.length) { alert('塗りのある閉じたパスが見つかりませんでした。'); return; }
  try { runDialog(glyphs); }
  catch (e) { alert('エラー: ' + e.message + (e.line ? '（行 ' + e.line + '）' : '')); }
}

if (typeof app !== 'undefined' && app.name && String(app.name).indexOf('Illustrator') >= 0) main();
