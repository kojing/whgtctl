var FONT_M = { fb: -74, ft: 834 };
function glyphContours(G, s, fm) {
  fm = fm || FONT_M;
  var cx = G.adv / 2;
  var T = function (x, y) { return [(x - cx) * s, (y - fm.fb) * s]; };
  var raw = G.c.map(function (c) {
    var segs = [], st = T(c[0][0], c[0][1]), cur = st;
    for (var i = 1; i < c.length; i++) {
      var o = c[i];
      if (o[0] === 'L') { var b = T(o[1], o[2]); segs.push({ a: cur, c1: cur, c2: b, b: b, line: true }); cur = b; }
      else { var c1 = T(o[1], o[2]), c2 = T(o[3], o[4]), b2 = T(o[5], o[6]); segs.push(Cv(cur, c1, c2, b2)); cur = b2; }
    }
    if (Math.abs(cur[0] - st[0]) > 1e-6 || Math.abs(cur[1] - st[1]) > 1e-6) segs.push({ a: cur, c1: cur, c2: st, b: st, line: true });
    return segs.filter(function (g) { return g.line ? hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) > 1e-6 : true; });
  });
  var polys = raw.map(function (sg) { return flattenSegs(sg, 8); });
  return raw.map(function (sg, k) {
    var pt = polys[k][0], depth = 0;
    polys.forEach(function (P, j) { if (j !== k && windingAt([P], pt[0], pt[1]) !== 0) depth++; });
    var wantPos = depth % 2 === 0, isPos = polyArea(polys[k]) >= 0;
    return wantPos === isPos ? sg : reverseC(sg);
  });
}
