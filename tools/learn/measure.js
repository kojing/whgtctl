// 基準ウェイト（400）の輪郭上の点ごとに、各ウェイトで「その辺がどれだけ動いたか」「その場所の太さがどう変わったか」を測る。
// node measure.js <Font>  → rec/<Font>.jsonl
var fs = require('fs');
eval(fs.readFileSync('/home/claude/noto/engJ.js', 'utf8'));
var font = process.argv[2], D = JSON.parse(fs.readFileSync('/home/claude/learn/data/' + font + '.json', 'utf8'));
var kind = D.kind, M = D.m;
// 正規化：欧文はベースライン〜キャップハイト、和文は仮想ボディ（ディセンダー〜アセンダー）を 700 に
var fm = kind === 'latin' ? { fb: 0, ft: M.cap || 0.7 * M.upm } : { fb: M.desc, ft: M.asc };
var S = 700 / (fm.ft - fm.fb);
var met = kind === 'latin' ? { ft: 700, fb: 0, mid: 350, band: 4, spanK: 2 } : { ft: 700, fb: 0, mid: 350, band: 50, spanK: 4 };

function contoursOf(G) {
  var T = function (x, y) { return [(x) * S, (y - fm.fb) * S]; };   // 横位置はそのまま（ウェイト間で同じ座標系）
  var raw = G.c.map(function (c) {
    var segs = [], st = T(c[0][0], c[0][1]), cur = st;
    for (var i = 1; i < c.length; i++) {
      var o = c[i];
      if (o[0] === 'L') { var b = T(o[1], o[2]); segs.push({ a: cur, c1: cur, c2: b, b: b, line: true }); cur = b; }
      else { var c1 = T(o[1], o[2]), c2 = T(o[3], o[4]), b2 = T(o[5], o[6]); segs.push(Cv(cur, c1, c2, b2)); cur = b2; }
    }
    if (hyp(cur[0] - st[0], cur[1] - st[1]) > 1e-6) segs.push({ a: cur, c1: cur, c2: st, b: st, line: true });
    return segs.filter(function (g) { return g.line ? hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) > 1e-6 : hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) + hyp(g.c1[0] - g.a[0], g.c1[1] - g.a[1]) > 1e-6; });
  }).filter(function (s) { return s.length >= 2; });
  // 向き：いちばん大きい輪郭が正の面積になるよう全体をそろえる（重なりは nonzero のまま）
  var areas = raw.map(function (sg) { return polyArea(flattenSegs(sg, 8)); }), big = 0;
  areas.forEach(function (a, k) { if (Math.abs(a) > Math.abs(areas[big])) big = k; });
  return areas[big] < 0 ? raw.map(reverseC) : raw;
}

function setOf(w) {
  var L = {}, ws = [];
  Object.keys(D.W[w]).forEach(function (ch) {
    try { var A = analyzeGlyph(contoursOf(D.W[w][ch]), met, { compat: true }); L[ch] = A; ws = ws.concat(glyphVerticalWidths(A)); } catch (e) {}
  });
  var W2 = median(ws);
  Object.keys(L).forEach(function (ch) { finishGlyph(L[ch], W2); });
  var ST = computeStems(Object.keys(L).map(function (c) { return L[c]; }), W2);
  return { L: L, ST: ST };
}

fs.mkdirSync('/home/claude/learn/rec', { recursive: true });
var weights = Object.keys(D.W).sort(function (a, b) { return a - b; });
var base = process.env.BASE === 'max' ? weights[weights.length - 1] : (process.env.BASE === 'min' ? weights[0] : (weights.indexOf('400') >= 0 ? '400' : weights[Math.floor(weights.length / 2)]));
var SETS = {}; SETS[base] = setOf(base);
var B = SETS[base], STR = +(process.env.STRIDE || 1), fd = fs.openSync('/home/claude/learn/rec/' + font + (process.env.BASE ? '_' + process.env.BASE : '') + '.jsonl', 'w'), NREC = 0, VS = {};

// 輪郭に沿った位置と、線端・角までの距離
function contourInfo(A, Wm) {
  return A.SEG.map(function (segs) {
    var n = segs.length, pos = [], acc = 0;
    segs.forEach(function (S) { pos.push(acc); acc += S.Lc0 || hyp(S.g.b[0] - S.g.a[0], S.g.b[1] - S.g.a[1]); });
    var total = acc, caps = [], cvx = [], ccv = [];
    segs.forEach(function (S, i) {
      if (S.isCap && !S.hidden) caps.push(pos[i] + (S.Lc0 || 0) / 2);
      var P = segs[(i - 1 + n) % n], t1 = P.t1, t0 = S.t0, dot = t1[0] * t0[0] + t1[1] * t0[1], cr = t1[0] * t0[1] - t1[1] * t0[0];
      if (dot < 0.87) (cr > 0 ? cvx : ccv).push(pos[i]);
    });
    return { pos: pos, total: total, caps: caps, cvx: cvx, ccv: ccv };
  });
}
function cdist(list, p, total) { var b = 1e9; list.forEach(function (q) { var d = Math.abs(q - p); d = Math.min(d, total - d); if (d < b) b = d; }); return b; }
function segCurv(g, t) {
  if (g.line) return 0;
  var e = 1e-3, a = segTan(g, Math.max(0, t - e)), b = segTan(g, Math.min(1, t + e)), P = bez(g, Math.max(0, t - e)), Q = bez(g, Math.min(1, t + e));
  var ds = hyp(Q[0] - P[0], Q[1] - P[1]); if (ds < 1e-9) return 0;
  return (a[0] * b[1] - a[1] * b[0]) / ds;   // 正：内側（インク側）へ曲がる＝外に膨らむ
}

// 法線の線上で、目標ウェイトの輪郭に入る位置（基準点からの距離、内向き正）を探す
function crossAt(At, x, y, nx, ny, R) {
  var qx = x - nx * R, qy = y - ny * R, w = windingAt(At.flat, qx, qy), hits = rayHits(At.edges, qx, qy, nx, ny), best = null;
  for (var h = 0; h < hits.length; h++) {
    var w0 = w; w += hits[h][1];
    if (hits[h][0] > 2 * R) break;
    if (w0 === 0 && w !== 0) { var s = hits[h][0] - R; if (best === null || Math.abs(s) < Math.abs(best)) best = s; }
  }
  return best;
}

weights.forEach(function (w) { if (w === base) { VS[w] = B.ST; return; } SETS[w] = setOf(w); VS[w] = SETS[w].ST; var out = [];
Object.keys(B.L).forEach(function (ch) {
  var A = B.L[ch], CI = contourInfo(A, B.ST.V);
  var yb = [1e9, -1e9]; A.flat.forEach(function (P) { P.forEach(function (q) { if (q[1] < yb[0]) yb[0] = q[1]; if (q[1] > yb[1]) yb[1] = q[1]; }); });
  (function () {
    var T = SETS[w], At = T.L[ch]; if (!At) return;
    var adv0 = D.W[base][ch].adv * S, adv1 = D.W[w][ch].adv * S;
    // 字面の中心の横ずれ（字幅が変わるため）を差し引く
    var bx = function (AA) { var lo = 1e9, hi = -1e9; AA.flat.forEach(function (P) { P.forEach(function (q) { if (q[0] < lo) lo = q[0]; if (q[0] > hi) hi = q[0]; }); }); return [lo, hi]; };
    var b0 = bx(A), b1 = bx(At);
    A.SEG.forEach(function (segs, ci) { segs.forEach(function (Sg, si) {
      if (Sg.hidden) return;
      Sg.sm.forEach(function (o, oi) {
        if (oi % STR) return;
        if (!o.vis || !(o.w > 0) || o.w > 1000) return;
        // 横方向は字面の幅の比で位置を写す（字幅の伸び縮みと、ずれ量を分けるため）
        var u = (o.x - b0[0]) / ((b0[1] - b0[0]) || 1), xm = b1[0] + u * (b1[1] - b1[0]);
        var R = Math.max(30, 0.8 * o.w + 40);
        var s = crossAt(At, xm, o.y, o.nx, o.ny, R); if (s === null) return;
        var px = xm + o.nx * s, py = o.y + o.ny * s;
        var wt = rayExit(At.flat, At.edges, px + o.nx * 0.75, py + o.ny * 0.75, o.nx, o.ny) + 0.75;
        var pc = CI[ci].pos[si] + (Sg.Lc0 || 0) * o.t;
        out.push({
          f: font, k: kind, ch: ch, w: +w, b: +base, Vb: +B.ST.V.toFixed(2), Hb: +B.ST.H.toFixed(2), Vt: +T.ST.V.toFixed(2), Ht: +T.ST.H.toFixed(2),
          nx: +o.nx.toFixed(3), ny: +o.ny.toFixed(3), wb: +o.w.toFixed(1), wt: +wt.toFixed(1), s: +s.toFixed(2),
          gap: +Math.min(o.gap, 1000).toFixed(1), gapO: +Math.min(o.gapOpp, 1000).toFixed(1), oe: +(o.oe || 0).toFixed(2), oo: +(o.oo || 0).toFixed(2),
          cap: Sg.isCap ? 1 : 0, line: Sg.g.line ? 1 : 0, cur: +segCurv(Sg.g, o.t).toFixed(4), co: Sg.coincide ? 1 : 0,
          dCap: +Math.min(cdist(CI[ci].caps, pc, CI[ci].total), 999).toFixed(1), dCvx: +Math.min(cdist(CI[ci].cvx, pc, CI[ci].total), 999).toFixed(1), dCcv: +Math.min(cdist(CI[ci].ccv, pc, CI[ci].total), 999).toFixed(1),
          y: +((o.y - yb[0]) / ((yb[1] - yb[0]) || 1)).toFixed(3), adv0: +adv0.toFixed(1), adv1: +adv1.toFixed(1), bw0: +(b0[1] - b0[0]).toFixed(1), bw1: +(b1[1] - b1[0]).toFixed(1)
        });
      });
    }); });
  })();
});
if (out.length) fs.writeSync(fd, out.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n'); NREC += out.length; out = null; delete SETS[w];
});
console.log(font, 'base', base, 'weights', weights.join(','), 'records', NREC, 'V', weights.map(function (w) { return VS[w].V.toFixed(0); }).join('/'), 'H', weights.map(function (w) { return VS[w].H.toFixed(0); }).join('/'));
