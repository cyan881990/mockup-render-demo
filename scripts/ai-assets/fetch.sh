#!/bin/sh
# Tải toàn bộ ảnh AI đã tạo về ./raw (chạy lại được, bỏ qua file đã có)
cd "$(dirname "$0")"
python3 - "$@" <<'PY'
import json, subprocess, sys, os
m = json.load(open('manifest.json'))
ok = fail = 0
for a in m['assets']:
    out = os.path.join('raw', a['name'] + '.png')
    if os.path.exists(out) and os.path.getsize(out) > 10000:
        print('skip', a['name']); ok += 1; continue
    r = subprocess.run(['curl','-f','-L','--max-time','90','-s','-o',out,a['url']])
    if r.returncode == 0 and os.path.getsize(out) > 10000:
        print('ok  ', a['name'], os.path.getsize(out)); ok += 1
    else:
        if os.path.exists(out): os.remove(out)
        print('FAIL', a['name']); fail += 1
print(f'--- {ok} ok, {fail} failed')
sys.exit(1 if fail else 0)
PY
