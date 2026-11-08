import numpy as np, pandas as pd
df = pd.read_pickle('/home/claude/learn/all.pkl')
df = df[(df.co == 0) & (df.wt > 0) & (df.wt < 1000) & (df.wb > 0) & (df.cap == 1)]
df['e'] = df.nx ** 2
df['pred'] = df.e * (df.Vt - df.Vb) + (1 - df.e) * (df.Ht - df.Hb)
df = df[(df.pred.abs() > 6) & (df.s.abs() < 0.8 * df.wb + 20)]
df['capK'] = (-df.s) / (df.pred / 2)
df['dir'] = np.where(df.w > df.b, 'thick', 'thin')
ang = np.degrees(np.arctan2(np.abs(df.ny), np.abs(df.nx)))
df['typ'] = np.where((ang > 80) & ((df.y < 0.03) | (df.y > 0.97)), 'aligned', np.where(ang > 80, 'horiz', np.where(ang < 10, 'vert', 'oblique')))
cp = df.ch.map(ord); df['scr'] = np.where(df.k == 'latin', 'latin', np.where(cp >= 0x4E00, 'kanji', 'kana'))
g = df.groupby(['scr', 'typ', 'dir', 'f']).capK.median().reset_index()
s = g.groupby(['scr', 'typ', 'dir']).capK.agg(['count', 'median', 'min', 'max'])
print(s.round(3).to_string())
