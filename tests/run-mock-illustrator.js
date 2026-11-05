// Node 上で Illustrator のオブジェクトを模して OpticalCorrection.jsx の計算部分を検証する
//   node tests/run-mock-illustrator.js   → tests/out/*.svg を出力
var fs = require('fs'), path = require('path');
var here = __dirname, outDir = path.join(here, 'out');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
eval(fs.readFileSync(path.join(here, 'sample-input.js'), 'utf8') + '\n;global.INPUT=INPUT;');
global.PointType = { SMOOTH: 'SMOOTH', CORNER: 'CORNER' };
global.app = { redraw: function () {} };
eval(fs.readFileSync(path.join(here, '..', 'scripts', 'OpticalCorrection.jsx'), 'utf8').replace(/^﻿/, '').replace('#target illustrator', ''));

var S = 0.12, OX = 100, OY = 300;
function toPt(p) { return [p[0] * S + OX, p[1] * S + OY]; }
function PathItem(segs) {
  this.typename = 'PathItem'; this.closed = true; this.filled = true; this.clipping = false; this.guides = false;
  var n = segs.length; this.pathPoints = [];
  for (var i = 0; i < n; i++) { var g = segs[i], gp = segs[(i - 1 + n) % n];
    this.pathPoints.push({ anchor: toPt(g.a), rightDirection: toPt(g.line ? g.a : g.c1), leftDirection: toPt(gp.line ? g.a : gp.c2), pointType: 'CORNER' }); }
  var xs = [], ys = []; this.pathPoints.forEach(function (q) { xs.push(q.anchor[0], q.leftDirection[0], q.rightDirection[0]); ys.push(q.anchor[1], q.leftDirection[1], q.rightDirection[1]); });
  this.geometricBounds = [Math.min.apply(null, xs), Math.max.apply(null, ys), Math.max.apply(null, xs), Math.min.apply(null, ys)];
}
PathItem.prototype.setEntirePath = function (a) { this.pathPoints = a.map(function (p) { return { anchor: p.slice(), leftDirection: p.slice(), rightDirection: p.slice(), pointType: 'CORNER' }; }); };
function Group(name, items) { this.typename = 'GroupItem'; this.name = name; this.pageItems = items; this.clipped = false; }
function toSvg(glyphs, file, pitch, H) {
  var d = '';
  glyphs.forEach(function (G, i) { G.entries.forEach(function (e) { e.paths.forEach(function (pi) {
    var P = pi.pathPoints, n = P.length, X = function (p) { return ((p[0] - OX) / S + i * pitch).toFixed(1) + ' ' + (H - (p[1] - OY) / S).toFixed(1); };
    d += 'M' + X(P[0].anchor); for (var k = 0; k < n; k++) { var A = P[k], B = P[(k + 1) % n]; d += 'C' + X(A.rightDirection) + ' ' + X(B.leftDirection) + ' ' + X(B.anchor); } d += 'Z'; }); }); });
  fs.writeFileSync(path.join(outDir, file), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -60 ' + (glyphs.length * pitch + 200) + ' ' + (H + 200) + '" width="1400"><rect x="-100" y="-60" width="100%" height="100%" fill="#F3F1EC"/><path d="' + d + '" fill="#141414"/></svg>');
}
function suite(chars, script, pitch, H) {
  var groups = chars.map(function (ch) {
    var items = INPUT[ch].c.map(function (sg) { return new PathItem(sg); });
    if (ch === 'O') items = [{ typename: 'CompoundPathItem', pathItems: items }];
    if (ch === 'す') items = items.slice(0, 2).concat([{ typename: 'CompoundPathItem', pathItems: items.slice(2) }]);
    return new Group(ch, items);
  });
  var glyphs = buildJob(groups), job = analyzeJob(glyphs, detectMetrics(glyphs), script);
  var base = { W: 1, uni: 1, tol: 0.3, ratio: job.ST.ratio, dg: 0.08, mg: 0.35, cp: 0, os: 12, oc: 16, prec: 2 };
  [['thin', { W: 0.45 }], ['regular', {}], ['black', { W: 1.7 }], ['ratio60', { ratio: 0.6 }]].forEach(function (c) {
    restoreJob(job); var p = {}, k; for (k in base) p[k] = base[k]; for (k in c[1]) p[k] = c[1][k];
    var n = applyJob(job, p); console.log(script, c[0], 'anchors', n); toSvg(glyphs, script + '_' + c[0] + '.svg', pitch, H);
  });
  restoreJob(job); toSvg(glyphs, script + '_original.svg', pitch, H);
}
suite(['H', 'O', 'T', 'A', 'V', 'X', 'E'], 'latin', 720, 800);
suite(['い', 'う', 'こ', 'し', 'す', 'の'], 'kana', 950, 900);
