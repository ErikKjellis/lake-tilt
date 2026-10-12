"""Interpolate a deglaciation age at Altevatnet between DATED-1 11 ka and 10 ka 'mc' margins (distance-weighted).
Usage: python -I tools/dated1_interp.py <DATED-1_TimeSlices_kmz.zip>
"""
import io, sys, zipfile
import xml.etree.ElementTree as ET
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union, transform
from pyproj import Transformer

K = "{http://www.opengis.net/kml/2.2}"
outer = zipfile.ZipFile(sys.argv[1])
kmz = zipfile.ZipFile(io.BytesIO(outer.read([n for n in outer.namelist() if n.endswith('.kmz')][0])))
root = ET.fromstring(kmz.read([n for n in kmz.namelist() if n.endswith('.kml')][0]))
tr = Transformer.from_crs(4326, 25833, always_xy=True).transform
def cc(e): return [tuple(map(float, c.split(',')[:2])) for c in e.text.split()]
geoms = {}
for f in root.iter(K + "Folder"):
    nm = f.find(K + "name")
    if nm is None or nm.text not in ("TS10_mc", "TS11_mc", "TS10_min", "TS10_max", "TS11_min", "TS11_max"):
        continue
    polys = []
    for pg in f.iter(K + "Polygon"):
        ob = pg.find(f".//{K}outerBoundaryIs//{K}coordinates")
        p = Polygon(cc(ob)).buffer(0)
        if p.area > 1:  # deg^2 -> keep main ice body only
            polys.append(p)
    geoms[nm.text] = transform(tr, unary_union(polys))
pts = {"NW outlet": (657701, 7621217), "SE end": (696702, 7608716)}
for k, (x, y) in pts.items():
    P = Point(x, y)
    out = {}
    for g, G in geoms.items():
        out[g] = (("in" if G.contains(P) else "out"), round(G.boundary.distance(P) / 1000, 1))
    d10 = out["TS10_mc"][1]; d11 = out["TS11_mc"][1]
    age = 10.0 + d10 / (d10 + d11)  # linear in distance between margins
    print(k, out, "-> linear-interp age %.2f ka" % age)
