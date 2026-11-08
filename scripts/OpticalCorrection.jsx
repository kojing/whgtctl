/*
  OpticalCorrection.jsx  v0.14
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
var ENG = { PAIRCAP: true, SKEL: false, SKELDOT: 0.5, GRID: true, SNAPMAX: 30, TCLIM: 2.5, RAMP: false, TINYCORNER: true, LINVAR: false, BETWEEN: true, MLT: 2, STEP: 9, FLAT: 10, SAMP: 12, BALL: false, TENS: 0.5, FREE: true, FREEDEG: 60, CSPLIT: 0 };
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
    // 精度優先の互換：元の形だけで決まる位置（極値・大きく曲がる所）に点を足す。どのウェイトでも同じ点数になる
    if (noEx && opts.fine) { var r3 = addExtrema(segs), r4 = splitByTurn(r3.segs, 80); added += r3.added + r4.added; return r4.segs; }
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
    if (S.coincide && !best) S.coincide = false;
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
function shareK(gap, gapOpp, p, nx, ny, oe, oo) {
  var ex = p.outX === undefined ? (p.out === undefined ? 0.5 : p.out) : p.outX, ey = p.outY === undefined ? ex : p.outY;
  var e = (nx === undefined) ? ex : nx * nx * ex + ny * ny * ey;
  // oe / oo：自分の側・反対側の外が開けている割合（0..1）。ないときは1本のレイの結果で決める
  var a = oe === undefined ? (gap >= 900 ? 1 : 0) : oe, b = oo === undefined ? ((gapOpp === undefined ? 1000 : gapOpp) >= 900 ? 1 : 0) : oo;
  return a * (1 - b) * 2 * e + (1 - a) * b * 2 * (1 - e) + (a * b + (1 - a) * (1 - b));
}
function dFrom(w, gap, nx, ny, k, M, p) {
  var wt = targetFor(w, nx, ny, M, p), d = k * (w - wt) / 2;
  if (d < 0 && gap < 900) { var room = Math.max(0, (gap - p.mg * M.Vt) / 2); if (-d > room) d = -room; }
  return d;
}
function constF(v) { return function () { return v; }; }
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
    return constF(d0L);
  }
  var ds = S.dsm || S.sm.map(function (s) { return { t: s.t, d: dFrom(s.wf, s.gf, s.nx, s.ny, shareK(s.gf, s.gof, p, s.nx, s.ny, s.oef, s.oof), M, p) }; });
  var part = function (lo, hi) { return median(ds.filter(function (o) { return o.t >= lo && o.t <= hi; }).map(function (o) { return o.d; })); };
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
      run.forEach(function (si) { var S = segs[si]; S.sm.forEach(function (sm) { flat.push({ S: S, t: sm.t, d: dFrom(sm.wf, sm.gf, sm.nx, sm.ny, shareK(sm.gf, sm.gof, p, sm.nx, sm.ny, sm.oef, sm.oof), M, p) }); }); });
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
          var cap = Math.max(Math.max(d1, d2), avail - keep);
          if (avail < 1100 && vl > cap) v = [ux * cap, uy * cap];
        }
      }
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
      if (S.g.line) { res.push({ a: a2, c1: a2, c2: b2, b: b2, line: true, cap: !!S.isCap }); return; }
      var G = Gs[i2];
      var tA = TA[i2] || null, tB = TB[i2] || null;
      // 角を畳んで端点が大きく動いた曲線は、端の向きを「ずらした曲線の途中から新しい端点へ」の向きにする
      if (movedEnd[i2]) { var Pq = bez(S.g, 0.7), Tq = segTan(S.g, 0.7), dq = G(0.7), qq = [Pq[0] - Tq[1] * dq, Pq[1] + Tq[0] * dq], te0 = endTan(S.g), tn = nrm([b2[0] - qq[0], b2[1] - qq[1]]); tB = nrm([te0[0] + tn[0], te0[1] + tn[1]]); }
      if (movedStart[i2]) { var Pq2 = bez(S.g, 0.3), Tq2 = segTan(S.g, 0.3), dq2 = G(0.3), qq2 = [Pq2[0] - Tq2[1] * dq2, Pq2[1] + Tq2[0] * dq2], ts0 = startTan(S.g), tn2 = nrm([qq2[0] - a2[0], qq2[1] - a2[1]]); tA = nrm([ts0[0] + tn2[0], ts0[1] + tn2[1]]); }
      var parts = []; offsetCurve(S.g, a2, b2, G, p.compat ? -1 : p.prec, 0, parts, tA, tB);
      parts.forEach(function (q) { res.push(q); });
    });
    terminals(res, p, M);
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
function analyzeJob(glyphs, met, script, compat, fine) {
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
    G.snaps = []; G.rev = []; G.dup = [];
    var contours = [], owners = [];
    G.entries.forEach(function (e) {
      // 長さ 0 の区間（同じ位置に重なったアンカー。文字のアウトライン化でよくできる）は外して計算し、書き戻すときに戻す
      var dupList = [];
      var segsList = e.paths.map(function (pi) {
        var raw = pathToSegs(pi, G.T), keep = [], dup = [];
        raw.forEach(function (g) {
          var z = hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) < 0.05 && (g.line || (hyp(g.c1[0] - g.a[0], g.c1[1] - g.a[1]) < 0.05 && hyp(g.c2[0] - g.b[0], g.c2[1] - g.b[1]) < 0.05));
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
    G.A = analyzeGlyph(contours, m, { compat: compat, fine: !!(compat && fine) });
    widths = widths.concat(glyphVerticalWidths(G.A));
  });
  var Wm = median(widths) || 90;
  glyphs.forEach(function (G) { finishGlyph(G.A, Wm); });
  var ST = computeStems(glyphs.map(function (G) { return G.A; }), Wm);
  return { glyphs: glyphs, ST: ST, scale: s, Wm: Wm, compat: compat, fine: !!(compat && fine) };
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
  return [a.script || 'latin', Number(base).toFixed(2), Number(top).toFixed(2), a.p && a.p.compat === false ? 0 : 1, a.p && a.p.fine ? 1 : 0].join('|');
}
function wctlAnalyze(st, a) {
  if (st.job) restoreJob(st.job);                                       // 複製を元の形に戻してから解析し直す
  var g2 = buildJob(st.dups), met = (a.base === undefined || isNaN(a.base)) ? (st.met || detectMetrics(g2)) : { base: a.base, top: a.top };
  st.met = met;
  st.job = analyzeJob(g2, met, a.script || 'latin', !(a.p && a.p.compat === false), !!(a.p && a.p.fine)); st.job.met = met;
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

  var P = { W: 100, uni: 0, tol: 30, ratio: 94, dg: 0, mg: 35, cp: 0, ext: 50, ox: 50, oy: 10, os: 0, oc: 0, prec: 2, flare: 0, flen: 250, tround: 0, tang: 0 };
  var DEF = {}; for (var k in P) DEF[k] = P[k];
  var loaded = false, busy = false, pending = null, nUpd = 0, t0 = 0, fullNext = false, lastWasFull = false, alwaysFull = false;
  var VER = 'v0.14-' + SRC.length;

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
  var dd = mp.add('dropdownlist', undefined, ['欧文', 'かな']); dd.selection = 0;
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
  var ddPts = opt.add('dropdownlist', undefined, ['ウェイト間で揃える（精度優先）', '元と同じ', '揃えない（最高精度）']); ddPts.selection = 0;
  var bReset = opt.add('button', undefined, 'リセット');
  var bottom = win.add('group'); bottom.orientation = 'row'; bottom.alignment = 'right';
  var bCancel = bottom.add('button', undefined, '元に戻す');
  var bApply = bottom.add('button', undefined, '適用（確定）');
  var bClose = bottom.add('button', undefined, '閉じる');

  function setVal(key, v) { P[key] = v; if (sliders[key]) { sliders[key].sl.value = v; sliders[key].et.text = String(v); } }
  function params() {
    return { W: P.W / 100, uni: P.uni / 100, tol: P.tol / 100, ratio: P.ratio / 100, dg: P.dg / 100, mg: P.mg / 100, cp: P.cp / 100, ext: P.ext / 100, outX: P.ox / 100, outY: P.oy / 100, tiny: 0.35, smooth: 5, os: P.os, oc: P.oc, prec: P.prec, compat: ddPts.selection.index !== 2, fine: ddPts.selection.index === 0, lockM: cbLock.value,
      flare: P.flare / 100, flen: P.flen / 100, tround: P.tround / 100, tang: P.tang, tsnap: cbSnap.value };
  }
  function args() { return { script: dd.selection.index === 1 ? 'kana' : 'latin', base: parseFloat(eBase.text), top: parseFloat(eTop.text), p: params() }; }
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
  // 欧文は上下の輪郭を内側へ（x ハイト・キャップを保つ）、かなは内外に半分ずつ
  dd.onChange = safe(function () { var oy = dd.selection.index === 1 ? 50 : 10; setVal('oy', oy); DEF.oy = oy; preview(); });
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
