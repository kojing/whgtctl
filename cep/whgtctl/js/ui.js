/* whgtctl CEP パネルの画面 */
(function () {
  var boot = document.getElementById('boot'); if (boot) boot.parentNode.removeChild(boot);
  window.onerror = function (m, src, line) { var st = document.getElementById('status'); if (st) { st.textContent = 'エラー: ' + m + '（' + (src || '').split('/').pop() + ' ' + line + '行）'; st.className = 'err'; } };
  var SPEC = [
    { t: 'ウェイト', items: [
      ['W', '縦画の太さ（元の StdVW 比）', 10, 200, 100, '%'],
      ['mg', 'カウンター保護（最小の空き）', 0, 80, 35, '%'],
      ['cp', 'カウンター保持（字幅で吸収）', 0, 100, 0, '%'],
      ['ext', '線端の伸び（太った量に対して）', 0, 100, 50, '%'],
      ['learn', '学習モデル（16 書体から学んだ太り方）', 0, 100, 0, '%'],
      ['ox', '外側へ太る割合（左右の輪郭）', 0, 100, 50, '%'],
      ['oy', '外側へ太る割合（上下の輪郭）', 0, 100, 10, '%'] ] },
    { t: '太さの均一化', items: [
      ['uni', '揃える強さ', 0, 100, 0, '%'],
      ['tol', '揃える範囲（基準からのずれ）', 5, 80, 30, '%'] ] },
    { t: '縦横の比率', items: [
      ['ratio', '横画 / 縦画', 30, 130, 94, '%'],
      ['dg', '斜画を細く', 0, 30, 0, '%'] ] },
    { t: '線端（ターミナル）', items: [
      ['flare', 'フレア（線端の広がり・線の太さ比）', 0, 100, 0, '%'],
      ['flen', 'フレアの長さ（線の太さ比）', 50, 600, 250, '%'],
      ['tround', '線端の丸み', 0, 100, 0, '%'],
      ['tang', '線端の角度', -45, 45, 0, '°'] ] },
    { t: '光学補正・精度（u = メトリクス高さの 1/700）', items: [
      ['os', 'オーバーシュート（頂点・曲線）', 0, 30, 0, 'u'],
      ['oc', '光学的中心（中央の横画）', 0, 40, 0, 'u'],
      ['prec', '曲線の許容誤差（揃えないとき）', 1, 8, 2, 'u'] ] }
  ];
  var P = {}, DEF = {}, ctl = {};
  var $ = function (id) { return document.getElementById(id); };
  var core = new WctlCore(), loaded = false, busy = false, pending = false, nUpd = 0;

  // Illustrator 側の関数を呼ぶ（結果は JSON 文字列）
  function host(code, cb) {
    if (!window.__adobe_cep__) { status('Illustrator の中で開いてください', true); return; }
    window.__adobe_cep__.evalScript(code, function (res) {
      var r; try { r = JSON.parse(res); } catch (e) { r = { ok: false, msg: 'Illustrator からの応答を読めませんでした: ' + res }; }
      cb(r);
    });
  }
  function status(t, err) { var s = $('status'); s.textContent = t || ''; s.className = err ? 'err' : ''; }

  // スライダーを作る
  var root = $('sliders');
  SPEC.forEach(function (sec) {
    var h = document.createElement('h2'); h.textContent = sec.t; root.appendChild(h);
    sec.items.forEach(function (it) {
      var k = it[0]; P[k] = DEF[k] = it[4];
      var row = document.createElement('div'); row.className = 'row';
      var lb = document.createElement('label'); lb.textContent = it[1] + '（' + it[5] + '）';
      var sl = document.createElement('input'); sl.type = 'range'; sl.min = it[2]; sl.max = it[3]; sl.step = 1; sl.value = it[4];
      var nb = document.createElement('input'); nb.type = 'number'; nb.min = it[2]; nb.max = it[3]; nb.value = it[4];
      sl.addEventListener('input', function () { P[k] = +sl.value; nb.value = sl.value; schedule(); });
      nb.addEventListener('change', function () { var v = Math.max(it[2], Math.min(it[3], +nb.value || 0)); P[k] = v; sl.value = v; nb.value = v; schedule(); });
      row.appendChild(lb); row.appendChild(sl); row.appendChild(nb); root.appendChild(row);
      ctl[k] = { sl: sl, nb: nb };
    });
  });
  // 「水平・垂直に揃える」を線端の欄（角度の下）へ
  (function () { var c = $('cbSnap').parentNode, after = ctl.tang.sl.parentNode; after.parentNode.insertBefore(c, after.nextSibling); })();
  function setVal(k, v) { P[k] = v; if (ctl[k]) { ctl[k].sl.value = v; ctl[k].nb.value = v; } }

  function opts() {
    var pm = $('pts').value;
    return { script: $('script').value, base: parseFloat($('base').value), top: parseFloat($('top').value), compat: pm !== 'free', fine: pm === 'fine' || pm === 'opt', simp: pm === 'opt' };
  }
  function params() {
    var o = opts();
    return { W: P.W / 100, uni: P.uni / 100, tol: P.tol / 100, ratio: P.ratio / 100, dg: P.dg / 100, mg: P.mg / 100, cp: P.cp / 100, ext: P.ext / 100, learn: P.learn / 100,
      outX: P.ox / 100, outY: P.oy / 100, tiny: 0.35, smooth: 5, os: P.os, oc: P.oc, prec: P.prec, compat: o.compat, fine: o.fine, simp: o.simp, lockM: $('cbLock').checked,
      flare: P.flare / 100, flen: P.flen / 100, tround: P.tround / 100, tang: P.tang, tsnap: $('cbSnap').checked };
  }
  function setBusy(b) { busy = b; $('bLoad').disabled = $('bApply').disabled = $('bCancel').disabled = b; }

  // 変形してから Illustrator に書き込む。書き込み中に値が変わったら、終わってから最新の値でもう一度
  function preview(done) {
    if (!loaded) { if (done) done({ ok: false }); return; }
    if (busy) { pending = true; return; }
    if (!$('cbPrev').checked && !done) return;
    var t0 = Date.now(), res;
    try { res = core.deform(opts(), params()); } catch (e) { status('エラー: ' + e.message, true); return; }
    var t1 = Date.now();
    setBusy(true);
    host('wctlhWrite(' + JSON.stringify(res.data) + ')', function (r) {
      setBusy(false); nUpd++;
      if (!r.ok) status(r.msg, true);
      else status('プレビュー ' + nUpd + ' 回目 ・ 計算 ' + (t1 - t0) + 'ms ・ 書き込み ' + (Date.now() - t1) + 'ms ・ アンカー ' + res.anchors);
      if (done) done(r);
      if (pending) { pending = false; preview(); }
    });
  }
  var raf = 0;
  function schedule() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; preview(); }); }
  function showInfo() {
    var j = core.job, u = 1 / j.scale;
    $('info').textContent = 'グリフ ' + j.glyphs.length + ' 個 ／ StdVW ' + (j.ST.V * u).toFixed(1) + ' pt ・ StdHW ' + (j.ST.H * u).toFixed(1) + ' pt（横/縦 ' + Math.round(j.ST.ratio * 100) + '%）';
  }
  function resetInfo() { $('info').textContent = '文字（グループ）を選択して「選択を読み込む」'; }

  $('bLoad').addEventListener('click', function () {
    status('読み込み中…'); setBusy(true);
    host('wctlhLoad()', function (r) {
      setBusy(false);
      if (!r.ok) { loaded = false; resetInfo(); status(r.msg, true); return; }
      core.setTree(r.items);
      $('base').value = ''; $('top').value = '';
      try { core.analyze(opts()); } catch (e) { loaded = false; status('エラー: ' + e.message, true); return; }
      $('base').value = core.met.base.toFixed(2); $('top').value = core.met.top.toFixed(2);
      core.key = core.keyOf(opts());
      $('cbLock').checked = core.job.glyphs.length >= 5;
      setVal('ratio', Math.round(core.job.ST.ratio * 100)); DEF.ratio = P.ratio;
      loaded = true; nUpd = 0; showInfo();
      status((r.restored ? '確定していなかったプレビューを元に戻しました ・ ' : '') + '読み込みました');
      preview();
    });
  });
  $('bApply').addEventListener('click', function () {
    if (!loaded) { status('先に文字を読み込んでください', true); return; }
    status('適用中…');
    preview(function (r) {
      if (!r.ok) return;
      host('wctlhCommit()', function (r2) {
        if (!r2.ok) { status(r2.msg, true); return; }
        loaded = false; resetInfo(); status('適用しました（' + r2.committed + ' 個）。次の文字を選択して「選択を読み込む」');
      });
    });
  });
  $('bCancel').addEventListener('click', function () {
    host('wctlhCancel()', function (r) { loaded = false; resetInfo(); status(r.ok ? '元に戻しました（' + r.restored + ' 個）' : r.msg, !r.ok); });
  });
  $('cbPrev').addEventListener('change', function () {
    if ($('cbPrev').checked) preview();
    else if (loaded) host('wctlhUnpreview()', function () { status('プレビュー：オフ（適用すると現在の値で変形します）'); });
  });
  $('script').addEventListener('change', function () { var o = SCRIPT_OUT[$('script').value]; setVal('ox', o[0]); setVal('oy', o[1]); DEF.ox = o[0]; DEF.oy = o[1]; schedule(); });
  ['base', 'top'].forEach(function (id) { $(id).addEventListener('change', schedule); });
  ['pts', 'cbLock', 'cbSnap'].forEach(function (id) { $(id).addEventListener('change', schedule); });
  $('bReset').addEventListener('click', function () { for (var k in DEF) setVal(k, DEF[k]); schedule(); });
})();
