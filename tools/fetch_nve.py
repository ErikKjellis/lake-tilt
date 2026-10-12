"""Download the NVE lake data the pipeline needs into data/raw/ (EPSG:25833 GeoJSON).

Source: NVE Innsjødatabase, https://kart.nve.no/enterprise/rest/services/Innsjodatabase2/MapServer
NVE terms: credit NVE; depth maps are for non-commercial use and not for navigation.

Usage: python tools/fetch_nve.py [vatnLnr=2396] [lake=altevatn]
"""
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://kart.nve.no/enterprise/rest/services/Innsjodatabase2/MapServer"
LAYERS = {1: "dybdepunkt", 2: "dybdekurve", 3: "omkrets_dybdemalt", 4: "dybdekart", 5: "innsjo"}


def query(layer, **params):
    q = {"outFields": "*", "returnGeometry": "true", "outSR": 25833, "f": "geojson", **params}
    with urllib.request.urlopen(f"{BASE}/{layer}/query?" + urllib.parse.urlencode(q), timeout=180) as r:
        return json.load(r)


def main():
    lnr = int(sys.argv[1]) if len(sys.argv) > 1 else 2396
    lake = sys.argv[2] if len(sys.argv) > 2 else "altevatn"
    raw = ROOT / "data" / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    for layer, name in LAYERS.items():
        j = query(layer, where=f"vatnlnr={lnr}")
        (raw / f"{lake}_{name}.geojson").write_text(json.dumps(j, ensure_ascii=False), encoding="utf-8")
        print(f"{lake}_{name}: {len(j.get('features', []))} features")
    if lnr == 2396:
        # Leinavatnet (Davit + Lulit Lenesjávri), tracked as a separate lake without depth data
        j = query(5, where="vatnlnr=2402")
        (raw / "leinavatn_innsjo.geojson").write_text(json.dumps(j, ensure_ascii=False), encoding="utf-8")
        print("leinavatn_innsjo:", len(j["features"]))


if __name__ == "__main__":
    main()
