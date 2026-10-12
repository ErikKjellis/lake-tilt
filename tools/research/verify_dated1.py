"""Independent check: are Altevatn points inside DATED-1 (Hughes et al. 2016) 10/11 ka ice polygons
(min / mc / max folders)?  Also distance from each point to the nearest ice margin of that slice.
Usage: python -I tools/verify_dated1.py "<DATED-1_TimeSlices_kmz.zip>"
"""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET

import shapely
from pyproj import Transformer
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

K = "{http://www.opengis.net/kml/2.2}"
z = zipfile.ZipFile(sys.argv[1])
kmz = zipfile.ZipFile(io.BytesIO(z.read([n for n in z.namelist() if n.endswith(".kmz")][0])))
root = ET.fromstring(kmz.read([n for n in kmz.namelist() if n.endswith(".kml")][0]))
tr = Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True)
pts = {"NW outlet": (18.8850, 68.6579), "SE end": (19.8179, 68.5214), "Abisko": (18.83, 68.35)}


def rings(pg, which):
    return [[tuple(map(float, s.split(",")[:2])) for s in c.text.split()]
            for c in pg.findall(f".//{K}{which}//{K}coordinates")]


for top in root.iter(K + "Folder"):
    nm = top.find(K + "name").text
    if not nm.startswith("TS1") or nm[2:4] not in ("10", "11"):
        continue
    polys = []
    for pg in top.iter(K + "Polygon"):
        ob = rings(pg, "outerBoundaryIs")
        if ob:
            polys.append(Polygon(ob[0], rings(pg, "innerBoundaryIs")).buffer(0))
    g = unary_union(polys)
    gu = shapely.transform(g, lambda c: __import__("numpy").column_stack(tr.transform(c[:, 0], c[:, 1])))
    out = []
    for p, (lo, la) in pts.items():
        P = Point(*tr.transform(lo, la))
        out.append(f"{p}: {'ICE ' if gu.contains(P) else 'free'} {gu.boundary.distance(P) / 1000:5.1f} km")
    print(f"{nm:10s} " + " | ".join(out))
