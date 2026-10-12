"""Regional NKG2016LU_lev gradients for shoreline-gradient cross-checks + point rates at marine-limit sites.
Usage (from tools/): python regional_gradients.py <project_dir>
"""
import sys
import numpy as np
from nkg_lib import load, plane_fit_ll, to_xy

proj = sys.argv[1]
s_xy, s_ll = load(proj, "lev")
regions = {
    "Altevatn box (17.9-20.1E, 68.4-68.8N)": (18.0, 20.1, 68.40, 68.80),
    "Tornetrask basin (18.5-20.3E, 68.1-68.5N)": (18.5, 20.3, 68.10, 68.50),
    "Malangen-Balsfjord (17.5-19.5E, 69.0-69.5N)": (17.5, 19.5, 69.0, 69.5),
    "Ullsfjord-Lyngen (19.2-20.4E, 69.4-69.9N)": (19.2, 20.4, 69.4, 69.9),
    "Troms coast-fjords (16.5-20.5E, 68.8-69.9N)": (16.5, 20.5, 68.8, 69.9),
    "Lofoten-Vesteralen (12.5-16.5E, 67.8-69.2N)": (12.5, 16.5, 67.8, 69.2),
}
for k, (a, b, c, d) in regions.items():
    m, g, az, res, _ = plane_fit_ll(s_xy, a, b, c, d)
    print(f"{k:48s} mean {m:5.2f} mm/yr  |grad| {g:.4f} mm/yr/km  az(grid) {az:5.1f}  resid {res:.3f}")
# component along 145 deg true (Tornetrask profile direction 325 reversed); grid az ~ true - convergence(~4)
m, g, az, res, (gx, gy) = plane_fit_ll(s_xy, 18.5, 20.3, 68.10, 68.50)
for true_az in (145.0,):
    gaz = np.radians(true_az - 4.0)
    print("Tornetrask gradient component along true az 145:", gx * np.sin(gaz) + gy * np.cos(gaz))
sites = {
    "Malselv ML 80 m (Eilertsen 2005)": (660993, 7659967),
    "Ovre Salangen ML 83 m (Sveian 2011)": (628079, 7638335),
    "Indre Lavangen ML 77-83 m": (613000, 7630000),
    "Bjerkvik/Narvik ML 89-90 m": (606554, 7606784),
    "Storfjord ML 96 m (Corner 1980)": (702093, 7677400),
    "Narvik tide gauge (Passe A=124)": (597975, 7592653),
    "Tromso (Passe A=60)": (656111, 7733385),
    "Harstad (Passe A=63)": (535270, 7647815),
    "Bodo (Passe A=98)": (474742, 7460087),
    "Lofoten (Passe A=54)": (434579, 7550530),
    "Kirkenes (Passe A=83)": (1070141, 7804866),
    "Norrbotten (Passe A=192)": (801271, 7336336),
    "Angermanland (Passe A=224)": (699234, 7026070),
}
for k, (x, y) in sites.items():
    print(f"{k:40s} lev {float(s_xy(np.array([x]), np.array([y]))[0]):.3f} mm/yr")
