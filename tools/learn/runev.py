import json, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
jobs=[l.split() for l in open(sys.argv[1]) if l.strip()]
def run(j):
  f,a,b,ex,eng=j
  r=subprocess.run(['node','evalfont.js',f,a,b,ex,eng],capture_output=True,text=True)
  return r.stdout.strip() or r.stderr[-300:]
with ThreadPoolExecutor(2) as ex:
  out=list(ex.map(run,jobs))
open(sys.argv[2],'w').write('\n'.join(out)+'\n')
