"""Fetch sample map tiles / WMS images over Altevatnet and record CORS headers.
Usage: python -I tools/fetch_tile_samples.py OUTDIR
Writes images + OUTDIR/tile_tests.json (url, status, content-type, bytes, Access-Control-Allow-Origin)."""
import json, math, os, sys, urllib.request

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
ORIGIN = "http://localhost:8000"
# Kartverket WMTS utm33n: TopLeft (-2500000, 9045984), 256 px tiles, res(z) = 21664 / 2**z m/px
TLX, TLY, RES0 = -2500000.0, 9045984.0, 21664.0


def tile_index(x, y, z):
    span = 256 * RES0 / 2 ** z
    return int((TLY - y) // span), int((x - TLX) // span)  # row, col


def tile_bounds(row, col, z):
    span = 256 * RES0 / 2 ** z
    x0 = TLX + col * span; y1 = TLY - row * span
    return x0, y1 - span, x0 + span, y1


def get(url, fn):
    req = urllib.request.Request(url, headers={"Origin": ORIGIN, "User-Agent": "lake-tilt-research/0.1"})
    rec = {"url": url, "file": fn}
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
            rec.update(status=r.status, content_type=r.headers.get("Content-Type"), bytes=len(data),
                       acao=r.headers.get("Access-Control-Allow-Origin"),
                       cache_control=r.headers.get("Cache-Control"))
        with open(os.path.join(OUT, fn), "wb") as f:
            f.write(data)
    except Exception as e:  # noqa: BLE001
        rec.update(error=str(e))
    print(json.dumps(rec))
    return rec


recs = []
KV = "https://cache.kartverket.no/v1/wmts/1.0.0/{layer}/default/utm33n/{z}/{row}/{col}.png"
for layer in ("topo", "topograatone", "toporaster"):
    for z, (x, y) in [(6, (677000, 7614000)), (10, (657770, 7620980))]:
        row, col = tile_index(x, y, z)
        rec = get(KV.format(layer=layer, z=z, row=row, col=col), f"kv_{layer}_utm33n_z{z}_r{row}_c{col}.png")
        rec["tile_bounds_25833"] = tile_bounds(row, col, z)
        recs.append(rec)
# KVP form of the same tile
row, col = tile_index(657770, 7620980, 10)
recs.append(get("https://cache.kartverket.no/v1/service?service=WMTS&request=GetTile&version=1.0.0&layer=topo&style=default"
                f"&format=image/png&tileMatrixSet=utm33n&tileMatrix=10&tileRow={row}&tileCol={col}",
                f"kv_topo_kvp_z10_r{row}_c{col}.png"))
# webmercator tile of topo for comparison (z11 around the dam)
lon, lat = 18.883, 68.656
n = 2 ** 11
tx = int((lon + 180) / 360 * n); ty = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
recs.append(get(f"https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/11/{ty}/{tx}.png", f"kv_topo_3857_z11_{ty}_{tx}.png"))
# WMS: topo, NHM hillshade, NiB ortho (restricted!)
BB = "654000,7600000,700000,7626000"; W, H = 2048, 1158
recs.append(get(f"https://wms.geonorge.no/skwms1/wms.topo?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=topo&STYLES=&CRS=EPSG:25833&BBOX={BB}&WIDTH={W}&HEIGHT={H}&FORMAT=image/png", "wms_topo_altevatn_25833.png"))
recs.append(get(f"https://wms.geonorge.no/skwms1/wms.hoyde-dtm-nhm-25833?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=NHM_DTM_25833:skyggerelieff&STYLES=&CRS=EPSG:25833&BBOX={BB}&WIDTH={W}&HEIGHT={H}&FORMAT=image/png", "wms_nhm_dtm_skyggerelieff_altevatn_25833.png"))
recs.append(get(f"https://wms.geonorge.no/skwms1/wms.topograatone?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=topograatone&STYLES=&CRS=EPSG:25833&BBOX={BB}&WIDTH={W}&HEIGHT={H}&FORMAT=image/png", "wms_topograatone_altevatn_25833.png"))
# public-licence imagery alternatives (Web Mercator only)
recs.append(get(f"https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/11/{ty}/{tx}.jpg", f"eox_s2cloudless2023_3857_z11_{ty}_{tx}.jpg"))
recs.append(get(f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/11/{ty}/{tx}", f"esri_world_imagery_z11_{ty}_{tx}.jpg"))
json.dump(recs, open(os.path.join(OUT, "tile_tests.json"), "w"), indent=1)
