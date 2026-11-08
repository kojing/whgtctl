// ユーザーの SVG（Illustrator 書き出し）を Illustrator のオブジェクトに見立てて OpticalCorrection.jsx に通す
//   node tests/run-svg.js in.svg out.svg '{"W":0.1}' [group]
var fs = require('fs'), path = require('path');
global.PointType = { SMOOTH: 'SMOOTH', CORNER: 'CORNER' };
global.app = { redraw: function () {} };
eval(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'OpticalCorrection.jsx'), 'utf8').replace(/^﻿/, '').replace(/^#target.*$/mg, ''));
function parseD(d) {
  var toks = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:e-?\d+)?/g), i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, subs = [], cur = null;
  function num() { return parseFloat(toks[i++]); }
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    var rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === 'Z') { if (cur) { subs.push(cur); cur = null; } x = sx; y = sy; continue; }
    if (C === 'M') { x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); sx = x; sy = y; cur = { start: [x, y], segs: [] }; cmd = rel ? 'l' : 'L'; continue; }
    var nx, ny;
    if (C === 'L') { nx = (rel ? x : 0) + num(); ny = (rel ? y : 0) + num(); cur.segs.push({ line: true, b: [nx, ny] }); }
    else if (C === 'H') { nx = (rel ? x : 0) + num(); ny = y; cur.segs.push({ line: true, b: [nx, ny] }); }
    else if (C === 'V') { nx = x; ny = (rel ? y : 0) + num(); cur.segs.push({ line: true, b: [nx, ny] }); }
    else if (C === 'C') { var c1 = [(rel ? x : 0) + num(), (rel ? y : 0) + num()], c2 = [(rel ? x : 0) + num(), (rel ? y : 0) + num()]; nx = (rel ? x : 0) + num(); ny = (rel ? y : 0) + num(); cur.segs.push({ c1: c1, c2: c2, b: [nx, ny] }); }
    else throw new Error('unsupported ' + cmd);
    x = nx; y = ny;
  }
  return subs;
}
function Y(p) { return [p[0], -p[1]]; }
function PathItem(sub) {
  this.typename = 'PathItem'; this.closed = true; this.filled = true; this.clipping = false; this.guides = false; this.evenodd = false;
  var segs = sub.segs.slice(), a = sub.start, n0 = segs.length;
  // Z の前に始点へ戻る長さ 0 の直線があれば捨てる（Z が閉じる）
  var last = segs[n0 - 1], cur = a;
  segs.forEach(function (g) { g.a = cur; cur = g.b; });
  if (last.line && Math.abs(last.a[0] - last.b[0]) < 1e-6 && Math.abs(last.a[1] - last.b[1]) < 1e-6) segs.pop();
  // 最後の区間が始点に戻っていなければ、Z が直線で閉じる
  var e = segs[segs.length - 1].b;
  if (Math.abs(e[0] - a[0]) > 1e-6 || Math.abs(e[1] - a[1]) > 1e-6) segs.push({ line: true, a: e, b: a });
  var n = segs.length; this.pathPoints = [];
  for (var k = 0; k < n; k++) { var g = segs[k], gp = segs[(k - 1 + n) % n];
    this.pathPoints.push({ anchor: Y(g.a), rightDirection: Y(g.line ? g.a : g.c1), leftDirection: Y(gp.line ? g.a : gp.c2), pointType: 'CORNER' }); }
  var xs = [], ys = []; this.pathPoints.forEach(function (q) { xs.push(q.anchor[0]); ys.push(q.anchor[1]); });
  this.geometricBounds = [Math.min.apply(null, xs), Math.max.apply(null, ys), Math.max.apply(null, xs), Math.min.apply(null, ys)];
}
PathItem.prototype.setEntirePath = function (a) { this.pathPoints = a.map(function (p) { return { anchor: p.slice(), leftDirection: p.slice(), rightDirection: p.slice(), pointType: 'CORNER' }; }); };
var src = fs.readFileSync(process.argv[2], 'utf8'), ds = [], re = /<path[^>]*\sd="([^"]+)"/g, m;
while ((m = re.exec(src))) ds.push(m[1]);
var items = ds.map(function (d) { var subs = parseD(d).map(function (s) { return new PathItem(s); }); return subs.length > 1 ? { typename: 'CompoundPathItem', pathItems: subs } : subs[0]; });
var sel = process.argv[5] === 'group' ? items.map(function (it, k) { return { typename: 'GroupItem', name: 'g' + k, pageItems: [it], clipped: false }; }) : items;
var glyphs = buildJob(sel), met = detectMetrics(glyphs);
var opt = JSON.parse(process.argv[4] || '{}'); if (opt.BALL) ENG.BALL = true; if (opt.FREE) ENG.FREE = true; if (opt.MLT) ENG.MLT = opt.MLT; if (opt.GRID === false) ENG.GRID = false; if (opt.TCLIM) ENG.TCLIM = opt.TCLIM; if (opt.RAMP !== undefined) ENG.RAMP = !!opt.RAMP; if (opt.FD) ENG.FREEDEG = opt.FD; if (opt.TENS !== undefined) ENG.TENS = opt.TENS;
var job = analyzeJob(glyphs, met, opt.script || 'latin', opt.compat !== false, opt.fine);
var P = { W: 1, uni: 0, tol: 0.3, ratio: job.ST.ratio, dg: 0, mg: 0.35, cp: 0, ext: 0.5, outX: 0.5, outY: 0.1, tiny: 0.35, smooth: 5, os: 0, oc: 0, prec: 2, compat: true, lockM: glyphs.length >= 5 };
for (var k in opt) P[k] = opt[k];
console.log('glyphs', glyphs.length, 'metrics', JSON.stringify(met), 'ST', JSON.stringify(job.ST), 'Wm', job.Wm.toFixed(1));
var n = applyJob(job, P); console.log('anchors', n);
var d = '';
glyphs.forEach(function (G) { G.entries.forEach(function (e) { e.paths.forEach(function (pi) {
  var Q = pi.pathPoints, n = Q.length, X = function (p) { return p[0].toFixed(2) + ' ' + (-p[1]).toFixed(2); };
  d += 'M' + X(Q[0].anchor); for (var k = 0; k < n; k++) { var A = Q[k], B = Q[(k + 1) % n]; d += 'C' + X(A.rightDirection) + ' ' + X(B.leftDirection) + ' ' + X(B.anchor); } d += 'Z'; }); }); });
var vb = (src.match(/viewBox="([^"]+)"/) || [])[1];
fs.writeFileSync(process.argv[3], '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" width="1300"><rect x="-20" y="-20" width="2000" height="2000" fill="#fff"/><path d="' + d + '" fill="#231815" fill-opacity="0.85" stroke="#d22" stroke-width="0.4"/></svg>');
