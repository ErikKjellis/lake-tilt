"""Test whether Altevatnet points lie inside DATED-1 ice-sheet time-slice polygons.
Usage: python -I tools/dated1_check.py <DATED-1_TimeSlices_kmz.zip>
"""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

outer = zipfile.ZipFile(sys.argv[1])
kmzname = [n for n in outer.namelist() if n.endswith(".kmz")][0]
kmz = zipfile.ZipFile(io.BytesIO(outer.read(kmzname)))
kmlname = [n for n in kmz.namelist() if n.endswith(".kml")][0]
root = ET.fromstring(kmz.read(kmlname))
ns = {"k": "http://www.opengis.net/kml/2.2"}

pts = {"NW outlet": (18.885, 68.658), "SE end": (19.818, 68.522), "Torneträsk (Abisko)": (18.83, 68.35),
       "Setermoen": (18.35, 68.86), "Narvik": (17.43, 68.44)}


def coords(el):
    txt = el.text.strip().split()
    return [tuple(map(float, c.split(",")[:2])) for c in txt]


def walk(el, path):
    for ch in el:
        tag = ch.tag.split("}")[1]
        if tag in ("Folder", "Document"):
            nm = ch.find("k:name", ns)
            walk(ch, path + [nm.text if nm is not None else "?"])
        elif tag == "Placemark":
            nm = ch.find("k:name", ns)
            name = nm.text if nm is not None else "?"
            polys = []
            for pg in ch.iter("{http://www.opengis.net/kml/2.2}Polygon"):
                ob = pg.find(".//k:outerBoundaryIs//k:coordinates", ns)
                holes = [coords(h) for h in pg.findall(".//k:innerBoundaryIs//k:coordinates", ns)]
                try:
                    polys.append(Polygon(coords(ob), holes).buffer(0))
                except Exception:
                    pass
            if not polys:
                continue
            geom = unary_union(polys)
            label = " / ".join(path[1:] + [name])
            if not re.search(r"\b(1[0-3])\b|1[0-3] ?ka|1[0-3]ka", label):
                continue
            res = {k: geom.contains(Point(*v)) for k, v in pts.items()}
            d = {k: round(geom.exterior.distance(Point(*v)) if geom.geom_type == "Polygon" else geom.boundary.distance(Point(*v)), 3) for k, v in pts.items()}
            print(f"{label:60s} inside-ice: {res}")


walk(root, ["root"])
