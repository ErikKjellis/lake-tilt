"""Mosaic WCS tiles (written by fetch_dtm_wcs.py) into one grid.

Usage: python -I tools/mosaic_dtm.py TILEDIR OUTBASE [--zero-is-nodata | --zero-nodata-outside=a.json,b.json]
Writes OUTBASE.npy (float32, row 0 = north), OUTBASE.json (georef) and OUTBASE.tif (GeoTIFF,
same geokeys as the source tiles, GDAL_NODATA tag).

The Kartverket WCS returns 0.0 where the DTM has no data (e.g. Sweden). With --zero-is-nodata,
exact 0.0 cells are set to NODATA (-9999). That is only safe where no real sea-level cells
exist. With --zero-nodata-outside=poly1.json,poly2.json (GeoJSON or Kartverket kommuneinfo
'omrade' JSON, EPSG:25833) only 0.0 cells OUTSIDE the union of those polygons become NODATA, so
sea-level cells in Norwegian fjords stay 0 while missing data in Sweden become NODATA.
An extra OUTBASE_coverage.npy (uint8) is written: 0 = nodata, 1 = inside polygons (Norway),
2 = outside polygons but with data (Sweden).
"""
import json
import os
import sys
import numpy as np
import tifffile

NODATA = -9999.0


def main():
    tiledir, outbase = sys.argv[1], sys.argv[2]
    zero_nodata = "--zero-is-nodata" in sys.argv
    outside = [a.split("=", 1)[1] for a in sys.argv if a.startswith("--zero-nodata-outside=")]
    idx = json.load(open(os.path.join(tiledir, "index.json")))
    res = idx["res"]
    W, H = idx["width"], idx["height"]
    x0, y0b, x1, y1 = idx["bbox"]
    out = np.full((H, W), np.nan, dtype=np.float32)
    geotags = None
    for t in idx["tiles"]:
        fn = os.path.join(tiledir, t["file"])
        with tifffile.TiffFile(fn) as tf:
            p = tf.pages[0]
            a = p.asarray().astype(np.float32)
            scale = p.tags[33550].value
            tie = p.tags[33922].value
            assert abs(scale[0] - res) < 1e-9 and abs(scale[1] - res) < 1e-9, (fn, scale)
            assert abs(tie[3] - t["x0"]) < 1e-6 and abs(tie[4] - t["y1"]) < 1e-6, (fn, tie, t)
            assert a.shape == (t["height"], t["width"]), (fn, a.shape)
            if geotags is None:
                geotags = {c: p.tags[c].value for c in (34735, 34736, 34737) if c in p.tags}
        out[t["row0"]:t["row0"] + t["height"], t["col0"]:t["col0"] + t["width"]] = a
    assert not np.isnan(out).any(), "gap in mosaic"
    nz = int((out == 0).sum())
    cover = None
    if zero_nodata:
        out[out == 0] = NODATA
    elif outside:
        import shapely
        from shapely.geometry import shape
        from shapely.ops import unary_union
        polys = []
        for fn in outside[0].split(","):
            j = json.load(open(fn))
            if "omrade" in j:
                polys.append(shape(j["omrade"]))
            else:
                polys += [shape(f["geometry"]) for f in j["features"]]
        u = unary_union(polys)
        shapely.prepare(u)
        xs = x0 + (np.arange(W) + 0.5) * res
        ys = y1 - (np.arange(H) + 0.5) * res
        inside = np.zeros((H, W), bool)
        for r in range(0, H, 200):  # chunk rows to bound memory
            XX, YY = np.meshgrid(xs, ys[r:r + 200])
            inside[r:r + 200] = shapely.contains_xy(u, XX, YY)
        out[(out == 0) & ~inside] = NODATA
        cover = np.where(out == NODATA, 0, np.where(inside, 1, 2)).astype(np.uint8)
        np.save(outbase + "_coverage.npy", cover)
        zero_nodata = True
    valid = out != NODATA
    meta = {
        "description": "Kartverket NHM DTM (nhm_dtm_topo_25833) via Geonorge WCS 1.0.0, mosaicked",
        "source": idx["source"], "coverage": idx["coverage"], "interpolation": idx["interpolation"],
        "downloaded_utc": idx["downloaded_utc"],
        "crs": "EPSG:25833", "vertical_datum": "NN2000 (orthometric heights, m)",
        "x0": x0, "y0": y1, "dx": res, "dy": res,
        "x_east": x1, "y_south": y0b,
        "width": W, "height": H, "dtype": "float32", "nodata": NODATA if zero_nodata else None,
        "layout": "row 0 = north edge; cell (r,c) centre = (x0+(c+0.5)*dx, y0-(r+0.5)*dy); pixel-is-area",
        "gdal_geotransform": [x0, res, 0.0, y1, 0.0, -res],
        "zero_cells_in_source": nz,
        "valid_fraction": float(valid.mean()),
        "min_m": float(out[valid].min()), "max_m": float(out[valid].max()),
        "tiles_dir": os.path.relpath(tiledir, os.path.dirname(outbase) or "."),
    }
    if cover is not None:
        meta["coverage_file"] = os.path.basename(outbase) + "_coverage.npy"
        meta["coverage_codes"] = {"0": "nodata", "1": "inside polygons (Norway)", "2": "outside polygons, has data (Sweden)"}
        meta["coverage_fractions"] = {k: float((cover == int(k)).mean()) for k in ("0", "1", "2")}
        meta["nodata_polygons"] = outside[0].split(",")
    np.save(outbase + ".npy", out)
    json.dump(meta, open(outbase + ".json", "w"), indent=1)
    # GeoTIFF
    extratags = [(33550, "d", 3, (res, res, 0.0), False),
                 (33922, "d", 6, (0.0, 0.0, 0.0, x0, y1, 0.0), False)]
    for code, v in geotags.items():
        if code == 34735:
            extratags.append((code, "H", len(v), tuple(v), False))
        elif code == 34736:
            extratags.append((code, "d", len(v), tuple(v), False))
        else:
            extratags.append((code, "s", 0, v, False))
    if zero_nodata:
        extratags.append((42113, "s", 0, str(int(NODATA)), False))
    tifffile.imwrite(outbase + ".tif", out, extratags=extratags, compression="zlib",
                     predictor=3, tile=(256, 256), photometric="minisblack")
    print(json.dumps({k: v for k, v in meta.items() if k not in ("layout",)}, indent=1))


if __name__ == "__main__":
    main()
