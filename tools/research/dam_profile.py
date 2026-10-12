"""Dam crest and outlet analysis on the 1 m DTM crop at Altevatnet's NW end.
Usage: python -I tools/dam_profile.py"""
import json, numpy as np
from scipy.ndimage import map_coordinates, label
a = np.load("data/raw/dtm/dtm1_nwdam.npy"); m = json.load(open("data/raw/dtm/dtm1_nwdam.json"))
x0, y0, d = m["x0"], m["y0"], m["dx"]
def z(x, y, order=1):
    c = (np.asarray(x) - x0) / d - 0.5; r = (y0 - np.asarray(y)) / d - 0.5
    return map_coordinates(a, [r, c], order=order)
# crude axis guess from the plot; refine by locating local max ridge per row
A = np.array([657700., 7621260.]); B = np.array([657840., 7620720.])
ax = (B - A) / np.linalg.norm(B - A); nrm = np.array([-ax[1], ax[0]])
print("axis length %.0f m, azimuth %.1f" % (np.linalg.norm(B - A), np.degrees(np.arctan2(ax[0], ax[1]))))
rows = []
for s in np.arange(0, np.linalg.norm(B - A) + 1, 20):
    p = A + s * ax
    t = np.arange(-60, 61, 1.0)
    pts = p[None, :] + t[:, None] * nrm[None, :]
    zz = z(pts[:, 0], pts[:, 1])
    k = np.argmax(zz)
    rows.append((s, *pts[k], zz[k], zz[0], zz[-1]))
print("  s(m)    x_crest     y_crest   crest_z   z(-60m)  z(+60m)")
for r in rows:
    print("  %5.0f  %10.1f %11.1f  %7.2f  %7.2f  %7.2f" % r)
crest = np.array([r[3] for r in rows])
print("crest elevation along dam: median %.2f, max %.2f, min %.2f" % (np.median(crest[2:-2]), crest.max(), crest[2:-2].min()))
# water surface in crop
lake = a[(np.abs(a - np.median(a[1000:1300, 1500:1900])) < 0.02)]
print("lake surface value in crop (median of NE block):", np.median(a[300:900, 1400:1900]))
# flat areas below the dam (possible downstream pond / river)
low = a < 440
print("cells < 440 m:", low.sum(), " min", a.min())
vals, cnt = np.unique(np.round(a[low], 2), return_counts=True); o = np.argsort(cnt)[::-1][:5]
print("most common values <440:", [(float(vals[i]), int(cnt[i])) for i in o])
# channel SW of the dam: profile along it
for name, P, Q in [("channel_SW", (657650, 7620960), (657270, 7620550)), ("valley_W", (657700, 7620900), (656800, 7620700))]:
    P = np.array(P, float); Q = np.array(Q, float)
    for s in np.linspace(0, 1, 9):
        p = P + s * (Q - P)
        # min within 15 m to follow the channel bottom
        t = np.arange(-15, 16, 1.0); u = (Q - P) / np.linalg.norm(Q - P); nn = np.array([-u[1], u[0]])
        pts = p[None, :] + t[:, None] * nn[None, :]
        print(f"  {name} s={s:.2f} x={p[0]:.0f} y={p[1]:.0f} zmin={z(pts[:,0],pts[:,1]).min():.2f}")
