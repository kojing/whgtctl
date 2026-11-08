/*
  OpticalCorrection.jsx  v0.19
  Illustrator 用：塗りパスで組んだ文字のウェイト変更・太さの均一化・縦横比・光学補正

  使い方
    1. ファイル > スクリプト > その他のスクリプト… でこのファイルを実行（何も選んでいなくても開けます）。
       開いたパネルは閉じるまで残り、書類を操作できます。
    2. 1文字＝1グループにまとめた文字を選択（複数可）して「選択を読み込む」。
       グループに入っていないパスは、離れた塊ごとに 1 文字として扱います。
    3. スライダーで調整（プレビューされます）→「適用（確定）」。
       「元に戻す」で読み込む前の状態に戻ります。
    4. 続けて別の文字を選択し「選択を読み込む」から繰り返せます。

  前提
    - 塗りのある閉じたパス（複合パス可）を対象にします。線・開いたパス・クリッピングパスは無視します。
    - ベースラインとキャップハイト（かなは字面の上下）は選択範囲から自動検出し、ダイアログで修正できます。
    - 1 回の実行で選んだ文字を「同じ書体」とみなし、標準ステム（StdVW / StdHW）を共通で求めます。
*/

#target illustrator
#targetengine "whgtctl"

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
// レイの判定を速くするための格子：辺を、それが通るマス目に登録しておき、レイが通るマスの辺だけを調べる
function buildEdgeGrid(edges) {
  if (!edges.length) return null;
  var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, k, e;
  for (k = 0; k < edges.length; k++) {
    e = edges[k];
    x0 = Math.min(x0, e[0], e[2]); x1 = Math.max(x1, e[0], e[2]); y0 = Math.min(y0, e[1], e[3]); y1 = Math.max(y1, e[1], e[3]);
    e[4] = e[2] - e[0]; e[5] = e[3] - e[1]; e[6] = Math.sqrt(e[4] * e[4] + e[5] * e[5]);
  }
  x0 -= 1; y0 -= 1; x1 += 1; y1 += 1;
  var N = Math.max(4, Math.min(48, Math.round(Math.sqrt(edges.length) * 1.2)));
  var cs = Math.max(x1 - x0, y1 - y0) / N, nx = Math.max(1, Math.ceil((x1 - x0) / cs)), ny = Math.max(1, Math.ceil((y1 - y0) / cs));
  var cells = []; for (k = 0; k < nx * ny; k++) cells.push([]);
  for (k = 0; k < edges.length; k++) {
    e = edges[k];
    // 辺に沿ってマスを辿って登録（太い外接矩形ではなく、実際に通るマスだけ）
    var steps = Math.max(1, Math.ceil(e[6] / (cs * 0.5))), last = -1;
    for (var q = 0; q <= steps; q++) {
      var px = e[0] + e[4] * q / steps, py = e[1] + e[5] * q / steps;
      var ix = Math.min(nx - 1, Math.max(0, Math.floor((px - x0) / cs))), iy = Math.min(ny - 1, Math.max(0, Math.floor((py - y0) / cs)));
      var id = iy * nx + ix; if (id !== last) { var L = cells[id]; if (!L.length || L[L.length - 1] !== k) L.push(k); last = id; }
    }
  }
  return { x0: x0, y0: y0, x1: x1, y1: y1, cs: cs, nx: nx, ny: ny, cells: cells, stamp: [], mark: 0 };
}
// レイが通るマスを近い順に辿る（Amanatides–Woo）。onCell(list, tEnter) が true を返したら止める
function gridWalk(G, qx, qy, dx, dy, onCell) {
  var tmin = 0, tmax = 1e12, t1, t2;
  if (Math.abs(dx) < 1e-12) { if (qx < G.x0 || qx > G.x1) return; } else { t1 = (G.x0 - qx) / dx; t2 = (G.x1 - qx) / dx; tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2)); }
  if (Math.abs(dy) < 1e-12) { if (qy < G.y0 || qy > G.y1) return; } else { t1 = (G.y0 - qy) / dy; t2 = (G.y1 - qy) / dy; tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2)); }
  if (tmin > tmax) return;
  var px = qx + dx * tmin, py = qy + dy * tmin;
  var ix = Math.min(G.nx - 1, Math.max(0, Math.floor((px - G.x0) / G.cs))), iy = Math.min(G.ny - 1, Math.max(0, Math.floor((py - G.y0) / G.cs)));
  var sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  var tMaxX = Math.abs(dx) < 1e-12 ? 1e12 : (G.x0 + (ix + (dx > 0 ? 1 : 0)) * G.cs - qx) / dx;
  var tMaxY = Math.abs(dy) < 1e-12 ? 1e12 : (G.y0 + (iy + (dy > 0 ? 1 : 0)) * G.cs - qy) / dy;
  var tdx = Math.abs(dx) < 1e-12 ? 1e12 : G.cs / Math.abs(dx), tdy = Math.abs(dy) < 1e-12 ? 1e12 : G.cs / Math.abs(dy), tEnter = tmin;
  while (ix >= 0 && iy >= 0 && ix < G.nx && iy < G.ny) {
    if (onCell(G.cells[iy * G.nx + ix], tEnter)) return;
    if (tMaxX < tMaxY) { tEnter = tMaxX; tMaxX += tdx; ix += sx; } else { tEnter = tMaxY; tMaxY += tdy; iy += sy; }
  }
}
function rayHits(edges, qx, qy, nx, ny) {
  var hits = [], G = edges.grid;
  var test = function (k) {
    var e = edges[k], ex = e[2] - e[0], ey = e[3] - e[1], den = nx * ey - ny * ex;
    if (Math.abs(den) < 1e-9) return;
    var ax = e[0] - qx, ay = e[1] - qy, t = (ax * ey - ay * ex) / den, u = (ax * ny - ay * nx) / den;
    if (t > 1e-6 && u >= 0 && u < 1) hits.push([t, (ex * ny - ey * nx) > 0 ? 1 : -1]);
  };
  if (!G) { for (var k = 0; k < edges.length; k++) test(k); }
  else {
    var mark = ++G.mark, st = G.stamp;
    gridWalk(G, qx, qy, nx, ny, function (L) { for (var j = 0; j < L.length; j++) { var kk = L[j]; if (st[kk] !== mark) { st[kk] = mark; test(kk); } } return false; });
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
function rayEnter(cs, edges, qx, qy, nx, ny, outside) {
  if (!outside && windingAt(cs, qx, qy) !== 0) return 0;
  var best = 1000, G = edges.grid;
  var test = function (k) {
    var e = edges[k], ex = e[2] - e[0], ey = e[3] - e[1], den = nx * ey - ny * ex, el = e[6] === undefined ? hyp(ex, ey) : e[6];
    if (Math.abs(den) < 1e-9 || el < 1e-9) return;
    var ax = e[0] - qx, ay = e[1] - qy, t = (ax * ey - ay * ex) / den;
    if (t <= 1e-6 || t >= best) return;
    var u = (ax * ny - ay * nx) / den;
    if (u >= 0 && u < 1 && Math.abs(den) / el > 0.6) best = t;
  };
  if (!G) { for (var k = 0; k < edges.length; k++) test(k); return best; }
  var mark = ++G.mark, st = G.stamp;
  gridWalk(G, qx, qy, nx, ny, function (L, tEnter) {
    if (tEnter > best) return true;
    for (var j = 0; j < L.length; j++) { var kk = L[j]; if (st[kk] !== mark) { st[kk] = mark; test(kk); } }
    return false;
  });
  return best;
}
// 外が開けているか：扇形に5本のレイを飛ばし、どこにも当たらずに抜けた割合（0＝囲まれている … 1＝文字の外）
// まっすぐ1本だと、C のふところのように開口部へ抜ける向きで「外」と誤判定し、ずらす量が途中で跳ぶ
var FAN = [0, 0.5236, -0.5236, 1.0472, -1.0472];
function openFrac(cs, edges, qx, qy, nx, ny) {
  if (windingAt(cs, qx, qy) !== 0) return 0;
  var open = 0;
  for (var k = 0; k < FAN.length; k++) {
    var c = Math.cos(FAN[k]), sn = Math.sin(FAN[k]), dx = nx * c - ny * sn, dy = nx * sn + ny * c;
    if (rayEnter(cs, edges, qx, qy, dx, dy, true) >= 900) open++;
  }
  return open / FAN.length;
}
function smoothstepCos(d, R) { return d >= R ? 0 : (1 + Math.cos(Math.PI * d / R)) / 2; }

/* ====================================================================== */
/* 解析（座標は「メトリクス高さ = 700u」に正規化済み、y 上向き）            */
/* ====================================================================== */
var ENG = { DUPTOL: 0.5, TURNCAP: true, PASSTHRU: true, BLOB: true, DOTMAX: 3.2, SOLIDMIN: 4, DOTGROW: 0.9, PAIRCAP: true, SKEL: false, SKELDOT: 0.5, GRID: true, SNAPMAX: 30, TCLIM: 2.5, RAMP: false, TINYCORNER: true, LINVAR: false, BETWEEN: true, MLT: 2, STEP: 9, FLAT: 10, SAMP: 12, BALL: false, TENS: 0.5, FREE: true, FREEDEG: 60, CSPLIT: 0, MEDCAP: true, SHORTC: 0.08, MEDW: true, CORNOPP: true, TURNINT: true, TURNFOLD: true, WCAP: 1.2, CORNK: 0.5, OBLCAP: true, MEDCONE: 0.5, ENDW: true, SIMPTOL: 0.6, SIMPDEG: 8, DFLIN: 1.2, SIMPMAX: 130, SIMPPROJ: 300, ML: true, MLEDGE: true, MLKBW: true, MLHV: true, MLCLIP: 1.0 };
// 内接円（shrinking ball）：p で輪郭に接し、内側に向かって他の輪郭点に触れるまで膨らませた円の直径＝その点での画の太さ
// 骨格（中心線）からの太さ：その点で輪郭に接する最大の内接円を求め、反対側の輪郭（向きがほぼ逆）に接していれば直径を太さとする。
// 角や線端の近くで同じ側の輪郭に接する円は、画の太さではないので使わない（null を返す）
function skelWidth(pts, px, py, nx, ny, cap) {
  var r = cap / 2, j = -1, r2x4 = 4 * r * r;
  for (var i = 0; i < pts.length; i++) {
    var q = pts[i], dx = q[0] - px, dy = q[1] - py, dn = dx * nx + dy * ny;
    if (dn <= 1e-3) continue;
    var d2 = dx * dx + dy * dy;
    if (d2 < 4 || d2 > r2x4) continue;
    var rr = d2 / (2 * dn); if (rr < r) { r = rr; j = i; r2x4 = 4 * r * r; }
  }
  if (j < 0) return null;
  var q2 = pts[j], c = q2[2] * nx + q2[3] * ny;
  return c < -ENG.SKELDOT ? 2 * r : null;
}
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

// 区間の整理：細かく割られた輪郭（Illustrator の書き出し・アウトライン化など）を、少ない区間に引き直す。
// 角・直線・水平垂直の極値で区切り、その間のなめらかな曲線の連なりを、許容差 tol に収まる最少の 3 次ベジェで当てはめる。
// 元の形だけで決まるので、どのウェイトでも同じ点数になる
function simplifyContour(segs, tol, extra) {
  var n = segs.length; if (n < 3) return segs;
  var cosK = Math.cos(ENG.SIMPDEG * Math.PI / 180);
  var smoothAt = function (i) { var P = segs[(i - 1 + n) % n], N = segs[i]; if (P.line || N.line) return false; var a = endTan(P), b = startTan(N); return a[0] * b[0] + a[1] * b[1] > cosK; };
  var hvAt = function (T) { return Math.abs(T[0]) < 0.02 || Math.abs(T[1]) < 0.02; };
  // 区切り：{i: 区間, t: その中の位置}。点 i の始点が角・直線の端・極値なら区切り
  var brk = [];
  for (var i = 0; i < n; i++) {
    if (!smoothAt(i) || hvAt(startTan(segs[i]))) brk.push({ i: i, t: 0 });
    if (!segs[i].line) extremaTs(segs[i]).forEach(function (t) { brk.push({ i: i, t: t }); });
  }
  // 別の輪郭と交わる所（重ねた画の、見えている辺と隠れた辺の境目）でも区切る
  if (extra) extra.forEach(function (b) { brk.push(b); });
  brk.sort(function (a, b) { return a.i - b.i || a.t - b.t; });
  brk = brk.filter(function (b, k) { if (k === 0) return true; var q = brk[k - 1]; return !(q.i === b.i && b.t - q.t < 0.02); });
  if (!brk.length) brk.push({ i: 0, t: 0 });
  var out = [];
  for (var k = 0; k < brk.length; k++) {
    var A = brk[k], B = brk[(k + 1) % brk.length];
    // A から B までの部分（区間をまたぐ）を、(区間, t0, t1) の並びにする
    var pieces = [];
    if (brk.length > 1 && A.i === B.i && B.t > A.t) pieces.push([A.i, A.t, B.t]);
    else {
      pieces.push([A.i, A.t, 1]);
      for (var ci = (A.i + 1) % n, guard = 0; guard <= n; ci = (ci + 1) % n, guard++) {
        if (ci === B.i) { if (B.t > 0) pieces.push([ci, 0, B.t]); break; }
        pieces.push([ci, 0, 1]);
      }
    }
    if (pieces.length === 1 && segs[pieces[0][0]].line) { out.push(segs[pieces[0][0]]); continue; }
    // 元の区間の並びのままで十分少ないものは触らない（1 区間）
    if (pieces.length === 1) { var g1 = segs[pieces[0][0]], a1 = pieces[0][1], b1 = pieces[0][2]; out.push(a1 === 0 && b1 === 1 ? g1 : subBez(g1, a1, b1)); continue; }
    var Q = [], us = [], L = 0, pr = null;
    pieces.forEach(function (pc) { var g = segs[pc[0]]; for (var q = 0; q <= 12; q++) { if (q === 0 && Q.length) continue; var P = bez(g, pc[1] + (pc[2] - pc[1]) * q / 12); if (pr) L += hyp(P[0] - pr[0], P[1] - pr[1]); Q.push(P); us.push(L); pr = P; } });
    if (L < 1e-6) continue;
    for (var q = 0; q < us.length; q++) us[q] /= L;
    var T0 = segTan(segs[pieces[0][0]], Math.max(0.001, pieces[0][1])), lp = pieces[pieces.length - 1], T1 = segTan(segs[lp[0]], Math.min(0.999, lp[2]));
    fitRun(Q, us, T0, T1, tol, out, 0);
  }
  return out;
}
// 輪郭どうしの交点（区間番号と位置）。交わる所で区間を区切るのに使う
function crossBreaks(C) {
  var K = 16, P = C.map(function (segs) {
    var pts = [];
    segs.forEach(function (g, i) { for (var q = 0; q < K; q++) { var t = q / K; pts.push({ p: g.line ? [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t] : bez(g, t), i: i, t: t }); } });
    return pts;
  });
  return C.map(function (segs, c) {
    var out = [], A = P[c];
    for (var k = 0; k < A.length; k++) {
      var a1 = A[k], a2 = A[(k + 1) % A.length], e2 = a2.i === a1.i ? a2.t : 1;
      for (var d = 0; d < P.length; d++) {
        if (d === c) continue; var B = P[d];
        for (var j = 0; j < B.length; j++) {
          var b1 = B[j].p, b2 = B[(j + 1) % B.length].p;
          var rx = a2.p[0] - a1.p[0], ry = a2.p[1] - a1.p[1], sx = b2[0] - b1[0], sy = b2[1] - b1[1], den = rx * sy - ry * sx;
          if (Math.abs(den) < 1e-9) continue;
          var u = ((b1[0] - a1.p[0]) * sy - (b1[1] - a1.p[1]) * sx) / den, v = ((b1[0] - a1.p[0]) * ry - (b1[1] - a1.p[1]) * rx) / den;
          if (u >= 0 && u < 1 && v >= 0 && v < 1) { var t = a1.t + (e2 - a1.t) * u; if (t > 0.02 && t < 0.98) out.push({ i: a1.i, t: t }); else out.push({ i: t >= 0.98 ? (a1.i + 1) % segs.length : a1.i, t: 0 }); }
        }
      }
    }
    return out;
  });
}
// 切れ込み（合流部の内側の角）から、角の二等分線の向きに向かいの辺へ線を伸ばし、当たった所も区切りにする。
// 合流部では向かいの辺の太さの測り方が角の前後で変わるので、そこに点があるとずらす量を追える（書体デザインでも合流部の向かいに点を置く）
function projBreaks(C, maxL) {
  var K = 16, P = C.map(function (segs) {
    var pts = [];
    segs.forEach(function (g, i) { for (var q = 0; q < K; q++) { var t = q / K; pts.push({ p: g.line ? [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t] : bez(g, t), i: i, t: t }); } });
    return pts;
  });
  var out = C.map(function () { return []; });
  C.forEach(function (segs, c) {
    var n = segs.length;
    for (var k = 0; k < n; k++) {
      var Pv = segs[(k - 1 + n) % n], Nx = segs[k], t1 = endTan(Pv), t0 = startTan(Nx);
      if (t1[0] * t0[0] + t1[1] * t0[1] > 0.87) continue;                 // 30° より緩い折れは角としない
      if (t1[0] * t0[1] - t1[1] * t0[0] >= 0) continue;                    // 出っ張った角（線端など）は除く。切れ込みだけ
      var u = nrm([-t1[1] - t0[1], t1[0] + t0[0]]); if (!(hyp(-t1[1] - t0[1], t1[0] + t0[0]) > 0.2)) continue;
      var o = [Nx.a[0] + u[0] * 0.5, Nx.a[1] + u[1] * 0.5], best = null, bd = maxL;
      for (var d = 0; d < P.length; d++) {
        var B = P[d];
        for (var j = 0; j < B.length; j++) {
          var b1 = B[j], b2 = B[(j + 1) % B.length], e2 = b2.i === b1.i ? b2.t : 1;
          var sx = b2.p[0] - b1.p[0], sy = b2.p[1] - b1.p[1], den = u[0] * sy - u[1] * sx; if (Math.abs(den) < 1e-9) continue;
          var L = ((b1.p[0] - o[0]) * sy - (b1.p[1] - o[1]) * sx) / den, v = ((b1.p[0] - o[0]) * u[1] - (b1.p[1] - o[1]) * u[0]) / den;
          if (C[d][b1.i].line) continue;                                       // 直線（線端・面取りなど）には打たない
          if (L > 1 && L < bd && v >= 0 && v < 1) { bd = L; best = { c: d, i: b1.i, t: b1.t + (e2 - b1.t) * v }; }
        }
      }
      if (ENG.DBGP) ENG.DBGP.push([c, k, best ? best.c + ':' + best.i + ':' + best.t.toFixed(2) : 'none', bd.toFixed(0)].join(' '));
      if (best) { var ns = C[best.c].length; out[best.c].push(best.t > 0.98 ? { i: (best.i + 1) % ns, t: 0 } : (best.t < 0.02 ? { i: best.i, t: 0 } : { i: best.i, t: best.t })); }
    }
  });
  return out;
}
function subBez(g, a, b) { var s1 = splitBez(g, a)[1]; return splitBez(s1, (b - a) / (1 - a))[0]; }
// 点列 Q（弦長の位置 us）を端の向きを固定した 3 次ベジェで当て、はみ出すなら一番離れた所で割って当て直す
function fitRun(Q, us, T0, T1, tol, out, depth) {
  var a = Q[0], b = Q[Q.length - 1], m = Q.length - 1;
  var ul = us.map(function (u) { return (u - us[0]) / ((us[m] - us[0]) || 1); });
  var c = fitFixedTangents(Q, ul, a, b, T0, [-T1[0], -T1[1]]), err = 0, ke = -1;
  for (var k = 1; k < m; k++) { var e = distToCurve(c, Q[k]); if (e > err) { err = e; ke = k; } }
  // 長すぎる区間も割る（太さの変化や合流部を 1 本の区間で追うと、ずらす量がならされてしまう）
  var arc = 0; for (var k2 = 1; k2 <= m; k2++) arc += hyp(Q[k2][0] - Q[k2 - 1][0], Q[k2][1] - Q[k2 - 1][1]);
  var tooLong = ENG.SIMPMAX > 0 && arc > ENG.SIMPMAX && m >= 6;
  if ((err <= tol && !tooLong) || m < 6 || depth > 6) { out.push(c); return; }
  if (err <= tol && tooLong) { var half = 0, km = 1; for (km = 1; km < m; km++) { half += hyp(Q[km][0] - Q[km - 1][0], Q[km][1] - Q[km - 1][1]); if (half >= arc / 2) break; } ke = km; }
  ke = Math.max(3, Math.min(m - 3, ke));
  var Tm = nrm([Q[ke + 1][0] - Q[ke - 1][0], Q[ke + 1][1] - Q[ke - 1][1]]);
  fitRun(Q.slice(0, ke + 1), us.slice(0, ke + 1), T0, Tm, tol, out, depth + 1);
  fitRun(Q.slice(ke), us.slice(ke), Tm, T1, tol, out, depth + 1);
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
  var XB = null;
  if (noEx && opts.fine && opts.simp && ENG.SIMPTOL > 0) {
    XB = contours.length > 1 ? crossBreaks(contours) : contours.map(function () { return []; });
    if (ENG.SIMPPROJ) { var PB = projBreaks(contours, ENG.SIMPPROJ); PB.forEach(function (L, c) { XB[c] = XB[c].concat(L); }); }
  }
  var C = contours.map(function (segs, cix) {
    // 精度優先の互換：元の形だけで決まる位置（極値・大きく曲がる所）に点を足す。どのウェイトでも同じ点数になる
    if (noEx && opts.fine) {
      var s0 = (opts.simp && ENG.SIMPTOL > 0) ? simplifyContour(segs, ENG.SIMPTOL, XB ? XB[cix] : null) : segs;   // 区間の整理（細かく割られた輪郭を少ない区間に）
      var r3 = addExtrema(s0), r4 = splitByTurn(r3.segs, 80); added += r3.added + r4.added; return r4.segs; }
    if (noEx) { if (!ENG.CSPLIT) return segs; var r2 = splitByTurn(segs, ENG.CSPLIT); added += r2.added; return r2.segs; }
    var r = addExtrema(segs); added += r.added; return r.segs; });
  var flat = C.map(function (segs) {
    var p = [];
    segs.forEach(function (g) {
      // 曲線は長さに応じて細かく割る（大きな曲線で弦と曲線の差が 0.75u を超えると、太さの測定が 0 になる）
      var k = g.line ? Math.max(1, Math.ceil(hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) / ENG.STEP)) :
        Math.max(ENG.FLAT, Math.ceil((hyp(g.c1[0] - g.a[0], g.c1[1] - g.a[1]) + hyp(g.c2[0] - g.c1[0], g.c2[1] - g.c1[1]) + hyp(g.b[0] - g.c2[0], g.b[1] - g.c2[1])) / 12));
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
  edges.grid = ENG.GRID ? buildEdgeGrid(edges) : null;
  // 内接円用の輪郭点（細かめに）
  var bpts = [];
  if (ENG.BALL || ENG.SKEL) C.forEach(function (segs) { segs.forEach(function (g) {
    var L = g.line ? hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) : hyp(g.c1[0] - g.a[0], g.c1[1] - g.a[1]) + hyp(g.c2[0] - g.c1[0], g.c2[1] - g.c1[1]) + hyp(g.b[0] - g.c2[0], g.b[1] - g.c2[1]);
    var k = Math.max(2, Math.ceil(L / 4));
    for (var j = 0; j < k; j++) {
      var P = bez(g, j / k), T = segTan(g, j / k), nx0 = -T[1], ny0 = T[0];
      // 見えている輪郭だけ（重なった塗りの、別の形に隠れた辺は太さの測定に使わない）
      if (ENG.SKEL && !(windingAt(flat, P[0] + nx0, P[1] + ny0) !== 0 && windingAt(flat, P[0] - nx0, P[1] - ny0) === 0)) continue;
      bpts.push([P[0], P[1], nx0, ny0]);
    }
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
          if (ENG.SKEL) { s.wb = skelWidth(bpts, s.x, s.y, s.nx, s.ny, s.wr); if (s.wb !== null && s.wb < s.w) s.w = s.wb; }
          s.gap = rayEnter(flat, edges, s.x - s.nx * 0.75, s.y - s.ny * 0.75, -s.nx, -s.ny) + 0.75;
          // 反対側の輪郭のさらに外：文字の外側か、別の画との間（カウンター）か
          s.gapOpp = rayEnter(flat, edges, s.x + s.nx * (s.wr + 0.75), s.y + s.ny * (s.wr + 0.75), s.nx, s.ny) + 0.75;
          s.oe = openFrac(flat, edges, s.x - s.nx * 0.75, s.y - s.ny * 0.75, -s.nx, -s.ny);
          s.oo = openFrac(flat, edges, s.x + s.nx * (s.wr + 0.75), s.y + s.ny * (s.wr + 0.75), s.nx, s.ny);
        }
        sm.push(s);
      }
      var t0 = startTan(g), t1 = endTan(g), ang = Math.atan2(Math.abs(t0[1]), Math.abs(t0[0])) * 180 / Math.PI;
      var Lc0 = g.line ? len : hyp(g.c1[0] - g.a[0], g.c1[1] - g.a[1]) + hyp(g.c2[0] - g.c1[0], g.c2[1] - g.c1[1]) + hyp(g.b[0] - g.c2[0], g.b[1] - g.c2[1]);
      return { Lc0: Lc0, ci: ci, si: si, g: g, sm: sm, n0: [-t0[1], t0[0]], n1: [-t1[1], t1[0]], t0: t0, t1: t1, cls: g.line ? (ang < 15 ? 'h' : (ang > 75 ? 'v' : 'd')) : 'c' };
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
// 見えている側面の輪郭（線端・隠れた辺を除く）を細かい線分にしたもの。内接円（本当の太さ）を測るのに使う
function buildVEdges(A) {
  A.vedges = [];
  A.SEG.forEach(function (segs) { segs.forEach(function (S) {
    if (S.hidden || S.isCap) return;
    var K = S.g.line ? 1 : 8, pr = S.g.a;
    for (var q = 1; q <= K; q++) {
      var Q = S.g.line ? S.g.b : bez(S.g, q / K), ex = Q[0] - pr[0], ey = Q[1] - pr[1], l = hyp(ex, ey);
      if (l > 1e-6) A.vedges.push([pr[0], pr[1], Q[0], Q[1], -ey / l, ex / l, S.ci, S.si, (q - 0.5) / K]);
      pr = Q;
    }
  }); });
}
// 向かい合う（法線が逆向きの）辺までの距離
function distOppE(E, x, y, nx0, ny0, th, hit, cone) {
  var best = 1e18, bk = -1; if (th === undefined) th = -0.6;
  for (var k = 0; k < E.length; k++) {
    var e = E[k]; if (e[4] * nx0 + e[5] * ny0 > th) continue;
    var ex = e[2] - e[0], ey = e[3] - e[1], l2 = ex * ex + ey * ey, u = ((x - e[0]) * ex + (y - e[1]) * ey) / l2;
    u = u < 0 ? 0 : (u > 1 ? 1 : u);
    var dx = e[0] + ex * u - x, dy = e[1] + ey * u - y, dd = dx * dx + dy * dy;
    // cone：法線の向きの前方（この角度の中）にある点だけを相手にする。出っ張った角の先の辺を拾わないように
    if (cone && dd > 1 && dx * nx0 + dy * ny0 < cone * Math.sqrt(dd)) continue;
    if (dd < best) { best = dd; bk = k; }
  }
  if (hit) hit.e = bk >= 0 ? E[bk] : null;
  return Math.sqrt(best);
}
// 輪郭上の点から内側へ、自分の辺と向かいの辺から等距離になる所（内接円の半径）
function medialR(E, x, y, nx0, ny0, hmax) {
  var C = ENG.MEDCONE;
  if (distOppE(E, x + nx0 * hmax, y + ny0 * hmax, nx0, ny0, undefined, null, C) >= hmax) return hmax;
  var lo = 0, hi = hmax;
  for (var it = 0; it < 12; it++) { var md = (lo + hi) / 2; if (distOppE(E, x + nx0 * md, y + ny0 * md, nx0, ny0, undefined, null, C) >= md) lo = md; else hi = md; }
  return lo;
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
    // 斜めに切った線端は、角の近くでレイが短く出て割合が下がるので、短い辺はゆるめに判定する
    var segL = hyp(S.g.b[0] - S.g.a[0], S.g.b[1] - S.g.a[1]);
    S.isCap = !S.hidden && (S.capFrac > 0.5 || (S.g.line && segL > 0.25 * Wm && S.capFrac > 0.3 && segL < 1.3 * Wm));
    S.coincide = !S.hidden && !S.isCap && S.longFrac > 0.6;
    var g = S.g, tolM = 0.003 * 700;
    S.onMetric = g.line && S.cls === 'h' && ((Math.abs(g.a[1] - m.ft) < tolM && Math.abs(g.b[1] - m.ft) < tolM) || (Math.abs(g.a[1] - m.fb) < tolM && Math.abs(g.b[1] - m.fb) < tolM));
    if (g.line) {
      S.w = median(good.map(function (s) { return s.w; })) || Wm;
      S.good = good.map(function (s) { return { t: s.t, w: s.w }; });
      S.gap = median(good.map(function (s) { return s.gap; })) || 1000;
      S.gapOpp = median(good.map(function (s) { return s.gapOpp; })) || 1000;
      var mean = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : undefined; };
      S.oe = mean(good.map(function (s) { return s.oe; })); S.oo = mean(good.map(function (s) { return s.oo; }));
      var hy = good.map(function (s) { return s.y + s.ny * S.w; });
      S.opp = S.cls === 'h' && hy.length > 0 && hy.filter(function (y) { return Math.abs(y - m.ft) < tolM * 1.5 || Math.abs(y - m.fb) < tolM * 1.5; }).length > hy.length / 2;
    } else {
      S.sm.forEach(function (s, i) {
        var v = [], gv = [], ov = [], ev = 0, eo = 0;
        for (var d = -3; d <= 3; d++) { var o = S.sm[i + d]; if (o && o.vis && !o.cap && o.w < 1.6 * Wm) { v.push(o.w); gv.push(o.gap); ov.push(o.gapOpp); ev += o.oe; eo += o.oo; } }
        s.wf = v.length ? median(v) : null; s.gf = gv.length ? median(gv) : 1000; s.gof = ov.length ? median(ov) : 1000;
        s.oef = v.length ? ev / v.length : undefined; s.oof = v.length ? eo / v.length : undefined;
      });
      var known = S.sm.filter(function (s) { return s.wf !== null; });
      S.sm.forEach(function (s) {
        if (s.wf !== null) return;
        var best = null, bd = 9;
        known.forEach(function (o) { var d = Math.abs(o.t - s.t); if (d < bd) { bd = d; best = o; } });
        s.wf = best ? best.wf : Wm; s.gf = best ? best.gf : 1000; s.gof = best ? best.gof : 1000; s.oef = best ? best.oef : undefined; s.oof = best ? best.oof : undefined;
      });
      S.opp = false;
    }
  });
  // 曲がり角の外側を切り落とした短い辺は線端ではない：線端なら両隣の側面がほぼ平行に同じ向きへ伸びるが、曲がり角では大きく開く
  if (ENG.TURNCAP) A.SEG.forEach(function (segs) {
    var n = segs.length;
    segs.forEach(function (S, i) {
      if (!S.isCap) return;
      // 線端の両端から、輪郭に沿って線の太さの半分ほど離れた点への向き（角の小さな丸めや面取りに惑わされない）
      var away = function (dir) {
        var P0 = dir > 0 ? S.g.b : S.g.a, acc = 0, k = i, last = P0;
        for (var step = 0; step < n - 1 && acc < 0.6 * Wm; step++) {
          k = (k + dir + n) % n; var G = segs[k].g, Q = dir > 0 ? G.b : G.a;
          acc += hyp(Q[0] - last[0], Q[1] - last[1]); last = Q;
        }
        return nrm([last[0] - P0[0], last[1] - P0[1]]);
      };
      var u1 = away(-1), u2 = away(1);
      if (ENG.DBGCAP) ENG.DBGCAP.push({ a: S.g.a, b: S.g.b, dot: u1[0] * u2[0] + u1[1] * u2[1], u1: u1, u2: u2, cn: [ (S.g.b[1]-S.g.a[1]), -(S.g.b[0]-S.g.a[0]) ] });
      if (u1[0] * u2[0] + u1[1] * u2[1] < 0.5) { S.isCap = false; S.turnCut = true; S.coincide = !S.hidden && S.longFrac > 0.6; }
    });
  });
  // 合流部の曲線：レイが別の画まで突き抜けて長く出る所は、内接円で本当の太さを測り直す（補間に頼らない）
  if (ENG.MEDW) {
    buildVEdges(A);
    all.forEach(function (S) {
      if (S.g.line || !S.coincide) return;
      var fixed = 0;
      S.sm.forEach(function (s) {
        if (!s.vis || s.cap || !((s.wr || s.w) >= 1.6 * Wm)) return;
        var r = medialR(A.vedges, s.x, s.y, s.nx, s.ny, Math.min(s.wr || s.w, 3 * Wm) / 2);
        if (2 * r < 1.6 * Wm) { s.w = 2 * r; fixed++; }
      });
      if (!fixed) return;
      S.sm.forEach(function (s, i) {
        var v = [], gv = [], ov = [], ev = 0, eo = 0;
        for (var d = -3; d <= 3; d++) { var o = S.sm[i + d]; if (o && o.vis && !o.cap && o.w < 1.6 * Wm) { v.push(o.w); gv.push(o.gap); ov.push(o.gapOpp); ev += o.oe; eo += o.oo; } }
        if (!v.length) return;
        s.wf = median(v); s.gf = median(gv); s.gof = median(ov); s.oef = ev / v.length; s.oof = eo / v.length;
      });
      S.coincide = false;
    });
    A.vedges = null;
  }
  // 斜めに切った線端（あ の斜めの画の頭など）：内側へのレイが側面へすぐ抜けてしまい線端と判定できないことがある。
  // 両隣の側面がそろって同じ向き（内側）へ伸び、その間隔が線の太さほどなら線端とみなす
  if (ENG.OBLCAP) A.SEG.forEach(function (segs) {
    var n = segs.length;
    segs.forEach(function (S, i) {
      if (!S.g.line || S.isCap || S.hidden || S.turnCut) return;
      var segL = hyp(S.g.b[0] - S.g.a[0], S.g.b[1] - S.g.a[1]); if (segL < 0.25 * Wm || segL > 2 * Wm) return;
      var away = function (dir) {
        var P0 = dir > 0 ? S.g.b : S.g.a, acc = 0, k = i, last = P0;
        for (var step = 0; step < n - 1 && acc < 0.8 * Wm; step++) { k = (k + dir + n) % n; if (segs[k].isCap) break; var G = segs[k].g, Q = dir > 0 ? G.b : G.a; acc += hyp(Q[0] - last[0], Q[1] - last[1]); last = Q; }
        return acc > 0.4 * Wm ? nrm([last[0] - P0[0], last[1] - P0[1]]) : null;
      };
      var u1 = away(-1), u2 = away(1); if (!u1 || !u2) return;
      if (u1[0] * u2[0] + u1[1] * u2[1] < 0.9) return;
      if (u1[0] * S.n0[0] + u1[1] * S.n0[1] < 0.3 || u2[0] * S.n0[0] + u2[1] * S.n0[1] < 0.3) return;
      var um = nrm([u1[0] + u2[0], u1[1] + u2[1]]), sep = Math.abs(um[0] * (S.g.b[1] - S.g.a[1]) - um[1] * (S.g.b[0] - S.g.a[0]));
      if (sep < 0.5 * Wm || sep > 1.6 * Wm) return;
      S.isCap = true; S.coincide = false; S.oblCap = true;
    });
  });
  // 線端に接する曲線：線端が斜めだと、角の近くでレイが線端の辺へすぐ抜けて太さが細く出る（え の右下の払いの先が反る）。
  // 線端側の半分で、区間の中央値より大きく細い測定は捨てて、まともな測定で置き換える
  if (ENG.ENDW) A.SEG.forEach(function (segs) {
    var n = segs.length;
    segs.forEach(function (S, i) {
      if (S.g.line || S.isCap || S.hidden) return;
      var capA = segs[(i - 1 + n) % n].isCap, capB = segs[(i + 1) % n].isCap; if (!capA && !capB) return;
      var ws = S.sm.filter(function (o) { return o.vis && !o.cap && o.w < 1.6 * Wm; }).map(function (o) { return o.w; }); if (ws.length < 3) return;
      var md = median(ws), good = S.sm.filter(function (o) { return o.vis && o.w >= 0.75 * md && o.w < 1.6 * Wm; }); if (!good.length) return;
      S.sm.forEach(function (o) {
        if (!((capA && o.t < 0.5) || (capB && o.t > 0.5))) return;
        if (o.vis && o.w >= 0.75 * md) return;
        var best = null, bd = 9; good.forEach(function (q) { var dq = Math.abs(q.t - o.t); if (dq < bd) { bd = dq; best = q; } });
        if (best) { o.wf = best.wf; o.gf = best.gf; o.gof = best.gof; o.oef = best.oef; o.oof = best.oof; }
      });
    });
  });
  // 隠れた辺・一致する辺の追従先
  all.forEach(function (S) {
    if (!(S.hidden || S.coincide) || !S.g.line) return;
    var g = S.g, mx = (g.a[0] + g.b[0]) / 2, my = (g.a[1] + g.b[1]) / 2, best = null, bd = 1e9, bp = null, bpd = 1e9, bn = null, bnd = 1e9;
    all.forEach(function (O) {
      if (O.ci === S.ci || !O.g.line || O.hidden || O.coincide || O.isCap) return;
      if (Math.abs(S.t0[0] * O.t0[1] - S.t0[1] * O.t0[0]) > 0.05) return;
      var og = O.g, ox = og.b[0] - og.a[0], oy = og.b[1] - og.a[1], ol = hyp(ox, oy);
      var u = ((mx - og.a[0]) * ox + (my - og.a[1]) * oy) / (ol * ol); if (u < -0.2 || u > 1.2) return;
      var d = Math.abs((mx - og.a[0]) * oy - (my - og.a[1]) * ox) / ol;
      if (S.coincide && d > 2) return;
      if (S.hidden && d > 1.6 * Wm) return;
      if (d < bd) { bd = d; best = O; }
      // 両側の辺：隠れた辺を、覆っている画の中で同じ割合の位置に保つ（細くしたときに飛び出さない）
      var px = og.a[0] + ox * u, py = og.a[1] + oy * u, sd = (px - mx) * S.n0[0] + (py - my) * S.n0[1];
      if (sd > 0 && sd < bpd) { bpd = sd; bp = O; }
      if (sd < 0 && -sd < bnd) { bnd = -sd; bn = O; }
    });
    S.follow = best;
    // 「別の形の辺と重なっている」は、実際に 2u 以内に平行な辺があるときだけ（太い字では長い横画のせいで誤判定しやすい）
    if (S.coincide && !best) {
      S.coincide = false;
      // 内側へのレイが画に沿って長く抜ける直線：両隣の側面が同じ向きへ伸びるなら線端、開くなら曲がり角の面取り
      var sg = A.SEG[S.ci], nn = sg.length, ii = S.si;
      var away2 = function (dir) {
        var P0 = dir > 0 ? S.g.b : S.g.a, acc = 0, k = ii, last = P0;
        for (var step = 0; step < nn - 1 && acc < 0.6 * Wm; step++) { k = (k + dir + nn) % nn; var G2 = sg[k].g, Q2 = dir > 0 ? G2.b : G2.a; acc += hyp(Q2[0] - last[0], Q2[1] - last[1]); last = Q2; }
        return nrm([last[0] - P0[0], last[1] - P0[1]]);
      };
      var w1 = away2(-1), w2 = away2(1);
      if (w1[0] * w2[0] + w1[1] * w2[1] < 0.9) S.longRay = true;
    }
    S.between = (S.hidden && bp && bn) ? { p: bp, dp: bpd, n: bn, dn: bnd } : null;
    // 平行な辺が見つからないとき（斜めの脚に刺さった横棒の端など）：法線方向のレイが最初に当たる辺を両側で探す
    if (S.hidden && !S.between) {
      var hitSide = function (sg) {
        var best2 = null;
        all.forEach(function (O) {
          if (O.ci === S.ci || O.hidden || O.coincide || O.isCap) return;
          var K = O.g.line ? 1 : 12, prevP = O.g.a;
          for (var q = 1; q <= K; q++) {
            var tq = q / K, Pq = O.g.line ? O.g.b : bez(O.g, tq);
            var ex = Pq[0] - prevP[0], ey = Pq[1] - prevP[1], rx = S.n0[0] * sg, ry = S.n0[1] * sg, den = rx * ey - ry * ex;
            if (Math.abs(den) > 1e-9) {
              var ax = prevP[0] - mx, ay = prevP[1] - my, tr = (ax * ey - ay * ex) / den, u = (ax * ry - ay * rx) / den;
              if (tr > 0 && u >= 0 && u <= 1 && tr < 1.6 * Wm && (!best2 || tr < best2.d)) best2 = { O: O, d: tr, t: (q - 1 + u) / K };
            }
            prevP = Pq;
          }
        });
        return best2;
      };
      var hp = hitSide(1), hn = hitSide(-1);
      if (hp && hn) S.between = { p: hp.O, dp: hp.d, tp: hp.t, n: hn.O, dn: hn.d, tn: hn.t, ray: true };
    }
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
  // 点と塗りの図形：穴がなく、ほかの輪郭と重ならない凸の塊。小さいもの（・ . : i の点）は「点」、大きいもの（■ ◆ ●）は「塗りの図形」
  // 本物の書体では、点は縦画が太った分だけ大きくなり、塗りの図形はどのウェイトでも大きさが変わらない
  A.blob = A.flat.map(function (P, ci) {
    if (!ENG.BLOB || P.length < 3) return null;
    var bb = P.bb || [1e9, 1e9, -1e9, -1e9], w = bb[2] - bb[0], h = bb[3] - bb[1];
    if (Math.min(w, h) / Math.max(w, h) < 0.5) return null;
    for (var j = 0; j < A.flat.length; j++) {
      if (j === ci) continue;
      var b2 = A.flat[j].bb; if (b2 && b2[0] < bb[2] && b2[2] > bb[0] && b2[1] < bb[3] && b2[3] > bb[1]) return null;   // 穴や重なりがある
    }
    var hull = convexHull(P), ar = Math.abs(polyArea(P)), ha = Math.abs(polyArea(hull));
    if (ha <= 0) return null;
    // 小さな点は少し曲がっていてもよい（、 など）。大きな塗りの図形は凸に近いものだけ
    if (Math.max(w, h) < ENG.DOTMAX * Wm) return ar / ha >= 0.8 ? 'dot' : null;
    return (Math.min(w, h) > ENG.SOLIDMIN * Wm && ar / ha >= 0.93) ? 'solid' : null;
  });
  sampleCtx(A);
  return A;
}
// 学習モデル用の、点ごとの周りの様子：線端・切れ込みの角までの輪郭に沿った距離、曲がり具合、字面の中の高さ
function sampleCtx(A) {
  var yb = [1e9, -1e9];
  A.flat.forEach(function (P) { P.forEach(function (q) { if (q[1] < yb[0]) yb[0] = q[1]; if (q[1] > yb[1]) yb[1] = q[1]; }); });
  var yh = (yb[1] - yb[0]) || 1;
  A.SEG.forEach(function (segs) {
    var n = segs.length, pos = [], acc = 0, caps = [], ccv = [];
    segs.forEach(function (S) { pos.push(acc); acc += S.Lc0 || 0; });
    segs.forEach(function (S, i) {
      if (S.isCap && !S.hidden) caps.push(pos[i] + (S.Lc0 || 0) / 2);
      var P = segs[(i - 1 + n) % n], t1 = P.t1, t0 = S.t0;
      if (t1[0] * t0[0] + t1[1] * t0[1] < 0.87 && t1[0] * t0[1] - t1[1] * t0[0] <= 0) ccv.push(pos[i]);
    });
    var cd = function (L, q) { var b = 1e9; for (var k = 0; k < L.length; k++) { var d = Math.abs(L[k] - q); d = Math.min(d, acc - d); if (d < b) b = d; } return b; };
    segs.forEach(function (S, i) {
      S.sm.forEach(function (o) {
        var pc = pos[i] + (S.Lc0 || 0) * o.t;
        o.dcp = cd(caps, pc); o.dcv = cd(ccv, pc); o.yN = (o.y - yb[0]) / yh;
        if (S.g.line) o.cur = 0;
        else {
          var e = 1e-3, ta = Math.max(0, o.t - e), tb = Math.min(1, o.t + e), a = segTan(S.g, ta), b = segTan(S.g, tb), P0 = bez(S.g, ta), Q0 = bez(S.g, tb), ds = hyp(Q0[0] - P0[0], Q0[1] - P0[1]);
          o.cur = ds < 1e-9 ? 0 : (a[0] * b[1] - a[1] * b[0]) / ds;
        }
      });
    });
  });
}
// 学習モデル（Google Fonts の欧文 9・和文 7 書体から学んだ、辺ごとの太さの変化の倍率）。tools/learn/embed.py が書き込む
// @@MODEL_BEGIN
var WCTL_MODEL = {"feat":["e","rel","gap","gapO","line","cur","dcv","dcp","jp","lr","y","ny","oe","oo"],"init":0.691586,"lr":0.1,"trees":[{"f":[12,13,5,5,-2,-2,8,-2,-2,1,1,-2,-2,2,-2,-2,8,13,5,-2,-2,1,-2,-2,0,9,-2,-2,6,-2,-2],"th":[0.9,0.9,0.06547,-0.26074,-2.0,-2.0,0.5,-2.0,-2.0,1.50381,0.87497,-2.0,-2.0,0.53433,-2.0,-2.0,0.5,0.7,0.01952,-2.0,-2.0,2.29599,-2.0,-2.0,0.5983,0.85319,-2.0,-2.0,3.16411,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.04164,0.38603,0.10266,0.19267,0.54184,0.15047,-0.2465,-0.56472,-0.07846,0.76319,0.8018,0.17647,0.90577,0.07671,-0.32253,0.18429,-0.46304,-0.58838,-0.63237,-0.59178,-0.66928,-0.43006,-0.39698,-0.61726,-0.20326,-0.03392,0.01646,-0.14764,-0.43652,-0.09964,-0.48231]},{"f":[12,13,5,5,-2,-2,8,-2,-2,1,1,-2,-2,5,-2,-2,8,13,5,-2,-2,6,-2,-2,0,7,-2,-2,6,-2,-2],"th":[0.9,0.9,0.06163,-0.35486,-2.0,-2.0,0.5,-2.0,-2.0,1.53862,0.92245,-2.0,-2.0,-0.00242,-2.0,-2.0,0.5,0.7,0.00994,-2.0,-2.0,2.06715,-2.0,-2.0,0.6408,0.40605,-2.0,-2.0,3.02035,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.03746,0.34577,0.08929,0.17135,0.50978,0.13885,-0.22038,-0.51083,-0.07431,0.68658,0.72116,0.34421,0.8373,0.05782,0.40965,-0.02916,-0.41617,-0.52881,-0.56851,-0.53195,-0.60254,-0.38785,-0.00079,-0.42783,-0.182,-0.0329,-0.66579,-0.02086,-0.39845,-0.0734,-0.44176]},{"f":[12,13,5,9,-2,-2,8,-2,-2,8,5,-2,-2,1,-2,-2,8,13,0,-2,-2,1,-2,-2,0,11,-2,-2,6,-2,-2],"th":[0.9,0.9,0.08068,1.53905,-2.0,-2.0,0.5,-2.0,-2.0,0.5,0.00108,-2.0,-2.0,0.86652,-2.0,-2.0,0.5,0.7,0.97911,-2.0,-2.0,2.48539,-2.0,-2.0,0.60762,-0.6835,-2.0,-2.0,2.25013,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.03418,0.31198,0.08156,0.1505,0.18831,-0.27092,-0.20572,-0.46925,-0.07037,0.61883,0.72003,0.81611,-0.14463,0.43456,-0.09186,0.50877,-0.37365,-0.47553,-0.51076,-0.49167,-0.56396,-0.34843,-0.33083,-0.52576,-0.16263,-0.0278,0.04358,-0.09321,-0.3518,0.06172,-0.38888]},{"f":[12,13,5,5,-2,-2,8,-2,-2,5,1,-2,-2,1,-2,-2,8,13,1,-2,-2,1,-2,-2,0,7,-2,-2,6,-2,-2],"th":[0.9,0.9,0.06163,-0.01641,-2.0,-2.0,0.5,-2.0,-2.0,-0.15731,0.74987,-2.0,-2.0,1.17903,-2.0,-2.0,0.5,0.9,1.23615,-2.0,-2.0,2.3053,-2.0,-2.0,0.66504,0.40397,-2.0,-2.0,3.07195,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.03056,0.28059,0.07362,0.13778,0.3241,0.07856,-0.17172,-0.40974,-0.05743,0.55625,0.71329,-0.27835,0.78891,0.44458,0.52916,0.00493,-0.33668,-0.42712,-0.4524,-0.46882,-0.30812,-0.27234,-0.20942,-0.48666,-0.14771,-0.02983,-0.6014,-0.01979,-0.32852,-0.06085,-0.36888]},{"f":[12,13,5,11,-2,-2,8,-2,-2,5,1,-2,-2,1,-2,-2,8,13,5,-2,-2,6,-2,-2,0,5,-2,-2,11,-2,-2],"th":[0.9,0.9,0.01683,0.6425,-2.0,-2.0,0.5,-2.0,-2.0,-0.11191,0.78345,-2.0,-2.0,1.17903,-2.0,-2.0,0.5,0.7,0.01952,-2.0,-2.0,2.43211,-2.0,-2.0,0.60762,-0.00229,-2.0,-2.0,-0.2305,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.02865,0.25381,0.06629,0.13097,0.08259,0.3134,-0.12256,-0.35265,-0.03299,0.50306,0.64198,-0.19421,0.71168,0.39328,0.47471,-0.02388,-0.30267,-0.38505,-0.41464,-0.38236,-0.44646,-0.27842,0.02368,-0.32461,-0.13158,-0.01854,0.1573,-0.04774,-0.28888,-0.16063,-0.35805]},{"f":[12,13,5,8,-2,-2,1,-2,-2,8,5,-2,-2,11,-2,-2,8,13,0,-2,-2,1,-2,-2,0,7,-2,-2,6,-2,-2],"th":[0.9,0.9,-0.00433,0.5,-2.0,-2.0,0.83549,-2.0,-2.0,0.5,0.00868,-2.0,-2.0,0.3685,-2.0,-2.0,0.5,0.7,0.97713,-2.0,-2.0,2.49962,-2.0,-2.0,0.74046,0.41589,-2.0,-2.0,2.27604,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.02543,0.22816,0.05952,0.23622,0.50226,0.16787,0.00056,-0.37643,0.04654,0.45212,0.53882,0.61334,-0.22073,0.29396,0.42505,0.13903,-0.27139,-0.34568,-0.37236,-0.35531,-0.42265,-0.24968,-0.25034,-0.40779,-0.11797,-0.02759,-0.53346,-0.01828,-0.27582,0.05112,-0.30998]},{"f":[12,13,5,9,-2,-2,1,-2,-2,5,8,-2,-2,0,-2,-2,8,13,0,-2,-2,1,-2,-2,0,13,-2,-2,11,-2,-2],"th":[0.9,0.9,0.06253,1.39133,-2.0,-2.0,0.91122,-2.0,-2.0,-0.11191,0.5,-2.0,-2.0,0.97713,-2.0,-2.0,0.5,0.9,0.98506,-2.0,-2.0,2.3053,-2.0,-2.0,0.53363,0.5,-2.0,-2.0,-0.1955,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.02327,0.20563,0.05304,0.10106,0.14244,-0.19752,-0.1297,-0.41307,-0.06494,0.40858,0.53041,0.63405,0.34733,0.31146,0.25738,0.50275,-0.24529,-0.31189,-0.33032,-0.31126,-0.38858,-0.19905,-0.16532,-0.37043,-0.10673,-0.01159,-0.04759,0.09974,-0.22744,-0.11745,-0.29932]},{"f":[12,13,2,1,-2,-2,9,-2,-2,1,1,-2,-2,1,-2,-2,8,13,1,-2,-2,12,-2,-2,0,9,-2,-2,12,-2,-2],"th":[0.7,0.7,0.41689,0.77712,-2.0,-2.0,1.40454,-2.0,-2.0,0.93683,0.74389,-2.0,-2.0,2.01406,-2.0,-2.0,0.5,0.9,1.24955,-2.0,-2.0,0.9,-2.0,-2.0,0.62647,1.37026,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.02047,0.2176,0.02567,-0.24217,-0.45438,-0.19771,0.05523,0.09599,-0.24092,0.36164,0.11293,-0.28091,0.17791,0.40701,0.46626,-0.10881,-0.18064,-0.25141,-0.28362,-0.30194,-0.16841,-0.08158,0.28359,-0.21052,-0.05453,0.01963,0.05207,-0.14315,-0.16373,-0.0196,-0.23609]},{"f":[12,13,5,11,-2,-2,8,-2,-2,5,8,-2,-2,1,-2,-2,8,5,0,-2,-2,1,-2,-2,0,7,-2,-2,5,-2,-2],"th":[0.9,0.7,0.01236,0.6835,-2.0,-2.0,0.5,-2.0,-2.0,-0.09179,0.5,-2.0,-2.0,0.86903,-2.0,-2.0,0.5,0.00994,0.98506,-2.0,-2.0,1.13028,-2.0,-2.0,0.79834,0.41846,-2.0,-2.0,-0.00408,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.01928,0.16821,0.00906,0.06112,0.01157,0.2357,-0.11305,-0.2964,-0.04572,0.30002,0.43106,0.53445,0.2712,0.21155,-0.25907,0.27208,-0.19907,-0.25278,-0.21504,-0.14445,-0.28351,-0.29797,-0.30908,-0.20281,-0.08727,-0.0259,-0.50544,-0.01811,-0.20855,-0.01854,-0.25493]},{"f":[12,13,2,1,-2,-2,9,-2,-2,1,1,-2,-2,1,-2,-2,8,13,1,-2,-2,12,-2,-2,0,5,-2,-2,13,-2,-2],"th":[0.7,0.7,0.58247,0.76768,-2.0,-2.0,1.34853,-2.0,-2.0,0.97335,0.8406,-2.0,-2.0,1.90343,-2.0,-2.0,0.5,0.9,1.21528,-2.0,-2.0,0.9,-2.0,-2.0,0.54391,0.04832,-2.0,-2.0,0.5,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.01785,0.17816,0.02217,-0.17721,-0.41172,-0.13392,0.05377,0.09792,-0.1931,0.29519,0.14186,-0.10643,0.19638,0.35384,0.41191,-0.1021,-0.1461,-0.20227,-0.22947,-0.24676,-0.13694,-0.05967,0.23798,-0.17193,-0.04577,0.01812,0.06713,-0.07341,-0.12849,-0.19314,-0.03265]},{"f":[12,13,5,8,-2,-2,11,-2,-2,1,1,-2,-2,1,-2,-2,8,0,5,-2,-2,0,-2,-2,0,5,-2,-2,5,-2,-2],"th":[0.9,0.9,-0.0007,0.5,-2.0,-2.0,-0.0065,-2.0,-2.0,1.41251,0.97336,-2.0,-2.0,2.14329,-2.0,-2.0,0.5,0.6392,0.98155,-2.0,-2.0,0.91489,-2.0,-2.0,0.93219,0.00973,-2.0,-2.0,2.97312,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.01606,0.13675,0.03407,0.16169,0.37799,0.11316,-0.00898,-0.12465,0.08297,0.27314,0.29563,0.14514,0.38943,-0.09344,0.03157,-0.22648,-0.16154,-0.20423,-0.25583,-0.26889,-0.12585,-0.17506,-0.08293,-0.226,-0.07285,-0.0306,0.02912,-0.08933,-0.20082,-0.22999,0.0381]},{"f":[12,13,5,11,-2,-2,1,-2,-2,5,8,-2,-2,1,-2,-2,8,5,11,-2,-2,10,-2,-2,11,5,-2,-2,0,-2,-2],"th":[0.9,0.7,0.13564,0.6425,-2.0,-2.0,0.95071,-2.0,-2.0,-0.0913,0.5,-2.0,-2.0,0.9062,-2.0,-2.0,0.5,0.02714,0.0065,-2.0,-2.0,0.3045,-2.0,-2.0,-0.5765,-0.01748,-2.0,-2.0,0.39,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.01511,0.12421,0.00752,0.03887,-0.00513,0.18915,-0.12716,-0.34428,-0.05032,0.22126,0.33154,0.41777,0.18632,0.14685,-0.15665,0.20619,-0.14459,-0.18328,-0.14979,-0.19793,-0.04478,-0.22327,-0.25874,-0.20437,-0.0638,0.04267,0.20364,0.00777,-0.10759,-0.04027,-0.17755]},{"f":[12,13,2,1,-2,-2,9,-2,-2,2,2,-2,-2,9,-2,-2,8,13,1,-2,-2,6,-2,-2,0,5,-2,-2,13,-2,-2],"th":[0.7,0.5,0.89863,0.85817,-2.0,-2.0,1.35422,-2.0,-2.0,1.00128,0.29399,-2.0,-2.0,0.99503,-2.0,-2.0,0.5,0.9,0.64674,-2.0,-2.0,3.75811,-2.0,-2.0,0.42706,-0.00204,-2.0,-2.0,0.7,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.01283,0.13074,-0.01543,-0.13711,-0.30265,-0.05904,0.02009,0.05989,-0.19513,0.20515,0.0435,-0.1675,0.10591,0.2414,0.2929,-0.08491,-0.10755,-0.15044,-0.1716,-0.37987,-0.17523,-0.03872,0.27315,-0.13444,-0.03143,0.02251,0.16633,-0.00414,-0.08723,-0.1352,0.05643]},{"f":[12,13,1,5,-2,-2,9,-2,-2,5,2,-2,-2,3,-2,-2,5,7,9,-2,-2,13,-2,-2,8,0,-2,-2,0,-2,-2],"th":[0.9,0.9,0.8908,-0.04393,-2.0,-2.0,1.69364,-2.0,-2.0,0.00204,1.21384,-2.0,-2.0,6.58428,-2.0,-2.0,-0.00204,0.5326,0.32555,-2.0,-2.0,0.9,-2.0,-2.0,0.5,0.6408,-2.0,-2.0,0.8127,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.01176,0.10111,0.02377,-0.10339,0.08382,-0.20598,0.05378,0.0821,-0.27218,0.20404,0.22738,0.09265,0.29319,-0.09475,-0.43661,-0.06236,-0.11836,0.08231,-0.42923,-0.56044,-0.83098,0.1404,0.12692,0.61133,-0.12828,-0.15134,-0.20187,-0.13597,-0.07323,-0.038,-0.17389]},{"f":[12,13,5,11,-2,-2,3,-2,-2,8,0,-2,-2,10,-2,-2,8,13,1,-2,-2,1,-2,-2,9,13,-2,-2,7,-2,-2],"th":[0.7,0.5,0.31063,-0.0035,-2.0,-2.0,0.6553,-2.0,-2.0,0.5,0.44689,-2.0,-2.0,0.7765,-2.0,-2.0,0.5,0.9,1.23745,-2.0,-2.0,2.29599,-2.0,-2.0,1.39133,0.3,-2.0,-2.0,0.65619,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.0109,0.10734,-0.01261,0.01134,-0.06801,0.0859,-0.17693,0.14424,-0.30281,0.16796,0.23039,0.42576,0.17294,0.08754,0.14506,-0.0487,-0.08772,-0.12237,-0.1407,-0.15522,-0.06695,-0.02571,0.01848,-0.22098,-0.02568,-0.00314,-0.06718,0.05256,-0.13928,-0.50939,-0.11271]},{"f":[5,8,2,10,-2,-2,9,-2,-2,1,11,-2,-2,7,-2,-2,12,1,1,-2,-2,9,-2,-2,0,5,-2,-2,13,-2,-2],"th":[-0.01357,0.5,1.21266,0.2815,-2.0,-2.0,1.1647,-2.0,-2.0,0.86819,0.5775,-2.0,-2.0,0.48268,-2.0,-2.0,0.9,0.91433,0.77811,-2.0,-2.0,1.34853,-2.0,-2.0,0.93606,0.05597,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.01019,0.17773,0.2743,0.12753,0.31332,0.08689,0.31195,0.34344,-0.24524,0.07916,-0.14237,-0.08188,-0.42297,0.11591,-0.61055,0.13926,-0.03917,0.02676,-0.12228,-0.3064,-0.0868,0.06062,0.09789,-0.16313,-0.10428,-0.08059,-0.02292,-0.13293,-0.14411,-0.17203,-0.09512]},{"f":[5,8,2,0,-2,-2,0,-2,-2,1,11,-2,-2,7,-2,-2,12,11,1,-2,-2,5,-2,-2,6,3,-2,-2,0,-2,-2],"th":[-0.01122,0.5,1.17882,0.74046,-2.0,-2.0,0.73874,-2.0,-2.0,0.86956,0.5775,-2.0,-2.0,0.48362,-2.0,-2.0,0.9,-0.0065,0.911,-2.0,-2.0,0.2906,-2.0,-2.0,1.97545,7.13676,-2.0,-2.0,0.97713,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00892,0.15746,0.24537,0.11062,0.19054,-0.01726,0.27854,0.35267,0.20478,0.06899,-0.12892,-0.07102,-0.38323,0.1016,-0.56197,0.12323,-0.03509,0.02496,-0.05998,-0.20991,-0.03034,0.07968,0.11485,-0.14853,-0.09397,0.04801,-0.01712,0.3403,-0.10009,-0.08697,-0.14609]},{"f":[5,8,2,0,-2,-2,9,-2,-2,1,11,-2,-2,9,-2,-2,12,11,1,-2,-2,5,-2,-2,8,0,-2,-2,0,-2,-2],"th":[-0.01373,0.5,1.98925,0.77528,-2.0,-2.0,0.86048,-2.0,-2.0,0.8858,0.5775,-2.0,-2.0,1.39133,-2.0,-2.0,0.9,-0.1065,0.91253,-2.0,-2.0,0.32768,-2.0,-2.0,0.5,0.6408,-2.0,-2.0,0.74736,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00824,0.14244,0.22278,0.13557,0.20003,0.02699,0.26636,0.29964,0.01431,0.06084,-0.1039,-0.04988,-0.3283,0.0934,0.11994,-0.15588,-0.03101,0.02242,-0.05729,-0.1914,-0.03155,0.07163,0.10409,-0.14308,-0.08366,-0.10195,-0.14836,-0.08661,-0.04096,-0.00738,-0.12391]},{"f":[5,8,0,2,-2,-2,3,-2,-2,1,11,-2,-2,7,-2,-2,12,1,1,-2,-2,9,-2,-2,6,5,-2,-2,0,-2,-2],"th":[-0.01122,0.5,0.73874,3.27659,-2.0,-2.0,6.5536,-2.0,-2.0,0.74161,-0.9305,-2.0,-2.0,0.45843,-2.0,-2.0,0.9,0.9533,0.78054,-2.0,-2.0,1.40454,-2.0,-2.0,2.19756,2.7736,-2.0,-2.0,0.95942,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00703,0.12826,0.20217,0.24389,0.20031,0.3393,0.12057,0.00124,0.18367,0.05435,-0.17533,0.18995,-0.27296,0.07403,-0.59521,0.09153,-0.02905,0.01862,-0.07007,-0.25834,-0.04452,0.05576,0.0902,-0.18105,-0.07573,0.03928,0.00134,0.67811,-0.08167,-0.06896,-0.12193]},{"f":[13,5,7,9,-2,-2,2,-2,-2,8,4,-2,-2,6,-2,-2,1,9,1,-2,-2,9,-2,-2,6,2,-2,-2,2,-2,-2],"th":[0.7,-0.0007,0.48033,0.2137,-2.0,-2.0,0.80116,-2.0,-2.0,0.5,0.5,-2.0,-2.0,3.65719,-2.0,-2.0,2.15753,0.99503,0.99378,-2.0,-2.0,1.39133,-2.0,-2.0,1.78589,5.65298,-2.0,-2.0,1.2476,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00656,-0.04337,0.04726,-0.29067,-0.25601,-0.63224,0.06009,-0.12629,0.08976,-0.05731,-0.08957,-0.12591,-0.06808,-0.01725,0.0749,-0.04831,0.08116,0.10044,0.11881,0.05188,0.19259,-0.12013,-0.03702,-0.25174,-0.12267,0.02842,-0.1625,0.37744,-0.1539,-0.4072,-0.15643]},{"f":[13,5,7,9,-2,-2,2,-2,-2,8,1,-2,-2,9,-2,-2,1,1,0,-2,-2,9,-2,-2,1,2,-2,-2,2,-2,-2],"th":[0.9,-0.0007,0.48681,0.03516,-2.0,-2.0,0.79758,-2.0,-2.0,0.5,0.78444,-2.0,-2.0,0.85319,-2.0,-2.0,1.24455,0.98395,0.98307,-2.0,-2.0,1.1647,-2.0,-2.0,2.25753,0.26681,-2.0,-2.0,1.76976,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00594,-0.03042,0.05973,-0.23938,-0.17688,-0.54227,0.06936,-0.08863,0.09691,-0.0462,-0.07618,-0.29258,-0.0785,-0.00777,0.02102,-0.07787,0.08949,0.11597,0.02382,-0.01108,0.12697,0.16272,0.1893,-0.19277,-0.09032,-0.00768,-0.6361,0.02887,-0.12694,-0.35792,-0.12408]},{"f":[12,5,2,1,-2,-2,9,-2,-2,10,5,-2,-2,8,-2,-2,8,5,11,-2,-2,10,-2,-2,0,10,-2,-2,13,-2,-2],"th":[0.7,0.00213,2.10368,2.25406,-2.0,-2.0,0.89965,-2.0,-2.0,0.6155,0.40323,-2.0,-2.0,0.5,-2.0,-2.0,0.5,0.03789,0.0225,-2.0,-2.0,0.2885,-2.0,-2.0,0.39879,0.1005,-2.0,-2.0,0.5,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00552,0.05507,0.07862,0.00554,0.02078,-0.3809,0.11761,0.16279,-0.04959,-0.06108,-0.00781,0.04213,-0.14177,-0.14614,-0.4552,-0.1165,-0.04523,-0.06545,-0.04557,-0.08229,0.02528,-0.09219,-0.12972,-0.07361,-0.00907,0.03443,-0.01322,0.06788,-0.05125,-0.09619,0.00375]},{"f":[13,5,11,0,-2,-2,10,-2,-2,9,5,-2,-2,7,-2,-2,9,1,1,-2,-2,6,-2,-2,12,13,-2,-2,0,-2,-2],"th":[0.7,0.08064,0.1655,0.90535,-2.0,-2.0,0.0845,-2.0,-2.0,-0.18985,2.85512,-2.0,-2.0,0.56273,-2.0,-2.0,1.39133,2.30304,0.79251,-2.0,-2.0,2.24214,-2.0,-2.0,0.9,0.9,-2.0,-2.0,0.93993,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00558,-0.03247,-0.0125,-0.03868,-0.0151,-0.07326,0.03722,-0.07883,0.07484,-0.06789,-0.02774,-0.05092,0.35164,-0.09972,-0.3864,-0.0951,0.06247,0.07265,0.08677,-0.24171,0.10743,-0.09262,0.02462,-0.14176,-0.18329,-0.25573,-0.14135,-0.49931,-0.10853,-0.07177,-0.14835]},{"f":[5,8,0,9,-2,-2,5,-2,-2,1,5,-2,-2,7,-2,-2,5,12,2,-2,-2,0,-2,-2,8,1,-2,-2,9,-2,-2],"th":[-0.03997,0.5,0.77176,1.1647,-2.0,-2.0,-0.48849,-2.0,-2.0,0.74142,-0.25575,-2.0,-2.0,0.48778,-2.0,-2.0,0.01119,0.7,2.07821,-2.0,-2.0,0.98506,-2.0,-2.0,0.5,0.89117,-2.0,-2.0,0.40323,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00469,0.08712,0.14012,0.1789,0.20104,-0.39802,0.05777,-0.00878,0.14687,0.02186,-0.16663,-0.36733,-0.07662,0.04172,-0.39548,0.05626,-0.0166,0.00641,0.04087,-0.03515,0.0865,-0.02604,0.00446,-0.0716,-0.05496,-0.08623,-0.29156,-0.07929,-0.01878,0.04411,-0.09974]},{"f":[13,9,8,5,-2,-2,13,-2,-2,2,9,-2,-2,7,-2,-2,9,1,1,-2,-2,2,-2,-2,7,12,-2,-2,2,-2,-2],"th":[0.7,1.70489,0.5,-0.41483,-2.0,-2.0,0.3,-2.0,-2.0,8.2003,1.87332,-2.0,-2.0,2.50357,-2.0,-2.0,1.34853,2.15536,0.98538,-2.0,-2.0,1.17628,-2.0,-2.0,2.2576,0.9,-2.0,-2.0,9.76454,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00368,-0.02819,-0.02203,-0.04647,0.18435,-0.06102,0.00398,-0.0302,0.04626,-0.11073,-0.298,-0.29557,-0.3955,-0.09264,-0.21306,-0.08217,0.05161,0.06101,0.07385,0.00756,0.12179,-0.07903,-0.30203,-0.07617,-0.14914,-0.27358,-0.46532,-0.1686,-0.11247,-0.31115,-0.08978]},{"f":[5,8,0,13,-2,-2,5,-2,-2,1,11,-2,-2,9,-2,-2,5,9,1,-2,-2,2,-2,-2,9,5,-2,-2,5,-2,-2],"th":[-0.04011,0.5,0.72846,0.1,-2.0,-2.0,-0.73968,-2.0,-2.0,0.73977,-0.923,-2.0,-2.0,1.34853,-2.0,-2.0,0.03933,1.53905,0.67077,-2.0,-2.0,7.2686,-2.0,-2.0,-0.18985,2.97431,-2.0,-2.0,1.96806,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00414,0.07405,0.12,0.159,-0.05787,0.18487,0.04548,-0.03766,0.10118,0.01699,-0.14745,0.16011,-0.23455,0.03396,0.04986,-0.20293,-0.01387,0.00432,0.01287,-0.20138,0.01272,-0.09362,-0.29153,-0.07759,-0.04947,-0.01551,-0.03967,0.35728,-0.07542,-0.06887,-0.38079]},{"f":[13,11,5,2,-2,-2,2,-2,-2,5,10,-2,-2,1,-2,-2,1,1,0,-2,-2,0,-2,-2,2,11,-2,-2,1,-2,-2],"th":[0.9,0.1515,-0.0007,0.9619,-2.0,-2.0,0.24347,-2.0,-2.0,0.23291,0.8495,-2.0,-2.0,0.88285,-2.0,-2.0,1.24455,0.98653,0.98704,-2.0,-2.0,0.0,-2.0,-2.0,1.24718,0.968,-2.0,-2.0,2.25598,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00336,-0.01788,-0.03635,0.02107,-0.10407,0.03858,-0.04605,-0.26716,-0.04971,0.01032,0.03466,0.04967,-0.1664,-0.05546,-0.26538,-0.04818,0.05239,0.07039,0.00367,-0.03195,0.10166,0.10696,0.28169,0.09796,-0.07031,-0.17245,-0.30898,-0.03573,-0.05044,0.01354,-0.08697]},{"f":[12,2,1,3,-2,-2,1,-2,-2,9,12,-2,-2,2,-2,-2,6,1,0,-2,-2,2,-2,-2,0,5,-2,-2,12,-2,-2],"th":[0.7,1.24442,0.85559,0.61157,-2.0,-2.0,1.49295,-2.0,-2.0,0.81203,0.5,-2.0,-2.0,9.61607,-2.0,-2.0,2.26046,0.97739,0.01575,-2.0,-2.0,7.04217,-2.0,-2.0,0.98506,0.05245,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00327,0.03297,-0.03691,-0.11776,-0.02124,-0.21229,-0.01016,0.01414,-0.26288,0.05584,0.08165,0.11108,0.03483,-0.04584,-0.15486,0.03766,-0.02716,0.04452,-0.0622,0.09403,-0.1156,0.09458,0.00966,0.19178,-0.03381,-0.0212,-0.00095,-0.04876,-0.06267,0.04234,-0.07774]},{"f":[5,8,0,2,-2,-2,5,-2,-2,1,11,-2,-2,0,-2,-2,9,1,3,-2,-2,12,-2,-2,7,12,-2,-2,2,-2,-2],"th":[-0.04011,0.5,0.86956,3.66975,-2.0,-2.0,-0.51377,-2.0,-2.0,0.74641,0.5295,-2.0,-2.0,0.72165,-2.0,-2.0,1.69364,0.82538,1.00678,-2.0,-2.0,0.9,-2.0,-2.0,2.52689,0.9,-2.0,-2.0,9.725,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00262,0.05749,0.09661,0.1252,0.08946,0.19884,0.00984,-0.05402,0.07749,0.0092,-0.12729,-0.06036,-0.36793,0.02416,-0.00347,0.08998,-0.01153,-0.00621,-0.09807,-0.02622,-0.18512,-0.00085,0.03024,-0.03029,-0.09182,-0.2079,-0.41132,-0.14746,-0.0748,-0.22795,-0.06184]},{"f":[13,3,2,11,-2,-2,3,-2,-2,2,8,-2,-2,7,-2,-2,9,1,0,-2,-2,1,-2,-2,7,0,-2,-2,2,-2,-2],"th":[0.5,2.73191,0.24809,0.866,-2.0,-2.0,0.6104,-2.0,-2.0,2.60378,0.5,-2.0,-2.0,0.59003,-2.0,-2.0,0.99503,0.93695,0.39627,-2.0,-2.0,2.01602,-2.0,-2.0,2.3595,0.9516,-2.0,-2.0,6.20092,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00253,-0.02383,0.00118,-0.13705,-0.24712,0.01893,0.00757,0.04893,-0.01307,-0.04463,-0.20639,-0.43724,-0.18076,-0.03497,-0.24129,-0.0338,0.02782,0.03829,-0.02732,0.0336,-0.06671,0.04997,0.06759,-0.07031,-0.06177,-0.16776,-0.25477,-0.04489,-0.0326,-0.26138,-0.01981]},{"f":[5,8,0,9,-2,-2,5,-2,-2,7,5,-2,-2,10,-2,-2,5,9,10,-2,-2,2,-2,-2,1,3,-2,-2,9,-2,-2],"th":[-0.04011,0.5,0.72846,1.17509,-2.0,-2.0,-1.31959,-2.0,-2.0,0.47137,-0.17817,-2.0,-2.0,0.7755,-2.0,-2.0,0.16667,1.69364,0.9935,-2.0,-2.0,7.2686,-2.0,-2.0,0.98437,3.0344,-2.0,-2.0,0.49879,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.0028,0.04774,0.08109,0.11425,0.13002,-0.3867,0.01837,-0.09073,0.04819,0.00674,-0.22703,-0.46423,-0.04164,0.01441,0.04174,-0.08264,-0.00884,0.00125,0.00731,0.00888,-0.08524,-0.07546,-0.24209,-0.06613,-0.04143,-0.08623,-0.04585,-0.16883,-0.02234,-0.00613,-0.07897]},{"f":[13,3,2,5,-2,-2,0,-2,-2,2,8,-2,-2,7,-2,-2,12,2,3,-2,-2,9,-2,-2,8,11,-2,-2,1,-2,-2],"th":[0.5,2.73274,0.25672,0.80961,-2.0,-2.0,0.93412,-2.0,-2.0,2.60129,0.5,-2.0,-2.0,0.59104,-2.0,-2.0,0.5,2.52066,8.6143,-2.0,-2.0,0.91598,-2.0,-2.0,0.5,0.9975,-2.0,-2.0,1.24235,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00251,-0.01932,0.0027,-0.11693,-0.12158,-0.51867,0.00836,0.01996,-0.04025,-0.03756,-0.18085,-0.38884,-0.15276,-0.02918,-0.2088,-0.02818,0.02355,0.04917,0.00149,0.03964,-0.05627,0.09073,0.11603,-0.04395,-0.00515,-0.02403,-0.04304,0.0632,0.02855,0.04438,-0.04663]},{"f":[13,3,1,2,-2,-2,1,-2,-2,1,10,-2,-2,10,-2,-2,12,2,1,-2,-2,9,-2,-2,11,8,-2,-2,10,-2,-2],"th":[0.3,0.6104,0.57608,0.43217,-2.0,-2.0,1.36199,-2.0,-2.0,0.86046,0.1915,-2.0,-2.0,0.3015,-2.0,-2.0,0.5,3.73612,0.98096,-2.0,-2.0,0.91598,-2.0,-2.0,0.0365,0.5,-2.0,-2.0,0.0035,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00241,-0.02524,0.02601,-0.15131,-0.26183,-0.0549,0.03443,0.04606,-0.07877,-0.03388,-0.12396,-0.40301,-0.12606,-0.02646,-0.05915,-0.01731,0.01735,0.04211,0.00994,-0.03436,0.04561,0.09586,0.13066,-0.00918,-0.00446,-0.02142,-0.04817,0.01272,0.02775,-0.10965,0.05305]},{"f":[5,2,9,1,-2,-2,-2,12,2,-2,-2,0,-2,-2,8,6,0,-2,-2,10,-2,-2,9,5,-2,-2,7,-2,-2],"th":[0.00735,0.33854,0.15872,1.24792,-2.0,-2.0,-2.0,0.7,2.8526,-2.0,-2.0,0.99102,-2.0,-2.0,0.5,1.26578,0.78766,-2.0,-2.0,0.3245,-2.0,-2.0,0.40323,2.28741,-2.0,-2.0,0.59578,-2.0,-2.0],"l":[1,2,3,4,-1,-1,-1,8,9,-1,-1,12,-1,-1,15,16,17,-1,-1,20,-1,-1,23,24,-1,-1,27,-1,-1],"r":[14,7,6,5,-1,-1,-1,11,10,-1,-1,13,-1,-1,22,19,18,-1,-1,21,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00262,0.01474,-0.0969,-0.11099,-0.10373,-0.44525,0.30841,0.01827,0.03693,0.00596,0.06739,-0.00913,0.0129,-0.04631,-0.0255,-0.04694,-0.16028,-0.28039,0.02538,-0.0365,-0.07116,-0.01867,-0.00151,0.0396,0.01783,0.32489,-0.04634,-0.30594,-0.02137]},{"f":[9,2,1,5,-2,-2,0,-2,-2,12,2,-2,-2,2,-2,-2,2,13,10,-2,-2,-2,7,11,-2,-2,9,-2,-2],"th":[1.20301,0.30657,1.2481,0.4705,-2.0,-2.0,0.53363,-2.0,-2.0,0.5,2.99106,-2.0,-2.0,8.1542,-2.0,-2.0,6.41125,0.9,0.3605,-2.0,-2.0,-2.0,1.31951,0.3505,-2.0,-2.0,1.84891,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,-1,23,24,-1,-1,27,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,22,21,20,-1,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00187,0.00832,-0.09658,-0.077,-0.07079,-0.34134,-0.22928,-0.28756,-0.55418,0.01184,0.03657,0.00445,0.08923,-0.00543,-0.03893,0.00057,-0.04676,-0.18684,-0.16496,-0.29886,-0.16357,-0.35204,-0.03384,-0.15348,-0.11684,-0.30704,-0.02232,-0.00691,-0.07044]},{"f":[9,2,1,0,-2,-2,3,-2,-2,12,2,-2,-2,2,-2,-2,2,9,2,-2,-2,10,-2,-2,7,11,-2,-2,8,-2,-2],"th":[0.78926,0.33858,1.4512,0.08323,-2.0,-2.0,7.90767,-2.0,-2.0,0.5,3.68135,-2.0,-2.0,8.1542,-2.0,-2.0,6.1484,0.89034,2.10704,-2.0,-2.0,0.8655,-2.0,-2.0,0.75194,0.351,-2.0,-2.0,0.5,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00247,0.01148,-0.08598,-0.06886,0.00985,-0.134,-0.22886,-0.45259,-0.19757,0.01542,0.04036,0.0172,0.10622,-0.00236,-0.03438,0.0056,-0.03094,-0.14253,-0.09063,-0.25055,-0.03417,-0.1678,-0.18542,-0.33114,-0.01565,-0.16562,-0.1247,-0.35991,-0.00527,-0.03741,0.02149]},{"f":[9,3,2,1,-2,-2,0,-2,-2,13,11,-2,-2,0,-2,-2,2,10,5,-2,-2,5,-2,-2,7,1,-2,-2,9,-2,-2],"th":[0.81203,9.99853,0.245,1.22569,-2.0,-2.0,0.93412,-2.0,-2.0,0.9,-0.9985,-2.0,-2.0,0.999,-2.0,-2.0,6.20695,0.8035,0.17688,-2.0,-2.0,-0.02063,-2.0,-2.0,1.2907,1.17935,-2.0,-2.0,1.8109,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00269,0.01079,-0.00242,-0.09969,-0.09477,-0.41911,0.00145,0.01197,-0.03341,0.03446,0.00312,-0.10846,0.00928,0.05836,0.03993,0.12755,-0.02828,-0.13201,-0.11283,-0.11794,-0.35235,-0.20782,-0.38404,-0.19406,-0.01435,-0.11537,-0.0927,-0.23454,-0.00297,0.00736,-0.06122]},{"f":[1,11,3,-2,-2,13,2,-2,-2,10,-2,-2,5,10,1,-2,-2,8,-2,-2,3,5,-2,-2,1,-2,-2],"th":[0.5804,-0.721,5.07464,-2.0,-2.0,0.7,0.2097,-2.0,-2.0,0.9155,-2.0,-2.0,0.00418,0.9935,2.45387,-2.0,-2.0,0.5,-2.0,-2.0,3.1869,0.37264,-2.0,-2.0,0.92845,-2.0,-2.0],"l":[1,2,3,-1,-1,6,7,-1,-1,10,-1,-1,13,14,15,-1,-1,18,-1,-1,21,22,-1,-1,25,-1,-1],"r":[12,5,4,-1,-1,9,8,-1,-1,11,-1,-1,20,17,16,-1,-1,19,-1,-1,24,23,-1,-1,26,-1,-1],"v":[0.00274,-0.11974,0.02057,-0.11603,0.22808,-0.14979,-0.11831,-0.31158,-0.12012,-0.22042,-0.2046,-0.32001,0.00459,0.01494,0.01922,0.02317,-0.07967,-0.06442,-0.12457,0.0174,-0.01874,0.00933,0.04737,-0.01605,-0.03339,-0.15793,-0.02685]},{"f":[13,3,1,11,-2,-2,1,-2,-2,1,10,-2,-2,2,-2,-2,1,10,11,-2,-2,11,-2,-2,1,9,-2,-2,6,-2,-2],"th":[0.3,0.57545,0.57608,0.4565,-2.0,-2.0,1.30502,-2.0,-2.0,0.76038,0.1745,-2.0,-2.0,2.06693,-2.0,-2.0,0.99908,0.6615,-0.0005,-2.0,-2.0,0.9995,-2.0,-2.0,1.93924,1.39133,-2.0,-2.0,2.32935,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00185,-0.01698,0.03128,-0.10134,-0.17099,-0.04798,0.03798,0.04951,-0.05861,-0.02438,-0.1424,-0.51839,-0.14556,-0.01992,-0.07946,-0.01738,0.01199,-0.00714,0.01404,-0.01595,0.03163,-0.03852,-0.05391,0.04115,0.02783,0.0376,0.04882,-0.03771,-0.03466,0.04406,-0.06671]},{"f":[1,11,7,-2,7,-2,-2,13,2,-2,-2,0,-2,-2,5,11,10,-2,-2,10,-2,-2,13,9,-2,-2,3,-2,-2],"th":[0.63966,-0.5995,0.84713,-2.0,4.50431,-2.0,-2.0,0.7,1.01157,-2.0,-2.0,0.74218,-2.0,-2.0,0.00735,0.7745,0.4945,-2.0,-2.0,0.2435,-2.0,-2.0,0.9,-0.18985,-2.0,-2.0,5.38336,-2.0,-2.0],"l":[1,2,3,-1,5,-1,-1,8,9,-1,-1,12,-1,-1,15,16,17,-1,-1,20,-1,-1,23,24,-1,-1,27,-1,-1],"r":[14,7,4,-1,6,-1,-1,11,10,-1,-1,13,-1,-1,22,19,18,-1,-1,21,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00182,-0.09187,0.01353,0.25607,-0.07562,-0.25363,-0.02032,-0.12339,-0.09431,-0.23454,-0.06904,-0.19354,-0.26677,-0.06797,0.00387,0.01266,0.00491,0.02665,-0.01974,0.04881,-0.07296,0.09095,-0.01637,-0.01095,0.0121,-0.03029,-0.08558,-0.31466,-0.07533]},{"f":[9,2,0,8,-2,-2,5,-2,-2,12,2,-2,-2,0,-2,-2,2,6,11,-2,-2,7,-2,-2,7,11,-2,-2,9,-2,-2],"th":[0.82115,0.90013,0.26163,0.5,-2.0,-2.0,0.35665,-2.0,-2.0,0.5,3.68134,-2.0,-2.0,0.97911,-2.0,-2.0,6.18046,3.47935,0.9455,-2.0,-2.0,0.57518,-2.0,-2.0,0.68477,0.351,-2.0,-2.0,1.69364,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00218,0.00874,-0.03444,0.01159,0.13038,-0.05228,-0.0661,-0.05594,-0.34155,0.01435,0.04109,0.02032,0.08597,-0.001,0.00683,-0.03228,-0.02336,-0.12035,-0.04239,-0.0035,-0.16662,-0.13693,-0.45171,-0.15284,-0.01084,-0.1529,-0.10909,-0.33105,-0.00276,0.00861,-0.04232]},{"f":[13,3,10,7,-2,-2,11,-2,-2,2,3,-2,-2,10,-2,-2,9,2,9,-2,-2,1,-2,-2,2,3,-2,-2,7,-2,-2],"th":[0.1,0.66584,0.2245,3.67626,-2.0,-2.0,0.143,-2.0,-2.0,2.79626,2.95678,-2.0,-2.0,0.3025,-2.0,-2.0,0.99503,0.33597,-1.15647,-2.0,-2.0,1.00172,-2.0,-2.0,9.76646,9.71893,-2.0,-2.0,4.04241,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00104,-0.02333,0.01331,-0.04804,-0.01571,-0.08991,0.02863,-0.00649,0.12168,-0.0312,-0.09849,-0.07894,-0.27322,-0.0194,-0.04355,-0.01084,0.00689,0.01252,-0.0711,-0.22172,-0.04588,0.01529,-0.00183,0.03002,-0.02473,-0.1079,-0.03114,-0.1704,-0.01204,-0.0751,0.00532]},{"f":[11,10,13,10,-2,-2,11,-2,-2,2,11,-2,-2,8,-2,-2,10,8,10,-2,-2,2,-2,-2,8,10,-2,-2,13,-2,-2],"th":[0.9995,0.6055,0.3,0.3425,-2.0,-2.0,0.0005,-2.0,-2.0,8.14262,-0.3745,-2.0,-2.0,0.5,-2.0,-2.0,0.244,0.5,0.0775,-2.0,-2.0,6.17857,-2.0,-2.0,0.5,0.5165,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00193,-0.00157,0.00956,-0.01158,-0.03957,0.01282,0.02126,0.00928,0.0523,-0.01688,-0.0392,-0.09852,-0.01419,0.00087,-0.02908,0.03476,0.03902,-0.0476,-0.09551,-0.12408,0.13182,0.001,-0.45118,0.02298,0.08516,0.24364,0.05235,0.41507,0.0073,0.08428,-0.12594]},{"f":[1,11,13,-2,-2,13,2,-2,-2,0,-2,-2,9,2,1,-2,-2,12,-2,-2,7,1,-2,-2,2,-2,-2],"th":[0.5858,-0.718,0.3,-2.0,-2.0,0.7,1.0263,-2.0,-2.0,0.73188,-2.0,-2.0,0.85319,1.17865,1.47952,-2.0,-2.0,0.5,-2.0,-2.0,2.44286,1.17834,-2.0,-2.0,9.79614,-2.0,-2.0],"l":[1,2,3,-1,-1,6,7,-1,-1,10,-1,-1,13,14,15,-1,-1,18,-1,-1,21,22,-1,-1,25,-1,-1],"r":[12,5,4,-1,-1,9,8,-1,-1,11,-1,-1,20,17,16,-1,-1,19,-1,-1,24,23,-1,-1,26,-1,-1],"v":[0.00192,-0.08936,0.02346,-0.11094,0.15506,-0.11318,-0.08506,-0.20907,-0.06772,-0.17794,-0.24248,-0.07164,0.00337,0.00892,-0.02032,-0.0099,-0.19013,0.01385,0.04365,-0.00374,-0.01851,-0.0844,-0.06978,-0.20131,-0.00518,-0.08232,0.00756]},{"f":[1,3,0,2,-2,-2,6,-2,-2,1,0,-2,-2,2,-2,-2,6,2,0,-2,-2,5,-2,-2,1,12,-2,-2,12,-2,-2],"th":[1.0017,0.57196,0.98506,9.16959,-2.0,-2.0,1.62562,-2.0,-2.0,0.84154,0.28462,-2.0,-2.0,9.52991,-2.0,-2.0,3.1634,5.94723,1e-05,-2.0,-2.0,-0.00998,-2.0,-2.0,2.48654,0.7,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00221,-0.00786,0.05064,0.06885,0.04878,0.26625,-0.03688,0.09702,-0.06255,-0.01264,-0.06376,-0.01587,-0.10738,-0.00684,-0.02455,0.00466,0.01371,0.05507,0.01929,0.13422,-0.0145,0.10087,-0.01855,0.13281,0.00401,0.01119,0.04122,-0.01006,-0.069,-0.2158,-0.04332]},{"f":[1,5,3,2,-2,-2,2,-2,-2,6,8,-2,-2,3,-2,-2,6,0,8,-2,-2,2,-2,-2,1,13,-2,-2,12,-2,-2],"th":[1.00169,0.31114,1.90393,9.92712,-2.0,-2.0,9.99297,-2.0,-2.0,2.00877,0.5,-2.0,-2.0,2.08083,-2.0,-2.0,1.87528,4e-05,0.5,-2.0,-2.0,6.6997,-2.0,-2.0,2.40102,0.7,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00136,-0.00853,-0.00347,0.0284,0.00479,0.08658,-0.01053,-0.02658,-0.00035,-0.05522,-0.128,-0.24267,0.07932,-0.03435,-0.00939,-0.06262,0.0126,0.06166,0.15232,0.30105,0.01749,0.03206,-0.00541,0.11746,0.00561,0.01199,-0.00581,0.0402,-0.05627,-0.19078,-0.03186]},{"f":[9,2,0,8,-2,-2,3,-2,-2,12,2,-2,-2,0,-2,-2,13,2,9,-2,-2,9,-2,-2,12,9,-2,-2,0,-2,-2],"th":[1.20301,0.58284,0.16443,0.5,-2.0,-2.0,7.5295,-2.0,-2.0,0.5,5.65158,-2.0,-2.0,0.999,-2.0,-2.0,0.9,7.27007,1.97642,-2.0,-2.0,1.97642,-2.0,-2.0,0.9,1.39133,-2.0,-2.0,0.78243,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00173,0.00547,-0.03492,0.01325,0.11602,-0.02804,-0.0653,-0.11349,0.00983,0.0083,0.02296,0.01092,0.07831,-0.00107,0.00506,-0.0319,-0.02666,-0.01767,-0.08673,-0.08306,-0.20195,-0.01025,-0.00253,-0.0583,-0.10883,-0.17914,-0.06295,-0.32075,-0.01108,0.0814,-0.05204]},{"f":[10,8,0,1,-2,-2,9,-2,-2,13,9,-2,-2,-2,11,10,11,-2,-2,2,-2,-2,8,10,-2,-2,13,-2,-2],"th":[0.0015,0.5,6e-05,2.48959,-2.0,-2.0,0.03857,-2.0,-2.0,0.9,0.34923,-2.0,-2.0,-2.0,0.9995,0.5525,-0.8405,-2.0,-2.0,2.79037,-2.0,-2.0,0.5,0.5165,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,-1,15,16,17,-1,-1,20,-1,-1,23,24,-1,-1,27,-1,-1],"r":[14,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,-1,22,19,18,-1,-1,21,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00089,-0.0557,-0.08733,-0.1383,-0.15834,-0.07249,-0.02552,0.02707,-0.07792,0.00883,-0.01159,0.02066,-0.04021,0.18127,0.00254,-0.00177,0.00929,0.05681,-0.00013,-0.01407,-0.05158,-0.00859,0.06222,0.19636,0.04521,0.35767,0.00274,0.0524,-0.10711]},{"f":[1,2,-2,11,3,-2,-2,0,-2,-2,3,11,11,-2,-2,10,-2,-2,1,5,-2,-2,6,-2,-2],"th":[0.58533,0.16021,-2.0,-0.7685,5.17436,-2.0,-2.0,0.73359,-2.0,-2.0,0.6104,0.1145,-0.2505,-2.0,-2.0,0.0735,-2.0,-2.0,0.93296,0.31416,-2.0,-2.0,3.1634,-2.0,-2.0],"l":[1,2,-1,4,5,-1,-1,8,-1,-1,11,12,13,-1,-1,16,-1,-1,19,20,-1,-1,23,-1,-1],"r":[10,3,-1,7,6,-1,-1,9,-1,-1,18,15,14,-1,-1,17,-1,-1,22,21,-1,-1,24,-1,-1],"v":[0.00106,-0.07842,-0.32295,-0.06601,0.05278,-0.03593,0.19497,-0.08903,-0.17453,-0.04467,0.00233,0.03854,0.0172,0.039,-0.03152,0.06849,-0.02623,0.11271,5e-05,-0.02871,-0.02244,-0.1111,0.00474,0.03273,-0.00332]},{"f":[10,5,10,8,-2,-2,11,-2,-2,1,8,-2,-2,10,-2,-2,8,4,5,-2,-2,11,-2,-2,13,2,-2,-2,-2],"th":[0.9995,0.30105,0.0015,0.5,-2.0,-2.0,0.9995,-2.0,-2.0,0.95202,0.5,-2.0,-2.0,0.2955,-2.0,-2.0,0.5,0.5,0.42306,-2.0,-2.0,-0.2425,-2.0,-2.0,0.9,8.37693,-2.0,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,-1],"v":[0.00162,0.00327,0.00722,-0.051,-0.09221,0.01709,0.00904,0.00295,0.06399,-0.02006,-0.06533,-0.12589,0.00565,-0.00791,-0.03796,0.00918,-0.04657,-0.08414,0.0117,-0.01791,0.10256,-0.10433,-0.12241,-0.00848,0.01928,-0.00064,-0.07529,0.01238,0.14231]},{"f":[13,3,7,0,-2,-2,5,-2,-2,2,3,-2,-2,3,-2,-2,10,3,0,-2,-2,1,-2,-2,8,4,-2,-2,13,-2,-2],"th":[0.1,0.86415,4.03851,0.98307,-2.0,-2.0,-0.02389,-2.0,-2.0,2.80741,2.97852,-2.0,-2.0,4.35931,-2.0,-2.0,0.9995,1.91153,0.90726,-2.0,-2.0,0.96276,-2.0,-2.0,0.5,0.5,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00206,-0.01739,0.0104,0.03842,0.06,-0.03553,-0.02254,-0.12691,-0.01524,-0.02591,-0.09101,-0.06741,-0.23718,-0.01557,-0.00542,-0.03474,0.00671,0.00866,0.03857,0.0703,-0.01263,0.00501,-0.02619,0.01186,-0.0461,-0.08507,0.01236,-0.10203,0.02971,0.00983,0.12394]},{"f":[1,3,0,1,-2,-2,8,-2,-2,0,0,-2,-2,11,-2,-2,9,10,8,-2,-2,11,-2,-2,5,-2,7,-2,-2],"th":[0.78952,0.45993,0.09243,0.6563,-2.0,-2.0,0.5,-2.0,-2.0,0.28783,0.00081,-2.0,-2.0,0.5385,-2.0,-2.0,1.56981,0.0015,0.5,-2.0,-2.0,0.9995,-2.0,-2.0,-0.05834,-2.0,4.92459,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,-1,27,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,26,-1,28,-1,-1],"v":[0.00144,-0.03887,0.02941,-0.03901,-0.10539,0.00398,0.08248,0.21847,0.02899,-0.05976,-0.00399,-0.08807,0.0863,-0.08564,-0.0618,-0.24667,0.00345,0.00603,-0.04981,-0.08263,0.00326,0.00763,0.0017,0.06459,-0.03142,-0.33607,-0.02684,-0.08055,-0.01351]},{"f":[2,9,1,9,-2,-2,0,-2,-2,-2,9,5,5,-2,-2,9,-2,-2,2,7,-2,-2,7,-2,-2],"th":[0.24782,0.19015,1.21683,-1.15647,-2.0,-2.0,0.50411,-2.0,-2.0,-2.0,0.78926,2.97717,0.29493,-2.0,-2.0,0.5072,-2.0,-2.0,5.41294,0.55579,-2.0,-2.0,1.20225,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,-1,11,12,13,-1,-1,16,-1,-1,19,20,-1,-1,23,-1,-1],"r":[10,9,6,5,-1,-1,8,-1,-1,-1,18,15,14,-1,-1,17,-1,-1,22,21,-1,-1,24,-1,-1],"v":[0.00197,-0.05756,-0.06965,-0.05135,-0.15977,-0.02966,-0.18544,-0.20442,-0.54649,0.34209,0.0033,0.00771,0.00627,0.00878,-0.02013,0.11238,0.29688,-0.23955,-0.01267,-0.10204,-0.45937,-0.11066,-0.0026,-0.09052,0.00422]},{"f":[9,2,9,1,-2,-2,0,-2,-2,12,0,-2,-2,6,-2,-2,12,7,-2,9,-2,-2,8,0,-2,-2,11,-2,-2],"th":[1.87332,5.65288,0.50541,1.90449,-2.0,-2.0,0.99102,-2.0,-2.0,0.5,0.91107,-2.0,-2.0,4.1254,-2.0,-2.0,0.9,3.91085,-2.0,2.08866,-2.0,-2.0,0.5,1e-05,-2.0,-2.0,0.9345,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,-1,20,-1,-1,23,24,-1,-1,27,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,22,19,-1,21,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00174,0.00318,-0.0079,0.00027,0.00395,-0.08086,-0.05248,-0.08042,0.0481,0.01049,0.05343,0.03993,0.11071,0.00269,0.03797,-0.00835,-0.04862,-0.13237,-0.31937,-0.1046,-0.07988,-0.1701,-0.01321,-0.00053,-0.05412,0.00529,-0.03113,-0.04777,0.02043]},{"f":[2,9,1,5,-2,-2,0,-2,-2,-2,9,5,12,-2,-2,9,-2,-2,2,10,-2,-2,7,-2,-2],"th":[0.24782,0.03857,1.13564,0.69104,-2.0,-2.0,0.50411,-2.0,-2.0,-2.0,0.82115,2.7031,0.5,-2.0,-2.0,-0.28448,-2.0,-2.0,9.7576,0.7435,-2.0,-2.0,1.29085,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,-1,11,12,13,-1,-1,16,-1,-1,19,20,-1,-1,23,-1,-1],"r":[10,9,6,5,-1,-1,8,-1,-1,-1,18,15,14,-1,-1,17,-1,-1,22,21,-1,-1,24,-1,-1],"v":[0.00165,-0.05202,-0.06536,-0.04745,-0.04109,-0.27667,-0.17346,-0.18328,-0.49789,0.31442,0.00286,0.00709,0.00584,0.02008,-0.00612,0.09772,0.26729,-0.22403,-0.01307,-0.06907,-0.05375,-0.14949,-0.00075,-0.08348,0.00659]},{"f":[2,9,1,0,-2,-2,11,-2,-2,0,9,-2,-2,2,-2,-2,12,0,3,-2,-2,3,-2,-2,0,5,-2,-2,6,-2,-2],"th":[1.09704,0.03857,1.49261,0.44957,-2.0,-2.0,0.6425,-2.0,-2.0,0.98506,0.85319,-2.0,-2.0,0.50964,-2.0,-2.0,0.5,0.999,1.86998,-2.0,-2.0,7.12166,-2.0,-2.0,0.99102,0.05239,-2.0,-2.0,4.04577,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.0015,-0.02055,-0.011,-0.00245,0.03127,-0.02867,-0.10646,-0.19581,-0.01343,-0.10247,-0.16246,-0.2558,0.03362,0.14219,0.2625,0.09446,0.00427,0.01716,0.00493,0.10063,-0.00188,0.08012,0.0072,0.10987,-0.0021,0.00559,0.01687,-0.01236,-0.02303,0.02848,-0.03903]},{"f":[1,3,8,11,-2,-2,2,-2,-2,2,9,-2,-2,12,-2,-2,6,0,8,-2,-2,5,-2,-2,1,13,-2,-2,12,-2,-2],"th":[0.99917,0.53083,0.5,-0.29,-2.0,-2.0,6.57834,-2.0,-2.0,2.97241,0.15872,-2.0,-2.0,0.5,-2.0,-2.0,2.2957,1e-05,0.5,-2.0,-2.0,2.96496,-2.0,-2.0,2.48482,0.5,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00171,-0.0066,0.03998,0.07957,0.21432,0.03571,0.00825,0.04958,-0.04706,-0.0106,-0.03577,-0.01346,-0.10002,-0.00021,0.03175,-0.01299,0.00897,0.04027,0.113,0.2278,-0.00292,0.01631,0.00804,0.30267,0.00392,0.00839,-0.0075,0.0249,-0.04896,-0.1683,-0.02583]},{"f":[2,9,11,10,-2,-2,3,-2,-2,13,6,-2,-2,0,-2,-2,3,0,8,-2,-2,1,-2,-2,12,9,-2,-2,6,-2,-2],"th":[8.20527,0.82115,-0.0965,0.2685,-2.0,-2.0,6.50535,-2.0,-2.0,0.9,2.51175,-2.0,-2.0,0.89019,-2.0,-2.0,1.83776,0.96138,0.5,-2.0,-2.0,1.7761,-2.0,-2.0,0.5,1.70489,-2.0,-2.0,4.96946,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00173,-0.00677,-0.00286,-0.0185,0.04191,-0.04747,0.00733,-0.01039,0.02701,-0.06292,-0.04557,0.06961,-0.06493,-0.11934,-0.17358,0.01858,0.00987,0.05307,0.07986,0.20159,0.04385,-0.03979,-0.04997,0.01426,0.00582,0.04498,0.06088,-0.08415,0.00036,0.04139,-0.01114]},{"f":[1,11,2,-2,-2,5,1,-2,-2,7,-2,-2,10,2,9,-2,-2,3,-2,-2,8,4,-2,-2,1,-2,-2],"th":[0.58028,-0.721,1.03901,-2.0,-2.0,-0.36013,0.44502,-2.0,-2.0,0.65846,-2.0,-2.0,0.9995,8.61205,0.50541,-2.0,-2.0,1.63847,-2.0,-2.0,0.5,0.5,-2.0,-2.0,1.03656,-2.0,-2.0],"l":[1,2,3,-1,-1,6,7,-1,-1,10,-1,-1,13,14,15,-1,-1,18,-1,-1,21,22,-1,-1,25,-1,-1],"r":[12,5,4,-1,-1,9,8,-1,-1,11,-1,-1,20,17,16,-1,-1,19,-1,-1,24,23,-1,-1,26,-1,-1],"v":[0.00213,-0.05856,0.02738,-0.09902,0.13033,-0.07683,-0.13756,-0.34837,-0.08251,-0.06309,0.05739,-0.09743,0.00304,0.00447,-0.00349,0.00205,-0.03659,0.01236,0.06021,0.00635,-0.03829,-0.06763,0.00921,-0.08829,0.01223,-0.01934,0.05898]},{"f":[2,1,0,8,-2,-2,8,-2,-2,11,3,-2,-2,3,-2,-2,10,0,8,-2,-2,13,-2,-2,11,10,-2,-2,8,-2,-2],"th":[0.80683,1.49052,0.23863,0.5,-2.0,-2.0,0.5,-2.0,-2.0,0.667,8.37693,-2.0,-2.0,7.5295,-2.0,-2.0,0.0015,0.99301,0.5,-2.0,-2.0,0.9,-2.0,-2.0,0.9995,0.5565,-2.0,-2.0,0.5,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.0016,-0.02323,-0.01483,0.01969,0.11614,-0.0272,-0.03748,-0.08444,0.02407,-0.11725,-0.14916,-0.23854,-0.12821,-0.0332,-0.1644,0.08202,0.00386,-0.04091,-0.0526,-0.08829,-4e-05,0.0476,-0.01488,0.11757,0.00528,0.00271,0.01005,-0.00957,0.04328,0.19596,-0.01616]},{"f":[9,1,3,0,-2,-2,11,-2,-2,3,11,-2,-2,13,-2,-2,12,7,-2,11,-2,-2,8,13,-2,-2,4,-2,-2],"th":[1.97642,0.81888,0.90112,0.14402,-2.0,-2.0,-0.9205,-2.0,-2.0,1.61212,0.2025,-2.0,-2.0,0.3,-2.0,-2.0,0.9,3.85,-2.0,0.022,-2.0,-2.0,0.5,0.7,-2.0,-2.0,0.5,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,-1,20,-1,-1,23,24,-1,-1,27,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,22,19,-1,21,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00108,0.00204,-0.02726,0.01971,-0.03975,0.07092,-0.05272,0.04728,-0.08092,0.00381,0.02108,-0.00297,0.05415,0.00111,-0.01631,0.00563,-0.05231,-0.14203,-0.30859,-0.11635,-0.0928,-0.21412,-0.0158,-6e-05,0.01024,-0.05469,-0.03706,-0.06196,0.00229]},{"f":[10,13,0,8,-2,-2,9,-2,-2,1,12,-2,-2,9,-2,-2,11,10,11,-2,-2,2,-2,-2,8,10,-2,-2,13,-2,-2],"th":[0.0025,0.9,0.0,0.5,-2.0,-2.0,-0.08429,-2.0,-2.0,1.21155,0.9,-2.0,-2.0,-0.15898,-2.0,-2.0,0.9995,0.5565,-0.8545,-2.0,-2.0,8.14882,-2.0,-2.0,0.5,0.5165,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00116,-0.03619,-0.04933,-0.08234,-0.11555,-0.02205,-0.01673,0.02254,-0.04691,0.02977,0.11261,0.05574,0.21008,-0.04018,0.00821,-0.10776,0.00237,-0.00023,0.00755,0.04678,-0.0004,-0.00895,-0.02666,0.00117,0.03793,0.14173,-0.00234,0.28168,-0.00874,0.03556,-0.11348]},{"f":[1,5,3,8,-2,-2,2,-2,-2,0,3,-2,-2,10,-2,-2,1,5,0,-2,-2,11,-2,-2,12,11,-2,-2,0,-2,-2],"th":[1.0306,0.41675,0.59522,0.5,-2.0,-2.0,9.53112,-2.0,-2.0,0.88642,1.45373,-2.0,-2.0,0.595,-2.0,-2.0,1.22403,-0.63236,0.53802,-2.0,-2.0,-0.2185,-2.0,-2.0,0.9,0.4685,-2.0,-2.0,0.999,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.0014,-0.00296,-0.00019,0.03814,0.07053,0.00787,-0.00266,-0.01249,0.00355,-0.03744,-0.05202,-0.00773,-0.09127,0.01874,-0.01302,0.05992,0.01178,0.02326,0.06877,0.11651,0.02699,0.01806,-0.00025,0.0298,-0.011,-0.04996,-0.10044,-0.0036,0.01995,0.04529,-0.04512]},{"f":[9,1,3,5,-2,-2,5,-2,-2,6,0,-2,-2,1,-2,-2,12,13,11,-2,-2,-2,8,13,-2,-2,11,-2,-2],"th":[1.97642,0.99945,1.87789,0.66043,-2.0,-2.0,0.24398,-2.0,-2.0,1.75343,4e-05,-2.0,-2.0,2.40102,-2.0,-2.0,0.9,0.5,-0.5325,-2.0,-2.0,-2.0,0.5,0.7,-2.0,-2.0,0.9825,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,-1,23,24,-1,-1,27,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,22,21,20,-1,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00217,0.00305,-0.00389,0.01873,0.02358,-0.05172,-0.01049,-0.00837,-0.05682,0.00933,0.03722,0.10986,0.02288,0.00578,0.00837,-0.04276,-0.04658,-0.12807,-0.0966,-0.05573,-0.14842,-0.23206,-0.01332,0.00104,0.01022,-0.0534,-0.03312,-0.04804,0.03087]},{"f":[10,2,9,2,-2,-2,0,-2,-2,12,9,-2,-2,0,-2,-2,6,-2,8,4,-2,-2,3,-2,-2],"th":[0.9995,5.65158,0.50541,5.11437,-2.0,-2.0,0.999,-2.0,-2.0,0.5,1.8109,-2.0,-2.0,0.97713,-2.0,-2.0,1.91296,-2.0,0.5,0.5,-2.0,-2.0,2.60108,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,-1,19,20,-1,-1,23,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,18,-1,22,21,-1,-1,24,-1,-1],"v":[0.00206,0.00326,-0.00584,0.00055,0.00959,-0.03147,-0.03974,-0.06034,0.05966,0.00925,0.03466,0.04551,-0.10978,0.00436,0.01111,-0.01778,-0.0325,0.22412,-0.03852,-0.06496,0.00726,-0.08313,0.00674,-0.04506,0.02578]},{"f":[2,9,2,5,-2,-2,3,-2,-2,0,2,-2,-2,3,-2,-2,12,0,3,-2,-2,13,-2,-2,0,10,-2,-2,13,-2,-2],"th":[1.95923,0.03857,0.14547,0.64547,-2.0,-2.0,8.64107,-2.0,-2.0,0.98506,0.30875,-2.0,-2.0,6.7784,-2.0,-2.0,0.5,0.999,1.87845,-2.0,-2.0,0.9,-2.0,-2.0,0.999,0.3025,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00115,-0.01315,0.00141,-0.08007,-0.07531,-0.31134,0.00698,0.01813,-0.03957,-0.08651,-0.11496,0.1482,-0.15326,0.08417,-0.13763,0.16111,0.00415,0.01797,0.006,0.13854,0.00021,0.07826,0.03911,0.10741,-0.00135,0.00451,-0.01421,0.01254,-0.01907,-0.03648,0.0153]},{"f":[6,2,-2,-2,2,9,11,-2,-2,11,-2,-2,3,0,-2,-2,7,-2,-2],"th":[0.02052,1.65128,-2.0,-2.0,8.61199,0.89034,-0.0965,-2.0,-2.0,0.3385,-2.0,-2.0,1.68894,0.95942,-2.0,-2.0,3.55388,-2.0,-2.0],"l":[1,2,-1,-1,5,6,7,-1,-1,10,-1,-1,13,14,-1,-1,17,-1,-1],"r":[4,3,-1,-1,12,9,8,-1,-1,11,-1,-1,16,15,-1,-1,18,-1,-1],"v":[0.00073,-0.15285,-0.11996,-0.3332,0.00102,-0.00508,-0.0025,-0.01764,0.00557,-0.05179,-0.02403,-0.11727,0.00687,0.04376,0.07506,-0.0375,0.00381,-0.01646,0.01183]},{"f":[2,9,11,5,-2,-2,9,-2,-2,-2,13,10,11,-2,-2,11,-2,-2,10,11,-2,-2,11,-2,-2],"th":[0.18923,-0.09985,0.9455,0.60709,-2.0,-2.0,-0.866,-2.0,-2.0,-2.0,0.3,0.3025,-0.668,-2.0,-2.0,0.3025,-2.0,-2.0,0.3065,-0.9995,-2.0,-2.0,-0.9995,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,-1,11,12,13,-1,-1,16,-1,-1,19,20,-1,-1,23,-1,-1],"r":[10,9,6,5,-1,-1,8,-1,-1,-1,18,15,14,-1,-1,17,-1,-1,22,21,-1,-1,24,-1,-1],"v":[0.00115,-0.05152,-0.06458,-0.08175,-0.08581,-0.27208,0.02897,-0.0254,0.09167,0.15824,0.00192,-0.00639,-0.02724,0.2187,-0.03194,0.00233,-0.0129,0.06837,0.00639,0.01788,0.11209,0.00908,0.00038,-0.0451,0.00441]},{"f":[1,3,11,10,-2,-2,0,-2,-2,1,11,-2,-2,2,-2,-2,9,5,1,-2,-2,9,-2,-2,7,10,-2,-2,6,-2,-2],"th":[1.0366,0.38391,-0.7585,0.4865,-2.0,-2.0,0.98506,-2.0,-2.0,0.84592,0.4865,-2.0,-2.0,9.53229,-2.0,-2.0,0.85319,2.97717,2.06652,-2.0,-2.0,-0.28448,-2.0,-2.0,1.06389,0.8145,-2.0,-2.0,1.79581,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00128,-0.00257,0.03839,-0.03791,0.1167,-0.06546,0.05888,0.10171,-0.03073,-0.00428,-0.03237,-0.01542,-0.08952,-0.00186,-0.01083,0.00353,0.01165,0.01758,0.0146,0.02316,-0.02897,0.10023,0.33561,-0.27437,-0.02207,-0.12082,-0.22655,-0.00428,0.00478,0.32801,-0.00441]},{"f":[2,9,2,2,-2,-2,12,-2,-2,0,2,-2,-2,5,-2,-2,12,8,9,-2,-2,0,-2,-2,6,1,-2,-2,0,-2,-2],"th":[5.65142,0.35479,5.11437,0.89549,-2.0,-2.0,0.9,-2.0,-2.0,0.98506,1.96703,-2.0,-2.0,-0.2133,-2.0,-2.0,0.5,0.5,0.9839,-2.0,-2.0,0.62806,-2.0,-2.0,4.96946,0.97631,-2.0,-2.0,0.98704,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00097,-0.00712,-0.0007,0.00592,-0.01845,0.02108,-0.02504,-0.07772,-0.00805,-0.0304,-0.04564,-0.13679,-0.02346,0.04455,-0.07549,0.06449,0.00611,0.02653,0.05947,0.08044,-0.03323,0.00649,-0.03225,0.06267,0.0024,0.02273,-0.03406,0.05096,-0.00282,0.00413,-0.02933]},{"f":[6,6,-2,-2,10,13,0,-2,-2,8,-2,-2,11,10,-2,-2,8,-2,-2],"th":[0.02215,0.01595,-2.0,-2.0,0.0015,0.9,0.0,-2.0,-2.0,0.5,-2.0,-2.0,0.9995,0.6585,-2.0,-2.0,0.5,-2.0,-2.0],"l":[1,2,-1,-1,5,6,7,-1,-1,10,-1,-1,13,14,-1,-1,17,-1,-1],"r":[4,3,-1,-1,12,9,8,-1,-1,11,-1,-1,16,15,-1,-1,18,-1,-1],"v":[0.00129,-0.12719,-0.31695,-0.09705,0.00158,-0.03269,-0.04394,-0.07571,-0.00863,0.02184,-0.02042,0.16962,0.00258,0.0005,0.00493,-0.01147,0.03116,0.14261,-0.00951]},{"f":[3,11,6,2,-2,-2,4,-2,-2,0,10,-2,-2,11,-2,-2,5,1,2,-2,-2,11,-2,-2,2,6,-2,-2,10,-2,-2],"th":[1.48181,-0.9985,2.8454,8.37693,-2.0,-2.0,0.5,-2.0,-2.0,0.90726,0.1145,-2.0,-2.0,0.0825,-2.0,-2.0,0.44243,1.01561,9.99193,-2.0,-2.0,0.6395,-2.0,-2.0,5.49434,0.71741,-2.0,-2.0,0.9825,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00117,0.01616,-0.02771,0.03556,0.01725,0.13313,-0.06265,0.04404,-0.1018,0.02214,0.03625,-0.02942,0.05494,-0.00491,-0.02237,0.04956,-0.00133,0.00102,-0.00456,-0.01481,0.00201,0.01077,0.00202,0.03405,-0.02984,-0.09699,-0.33734,-0.07127,-0.00619,-0.0192,0.10696]},{"f":[9,10,13,0,-2,-2,1,-2,-2,11,10,-2,-2,8,-2,-2,12,7,-2,11,-2,-2,8,13,-2,-2,4,-2,-2],"th":[1.97642,0.0015,0.9,0.0,-2.0,-2.0,1.1994,-2.0,-2.0,0.9995,0.5995,-2.0,-2.0,0.5,-2.0,-2.0,0.9,3.81429,-2.0,0.0145,-2.0,-2.0,0.5,0.7,-2.0,-2.0,0.5,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,-1,20,-1,-1,23,24,-1,-1,27,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,22,19,-1,21,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00177,0.00254,-0.03191,-0.0442,-0.07325,-0.01129,0.02701,0.12559,-0.03869,0.00352,0.00153,0.00658,-0.00943,0.03046,0.13863,-0.01007,-0.0403,-0.10868,-0.26152,-0.08436,-0.05966,-0.17481,-0.01194,0.00138,0.00908,-0.04146,-0.02973,-0.05407,0.0081]},{"f":[7,11,10,11,-2,-2,-2,-2,2,5,0,-2,-2,0,-2,-2,10,11,-2,-2,8,-2,-2],"th":[0.32858,0.5035,0.841,0.002,-2.0,-2.0,-2.0,-2.0,8.61205,-0.35572,0.83631,-2.0,-2.0,0.89586,-2.0,-2.0,0.9995,-0.9605,-2.0,-2.0,0.5,-2.0,-2.0],"l":[1,2,3,4,-1,-1,-1,-1,9,10,11,-1,-1,14,-1,-1,17,18,-1,-1,21,-1,-1],"r":[8,7,6,5,-1,-1,-1,-1,16,13,12,-1,-1,15,-1,-1,20,19,-1,-1,22,-1,-1],"v":[0.00116,-0.08702,-0.01629,-0.07184,-0.1641,-0.02481,0.11243,-0.3087,0.00156,-0.00418,0.01406,0.036,-0.04493,-0.00905,-0.02791,0.01703,0.00713,0.00917,0.04414,0.00287,-0.0344,-0.07743,0.02254]},{"f":[13,5,2,7,-2,-2,3,-2,-2,10,8,-2,-2,10,-2,-2,3,0,2,-2,-2,11,-2,-2,11,12,-2,-2,3,-2,-2],"th":[0.1,-0.03224,0.79829,4.3062,-2.0,-2.0,2.05846,-2.0,-2.0,0.2965,0.5,-2.0,-2.0,0.6165,-2.0,-2.0,2.63058,0.91107,8.97888,-2.0,-2.0,0.0825,-2.0,-2.0,-0.2845,0.9,-2.0,-2.0,6.4429,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00121,-0.01062,-0.06381,-0.17485,-0.12545,-0.31496,-0.03523,0.01559,-0.12691,-0.00601,-0.02466,-0.05096,0.00221,0.00207,0.02289,-0.01913,0.00404,0.02238,0.03752,0.01232,0.08726,-0.01035,-0.03305,0.06605,0.00099,-0.00919,-0.02465,0.02783,0.00612,-0.02356,0.01317]},{"f":[3,2,2,1,-2,-2,7,-2,-2,8,0,-2,-2,10,-2,-2,13,2,5,-2,-2,10,-2,-2,10,11,-2,-2,2,-2,-2],"th":[1.5859,9.87496,7.54753,2.16896,-2.0,-2.0,0.5118,-2.0,-2.0,0.5,0.91107,-2.0,-2.0,0.7875,-2.0,-2.0,0.3,3.25189,-0.15337,-2.0,-2.0,0.3015,-2.0,-2.0,0.3085,-0.9995,-2.0,-2.0,5.48996,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00145,0.01404,0.0063,0.01486,0.01656,-0.21183,-0.02746,0.15502,-0.04352,0.04982,0.10852,0.29169,-0.00472,0.00849,-0.03438,0.05843,-0.00075,-0.01252,-0.06238,-0.24039,-0.05209,-0.00615,-0.02739,0.00198,0.00367,0.01381,0.09828,0.00544,-0.00169,-0.01384,0.00569]},{"f":[1,11,2,-2,11,-2,-2,0,8,-2,-2,11,-2,-2,11,12,10,-2,-2,5,-2,-2,10,12,-2,-2,0,-2,-2],"th":[0.72458,0.5175,0.14037,-2.0,-0.5945,-2.0,-2.0,0.41024,0.5,-2.0,-2.0,0.6335,-2.0,-2.0,-0.0005,0.9,0.5085,-2.0,-2.0,0.00958,-2.0,-2.0,0.9045,0.9,-2.0,-2.0,0.93896,-2.0,-2.0],"l":[1,2,3,-1,5,-1,-1,8,9,-1,-1,12,-1,-1,15,16,17,-1,-1,20,-1,-1,23,24,-1,-1,27,-1,-1],"r":[14,7,4,-1,6,-1,-1,11,10,-1,-1,13,-1,-1,22,19,18,-1,-1,21,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00045,-0.02858,-0.00227,-0.18456,0.0077,0.06245,-0.01743,-0.08494,-0.03334,0.06968,-0.0781,-0.14126,-0.11994,-0.27855,0.00143,-0.005,-0.01634,-0.00024,-0.03999,0.01568,0.04182,-0.00432,0.00582,0.00879,0.02236,-0.00499,-0.03482,-0.10445,-0.00695]},{"f":[10,0,8,13,-2,-2,13,-2,-2,7,0,-2,-2,2,-2,-2,5,8,2,-2,-2,13,-2,-2,-2],"th":[0.9995,0.18447,0.5,0.9,-2.0,-2.0,0.9,-2.0,-2.0,2.86239,0.70981,-2.0,-2.0,2.16976,-2.0,-2.0,0.56349,0.5,9.17564,-2.0,-2.0,0.9,-2.0,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,-1],"v":[0.0013,0.00228,0.01153,0.03597,-0.01342,0.13181,-0.00615,0.02474,-0.10073,-0.00194,-0.01219,-0.05013,-0.00391,0.00461,-0.02863,0.00894,-0.02727,-0.03249,-0.05401,-0.00774,-0.0802,0.00619,-0.00877,0.08625,0.17877]},{"f":[3,0,0,11,-2,-2,2,-2,-2,6,3,-2,-2,11,-2,-2,1,5,10,-2,-2,6,-2,-2,9,5,-2,-2,7,-2,-2],"th":[0.90795,0.90726,0.86769,-0.9995,-2.0,-2.0,9.9955,-2.0,-2.0,0.66902,0.34021,-2.0,-2.0,0.1155,-2.0,-2.0,1.0366,0.4506,0.6635,-2.0,-2.0,0.59775,-2.0,-2.0,0.85319,2.24703,-2.0,-2.0,0.9219,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00137,0.01819,0.02919,0.01991,-0.02531,0.02895,0.16144,0.10648,0.44176,-0.00661,0.0844,0.24199,0.0119,-0.01519,-0.03178,0.03622,-0.00036,-0.00433,-0.00233,0.00183,-0.01311,-0.03915,-0.21778,-0.03094,0.0101,0.01586,0.01207,0.14249,-0.02038,-0.12646,-0.00231]},{"f":[9,10,8,0,-2,-2,13,-2,-2,11,7,-2,-2,8,-2,-2,12,11,9,-2,-2,-2,8,5,-2,-2,11,-2,-2],"th":[2.05913,0.0015,0.5,2e-05,-2.0,-2.0,0.9,-2.0,-2.0,0.9985,2.37949,-2.0,-2.0,0.5,-2.0,-2.0,0.9,0.1805,2.12285,-2.0,-2.0,-2.0,0.5,0.07793,-2.0,-2.0,-0.148,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,-1,23,24,-1,-1,27,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,22,21,20,-1,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00159,0.00221,-0.02743,-0.04514,-0.08259,-0.00187,0.0083,-0.00967,0.15406,0.00306,0.00129,-0.01118,0.00449,0.02528,0.11309,-0.00521,-0.04428,-0.10994,-0.08669,-0.04355,-0.13195,-0.22219,-0.01609,-0.00121,-0.01132,0.02648,-0.03291,-0.07465,-0.00976]},{"f":[7,11,2,-2,-2,-2,6,-2,13,5,-2,-2,3,-2,-2],"th":[0.29789,0.535,7.57188,-2.0,-2.0,-2.0,0.01488,-2.0,0.1,-0.24416,-2.0,-2.0,2.11371,-2.0,-2.0],"l":[1,2,3,-1,-1,-1,7,-1,9,10,-1,-1,13,-1,-1],"r":[6,5,4,-1,-1,-1,8,-1,12,11,-1,-1,14,-1,-1],"v":[0.00127,-0.09038,-0.03433,-0.19419,0.04456,-0.30808,0.00158,-0.28535,0.00174,-0.00806,-0.09487,-0.00727,0.0041,0.01873,0.0003]},{"f":[1,6,5,11,-2,-2,8,-2,-2,11,7,-2,-2,9,-2,-2,10,7,11,-2,-2,10,-2,-2,6,-2,8,-2,-2],"th":[0.72458,3.38048,0.18295,0.5305,-2.0,-2.0,0.5,-2.0,-2.0,-0.624,2.53053,-2.0,-2.0,0.33915,-2.0,-2.0,0.9995,0.32858,0.5035,-2.0,-2.0,0.0015,-2.0,-2.0,2.00511,-2.0,0.5,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,-1,27,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,26,-1,28,-1,-1],"v":[0.0004,-0.02832,-0.08529,-0.06009,-0.02682,-0.13586,-0.18124,-0.28667,-0.16157,-0.00468,0.07394,0.20528,0.00574,-0.0278,-0.00837,-0.07839,0.00137,0.00231,-0.08451,-0.01586,-0.30065,0.00266,-0.03052,0.00213,-0.0256,0.17318,-0.03042,-0.05134,0.00197]},{"f":[2,1,1,0,-2,-2,0,-2,-2,11,3,-2,-2,6,-2,-2,3,5,2,-2,-2,0,-2,-2,13,2,-2,-2,9,-2,-2],"th":[0.94356,1.22407,0.9368,0.95942,-2.0,-2.0,0.15721,-2.0,-2.0,0.6665,4.97118,-2.0,-2.0,4.96003,-2.0,-2.0,3.66409,-0.54372,2.99084,-2.0,-2.0,0.99301,-2.0,-2.0,0.3,3.32444,-2.0,-2.0,1.56981,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00165,-0.01411,-0.00688,-0.02935,-0.04661,0.04913,0.01753,0.06815,-0.00302,-0.07344,-0.10538,-0.24446,-0.09886,0.0087,-0.08832,0.10289,0.00334,0.01339,0.11865,0.05062,0.28622,0.01069,0.01684,-0.02092,-0.00027,-0.01748,-0.18937,-0.01422,0.00434,0.00547,-0.0245]},{"f":[1,5,3,10,-2,-2,0,-2,-2,13,0,-2,-2,-2,9,5,2,-2,-2,1,-2,-2,7,11,-2,-2,6,-2,-2],"th":[1.0467,0.41911,2.32944,0.0835,-2.0,-2.0,0.999,-2.0,-2.0,0.9,0.90535,-2.0,-2.0,-2.0,-0.1354,2.97717,0.4744,-2.0,-2.0,1.97866,-2.0,-2.0,0.87671,0.1755,-2.0,-2.0,0.56736,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,-1,15,16,17,-1,-1,20,-1,-1,23,24,-1,-1,27,-1,-1],"r":[14,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,-1,22,19,18,-1,-1,21,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00116,-0.00152,0.00037,0.01624,-0.04728,0.01942,-0.00293,-0.00841,0.00894,-0.02443,-0.0207,-0.03563,0.02897,-0.25167,0.0099,0.02232,0.01489,-0.09574,0.01839,0.16464,0.1039,1.13295,-0.00586,-0.10883,-0.05694,-0.24024,0.00884,0.36317,0.00101]},{"f":[13,10,11,4,-2,-2,8,-2,-2,11,2,-2,-2,1,-2,-2,10,11,8,-2,-2,11,-2,-2,11,13,-2,-2,13,-2,-2],"th":[0.3,0.3615,-0.8155,0.5,-2.0,-2.0,0.5,-2.0,-2.0,0.1015,9.00242,-2.0,-2.0,0.75534,-2.0,-2.0,0.3055,-0.9995,0.5,-2.0,-2.0,-0.1865,-2.0,-2.0,-0.9985,0.5,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00204,-0.00419,-0.01983,0.13191,0.30679,-0.05094,-0.0229,-0.04001,-0.01024,0.00415,-0.00886,-0.02684,0.00145,0.05256,-0.05949,0.07215,0.00538,0.01427,0.09039,0.311,-0.07542,0.0081,-0.01813,0.01919,0.00074,-0.03164,0.01157,-0.07106,0.00474,0.01665,-0.00859]},{"f":[1,2,0,3,-2,-2,3,-2,-2,5,7,-2,-2,13,-2,-2,1,12,3,-2,-2,8,-2,-2,12,3,-2,-2,0,-2,-2],"th":[1.01561,9.53112,0.89776,8.65288,-2.0,-2.0,7.54397,-2.0,-2.0,0.01915,3.96202,-2.0,-2.0,0.9,-2.0,-2.0,1.22425,0.9,8.17006,-2.0,-2.0,0.5,-2.0,-2.0,0.9,5.27501,-2.0,-2.0,0.999,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00092,-0.00265,-0.00976,-0.01773,-0.00399,-0.04904,0.00513,-0.02791,0.0648,0.00493,0.01302,-0.01085,0.03048,-0.013,-0.01099,-0.18371,0.00693,0.0123,0.02235,0.05631,0.00606,-0.00095,-0.01952,0.02878,-0.00783,-0.04432,-0.13501,-0.03107,0.02064,0.04505,-0.03542]},{"f":[3,7,11,7,-2,-2,6,-2,-2,2,5,-2,-2,12,-2,-2,2,0,3,-2,-2,3,-2,-2,7,0,-2,-2,5,-2,-2],"th":[0.59849,3.6788,0.001,1.94347,-2.0,-2.0,4.97921,-2.0,-2.0,0.48976,0.07732,-2.0,-2.0,0.5,-2.0,-2.0,5.65288,0.999,8.6143,-2.0,-2.0,7.40367,-2.0,-2.0,3.35417,0.07868,-2.0,-2.0,-0.0007,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00093,0.01927,0.03331,0.01135,-0.02181,0.04732,0.06374,0.02421,0.11381,-0.00397,-0.04871,-0.11939,0.23496,0.01023,0.07687,-0.01969,-0.00024,-0.00714,-0.01216,0.00062,-0.03433,0.01472,-0.03238,0.08456,0.0039,-0.00572,0.01929,-0.02094,0.01036,0.04851,0.00285]},{"f":[9,2,5,0,-2,-2,0,-2,-2,10,8,-2,-2,11,-2,-2,12,13,5,-2,-2,-2,8,5,-2,-2,11,-2,-2],"th":[1.84891,8.61199,-0.37049,0.78588,-2.0,-2.0,0.89586,-2.0,-2.0,0.0005,0.5,-2.0,-2.0,0.9985,-2.0,-2.0,0.9,0.7,-0.0021,-2.0,-2.0,-2.0,0.5,0.13248,-2.0,-2.0,0.9905,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,-1,23,24,-1,-1,27,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,22,21,20,-1,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00124,0.00204,-0.00271,0.01341,0.03399,-0.03172,-0.007,-0.02163,0.01328,0.00686,-0.03744,-0.06643,0.00411,0.0084,0.00374,0.05174,-0.02568,-0.08149,-0.05579,-0.20871,-0.03751,-0.22684,-0.00285,0.00913,0.00576,0.0529,-0.02205,-0.0349,0.03585]},{"f":[6,-2,1,10,11,-2,-2,11,-2,-2,9,5,-2,-2,7,-2,-2],"th":[0.01697,-2.0,1.0366,0.6605,-0.8885,-2.0,-2.0,-0.7695,-2.0,-2.0,0.51538,2.97717,-2.0,-2.0,0.91582,-2.0,-2.0],"l":[1,-1,3,4,5,-1,-1,8,-1,-1,11,12,-1,-1,15,-1,-1],"r":[2,-1,10,7,6,-1,-1,9,-1,-1,14,13,-1,-1,16,-1,-1],"v":[0.00038,-0.18071,0.00054,-0.00218,0.0024,0.03549,-0.00393,-0.00985,-0.03236,-0.00375,0.00791,0.01493,0.00969,0.24938,-0.00989,-0.13776,0.0053]},{"f":[3,12,5,2,-2,-2,8,-2,-2,2,7,-2,-2,0,-2,-2,1,11,0,-2,-2,0,-2,-2,2,5,-2,-2,6,-2,-2],"th":[0.6104,0.7,0.1027,0.69792,-2.0,-2.0,0.5,-2.0,-2.0,9.50488,0.50599,-2.0,-2.0,0.96138,-2.0,-2.0,0.90657,0.5295,0.0006,-2.0,-2.0,0.29976,-2.0,-2.0,8.61199,1.10551,-2.0,-2.0,4.9747,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00105,0.02016,0.038,0.01595,-0.03643,0.08456,0.15631,0.38058,0.15713,0.00261,-0.01124,0.14652,-0.0193,0.04602,0.11384,-0.02432,-0.00018,-0.0155,-0.00118,-0.06253,0.00749,-0.04648,-0.00918,-0.13088,0.00168,-0.00345,-0.00204,-0.08069,0.00588,0.02932,-0.00101]},{"f":[3,1,2,2,-2,-2,0,-2,-2,2,-2,6,-2,-2,13,2,0,-2,-2,3,-2,-2,3,0,-2,-2,0,-2,-2],"th":[1.29633,1.60077,9.88246,7.52259,-2.0,-2.0,0.91107,-2.0,-2.0,1.30887,-2.0,1.04817,-2.0,-2.0,0.5,1.75901,0.19803,-2.0,-2.0,4.26556,-2.0,-2.0,5.27547,0.06528,-2.0,-2.0,0.92448,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,-1,12,-1,-1,15,16,17,-1,-1,20,-1,-1,23,24,-1,-1,27,-1,-1],"r":[14,9,6,5,-1,-1,8,-1,-1,11,-1,13,-1,-1,22,19,18,-1,-1,21,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00134,0.01226,0.01597,0.01034,0.0189,-0.03817,0.04501,0.08402,-0.01377,-0.03886,-0.23623,-0.01125,0.22167,-0.04049,-0.00028,-0.00672,-0.0675,-0.01484,-0.12815,-0.00272,0.00843,-0.01459,0.00429,-0.0299,0.0565,-0.05842,0.00734,-0.00098,0.02491]},{"f":[3,11,3,-2,8,-2,-2,0,6,-2,-2,6,-2,-2,0,8,13,-2,-2,13,-2,-2,3,7,-2,-2,0,-2,-2],"th":[0.32889,-0.7875,0.13726,-2.0,0.5,-2.0,-2.0,0.97713,4.83516,-2.0,-2.0,1.4124,-2.0,-2.0,0.21022,0.5,0.9,-2.0,-2.0,0.9,-2.0,-2.0,7.08264,2.89182,-2.0,-2.0,0.92448,-2.0,-2.0],"l":[1,2,3,-1,5,-1,-1,8,9,-1,-1,12,-1,-1,15,16,17,-1,-1,20,-1,-1,23,24,-1,-1,27,-1,-1],"r":[14,7,4,-1,6,-1,-1,11,10,-1,-1,13,-1,-1,22,19,18,-1,-1,21,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00111,0.02872,-0.01948,-0.09939,-0.00063,0.05741,-0.02197,0.04092,0.05801,0.00874,0.11438,-0.00934,0.24029,-0.0416,0.00024,0.00692,0.02147,-0.01604,0.09937,-0.0048,0.02131,-0.08345,-0.00322,-0.01299,-0.03494,-0.00021,0.00415,-0.01086,0.01855]},{"f":[10,0,8,1,-2,-2,13,-2,-2,9,7,-2,-2,1,-2,-2,11,10,11,-2,-2,0,-2,-2,4,3,-2,-2,8,-2,-2],"th":[0.0025,0.0,0.5,2.33159,-2.0,-2.0,0.3,-2.0,-2.0,0.2991,0.7682,-2.0,-2.0,1.11191,-2.0,-2.0,0.9975,0.5565,-0.8395,-2.0,-2.0,0.0,-2.0,-2.0,0.5,8.72134,-2.0,-2.0,0.5,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00127,-0.02285,-0.0437,-0.07133,-0.08246,-0.03689,0.00895,-0.07248,0.04028,-0.00192,0.03554,0.09074,0.00152,-0.03739,-0.00577,-0.26511,0.00203,0.00047,0.00534,0.03534,-0.00124,-0.00501,-0.03053,-0.00295,0.02089,-0.04836,0.00635,-0.11059,0.04557,0.13639,0.01679]},{"f":[6,2,2,-2,-2,-2,1,3,10,-2,-2,11,-2,-2,9,7,-2,-2,7,-2,-2],"th":[0.02492,2.51588,0.77781,-2.0,-2.0,-2.0,1.0366,2.86659,0.1095,-2.0,-2.0,-0.2865,-2.0,-2.0,-0.17227,0.50645,-2.0,-2.0,0.81082,-2.0,-2.0],"l":[1,2,3,-1,-1,-1,7,8,9,-1,-1,12,-1,-1,15,16,-1,-1,19,-1,-1],"r":[6,5,4,-1,-1,-1,14,11,10,-1,-1,13,-1,-1,18,17,-1,-1,20,-1,-1],"v":[0.00136,-0.07591,-0.02582,-0.08092,0.02604,-0.20449,0.00161,-0.0009,0.00999,-0.03894,0.01447,-0.00436,-0.01582,-0.00058,0.00837,0.01798,0.33233,0.01258,-0.00207,-0.10255,0.00561]},{"f":[1,3,10,6,-2,-2,11,-2,-2,5,7,-2,-2,6,-2,-2,0,12,1,-2,-2,13,-2,-2,1,12,-2,-2,12,-2,-2],"th":[1.05462,2.94839,0.1205,3.27712,-2.0,-2.0,0.1265,-2.0,-2.0,0.10053,4.95363,-2.0,-2.0,1.74274,-2.0,-2.0,0.999,0.9,1.22302,-2.0,-2.0,0.7,-2.0,-2.0,1.11909,0.9,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00125,-0.00086,0.0089,-0.03355,-0.09132,-0.02136,0.01503,0.00277,0.03779,-0.00395,-0.00092,-0.00885,0.00672,-0.01963,-0.12776,-0.01346,0.00906,0.01494,0.00159,0.02491,-0.03769,0.03092,0.01171,0.07861,-0.02548,0.03019,0.0806,-0.04548,-0.0425,-0.12016,-0.03547]},{"f":[6,-2,2,1,1,-2,-2,0,-2,-2,5,0,-2,-2,0,-2,-2],"th":[0.01595,-2.0,0.801,1.12764,0.99956,-2.0,-2.0,0.55428,-2.0,-2.0,-0.43689,0.62964,-2.0,-2.0,0.70981,-2.0,-2.0],"l":[1,-1,3,4,5,-1,-1,8,-1,-1,11,12,-1,-1,15,-1,-1],"r":[2,-1,10,7,6,-1,-1,9,-1,-1,14,13,-1,-1,16,-1,-1],"v":[0.00129,-0.20499,0.00143,-0.01163,-0.00492,-0.01585,0.04389,-0.05966,-0.02204,-0.17683,0.0026,0.01643,0.04925,-0.02777,0.00115,-0.00594,0.00548]},{"f":[2,9,12,0,-2,-2,11,-2,-2,2,2,-2,-2,3,-2,-2,0,0,13,-2,-2,4,-2,-2,13,5,-2,-2,6,-2,-2],"th":[8.6122,0.50541,0.5,0.997,-2.0,-2.0,0.0025,-2.0,-2.0,2.08329,0.4444,-2.0,-2.0,2.87258,-2.0,-2.0,0.91107,0.86583,0.9,-2.0,-2.0,0.5,-2.0,-2.0,0.9,0.2113,-2.0,-2.0,4.99941,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00119,-0.00282,0.00093,0.00714,0.0031,0.0385,-0.01091,-0.02706,0.01106,-0.02177,-0.07288,0.28918,-0.10879,-0.00796,0.06168,-0.01484,0.00505,0.00999,0.00598,0.00971,-0.0248,0.06323,0.00524,0.13093,-0.00454,-0.02086,-0.02778,0.0209,0.04518,0.17366,0.01209]},{"f":[9,2,7,1,-2,-2,5,-2,-2,7,0,-2,-2,5,-2,-2,12,5,11,-2,-2,-2,8,1,-2,-2,4,-2,-2],"th":[2.08866,9.79985,0.75787,1.37349,-2.0,-2.0,-0.41371,-2.0,-2.0,3.99341,0.07924,-2.0,-2.0,-0.00986,-2.0,-2.0,0.9,0.0147,-0.539,-2.0,-2.0,-2.0,0.5,1.00374,-2.0,-2.0,0.5,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,-1,23,24,-1,-1,27,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,22,21,20,-1,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.00171,0.00214,-0.00172,0.03169,0.02319,0.21066,-0.00464,0.01118,-0.0094,0.00644,-0.00388,0.02118,-0.01775,0.01419,0.06153,0.00746,-0.03858,-0.11194,-0.14251,-0.0972,-0.22481,-0.04983,-0.01167,0.00046,-0.0114,0.01834,-0.03429,-0.05808,0.00396]},{"f":[3,5,2,8,-2,-2,5,-2,-2,10,0,-2,-2,0,-2,-2,5,7,5,-2,-2,1,-2,-2,6,8,-2,-2,9,-2,-2],"th":[2.99115,-0.01063,0.89499,0.5,-2.0,-2.0,-0.5438,-2.0,-2.0,0.2355,0.0,-2.0,-2.0,0.90726,-2.0,-2.0,0.10053,0.41087,-0.29618,-2.0,-2.0,1.0303,-2.0,-2.0,1.9989,0.5,-2.0,-2.0,-0.07598,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00097,0.00782,-0.0208,-0.10021,-0.24121,-0.06108,-0.00187,0.1224,-0.03406,0.01279,-0.01052,-0.07107,-0.00392,0.02048,0.03554,-0.01173,-0.00119,0.00162,-0.08249,-0.27914,-0.0321,0.00201,-0.00268,0.01044,-0.01396,-0.07421,-0.19349,0.0667,-0.00755,0.01598,-0.01973]},{"f":[1,2,-2,11,3,-2,-2,7,-2,-2,2,0,3,-2,-2,3,-2,-2,0,0,-2,-2,13,-2,-2],"th":[0.58007,0.1607,-2.0,-0.8005,1.86166,-2.0,-2.0,2.53985,-2.0,-2.0,8.61205,0.89586,8.61518,-2.0,-2.0,7.47959,-2.0,-2.0,0.91107,0.86211,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,-1,4,5,-1,-1,8,-1,-1,11,12,13,-1,-1,16,-1,-1,19,20,-1,-1,23,-1,-1],"r":[10,3,-1,7,6,-1,-1,9,-1,-1,18,15,14,-1,-1,17,-1,-1,22,21,-1,-1,24,-1,-1],"v":[0.00153,-0.02901,-0.17115,-0.02108,0.05027,-0.03789,0.14214,-0.03408,-0.0129,-0.10017,0.002,-0.00194,-0.00672,0.00476,-0.03114,0.00801,-0.01686,0.04986,0.0058,0.01075,0.00563,0.06578,-0.00377,-0.01965,0.04081]},{"f":[2,9,5,2,-2,-2,3,-2,-2,0,8,-2,-2,3,-2,-2,3,12,5,-2,-2,2,-2,-2,5,7,-2,-2,12,-2,-2],"th":[1.97999,0.15872,0.02347,0.80742,-2.0,-2.0,0.60263,-2.0,-2.0,0.98506,0.5,-2.0,-2.0,8.59747,-2.0,-2.0,3.6642,0.5,0.05284,-2.0,-2.0,8.81564,-2.0,-2.0,0.09759,0.35433,-2.0,-2.0,0.7,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00075,-0.00735,0.0028,-0.00396,-0.02255,0.01489,0.03652,0.20569,0.01654,-0.0593,-0.07864,-0.1563,-0.05123,0.06138,-0.0945,0.11905,0.00245,0.01194,0.05139,0.0364,0.23317,0.00482,-0.01375,0.01755,-0.00094,0.00231,-0.17071,0.00139,-0.01529,-0.09112,-0.00727]},{"f":[10,0,8,13,-2,-2,13,-2,-2,12,5,-2,-2,5,-2,-2,5,8,0,-2,-2,13,-2,-2,-2],"th":[0.9995,0.21022,0.5,0.9,-2.0,-2.0,0.7,-2.0,-2.0,0.3,0.33529,-2.0,-2.0,-0.04354,-2.0,-2.0,0.56582,0.5,0.95453,-2.0,-2.0,0.9,-2.0,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,-1],"v":[0.00107,0.00177,0.00859,0.02508,-0.00961,0.09425,-0.00368,0.02819,-0.06671,-0.00146,0.00999,0.01553,-0.10765,-0.0056,-0.04924,-0.00485,-0.01972,-0.0239,-0.03955,-0.05063,0.05173,0.00412,-0.01193,0.09542,0.14484]},{"f":[2,9,9,13,-2,-2,0,-2,-2,-2,10,0,8,-2,-2,12,-2,-2,11,10,-2,-2,4,-2,-2],"th":[0.14815,-0.1174,-1.15647,0.9,-2.0,-2.0,0.97516,-2.0,-2.0,-2.0,0.0005,0.0,0.5,-2.0,-2.0,0.7,-2.0,-2.0,0.9975,0.5445,-2.0,-2.0,0.5,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,-1,11,12,13,-1,-1,16,-1,-1,19,20,-1,-1,23,-1,-1],"r":[10,9,6,5,-1,-1,8,-1,-1,-1,18,15,14,-1,-1,17,-1,-1,22,21,-1,-1,24,-1,-1],"v":[0.0009,-0.04119,-0.05906,-0.12958,-0.04538,-0.48112,-0.0317,-0.07711,0.06952,0.19562,0.00132,-0.02076,-0.03895,-0.0652,0.00899,0.00834,-0.1232,0.02442,0.00188,0.00068,0.00353,-0.00516,0.01603,-0.05185,0.04785]},{"f":[3,0,6,1,-2,-2,10,-2,-2,5,2,-2,-2,0,-2,-2,2,5,5,-2,-2,6,-2,-2,7,0,-2,-2,5,-2,-2],"th":[1.31778,4e-05,0.81159,0.70928,-2.0,-2.0,0.243,-2.0,-2.0,-0.00958,0.8865,-2.0,-2.0,0.90726,-2.0,-2.0,5.71411,0.44201,0.06026,-2.0,-2.0,0.8571,-2.0,-2.0,3.3689,0.07868,-2.0,-2.0,-0.01766,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00144,0.01141,-0.01334,0.04,-0.03864,0.07285,-0.02908,-0.11053,-0.01841,0.017,-0.01073,-0.10584,0.01906,0.02376,0.04234,-0.00024,-6e-05,-0.00692,-0.00347,-0.00613,0.0482,-0.05717,-0.20469,-0.03265,0.00376,-0.00459,0.01536,-0.01655,0.0092,0.04122,0.00372]},{"f":[3,8,11,0,-2,-2,1,-2,-2,11,10,-2,-2,2,-2,-2,1,10,11,-2,-2,0,-2,-2,0,9,-2,-2,1,-2,-2],"th":[0.31921,0.5,-0.29,0.58983,-2.0,-2.0,0.92599,-2.0,-2.0,-0.3555,0.8135,-2.0,-2.0,8.81564,-2.0,-2.0,1.0367,0.6605,-0.8885,-2.0,-2.0,0.92448,-2.0,-2.0,0.999,0.74157,-2.0,-2.0,1.12621,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00129,0.02519,0.05541,0.15642,0.0501,0.3816,0.01949,0.06296,-0.03028,0.00534,-0.04145,-0.10659,0.00198,0.03559,0.05988,-0.08216,0.00055,-0.00213,0.00142,0.03163,-0.00428,-0.00802,-0.01519,0.00606,0.00776,0.0116,0.0156,-0.01086,-0.01605,0.03307,-0.04962]},{"f":[2,9,5,1,-2,-2,13,-2,-2,13,8,-2,-2,0,-2,-2,12,3,2,-2,-2,0,-2,-2,0,12,-2,-2,6,-2,-2],"th":[3.26793,0.15872,0.01859,2.44963,-2.0,-2.0,0.9,-2.0,-2.0,0.7,0.5,-2.0,-2.0,0.92448,-2.0,-2.0,0.5,2.92471,6.79304,-2.0,-2.0,0.999,-2.0,-2.0,0.97713,0.9,-2.0,-2.0,4.81448,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.001,-0.00559,0.00585,-0.00061,0.00345,-0.13406,0.04169,0.083,-0.05445,-0.03882,-0.06472,-0.13153,-0.04354,-0.00972,-0.03567,0.04459,0.00311,0.01284,0.09852,0.1978,-0.02264,0.00551,-0.00257,0.05182,0.0004,0.00564,-0.01723,0.01599,-0.01248,0.02278,-0.02614]},{"f":[13,10,11,5,-2,-2,2,-2,-2,11,12,-2,-2,10,-2,-2,10,11,8,-2,-2,11,-2,-2,11,4,-2,-2,13,-2,-2],"th":[0.3,0.3615,-0.8395,0.02695,-2.0,-2.0,2.25402,-2.0,-2.0,0.0165,0.9,-2.0,-2.0,0.7715,-2.0,-2.0,0.2745,-0.9995,0.5,-2.0,-2.0,-0.1885,-2.0,-2.0,-0.9995,0.5,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00122,-0.00399,-0.01913,0.12462,0.02288,0.2973,-0.02189,-0.08925,-0.0182,0.00401,-0.00678,-0.0276,0.00429,0.04063,0.05205,-0.09447,0.00403,0.01263,0.07321,0.25133,-0.0567,0.00755,-0.02074,0.01966,1e-05,-0.0297,0.07466,-0.0468,0.00332,0.01562,-0.01023]},{"f":[13,5,2,7,-2,-2,2,-2,-2,10,11,-2,-2,11,-2,-2,10,8,9,-2,-2,13,-2,-2,10,11,-2,-2,13,-2,-2],"th":[0.3,-0.03115,2.91157,4.53651,-2.0,-2.0,5.86696,-2.0,-2.0,0.3025,-0.6315,-2.0,-2.0,0.6415,-2.0,-2.0,0.0065,0.5,0.03857,-2.0,-2.0,0.7,-2.0,-2.0,0.2595,0.0145,-2.0,-2.0,0.9,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00105,-0.0037,-0.0391,-0.08253,-0.02452,-0.17998,-0.00695,0.08763,-0.04377,-0.00049,-0.01726,0.17357,-0.0203,0.00676,-0.00088,0.05992,0.0036,-0.02267,-0.04089,-0.00911,-0.07433,0.02732,-0.00041,0.12044,0.00475,0.01602,0.00045,0.05949,0.00049,0.00792,-0.00966]},{"f":[10,10,5,2,-2,-2,0,-2,-2,5,8,-2,-2,3,-2,-2,5,12,-2,8,-2,-2,-2],"th":[0.9995,0.9815,0.736,9.99297,-2.0,-2.0,0.87891,-2.0,-2.0,0.74363,0.5,-2.0,-2.0,8.56029,-2.0,-2.0,0.54531,0.7,-2.0,0.5,-2.0,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,-1,20,-1,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,22,19,-1,21,-1,-1,-1],"v":[0.00097,0.0016,0.0008,0.002,-0.00222,0.00486,-0.02112,-0.04741,0.05592,0.026,0.01181,-0.01194,0.0841,0.12253,0.06979,0.26444,-0.01736,-0.02127,-0.15633,-0.01729,-0.03024,0.00288,0.12441]},{"f":[2,9,2,7,-2,-2,11,-2,-2,6,-2,0,-2,-2,10,1,13,-2,-2,9,-2,-2,11,7,-2,-2,8,-2,-2],"th":[8.61205,0.35479,7.51048,0.78026,-2.0,-2.0,0.0905,-2.0,-2.0,0.37101,-2.0,0.91298,-2.0,-2.0,0.0015,1.21161,0.9,-2.0,-2.0,-0.29641,-2.0,-2.0,0.9975,3.59897,-2.0,-2.0,0.5,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,-1,12,-1,-1,15,16,17,-1,-1,20,-1,-1,23,24,-1,-1,27,-1,-1],"r":[14,9,6,5,-1,-1,8,-1,-1,11,-1,13,-1,-1,22,19,18,-1,-1,21,-1,-1,26,25,-1,-1,28,-1,-1],"v":[0.0009,-0.00259,0.00119,0.00375,0.03443,0.00109,-0.02526,-0.06448,0.02524,-0.01607,0.34693,-0.01803,-0.03067,0.01855,0.00428,-0.02386,-0.01217,-0.02067,0.12822,-0.07881,-0.00558,-0.12331,0.00543,0.00375,-0.00812,0.00813,0.0364,0.12392,0.01207]},{"f":[6,-2,1,3,8,-2,-2,5,-2,-2,6,9,-2,-2,9,-2,-2],"th":[0.01595,-2.0,1.03666,0.90795,0.5,-2.0,-2.0,0.41695,-2.0,-2.0,0.56977,0.03857,-2.0,-2.0,-0.1354,-2.0,-2.0],"l":[1,-1,3,4,5,-1,-1,8,-1,-1,11,12,-1,-1,15,-1,-1],"r":[2,-1,10,7,6,-1,-1,9,-1,-1,14,13,-1,-1,16,-1,-1],"v":[0.00068,-0.17371,0.0008,-0.00124,0.01264,0.02553,-0.00309,-0.00278,-0.00235,-0.02506,0.00633,0.04763,0.01052,0.52165,0.0044,0.01324,-0.00972]},{"f":[1,4,6,11,-2,-2,11,-2,-2,13,11,-2,-2,0,-2,-2,2,0,0,-2,-2,3,-2,-2,9,7,-2,-2,7,-2,-2],"th":[1.05306,0.5,2.77548,0.7925,-2.0,-2.0,-0.9995,-2.0,-2.0,0.9,-0.9955,-2.0,-2.0,0.91681,-2.0,-2.0,0.36451,0.56401,0.01501,-2.0,-2.0,7.5295,-2.0,-2.0,-0.59875,0.53406,-2.0,-2.0,0.63132,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00065,-0.00114,-0.00536,-0.03733,-0.02158,-0.10943,-8e-05,0.04138,-0.00179,0.00382,-0.00417,-0.0396,0.00226,0.02277,-0.01538,0.04965,0.00717,-0.05906,-0.01415,-0.08915,0.08247,-0.13349,-0.36901,-0.04123,0.00894,0.02516,0.37055,0.01589,0.00117,-0.08454,0.0046]},{"f":[9,2,9,6,-2,-2,6,-2,-2,10,7,-2,-2,12,-2,-2,5,-2,12,11,-2,-2,8,-2,-2],"th":[1.97642,5.65158,0.35479,4.99614,-2.0,-2.0,0.41891,-2.0,-2.0,0.9995,2.94883,-2.0,-2.0,0.9,-2.0,-2.0,-0.0035,-2.0,0.9,-0.537,-2.0,-2.0,0.5,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,-1,19,20,-1,-1,23,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,18,-1,22,21,-1,-1,24,-1,-1],"v":[0.00085,0.00131,-0.0027,0.00148,-0.00868,0.0109,-0.01807,0.29917,-0.02098,0.00392,0.00509,-0.00506,0.00815,-0.02072,-0.45629,-0.01536,-0.02422,-0.18292,-0.01522,-0.05237,-0.00904,-0.10633,-0.00178,0.00848,-0.0167]},{"f":[3,1,10,0,-2,-2,11,-2,-2,2,0,-2,-2,5,-2,-2,0,3,10,-2,-2,8,-2,-2,8,12,-2,-2,13,-2,-2],"th":[1.82377,1.57268,0.0855,0.0,-2.0,-2.0,-0.9965,-2.0,-2.0,1.88952,0.50624,-2.0,-2.0,1.46222,-2.0,-2.0,0.17766,8.58272,0.1545,-2.0,-2.0,0.5,-2.0,-2.0,0.5,0.9,-2.0,-2.0,0.5,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00091,0.00882,0.01186,-0.01855,-0.08548,-0.00759,0.01558,-0.01672,0.01903,-0.03552,-0.12188,-0.09887,-0.26325,-0.01327,-0.04014,0.1129,-0.00067,0.00592,0.02088,-0.01133,0.03141,-0.00614,0.02263,-0.02649,-0.0038,-0.01084,-0.02463,0.0032,0.00853,-0.02189,0.03195]},{"f":[2,7,3,11,-2,-2,1,-2,-2,5,0,-2,-2,0,-2,-2,3,0,5,-2,-2,5,-2,-2,8,6,-2,-2,10,-2,-2],"th":[8.6122,0.78034,4.55114,0.703,-2.0,-2.0,0.86877,-2.0,-2.0,-0.38256,0.84916,-2.0,-2.0,0.89586,-2.0,-2.0,4.25124,0.96138,0.26124,-2.0,-2.0,0.30029,-2.0,-2.0,0.5,0.4125,-2.0,-2.0,0.9805,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00092,-0.0023,0.02063,-0.01375,-0.03882,0.06761,0.03975,0.10149,0.03056,-0.00421,0.0087,0.02394,-0.03573,-0.00778,-0.02089,0.01148,0.00404,0.01405,0.02466,0.04096,0.0025,-0.01698,-0.02434,0.0313,0.00064,-0.00606,0.18542,-0.00965,0.0087,0.00482,0.0522]},{"f":[6,-2,0,3,13,-2,-2,8,-2,-2,12,8,-2,-2,2,-2,-2],"th":[0.01691,-2.0,0.21114,9.01433,0.5,-2.0,-2.0,0.5,-2.0,-2.0,0.3,0.5,-2.0,-2.0,2.15955,-2.0,-2.0],"l":[1,-1,3,4,5,-1,-1,8,-1,-1,11,12,-1,-1,15,-1,-1],"r":[2,-1,10,7,6,-1,-1,9,-1,-1,14,13,-1,-1,16,-1,-1],"v":[0.00081,-0.15251,0.00094,0.00544,0.01387,0.00599,0.0393,-0.00572,0.02001,-0.0247,-0.00141,0.01143,-0.00203,0.03936,-0.00599,-0.04885,-0.0063]},{"f":[9,2,5,3,-2,-2,5,-2,-2,3,5,-2,-2,1,-2,-2,12,-2,5,13,-2,-2,-2],"th":[2.16116,1.1212,0.00912,5.25482,-2.0,-2.0,0.48054,-2.0,-2.0,3.65669,-1.31993,-2.0,-2.0,1.08821,-2.0,-2.0,0.7,-2.0,0.07043,0.5,-2.0,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,-1,19,20,-1,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,18,-1,22,21,-1,-1,-1],"v":[0.00099,0.00127,-0.00702,-0.01526,-0.03813,0.00707,0.02413,0.06925,-0.04174,0.00234,0.00961,0.27472,0.00695,-0.00029,-0.00353,0.00935,-0.0328,-0.12664,-0.01417,-0.02394,-0.0119,-0.05031,0.0137]},{"f":[1,2,-2,11,-2,0,-2,-2,3,5,9,-2,-2,10,-2,-2,5,11,-2,-2,12,-2,-2],"th":[0.58533,0.1607,-2.0,-0.9565,-2.0,0.73359,-2.0,-2.0,3.05309,-0.01063,0.99503,-2.0,-2.0,0.2265,-2.0,-2.0,0.10053,0.3495,-2.0,-2.0,0.7,-2.0,-2.0],"l":[1,2,-1,4,-1,6,-1,-1,9,10,11,-1,-1,14,-1,-1,17,18,-1,-1,21,-1,-1],"r":[8,3,-1,5,-1,7,-1,-1,16,13,12,-1,-1,15,-1,-1,20,19,-1,-1,22,-1,-1],"v":[0.00117,-0.02394,-0.15416,-0.01591,0.08545,-0.02537,-0.07005,0.00535,0.00157,0.00712,-0.02364,-0.02327,-0.26185,0.01231,-0.0106,0.01783,-0.0002,0.00221,-0.00253,0.01237,-0.01118,-0.05755,-0.00326]},{"f":[2,1,9,2,-2,-2,11,-2,-2,5,2,-2,-2,13,-2,-2,10,11,12,-2,-2,7,-2,-2,8,13,-2,-2,7,-2,-2],"th":[8.61086,2.06414,0.89034,7.62262,-2.0,-2.0,0.3385,-2.0,-2.0,1.12534,1.46607,-2.0,-2.0,0.7,-2.0,-2.0,0.9995,-0.9585,0.7,-2.0,-2.0,4.98558,-2.0,-2.0,0.5,0.7,-2.0,-2.0,3.94956,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00085,-0.00235,-0.00089,0.00055,0.0022,-0.02386,-0.02696,4e-05,-0.08215,-0.02894,-0.02111,-0.09104,-0.00851,-0.10697,-0.03629,-0.20377,0.00394,0.00516,0.0269,-0.00871,0.05049,0.00273,-0.00937,0.01021,-0.02101,-0.047,-0.02321,-0.10691,0.01524,0.06826,-0.01562]},{"f":[11,12,10,8,-2,-2,13,-2,-2,10,5,-2,-2,5,-2,-2,11,13,4,-2,-2,6,-2,-2,8,10,-2,-2,10,-2,-2],"th":[-0.3745,0.9,0.5055,0.5,-2.0,-2.0,0.9,-2.0,-2.0,0.9985,0.04832,-2.0,-2.0,0.57152,-2.0,-2.0,-0.3385,0.9,0.5,-2.0,-2.0,4.03588,-2.0,-2.0,0.5,0.5005,-2.0,-2.0,0.7375,-2.0,-2.0],"l":[1,2,3,4,-1,-1,7,-1,-1,10,11,-1,-1,14,-1,-1,17,18,19,-1,-1,22,-1,-1,25,26,-1,-1,29,-1,-1],"r":[16,9,6,5,-1,-1,8,-1,-1,13,12,-1,-1,15,-1,-1,24,21,20,-1,-1,23,-1,-1,28,27,-1,-1,30,-1,-1],"v":[0.00076,-0.00394,-0.01384,0.00221,0.05431,-0.0487,-0.03434,-0.02402,-0.17877,0.01432,0.02451,0.08417,-0.00322,-0.01071,-0.01717,0.11888,0.00293,0.04521,0.09561,0.01544,0.23343,-0.03553,-0.17429,0.01069,0.00204,-0.00261,-0.01809,0.01296,0.00873,0.02254,-0.03673]}],"hv":{"latin":-0.0633,"jp":-0.0415},"kind":"edge","kbw":{"latin":0.67,"jp":0.43}};
// @@MODEL_END
function mlTree(T, x) { var k = 0; while (T.l[k] !== -1) k = x[T.f[k]] <= T.th[k] ? T.l[k] : T.r[k]; return T.v[k]; }
function mlQ(x) { var m = WCTL_MODEL, y = m.init; for (var i = 0; i < m.trees.length; i++) y += m.lr * mlTree(m.trees[i], x); return y; }
// 1 点の太さの変化量（モデルによる）。ずらす量 d（内向き正）にして返す
function mlD(o, w, gap, gapO, line, nx, ny, k, M, p) {
  var e = nx * nx, std = e * M.stdV + (1 - e) * M.stdH, cl = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  var x = [e, cl(w / std, 0, 2.5), cl(gap / M.stdV, 0, 10), cl((gapO === undefined ? 1000 : gapO) / M.stdV, 0, 10), line ? 1 : 0, cl((o.cur || 0) * M.stdV, -3, 3),
    cl((o.dcv === undefined ? 1e9 : o.dcv) / M.stdV, 0, 5), cl((o.dcp === undefined ? 1e9 : o.dcp) / M.stdV, 0, 5), M.jp ? 1 : 0, Math.log(M.Vt / M.stdV), o.yN === undefined ? 0.5 : o.yN];
  var base = e * (M.Vt - M.stdV) + (1 - e) * (M.Ht - M.stdH);
  if (WCTL_MODEL.kind === 'edge') {
    // 辺の動きそのもの（どちら側へ太るかも含む）を学んだモデル：この辺の動き ÷ 太さの変化の半分
    x.push(ny, o.oef === undefined ? (o.oe === undefined ? (gap >= 900 ? 1 : 0) : o.oe) : o.oef, o.oof === undefined ? (o.oo === undefined ? ((gapO === undefined ? 1000 : gapO) >= 900 ? 1 : 0) : o.oo) : o.oof);
    return -mlQ(x) * base / 2;
  }
  var q = mlQ(x), dw = q * base;
  return -k * dw / 2;
}
function convexHull(P) {
  var pts = P.map(function (p) { return [p[0], p[1]]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  var cross = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); };
  var lo = [], up = [], i;
  for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
  for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); }
  up.pop(); lo.pop(); return lo.concat(up);
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
function stemModel(ST, p) {
  var Vt = ST.V * p.W, r = p.ratio;
  // 学習した縦横比の変化：太いほど横画を縦画より細く（書体の中央値。欧文・和文で別）
  if (mlOn(p) && ENG.MLHV && WCTL_MODEL.hv && p.W > 0) { var sl = ST.jp ? WCTL_MODEL.hv.jp : WCTL_MODEL.hv.latin; r *= 1 + p.learn * sl * Math.log(p.W); }
  return { stdV: ST.V, stdH: ST.H, Vt: Vt, Ht: Vt * r, jp: !!ST.jp };
}
function targetFor(w, nx, ny, M, p) {
  var a = nx * nx, b = ny * ny, std = a * M.stdV + b * M.stdH, tgt = a * M.Vt + b * M.Ht;
  var prop = w * tgt / std;
  var dev = Math.abs(w - std) / std, inTol = dev <= p.tol ? 1 : Math.max(0, 1 - (dev - p.tol) / 0.15);
  var wt = prop + (tgt - prop) * p.uni * inTol;
  var s2 = 2 * nx * ny; wt *= 1 - p.dg * s2 * s2;
  return wt;
}
// 太る量の配分：文字の外側を向いた辺と、内側（カウンター）を向いた辺で分ける
function shareK(gap, gapOpp, p, nx, ny, oe, oo) {
  var ex = p.outX === undefined ? (p.out === undefined ? 0.5 : p.out) : p.outX, ey = p.outY === undefined ? ex : p.outY;
  var e = (nx === undefined) ? ex : nx * nx * ex + ny * ny * ey;
  // oe / oo：自分の側・反対側の外が開けている割合（0..1）。ないときは1本のレイの結果で決める
  var a = oe === undefined ? (gap >= 900 ? 1 : 0) : oe, b = oo === undefined ? ((gapOpp === undefined ? 1000 : gapOpp) >= 900 ? 1 : 0) : oo;
  return a * (1 - b) * 2 * e + (1 - a) * b * 2 * (1 - e) + (a * b + (1 - a) * (1 - b));
}
function dFrom(w, gap, nx, ny, k, M, p) {
  // 合流部のかたまり（え の曲がり角・ふところの奥）は、局所の太さが画の太さより大きく出る。画の太さの一定倍までとみなす
  if (ENG.WCAP && w > 0) { var stdW = nx * nx * M.stdV + ny * ny * M.stdH, wc = ENG.WCAP * stdW; if (w > wc) w = wc; }
  var wt = targetFor(w, nx, ny, M, p), d = k * (w - wt) / 2;
  if (d < 0 && gap < 900) { var room = Math.max(0, (gap - p.mg * M.Vt) / 2); if (-d > room) d = -room; }
  return d;
}
function constF(v) { return function () { return v; }; }
function mlOn(p) { return !!(WCTL_MODEL && ENG.ML && p.learn > 0); }   // p.learn：学習モデルの強さ 0..1（p.ml は角の伸びの上限なので別）
// 太らせるとき、向かいの白（カウンター）を残す
// モデルの量は、基本の計算（目標の太さぴったり）から、目標の太さの ±MLCLIP/2 の範囲でだけ動かす。
// 大きく細らせるとき（10% など）は、倍率のわずかな誤差でも線が消えるため
function mlMix(d, dml, w, nx, ny, M, p) {
  var lim = ENG.MLCLIP * Math.max(1, targetFor(w, nx, ny, M, p)) / 2, v = dml - d;
  if (v > lim) v = lim; else if (v < -lim) v = -lim;
  return d + p.learn * v;
}
function mlRoom(d, gap, M, p) { if (d < 0 && gap < 900) { var room = Math.max(0, (gap - p.mg * M.Vt) / 2); if (-d > room) d = -room; } return d; }
function segDFun(S, M, p) {
  if (S.onMetric && p.lockM !== false) return constF(0);
  var opp = S.opp && p.lockM !== false, k = opp ? 2 : 1;
  if (S.g.line) {
    var kL = opp ? 2 : shareK(S.gap, S.gapOpp, p, S.n0[0], S.n0[1], S.oe, S.oo), d0L = dFrom(S.w, S.gap, S.n0[0], S.n0[1], kL, M, p);
    // 先細りの画：辺に沿って太さが変わるなら、両端で目標の太さになるよう量を直線的に変える（一定だと元の太さの差がそのまま残る）
    if (ENG.LINVAR && S.good && S.good.length >= 4) {
      var G0 = S.good, sx = 0, sy = 0, sxx = 0, sxy = 0, nG = G0.length;
      G0.forEach(function (o) { sx += o.t; sy += o.w; sxx += o.t * o.t; sxy += o.t * o.w; });
      var den = nG * sxx - sx * sx;
      if (den > 1e-9) {
        var sl = (nG * sxy - sx * sy) / den, ic = (sy - sl * sx) / nG, w0 = ic, w1 = ic + sl;
        var lo = Math.min.apply(null, G0.map(function (o) { return o.w; })), hi = Math.max.apply(null, G0.map(function (o) { return o.w; }));
        w0 = Math.max(lo, Math.min(hi, w0)); w1 = Math.max(lo, Math.min(hi, w1));
        if (Math.abs(w1 - w0) > 0.04 * S.w) {
          var e0 = dFrom(w0, S.gap, S.n0[0], S.n0[1], kL, M, p), e1 = dFrom(w1, S.gap, S.n0[0], S.n0[1], kL, M, p);
          return function (t) { return e0 + (e1 - e0) * t; };
        }
      }
    }
    if (mlOn(p) && ENG.MLEDGE) {
      // 直線：真ん中あたりの点の様子でモデルの倍率を決める
      var om = S.sm[Math.floor(S.sm.length / 2)] || {}, dml = mlD(om, Math.min(S.w, (ENG.WCAP || 99) * (S.n0[0] * S.n0[0] * M.stdV + S.n0[1] * S.n0[1] * M.stdH)), S.gap, S.gapOpp, true, S.n0[0], S.n0[1], kL, M, p);
      d0L = mlRoom(mlMix(d0L, dml, Math.min(S.w, (ENG.WCAP || 99) * (S.n0[0] * S.n0[0] * M.stdV + S.n0[1] * S.n0[1] * M.stdH)), S.n0[0], S.n0[1], M, p), S.gap, M, p);
    }
    return constF(d0L);
  }
  var ml = mlOn(p) && ENG.MLEDGE;
  var ds = S.dsm || S.sm.map(function (s) {
    var kS = shareK(s.gf, s.gof, p, s.nx, s.ny, s.oef, s.oof), d = dFrom(s.wf, s.gf, s.nx, s.ny, kS, M, p);
    if (ml && s.wf > 0) { var wv = Math.min(s.wf, (ENG.WCAP || 99) * (s.nx * s.nx * M.stdV + s.ny * s.ny * M.stdH)); d = mlRoom(mlMix(d, mlD(s, wv, s.gf, s.gof, false, s.nx, s.ny, kS, M, p), wv, s.nx, s.ny, M, p), s.gf, M, p); }
    return { t: s.t, d: d }; });
  var part = function (lo, hi) { return median(ds.filter(function (o) { return o.t >= lo && o.t <= hi; }).map(function (o) { return o.d; })); };
  if (ENG.DFLIN && S.Lc0 > ENG.DFLIN * M.stdV) {
    // 長い曲線（区間を整理したあとなど）：3 点では太さの変化を追えないので、測った点を 3 つずつの中央値でならして直線でつなぐ
    var pts = ds.map(function (o, k) { var a = ds[Math.max(0, k - 1)].d, b = o.d, c = ds[Math.min(ds.length - 1, k + 1)].d; return { t: o.t, d: median([a, b, c]) }; });
    return function (t) {
      if (t <= pts[0].t) return pts[0].d; if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].d;
      for (var k = 1; k < pts.length; k++) if (t <= pts[k].t) { var u = (t - pts[k - 1].t) / (pts[k].t - pts[k - 1].t); return pts[k - 1].d + (pts[k].d - pts[k - 1].d) * u; }
      return pts[pts.length - 1].d; };
  }
  var d0 = part(0, 0.3), dm = part(0.35, 0.65), d1 = part(0.7, 1);
  return function (t) { var u = 1 - t; return d0 * u * (1 - 2 * t) + dm * 4 * t * u + d1 * t * (2 * t - 1); };
}
function distToEdges(edges, x, y) {
  var best = 1e9;
  for (var k = 0; k < edges.length; k++) {
    var e = edges[k], ex = e[2] - e[0], ey = e[3] - e[1], l2 = ex * ex + ey * ey, u = l2 > 0 ? ((x - e[0]) * ex + (y - e[1]) * ey) / l2 : 0;
    u = u < 0 ? 0 : (u > 1 ? 1 : u);
    var dx = e[0] + ex * u - x, dy = e[1] + ey * u - y, dd = dx * dx + dy * dy; if (dd < best) best = dd;
  }
  return Math.sqrt(best);
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
  // 端点が角の処理で本来のずらし位置から動いたとき、その差をなめらかに配って目標の線を端点へ導く
  var qa0 = (function () { var P = g.a, T = segTan(g, 0), d = D(0); return [P[0] - T[1] * d, P[1] + T[0] * d]; })();
  var qb0 = (function () { var P = g.b, T = segTan(g, 1), d = D(1); return [P[0] - T[1] * d, P[1] + T[0] * d]; })();
  var ea = [a2[0] - qa0[0], a2[1] - qa0[1]], eb = [b2[0] - qb0[0], b2[1] - qb0[1]];
  if (!ENG.RAMP) { ea = [0, 0]; eb = [0, 0]; }
  for (var j = 1; j < N; j++) {
    var t = j / N, P = bez(g, t), T = segTan(g, t), d = D(t), ra = (1 - t) * (1 - t) * (1 + 2 * t), rb = t * t * (3 - 2 * t);
    var q = [P[0] - T[1] * d + ea[0] * ra + eb[0] * rb, P[1] + T[0] * d + ea[1] * ra + eb[1] * rb];
    // ずらした線が折り返して小さなループになる所（曲率半径よりずらす量が大きい所）は捨てる
    if ((q[0] - prev[0]) * T[0] + (q[1] - prev[1]) * T[1] <= 0) continue;
    if ((b2[0] - q[0]) * T[0] + (b2[1] - q[1]) * T[1] <= 0 && j > 1) continue;
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
  if (ENG.DBG) ENG.DBG.push({ a: a2, b: b2, err: err });
  if (err <= tol || depth >= (tol < 0 ? 0 : 2)) { out.push(cand); return; }
  var sp = splitBez(g, 0.5), Pm = sp[0].b, Tm = segTan(g, 0.5), dmid = D(0.5), M2 = [Pm[0] - Tm[1] * dmid, Pm[1] + Tm[0] * dmid];
  offsetCurve(sp[0], a2, M2, function (t) { return D(t / 2); }, tol, depth + 1, out);
  offsetCurve(sp[1], M2, b2, function (t) { return D(0.5 + t / 2); }, tol, depth + 1, out);
}
// 線端のあしらい：角度（線端の辺を中心で回す／水平・垂直に揃える）と丸み（線端の辺を弧にする）。頂点は増やさない
function terminals(res, p, M) {
  var n = res.length, ang = (p.tang || 0) * Math.PI / 180, snap = !!p.tsnap, rnd = p.tround || 0;
  if (!ang && !snap && !rnd) return;
  var moveEnd = function (g, P) { var dx = P[0] - g.b[0], dy = P[1] - g.b[1]; g.b = P; if (g.line) g.c2 = P; else g.c2 = [g.c2[0] + dx, g.c2[1] + dy]; };
  var moveStart = function (g, P) { var dx = P[0] - g.a[0], dy = P[1] - g.a[1]; g.a = P; if (g.line) g.c1 = P; else g.c1 = [g.c1[0] + dx, g.c1[1] + dy]; };
  var tanEnd = function (g) { var v = g.line || hyp(g.b[0] - g.c2[0], g.b[1] - g.c2[1]) < 1e-6 ? [g.b[0] - g.a[0], g.b[1] - g.a[1]] : [g.b[0] - g.c2[0], g.b[1] - g.c2[1]]; return nrm(v); };
  var tanStart = function (g) { var v = g.line || hyp(g.c1[0] - g.a[0], g.c1[1] - g.a[1]) < 1e-6 ? [g.b[0] - g.a[0], g.b[1] - g.a[1]] : [g.c1[0] - g.a[0], g.c1[1] - g.a[1]]; return nrm(v); };
  for (var j = 0; j < n; j++) {
    var g = res[j]; if (!g.cap || !g.line) continue;
    var pv = res[(j - 1 + n) % n], nx = res[(j + 1) % n];
    var D = hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]); if (D < 1e-3) continue;
    // 側面の向き。線端のすぐ手前に短い辺があると向きが横を向くので、線端の辺に直角な向き（外向き）と混ぜて安定させる
    var uC = nrm([g.b[0] - g.a[0], g.b[1] - g.a[1]]), nOut = [uC[1], -uC[0]];
    var mix = function (t, sgn) { var v = [t[0] * sgn, t[1] * sgn], c = v[0] * nOut[0] + v[1] * nOut[1]; return c > 0.82 ? nrm([v[0] + nOut[0], v[1] + nOut[1]]) : nOut; };
    var tp = mix(tanEnd(pv), 1), tn0 = mix(tanStart(nx), -1), tn = [-tn0[0], -tn0[1]];   // tp は線端へ向かう、tn は線端から離れる
    if (ang || snap) {
      var M0 = [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2], u = nrm([g.b[0] - g.a[0], g.b[1] - g.a[1]]);
      var th = Math.atan2(u[1], u[0]) + ang;
      if (snap) { var q90 = Math.PI / 2, th2 = Math.round(th / q90) * q90; if (Math.abs(th2 - th) <= ENG.SNAPMAX * Math.PI / 180) th = th2; }   // 大きく回す必要がある線端はそのまま
      var u2 = [Math.cos(th), Math.sin(th)];
      var A2 = lineX(M0, u2, g.a, tp), B2 = lineX(M0, u2, g.b, tn);
      // 側面からはみ出すほど傾けない（1 辺の長さまで）
      if (A2 && B2 && hyp(A2[0] - g.a[0], A2[1] - g.a[1]) < D && hyp(B2[0] - g.b[0], B2[1] - g.b[1]) < D) {
        moveEnd(pv, A2); g.a = A2; g.c1 = A2; moveStart(nx, B2); g.b = B2; g.c2 = B2;
      }
    }
    if (rnd > 0) {
      // 側面の延長方向にハンドルを出して弧にする。100% で半円に近い形。線の長さが変わらないよう端を内側へ戻す
      var R = hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) / 2, h = rnd * 4 / 3 * R, back = 0.75 * h;
      var Ai = [g.a[0] - tp[0] * back, g.a[1] - tp[1] * back], Bi = [g.b[0] + tn[0] * back, g.b[1] + tn[1] * back];
      if (back < 0.9 * hyp(pv.b[0] - pv.a[0], pv.b[1] - pv.a[1]) && back < 0.9 * hyp(nx.b[0] - nx.a[0], nx.b[1] - nx.a[1])) { moveEnd(pv, Ai); moveStart(nx, Bi); g.a = Ai; g.b = Bi; }
      g.line = false; g.c1 = [g.a[0] + tp[0] * h, g.a[1] + tp[1] * h]; g.c2 = [g.b[0] - tn[0] * h, g.b[1] - tn[1] * h];
    }
  }
}
function deformGlyph(A, ST, p) {
  var M = stemModel(ST, p), m = A.m;
  // なめらかにつながる曲線の連なりでは、区間をまたいでオフセット量をならす（区間ごとの食い違いで波打たないように）
  var sw = p.smooth === undefined ? 5 : p.smooth;
  A.SEG.forEach(function (segs) {
    var n = segs.length, chain = [], used = [];
    segs.forEach(function (S) { S.dsm = null; });
    if (!sw) return;
    var ok = function (S) { return !S.g.line && !S.hidden && !S.isCap && !S.coincide && !(S.onMetric && p.lockM !== false); };
    var smoothJoin = function (P, N) { return (P.t1[0] * N.t0[0] + P.t1[1] * N.t0[1]) > 0.985; };
    for (var i = 0; i < n; i++) {
      if (used[i] || !ok(segs[i])) continue;
      var st = i, guard = 0;
      while (guard++ < n) { var pv = (st - 1 + n) % n; if (pv === i || used[pv] || !ok(segs[pv]) || !smoothJoin(segs[pv], segs[st])) break; st = pv; }
      var run = [], j = st; guard = 0;
      while (guard++ < n) { run.push(j); used[j] = true; var nx = (j + 1) % n; if (nx === st || used[nx] || !ok(segs[nx]) || !smoothJoin(segs[j], segs[nx])) break; j = nx; }
      var flat = [];
      run.forEach(function (si) { var S = segs[si]; S.sm.forEach(function (sm) {
        var kS = shareK(sm.gf, sm.gof, p, sm.nx, sm.ny, sm.oef, sm.oof), d = dFrom(sm.wf, sm.gf, sm.nx, sm.ny, kS, M, p);
        if (mlOn(p) && ENG.MLEDGE && sm.wf > 0) { var wv = Math.min(sm.wf, (ENG.WCAP || 99) * (sm.nx * sm.nx * M.stdV + sm.ny * sm.ny * M.stdH)); d = mlRoom(mlMix(d, mlD(sm, wv, sm.gf, sm.gof, false, sm.nx, sm.ny, kS, M, p), wv, sm.nx, sm.ny, M, p), sm.gf, M, p); }
        flat.push({ S: S, t: sm.t, d: d }); }); });
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
  // 交差で別の画の下を通り抜ける辺（前後がなめらかにつながる見えている辺）は、前後の辺と同じだけ動かす。
  // 重ねた画でできた字（Noto の お・あ など）で、交差の中だけ元の太さが残ってこぶやくびれになるのを防ぐ
  A.SEG.forEach(function (segs, ci) {
    var n = segs.length;
    segs.forEach(function (S, si) {
      S.passThru = false;
      if (!ENG.PASSTHRU || !S.hidden) return;
      var j, pv = null, nx = null, k;
      for (j = 1; j < n; j++) { k = (si - j + n) % n; if (!segs[k].hidden) { pv = segs[k]; break; } }
      for (j = 1; j < n; j++) { k = (si + j) % n; if (!segs[k].hidden) { nx = segs[k]; break; } }
      if (!pv || !nx || pv.isCap || nx.isCap) return;
      // 隠れた区間の入口と出口で、見えている辺と向きがほぼ揃っている（線端ではなく、画の側面が続いている）
      // 長さ 0 の区間（重なった点）は向きが決まらないので飛ばす
      var segLen = function (X) { return hyp(X.g.b[0] - X.g.a[0], X.g.b[1] - X.g.a[1]) + (X.g.line ? 0 : hyp(X.g.c1[0] - X.g.a[0], X.g.c1[1] - X.g.a[1])); };
      var ip = segs.indexOf(pv), inx = segs.indexOf(nx), first = null, last = null, q;
      for (q = 1; q < n; q++) { var F1 = segs[(ip + q) % n]; if (F1 === nx) break; if (segLen(F1) > 2) { first = F1; break; } }
      for (q = 1; q < n; q++) { var L1 = segs[(inx - q + n) % n]; if (L1 === pv) break; if (segLen(L1) > 2) { last = L1; break; } }
      if (!first || !last) { S.passThru = segLen(S) <= 2; return; }
      var c1 = pv.t1[0] * first.t0[0] + pv.t1[1] * first.t0[1], c2 = last.t1[0] * nx.t0[0] + last.t1[1] * nx.t0[1];
      var cc = pv.t1[0] * nx.t0[0] + pv.t1[1] * nx.t0[1];
      if (c1 > 0.8 && c2 > 0.8 && cc > 0.5) S.passThru = true;
    });
  });
  A.SEG.forEach(function (segs, ci) {
    segs.forEach(function (S, si) {
      if (DF[ci][si] || S.isCap) return;
      if (S.passThru) return;                                              // 後で前後から補間する
      if (S.between && ENG.BETWEEN) {
        var B = S.between, fp = DF[B.p.ci][B.p.si], fn = DF[B.n.ci][B.n.si];
        if (fp && fn && B.ray) {
          // 当たった辺が法線方向に d 動くと、レイとの交点はレイに沿って d / cos だけ動く
          var mvAlong = function (O, f, t) { var T = segTan(O.g, t), nO = [-T[1], T[0]], c = nO[0] * S.n0[0] + nO[1] * S.n0[1]; if (Math.abs(c) < 0.3) c = c < 0 ? -0.3 : 0.3; return f(t) / c; };
          var vp2 = mvAlong(B.p, fp, B.tp), vn2 = mvAlong(B.n, fn, B.tn), fr2 = B.dn / (B.dn + B.dp);
          DF[ci][si] = constF(vn2 * (1 - fr2) + vp2 * fr2); return;
        }
        if (fp && fn) {
          var vp = (fp(0) + fp(1)) / 2 * (B.p.n0[0] * S.n0[0] + B.p.n0[1] * S.n0[1]), vn = (fn(0) + fn(1)) / 2 * (B.n.n0[0] * S.n0[0] + B.n.n0[1] * S.n0[1]);
          var fr = B.dn / (B.dn + B.dp); DF[ci][si] = constF(vn * (1 - fr) + vp * fr); return;
        }
      }
      if (S.follow) { var F = S.follow, f = DF[F.ci][F.si], v = f ? (f(0) + f(1)) / 2 : 0; DF[ci][si] = constF(v * (F.n0[0] * S.n0[0] + F.n0[1] * S.n0[1])); }
      else DF[ci][si] = constF(0);
    });
  });
  // 短い辺（つなぎ目の数ユニットの辺など）は自前で測らず、前後の辺から補間する
  var tinyL = (p.tiny === undefined ? 0.35 : p.tiny) * ST.V;
  A.SEG.forEach(function (segs, ci) {
    segs.forEach(function (S, si) {
      var g = S.g, L = g.line ? hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) : (hyp(g.c1[0] - g.a[0], g.c1[1] - g.a[1]) + hyp(g.c2[0] - g.c1[0], g.c2[1] - g.c1[1]) + hyp(g.b[0] - g.c2[0], g.b[1] - g.c2[1]));
      S.Lc = L;
      // なめらかにつながる曲線の連なり（細かく分割された輪郭）は、短くても自分で測る（前後から補間すると合流部で量が合わない）
      var nS = segs.length, Pv0 = segs[(si - 1 + nS) % nS], Nx0 = segs[(si + 1) % nS];
      var smoothRun = ENG.SHORTC && !g.line && (Pv0.t1[0] * S.t0[0] + Pv0.t1[1] * S.t0[1]) > 0.985 && (S.t1[0] * Nx0.t0[0] + S.t1[1] * Nx0.t0[1]) > 0.985;
      var tl = smoothRun ? ENG.SHORTC * ST.V : tinyL;
      S.tiny = (L < tl || (S.coincide && !S.follow) || S.passThru || (ENG.TURNINT && (S.turnCut || S.longRay))) && !S.isCap;
      if (S.tiny) DF[ci][si] = null;
    });
  });
  A.SEG.forEach(function (segs, ci) {
    var n = segs.length;
    for (var pass = 0; pass < 4; pass++) {
      segs.forEach(function (S, si) {
        if (!S.tiny || DF[ci][si]) return;
        // 前後の測れた辺のあいだを、輪郭に沿った長さの割合でなめらかにつなぐ（短い辺が続くとき、辺ごとに同じ傾きを繰り返さない）
        var j, pv = null, nx = null, Lb = 0, La = 0;
        for (j = 1; j < n; j++) { var a = segs[(si - j + n) % n]; if (!a.tiny && !a.isCap && DF[ci][(si - j + n) % n]) { pv = DF[ci][(si - j + n) % n]; break; } Lb += a.Lc; }
        for (j = 1; j < n; j++) { var b = segs[(si + j) % n]; if (!b.tiny && !b.isCap && DF[ci][(si + j) % n]) { nx = DF[ci][(si + j) % n]; break; } La += b.Lc; }
        if (pv || nx) { var v0 = pv ? pv(1) : nx(0), v1 = nx ? nx(0) : pv(1), Lt = Lb + S.Lc + La;
          DF[ci][si] = (function (a0, a1, f0, f1) { return function (t) { var u = f0 + (f1 - f0) * t; return a0 + (a1 - a0) * u; }; })(v0, v1, Lt > 0 ? Lb / Lt : 0, Lt > 0 ? (Lb + S.Lc) / Lt : 1); }
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
  // 向かい合う直線どうしで、両側のずらす量の合計が「太さ − 目標の太さ」を超えないように抑える（細くしすぎて画がつぶれる・裏返るのを防ぐ）
  if (ENG.PAIRCAP) {
    var allS = []; A.SEG.forEach(function (segs, ci) { segs.forEach(function (S, si) { allS.push(S); }); });
    allS.forEach(function (S) {
      if (!S.g.line || S.hidden || S.isCap || S.coincide) return;
      var mx = (S.g.a[0] + S.g.b[0]) / 2, my = (S.g.a[1] + S.g.b[1]) / 2, best = null;
      allS.forEach(function (O) {
        if (O === S || !O.g.line || O.hidden || O.isCap || O.coincide) return;
        if (O.n0[0] * S.n0[0] + O.n0[1] * S.n0[1] > -0.9) return;        // ほぼ逆向きの辺だけ
        var ex = O.g.b[0] - O.g.a[0], ey = O.g.b[1] - O.g.a[1], den = S.n0[0] * ey - S.n0[1] * ex; if (Math.abs(den) < 1e-9) return;
        var ax = O.g.a[0] - mx, ay = O.g.a[1] - my, t = (ax * ey - ay * ex) / den, u = (ax * S.n0[1] - ay * S.n0[0]) / den;
        if (t > 0 && u >= 0 && u <= 1 && t < 1.8 * ST.V && (!best || t < best.t)) best = { O: O, t: t };
      });
      if (!best) return;
      var dS = DF[S.ci][S.si], dO = DF[best.O.ci][best.O.si], vS = (dS(0) + dS(1)) / 2, vO = (dO(0) + dO(1)) / 2;
      var room = best.t - targetFor(best.t, S.n0[0], S.n0[1], M, p);
      var tg0 = targetFor(best.t, S.n0[0], S.n0[1], M, p);
      if (vS > 0 && vO > 0 && vS + vO > room + 0.5 * tg0 && room > 0) {       // 目標の半分より細くなる（つぶれる）ときだけ
        var f = room / (vS + vO);
        DF[S.ci][S.si] = (function (F, f) { return function (t) { return F(t) * f; }; })(dS, f);
        DF[best.O.ci][best.O.si] = (function (F, f) { return function (t) { return F(t) * f; }; })(dO, f);
      }
    });
  }
  // フレア：線端に近いほど太らせる（ずらす量から引く）。線端からの距離は輪郭に沿って測る
  if (p.flare > 0) A.SEG.forEach(function (segs, ci) {
    var n = segs.length, len = [], pos = [], T = 0, caps = [];
    segs.forEach(function (S, i) {
      var L = 0, pr = S.g.a; for (var q = 1; q <= 8; q++) { var P = bez(S.g, q / 8); L += hyp(P[0] - pr[0], P[1] - pr[1]); pr = P; }
      len.push(L); pos.push(T); T += L; if (S.isCap) caps.push(i);
    });
    if (!caps.length) return;
    var Af = p.flare * M.Vt / 2, Lf = Math.max(1, (p.flen || 2) * M.Vt);
    var cyc = function (a, b) { var d = Math.abs(a - b) % T; return Math.min(d, T - d); };
    segs.forEach(function (S, i) {
      if (S.isCap || S.hidden || S.coincide) return;
      var F0 = DF[ci][i];
      DF[ci][i] = function (t) {
        var x = pos[i] + len[i] * t, sd = 1e9;
        caps.forEach(function (c) { sd = Math.min(sd, cyc(x, pos[c]), cyc(x, pos[c] + len[c])); });
        var u = sd / Lf; return F0(t) - (u < 1 ? Af * (1 - u) * (1 - u) : 0);
      };
    });
  });
  // 点は縦画の太りの約 0.9 倍だけ大きく、塗りの図形は大きさを変えない
  if (A.blob) A.SEG.forEach(function (segs, ci) {
    var kind = A.blob[ci]; if (!kind) return;
    var dd = kind === 'dot' ? -ENG.DOTGROW * (M.Vt - M.stdV) / 2 : 0;
    segs.forEach(function (S, si) { DF[ci][si] = constF(dd); });
  });
  // 合流部の天井：レイで測った太さは、画の分かれ目では向かいの別の辺を越えて長く出る（え・あの合流、ふところの奥など）。
  // 自分の辺と向かいの辺から等距離の点（内接円の中心）までが本当の半分の太さなので、そこを超えて細らせない
  if (ENG.MEDCAP) {
    if (!A.vedges) buildVEdges(A);
    var distOpp = function (x, y, nx0, ny0) { return distOppE(A.vedges, x, y, nx0, ny0, undefined, null, ENG.MEDCONE); };
    A.SEG.forEach(function (segs, ci) {
      if (A.blob && A.blob[ci]) return;
      segs.forEach(function (S, si) {
        var F0 = DF[ci][si]; if (!F0 || S.hidden || S.isCap) return;
        var ts = [0.02, 0.25, 0.5, 0.75, 0.98], sc = [], any = false;
        ts.forEach(function (t) {
          var d = F0(t), f = 1; sc.push(1); if (!(d > 0.5)) return;
          var wl = null, kk = 1;
          if (S.g.line) { wl = S.w; kk = shareK(S.gap, S.gapOpp, p, S.n0[0], S.n0[1], S.oe, S.oo); }
          else { var bd = 9, so = null; S.sm.forEach(function (o) { if (o.vis && o.w !== undefined && Math.abs(o.t - t) < bd) { bd = Math.abs(o.t - t); so = o; } });
            if (so) { wl = so.w; kk = shareK(so.gf, so.gof, p, so.nx, so.ny, so.oef, so.oof); } }
          if (S.opp && p.lockM !== false) kk = 2;
          if (!(kk > 0)) kk = 1;
          if (!(wl > 0) || wl > 1000) return;
          var T = segTan(S.g, t), nx0 = -T[1], ny0 = T[0];
          // 内接円の大きさは形だけで決まるので、区間ごとに一度だけ測って覚えておく（プレビューのたびに測らない）
          if (!S.medC) S.medC = {};
          var key = String(t), lo = S.medC[key];
          if (lo === undefined) {
            var P = bez(S.g, t), h = wl / 2;
            lo = distOpp(P[0] + nx0 * h, P[1] + ny0 * h, nx0, ny0) >= h - 1 ? null : medialR(A.vedges, P[0], P[1], nx0, ny0, h);   // null：ふつうの画
            S.medC[key] = lo;
          }
          if (lo === null) return;
          var w2 = 2 * lo, tg2 = targetFor(w2, nx0, ny0, M, p), capD = kk * Math.max(0, w2 - tg2) / 2;
          if (w2 > 0.9 * wl || capD >= d) return;
          f = capD / d; sc[sc.length - 1] = f; any = true; if (ENG.DBGM) ENG.DBGM.push([ci, si, t, d.toFixed(1), wl.toFixed(1), w2.toFixed(1), kk.toFixed(2), f.toFixed(2)].join(' '));
        });
        if (!any) return;
        DF[ci][si] = (function (F, ts, sc) { return function (t) {
          var k = 0; while (k < ts.length - 2 && t > ts[k + 1]) k++;
          var u = Math.max(0, Math.min(1, (t - ts[k]) / (ts[k + 1] - ts[k]))), f = sc[k] + (sc[k + 1] - sc[k]) * u, d = F(t);
          return d > 0 ? d * f : d; }; })(F0, ts, sc);
      });
    });
  }
  var out = A.SEG.map(function (segs, ci) {
    var n = segs.length, disp = [], dAt = [], i;
    for (i = 0; i < n; i++) {
      var Pv = segs[(i - 1 + n) % n], Nx = segs[i], d1 = DF[ci][(i - 1 + n) % n](1), d2 = DF[ci][i](0);
      var n1 = Pv.n1, n2 = Nx.n0, corner = (Pv.t1[0] * Nx.t0[0] + Pv.t1[1] * Nx.t0[1]) < 0.985, v, dd, nn;
      if (corner) {
        var det = n1[0] * n2[1] - n1[1] * n2[0];
        if (Math.abs(det) > 0.15) {
          v = [(d1 * n2[1] - n1[1] * d2) / det, (n1[0] * d2 - d1 * n2[0]) / det];
          var lim = (p.ml === undefined ? (d1 > 0 && d2 > 0 ? ENG.MLT : 2) : p.ml) * Math.max(Math.abs(d1), Math.abs(d2)) + 0.5, l = hyp(v[0], v[1]); if (l > lim) v = [v[0] / l * lim, v[1] / l * lim];
        } else { dd = (d1 + d2) / 2; nn = nrm([n1[0] + n2[0], n1[1] + n2[1]]); v = [nn[0] * dd, nn[1] * dd]; }
      } else {
        // なめらかにつながる直線と曲線：直線の量に合わせる（平均すると直線が傾く）
        dd = (Pv.g.line && !Nx.g.line) ? d1 : (!Pv.g.line && Nx.g.line) ? d2 : (d1 + d2) / 2;
        nn = nrm([n1[0] + n2[0], n1[1] + n2[1]]); v = [nn[0] * dd, nn[1] * dd];
      }
      // 細くするとき、角（とくに切れ込み）がインクの奥へ入りすぎて反対側の輪郭を越えないように、
      // その向きに残っているインクの深さから、目標の太さぶんを残した所までに抑える
      if (corner && d1 > 0 && d2 > 0) {
        var vl = hyp(v[0], v[1]);
        if (vl > Math.max(d1, d2) * 1.05) {
          var ux = v[0] / vl, uy = v[1] / vl, ax0 = Nx.g.a[0] + ux * 0.75, ay0 = Nx.g.a[1] + uy * 0.75;
          var avail = rayExit(A.flat, A.edges, ax0, ay0, ux, uy) + 0.75, keep = Math.min(M.Vt, M.Ht);
          // 向かいの辺も同じくらい寄ってくるので、その分も残す（え の切れ込みが斜めの画を突き抜けないように）
          var cap = Math.max(Math.max(d1, d2), avail - keep);
          // 向かいの辺も同じくらい寄ってくるので、その分も残す：向かい合う辺までの距離で測る（え の切れ込みが斜めの画を突き抜けないように）
          // 切れ込み（輪郭が外側へ折れる角）だけ。線端などの出っ張った角は向かいの辺が画の反対側なので対象外
          if (ENG.CORNOPP && A.vedges && Pv.t1[0] * Nx.t0[1] - Pv.t1[1] * Nx.t0[0] < 0) {
            var dm0 = Math.max(d1, d2), okL = function (L) {
              var hit = {}, dd0 = distOppE(A.vedges, Nx.g.a[0] + ux * L, Nx.g.a[1] + uy * L, ux, uy, -0.25, hit), e0 = hit.e, fo = e0 ? DF[e0[6]][e0[7]] : null;
              var dOpp = fo ? Math.max(0, fo(e0[8])) : dm0;            // 向かいの辺が実際に寄る量
              return dd0 - dOpp >= ENG.CORNK * keep; };
            if (!okL(Math.min(vl, cap))) {
              var lo2 = dm0, hi2 = Math.min(vl, cap);
              if (!okL(lo2)) hi2 = lo2; else for (var it2 = 0; it2 < 10; it2++) { var md2 = (lo2 + hi2) / 2; if (okL(md2)) lo2 = md2; else hi2 = md2; }
              cap = Math.min(cap, Math.max(dm0, lo2));
            }
          }
          if (avail < 1100 && vl > cap) v = [ux * cap, uy * cap];
          if (ENG.DBGC) ENG.DBGC.push('avail ' + i + ' ' + avail.toFixed(1) + ' cap ' + cap.toFixed(1) + ' vl ' + vl.toFixed(1));
        }
      }
      if (ENG.DBGC) ENG.DBGC.push([ci, i, corner, d1.toFixed(1), d2.toFixed(1), n1.map(function(x){return x.toFixed(2);})+'', n2.map(function(x){return x.toFixed(2);})+'', v.map(function(x){return x.toFixed(1);})+''].join(' '));
      disp.push([Nx.g.a[0] + v[0], Nx.g.a[1] + v[1]]);
      dAt.push(corner ? null : dd);
    }
    // ごく短い直線（尖った角の先の小さな平ら：A のふところの頂点、B の切れ込みなど）は角の一部とみなし、
    // 前後の辺をずらした線の交点に畳む（平らな辺のままだと、その辺の量しか動けず角が尖れない）
    var movedEnd = [], movedStart = [];
    if (ENG.TINYCORNER) for (i = 0; i < n; i++) {
      var Sg = segs[i], gg = Sg.g; if (!gg.line) continue;
      var lenT = hyp(gg.b[0] - gg.a[0], gg.b[1] - gg.a[1]); if (lenT > 0.12 * ST.V || lenT < 1e-6) continue;
      var ip = (i - 1 + n) % n, inx = (i + 1) % n, Sp = segs[ip], Sn = segs[inx];
      var lp = hyp(Sp.g.b[0] - Sp.g.a[0], Sp.g.b[1] - Sp.g.a[1]), ln = hyp(Sn.g.b[0] - Sn.g.a[0], Sn.g.b[1] - Sn.g.a[1]);
      if (lp < 3 * lenT || ln < 3 * lenT) continue;
      if (Sp.t1[0] * Sn.t0[0] + Sp.t1[1] * Sn.t0[1] > 0.5) continue;            // 60° より緩い折れは角として畳まない
      var dp = DF[ci][ip](1), dn = DF[ci][inx](0);
      var P1 = [Sp.g.b[0] + Sp.n1[0] * dp, Sp.g.b[1] + Sp.n1[1] * dp], P2 = [Sn.g.a[0] + Sn.n0[0] * dn, Sn.g.a[1] + Sn.n0[1] * dn];
      // 前後の辺をずらした線（曲線ならその形のまま）どうしの交点。見つからなければ畳まない
      var offPoly = function (S2, F2, rev) {
        var pts = [];
        for (var q = 0; q <= 16; q++) { var tt = rev ? 1 - q / 16 : q / 16, P = bez(S2.g, tt), T = segTan(S2.g, tt), dq = F2(tt); pts.push([P[0] - T[1] * dq, P[1] + T[0] * dq]); }
        return pts;
      };
      var PA = offPoly(Sp, DF[ci][ip], true), PB = offPoly(Sn, DF[ci][inx], false), Xc = null;
      for (var qa = 0; qa < PA.length - 1 && !Xc; qa++) for (var qb = 0; qb < PB.length - 1 && !Xc; qb++) {
        var a1 = PA[qa], a2_ = PA[qa + 1], b1 = PB[qb], b2_ = PB[qb + 1];
        var rx = a2_[0] - a1[0], ry = a2_[1] - a1[1], sx2 = b2_[0] - b1[0], sy2 = b2_[1] - b1[1], dn2 = rx * sy2 - ry * sx2;
        if (Math.abs(dn2) < 1e-9) continue;
        var ua = ((b1[0] - a1[0]) * sy2 - (b1[1] - a1[1]) * sx2) / dn2, ub = ((b1[0] - a1[0]) * ry - (b1[1] - a1[1]) * rx) / dn2;
        if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) Xc = [a1[0] + rx * ua, a1[1] + ry * ua];
      }
      if (ENG.DBG2) ENG.DBG2.push({ at: gg.a, poly: !!Xc });
      if (!Xc) Xc = lineX(P1, Sp.t1, P2, Sn.t0);
      if (!Xc) continue;
      var mid0 = [(gg.a[0] + gg.b[0]) / 2, (gg.a[1] + gg.b[1]) / 2], mv = [Xc[0] - mid0[0], Xc[1] - mid0[1]], ml0 = hyp(mv[0], mv[1]);
      var dmax = Math.max(Math.abs(dp), Math.abs(dn)); if (ml0 < 1e-6) continue;
      // 動く先が、ほかの輪郭（ふところなど）に近づきすぎない所までに抑える：元の輪郭からの距離が「ずらす量＋目標の太さ」を下回ったら止める
      var cap0 = ENG.TCLIM * dmax + 1;
      if (dp > 0 && dn > 0) {
        var ux0 = mv[0] / ml0, uy0 = mv[1] / ml0, need = dmax + Math.min(M.Vt, M.Ht), stepL = Math.max(1, ml0 / 40), Lok = 0;
        for (var Lm = stepL; Lm <= Math.min(ml0, cap0); Lm += stepL) {
          var qx = mid0[0] + ux0 * Lm, qy = mid0[1] + uy0 * Lm;
          if (windingAt(A.flat, qx, qy) === 0) break;
          if (Lm > need && distToEdges(A.edges, qx, qy) < need) break;
          Lok = Lm;
        }
        cap0 = Math.max(Math.min(dp, dn), Lok);
      }
      if (ml0 > cap0) Xc = [mid0[0] + mv[0] / ml0 * cap0, mid0[1] + mv[1] / ml0 * cap0];
      disp[i] = Xc; disp[inx] = Xc; movedEnd[ip] = true; movedStart[inx] = true;
    }
    // 曲がり角の面取り（え の右上など）：前後の画の側面をずらした線どうしの交点に、間の点をすべて畳む（残すと細いひげになる）
    if (ENG.TURNFOLD) for (i = 0; i < n; i++) {
      var Sf = segs[i]; if (!Sf.g.line || !(Sf.turnCut || Sf.longRay) || Sf.hidden) continue;
      var jf, ipf = -1, inf = -1;
      for (jf = 1; jf < n; jf++) { var af = segs[(i - jf + n) % n]; if (!af.tiny && !af.isCap && !af.hidden) { ipf = (i - jf + n) % n; break; } }
      for (jf = 1; jf < n; jf++) { var bf = segs[(i + jf) % n]; if (!bf.tiny && !bf.isCap && !bf.hidden) { inf = (i + jf) % n; break; } }
      if (ipf < 0 || inf < 0 || ipf === inf) continue;
      var Pf = segs[ipf], Nf = segs[inf], dPf = DF[ci][ipf](1), dNf = DF[ci][inf](0);
      if (!(dPf > 0 && dNf > 0)) continue;
      var Xf = lineX([Pf.g.b[0] + Pf.n1[0] * dPf, Pf.g.b[1] + Pf.n1[1] * dPf], Pf.t1, [Nf.g.a[0] + Nf.n0[0] * dNf, Nf.g.a[1] + Nf.n0[1] * dNf], Nf.t0);
      if (!Xf || windingAt(A.flat, Xf[0], Xf[1]) === 0) continue;
      // 鋭く折り返す角（前後の側面がほぼ逆向き）で、面取りの辺をずらすと交点より奥へ入りすぎる（ひげになる）ときだけ
      if (Pf.t1[0] * Nf.t0[0] + Pf.t1[1] * Nf.t0[1] > -0.3) continue;
      var dcur = DF[ci][i] ? DF[ci][i](0.5) : 0, d0f = (Xf[0] - Sf.g.a[0]) * Sf.n0[0] + (Xf[1] - Sf.g.a[1]) * Sf.n0[1];
      if (ENG.DBGC) ENG.DBGC.push('foldchk ' + i + ' d0 ' + d0f.toFixed(1) + ' cur ' + dcur.toFixed(1));
      if (!(d0f < dcur)) continue;
      var mf = [(Sf.g.a[0] + Sf.g.b[0]) / 2, (Sf.g.a[1] + Sf.g.b[1]) / 2]; if (hyp(Xf[0] - mf[0], Xf[1] - mf[1]) > 3 * ST.V) continue;
      for (var kf = (ipf + 1) % n; ; kf = (kf + 1) % n) { disp[kf] = Xf; if (kf === inf) break; }
      movedEnd[ipf] = true; movedStart[inf] = true;
      if (ENG.DBGC) ENG.DBGC.push('fold ' + i + ' ' + ipf + '..' + inf + ' X ' + Xf.map(Math.round));
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
      var near = function (u, v) { return u[0] * v[0] + u[1] * v[1] > Math.cos(ENG.FREEDEG * Math.PI / 180); };
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
      if (S.g.line) { res.push({ a: a2, c1: a2, c2: b2, b: b2, line: true, cap: !!S.isCap, src: i2 }); return; }
      var G = Gs[i2];
      var tA = TA[i2] || null, tB = TB[i2] || null;
      // 角を畳んで端点が大きく動いた曲線は、端の向きを「ずらした曲線の途中から新しい端点へ」の向きにする
      if (movedEnd[i2]) { var Pq = bez(S.g, 0.7), Tq = segTan(S.g, 0.7), dq = G(0.7), qq = [Pq[0] - Tq[1] * dq, Pq[1] + Tq[0] * dq], te0 = endTan(S.g), tn = nrm([b2[0] - qq[0], b2[1] - qq[1]]); tB = nrm([te0[0] + tn[0], te0[1] + tn[1]]); }
      if (movedStart[i2]) { var Pq2 = bez(S.g, 0.3), Tq2 = segTan(S.g, 0.3), dq2 = G(0.3), qq2 = [Pq2[0] - Tq2[1] * dq2, Pq2[1] + Tq2[0] * dq2], ts0 = startTan(S.g), tn2 = nrm([qq2[0] - a2[0], qq2[1] - a2[1]]); tA = nrm([ts0[0] + tn2[0], ts0[1] + tn2[1]]); }
      var parts = []; offsetCurve(S.g, a2, b2, G, p.compat ? -1 : p.prec, 0, parts, tA, tB);
      parts.forEach(function (q) { q.src = i2; res.push(q); });
    });
    terminals(res, p, M);
    return res.map(function (g) { var a = post(g.a, ci), b = post(g.b, ci); return { a: a, c1: g.line ? a : post(g.c1, ci), c2: g.line ? b : post(g.c2, ci), b: b, line: g.line, src: g.src }; });
  });
  // 学習した字幅の変化：太るほど字面を左右に広げる（欧文は縦画の太さの変化 × 0.67、和文 × 0.43。字面の中心を基準に）
  if (mlOn(p) && ENG.MLKBW && WCTL_MODEL.kind === 'edge' && WCTL_MODEL.kbw) {
    var lo = 1e9, hi = -1e9;
    A.flat.forEach(function (P) { P.forEach(function (q) { if (q[0] < lo) lo = q[0]; if (q[0] > hi) hi = q[0]; }); });
    var bw = hi - lo, kb = M.jp ? WCTL_MODEL.kbw.jp : WCTL_MODEL.kbw.latin;
    if (bw > 1) {
      var cx = (lo + hi) / 2, f = 1 + p.learn * kb * (M.Vt - M.stdV) / bw;
      var X = function (q) { return [cx + (q[0] - cx) * f, q[1]]; };
      out = out.map(function (res) { return res.map(function (g) { return { a: X(g.a), c1: X(g.c1), c2: X(g.c2), b: X(g.b), line: g.line, src: g.src }; }); });
    }
  }
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
  var pts = pi.pathPoints;
  // 点の数が同じなら作り直さず上書きする（Illustrator の操作回数を減らす）
  if (pts.length !== n) { for (i = 0; i < n; i++) anchors.push(T.inv(segs[i].a)); pi.setEntirePath(anchors); pts = pi.pathPoints; }
  for (i = 0; i < n; i++) {
    var g = segs[i], gp = segs[(i - 1 + n) % n], q = pts[i];
    var tin = nrm([g.a[0] - (gp.line ? gp.a : gp.c2)[0], g.a[1] - (gp.line ? gp.a : gp.c2)[1]]);
    var tout = nrm([(g.line ? g.b : g.c1)[0] - g.a[0], (g.line ? g.b : g.c1)[1] - g.a[1]]);
    // 点の種類を先に決めてからハンドルを置く（後から種類を変えると Illustrator がハンドルを動かすことがある）
    q.pointType = (keepTypes && keepTypes.length === n) ? keepTypes[i] : ((!g.line && !gp.line && (tin[0] * tout[0] + tin[1] * tout[1]) > 0.999) ? PointType.SMOOTH : PointType.CORNER);
    q.anchor = T.inv(g.a);
    q.rightDirection = T.inv(g.line ? g.a : g.c1);
    q.leftDirection = T.inv(gp.line ? g.a : gp.c2);
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
  // グループにしていないパスは、離れた塊ごとに別の字として扱う（隣の字の画を「すぐ隣の画」と見なさないように）
  if (loose.length) {
    var bb = loose.map(function (e) { return boundsOf([e]); });
    var hs = bb.map(function (b) { return b.t - b.b; }).sort(function (a, b) { return a - b; }), gapTol = 0.05 * hs[hs.length - 1];
    var par = loose.map(function (e, k) { return k; });
    var find = function (k) { while (par[k] !== k) { par[k] = par[par[k]]; k = par[k]; } return k; };
    for (var a = 0; a < loose.length; a++) for (var b = a + 1; b < loose.length; b++) {
      var A = bb[a], B = bb[b];
      if (A.l - gapTol <= B.r && B.l - gapTol <= A.r && A.b - gapTol <= B.t && B.b - gapTol <= A.t) par[find(a)] = find(b);
    }
    var clusters = {}, order = [];
    loose.forEach(function (e, k) { var r = find(k); if (!clusters[r]) { clusters[r] = []; order.push(r); } clusters[r].push(e); });
    order.sort(function (p, q) { return boundsOf(clusters[p]).l - boundsOf(clusters[q]).l; });
    order.forEach(function (r, k) { glyphs.push({ name: order.length > 1 ? '選択パス ' + (k + 1) : '選択パス', entries: clusters[r] }); });
  }
  glyphs.forEach(function (G) { G.bounds = boundsOf(G.entries); });
  return glyphs;
}
function detectMetrics(glyphs) {
  var tops = glyphs.map(function (G) { return G.bounds.t; }), bots = glyphs.map(function (G) { return G.bounds.b; });
  var h = median(glyphs.map(function (G) { return G.bounds.t - G.bounds.b; })) || 1;
  return { base: modeValue(bots, h * 0.01), top: modeValue(tops, h * 0.01) };
}
// 書体ごとの「外側へ太る割合」の既定値（Noto Sans JP の Regular → Bold / Black に合わせた値）
var SCRIPT_KEYS = ['latin', 'kana', 'symj', 'syml'], SCRIPT_NAMES = ['欧文', 'かな（ひらがな・カタカナ）', '和文記号', '欧文記号'];
var SCRIPT_OUT = { latin: [50, 10], kana: [50, 50], symj: [30, 30], syml: [50, 50] };
// simp：区間の整理（fine のときだけ。細かく割られた輪郭を少ない区間に引き直してから測る）
function analyzeJob(glyphs, met, script, compat, fine, simp) {
  var H = met.top - met.base; if (H <= 0) throw new Error('メトリクスの上端がベースラインより下になっています。');
  var s = 700 / H;
  // かな・和文記号は字面（全角の枠）、欧文・欧文記号はベースラインと大文字の高さを基準にする
  var em = script === 'kana' || script === 'symj';
  var m = em ? { ft: 700, fb: 0, mid: 350, band: 50, spanK: 4 } : { ft: 700, fb: 0, mid: 350, band: 4, spanK: 2 };
  var widths = [];
  glyphs.forEach(function (G) {
    var ox = (G.bounds.l + G.bounds.r) / 2;
    G.T = {
      fwd: function (pt) { return [(pt[0] - ox) * s, (pt[1] - met.base) * s]; },
      inv: function (pt) { return [pt[0] / s + ox, pt[1] / s + met.base]; }
    };
    G.snaps = []; G.rev = []; G.dup = [];
    var contours = [], owners = [];
    G.entries.forEach(function (e) {
      // 長さ 0 の区間（同じ位置に重なったアンカー。文字のアウトライン化でよくできる）は外して計算し、書き戻すときに戻す
      var dupList = [];
      var segsList = e.paths.map(function (pi) {
        var raw = pathToSegs(pi, G.T), keep = [], dup = [];
        raw.forEach(function (g) {
          var z = hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) < ENG.DUPTOL && (g.line || (hyp(g.c1[0] - g.a[0], g.c1[1] - g.a[1]) < ENG.DUPTOL && hyp(g.c2[0] - g.b[0], g.c2[1] - g.b[1]) < ENG.DUPTOL));
          dup.push(z); if (!z) keep.push(g);
        });
        if (keep.length < 2) { keep = raw; dup = raw.map(function () { return false; }); }
        dupList.push(dup); return keep;
      });
      // 向きを揃える：単独パスは反時計回り。複合パスは Illustrator の塗りの規則に合わせる
      //   ノンゼロ（既定）：パス同士の向きの関係をそのまま使い、全体の向きだけ揃える（重なった棒は足し算、逆向きは穴）
      //   偶奇：入れ子の深さで外形／穴を判定
      var polys = segsList.map(function (sg) { return flattenSegs(sg, 8); });
      var evenodd = false, flipAll = false;
      if (e.compound) {
        try { evenodd = !!e.paths[0].evenodd; } catch (er) { evenodd = false; }
        if (!evenodd) { var big = 0, ba = 0; polys.forEach(function (P, j) { var ar = Math.abs(polyArea(P)); if (ar > ba) { ba = ar; big = j; } }); flipAll = polyArea(polys[big]) < 0; }
      }
      segsList.forEach(function (sg, k) {
        var depth = 0, isPos = polyArea(polys[k]) >= 0, wantPos;
        if (e.compound && evenodd) {
          var pt = polys[k][0];
          polys.forEach(function (P, j) { if (j !== k && windingAt([P], pt[0], pt[1]) !== 0) depth++; });
          wantPos = depth % 2 === 0;
        } else if (e.compound) wantPos = flipAll ? !isPos : isPos;
        else wantPos = true;
        var segs = (wantPos === isPos) ? sg : reverseC(sg);
        contours.push(segs); owners.push(e.paths[k]); G.rev.push(wantPos !== isPos); G.dup.push(dupList[k]);
        G.snaps.push({ path: e.paths[k], snap: snapshotPath(e.paths[k]) });
      });
    });
    G.owners = owners;
    G.A = analyzeGlyph(contours, m, { compat: compat, fine: !!(compat && fine), simp: !!(compat && fine && simp) });
    widths = widths.concat(glyphVerticalWidths(G.A));
  });
  var Wm = median(widths) || 90;
  glyphs.forEach(function (G) { finishGlyph(G.A, Wm); });
  var ST = computeStems(glyphs.map(function (G) { return G.A; }), Wm); ST.jp = em;
  return { glyphs: glyphs, ST: ST, scale: s, Wm: Wm, compat: compat, fine: !!(compat && fine), simp: !!(compat && fine && simp) };
}
function applyJob(job, p) {
  var added = 0, total = 0;
  job.glyphs.forEach(function (G) {
    var out = deformGlyph(G.A, job.ST, p);
    out.forEach(function (segs, k) {
      if (job.compat) {
        // 互換モード：元のパスと同じ向き・始点・点の種類で書き戻す（元のパスや他のウェイトと補間できる）
        var w = G.rev[k] ? reverseC(segs) : segs;
        if (job.fine) writeSegs(G.owners[k], w, G.T);          // 点が増えるので種類は形から決める（向き・始点は元のまま）
        else { w = reinsertDup(w, G.dup[k]); writeSegs(G.owners[k], w, G.T, G.snaps[k].snap.map(function (o) { return o.t; })); }
        total += w.length;
      } else { writeSegs(G.owners[k], segs, G.T); total += segs.length; }
    });
    G.A.C.forEach(function (segs) { added -= segs.length; });
  });
  return total;
}
// 外しておいた長さ 0 の区間を元の位置に戻す（頂点数と並びを元のパスと同じにする）
function reinsertDup(segs, dup) {
  if (!dup || dup.length === segs.length) return segs;
  var out = [], c = 0;
  for (var i = 0; i < dup.length; i++) {
    if (dup[i]) { var P = (c < segs.length ? segs[c] : segs[0]).a; out.push({ a: P, c1: P, c2: P, b: P, line: true }); }
    else out.push(segs[c++]);
  }
  return out;
}
function restoreJob(job) { job.glyphs.forEach(function (G) { G.snaps.forEach(function (o) { restorePath(o.path, o.snap); }); }); }

/* ====================================================================== */
/* 書類側の処理（BridgeTalk で Illustrator 本体に送って実行する）            */
/*   元の字には印「src」、プレビューの字には印「prev」を付けて書類に持たせる   */
/*   プレビュー＝元を隠して複製を変形。確定＝元を削除。取り消し＝複製を消して元を表示 */
/* ====================================================================== */
var WCTL_TAG = 'whgtctl';
function wctlTagOf(it) { try { for (var i = 0; i < it.tags.length; i++) if (it.tags[i].name === WCTL_TAG) return it.tags[i]; } catch (e) {} return null; }
function wctlSetTag(it, v) { var t = wctlTagOf(it); if (!t) { t = it.tags.add(); t.name = WCTL_TAG; } t.value = v; }
function wctlClearTag(it) { var t = wctlTagOf(it); if (t) t.remove(); }
function wctlKind(t) { return t ? String(t.value).split('#')[0] : ''; }
function wctlId(t) { return t ? String(t.value).split('#')[1] || '' : ''; }
function wctlFind(doc, v) {
  var out = [], items = doc.pageItems;
  for (var i = 0; i < items.length; i++) { var t = wctlTagOf(items[i]); if (t && wctlKind(t) === v) out.push(items[i]); }
  return out;
}
function wctlSelect(doc, items) { try { doc.selection = null; } catch (e) {} items.forEach(function (it) { try { it.selected = true; } catch (e) {} }); }
function wctlCancel(doc) {
  var prev = wctlFind(doc, 'prev'), src = wctlFind(doc, 'src');
  for (var i = prev.length - 1; i >= 0; i--) prev[i].remove();
  src.forEach(function (it) { it.hidden = false; wctlClearTag(it); });
  return src;
}
function wctlInfo(job, n) {
  var u2pt = 1 / job.scale;
  return { ok: true, glyphs: job.glyphs.length, base: job.met.base, top: job.met.top, V: job.ST.V * u2pt, H: job.ST.H * u2pt, ratio: job.ST.ratio, anchors: n || 0, compat: job.compat };
}
// 書類側の状態（元の字・プレビューの複製・解析結果）を Illustrator 側に保持する
function wctlAlive(st) { try { for (var i = 0; i < st.dups.length; i++) { var x = st.dups[i].typename; } for (var j = 0; j < st.src.length; j++) { var y = st.src[j].typename; } return st.dups.length > 0; } catch (e) { return false; } }
function wctlKey(a, st) {
  var base = (a.base === undefined || isNaN(a.base)) ? (st && st.met ? st.met.base : NaN) : a.base, top = (a.base === undefined || isNaN(a.base)) ? (st && st.met ? st.met.top : NaN) : a.top;
  return [a.script || 'latin', Number(base).toFixed(2), Number(top).toFixed(2), a.p && a.p.compat === false ? 0 : 1, a.p && a.p.fine ? 1 : 0, a.p && a.p.simp ? 1 : 0].join('|');
}
function wctlAnalyze(st, a) {
  if (st.job) restoreJob(st.job);                                       // 複製を元の形に戻してから解析し直す
  var g2 = buildJob(st.dups), met = (a.base === undefined || isNaN(a.base)) ? (st.met || detectMetrics(g2)) : { base: a.base, top: a.top };
  st.met = met;
  st.job = analyzeJob(g2, met, a.script || 'latin', !(a.p && a.p.compat === false), !!(a.p && a.p.fine), !!(a.p && a.p.simp)); st.job.met = met;
  st.key = wctlKey(a, st);
}
// パネルを開き直した後など、Illustrator 側に状態がないときは書類の印から組み立て直す
function wctlRebuild(doc) {
  var src = wctlFind(doc, 'src'); if (!src.length) return null;
  var old = wctlFind(doc, 'prev'); for (var k = old.length - 1; k >= 0; k--) old[k].remove();
  var st = { src: src, dups: [], job: null, key: '' };
  src.forEach(function (it) { it.hidden = false; var d = it.duplicate(it, ElementPlacement.PLACEBEFORE); wctlSetTag(d, 'prev#' + wctlId(wctlTagOf(it))); d.hidden = true; st.dups.push(d); it.hidden = true; });
  $.global.WCTL_STATE = st; return st;
}
function wctlDo(cmd, a) {
  try {
    if (app.documents.length === 0) return ({ ok: false, msg: 'ドキュメントが開かれていません' }).toSource();
    var doc = app.activeDocument, r;
    var st = $.global.WCTL_STATE || null;
    if (st && !wctlAlive(st)) st = $.global.WCTL_STATE = null;
    if (cmd === 'load') {
      var sel = [], s0 = doc.selection || [], srcAll = wctlFind(doc, 'src');
      for (var i = 0; i < s0.length; i++) {
        var t = wctlTagOf(s0[i]);
        if (t && wctlKind(t) === 'prev') {
          // プレビューの字を選んだときは、その元の字を読み込み直す
          var id = wctlId(t);
          srcAll.forEach(function (it) { if (wctlId(wctlTagOf(it)) === id && sel.indexOf(it) < 0) sel.push(it); });
        } else sel.push(s0[i]);
      }
      // 前回のプレビューが確定されていなければ元に戻す（選んだのが前回の元の字でも、その字は残る）
      var restored = wctlCancel(doc); $.global.WCTL_STATE = null;
      if (!sel.length) { r = { ok: false, msg: '文字（グループ）を選択してから「選択を読み込む」を押してください' }; if (restored.length) r.msg = '確定していないプレビューを元に戻しました。' + r.msg; return r.toSource(); }
      var glyphs = buildJob(sel);
      if (!glyphs.length) return ({ ok: false, msg: '塗りのある閉じたパスが見つかりませんでした' }).toSource();
      var seq = new Date().getTime();
      sel.forEach(function (it, k) { wctlSetTag(it, 'src#' + seq + '_' + k); });
      // プレビュー用の複製を作り、解析は読み込み時に1回だけ（以後のプレビューは変形の書き込みだけ）
      st = { src: sel, dups: [], job: null, key: '' };
      sel.forEach(function (it) { var d = it.duplicate(it, ElementPlacement.PLACEBEFORE); wctlSetTag(d, 'prev#' + wctlId(wctlTagOf(it))); d.hidden = true; st.dups.push(d); });
      $.global.WCTL_STATE = st;
      wctlAnalyze(st, a);
      wctlSelect(doc, sel);
      r = wctlInfo(st.job); r.restored = restored.length; return r.toSource();
    }
    if (cmd === 'preview' || cmd === 'commit') {
      if (!st) st = wctlRebuild(doc);
      if (!st) return ({ ok: false, msg: '読み込んだ文字がありません。文字を選択して「選択を読み込む」を押してください' }).toSource();
      if (st.key !== wctlKey(a, st)) wctlAnalyze(st, a);                 // 書体・メトリクス・頂点数の設定が変わったときだけ解析し直す
      st.dups.forEach(function (d) { d.hidden = false; }); st.src.forEach(function (it) { it.hidden = true; });
      var n = applyJob(st.job, a.p);
      r = wctlInfo(st.job, n);
      var dups = st.dups;
      if (cmd === 'commit') {
        for (var j = st.src.length - 1; j >= 0; j--) st.src[j].remove();
        dups.forEach(function (d) { wctlClearTag(d); });
        r.committed = dups.length; $.global.WCTL_STATE = null;
      }
      wctlSelect(doc, dups);                                              // 読み込んだ字（プレビュー）を選択したままにする
      app.redraw();
      return r.toSource();
    }
    if (cmd === 'unpreview') {
      // プレビューを隠して元を表示する（読み込みと解析は保ったまま）
      if (!st) st = wctlRebuild(doc);
      if (st) { st.dups.forEach(function (d) { d.hidden = true; }); st.src.forEach(function (it) { it.hidden = false; }); wctlSelect(doc, st.src); }
      app.redraw(); return ({ ok: true }).toSource();
    }
    if (cmd === 'cancel') { var rs = wctlCancel(doc); $.global.WCTL_STATE = null; wctlSelect(doc, rs); app.redraw(); return ({ ok: true, restored: rs.length }).toSource(); }
    return ({ ok: false, msg: '不明な命令 ' + cmd }).toSource();
  } catch (e) {
    return ({ ok: false, msg: 'エラー: ' + e.message + (e.line ? '（行 ' + e.line + '）' : '') }).toSource();
  }
}

/* ====================================================================== */
/* パレット（開いたまま書類を操作できる）                                     */
/* ====================================================================== */
function wctlPalette() {
  if ($.global.wctlWin) { try { $.global.wctlWin.show(); return; } catch (e) {} }
  var SRC = '';
  (function () {
    var f = File($.fileName); f.encoding = 'UTF-8';
    if (f.open('r')) { SRC = f.read(); f.close(); }
    // 前処理の指定（#target など）を外し、パレットを開かない印を付けて本体に送る
    SRC = 'var WCTL_NOUI = true;\n' + SRC.replace(/^﻿/, '').replace(/^#target.*$/mg, '');
  })();

  var P = { W: 100, learn: 0, uni: 0, tol: 30, ratio: 94, dg: 0, mg: 35, cp: 0, ext: 50, ox: 50, oy: 10, os: 0, oc: 0, prec: 2, flare: 0, flen: 250, tround: 0, tang: 0 };
  var DEF = {}; for (var k in P) DEF[k] = P[k];
  var loaded = false, busy = false, pending = null, nUpd = 0, t0 = 0, fullNext = false, lastWasFull = false, alwaysFull = false;
  var VER = 'v0.19-' + SRC.length;

  var win = new Window('palette', '光学補正 / ウェイト調整', undefined, { resizeable: false });
  $.global.wctlWin = win;
  win.orientation = 'column'; win.alignChildren = 'fill';

  var topRow = win.add('group'); topRow.orientation = 'row';
  var bLoad = topRow.add('button', undefined, '選択を読み込む');
  var info = topRow.add('statictext', undefined, '文字（グループ）を選択して「選択を読み込む」', { multiline: true }); info.preferredSize = [330, 34];
  var status = win.add('statictext', undefined, ''); status.preferredSize = [440, 18];

  function safe(fn) { return function () { try { fn.apply(this, arguments); } catch (e) { busy = false; status.text = 'エラー: ' + e.message + (e.line ? '（行 ' + e.line + '）' : ''); } }; }
  function now() { return new Date().getTime(); }

  var mp = win.add('panel', undefined, 'メトリクス（ドキュメント座標・pt）'); mp.orientation = 'row'; mp.alignChildren = 'center';
  mp.add('statictext', undefined, '書体');
  var dd = mp.add('dropdownlist', undefined, SCRIPT_NAMES); dd.selection = 0;
  mp.add('statictext', undefined, 'ベースライン');
  var eBase = mp.add('edittext', undefined, ''); eBase.characters = 8;
  mp.add('statictext', undefined, '上端');
  var eTop = mp.add('edittext', undefined, ''); eTop.characters = 8;
  var cbLock = win.add('checkbox', undefined, 'ベースラインと上端に乗る水平の辺を動かさない'); cbLock.value = false;

  var sliders = {};
  function addSlider(panel, key, label, min, max, unit) {
    var g = panel.add('group'); g.orientation = 'row'; g.alignChildren = 'center';
    var st = g.add('statictext', undefined, label); st.preferredSize = [200, 20];
    var sl = g.add('slider', undefined, P[key], min, max); sl.preferredSize = [160, 20];
    var et = g.add('edittext', undefined, String(P[key])); et.characters = 5;
    g.add('statictext', undefined, unit);
    sl.onChanging = safe(function () { var v = Math.round(sl.value); if (v === P[key]) return; P[key] = v; et.text = String(v); preview(); });
    sl.onChange = safe(function () { P[key] = Math.round(sl.value); et.text = String(P[key]); preview(); });
    et.onChange = safe(function () { var v = parseFloat(et.text); if (isNaN(v)) v = P[key]; v = Math.max(min, Math.min(max, v)); P[key] = v; sl.value = v; et.text = String(v); preview(); });
    sliders[key] = { sl: sl, et: et };
  }
  var pw = win.add('panel', undefined, 'ウェイト'); pw.alignChildren = 'fill';
  var wb = pw.add('group'); wb.orientation = 'row';
  [['Thin', 45], ['Light', 70], ['Regular', 100], ['Bold', 135], ['Black', 170]].forEach(function (pr) { var b = wb.add('button', undefined, pr[0]); b.preferredSize = [76, 24]; b.onClick = safe(function () { setVal('W', pr[1]); preview(); }); });
  addSlider(pw, 'W', '縦画の太さ（元の StdVW 比）', 10, 200, '%');
  addSlider(pw, 'mg', 'カウンター保護（最小の空き）', 0, 80, '%');
  addSlider(pw, 'cp', 'カウンター保持（字幅で吸収）', 0, 100, '%');
  addSlider(pw, 'ext', '線端の伸び（太った量に対して）', 0, 100, '%');
  addSlider(pw, 'learn', '学習モデル（16 書体から学んだ太り方）', 0, 100, '%');
  addSlider(pw, 'ox', '外側へ太る割合（左右の輪郭）', 0, 100, '%');
  addSlider(pw, 'oy', '外側へ太る割合（上下の輪郭）', 0, 100, '%');
  var pu = win.add('panel', undefined, '太さの均一化'); pu.alignChildren = 'fill';
  addSlider(pu, 'uni', '揃える強さ', 0, 100, '%');
  addSlider(pu, 'tol', '揃える範囲（基準からのずれ）', 5, 80, '%');
  var pr2 = win.add('panel', undefined, '縦横の比率'); pr2.alignChildren = 'fill';
  addSlider(pr2, 'ratio', '横画 / 縦画', 30, 130, '%');
  addSlider(pr2, 'dg', '斜画を細く', 0, 30, '%');
  var pt = win.add('panel', undefined, '線端（ターミナル）'); pt.alignChildren = 'fill';
  addSlider(pt, 'flare', 'フレア（線端の広がり・線の太さ比）', 0, 100, '%');
  addSlider(pt, 'flen', 'フレアの長さ（線の太さ比）', 50, 600, '%');
  addSlider(pt, 'tround', '線端の丸み', 0, 100, '%');
  addSlider(pt, 'tang', '線端の角度', -45, 45, '°');
  var cbSnap = pt.add('checkbox', undefined, '線端を水平・垂直に揃える'); cbSnap.value = false;
  var po = win.add('panel', undefined, '光学補正・精度（u = メトリクス高さの 1/700）'); po.alignChildren = 'fill';
  addSlider(po, 'os', 'オーバーシュート（頂点・曲線）', 0, 30, 'u');
  addSlider(po, 'oc', '光学的中心（中央の横画）', 0, 40, 'u');
  addSlider(po, 'prec', '曲線の許容誤差（互換オフ時）', 1, 8, 'u');

  var opt = win.add('group'); opt.orientation = 'row';
  var cbPrev = opt.add('checkbox', undefined, 'プレビュー'); cbPrev.value = true;
  opt.add('statictext', undefined, '頂点数');
  var ddPts = opt.add('dropdownlist', undefined, ['ウェイト間で揃える＋区間を整理', 'ウェイト間で揃える（元の区間）', '元と同じ', '揃えない（最高精度）']); ddPts.selection = 0;
  var bReset = opt.add('button', undefined, 'リセット');
  var bottom = win.add('group'); bottom.orientation = 'row'; bottom.alignment = 'right';
  var bCancel = bottom.add('button', undefined, '元に戻す');
  var bApply = bottom.add('button', undefined, '適用（確定）');
  var bClose = bottom.add('button', undefined, '閉じる');

  function setVal(key, v) { P[key] = v; if (sliders[key]) { sliders[key].sl.value = v; sliders[key].et.text = String(v); } }
  function params() {
    return { W: P.W / 100, uni: P.uni / 100, tol: P.tol / 100, ratio: P.ratio / 100, dg: P.dg / 100, mg: P.mg / 100, cp: P.cp / 100, ext: P.ext / 100, learn: P.learn / 100, outX: P.ox / 100, outY: P.oy / 100, tiny: 0.35, smooth: 5, os: P.os, oc: P.oc, prec: P.prec, compat: ddPts.selection.index !== 3, fine: ddPts.selection.index <= 1, simp: ddPts.selection.index === 0, lockM: cbLock.value,
      flare: P.flare / 100, flen: P.flen / 100, tround: P.tround / 100, tang: P.tang, tsnap: cbSnap.value };
  }
  function args() { return { script: SCRIPT_KEYS[dd.selection.index], base: parseFloat(eBase.text), top: parseFloat(eTop.text), p: params() }; }
  function setBusy(b) { busy = b; bLoad.enabled = bApply.enabled = bCancel.enabled = !b; }

  // 本体へ命令を送る。結果は onResult で受け取る（非同期）
  function send(cmd, a, done) {
    setBusy(true); t0 = now();
    var call = '"' + cmd + '", ' + a.toSource();
    // まず短い命令だけ送る。Illustrator 側にスクリプトが読み込まれていなければ（初回など）全文を送る
    var bt = new BridgeTalk(); bt.target = BridgeTalk.appSpecifier || 'illustrator';
    bt.body = fullNext ? (SRC + '\n$.global.wctlDo = wctlDo; $.global.WCTL_VER = ' + VER.toSource() + ';\nwctlDo(' + call + ');')
                       : '($.global.WCTL_VER === ' + VER.toSource() + ' && typeof $.global.wctlDo === "function") ? $.global.wctlDo(' + call + ') : "NEED_SRC";';
    var sentFull = fullNext;
    bt.onResult = function (res) {
      if (res.body === 'NEED_SRC') {
        if (lastWasFull) alwaysFull = true;                                // 全文を送っても次で消えている＝保持されない環境
        fullNext = true; lastWasFull = false; setBusy(false); send(cmd, a, done); return;
      }
      lastWasFull = sentFull; fullNext = alwaysFull;
      setBusy(false);
      var r; try { r = eval(res.body); } catch (e) { r = { ok: false, msg: '結果を読めませんでした: ' + res.body }; }
      try { done(r); } catch (e2) { status.text = 'エラー: ' + e2.message; }
      if (pending) { var p2 = pending; pending = null; p2(); }
    };
    bt.onError = function (err) { setBusy(false); status.text = '送信エラー: ' + err.body; pending = null; };
    bt.send();
  }
  function showInfo(r) {
    info.text = 'グリフ ' + r.glyphs + ' 個 ／ StdVW ' + r.V.toFixed(1) + ' pt ・ StdHW ' + r.H.toFixed(1) + ' pt（横/縦 ' + Math.round(r.ratio * 100) + '%）';
  }
  function preview() {
    if (!loaded) return;
    if (!cbPrev.value) return;
    if (busy) { pending = preview; return; }
    status.text = '更新中…';
    send('preview', args(), function (r) {
      if (!r.ok) { status.text = r.msg; return; }
      nUpd++; status.text = 'プレビュー ' + nUpd + ' 回目 ・ ' + ((now() - t0) / 1000).toFixed(1) + ' 秒 ・ 縦画 ' + P.W + '% ・ アンカー ' + r.anchors;
    });
  }

  bLoad.onClick = safe(function () {
    status.text = '読み込み中…';
    var la = args(); la.base = NaN; la.top = NaN;                          // 読み込むたびにメトリクスを測り直す
    send('load', la, function (r) {
      if (!r.ok) { loaded = false; status.text = r.msg; info.text = '文字（グループ）を選択して「選択を読み込む」'; return; }
      loaded = true; nUpd = 0;
      eBase.text = r.base.toFixed(2); eTop.text = r.top.toFixed(2);
      cbLock.value = r.glyphs >= 5;
      setVal('ratio', Math.round(r.ratio * 100)); DEF.ratio = P.ratio;
      showInfo(r);
      status.text = (r.restored ? '確定していなかったプレビューを元に戻しました ・ ' : '') + '読み込みました';
      preview();
    });
  });
  bApply.onClick = safe(function () {
    if (!loaded) { status.text = '先に文字を読み込んでください'; return; }
    status.text = '適用中…';
    send('commit', args(), function (r) {
      if (!r.ok) { status.text = r.msg; return; }
      loaded = false; nUpd = 0;
      status.text = '適用しました（' + r.committed + ' 個）。次の文字を選択して「選択を読み込む」';
      info.text = '文字（グループ）を選択して「選択を読み込む」';
    });
  });
  bCancel.onClick = safe(function () {
    send('cancel', {}, function (r) { loaded = false; status.text = r.ok ? '元に戻しました（' + r.restored + ' 個）' : r.msg; info.text = '文字（グループ）を選択して「選択を読み込む」'; });
  });
  bClose.onClick = safe(function () { win.close(); });
  win.onClose = function () {
    // 確定していないプレビューは元に戻してから閉じる
    if (loaded) { var bt = new BridgeTalk(); bt.target = BridgeTalk.appSpecifier || 'illustrator'; bt.body = SRC + '\nwctlDo("cancel", {});'; bt.send(); }
    $.global.wctlWin = null;
  };
  // 欧文は上下の輪郭を内側へ（x ハイト・キャップを保つ）、かなは内外に半分ずつ、和文記号は外形を保つ寄り
  dd.onChange = safe(function () { var o = SCRIPT_OUT[SCRIPT_KEYS[dd.selection.index]]; setVal('ox', o[0]); setVal('oy', o[1]); DEF.ox = o[0]; DEF.oy = o[1]; preview(); });
  eBase.onChange = eTop.onChange = safe(preview);
  cbPrev.onClick = safe(function () {
    if (cbPrev.value) { preview(); return; }
    if (loaded && !busy) send('unpreview', {}, function () { status.text = 'プレビュー：オフ（適用すると現在の値で変形します）'; });
  });
  ddPts.onChange = safe(preview);
  cbSnap.onClick = safe(preview);
  cbLock.onClick = safe(preview);
  bReset.onClick = safe(function () { for (var k2 in DEF) setVal(k2, DEF[k2]); preview(); });

  win.show();
}

if (typeof WCTL_NOUI === 'undefined' && typeof app !== 'undefined' && app.name && String(app.name).indexOf('Illustrator') >= 0) wctlPalette();
