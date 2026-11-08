"""秘訣の候補（仮説）をフォントごとに測り、共通するか（秘訣）・ばらつくか（癖）を見る"""
import numpy as np, pandas as pd, json, sys
df = pd.read_pickle('/home/claude/learn/all.pkl')
df = df[(df.co == 0) & (df.wt > 0) & (df.wt < 1000) & (df.wb > 0)]
df['e'] = df.nx ** 2                                   # 1：縦画（左右の辺）、0：横画（上下の辺）
df['dV'] = df.Vt - df.Vb; df['dH'] = df.Ht - df.Hb
df['pred'] = df.e * df.dV + (1 - df.e) * df.dH          # 「その向きの基本の画と同じだけ太さが変わる」とした予測
df['dw'] = df.wt - df.wb
df['dir'] = np.where(df.w > df.b, 'thick', 'thin')
df['rel'] = df.wb / (df.e * df.Vb + (1 - df.e) * df.Hb)  # その場所の太さ ÷ 基本の画の太さ
cp = df.ch.map(lambda c: ord(c))
df['scr'] = np.where(df.k == 'latin', np.where(cp < 0x3A, 'num', np.where(cp < 0x5B, 'UC', 'lc')), np.where(cp >= 0x4E00, 'kanji', 'kana'))
ok = (df.pred.abs() > 6) & (df.s.abs() < 0.8 * df.wb + 20)
d = df[ok].copy()
d['q'] = d.dw / d.pred
fonts = sorted(d.f.unique())
R = {}

def per_font(mask, val, name, agg=np.median, minn=200):
  out = {}
  for f in fonts:
    for dr in ['thick', 'thin']:
      m = mask & (d.f == f) & (d.dir == dr)
      v = val[m]
      if len(v) >= minn: out[(f, dr)] = float(agg(v))
  R[name] = out
  return out

body = (d.cap == 0) & (d.rel < 1.6) & (d.dCcv > 0.6 * d.Vb) & (d.dCap > 0.6 * d.Vb)   # 合流部・線端から離れた、ふつうの画の途中

# 1. 縦横の比：ウェイトとともに横画/縦画の比はどう変わるか（フォント単位の値）
st = df.groupby(['f', 'w']).agg(V=('Vt', 'first'), H=('Ht', 'first'), Vb=('Vb', 'first'), Hb=('Hb', 'first')).reset_index()
st['HV'] = st.H / st.V
R['HV'] = {f: {int(r.w): round(float(r.HV), 3) for r in st[st.f == f].itertuples()} for f in st.f.unique()}

# 2. 曲線（外に膨らむ所）とまっすぐな所
per_font(body & (d.line == 1), d.q, 'q_line')
per_font(body & (d.line == 0) & (d.cur > 0.002), d.q, 'q_curve_convex')
per_font(body & (d.line == 0) & (d.cur < -0.002), d.q, 'q_curve_concave')
# 3. 斜め（向き 25〜65°）
ang = np.degrees(np.arctan2(np.abs(d.ny), np.abs(d.nx)))
per_font(body & (ang > 25) & (ang < 65), d.q, 'q_diag')
per_font(body & ((ang <= 10) | (ang >= 80)), d.q, 'q_orth')
# 4. 合流部（切れ込みの角）からの距離
for lo, hi in [(0, 0.3), (0.3, 0.6), (0.6, 1.2), (1.2, 99)]:
  per_font((d.cap == 0) & (d.dCcv >= lo * d.Vb) & (d.dCcv < hi * d.Vb) & (d.dCap > 0.6 * d.Vb), d.q, 'q_junc_%s_%s' % (lo, hi))
# 5. 線端：線端の辺がどれだけ動くか（側面の動き＝太さの変化の半分に対する比）。正：画が伸びる
capm = (d.cap == 1)
d['capK'] = (-d.s) / (d.pred / 2)
per_font(capm, d.capK, 'capK')
# 6. ふところ（向かいの白）の狭さ
for lo, hi in [(0, 0.7), (0.7, 1.5), (1.5, 3), (3, 1e9)]:
  per_font(body & (d.gap >= lo * d.Vb) & (d.gap < hi * d.Vb), d.q, 'q_gap_%s_%s' % (lo, hi))
# 7. 文字の種類
for sc in ['UC', 'lc', 'num', 'kana', 'kanji']:
  per_font(body & (d.scr == sc), d.q, 'q_scr_' + sc)
# 8. 太いところほど多く太るか（比例か、足し算か）：局所の太さと変化量の傾き
def slope(mask):
  out = {}
  for f in fonts:
    for dr in ['thick', 'thin']:
      m = mask & (d.f == f) & (d.dir == dr)
      x = (d.rel[m]); y = d.q[m]
      if len(x) > 500 and x.std() > 0.05: out[(f, dr)] = float(np.polyfit(x, y, 1)[0])
  return out
R['slope_rel'] = slope(body & (d.rel > 0.7) & (d.rel < 1.5))
# 9. どちら側に太るか：上下の辺（横画）で、字の外側の辺はどれだけ動くか（1：左右均等）
side = body & (d.e < 0.1)
d['share'] = (-d.s) / (d.dw / 2)
per_font(side & (d.gap >= 1000) & (d.ny > 0), d.share, 'share_outer_bottom')   # 法線が上向き＝下側の辺（字の外）
per_font(side & (d.gap >= 1000) & (d.ny < 0), d.share, 'share_outer_top')
per_font(side & (d.gap < 1000), d.share, 'share_inner_h')
side2 = body & (d.e > 0.9)
per_font(side2 & (d.gap >= 1000), d.share, 'share_outer_v')
per_font(side2 & (d.gap < 1000), d.share, 'share_inner_v')
# 10. 字幅：字面の幅の伸び（基本の画の太さの変化に対する比）
g = df.drop_duplicates(['f', 'ch', 'w'])
g = g[(g.w != g.b)]
g['kw'] = (g.bw1 - g.bw0) / (g.Vt - g.Vb)
g['ka'] = (g.adv1 - g.adv0) / (g.Vt - g.Vb)
R['k_bboxw'] = {(f, dr): float(np.median(g[(g.f == f) & ((g.w > g.b) == (dr == 'thick'))].kw)) for f in fonts for dr in ['thick', 'thin'] if len(g[(g.f == f) & ((g.w > g.b) == (dr == 'thick'))])}
R['k_adv'] = {(f, dr): float(np.median(g[(g.f == f) & ((g.w > g.b) == (dr == 'thick'))].ka)) for f in fonts for dr in ['thick', 'thin'] if len(g[(g.f == f) & ((g.w > g.b) == (dr == 'thick'))])}

kinds = dict(df.groupby('f').k.first())
def summarize(name):
  v = R[name]
  rows = []
  for dr in ['thick', 'thin']:
    for kd in ['latin', 'jp']:
      xs = [v[(f, dr)] for f in fonts if (f, dr) in v and kinds[f] == kd]
      if xs: rows.append((dr, kd, len(xs), np.median(xs), np.min(xs), np.max(xs)))
  return rows

out = {}
for name in R:
  if name == 'HV': continue
  out[name] = {'%s/%s' % (f, dr): round(v, 3) for (f, dr), v in R[name].items()}
  for r in summarize(name):
    print('%-22s %-5s %-5s n=%2d  med %6.3f  [%6.3f .. %6.3f]' % ((name,) + r))
json.dump({'per_font': out, 'HV': R['HV'], 'kinds': kinds}, open('/home/claude/learn/rules_raw.json', 'w'), ensure_ascii=False, indent=1)
print('HV')
for f in fonts: print(' ', f, R['HV'][f])
