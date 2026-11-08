"""demo/noto-kana.html を組み立てる：python3 build_demo.py（kana.json・latin.json と scripts/OpticalCorrection.jsx が必要）"""
import os
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.join(here, '..', '..')
jsx = open(os.path.join(root, 'scripts', 'OpticalCorrection.jsx'), encoding='utf-8-sig').read()
a = jsx.rfind('/* =====', 0, jsx.index('/* ES3 用の最小ポリフィル')); b = jsx.rfind('/* =====', 0, jsx.index('/* Illustrator との入出力'))
t = open(os.path.join(here, 'app_template.html')).read()
import json
F = json.load(open(os.path.join(here, 'kana.json')))
Lt = json.load(open(os.path.join(here, 'latin.json')))
SJ = json.load(open(os.path.join(here, 'symj.json')))
SL = json.load(open(os.path.join(here, 'syml.json')))
CS = {'hira': [c for c in F['Regular'] if 0x3041 <= ord(c) <= 0x309F], 'kata': [c for c in F['Regular'] if 0x30A0 <= ord(c) <= 0x30FF],
      'latn': list(Lt['Regular'].keys()), 'symj': list(SJ['Regular'].keys()), 'syml': list(SL['Regular'].keys())}
for w in F: F[w].update(Lt[w]); F[w].update(SJ[w]); F[w].update(SL[w])
t = t.replace('/*__CHARSETS__*/null', json.dumps(CS, ensure_ascii=False)).replace('/*__FONTS__*/null', json.dumps(F, separators=(',', ':'), ensure_ascii=False)).replace('/*__ENGINE__*/', jsx[a:b]).replace('/*__LOADER__*/', open(os.path.join(here, 'loader.js')).read())
open(os.path.join(root, 'demo', 'noto-kana.html'), 'w').write(t)
