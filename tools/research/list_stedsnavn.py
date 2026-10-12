"""List harvested place names with UTM33 coords, sorted by x. Usage: python tools/list_stedsnavn.py FILE"""
import json, sys
from pyproj import Transformer
tr = Transformer.from_crs(4258, 25833, always_xy=True)
d = json.load(open(sys.argv[1], encoding="utf-8"))
rows = []
for nm in d:
    p = nm["representasjonspunkt"]; lat, lon = p["nord"], p["øst"]
    x, y = tr.transform(lon, lat)
    names = " / ".join(s["skrivemåte"] for s in nm["stedsnavn"])
    rows.append((x, y, lat, lon, nm["navneobjekttype"], names))
for r in sorted(rows):
    if r[4] in ("Eiendom", "Bruk", "Adressenavn", "Gard"): continue
    print("%8.0f %9.0f %.5f %.5f %-22s %s" % r)
