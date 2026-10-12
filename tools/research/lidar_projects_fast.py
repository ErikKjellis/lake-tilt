"""Parallel lookup of which lidar projects (Kartverket 'Høydedata Metadata prosjekt WMS') cover points.
Usage: python -I tools/lidar_projects_fast.py x1,y1 [x2,y2 ...]   (EPSG:25833)"""
import sys, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
URL = "https://wms.geonorge.no/skwms1/wms.hoyde-hoydedata-metadata-prosjekt"
LAYERS = ["NDH Altevatnet 2pkt 2021_1", "NDH Troms sør 4pkt 2016_1", "NDH Troms midt 4pkt 2016_1",
          "NDH Troms nord 4pkt 2016_1", "NDH Troms 4pkt 2017_1", "NDH Troms 4pkt 2014_1", "NDH Målselv 2pkt 2017_1",
          "Målselv 5pkt 2024_1", "Troms 2pkt 2014_1", "Troms 2pkt 2015_1", "Troms 5pkt 2015_1", "Troms 8pkt 2014_1",
          "Troms 10pkt 2014_1", "Troms 2013_1", "Troms 2010_1", "Troms 2009_1"] + [f"NHM Supplering Troms del{i}_1" for i in range(1, 9)]
KEYS = ("LAS_PROJECT_NAME", "OPPDRAGSGIVER", "FLYFIRMA", "TYPE", "PUNKTTETTHET", "AARSTALL", "SISTEFLYDATO", "HOYDESYSTEM")


def ask(args):
    layer, x, y = args
    q = {"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetFeatureInfo", "LAYERS": layer, "QUERY_LAYERS": layer,
         "STYLES": "", "CRS": "EPSG:25833", "BBOX": f"{x-50},{y-50},{x+50},{y+50}", "WIDTH": "101", "HEIGHT": "101",
         "I": "50", "J": "50", "INFO_FORMAT": "text/plain", "FEATURE_COUNT": "10"}
    try:
        with urllib.request.urlopen(URL + "?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote), timeout=90) as r:
            t = r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return layer, f"ERR {e}"
    lines = [l for l in t.splitlines() if l.strip() and not l.startswith("@")]
    if len(lines) < 2:
        return layer, None
    hdr = lines[0].split(";"); val = lines[1].split(";")
    d = dict(zip(hdr, val))
    return layer, {k: d.get(k) for k in KEYS}


pts = [tuple(float(v) for v in p.split(",")) for p in sys.argv[1:]]
jobs = [(l, x, y) for (x, y) in pts for l in LAYERS]
with ThreadPoolExecutor(8) as ex:
    res = list(ex.map(ask, jobs))
for (l, x, y), (_, r) in zip(jobs, res):
    if r:
        print(f"{x:.0f},{y:.0f}  {r}")
