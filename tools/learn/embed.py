"""model.json を OpticalCorrection.jsx の @@MODEL_BEGIN〜@@MODEL_END の間に書き込む"""
import json, re, sys
jsx = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/whgtctl/scripts/OpticalCorrection.jsx'
mf = sys.argv[2] if len(sys.argv) > 2 else '/home/claude/learn/model2.json'
m = json.load(open(mf))
hv = json.load(open('/home/claude/learn/hv.json'))
kbw = {'latin': 0.67, 'jp': 0.43}   # 字面の幅の伸び ÷ 縦画の太さの変化（秘訣ノート 4・5）
# 木は [特徴, しきい値, 左, 右, 値] の配列にまとめて小さくする
trees = [{'f': t['f'], 'th': t['th'], 'l': t['l'], 'r': t['r'], 'v': t['v']} for t in m['trees']]
body = 'var WCTL_MODEL = ' + json.dumps({'feat': m['feat'], 'init': round(m['init'], 6), 'lr': m['lr'], 'trees': trees, 'hv': hv, 'kind': 'edge' if 'oe' in m['feat'] else 'q', 'kbw': kbw}, separators=(',', ':')) + ';'
s = open(jsx, encoding='utf-8-sig').read()
s2 = re.sub(r'(// @@MODEL_BEGIN\n).*?(\n// @@MODEL_END)', lambda mm: mm.group(1) + body + mm.group(2), s, flags=re.S)
assert s2 != s or body in s
open(jsx, 'w', encoding='utf-8-sig').write(s2)
print('embedded', len(body), 'bytes')
