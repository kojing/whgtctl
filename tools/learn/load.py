"""rec/*.jsonl を読み、フォントごとに最大 N 件に間引いて 1 つの parquet にまとめる"""
import json, glob, os, random
import pandas as pd
import sys
N = int(sys.argv[1]) if len(sys.argv) > 1 else 250000
random.seed(1)
frames = []
for fn in sorted(glob.glob('/home/claude/learn/rec/' + (sys.argv[2] if len(sys.argv) > 2 else '*') + '.jsonl')):
  lines = open(fn).read().splitlines()
  if len(lines) > N: lines = random.sample(lines, N)
  df = pd.DataFrame.from_records(json.loads(l) for l in lines if l)
  frames.append(df); print(os.path.basename(fn), len(df), flush=True)
df = pd.concat(frames, ignore_index=True)
for c in df.columns:
  if df[c].dtype == 'float64': df[c] = df[c].astype('float32')
df.to_pickle(sys.argv[3] if len(sys.argv) > 3 else '/home/claude/learn/all.pkl')
print(len(df))
