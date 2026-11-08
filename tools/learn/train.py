"""辺ごとの太さの変化の倍率 q（＝その向きの基本の画と同じだけ変わるとき 1）を予測する決定木モデル。
書体ごとに同じ件数ずつ使い（1 書体の癖に引っぱられないように）、1 書体ずつ抜いて検証する。
→ model.json（JSX に埋め込む形）"""
import numpy as np, pandas as pd, json, sys
from sklearn.ensemble import GradientBoostingRegressor

df = pd.read_pickle('/home/claude/learn/all.pkl')
df = df[(df.co == 0) & (df.cap == 0) & (df.wt > 0) & (df.wt < 1000) & (df.wb > 0)]
df['e'] = df.nx ** 2
df['pred'] = df.e * (df.Vt - df.Vb) + (1 - df.e) * (df.Ht - df.Hb)
df = df[(df.pred.abs() > 6) & (df.s.abs() < 0.8 * df.wb + 20)]
std = df.e * df.Vb + (1 - df.e) * df.Hb
X = pd.DataFrame({
  'e': df.e,
  'rel': np.clip(df.wb / std, 0, 2.5),
  'gap': np.clip(df.gap / df.Vb, 0, 10),
  'gapO': np.clip(df.gapO / df.Vb, 0, 10),
  'line': df.line,
  'cur': np.clip(df.cur * df.Vb, -3, 3),
  'dcv': np.clip(df.dCcv / df.Vb, 0, 5),
  'dcp': np.clip(df.dCap / df.Vb, 0, 5),
  'jp': (df.k == 'jp').astype(int),
  'lr': np.log(df.Vt / df.Vb),
  'y': df.y,
})
FEAT = list(X.columns)
q = np.clip((df.wt - df.wb) / df.pred, 0, 2.5).values
fonts = df.f.values
uf = sorted(set(fonts))
rng = np.random.default_rng(0)
PER = int(sys.argv[1]) if len(sys.argv) > 1 else 25000

def pick(exclude=None):
  idx = []
  for f in uf:
    if f == exclude: continue
    ii = np.where(fonts == f)[0]
    idx.append(rng.choice(ii, min(PER, len(ii)), replace=False))
  return np.concatenate(idx)

def fit(idx):
  m = GradientBoostingRegressor(loss='huber', alpha=0.9, n_estimators=120, max_depth=4, learning_rate=0.1, subsample=0.7, min_samples_leaf=200, random_state=0)
  m.fit(X.values[idx], q[idx]); return m

if '--lofo' in sys.argv:
  rows = []
  for f in uf:
    m = fit(pick(exclude=f))
    ii = np.where(fonts == f)[0]; ii = rng.choice(ii, min(40000, len(ii)), replace=False)
    pr = m.predict(X.values[ii]); y = q[ii]
    pred = df.pred.values[ii]
    # 太さの誤差（u）：倍率の誤差 × 基本の変化量
    e0 = np.median(np.abs((1 - y) * pred)); e1 = np.median(np.abs((pr - y) * pred))
    rows.append((f, e0, e1)); print('%-18s base %.2fu  model %.2fu  (%.0f%%)' % (f, e0, e1, 100 * (e1 / e0 - 1)), flush=True)
  print('mean base %.3f model %.3f' % (np.mean([r[1] for r in rows]), np.mean([r[2] for r in rows])))

m = fit(pick())
imp = sorted(zip(FEAT, m.feature_importances_), key=lambda x: -x[1])
print('importance', [(a, round(b, 3)) for a, b in imp])
trees = []
for est in m.estimators_[:, 0]:
  t = est.tree_
  trees.append({'f': t.feature.tolist(), 'th': [round(float(v), 5) for v in t.threshold], 'l': t.children_left.tolist(), 'r': t.children_right.tolist(), 'v': [round(float(v[0][0]), 5) for v in t.value]})
init = float(m.init_.constant_[0][0]) if hasattr(m.init_, 'constant_') else float(np.median(q))
json.dump({'feat': FEAT, 'init': init, 'lr': m.learning_rate, 'trees': trees}, open('/home/claude/learn/model.json', 'w'), separators=(',', ':'))
# 確認用：同じ入力での予測値
chk = X.values[:5]; print('check', json.dumps({'x': chk.round(5).tolist(), 'y': m.predict(chk.round(5)).round(6).tolist()}))
