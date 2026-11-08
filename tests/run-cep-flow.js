// CEP パネルの流れを模擬の書類で確かめる：Illustrator 側 host.jsx ＋ パネル側 engine.js / panel.js
//   node tests/run-cep-flow.js tests/user/noto-black-abc.svg
var fs = require('fs'), path = require('path'), R = path.join(__dirname, '..');
global.PointType = { SMOOTH: 'SMOOTH', CORNER: 'CORNER' };
global.ElementPlacement = { PLACEBEFORE: 'PLACEBEFORE' };
global.app = { redraw: function () {}, documents: [] };
global.$ = { global: global };
// 模擬の書類（run-palette-flow.js と同じ作り）
var flow = fs.readFileSync(path.join(__dirname, 'run-palette-flow.js'), 'utf8');
eval(flow.slice(flow.indexOf('function Tags()'), flow.indexOf('app.documents = [doc]')));
app.documents = [doc]; app.activeDocument = doc;
// Illustrator 側とパネル側を読み込む
eval(fs.readFileSync(path.join(R, 'cep/whgtctl/jsx/host.jsx'), 'utf8'));
eval(fs.readFileSync(path.join(R, 'cep/whgtctl/js/engine.js'), 'utf8'));
eval(fs.readFileSync(path.join(R, 'cep/whgtctl/js/panel.js'), 'utf8').replace(/^var PointType.*$/m, ''));
function H(code) { var r = JSON.parse(eval(code)); return r; }
var o = { script: 'latin', base: NaN, top: NaN, compat: true, fine: true };
var P = { W: 0.5, uni: 0, tol: 0.3, ratio: 0.78, dg: 0, mg: 0.35, cp: 0, ext: 0.5, outX: 0.5, outY: 0.1, tiny: 0.35, smooth: 5, os: 0, oc: 0, prec: 2, compat: true, fine: true, lockM: false, flare: 0, flen: 2.5, tround: 0, tang: 0, tsnap: false };
console.log('empty load', H('wctlhLoad()').msg);
layer.kids[0].selected = layer.kids[1].selected = true;
var r = H('wctlhLoad()'); console.log('load ok', r.ok, 'items', r.items.length);
var core = new WctlCore(); core.setTree(r.items);
var t0 = Date.now(); core.analyze(o); console.log('analyze ms', Date.now() - t0, 'met', JSON.stringify(core.met));
o.base = +core.met.base.toFixed(2); o.top = +core.met.top.toFixed(2);
var nA = 0, _a = core.analyze; core.analyze = function (x) { nA++; return _a.call(this, x); };
[0.5, 0.3, 0.1].forEach(function (w) { P.W = w; var t1 = Date.now(); var res = core.deform(o, P); var w1 = H('wctlhWrite(' + JSON.stringify(res.data) + ')'); console.log('W', w, 'deform ms', Date.now() - t1, 'write', w1.ok, 'anchors', res.anchors); });
console.log('re-analyses during previews', nA, 'hidden', layer.kids.filter(function (i) { return i.hidden; }).length, 'selected', doc.selection.length);
console.log('unpreview', H('wctlhUnpreview()').ok, 'hidden', layer.kids.filter(function (i) { return i.hidden; }).length);
var c = H('wctlhCommit()'); console.log('commit', c.ok, c.committed, 'items', layer.kids.length, 'tags', doc.pageItems.filter(function (i) { return i.tags.length; }).length);
// 結果をスクリプト版（同じ入力・同じ値）と比べる
function ptsOf(it) { var a = []; (function w(x) { if (x.pathPoints) x.pathPoints.forEach(function (q) { a.push(q.anchor[0], q.anchor[1], q.leftDirection[0], q.leftDirection[1], q.rightDirection[0], q.rightDirection[1]); }); if (x.kids) x.kids.forEach(w); })(it); return a; }
var cep = ptsOf(layer.kids[0]).concat(ptsOf(layer.kids[1]));
// スクリプト版：同じ2文字を、同じメトリクスで
var items2 = r.items.map(function (n) { var ps = []; return wctlMockTree(n, ps); });
var g2 = buildJob(items2), job2 = analyzeJob(g2, { base: o.base, top: o.top }, 'latin', true, true); applyJob(job2, P);
var ref = []; items2.forEach(function (it) { (function w(x) { if (x.pathPoints) x.pathPoints.forEach(function (q) { ref.push(q.anchor[0], q.anchor[1], q.leftDirection[0], q.leftDirection[1], q.rightDirection[0], q.rightDirection[1]); }); (x.pageItems || x.pathItems || []).forEach(w); })(it); });
var md = 0; for (var i = 0; i < Math.min(ref.length, cep.length); i++) md = Math.max(md, Math.abs(ref[i] - cep[i]));
console.log('values', cep.length, ref.length, 'max diff vs script version', md.toFixed(4));
