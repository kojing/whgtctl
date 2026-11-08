"""Noto Sans JP からひらがな・カタカナ（kana.json）と英数字（latin.json）の輪郭を取り出す。

  curl -sSL -o NotoSansJP-Regular.otf https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf
  （Thin / Bold / Black も同様）
  pip install fonttools
  python3 extract_kana.py   → kana.json, latin.json, symj.json（和文記号）, syml.json（欧文記号）
"""
import json
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen

chars = [chr(c) for c in range(0x3041, 0x3097)] + [chr(c) for c in range(0x309D, 0x309F)] \
      + [chr(c) for c in range(0x30A1, 0x30FB)] + ['ー', 'ヽ', 'ヾ']
latin = [chr(c) for c in range(0x41, 0x5B)] + [chr(c) for c in range(0x61, 0x7B)] + [chr(c) for c in range(0x30, 0x3A)]
symj = list('、。・「」『』（）［］｛｝〈〉《》【】〔〕！？：；＋－×÷＝≠＜＞≦≧％＆＠＃＄￥※〒○●◎◇◆□■△▲▽▼☆★→←↑↓〜…々〆〇♪')
syml = list('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~')

def extract(chars):
  out = {}
  for w in ['Thin', 'Regular', 'Bold', 'Black']:
      f = TTFont('NotoSansJP-%s.otf' % w); gs = f.getGlyphSet(); cmap = f.getBestCmap(); hm = f['hmtx']
      d = {}
      for ch in chars:
          gn = cmap.get(ord(ch))
          if not gn: continue
          pen = DecomposingRecordingPen(gs); gs[gn].draw(pen)
          conts, cur = [], None
          for op, args in pen.value:
              if op == 'moveTo': cur = [[round(args[0][0]), round(args[0][1])]]
              elif op == 'lineTo': cur.append(['L'] + [round(v) for v in args[0]])
              elif op == 'curveTo': cur.append(['C'] + [round(v) for p in args for v in p])
              elif op in ('closePath', 'endPath'):
                  if cur and len(cur) > 1: conts.append(cur)
                  cur = None
          d[ch] = {'adv': hm[gn][0], 'c': conts}
      out[w] = d
  return out

json.dump(extract(chars), open('kana.json', 'w'), separators=(',', ':'), ensure_ascii=False)
json.dump(extract(latin), open('latin.json', 'w'), separators=(',', ':'), ensure_ascii=False)
json.dump(extract(symj), open('symj.json', 'w'), separators=(',', ':'), ensure_ascii=False)
json.dump(extract(syml), open('syml.json', 'w'), separators=(',', ':'), ensure_ascii=False)
