"""Download Kartverket NHM DTM (bare-earth terrain model) from Geonorge WCS 1.0.0 in tiles.

Endpoint : https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833
Coverage : nhm_dtm_topo_25833  (native 1 m grid, EPSG:25833, float32)
Server limit (DescribeCoverage dimensionLimit): 3840 columns x 2160 rows per request.

Usage:
  python -I tools/fetch_dtm_wcs.py OUTDIR X0 Y0 X1 Y1 RES TILE_COLS TILE_ROWS [interp]
e.g.
  python -I tools/fetch_dtm_wcs.py data/raw/dtm/tiles_10m 646000 7594000 708000 7634000 10 1550 2000 bilinear
Each tile is saved as OUTDIR/dtm_<res>m_<x0>_<y0>.tif plus an index.json listing all tiles.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

URL = "https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833"
COVERAGE = "nhm_dtm_topo_25833"
MAX_COLS, MAX_ROWS = 3840, 2160


def fetch(url, path, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "lake-tilt-research/0.1"})
            with urllib.request.urlopen(req, timeout=300) as r:
                ctype = r.headers.get("Content-Type", "")
                data = r.read()
            if not ctype.startswith("image/tiff") or data[:2] not in (b"II", b"MM"):
                raise RuntimeError(f"unexpected response {ctype}: {data[:300]!r}")
            with open(path, "wb") as f:
                f.write(data)
            return len(data)
        except Exception as e:  # noqa: BLE001
            print(f"   attempt {k + 1} failed: {e}")
            time.sleep(5 * (k + 1))
    raise RuntimeError(f"giving up on {url}")


def main():
    outdir = sys.argv[1]
    x0, y0, x1, y1 = (float(v) for v in sys.argv[2:6])
    res = float(sys.argv[6])
    tcols, trows = int(sys.argv[7]), int(sys.argv[8])
    interp = sys.argv[9] if len(sys.argv) > 9 else "bilinear"
    assert tcols <= MAX_COLS and trows <= MAX_ROWS
    os.makedirs(outdir, exist_ok=True)
    ncols = round((x1 - x0) / res)
    nrows = round((y1 - y0) / res)
    tiles = []
    for r0 in range(0, nrows, trows):
        for c0 in range(0, ncols, tcols):
            w = min(tcols, ncols - c0)
            h = min(trows, nrows - r0)
            tx0 = x0 + c0 * res
            ty1 = y1 - r0 * res
            tx1 = tx0 + w * res
            ty0 = ty1 - h * res
            params = {
                "service": "WCS", "version": "1.0.0", "request": "GetCoverage",
                "coverage": COVERAGE, "CRS": "EPSG:25833", "RESPONSE_CRS": "EPSG:25833",
                "BBOX": f"{tx0:.0f},{ty0:.0f},{tx1:.0f},{ty1:.0f}",
                "WIDTH": str(w), "HEIGHT": str(h), "FORMAT": "GeoTIFF",
                "INTERPOLATION": interp,
            }
            url = URL + "?" + urllib.parse.urlencode(params)
            fn = os.path.join(outdir, f"dtm_{res:g}m_{tx0:.0f}_{ty0:.0f}.tif")
            if os.path.exists(fn) and os.path.getsize(fn) > 1000:
                print("exists", fn)
            else:
                t = time.time()
                n = fetch(url, fn)
                print(f"got {fn} {w}x{h} {n / 1e6:.1f} MB in {time.time() - t:.1f}s")
            tiles.append({"file": os.path.basename(fn), "x0": tx0, "y1": ty1, "x1": tx1, "y0": ty0,
                          "width": w, "height": h, "col0": c0, "row0": r0, "url": url})
    meta = {"source": URL, "coverage": COVERAGE, "res": res, "interpolation": interp,
            "bbox": [x0, y0, x1, y1], "width": ncols, "height": nrows, "crs": "EPSG:25833",
            "downloaded_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "tiles": tiles}
    with open(os.path.join(outdir, "index.json"), "w") as f:
        json.dump(meta, f, indent=1)


if __name__ == "__main__":
    main()
