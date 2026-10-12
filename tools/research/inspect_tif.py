"""Inspect a GeoTIFF: tags, georeferencing, value statistics.
Usage: python -I tools/inspect_tif.py file.tif [file2.tif ...]"""
import sys
import numpy as np
import tifffile

GEO_TAGS = {33550: "ModelPixelScale", 33922: "ModelTiepoint", 34264: "ModelTransformation",
            34735: "GeoKeyDirectory", 34736: "GeoDoubleParams", 34737: "GeoAsciiParams",
            42112: "GDAL_METADATA", 42113: "GDAL_NODATA"}

for fn in sys.argv[1:]:
    print("=" * 60, fn)
    with tifffile.TiffFile(fn) as tf:
        p = tf.pages[0]
        print("shape", p.shape, "dtype", p.dtype, "compression", p.compression, "sampleformat", p.sampleformat)
        for t in p.tags.values():
            if t.code in GEO_TAGS:
                v = t.value
                if isinstance(v, (tuple, list)) and len(v) > 40:
                    v = v[:40]
                print(f"  {GEO_TAGS[t.code]} ({t.code}): {v}")
        a = p.asarray()
    a = a.astype(np.float64)
    print("min", np.nanmin(a), "max", np.nanmax(a), "nan count", np.isnan(a).sum())
    vals, counts = np.unique(a, return_counts=True)
    order = np.argsort(counts)[::-1][:5]
    print("most common values:", [(vals[i], counts[i]) for i in order])
    finite = a[np.isfinite(a)]
    big = finite[np.abs(finite) > 1e4]
    print("values |v|>1e4:", big.size, (np.unique(big)[:5] if big.size else ""))
