"""Cultural heritage sites (kulturminner) for the render area: points, locality polygons and safety zones.

Source: Riksantikvaren, "Kulturminner - Lokaliteter, Enkeltminner og Sikringssoner"
        (WFS https://wfs.geonorge.no/skwms1/wfs.kulturminner, open data (NLOD), credit Riksantikvaren).
Code lists: https://register.geonorge.no/sosi-kodelister/kulturminner

Each site (lokalitet) is classified from the site and its individual monuments, in this order:
  sami    - protected as Sami heritage (KML §4 second paragraph: "Samisk kulturminne fra år 1917 eller eldre"),
            dated "Samisk jernalder", or (when not Stone Age / Early Metal Age dated) with a monument type
            diagnostic of Sami culture (árran, gamme, sieidi/offering site, reindeer fence, meat cache,
            bow-hunting stand ...)
  stone   - Stone Age and Early Metal Age: steinalder (all subdivisions), sein steinbrukende tid,
            tidlig metalltid, bronsealder, steinalder - bronsealder, senneolitikum - bronsealder,
            bronsealder - jernalder
  iron    - Iron Age and Middle Ages: jernalder (all subdivisions), middelalder (all subdivisions),
            jernalder - middelalder, yngre jernalder - middelalder, vikingtid - middelalder
  modern  - all datings after the Reformation (1537 or later)
  other   - everything else ("førreformatorisk tid", "eldre enn 100 år", uviss tid, undated)
Sites removed from the record (vernetype FJE) are skipped. Safety zones (sikringssoner) are linked to
their site through the number before the dash in kulturminneId.

Usage: python tools/fetch_kulturminner.py [tools/scene_config.json]
Writes data/raw/kulturminner/*.gml and web/data/<lake>/kulturminner.json
"""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import Polygon, MultiPolygon

ROOT = Path(__file__).resolve().parents[1]
WFS = "https://wfs.geonorge.no/skwms1/wfs.kulturminner"
REG = "https://register.geonorge.no/api/sosi-kodelister/kulturminner/{}.json"
NS = {"wfs": "http://www.opengis.net/wfs/2.0", "gml": "http://www.opengis.net/gml/3.2"}
APP = "{http://skjema.geonorge.no/SOSI/produktspesifikasjon/LokaliteterEnkeltminnerOgSikringssoner/20210217}"

STONE = {20, 21, 22, 23, 30, 31, 32, 60, 61, 70, 71, 72}
IRON = {40, 41, 42, 43, 44, 45, 46, 47, 50, 51, 52, 53, 73, 74, 75}
SAMI_DATES = {62}
# monument types that are diagnostic of Sami culture (used when the site is not Stone Age / Early Metal Age dated)
SAMI_TYPES = {"Arran", "Gammetuft", "Gamme", "Hellig sted", "Hellig fjell", "Offersted", "Offerstein", "Sieidi",
              "Gieddi-reingjerde", "Reingjerde", "Kjøttgjemme", "Bogastelle", "Stalotuft", "Goahti"}
CATEGORIES = {
    "sami": "Sami heritage (KML §4.2, Sami Iron Age, or Sami monument type)",
    "stone": "Stone Age and Early Metal Age",
    "iron": "Iron Age and Middle Ages",
    "modern": "Modern (after 1537)",
    "other": "Other / undated",
}


def is_modern(code: int) -> bool:
    return 100 <= code <= 201 and code not in (195, 196)


def classify(codes, sami, sami_type):
    cs = set(codes)
    if sami or (sami_type and not (STONE & cs)):
        return "sami"
    if STONE & cs:
        return "stone"
    if IRON & cs:
        return "iron"
    if codes and all(is_modern(c) for c in codes):
        return "modern"
    return "other"


def fetch(url: str, path: Path):
    if not path.exists() or path.stat().st_size < 1000:
        with urllib.request.urlopen(url, timeout=300) as r:
            path.write_bytes(r.read())
    return path


def codelist(name: str, raw: Path):
    p = fetch(REG.format(name), raw / "codes" / f"{name}.json")
    items = json.loads(p.read_text(encoding="utf-8")).get("containeditems", [])
    return {str(it.get("codevalue")): it.get("label") for it in items}


def text(el, path):
    e = el.find(path)
    return e.text.strip() if e is not None and e.text else None


def ring(poslist):
    return np.array(poslist.text.split(), float).reshape(-1, 2)


def geometry(el):
    """All polygons under 'område' as a shapely (Multi)Polygon in EPSG:25833."""
    polys = []
    for pg in el.find(f"{APP}område").iter("{http://www.opengis.net/gml/3.2}Polygon"):
        ext = pg.find("gml:exterior//gml:posList", NS)
        if ext is None:
            continue
        holes = [ring(h) for h in pg.findall("gml:interior//gml:posList", NS)]
        p = Polygon(ring(ext), holes)
        polys.append(p if p.is_valid else p.buffer(0))
    if not polys:
        return None
    return polys[0] if len(polys) == 1 else MultiPolygon([q for p in polys for q in getattr(p, "geoms", [p])])


def rings_of(geom, tol=0.3):
    """Simplified rings as [[[x, y], ...], ...] (exterior first, then holes) per polygon, 0.1 m precision."""
    g = shapely.simplify(geom, tol, preserve_topology=True)
    out = []
    for p in getattr(g, "geoms", [g]):
        if p.is_empty:
            continue
        rs = [p.exterior] + list(p.interiors)
        out.append([np.round(np.asarray(r.coords)[:-1, :2], 1).tolist() for r in rs])
    return out


def main():
    cfg = json.loads((Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "tools" / "scene_config.json").read_text(encoding="utf-8"))
    x0, y0, x1, y1 = cfg["render_bbox"]
    raw = ROOT / "data" / "raw" / "kulturminner"
    (raw / "codes").mkdir(parents=True, exist_ok=True)
    gml = {}
    for T in ("Lokalitet", "Enkeltminne", "Sikringssone"):
        q = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": f"app:{T}",
             "srsName": "urn:ogc:def:crs:EPSG::25833", "bbox": f"{x0},{y0},{x1},{y1},urn:ogc:def:crs:EPSG::25833", "count": 20000}
        gml[T] = fetch(WFS + "?" + urllib.parse.urlencode(q), raw / f"{T}.gml")
    dat = codelist("kulturminnedatering", raw)
    lart = codelist("kulturminnelokalitetart", raw)
    eart = codelist("kulturminneenkeltminneart", raw)

    # individual monuments grouped by site
    mons = {}
    for m in ET.parse(gml["Enkeltminne"]).getroot().findall("wfs:member", NS):
        e = m[0]
        lid = text(e, f"{APP}lokalitetId")
        codes = [int(d.text) for d in e.iter(f"{APP}datering") if d.text and d.text.strip().isdigit()]
        art = text(e, f"{APP}enkeltminneart")
        para = text(e, f".//{APP}verneparagraf") or ""
        mons.setdefault(lid, []).append({"dating": codes, "art": eart.get(str(int(art)) if art and art.isdigit() else art, art), "sami": para.startswith("4.2")})

    sites, skipped = [], Counter()
    for m in ET.parse(gml["Lokalitet"]).getroot().findall("wfs:member", NS):
        e = m[0]
        kid = text(e, f"{APP}kulturminneId") or ""
        lid = kid.split("-")[0]
        vtype = text(e, f".//{APP}vernetype")
        if vtype == "FJE":
            skipped["removed (FJE)"] += 1
            continue
        para = text(e, f".//{APP}verneparagraf") or ""
        ms = mons.get(lid, [])
        codes = sorted({c for mm in ms for c in mm["dating"]})
        sami = para.startswith("4.2") or any(mm["sami"] for mm in ms) or bool(SAMI_DATES & set(codes))
        sami_type = any(mm["art"] in SAMI_TYPES for mm in ms)
        geom = geometry(e)
        if geom is None:
            continue
        c = geom.representative_point() if not geom.centroid.within(geom) else geom.centroid
        x, y = c.x, c.y
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            continue
        art = text(e, f"{APP}lokalitetsart")
        info = text(e, f"{APP}informasjon") or ""
        sites.append({
            "id": kid, "lid": lid, "x": round(x, 1), "y": round(y, 1), "cat": classify(codes, sami, sami_type),
            "name": text(e, f"{APP}navn"),
            "art": lart.get(str(int(art)) if art and art.isdigit() else art, art),
            "dating": [dat.get(str(c), str(c)) for c in codes],
            "monuments": Counter(mm["art"] for mm in ms if mm["art"]).most_common(6),
            "n": len(ms) or int(text(e, f"{APP}antallEnkeltminner") or 1),
            "vern": para or vtype,
            "info": info[:400] + ("…" if len(info) > 400 else ""),
            "link": text(e, f"{APP}linkKulturminnesøk"),
            "poly": rings_of(geom),
            "area_m2": round(geom.area, 1),
        })

    by_lid = {s["lid"]: s for s in sites}
    zones, unlinked = [], 0
    for m in ET.parse(gml["Sikringssone"]).getroot().findall("wfs:member", NS):
        e = m[0]
        lid = (text(e, f"{APP}kulturminneId") or "").split("-")[0]
        site = by_lid.get(lid)
        if site is None:
            unlinked += 1           # zone of a removed site or a site outside the area
            continue
        geom = geometry(e)
        if geom is not None:
            zones.append({"lid": lid, "cat": site["cat"], "poly": rings_of(geom)})

    counts = Counter(s["cat"] for s in sites)
    out = ROOT / "web" / "data" / cfg["lake"] / "kulturminner.json"
    out.write_text(json.dumps({
        "source": "Riksantikvaren – Kulturminner, lokaliteter og sikringssoner (WFS wfs.geonorge.no/skwms1/wfs.kulturminner)",
        "licence": "Open data (Norsk lisens for offentlige data, NLOD); credit Riksantikvaren",
        "categories": CATEGORIES, "counts": counts, "skipped": skipped,
        "sites": sites, "zones": zones,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.2f} MB): {len(sites)} sites {dict(counts)}; "
          f"{len(zones)} safety zones ({unlinked} not linked); skipped {dict(skipped)}")
    other = Counter(d for s in sites if s["cat"] == "other" for d in (s["dating"] or ["(no dating)"]))
    print("datings in 'other':", other.most_common(10))


if __name__ == "__main__":
    main()
