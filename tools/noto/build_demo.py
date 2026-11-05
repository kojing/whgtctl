"""demo/noto-kana.html を組み立てる：python3 build_demo.py（kana.json・latin.json と scripts/OpticalCorrection.jsx が必要）"""
import os
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.join(here, '..', '..')
jsx = open(os.path.join(root, 'scripts', 'OpticalCorrection.jsx'), encoding='utf-8-sig').read()
a = jsx.rfind('/* =====', 0, jsx.index('/* ES3 用の最小ポリフィル')); b = jsx.rfind('/* =====', 0, jsx.index('/* Illustrator との入出力'))
t = open(os.path.join(here, 'app_template.html')).read()
import json
F = json.load(open(os.path.join(here, 'kana.json')))
Lt = json.load(open(os.path.join(here, 'latin.json')))
for w in F: F[w].update(Lt[w])
t = t.replace('/*__FONTS__*/null', json.dumps(F, separators=(',', ':'), ensure_ascii=False)).replace('/*__ENGINE__*/', jsx[a:b]).replace('/*__LOADER__*/', open(os.path.join(here, 'loader.js')).read())
open(os.path.join(root, 'demo', 'noto-kana.html'), 'w').write(t)
