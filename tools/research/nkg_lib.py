"""Shared helpers: load NKG2016LU grids (Lantmateriet .dat) and sample/fit in EPSG:25833."""
from pathlib import Path

import numpy as np
from pyproj import Transformer
from scipy.interpolate import RegularGridInterpolator

LAT = 49.0 + np.arange(313) / 12.0
LON = 0.0 + np.arange(301) / 6.0
_to_ll = Transformer.from_crs("EPSG:25833", "EPSG:4258", always_xy=True)
_to_xy = Transformer.from_crs("EPSG:4258", "EPSG:25833", always_xy=True)


def read_dat(p):
    a = np.loadtxt(p)
    g = np.full((313, 301), np.nan)
    g[np.rint((a[:, 0] - 49.0) * 12).astype(int), np.rint(a[:, 1] * 6).astype(int)] = a[:, 2]
    return g


def load(proj_dir, kind="lev"):
    p = Path(proj_dir) / "data" / "raw" / "nkg2016lu_lm" / "extracted" / f"NKG2016LU_{kind}.dat"
    f = RegularGridInterpolator((LAT, LON), read_dat(p), method="linear")

    def sample_xy(x, y):
        lon, lat = _to_ll.transform(np.asarray(x, float), np.asarray(y, float))
        return f(np.column_stack([np.ravel(lat), np.ravel(lon)])).reshape(np.shape(x))

    def sample_ll(lon, lat):
        return f(np.column_stack([np.ravel(lat), np.ravel(lon)])).reshape(np.shape(lon))

    return sample_xy, sample_ll


def to_xy(lon, lat):
    return _to_xy.transform(lon, lat)


def plane_fit_ll(sample_xy, lon0, lon1, lat0, lat1, step=2000.0):
    """Plane fit of rate over a lon/lat box (on a UTM33 grid). Returns (mean, grad mm/yr/km, grid azimuth deg)."""
    xs, ys = [], []
    for lo, la in [(lon0, lat0), (lon1, lat0), (lon0, lat1), (lon1, lat1)]:
        x, y = to_xy(lo, la); xs.append(x); ys.append(y)
    X, Y = np.meshgrid(np.arange(min(xs), max(xs), step), np.arange(min(ys), max(ys), step))
    lon, lat = _to_ll.transform(X, Y)
    m = (lon >= lon0) & (lon <= lon1) & (lat >= lat0) & (lat <= lat1)
    X, Y = X[m], Y[m]
    R = sample_xy(X, Y)
    A = np.column_stack([np.ones(X.size), (X - X.mean()) / 1000, (Y - Y.mean()) / 1000])
    c, *_ = np.linalg.lstsq(A, R, rcond=None)
    g = float(np.hypot(c[1], c[2]))
    az = float(np.degrees(np.arctan2(c[1], c[2])) % 360)
    resid = float(np.std(R - A @ c))
    return float(c[0]), g, az, resid, (c[1], c[2])
