"""Export everything the web viewer needs into web/data/<lake>/.

Files
  meta.json        grid, model tables (S(F) per lake, stats), places, profile, outlines
  height.bin       Uint16 heights of the 40 m render grid (row 0 = north), z = off + q*scale
  lake<k>.bin      per tracked lake: Uint32 cell index, Float32 a, Float32 b (wet for a <= F <= b)
  masks.png        20 m RGBA: R reservoir polygon, G 1959 survey lake, B flooded land (reconstructed), A lakes w/o depth
  basemap_relief.jpg  hillshade + hypsometric tint of the reconstructed natural landscape

Usage: python tools/export_web.py [tools/scene_config.json]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import shapely
from PIL import Image
from pyproj import Transformer
from scipy import ndimage
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True)
TO_LL = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True)


def load_cfg(path=None):
    p = Path(path) if path else ROOT / "tools" / "scene_config.json"
    return json.loads(p.read_text(encoding="utf-8"))


def feats(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))["features"]


def rings_to_lists(geom, tol):
    """Simplified polygon/line coordinates as nested lists of [x, y] rounded to metres."""
    g = geom.simplify(tol, preserve_topology=True)
    out = []
    parts = getattr(g, "geoms", [g])
    for p in parts:
        if p.geom_type == "Polygon":
            out.append([np.round(np.asarray(p.exterior.coords)[:, :2]).astype(int).tolist()]
                       + [np.round(np.asarray(r.coords)[:, :2]).astype(int).tolist() for r in p.interiors])
        elif p.geom_type == "LineString":
            out.append([np.round(np.asarray(p.coords)[:, :2]).astype(int).tolist()])
    return out


def hillshade(z, cell, az_deg, alt_deg):
    gy, gx = np.gradient(z, cell)
    gy = -gy  # rows run north -> south
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, -gy)
    az, alt = np.radians(az_deg), np.radians(alt_deg)
    return np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)


HYPSO = [  # elevation m -> rgb, tuned for a sub-arctic palette
    (300, (164, 190, 150)), (450, (185, 204, 160)), (520, (204, 214, 170)), (650, (222, 219, 182)),
    (800, (219, 205, 176)), (1000, (205, 190, 172)), (1200, (196, 190, 186)), (1450, (226, 226, 230)), (1800, (250, 250, 252)),
]
BED = [(370, (120, 140, 150)), (430, (150, 165, 165)), (476, (178, 186, 176))]


def ramp(z, stops):
    zs = np.array([s[0] for s in stops], float)
    cs = np.array([s[1] for s in stops], float)
    return np.stack([np.interp(z, zs, cs[:, k]) for k in range(3)], axis=-1)


def rate_grid(pl, X, Y):
    c, (cx, cy) = pl["rate_coef"], pl["rate_fit_centre"]
    u, v = (X - cx) / 1000, (Y - cy) / 1000
    return c[0] + c[1] * u + c[2] * v + c[3] * u * u + c[4] * v * v + c[5] * u * v


def register_scene(cfg, pl):
    """Add or update this scene in web/data/lakes.json, the list the viewer's lake picker reads."""
    reg_path = ROOT / "web" / "data" / "lakes.json"
    reg = json.loads(reg_path.read_text(encoding="utf-8")) if reg_path.exists() else {"lakes": []}
    region = shape(feats(pl["lakes"][0]["region"])[0]["geometry"])
    c = region.representative_point()
    lon, lat = TO_LL.transform(c.x, c.y)
    st = cfg.get("strings", {})
    entry = {
        "id": cfg["lake"], "name": cfg["name"], "vatnlnr": cfg.get("vatnlnr"),
        "lat": round(lat, 4), "lon": round(lon, 4), "x": round(c.x), "y": round(c.y),
        "region": cfg.get("region", {}),
        "subtitle": {k: v.get("subtitle") for k, v in st.items() if v.get("subtitle")} or cfg.get("subtitle", {}),
        "level_m": cfg["natural_level_m"],
    }
    reg["lakes"] = [L for L in reg["lakes"] if L["id"] != entry["id"]] + [entry]
    reg["lakes"].sort(key=lambda L: L["name"])
    reg_path.write_text(json.dumps(reg, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"registered {entry['id']} in {reg_path.relative_to(ROOT)} ({len(reg['lakes'])} scenes)")


def main():
    cfg = load_cfg(sys.argv[1] if len(sys.argv) > 1 else None)
    lake = cfg["lake"]
    out_dir = ROOT / "web" / "data" / lake
    out_dir.mkdir(parents=True, exist_ok=True)
    pl = json.loads((ROOT / "data" / "processed" / f"{lake}_paleolakes.json").read_text(encoding="utf-8"))
    npz = np.load(ROOT / "data" / "processed" / f"{lake}_paleolakes.npz")
    nat = np.load(ROOT / "data" / "processed" / f"{lake}_natural{int(cfg['cell_dem'])}.npz")

    cell, x0f, ytf, nxf, nyf = pl["cell"], pl["x0"], pl["y_top"], pl["nx"], pl["ny"]
    bx0, by0, bx1, by1 = cfg["render_bbox"]
    c0, r0 = int(round((bx0 - x0f) / cell)), int(round((ytf - by1) / cell))
    nx, ny = int(round((bx1 - bx0) / cell)), int(round((by1 - by0) / cell))
    z = npz["z"][r0:r0 + ny, c0:c0 + nx].astype(np.float64)
    xc = bx0 + (np.arange(nx) + 0.5) * cell
    yc = by1 - (np.arange(ny) + 0.5) * cell
    X, Y = np.meshgrid(xc, yc)

    # --- heights ---------------------------------------------------------
    scale = 0.05
    zoff = float(np.floor(z.min()))
    q = np.round((z - zoff) / scale)
    assert q.max() < 65535
    q.astype("<u2").tofile(out_dir / "height.bin")

    # --- lakes -----------------------------------------------------------
    lakes_meta = []
    for li, L in enumerate(pl["lakes"]):
        idx = npz[f"idx{li}"]
        rr, cc = np.divmod(idx, nxf)
        rr, cc = rr - r0, cc - c0
        ok = (rr >= 0) & (rr < ny) & (cc >= 0) & (cc < nx)
        lost = int((~ok).sum())
        cidx = (rr[ok] * nx + cc[ok]).astype("<u4")
        a = np.nan_to_num(npz[f"a{li}"][ok], neginf=-1e9, posinf=1e9).astype("<f4")
        b = np.nan_to_num(npz[f"b{li}"][ok], neginf=-1e9, posinf=1e9).astype("<f4")
        fn = f"lake{li}.bin"
        with open(out_dir / fn, "wb") as f:
            f.write(cidx.tobytes()); f.write(a.tobytes()); f.write(b.tobytes())
        lakes_meta.append({"name": L["name"], "file": fn, "n": int(cidx.size), "cells_outside_render": lost,
                           "S": L["S"], "stats": L["stats"]})
        print(f"{L['name']}: {cidx.size} cells ({lost} outside render window)")

    # --- masks (20 m) ------------------------------------------------------
    c20 = float(nat["cell"])
    k = int(round(cell / c20))
    m20 = nat["masks"][r0 * k:(r0 + ny) * k, c0 * k:(c0 + nx) * k]
    x20 = bx0 + (np.arange(nx * k) + 0.5) * c20
    y20 = by1 - (np.arange(ny * k) + 0.5) * c20
    X20, Y20 = np.meshgrid(x20, y20)
    regulated = shape(feats(f"data/raw/{lake}_innsjo.geojson")[0]["geometry"])
    survey = shape(feats(f"data/raw/{lake}_omkrets_dybdemalt.geojson")[0]["geometry"])
    shapely.prepare(regulated)
    rgba = np.zeros((ny * k, nx * k, 4), np.uint8)
    rgba[..., 0] = shapely.contains_xy(regulated, X20, Y20) * 255
    rgba[..., 1] = ((m20 & 2) > 0) * 255
    rgba[..., 2] = ((m20 & (4 | 8)) > 0) * 255
    nodepth = np.zeros(X20.shape, bool)
    for spec in cfg.get("lakes_without_bathymetry", []) + cfg.get("schematic_lakes", []):
        p = shape(feats(spec["file"])[0]["geometry"]); shapely.prepare(p)
        nodepth |= shapely.contains_xy(p, X20, Y20)
    rgba[..., 3] = np.where(nodepth, 255, 0)
    # alpha=0 premultiplication would destroy RGB in some browsers: store A inverted (255 = none)
    rgba[..., 3] = 255 - rgba[..., 3]
    Image.fromarray(rgba, "RGBA").save(out_dir / "masks.png", optimize=True)

    # --- relief basemap ------------------------------------------------------
    dmeta = json.loads((ROOT / f"{cfg['dtm']}.json").read_text())
    d10 = np.load(ROOT / f"{cfg['dtm']}.npy", mmap_mode="r")
    rr0 = int(round((dmeta["y0"] - by1) / 10)); cc0 = int(round((bx0 - dmeta["x0"]) / 10))
    z10 = np.array(d10[rr0:rr0 + ny * k * 2, cc0:cc0 + nx * k * 2], dtype=np.float64)
    zn20 = nat["z"][r0 * k:(r0 + ny) * k, c0 * k:(c0 + nx) * k].astype(np.float64)
    rec20 = (m20 & (1 | 2 | 4 | 8)) > 0
    zn10 = ndimage.zoom(zn20, 2, order=1)
    rec10 = np.kron(ndimage.binary_dilation(rec20, iterations=1), np.ones((2, 2), bool))
    z10 = np.where(rec10, zn10, z10)
    hs = 0.55 * hillshade(z10, 10, 315, 40) + 0.25 * hillshade(z10, 10, 255, 50) + 0.2 * hillshade(z10, 10, 15, 55)
    zs = ndimage.gaussian_filter(z10, 1.0)
    hypso = [(z_, tuple(c_)) for z_, c_ in cfg["hypso_ramp"]] if "hypso_ramp" in cfg else HYPSO
    bed_ramp = [(z_, tuple(c_)) for z_, c_ in cfg["bed_ramp"]] if "bed_ramp" in cfg else BED
    col = ramp(zs, hypso)
    # lake-bed colours only inside the modelled basins (ever wet) and present lakes
    ever10 = np.zeros((ny, nx), bool)
    for li in range(len(pl["lakes"])):
        idx = npz[f"idx{li}"]; rr_, cc_ = np.divmod(idx, nxf); rr_, cc_ = rr_ - r0, cc_ - c0
        ok_ = (rr_ >= 0) & (rr_ < ny) & (cc_ >= 0) & (cc_ < nx); ever10[rr_[ok_], cc_[ok_]] = True
    ever10 = np.kron(ndimage.binary_dilation(ever10, iterations=1), np.ones((2 * k, 2 * k), bool))[:z10.shape[0], :z10.shape[1]]
    bed = (zs < cfg["natural_level_m"]) & ever10
    col[bed] = ramp(zs[bed], bed_ramp)
    shade = (0.35 + 0.8 * hs)[..., None]
    img = np.clip(col * shade, 0, 255).astype(np.uint8)
    width = 6144
    Image.fromarray(img, "RGB").resize((width, round(width * ny / nx)), Image.LANCZOS).save(
        out_dir / "basemap_relief.jpg", quality=88, optimize=True, progressive=True)
    print("relief basemap written")

    # --- profile along the lake axis --------------------------------------------
    ever = np.zeros(nx * ny, bool)
    for li in range(len(pl["lakes"])):
        idx = npz[f"idx{li}"]; rr, cc = np.divmod(idx, nxf); rr, cc = rr - r0, cc - c0
        ok = (rr >= 0) & (rr < ny) & (cc >= 0) & (cc < nx); ever[rr[ok] * nx + cc[ok]] = True
    ever = ever.reshape(ny, nx)
    chan_mask = np.zeros((ny, nx), bool)
    line = shapely.LineString(cfg["outlet_channel"])
    chan_mask |= (shapely.distance(line, shapely.points(X.ravel(), Y.ravel())).reshape(X.shape) < cell)
    allowed = ndimage.binary_dilation(ever | chan_mask, iterations=3)
    ids = -np.ones((ny, nx), np.int64); ids[allowed] = np.arange(int(allowed.sum()))
    rows, cols, w = [], [], []
    z0p, zclip = cfg.get("profile_z0", 360.0), cfg.get("profile_zclip", 560.0)   # path cost: stay low, cross cols
    zc = np.clip(z, None, zclip)
    for dr_, dc_ in ((0, 1), (1, 0), (1, 1), (1, -1)):
        ca0, ca1 = max(0, -dc_), nx - max(0, dc_)
        a, b = ids[0:ny - dr_, ca0:ca1], ids[dr_:ny, ca0 + dc_:ca1 + dc_]
        za, zb = zc[0:ny - dr_, ca0:ca1], zc[dr_:ny, ca0 + dc_:ca1 + dc_]
        ok = (a >= 0) & (b >= 0)
        cost = np.hypot(dr_, dc_) * (1.0 + ((np.maximum(za[ok], zb[ok]) - z0p) / 25.0) ** 4)
        rows += [a[ok], b[ok]]; cols += [b[ok], a[ok]]; w += [cost, cost]
    G = csr_matrix((np.concatenate(w), (np.concatenate(rows), np.concatenate(cols))), shape=(int(allowed.sum()),) * 2)

    def node(x, y):
        r, c = int((by1 - y) // cell), int((x - bx0) // cell)
        return ids[r, c]

    start = node(cfg["dam"]["x"], cfg["dam"]["y"])
    col_xy = cfg["se_col"]["x"], cfg["se_col"]["y"]
    end = node(*col_xy)
    dist, pred = dijkstra(G, indices=start, return_predecessors=True)
    path = [end]
    while path[-1] != start and path[-1] >= 0:
        path.append(pred[path[-1]])
    path = path[::-1]
    inv = np.argwhere(allowed)
    pts = np.array([[xc[inv[p][1]], yc[inv[p][0]]] for p in path], float)
    # smooth + resample every 100 m
    sm = np.column_stack([ndimage.uniform_filter1d(pts[:, j], 9, mode="nearest") for j in range(2)])
    sm[0], sm[-1] = pts[0], pts[-1]
    seg = np.hypot(*np.diff(sm, axis=0).T); s = np.r_[0, np.cumsum(seg)]
    S_ = np.arange(0, s[-1], 100.0)
    px, py = np.interp(S_, s, sm[:, 0]), np.interp(S_, s, sm[:, 1])
    zn_full = nat["z"].astype(np.float64)
    ri = ((float(nat["y_top"]) - py) // c20).astype(int); ci = ((px - float(nat["x0"])) // c20).astype(int)
    prof_z = ndimage.map_coordinates(zn_full, [((float(nat["y_top"]) - py) / c20 - 0.5), ((px - float(nat["x0"])) / c20 - 0.5)], order=1)
    # same terrain as the 3D model: carved outlet channel and nominal depth of lakes without bathymetry
    ch = shapely.LineString(cfg["outlet_channel"])
    vd = np.array([ch.project(shapely.Point(c)) for c in ch.coords])
    vz = list(cfg.get("outlet_channel_z") or [None] * len(vd))
    if vz[-1] is None:
        vz[-1] = float(ndimage.map_coordinates(zn_full, [[(float(nat["y_top"]) - ch.coords[-1][1]) / c20 - 0.5], [(ch.coords[-1][0] - float(nat["x0"])) / c20 - 0.5]], order=1)[0])
    known = [i for i, v in enumerate(vz) if v is not None]
    vz = np.interp(vd, vd[known], [vz[i] for i in known])
    P = shapely.points(px, py)
    near = shapely.distance(ch, P) <= cfg.get("outlet_channel_width_m", 60) / 2 + 20
    if near.any():
        prof_z[near] = np.minimum(prof_z[near], np.interp(shapely.line_locate_point(ch, P[near]), vd, vz))
    for spec, info in zip(cfg.get("lakes_without_bathymetry", []), pl.get("lakes_without_bathymetry", [])):
        poly = shape(feats(spec["file"])[0]["geometry"]).buffer(-cell)
        inside = shapely.contains_xy(poly, px, py)
        prof_z[inside] = np.minimum(prof_z[inside], info["surface_m"] - spec.get("nominal_depth_m", 1.0))
    profile = {"s": S_.round(1).tolist(), "x": px.round(1).tolist(), "y": py.round(1).tolist(), "z": prof_z.round(2).tolist()}
    print(f"profile {S_[-1] / 1000:.1f} km, {S_.size} samples")

    # --- places -----------------------------------------------------------
    places = []
    for p in cfg.get("places", []):
        if "lat" in p:
            x, y = TO_UTM.transform(p["lon"], p["lat"])
        else:
            x, y = p["x"], p["y"]
        if bx0 <= x <= bx1 and by0 <= y <= by1:
            places.append({**{k: v for k, v in p.items() if k not in ("lat", "lon")}, "x": round(x, 1), "y": round(y, 1)})

    # --- outlines -----------------------------------------------------------
    box = shapely.box(bx0, by0, bx1, by1)
    border = None
    adm = [ROOT / f for f in cfg.get("border_admin", ["data/raw/admin/fylke_18_omrade_25833.json", "data/raw/admin/fylke_55_omrade_25833.json"])]
    if all(p.exists() for p in adm):
        norway = unary_union([shape(json.loads(p.read_text())["omrade"]) for p in adm])
        border = norway.boundary.intersection(box.buffer(-50))
    outlines = {
        "survey1959": rings_to_lists(survey, 15),
        "regulated": rings_to_lists(regulated, 15),
        "border": rings_to_lists(border, 30) if border is not None and not border.is_empty else [],
    }

    lon, lat = TO_LL.transform((bx0 + bx1) / 2, (by0 + by1) / 2)
    meta = {
        "name": cfg["name"], "crs": "EPSG:25833", "centre_lonlat": [lon, lat],
        "grid": {"x0": bx0, "y1": by1, "cell": cell, "nx": nx, "ny": ny, "z_offset": zoff, "z_scale": scale,
                 "layout": "row 0 = north; vertex (r,c) at (x0+(c+0.5)cell, y1-(r+0.5)cell)"},
        "masks": {"file": "masks.png", "cell": c20, "channels": {"R": "regulated reservoir", "G": "1959 survey bathymetry",
                                                               "B": "reconstructed flooded land / outlet channel", "A": "255 - lake without depth data"}},
        "basemaps": [
            {"id": "relief", "file": "basemap_relief.jpg", "label": "Natural relief (reconstructed)", "attribution": "Terrain: Kartverket DTM (CC BY 4.0); bathymetry: NVE; reconstruction: this project"},
            {"id": "topo", "file": "basemap_topo.jpg", "label": "Kartverket topographic map", "attribution": "© Kartverket (CC BY 4.0)"},
            {"id": "grey", "file": "basemap_grey.jpg", "label": "Kartverket grey map", "attribution": "© Kartverket (CC BY 4.0)"},
        ],
        "F": pl["F"],
        "rate": {"coef": pl["rate_coef"], "centre": pl["rate_fit_centre"], "r_ref": pl["r_ref"],
                 "model": pl["rate_model"], "source": pl["rate_source"], "fit_max_resid_mm_yr": pl["rate_fit_max_resid"],
                 "form": "r = c0 + c1 u + c2 v + c3 u^2 + c4 v^2 + c5 u v; u,v = (x,y - centre)/1000 km"},
        "outlet": cfg["outlet"], "dam": cfg.get("dam"), "se_col": cfg.get("se_col"), "se_ref": cfg.get("se_ref"),
        "natural_level_m": cfg["natural_level_m"], "survey_level_m": cfg["survey_level_m"],
        "regulated": {"hrv_m": cfg["regulated_hrv_m"], "lrv_m": cfg.get("regulated_lrv_m")},
        "lakes": lakes_meta,
        "lakes_without_bathymetry": pl.get("lakes_without_bathymetry", []),
        "outlets": cfg.get("outlets", []),
        "profile": profile,
        "places": places,
        "outlines": outlines,
        "deglaciation": cfg.get("deglaciation"),
        "schematic_lakes": [L.get("name", L["file"]) for L in cfg.get("schematic_lakes", [])],
        "rate_range": [round(float(v), 2) for v in np.percentile(
            rate_grid(pl, X, Y), [0, 100])],
        **{k: cfg[k] for k in ("views", "tour", "events", "strings", "lake_notes", "profile_range") if k in cfg},
        "model": cfg.get("model", {}),
        "sources": cfg.get("sources", []),
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    register_scene(cfg, pl)
    print(f"wrote {out_dir.relative_to(ROOT)}: " + ", ".join(f"{p.name} {p.stat().st_size / 1e6:.1f} MB" for p in sorted(out_dir.iterdir())))


if __name__ == "__main__":
    main()
