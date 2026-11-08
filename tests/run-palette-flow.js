// パレットの流れ（読み込み → プレビュー → 適用 → 別の文字を読み込み → 元に戻す）を、模擬の書類で確かめる
//   node tests/run-palette-flow.js tests/user/noto-black-abc.svg
var fs = require('fs'), path = require('path');
global.PointType = { SMOOTH: 'SMOOTH', CORNER: 'CORNER' };
global.ElementPlacement = { PLACEBEFORE: 'PLACEBEFORE' };
var redraws = 0; global.app = { redraw: function () { redraws++; }, documents: [] };
var SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'OpticalCorrection.jsx'), 'utf8').replace(/^﻿/, '').replace(/^#target.*$/mg, '');
Object.prototype.toSource = function () { return '(' + JSON.stringify(this) + ')'; };
global.$ = { global: global };
eval('var WCTL_NOUI = true;\n' + SRC);
var nAnalyze = 0, _aj = analyzeJob; analyzeJob = function () { nAnalyze++; return _aj.apply(null, arguments); };
function Tags() { this.list = []; this.length = 0; }
Tags.prototype.add = function () { var self = this, t = { name: '', value: '', remove: function () { self.list.splice(self.list.indexOf(t), 1); self.sync(); } }; this.list.push(t); this.sync(); return t; };
Tags.prototype.sync = function () { var k; for (k = 0; k < 50; k++) delete this[k]; for (k = 0; k < this.list.length; k++) this[k] = this.list[k]; this.length = this.list.length; };
function attach(it, parent) {
  it.parent = parent; it.tags = new Tags(); it.hidden = false; it.selected = false;
  it.remove = function () { var L = it.parent.kids; L.splice(L.indexOf(it), 1); };
  it.duplicate = function (rel) { var c = clone(it); attach(c, it.parent); var L = it.parent.kids; L.splice(L.indexOf(it), 0, c); return c; };
  if (it.kids) it.kids.forEach(function (k) { attach(k, it); });
  return it;
}
function clone(it) {
  var c = { typename: it.typename };
  ['closed', 'filled', 'clipping', 'guides', 'evenodd', 'clipped', 'name'].forEach(function (k) { if (k in it) c[k] = it[k]; });
  if (it.pathPoints) { c.pathPoints = it.pathPoints.map(function (q) { return { anchor: q.anchor.slice(), leftDirection: q.leftDirection.slice(), rightDirection: q.rightDirection.slice(), pointType: q.pointType }; }); c.setEntirePath = it.setEntirePath; c.geometricBounds = it.geometricBounds.slice(); }
  if (it.kids) { c.kids = it.kids.map(clone); defineKids(c); }
  return c;
}
function defineKids(it) {
  Object.defineProperty(it, it.typename === 'CompoundPathItem' ? 'pathItems' : 'pageItems', { get: function () { return it.kids; }, configurable: true });
}
// run-svg.js の SVG 読み込みを流用
var rs = fs.readFileSync(path.join(__dirname, 'run-svg.js'), 'utf8');
eval(rs.slice(rs.indexOf('function parseD'), rs.indexOf('var src = fs.readFileSync')));
var svg = fs.readFileSync(process.argv[2], 'utf8'), ds = [], re = /<path[^>]*\sd="([^"]+)"/g, m;
while ((m = re.exec(svg))) ds.push(m[1]);
var layer = { kids: [] };
ds.forEach(function (d, k) {
  var subs = parseD(d).map(function (s) { return new PathItem(s); });
  var inner = subs.length > 1 ? { typename: 'CompoundPathItem', kids: subs } : subs[0];
  if (inner.kids) defineKids(inner);
  var g = { typename: 'GroupItem', clipped: false, kids: [inner] }; defineKids(g);
  layer.kids.push(attach(g, layer));
});
var doc = {
  get pageItems() { var out = []; (function walk(L) { L.forEach(function (it) { out.push(it); if (it.kids) walk(it.kids); }); })(layer.kids); return out; },
  get selection() { return layer.kids.filter(function (it) { return it.selected; }); },
  set selection(v) { layer.kids.forEach(function (it) { it.selected = false; }); }
};
app.documents = [doc]; app.activeDocument = doc;
function call(cmd, a) { var r = eval(wctlDo(cmd, a)); console.log(cmd, JSON.stringify(r)); return r; }
function anchors(it) { var n = 0; (function w(x) { if (x.pathPoints) n += x.pathPoints.length; if (x.kids) x.kids.forEach(w); })(it); return n; }
var P = { W: 0.5, uni: 0, tol: 0.3, ratio: 0.94, dg: 0, mg: 0.35, cp: 0, ext: 0.5, outX: 0.5, outY: 0.1, tiny: 0.35, smooth: 5, os: 0, oc: 0, prec: 2, compat: true, fine: true, lockM: false, flare: 0.4, flen: 2.5, tround: 0.5, tang: 0, tsnap: false };
var A0 = layer.kids.map(anchors);
// 何も選ばずに読み込み
call('load', { script: 'latin', base: NaN, top: NaN, p: P });
// A と B を選んで読み込み → プレビュー2回 → 適用
layer.kids[0].selected = layer.kids[1].selected = true;
var r = call('load', { script: 'latin', base: NaN, top: NaN, p: P });
call('preview', { script: 'latin', base: r.base, top: r.top, p: P });
P.W = 0.3; call('preview', { script: 'latin', base: r.base, top: r.top, p: P });
call('unpreview', {}); console.log('items after unpreview', layer.kids.length, 'hidden', layer.kids.filter(function (i) { return i.hidden; }).length);
call('preview', { script: 'latin', base: r.base, top: r.top, p: P });
console.log('items after preview', layer.kids.length, 'hidden', layer.kids.filter(function (i) { return i.hidden; }).length, 'selected', doc.selection.length);
// プレビューの字を選んだまま読み込み直す → 元の字が読み込まれる
r = call('load', { script: 'latin', base: NaN, top: NaN, p: P }); console.log('reload from preview selection: glyphs', r.glyphs, 'selected', doc.selection.length);
call('preview', { script: 'latin', base: r.base, top: r.top, p: P });
call('commit', { script: 'latin', base: r.base, top: r.top, p: P });
console.log('selected after commit', doc.selection.length); console.log('items after commit', layer.kids.length, 'hidden', layer.kids.filter(function (i) { return i.hidden; }).length, 'tags', doc.pageItems.filter(function (i) { return i.tags.length; }).length);
// C を選び直して読み込み → プレビュー → 元に戻す
layer.kids.forEach(function (i) { i.selected = false; }); layer.kids[2].selected = true;
r = call('load', { script: 'latin', base: NaN, top: NaN, p: P });
call('preview', { script: 'latin', base: r.base, top: r.top, p: P });
call('cancel', {});
console.log('items after cancel', layer.kids.length, 'hidden', layer.kids.filter(function (i) { return i.hidden; }).length, 'tags', doc.pageItems.filter(function (i) { return i.tags.length; }).length);
console.log('analyses', nAnalyze); console.log('anchors before', A0.join(','), 'after', layer.kids.map(anchors).join(','));
