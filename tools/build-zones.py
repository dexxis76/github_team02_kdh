#!/usr/bin/env python3
"""호차 구역 외곽선(public/zones.json)을 만든다. api/_zones.js 의 구역을 바꾸면 이 스크립트를 다시 실행해서 갱신한다.
  필요: python3, shapely (pip install shapely)
  실행: python3 tools/build-zones.py
"""
import json, subprocess, os
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
zones = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(require('./api/_zones').ZONES))"], cwd=root))
gj = json.load(open(os.path.join(root, 'public/seoul-gyeonggi.json'), encoding='utf-8'))
geom = {f['properties']['n']: shape(f['geometry']).buffer(0.0005) for f in gj['features']}  # 틈을 메우고 합친다

def rnd(o):
    return [rnd(x) for x in o] if isinstance(o, (list, tuple)) else round(o, 4)

feats = []
for z in zones:
    u = unary_union([geom[d] for d in z['districts']]).simplify(0.0008, preserve_topology=True)
    c = u.centroid
    rp = c if u.contains(c) else u.representative_point()  # 라벨을 놓을 곳: 무게중심(구역 밖이면 구역 안쪽 점)
    g = mapping(u)
    feats.append({'type': 'Feature', 'properties': {'car': z['car'], 'name': z['name'], 'color': z['color'], 'lat': round(rp.y, 4), 'lon': round(rp.x, 4)},
                  'geometry': {'type': g['type'], 'coordinates': rnd(g['coordinates'])}})
out = os.path.join(root, 'public/zones.json')
json.dump({'type': 'FeatureCollection', 'features': feats}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('만든 구역', len(feats), '개 ->', out, os.path.getsize(out), 'bytes')
