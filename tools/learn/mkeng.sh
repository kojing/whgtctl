#!/bin/sh
# $1: model json, $2: out engine js
cp /home/claude/whgtctl/scripts/OpticalCorrection.jsx /tmp/_e.jsx
python3 /home/claude/learn/embed.py /tmp/_e.jsx "$1" >/dev/null
python3 - "$2" <<'PY'
import sys
s=open('/tmp/_e.jsx',encoding='utf-8-sig').read().split('\n')
st=[i for i,l in enumerate(s) if 'ES3 用の最小ポリフィル' in l][0]-1
en=[i for i,l in enumerate(s) if 'Illustrator との入出力' in l][0]-1
open(sys.argv[1],'w').write('\n'.join(s[st:en])+'\n')
PY
