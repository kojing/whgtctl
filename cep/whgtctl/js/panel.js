/*
  whgtctl CEP パネル：計算はここ（CEP の JavaScript）で行い、Illustrator には読み出しと書き込みだけを頼む。
  engine.js（OpticalCorrection.jsx と同じ計算コード）を、Illustrator のオブジェクトに見立てた入れ物の上で動かす。
*/
var PointType = { SMOOTH: 'SMOOTH', CORNER: 'CORNER' };

/* ---------- Illustrator のオブジェクトに見立てた入れ物 ---------- */
function wctlMockPath(node) {
  var pts = node.pts.map(function (v) {
    return { anchor: [v[0], v[1]], leftDirection: [v[2], v[3]], rightDirection: [v[4], v[5]], pointType: v[6] ? PointType.SMOOTH : PointType.CORNER };
  });
  var xs = pts.map(function (q) { return q.anchor[0]; }), ys = pts.map(function (q) { return q.anchor[1]; });
  return {
    typename: 'PathItem', _i: node.i, closed: node.closed, filled: node.filled, clipping: node.clipping, guides: node.guides, evenodd: node.evenodd,
    pathPoints: pts,
    geometricBounds: [Math.min.apply(null, xs), Math.max.apply(null, ys), Math.max.apply(null, xs), Math.min.apply(null, ys)],
    setEntirePath: function (a) { this.pathPoints = a.map(function (p) { return { anchor: p.slice(), leftDirection: p.slice(), rightDirection: p.slice(), pointType: PointType.CORNER }; }); }
  };
}
function wctlMockTree(node, paths) {
  if (node.t === 'G') return { typename: 'GroupItem', clipped: node.clipped, pageItems: node.ch.map(function (c) { return wctlMockTree(c, paths); }) };
  if (node.t === 'C') return { typename: 'CompoundPathItem', pathItems: node.ch.map(function (c) { return wctlMockTree(c, paths); }) };
  if (node.t === 'P') { var p = wctlMockPath(node); paths.push(p); return p; }
  return { typename: 'Unknown' };
}
function wctlPathData(paths) {
  return paths.map(function (p) {
    return { i: p._i, pts: p.pathPoints.map(function (q) { return [q.anchor[0], q.anchor[1], q.leftDirection[0], q.leftDirection[1], q.rightDirection[0], q.rightDirection[1], q.pointType === PointType.SMOOTH ? 1 : 0]; }) };
  });
}

/* ---------- 計算（解析は設定が変わったときだけ、プレビューは変形だけ） ---------- */
function WctlCore() { this.tree = null; this.paths = []; this.job = null; this.key = ''; this.met = null; }
WctlCore.prototype.setTree = function (tree) { this.tree = tree; this.job = null; this.key = ''; this.met = null; };
WctlCore.prototype.analyze = function (o) {
  // 元の形から入れ物を作り直して解析する
  this.paths = [];
  var self = this, items = this.tree.map(function (n) { return wctlMockTree(n, self.paths); });
  var glyphs = buildJob(items);
  if (!glyphs.length) throw new Error('塗りのある閉じたパスが見つかりませんでした');
  var met = (o.base === undefined || isNaN(o.base)) ? (this.met || detectMetrics(glyphs)) : { base: o.base, top: o.top };
  this.met = met;
  this.job = analyzeJob(glyphs, met, o.script, o.compat, o.fine);
  this.job.met = met;
  this.key = this.keyOf(o);
  return this.job;
};
WctlCore.prototype.keyOf = function (o) {
  var m = (o.base === undefined || isNaN(o.base)) ? this.met : o;
  return [o.script, m ? Number(m.base).toFixed(2) : '', m ? Number(m.top).toFixed(2) : '', o.compat ? 1 : 0, o.fine ? 1 : 0].join('|');
};
WctlCore.prototype.deform = function (o, p) {
  if (!this.job || this.key !== this.keyOf(o)) this.analyze(o);
  var n = applyJob(this.job, p);
  return { anchors: n, data: wctlPathData(this.paths) };
};

if (typeof module !== 'undefined') module.exports = { WctlCore: WctlCore, wctlMockTree: wctlMockTree, wctlPathData: wctlPathData, PointType: PointType };
