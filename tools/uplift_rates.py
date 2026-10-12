"""Sample NKG2016LU uplift-rate grids over Altevatnet and write data/processed/uplift_rate_grid.json.

Inputs (downloaded, treated as data only):
  data/raw/nkg/eur_nkg_nkgrf17vel.tif                       PROJ CDN NKG_RF17vel (band 3 = up, = NKG2016LU_abs)
  data/raw/nkg2016lu_lm/extracted/NKG2016LU_{abs,lev,StdUnc}.dat   Lantmateriet distribution (lat lon value)

Usage: python -I tools/uplift_rates.py <project_dir>
"""
import json
import sys
from pathlib import Path

import numpy as np
import tifffile
from pyproj import Transformer
from scipy.interpolate import RegularGridInterpolator

proj = Path(sys.argv[1])
raw = proj / "data" / "raw"
out = proj / "data" / "processed"
out.mkdir(parents=True, exist_ok=True)

# ---------------- read grids ----------------
LAT = 49.0 + np.arange(313) / 12.0          # ascending
LON = 0.0 + np.arange(301) / 6.0


def read_dat(p):
    a = np.loadtxt(p)
    lat, lon, v = a[:, 0], a[:, 1], a[:, 2]
    g = np.full((313, 301), np.nan)
    i = np.rint((lat - 49.0) * 12).astype(int)
    j = np.rint(lon * 6).astype(int)
    g[i, j] = v
    return g


lmdir = raw / "nkg2016lu_lm" / "extracted"
grids = {k: read_dat(lmdir / f"NKG2016LU_{k}.dat") for k in ("abs", "lev", "StdUnc")}

with tifffile.TiffFile(raw / "nkg" / "eur_nkg_nkgrf17vel.tif") as t:
    arr = t.pages[0].asarray()           # (3, 313, 301), row 0 = lat 75 (PixelIsPoint)
up_tif = arr[2][::-1, :].astype(float)   # flip to lat ascending
grids["rf17_up"] = up_tif

print("max |tif_up - LU_abs| =", np.nanmax(np.abs(up_tif - grids["abs"])))
print("geoid-rise grid (abs-lev) range:", np.nanmin(grids["abs"] - grids["lev"]), np.nanmax(grids["abs"] - grids["lev"]))

interp = {k: RegularGridInterpolator((LAT, LON), v, method="linear") for k, v in grids.items()}

to_ll = Transformer.from_crs("EPSG:25833", "EPSG:4258", always_xy=True)


def sample(x, y):
    lon, lat = to_ll.transform(x, y)
    pts = np.column_stack([np.atleast_1d(lat), np.atleast_1d(lon)])
    return lon, lat, {k: f(pts) for k, f in interp.items()}


# ---------------- key points ----------------
points = {
    "NW_outlet (Barduelva, west end of regulated lake)": (657701.19, 7621216.70),
    "NW end of 1959 survey outline": (660241.39, 7621665.40),
    "Centroid": (679107.0, 7612800.5),
    "SE end of 1959 survey outline": (692604.89, 7607948.32),
    "SE end (regulated lake)": (696701.64, 7608715.57),
}
res_points = []
for name, (x, y) in points.items():
    lon, lat, v = sample(x, y)
    rec = dict(name=name, x=x, y=y, lon=float(lon), lat=float(lat),
               up_abs_mm_yr=float(v["abs"][0]), up_lev_mm_yr=float(v["lev"][0]),
               geoid_rise_mm_yr=float(v["abs"][0] - v["lev"][0]),
               std_unc_mm_yr=float(v["StdUnc"][0]), rf17_up_mm_yr=float(v["rf17_up"][0]))
    res_points.append(rec)
    print(f"{name:52s} lat {lat:.4f} lon {lon:.4f} abs {rec['up_abs_mm_yr']:.3f} lev {rec['up_lev_mm_yr']:.3f} "
          f"Ndot {rec['geoid_rise_mm_yr']:.3f} sig {rec['std_unc_mm_yr']:.3f}")

# ---------------- 1 km grid ----------------
x0, x1, y0, y1, d = 640000.0, 710000.0, 7590000.0, 7640000.0, 1000.0
xs = np.arange(x0, x1 + 0.5, d)
ys = np.arange(y0, y1 + 0.5, d)
X, Y = np.meshgrid(xs, ys)               # row = y ascending
lon, lat, v = sample(X.ravel(), Y.ravel())
lev = v["lev"].reshape(X.shape)
absg = v["abs"].reshape(X.shape)

# plane fit r = a + b*x + c*y over the grid (km)
A = np.column_stack([np.ones(X.size), (X.ravel() - 680000) / 1000, (Y.ravel() - 7612000) / 1000])
for nm, G in (("lev", lev), ("abs", absg)):
    coef, *_ = np.linalg.lstsq(A, G.ravel(), rcond=None)
    gmag = np.hypot(coef[1], coef[2])
    az = np.degrees(np.arctan2(coef[1], coef[2])) % 360   # azimuth of steepest increase, from grid north
    print(f"plane fit {nm}: r0={coef[0]:.3f} dr/dx={coef[1]:.5f} dr/dy={coef[2]:.5f} |grad|={gmag:.5f} mm/yr/km, az(grid)={az:.1f}")
    if nm == "lev":
        grad_lev = (coef, gmag, az)

# grid convergence at lake centre (UTM33 central meridian 15E)
from pyproj import Proj
pinfo = Proj("EPSG:25833").get_factors(19.40, 68.57)
conv = pinfo.meridian_convergence
print("meridian convergence at lake centre (deg):", conv)

# local gradient along the lake axis
nw = res_points[0]; se = res_points[4]
L = np.hypot(se["x"] - nw["x"], se["y"] - nw["y"]) / 1000
print(f"NW->SE length {L:.2f} km; lev diff {se['up_lev_mm_yr'] - nw['up_lev_mm_yr']:.3f} mm/yr; "
      f"abs diff {se['up_abs_mm_yr'] - nw['up_abs_mm_yr']:.3f}")
axis_az = np.degrees(np.arctan2(se["x"] - nw["x"], se["y"] - nw["y"])) % 360
print("axis azimuth (grid)", axis_az)

grid = dict(
    crs="EPSG:25833", x0=x0, y0=y0, dx=d, dy=d, nx=int(xs.size), ny=int(ys.size),
    values=[round(float(t), 4) for t in lev.ravel()],
    values_abs=[round(float(t), 4) for t in absg.ravel()],
    model="NKG2016LU_lev (levelled land uplift, relative to the GIA-rising geoid), mm/yr; values_abs = NKG2016LU_abs",
    source_url="https://www.lantmateriet.se/sv/geodata/gps-geodesi-och-swepos/Referenssystem/Landhojning/contentassets/nkg2016lu-with-readme.zip",
    source_url_abs_crosscheck="https://cdn.proj.org/eur_nkg_nkgrf17vel.tif",
    note=("Row-major, y ascending (row 0 = y0), x ascending within a row; node centres at x0+i*dx, y0+j*dy. "
          "Bilinear interpolation in lat/lon (ETRS89) of the native 1/12 deg x 1/6 deg NKG2016LU grids "
          "(Vestol et al. 2019, J Geod 93:1759, doi:10.1007/s00190-019-01280-8). "
          "lev = abs - geoid rise (NKG2016GIA_prel0306). Use 'values' (lev) for tilting of water surfaces. "
          "Standard uncertainty of the model here ~0.2-0.3 mm/yr (absolute); the SE-NW difference is far better "
          "determined than the absolute level because errors are spatially correlated."),
    plane_fit_lev=dict(r0_at_680000_7612000=round(float(grad_lev[0][0]), 4),
                       dr_dx_mm_yr_per_km=round(float(grad_lev[0][1]), 6),
                       dr_dy_mm_yr_per_km=round(float(grad_lev[0][2]), 6),
                       grad_mag_mm_yr_per_km=round(float(grad_lev[1]), 6),
                       azimuth_grid_deg=round(float(grad_lev[2]), 2),
                       azimuth_true_deg=round(float(grad_lev[2] + conv), 2)),
    points=res_points,
)
(out / "uplift_rate_grid.json").write_text(json.dumps(grid, indent=1), encoding="utf-8")
print("wrote", out / "uplift_rate_grid.json", "nx,ny", xs.size, ys.size, "lev min/max", lev.min(), lev.max())
