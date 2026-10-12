"""Independent re-check of NKG2016LU present-day uplift rates over Altevatnet (adversarial review).

Written from scratch (does not import nkg_lib / uplift_rates).  Reads, as data only:
  data/raw/nkg2016lu_lm/extracted/NKG2016LU_{abs,lev,StdUnc}.gri   (GRAVSOFT grid, N->S rows, W->E)
  data/raw/nkg2016lu_lm/extracted/NKG2016LU_{abs,lev}.dat          (lat lon value)
  data/raw/nkg/eur_nkg_nkgrf17vel.tif                               (PROJ deformation grid)
  data/processed/uplift_rate_grid.json                              (the reviewed agent's output)

Usage: python -I tools/verify_uplift.py "<project_dir>"
"""
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import tifffile
from pyproj import Transformer

proj = Path(sys.argv[1])
ex = proj / "data/raw/nkg2016lu_lm/extracted"


# ---------------------------------------------------------------- readers
def read_gri(p):
    tok = p.read_text().split()
    la0, la1, lo0, lo1, dla, dlo = map(float, tok[:6])
    nla = int(round((la1 - la0) / dla)) + 1
    nlo = int(round((lo1 - lo0) / dlo)) + 1
    v = np.array(tok[6:6 + nla * nlo], float).reshape(nla, nlo)  # row 0 = north
    lat = la1 - np.arange(nla) * dla
    lon = lo0 + np.arange(nlo) * dlo
    return lat[::-1], lon, v[::-1, :]  # ascending lat


def read_dat(p):
    a = np.loadtxt(p)
    lat = np.unique(np.round(a[:, 0], 6)); lon = np.unique(np.round(a[:, 1], 6))
    g = np.full((lat.size, lon.size), np.nan)
    i = np.searchsorted(lat, np.round(a[:, 0], 6)); j = np.searchsorted(lon, np.round(a[:, 1], 6))
    g[i, j] = a[:, 2]
    return lat, lon, g


def bilinear(lat_ax, lon_ax, G, lat, lon):
    lat = np.atleast_1d(lat).astype(float); lon = np.atleast_1d(lon).astype(float)
    dla = lat_ax[1] - lat_ax[0]; dlo = lon_ax[1] - lon_ax[0]
    fi = (lat - lat_ax[0]) / dla; fj = (lon - lon_ax[0]) / dlo
    i = np.floor(fi).astype(int); j = np.floor(fj).astype(int)
    u = fi - i; w = fj - j
    return ((1 - u) * (1 - w) * G[i, j] + u * (1 - w) * G[i + 1, j]
            + (1 - u) * w * G[i, j + 1] + u * w * G[i + 1, j + 1])


grids = {}
for k in ("abs", "lev", "StdUnc"):
    grids[k] = read_gri(ex / f"NKG2016LU_{k}.gri")
LAT, LON, _ = grids["lev"]
print("GRI grid: lat %.4f..%.4f (%d), lon %.4f..%.4f (%d)" % (LAT[0], LAT[-1], LAT.size, LON[0], LON[-1], LON.size))
for k in ("abs", "lev"):
    la, lo, g = read_dat(ex / f"NKG2016LU_{k}.dat")
    print(f"  .dat vs .gri {k}: same axes {np.allclose(la, LAT) and np.allclose(lo, LON)}, "
          f"max|diff| {np.nanmax(np.abs(g - grids[k][2])):.2e}")

# ---------------------------------------------------------------- PROJ tif
tif = proj / "data/raw/nkg/eur_nkg_nkgrf17vel.tif"
with tifffile.TiffFile(tif) as tf:
    pg = tf.pages[0]
    arr = pg.asarray().astype(float)
    tags = {t.code: t.value for t in pg.tags.values()}
    print("TIF shape", arr.shape, "planar", pg.planarconfig)
    md = tags.get(42112, "")
    print("  GDAL_METADATA band descriptions/units:")
    for m in re.finditer(r'<Item name="(\w+)"(?: sample="(\d+)")?[^>]*>([^<]*)</Item>', md):
        if m.group(1) in ("DESCRIPTION", "UNITTYPE", "TYPE", "area_of_use", "target_crs_EPSG_code",
                          "source_crs_EPSG_code", "constant_offset_unit", "displacement_type"):
            print("   ", m.group(1), "sample", m.group(2), "=", m.group(3)[:80])
    print("  ModelTiepoint", tags.get(33922), "PixelScale", tags.get(33550))
    gk = tags.get(34735)
    if gk:
        keys = {gk[i]: gk[i + 3] for i in range(4, len(gk), 4)}
        print("  GTRasterTypeGeoKey(1025) =", keys.get(1025), "(1=PixelIsArea, 2=PixelIsPoint)")
        rtype = keys.get(1025)
if arr.ndim == 3 and arr.shape[0] != 3:
    arr = np.moveaxis(arr, -1, 0)
tp = tags[33922]; sc = tags[33550]
lon0_t, lat0_t = tp[3], tp[4]
if rtype == 1:  # area: tiepoint is the corner -> centres half a pixel in
    lon0_t += sc[0] / 2; lat0_t -= sc[1] / 2
nr, nc = arr.shape[1:]
tlat = lat0_t - np.arange(nr) * sc[1]; tlon = lon0_t + np.arange(nc) * sc[0]
print(f"  tif centre-of-pixel axes: lat {tlat[0]:.4f}..{tlat[-1]:.4f}, lon {tlon[0]:.4f}..{tlon[-1]:.4f}")
tifb = {b: (tlat[::-1], tlon, arr[b][::-1, :]) for b in range(3)}
for b in range(3):
    same_axes = np.allclose(tifb[b][0], LAT) and np.allclose(tifb[b][1], LON)
    d = np.nanmax(np.abs(tifb[b][2] - grids["abs"][2])) if same_axes else float("nan")
    print(f"  band {b}: range {np.nanmin(arr[b]):.3f}..{np.nanmax(arr[b]):.3f}; same axes as LU {same_axes}; max|band-LU_abs| {d:.2e}")

# ---------------------------------------------------------------- transforms
t_ll = Transformer.from_crs("EPSG:25833", "EPSG:4258", always_xy=True)
t_84 = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True)


def utm_inv_snyder(x, y, lon0=15.0):
    """Snyder (1987) inverse TM, GRS80 (independent of PROJ)."""
    a = 6378137.0; f = 1 / 298.257222101; e2 = f * (2 - f); ep2 = e2 / (1 - e2); k0 = 0.9996
    x = x - 500000.0
    M = y / k0
    mu = M / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    p1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
          + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    C1 = ep2 * math.cos(p1) ** 2; T1 = math.tan(p1) ** 2
    N1 = a / math.sqrt(1 - e2 * math.sin(p1) ** 2); R1 = a * (1 - e2) / (1 - e2 * math.sin(p1) ** 2) ** 1.5
    D = x / (N1 * k0)
    lat = p1 - (N1 * math.tan(p1) / R1) * (D ** 2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4 / 24
                                           + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6 / 720)
    lon = math.radians(lon0) + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
                                + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5 / 120) / math.cos(p1)
    return math.degrees(lon), math.degrees(lat)


def rate(kind, x, y, src="gri"):
    lon, lat = t_ll.transform(np.atleast_1d(x).astype(float), np.atleast_1d(y).astype(float))
    if src == "gri":
        la, lo, G = grids[kind]
    else:
        la, lo, G = tifb[2]
    return bilinear(la, lo, G, lat, lon)


pts = {
    "NW outlet (task coords)": (657700, 7621200),
    "SE end (task coords)": (696700, 7608700),
    "agent NW outlet": (657701.19, 7621216.70),
    "agent NW survey end": (660241.39, 7621665.40),
    "agent centroid": (679107.0, 7612800.5),
    "agent SE survey end": (692604.89, 7607948.32),
    "agent SE regulated end": (696701.64, 7608715.57),
    "Malselv ML site": (660993, 7659967),
}
print("\nPoint rates (mm/yr): lon lat [pyproj] | dlon,dlat Snyder-pyproj (m) | abs lev Ndot StdUnc | tif_up | nearest-node lev")
res = {}
for nm, (x, y) in pts.items():
    lon, lat = t_ll.transform(x, y)
    lo2, la2 = utm_inv_snyder(x, y)
    lo3, la3 = t_84.transform(x, y)
    dx_m = (lo2 - lon) * 111320 * math.cos(math.radians(lat)); dy_m = (la2 - lat) * 110600
    a_ = float(rate("abs", x, y)[0]); l_ = float(rate("lev", x, y)[0]); s_ = float(rate("StdUnc", x, y)[0])
    tu = float(rate(None, x, y, "tif")[0])
    i = int(np.argmin(np.abs(LAT - lat))); j = int(np.argmin(np.abs(LON - lon)))
    res[nm] = dict(lon=lon, lat=lat, abs=a_, lev=l_, sd=s_)
    print(f" {nm:26s} {lon:8.4f} {lat:8.4f} | {dx_m:5.1f},{dy_m:5.1f} | {a_:.3f} {l_:.3f} {a_ - l_:.3f} {s_:.3f} | {tu:.3f} | {grids['lev'][2][i, j]:.3f}"
          f"  (4326 vs 4258 diff {abs(lo3 - lon) * 1e9:.1f}e-9 deg)")

# ---------------------------------------------------------------- differences / gradients
nw, se = pts["NW outlet (task coords)"], pts["SE end (task coords)"]
L = math.hypot(se[0] - nw[0], se[1] - nw[1]) / 1000
dl = res["SE end (task coords)"]["lev"] - res["NW outlet (task coords)"]["lev"]
da = res["SE end (task coords)"]["abs"] - res["NW outlet (task coords)"]["abs"]
print(f"\nTask NW->SE: L = {L:.3f} km, d(lev) = {dl:.4f} mm/yr, d(abs) = {da:.4f}, along-axis grad lev {dl / L:.5f} mm/yr/km")
axis_grid = math.degrees(math.atan2(se[0] - nw[0], se[1] - nw[1])) % 360


def conv(lon, lat, lon0=15.0):
    return math.degrees(math.atan(math.tan(math.radians(lon - lon0)) * math.sin(math.radians(lat))))


cC = conv(res["agent centroid"]["lon"], res["agent centroid"]["lat"])
print(f"axis azimuth grid {axis_grid:.2f}, true {axis_grid + cC:.2f} (convergence {cC:.2f})")

# finite-difference gradient at centroid (central diff, 1 km)
xc, yc = pts["agent centroid"]
h = 1000.0
gx = (rate("lev", xc + h, yc)[0] - rate("lev", xc - h, yc)[0]) / 2
gy = (rate("lev", xc, yc + h)[0] - rate("lev", xc, yc - h)[0]) / 2
print(f"FD grad at centroid lev: |g| {math.hypot(gx, gy):.5f} mm/yr/km, az grid {math.degrees(math.atan2(gx, gy)) % 360:.1f}, "
      f"true {(math.degrees(math.atan2(gx, gy)) + cC) % 360:.1f}")


def plane(kind, x0, x1, y0, y1, step=1000.0):
    X, Y = np.meshgrid(np.arange(x0, x1 + 1, step), np.arange(y0, y1 + 1, step))
    R = rate(kind, X.ravel(), Y.ravel())
    A = np.column_stack([np.ones(X.size), (X.ravel() - X.mean()) / 1000, (Y.ravel() - Y.mean()) / 1000])
    c, *_ = np.linalg.lstsq(A, R, rcond=None)
    return c, float(np.std(R - A @ c))


c, rs = plane("lev", 640000, 710000, 7590000, 7640000)
gaz = math.degrees(math.atan2(c[1], c[2])) % 360
print(f"plane fit lev (agent box): |g| {math.hypot(c[1], c[2]):.5f}, az grid {gaz:.1f}, true {gaz + cC:.1f}, resid {rs:.4f}")
ua = math.radians(axis_grid)
print(f"  plane gradient component along axis: {c[1] * math.sin(ua) + c[2] * math.cos(ua):.5f} mm/yr/km; "
      f"angle axis-gradient {abs(gaz - axis_grid):.1f} deg")


def plane_ll(kind, lo0, lo1, la0, la1):
    LA, LO = np.meshgrid(np.arange(la0, la1 + 1e-9, 0.01), np.arange(lo0, lo1 + 1e-9, 0.02), indexing="ij")
    R = bilinear(grids[kind][0], grids[kind][1], grids[kind][2], LA.ravel(), LO.ravel())
    t_xy = Transformer.from_crs("EPSG:4258", "EPSG:25833", always_xy=True)
    X, Y = t_xy.transform(LO.ravel(), LA.ravel())
    A = np.column_stack([np.ones(X.size), (X - X.mean()) / 1000, (Y - Y.mean()) / 1000])
    cc, *_ = np.linalg.lstsq(A, R, rcond=None)
    cv = conv((lo0 + lo1) / 2, (la0 + la1) / 2)
    az_t = (math.degrees(math.atan2(cc[1], cc[2])) + cv) % 360
    return cc, cv, az_t


print("\nRegional lev gradients (plane fits in lon/lat boxes):")
for nm, box in {"Tornetrask basin 18.5-20.3E 68.1-68.5N": (18.5, 20.3, 68.1, 68.5),
                "Tornetrask lake proper 18.7-20.2E 68.2-68.45N": (18.7, 20.2, 68.2, 68.45),
                "Malangen-Balsfjord 17.5-19.5E 69.0-69.5N": (17.5, 19.5, 69.0, 69.5),
                "Ullsfjord-Lyngen 19.2-20.4E 69.4-69.9N": (19.2, 20.4, 69.4, 69.9),
                "Lofoten-Vesteralen 12.5-16.5E 67.8-69.2N": (12.5, 16.5, 67.8, 69.2),
                "Altevatn 18.8-19.9E 68.45-68.7N": (18.8, 19.9, 68.45, 68.7),
                "Akkajaure-Sitojaure 16.9-18.3E 67.3-67.8N": (16.9, 18.3, 67.3, 67.8)}.items():
    cc, cv, az_t = plane_ll("lev", *box)
    g = math.hypot(cc[1], cc[2])
    comp145 = cc[1] * math.sin(math.radians(145 - cv)) + cc[2] * math.cos(math.radians(145 - cv))
    print(f"  {nm:46s} mean {cc[0]:.2f} |g| {g:.5f} az_true {az_t:6.1f}  comp@145T {comp145:.5f}")

# ---------------------------------------------------------------- compare to the agent's grid file
gf = proj / "data/processed/uplift_rate_grid.json"
if gf.exists():
    G = json.loads(gf.read_text())
    xs = G["x0"] + np.arange(G["nx"]) * G["dx"]; ys = G["y0"] + np.arange(G["ny"]) * G["dy"]
    V = np.array(G["values"]).reshape(G["ny"], G["nx"]); Va = np.array(G["values_abs"]).reshape(G["ny"], G["nx"])
    X, Y = np.meshgrid(xs, ys)
    mine = rate("lev", X.ravel(), Y.ravel()).reshape(X.shape)
    mine_a = rate("abs", X.ravel(), Y.ravel()).reshape(X.shape)
    print(f"\nAgent grid file: {G['nx']}x{G['ny']}; max|agent lev - mine| {np.max(np.abs(V - mine)):.2e}; "
          f"max|agent abs - mine| {np.max(np.abs(Va - mine_a)):.2e}; lev range {V.min():.3f}..{V.max():.3f}")
    # agent's row order claim: row 0 = y0 (south). Check orientation by comparing flipped
    print(f"  flipped-rows max diff (should be large if orientation right): {np.max(np.abs(V[::-1] - mine)):.3f}")
    print("  plane_fit_lev in file:", G.get("plane_fit_lev"))

json.dump({k: v for k, v in res.items()}, sys.stdout if False else open(proj / "scratch" / "verify_uplift_points.json", "w"), indent=1)
