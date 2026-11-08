import json, sys
rows=[json.loads(l) for l in open(sys.argv[1]) if l.startswith('{')]
d={}
for r in rows: d[(r['f'],r['src'],r['dst'],r['ex']['learn'])]=r['mean']
tot0=tot1=0
for (f,a,b,L),v in sorted(d.items()):
  if L==0 and (f,a,b,1) in d:
    v1=d[(f,a,b,1)]; tot0+=v; tot1+=v1
    print('%-18s %s→%s  なし %.2f  学習 %.2f  %+.0f%%'%(f,a,b,v,v1,100*(v1/v-1)))
print('合計 %.1f → %.1f (%+.0f%%)'%(tot0,tot1,100*(tot1/tot0-1)))
