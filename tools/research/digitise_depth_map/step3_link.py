import sys; sys.path.insert(0, sys.argv[1])
import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage.morphology import skeletonize
from skimage.draw import line as dline
from PIL import Image
R = float(sys.argv[2]) if len(sys.argv) > 2 else 40
g = np.load("gray.npy").astype(float); lab = np.load("lab.npy")
outside = lab == 1
lake = ~outside
bgv = ndi.maximum_filter(g, 9)
ink = (g < 225) & (bgv - g > 14)
ink |= outside & ndi.binary_dilation(lake, iterations=2)          # shoreline band as ink
ink &= ndi.binary_dilation(lake, iterations=6)
# drop small blobs (digits, specks) that are not line-like
l, n = ndi.label(ink, np.ones((3, 3)))
objs = ndi.find_objects(l)
for i, sl in enumerate(objs, 1):
    h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
    if max(h, w) < 22:
        ink[sl][l[sl] == i] = False
sk = skeletonize(ink)
nb = ndi.convolve(sk.astype(np.uint8), np.ones((3, 3), np.uint8), mode="constant") - 1
ends = np.argwhere(sk & (nb == 1))
pts = np.argwhere(sk); tree = cKDTree(pts)
skset = sk.copy()
added = np.zeros_like(sk)
nlink = 0
for (y, x) in ends:
    # trace back up to 20 px to get the direction
    path = [(y, x)]; prev = None; cur = (y, x)
    for _ in range(20):
        cy, cx = cur; nxt = None
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                q = (cy + dy, cx + dx)
                if (dy or dx) and 0 <= q[0] < sk.shape[0] and 0 <= q[1] < sk.shape[1] and sk[q] and q not in path:
                    nxt = q; break
            if nxt: break
        if not nxt: break
        path.append(nxt); cur = nxt
    if len(path) < 6: continue
    d = np.array([y, x], float) - np.array(path[-1], float); d /= np.linalg.norm(d) + 1e-9
    own = set(path)
    best = None
    for j in tree.query_ball_point((y, x), R):
        q = tuple(pts[j])
        if q in own: continue
        v = np.array(q, float) - (y, x); dist = np.linalg.norm(v)
        if dist < 1.5: continue
        cos = v @ d / dist
        if cos < 0.6: continue
        score = dist * (2 - cos)
        if best is None or score < best[0]: best = (score, q)
    if best:
        rr, cc = dline(y, x, *best[1]); added[rr, cc] = True; nlink += 1
barrier = ndi.binary_dilation(sk | added, iterations=1) | outside
reg, n = ndi.label(~barrier & lake)
s = np.bincount(reg.ravel()); s[0] = 0
big = np.sort(s)[::-1][:5]
print(f"R={R} endpoints {len(ends)} links {nlink} regions>=300 {(s >= 300).sum()} largest {big.tolist()} frac {big[0] / s.sum():.2f}")
np.save("reg.npy", reg); np.save("barrier.npy", barrier); np.save("sk.npy", sk); np.save("added.npy", added)
rng = np.random.default_rng(2); col = rng.integers(70, 255, (n + 1, 3)).astype(np.uint8); col[0] = 0
img = col[reg]; img[barrier] = 0; img[added] = (255, 0, 0)
Image.fromarray(img).resize((img.shape[1] * 2 // 3, img.shape[0] * 2 // 3)).save("step3_regions.png")
# quality: skeleton pixels whose two sides (perpendicular offsets of 4 px) lie in the same region
sk2 = sk & lake
ys, xs = np.nonzero(sk2)
gy = ndi.sobel(ndi.gaussian_filter(sk.astype(float), 2), 0); gx = ndi.sobel(ndi.gaussian_filter(sk.astype(float), 2), 1)
same = 0; tot = 0
H, W = reg.shape
for y, x in zip(ys[::3], xs[::3]):
    n = np.array([gy[y, x], gx[y, x]]); nn = np.linalg.norm(n)
    if nn < 1e-6: continue
    n /= nn
    a = (int(round(y + 4 * n[0])), int(round(x + 4 * n[1]))); b = (int(round(y - 4 * n[0])), int(round(x - 4 * n[1])))
    if not (0 <= a[0] < H and 0 <= b[0] < H and 0 <= a[1] < W and 0 <= b[1] < W): continue
    ra, rb = reg[a], reg[b]
    if ra and rb:
        tot += 1; same += ra == rb
print(f"unresolved line fraction {same / max(tot, 1):.3f} ({same}/{tot})")
