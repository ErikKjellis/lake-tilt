"""Collect Kartverket place names (stedsnavn API v1, /punkt, radius<=5000 m) covering an EPSG:25833 bbox.
Usage: python -I tools/fetch_stedsnavn.py OUTDIR X0 Y0 X1 Y1
Grid of query points spaced 7 km (5 km radius circles cover the squares), deduplicated by stedsnummer,
clipped to the bbox. Writes OUTDIR/stedsnavn_bbox.json (raw records) and OUTDIR/stedsnavn_bbox.geojson."""
import json, os, sys, time, urllib.parse, urllib.request
from pyproj import Transformer

out = sys.argv[1]; X0, Y0, X1, Y1 = (float(v) for v in sys.argv[2:6])
os.makedirs(out, exist_ok=True)
tr = Transformer.from_crs(25833, 4258, always_xy=True)
API = "https://ws.geonorge.no/stedsnavn/v1/punkt"
step = 7000.0
recs = {}
nq = 0
y = Y0 + step / 2
while y < Y1 + step / 2:
    x = X0 + step / 2
    while x < X1 + step / 2:
        lon, lat = tr.transform(x, y)
        side = 1
        while True:
            q = {"nord": f"{lat:.6f}", "ost": f"{lon:.6f}", "koordsys": 4258, "radius": 5000,
                 "utkoordsys": 25833, "treffPerSide": 500, "side": side}
            for k in range(4):
                try:
                    with urllib.request.urlopen(API + "?" + urllib.parse.urlencode(q), timeout=60) as r:
                        j = json.load(r)
                    break
                except Exception as e:  # noqa: BLE001
                    print("retry", e); time.sleep(3 * (k + 1))
            else:
                raise RuntimeError(q)
            nq += 1
            for n in j.get("navn", []):
                recs[n["stedsnummer"]] = n
            md = j["metadata"]
            if md["viserTil"] >= md["totaltAntallTreff"]:
                break
            side += 1
        x += step
    y += step
feats = []
keep = []
for n in recs.values():
    p = n["representasjonspunkt"]; px, py = p["øst"], p["nord"]
    if not (X0 <= px <= X1 and Y0 <= py <= Y1):
        continue
    keep.append(n)
    names = n.get("stedsnavn", [])
    main = next((s for s in names if s.get("navnestatus") == "hovednavn"), names[0] if names else {})
    feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [px, py]},
                  "properties": {"stedsnummer": n["stedsnummer"], "navn": main.get("skrivemåte"),
                                 "sprak": main.get("språk"), "navneobjekttype": n.get("navneobjekttype"),
                                 "alle_navn": "; ".join(f"{s.get('skrivemåte')} ({s.get('språk')})" for s in names)}})
meta = {"source": API, "license": "CC BY 4.0, Kartverket (Sentralt stedsnavnregister, SSR)",
        "bbox_25833": [X0, Y0, X1, Y1], "queries": nq, "count": len(keep),
        "fetched_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
json.dump({"metadata": meta, "navn": keep}, open(os.path.join(out, "stedsnavn_bbox.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
json.dump({"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "EPSG:25833"}},
           "metadata": meta, "features": feats},
          open(os.path.join(out, "stedsnavn_bbox.geojson"), "w", encoding="utf-8"), ensure_ascii=False)
from collections import Counter
print(meta)
print(Counter(f["properties"]["navneobjekttype"] for f in feats).most_common(25))
