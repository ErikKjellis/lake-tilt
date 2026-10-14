import sys, json
import numpy as np
from scipy import ndimage as ndi
g = np.load("gray.npy").astype(float); exp = np.load("exp.npy"); reg = np.load("reg.npy"); OUT = int(exp.max())
K = 1.725
def walk(p0, p1, L0, n=3000):
    (x0, y0), (x1, y1) = [(a * K, b * K) for a, b in (p0, p1)]
    t = np.linspace(0, 1, n); xs = x0 + (x1 - x0) * t; ys = y0 + (y1 - y0) * t
    v = ndi.map_coordinates(g, [ys, xs], order=1)
    R = reg[ys.astype(int), xs.astype(int)]
    dark = v < 215
    out = []; lvl = L0; runs = 0; prevdark = False; cur = None
    for i in range(n):
        if dark[i] and not prevdark: runs += 1
        prevdark = dark[i]
        r = int(R[i])
        if r and not dark[i] and r != cur:
            if cur is not None: lvl -= runs
            runs = 0; cur = r; out.append((r, lvl))
    return out
if __name__ == "__main__":
    p = json.loads(sys.argv[1])
    print(walk(tuple(p[0]), tuple(p[1]), p[2]))
