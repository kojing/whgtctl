/*
  whgtctl CEP パネルの Illustrator 側（ExtendScript）
  計算はパネル（HTML / JavaScript）で行い、ここでは
    選択の読み出し（load）・結果の書き込み（write）・表示の切り替え・確定・取り消し
  だけを行う。プレビュー中は元の字に印 src、複製に印 prev を付けて隠し／表示を切り替える。
*/
var WCTLH_TAG = 'whgtctl';

function wctlhTag(it) { try { for (var i = 0; i < it.tags.length; i++) if (it.tags[i].name === WCTLH_TAG) return it.tags[i]; } catch (e) {} return null; }
function wctlhSetTag(it, v) { var t = wctlhTag(it); if (!t) { t = it.tags.add(); t.name = WCTLH_TAG; } t.value = v; }
function wctlhClearTag(it) { var t = wctlhTag(it); if (t) t.remove(); }
function wctlhKind(t) { return t ? String(t.value).split('#')[0] : ''; }
function wctlhId(t) { return t ? (String(t.value).split('#')[1] || '') : ''; }
function wctlhFind(doc, v) {
  var out = [], items = doc.pageItems;
  for (var i = 0; i < items.length; i++) { var t = wctlhTag(items[i]); if (t && wctlhKind(t) === v) out.push(items[i]); }
  return out;
}
function wctlhSelect(doc, items) { try { doc.selection = null; } catch (e) {} for (var i = 0; i < items.length; i++) { try { items[i].selected = true; } catch (e2) {} } }

// ExtendScript には JSON がないので、数値・文字列・配列・オブジェクトだけを書き出す
function wctlhJSON(v) {
  if (v === null || v === undefined) return 'null';
  var t = typeof v;
  if (t === 'number') return isFinite(v) ? String(Math.round(v * 10000) / 10000) : 'null';
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'string') return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
  if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(wctlhJSON(v[i])); return '[' + a.join(',') + ']'; }
  var o = []; for (var k in v) if (v.hasOwnProperty(k)) o.push('"' + k + '":' + wctlhJSON(v[k])); return '{' + o.join(',') + '}';
}
function wctlhErr(msg) { return wctlhJSON({ ok: false, msg: msg }); }

// 形を書き出す：パスは点の一覧（アンカー・左右のハンドル・なめらかか）、グループと複合パスは入れ子
function wctlhExport(it, paths) {
  var t = it.typename;
  if (t === 'GroupItem') {
    var ch = [];
    for (var i = 0; i < it.pageItems.length; i++) ch.push(wctlhExport(it.pageItems[i], paths));
    return { t: 'G', clipped: !!it.clipped, ch: ch };
  }
  if (t === 'CompoundPathItem') {
    var ch2 = [];
    for (var j = 0; j < it.pathItems.length; j++) ch2.push(wctlhExport(it.pathItems[j], paths));
    return { t: 'C', ch: ch2 };
  }
  if (t === 'PathItem') {
    var pts = [], pp = it.pathPoints;
    for (var k = 0; k < pp.length; k++) {
      var q = pp[k];
      pts.push([q.anchor[0], q.anchor[1], q.leftDirection[0], q.leftDirection[1], q.rightDirection[0], q.rightDirection[1], q.pointType === PointType.SMOOTH ? 1 : 0]);
    }
    var ev = false; try { ev = !!it.evenodd; } catch (e) {}
    paths.push(it);
    return { t: 'P', i: paths.length - 1, closed: !!it.closed, filled: !!it.filled, clipping: !!it.clipping, guides: !!it.guides, evenodd: ev, pts: pts };
  }
  return { t: 'X' };
}

function wctlhState() { var st = $.global.WCTLH_STATE || null; if (!st) return null; try { for (var i = 0; i < st.dups.length; i++) { var x = st.dups[i].typename; } for (var j = 0; j < st.src.length; j++) { var y = st.src[j].typename; } } catch (e) { $.global.WCTLH_STATE = null; return null; } return st; }

function wctlhCancelAll(doc) {
  var prev = wctlhFind(doc, 'prev'), src = wctlhFind(doc, 'src');
  for (var i = prev.length - 1; i >= 0; i--) prev[i].remove();
  for (var j = 0; j < src.length; j++) { src[j].hidden = false; wctlhClearTag(src[j]); }
  $.global.WCTLH_STATE = null;
  return src;
}

function wctlhLoad() {
  try {
    if (app.documents.length === 0) return wctlhErr('ドキュメントが開かれていません');
    var doc = app.activeDocument, s0 = doc.selection || [], sel = [], srcAll = wctlhFind(doc, 'src');
    for (var i = 0; i < s0.length; i++) {
      var t = wctlhTag(s0[i]);
      if (t && wctlhKind(t) === 'prev') {
        // プレビューの字を選んだときは、その元の字を読み込み直す
        var id = wctlhId(t);
        for (var a = 0; a < srcAll.length; a++) if (wctlhId(wctlhTag(srcAll[a])) === id) { var dup = false; for (var b = 0; b < sel.length; b++) if (sel[b] === srcAll[a]) dup = true; if (!dup) sel.push(srcAll[a]); }
      } else sel.push(s0[i]);
    }
    var restored = wctlhCancelAll(doc);
    if (!sel.length) return wctlhJSON({ ok: false, restored: restored.length, msg: (restored.length ? '確定していないプレビューを元に戻しました。' : '') + '文字（グループ）を選択してから「選択を読み込む」を押してください' });
    var seq = new Date().getTime(), st = { src: sel, dups: [], paths: [] }, tree = [];
    for (var k = 0; k < sel.length; k++) {
      wctlhSetTag(sel[k], 'src#' + seq + '_' + k);
      var d = sel[k].duplicate(sel[k], ElementPlacement.PLACEBEFORE);
      wctlhSetTag(d, 'prev#' + seq + '_' + k); d.hidden = true;
      st.dups.push(d); tree.push(wctlhExport(d, st.paths));
    }
    $.global.WCTLH_STATE = st;
    wctlhSelect(doc, sel);
    return wctlhJSON({ ok: true, restored: restored.length, items: tree });
  } catch (e) { return wctlhErr('エラー: ' + e.message + (e.line ? '（行 ' + e.line + '）' : '')); }
}

// 書き込み：data = [{ i: パス番号, pts: [[ax, ay, lx, ly, rx, ry, なめらか], ...] }, ...]
function wctlhWrite(data) {
  try {
    var st = wctlhState(); if (!st) return wctlhErr('読み込んだ文字が見つかりません。もう一度「選択を読み込む」を押してください');
    var doc = app.activeDocument;
    for (var i = 0; i < data.length; i++) {
      var pi = st.paths[data[i].i], P = data[i].pts, n = P.length, pp = pi.pathPoints;
      if (pp.length !== n) { var an = []; for (var k = 0; k < n; k++) an.push([P[k][0], P[k][1]]); pi.setEntirePath(an); pp = pi.pathPoints; }
      for (var j = 0; j < n; j++) {
        var q = pp[j], v = P[j];
        q.pointType = v[6] ? PointType.SMOOTH : PointType.CORNER;
        q.anchor = [v[0], v[1]]; q.leftDirection = [v[2], v[3]]; q.rightDirection = [v[4], v[5]];
      }
    }
    for (var a = 0; a < st.dups.length; a++) st.dups[a].hidden = false;
    for (var b = 0; b < st.src.length; b++) st.src[b].hidden = true;
    wctlhSelect(doc, st.dups);
    app.redraw();
    return wctlhJSON({ ok: true });
  } catch (e) { return wctlhErr('エラー: ' + e.message + (e.line ? '（行 ' + e.line + '）' : '')); }
}

function wctlhUnpreview() {
  try {
    var st = wctlhState(); if (!st) return wctlhJSON({ ok: true });
    for (var a = 0; a < st.dups.length; a++) st.dups[a].hidden = true;
    for (var b = 0; b < st.src.length; b++) st.src[b].hidden = false;
    wctlhSelect(app.activeDocument, st.src); app.redraw();
    return wctlhJSON({ ok: true });
  } catch (e) { return wctlhErr('エラー: ' + e.message); }
}

function wctlhCommit() {
  try {
    var st = wctlhState(); if (!st) return wctlhErr('読み込んだ文字が見つかりません');
    for (var i = st.src.length - 1; i >= 0; i--) st.src[i].remove();
    for (var j = 0; j < st.dups.length; j++) { st.dups[j].hidden = false; wctlhClearTag(st.dups[j]); }
    wctlhSelect(app.activeDocument, st.dups);
    var n = st.dups.length; $.global.WCTLH_STATE = null; app.redraw();
    return wctlhJSON({ ok: true, committed: n });
  } catch (e) { return wctlhErr('エラー: ' + e.message); }
}

function wctlhCancel() {
  try {
    if (app.documents.length === 0) return wctlhJSON({ ok: true, restored: 0 });
    var doc = app.activeDocument, rs = wctlhCancelAll(doc);
    wctlhSelect(doc, rs); app.redraw();
    return wctlhJSON({ ok: true, restored: rs.length });
  } catch (e) { return wctlhErr('エラー: ' + e.message); }
}
