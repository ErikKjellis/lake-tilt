"""Download all features of an ArcGIS REST MapServer layer intersecting an EPSG:25833 bbox (paged).
Usage: python -I tools/fetch_arcgis_layer.py LAYER_URL X0 Y0 X1 Y1 OUT.geojson [where]"""
import json, sys, urllib.parse, urllib.request
url, out = sys.argv[1], sys.argv[6]
bbox = ",".join(sys.argv[2:6])
where = sys.argv[7] if len(sys.argv) > 7 else "1=1"
feats, off = [], 0
while True:
    q = {"geometry": bbox, "geometryType": "esriGeometryEnvelope", "inSR": 25833, "spatialRel": "esriSpatialRelIntersects",
         "where": where, "outFields": "*", "outSR": 25833, "f": "geojson", "resultOffset": off, "resultRecordCount": 1000,
         "orderByFields": "objectid"}
    with urllib.request.urlopen(url.rstrip("/") + "/query?" + urllib.parse.urlencode(q), timeout=180) as r:
        j = json.load(r)
    if "error" in j:
        raise RuntimeError(j)
    fs = j.get("features", [])
    feats += fs
    if len(fs) < 1000 and not j.get("exceededTransferLimit") and not j.get("properties", {}).get("exceededTransferLimit"):
        break
    off += len(fs)
json.dump({"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "EPSG:25833"}},
           "source": url, "bbox_25833": [float(v) for v in sys.argv[2:6]], "features": feats},
          open(out, "w", encoding="utf-8"), ensure_ascii=False)
print(out, len(feats))
