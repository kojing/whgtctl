// 学習に使った各書体で、最も太いウェイトから細いウェイトを作り、実物との誤差（輪郭どうしの平均距離、u）を比べる
// node evalfont.js <Font> <srcW> <dstW> '{"learn":1}' [engine.js]
var fs = require('fs');
eval(fs.readFileSync(process.argv[6] || '/home/claude/noto/engJ.js', 'utf8'));
var cmL = fs.readFileSync('/home/claude/noto/cm.js', 'utf8').split('\n'), cm = '';
cmL.forEach(function (l, i) { if (/^function (nearest|chamfer|bpts|bestChamfer)/.test(l)) { cm += l + '\n'; for (var j = i + 1; j < cmL.length && !/^(function|var|\/\/|if|\[)/.test(cmL[j]); j++) cm += cmL[j] + '\n'; } });
eval(cm);
if (process.env.ENGX) { var _x = JSON.parse(process.env.ENGX); for (var _k in _x) ENG[_k] = _x[_k]; }
var font = process.argv[2], sw = process.argv[3], dw = process.argv[4], EX = JSON.parse(process.argv[5] || '{}');
var D = JSON.parse(fs.readFileSync('/home/claude/learn/data/' + font + '.json', 'utf8')), M = D.m, kind = D.kind;
var fm = kind === 'latin' ? { fb: 0, ft: M.cap || 0.7 * M.upm } : { fb: M.desc, ft: M.asc }, S = 700 / (fm.ft - fm.fb);
var met = kind === 'latin' ? { ft: 700, fb: 0, mid: 350, band: 4, spanK: 2 } : { ft: 700, fb: 0, mid: 350, band: 50, spanK: 4 };
var CH = kind === 'latin' ? 'oceasg0368953OCGSQDBRPUJnhmrtkxyvw'.split('') : 'のあるろめぬおすつひみしそゆよらわをこアサナヤル永東国書話'.split('');
function contoursOf(G, center) {
  var cx = center;
  var T = function (x, y) { return [(x - cx) * S, (y - fm.fb) * S]; };
  var raw = G.c.map(function (c) {
    var segs = [], st = T(c[0][0], c[0][1]), cur = st;
    for (var i = 1; i < c.length; i++) { var o = c[i];
      if (o[0] === 'L') { var b = T(o[1], o[2]); segs.push({ a: cur, c1: cur, c2: b, b: b, line: true }); cur = b; }
      else { var c1 = T(o[1], o[2]), c2 = T(o[3], o[4]), b2 = T(o[5], o[6]); segs.push(Cv(cur, c1, c2, b2)); cur = b2; } }
    if (hyp(cur[0] - st[0], cur[1] - st[1]) > 1e-6) segs.push({ a: cur, c1: cur, c2: st, b: st, line: true });
    return segs.filter(function (g) { return g.line ? hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) > 1e-6 : hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) + hyp(g.c1[0] - g.a[0], g.c1[1] - g.a[1]) > 1e-6; });
  }).filter(function (s) { return s.length >= 2; });
  var areas = raw.map(function (sg) { return polyArea(flattenSegs(sg, 8)); }), big = 0;
  areas.forEach(function (a, k) { if (Math.abs(a) > Math.abs(areas[big])) big = k; });
  return areas[big] < 0 ? raw.map(reverseC) : raw;
}
function setOf(w, chars) {
  var L = {}, ws = [];
  chars.forEach(function (ch) { var G = D.W[w][ch]; if (!G) return; var A = analyzeGlyph(contoursOf(G, G.adv / 2), met, { compat: true }); L[ch] = A; ws = ws.concat(glyphVerticalWidths(A)); });
  var W2 = median(ws); Object.keys(L).forEach(function (c) { finishGlyph(L[c], W2); });
  var ST = computeStems(Object.keys(L).map(function (c) { return L[c]; }), W2); ST.jp = kind === 'jp';
  return { L: L, ST: ST };
}
var R = setOf(sw, CH), T = setOf(dw, CH);
var p = { W: T.ST.V / R.ST.V, uni: 0, tol: 0.3, ratio: R.ST.ratio, dg: 0, mg: 0.35, cp: 0, os: 0, oc: 0, prec: 2, ext: 0.5, tiny: 0.35, smooth: 5, compat: true,
  outX: 0.5, outY: kind === 'latin' ? 0.1 : 0.5 };
for (var q in EX) p[q] = EX[q];
var ms = [];
Object.keys(R.L).forEach(function (ch) {
  if (!D.W[dw][ch]) return;
  var C = deformGlyph(R.L[ch], R.ST, p), real = contoursOf(D.W[dw][ch], D.W[dw][ch].adv / 2);
  ms.push(bestChamfer(C, real).mean);
});
var m = ms.reduce(function (a, b) { return a + b; }, 0) / ms.length;
console.log(JSON.stringify({ f: font, src: sw, dst: dw, ex: EX, mean: +m.toFixed(3), n: ms.length }));
