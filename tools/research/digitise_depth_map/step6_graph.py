import collections, json, pickle
import numpy as np
from scipy import ndimage as ndi
reg = np.load("reg.npy"); lab = np.load("lab.npy")
outside = lab == 1; H, W = reg.shape; K = 1.725
isl = {int(reg[int(y * K), int(x * K)]) for x, y in [(810, 660), (420, 940)]}
s = np.bincount(reg.ravel()); s[0] = 0
keep = s >= 150
base = np.where(keep[reg], reg, 0); OUT = int(reg.max() + 1)
base[outside] = OUT
for i in isl: base[reg == i] = OUT
d, idx = ndi.distance_transform_edt(base == 0, return_indices=True)
exp = base[idx[0], idx[1]]
added = ndi.binary_dilation(np.load('added.npy'), iterations=3)
cnt = collections.Counter(); thick = collections.defaultdict(list); onadd = collections.Counter()
for dy, dx in ((0, 1), (1, 0)):
    A = exp[:H - dy, :W - dx]; B = exp[dy:, dx:]
    D = np.maximum(d[:H - dy, :W - dx], d[dy:, dx:])
    m = A != B
    AD = added[:H - dy, :W - dx][m]
    for a, b, v, ad in zip(A[m].tolist(), B[m].tolist(), D[m].tolist(), AD.tolist()):
        k = (min(a, b), max(a, b)); cnt[k] += 1; thick[k].append(v); onadd[k] += ad
edges = {k: dict(n=c, thin=int(sum(1 for v in thick[k] if v <= 3)), med=float(np.median(thick[k])), add=onadd[k] / c) for k, c in cnt.items()}
cent = {int(r): (float(c[0]), float(c[1])) for r, c in zip(np.unique(exp), ndi.center_of_mass(np.ones_like(exp), exp, np.unique(exp)))}
sizes = {int(r): int(v) for r, v in zip(*np.unique(exp, return_counts=True))}
pickle.dump(dict(edges=edges, OUT=OUT, cent=cent, sizes=sizes, isl=list(isl)), open("graph.pkl", "wb"))
np.save("exp.npy", exp)
print("regions", len(sizes), "edges", len(edges))
