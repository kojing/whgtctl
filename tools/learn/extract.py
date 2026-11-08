"""Google Fonts の可変／静的フォントから、各ウェイトの輪郭を JSON に書き出す（3 次ベジェに統一）。
python3 -I extract.py  → data/<font>.json
"""
import json, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from fontTools.pens.recordingPen import DecomposingRecordingPen

FD = '/home/claude/learn/fonts'
OUT = '/home/claude/learn/data'
os.makedirs(OUT, exist_ok=True)

LATIN = [chr(c) for c in range(0x41, 0x5B)] + [chr(c) for c in range(0x61, 0x7B)] + [chr(c) for c in range(0x30, 0x3A)]
HIRA = [chr(c) for c in range(0x3041, 0x3094)]
KATA = [chr(c) for c in range(0x30A1, 0x30F5)] + ['ー']
KANJI = list('一二三十人入大小山川日月木水火土金年中国東西南北本学生先名円百千手目耳口足力右左上下天気雨田町村出見書話語読聞食飲行来帰会社員時間週曜電車道駅永')

LAT_FONTS = {
  'Inter': ('Inter[opsz,wght].ttf', {'opsz': 14}), 'Geist': ('Geist[wght].ttf', {}), 'DMSans': ('DMSans[opsz,wght].ttf', {'opsz': 14}),
  'WorkSans': ('WorkSans[wght].ttf', {}), 'PublicSans': ('PublicSans[wght].ttf', {}), 'HankenGrotesk': ('HankenGrotesk[wght].ttf', {}),
  'Onest': ('Onest[wght].ttf', {}), 'Manrope': ('Manrope[wght].ttf', {}), 'SourceSans3': ('SourceSans3[wght].ttf', {}),
}
JP_VAR = {'NotoSansJP': 'NotoSansJP[wght].ttf', 'MPLUS1': 'MPLUS1[wght].ttf', 'MPLUS2': 'MPLUS2[wght].ttf', 'Murecho': 'Murecho[wght].ttf'}
WN = {100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black'}
JP_STATIC = {'IBMPlexSansJP': ('IBMPlexSansJP-%s.ttf', [100, 200, 300, 400, 500, 600, 700]),
             'LINESeedJP': ('LINESeedJP-%s.ttf', [100, 400, 700, 800]),
             'ZenKakuGothicNew': ('ZenKakuGothicNew-%s.ttf', [300, 400, 500, 700, 900])}


class CubicPen(BasePen):
  """2 次ベジェを 3 次に直して記録する"""
  def __init__(self, gs):
    BasePen.__init__(self, gs); self.conts = []; self.cur = None
  def _moveTo(self, p): self.cur = [[round(p[0], 1), round(p[1], 1)]]
  def _lineTo(self, p): self.cur.append(['L', round(p[0], 1), round(p[1], 1)])
  def _curveToOne(self, a, b, c): self.cur.append(['C'] + [round(v, 1) for q in (a, b, c) for v in q])
  def _qCurveToOne(self, a, b):
    p0 = self._getCurrentPoint()
    c1 = (p0[0] + 2 / 3 * (a[0] - p0[0]), p0[1] + 2 / 3 * (a[1] - p0[1])); c2 = (b[0] + 2 / 3 * (a[0] - b[0]), b[1] + 2 / 3 * (a[1] - b[1]))
    self._curveToOne(c1, c2, b)
  def _closePath(self):
    if self.cur and len(self.cur) > 1: self.conts.append(self.cur)
    self.cur = None
  _endPath = _closePath


def glyphs(f, gs, chars):
  cmap = f.getBestCmap(); d = {}
  for ch in chars:
    gn = cmap.get(ord(ch))
    if not gn or gn not in gs: continue
    rp = DecomposingRecordingPen(gs); gs[gn].draw(rp)
    pen = CubicPen(gs); rp.replay(pen)
    if pen.conts: d[ch] = {'adv': round(gs[gn].width, 1), 'c': pen.conts}
  return d


def metrics(f):
  o = f['OS/2']; return {'upm': f['head'].unitsPerEm, 'asc': o.sTypoAscender, 'desc': o.sTypoDescender,
                         'cap': getattr(o, 'sCapHeight', 0), 'xh': getattr(o, 'sxHeight', 0)}


def var_font(name, fn, pin, chars, kind):
  f = TTFont(os.path.join(FD, fn)); ax = {a.axisTag: a for a in f['fvar'].axes}; w = ax['wght']
  ws = [x for x in range(100, 1000, 100) if w.minValue <= x <= w.maxValue]
  data = {'kind': kind, 'm': metrics(f), 'W': {}}
  for x in ws:
    loc = dict(pin); loc['wght'] = x
    data['W'][str(x)] = glyphs(f, f.getGlyphSet(location=loc), chars)
  return data


def static_font(name, pat, ws, chars, kind):
  data = {'kind': kind, 'W': {}}
  for x in ws:
    f = TTFont(os.path.join(FD, pat % WN[x])); data.setdefault('m', metrics(f))
    data['W'][str(x)] = glyphs(f, f.getGlyphSet(), chars)
  return data


only = sys.argv[1:]
for n, (fn, pin) in LAT_FONTS.items():
  if only and n not in only: continue
  json.dump(var_font(n, fn, pin, LATIN, 'latin'), open(os.path.join(OUT, n + '.json'), 'w'), separators=(',', ':'), ensure_ascii=False); print(n, flush=True)
for n, fn in JP_VAR.items():
  if only and n not in only: continue
  json.dump(var_font(n, fn, {}, HIRA + KATA + KANJI, 'jp'), open(os.path.join(OUT, n + '.json'), 'w'), separators=(',', ':'), ensure_ascii=False); print(n, flush=True)
for n, (pat, ws) in JP_STATIC.items():
  if only and n not in only: continue
  json.dump(static_font(n, pat, ws, HIRA + KATA + KANJI, 'jp'), open(os.path.join(OUT, n + '.json'), 'w'), separators=(',', ':'), ensure_ascii=False); print(n, flush=True)
