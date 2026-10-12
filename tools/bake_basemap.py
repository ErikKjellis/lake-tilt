"""Bake Kartverket WMTS (UTM33N tile matrix set) tiles into one texture.

The 'utm33n' matrix set is EPSG:25833, so the mosaic maps onto the DEM by a
plain scale/offset.  Kartverket's open cache needs no key (CC BY 4.0,
credit "Kartverket").

Usage:
  python tools/bake_basemap.py LAYER ZOOM OUT.jpg [--width 6144] [--bbox x0 y0 x1 y1]
e.g.
  python tools/bake_basemap.py topo 11 web/data/altevatn/basemap_topo.jpg
"""
from __future__ import annotations

import argparse
import io
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = "https://cache.kartverket.no/v1/wmts/1.0.0/{layer}/default/utm33n/{z}/{row}/{col}.png"
ORIGIN_X, ORIGIN_Y = -2500000.0, 9045984.0
RES0 = 21664.0
TILE = 256


def fetch(url: str, path: Path, tries: int = 4) -> Path:
    if path.exists() and path.stat().st_size > 100:
        return path
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "lake-tilt-visualisation/0.1"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            Image.open(io.BytesIO(data)).verify()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return path
        except Exception as e:  # noqa: BLE001
            print(f"  retry {k + 1} {url}: {e}")
            time.sleep(2 * (k + 1))
    raise RuntimeError(url)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("layer")
    ap.add_argument("zoom", type=int)
    ap.add_argument("out")
    ap.add_argument("--width", type=int, default=6144)
    ap.add_argument("--bbox", type=float, nargs=4, default=None)
    a = ap.parse_args()
    if a.bbox is None:
        cfg = json.loads((ROOT / "tools" / "scene_config.json").read_text(encoding="utf-8"))
        a.bbox = cfg["render_bbox"]
    x0, y0, x1, y1 = a.bbox
    res = RES0 / 2 ** a.zoom
    span = TILE * res
    c0, c1 = int((x0 - ORIGIN_X) // span), int((x1 - ORIGIN_X) // span)
    r0, r1 = int((ORIGIN_Y - y1) // span), int((ORIGIN_Y - y0) // span)
    cache = ROOT / "data" / "raw" / "wmts" / a.layer / str(a.zoom)
    jobs = [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]
    print(f"{a.layer} z{a.zoom} ({res:.3f} m/px): {len(jobs)} tiles")
    with ThreadPoolExecutor(4) as ex:
        paths = list(ex.map(lambda rc: fetch(TEMPLATE.format(layer=a.layer, z=a.zoom, row=rc[0], col=rc[1]),
                                             cache / f"{rc[0]}_{rc[1]}.png"), jobs))
    mosaic = Image.new("RGB", ((c1 - c0 + 1) * TILE, (r1 - r0 + 1) * TILE), (255, 255, 255))
    for (r, c), p in zip(jobs, paths):
        mosaic.paste(Image.open(p).convert("RGB"), ((c - c0) * TILE, (r - r0) * TILE))
    # crop to the exact bbox (pixel coordinates relative to the mosaic origin)
    mx0, my0 = ORIGIN_X + c0 * span, ORIGIN_Y - r0 * span
    box = ((x0 - mx0) / res, (my0 - y1) / res, (x1 - mx0) / res, (my0 - y0) / res)
    height = round(a.width * (y1 - y0) / (x1 - x0))
    img = mosaic.resize((a.width, height), Image.LANCZOS, box=box)
    out = ROOT / a.out
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, quality=86, optimize=True, progressive=True)
    print(f"wrote {out.relative_to(ROOT)} {img.size} {out.stat().st_size / 1e6:.1f} MB "
          f"({(x1 - x0) / a.width:.2f} m/px)")


if __name__ == "__main__":
    main()
