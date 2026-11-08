#!/usr/bin/env python3
"""scripts/OpticalCorrection.jsx の計算部分（エンジン＋入出力）を cep/whgtctl/js/engine.js に書き出す。
   パネル版とスクリプト版で同じ計算を使うため、エンジンを直したら毎回これを実行する。"""
import os, re
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.normpath(os.path.join(here, '..', '..'))
src = open(os.path.join(root, 'scripts', 'OpticalCorrection.jsx'), encoding='utf-8-sig').read()
a = src.index('/* ES3 用の最小ポリフィル'); a = src.rfind('\n', 0, a); a = src.rfind('\n', 0, a) + 1
b = src.index('/* 書類側の処理'); b = src.rfind('\n', 0, b); b = src.rfind('\n', 0, b) + 1
ver = re.search(r'OpticalCorrection\.jsx\s+(v[\d.]+)', src).group(1)
out = '/* 自動生成：tools/cep/build.py が scripts/OpticalCorrection.jsx ' + ver + ' から書き出したもの。直接編集しない */\n' + src[a:b]
open(os.path.join(root, 'cep', 'whgtctl', 'js', 'engine.js'), 'w', encoding='utf-8').write(out)
print('engine.js', len(out), 'bytes from', ver)
