import pickle, collections, json, sys
import numpy as np
import scipy.sparse as sp, scipy.sparse.linalg as spla
from scipy import ndimage as ndi
from PIL import Image, ImageDraw
G = pickle.load(open("graph.pkl", "rb")); exp = np.load("exp.npy"); barrier = np.load("barrier.npy")
OUT = G["OUT"]; H, W = exp.shape; K = 1.725
ids = [int(r) for r in np.unique(exp) if r != 0]
ix = {r: i for i, r in enumerate(ids)}
dshore = ndi.distance_transform_edt(exp != OUT)
md = dict(zip(ids, ndi.mean(dshore, exp, ids))); md[OUT] = -1
SPOTS = json.load(open("spots.json"))
ANCH = {int(k): v for k, v in json.load(open("anchors.json")).items()}
rows = []  # (i, j, target, weight): L_j - L_i = target
for (a, b), e in G["edges"].items():
    if 0 in (a, b): continue
    thin_orig = e["thin"] * (1 - e["add"])
    if e["add"] >= 0.5 and e["n"] >= 6:
        rows.append((ix[a], ix[b], 0.0, min(e["n"], 300) * 1.0)); continue
    if thin_orig < 15: continue
    lo, hi = (a, b) if md[a] < md[b] else (b, a)
    w = min(thin_orig, 300) * (0.3 if OUT in (a, b) else 1.0)
    rows.append((ix[lo], ix[hi], 1.0, w))
n = len(ids)
def solve(wscale):
    r_, c_, v_, b_ = [], [], [], []
    k = 0
    for (i, j, t, w), s in zip(rows, wscale):
        ww = np.sqrt(w * s); r_ += [k, k]; c_ += [j, i]; v_ += [ww, -ww]; b_.append(ww * t); k += 1
    big = 3000.0
    r_.append(k); c_.append(ix[OUT]); v_.append(big); b_.append(-big); k += 1
    for sp_ in SPOTS:
        r = int(exp[int(sp_["y"] * K), int(sp_["x"] * K)])
        if r in ix:
            r_.append(k); c_.append(ix[r]); v_.append(big / 3); b_.append(big / 3 * sp_["level"]); k += 1
    for r, lv_ in ANCH.items():
        if r in ix:
            r_.append(k); c_.append(ix[r]); v_.append(big); b_.append(big * lv_); k += 1
    A = sp.csr_matrix((v_, (r_, c_)), shape=(k, n))
    return spla.lsqr(A, np.array(b_), atol=1e-10, btol=1e-10, iter_lim=20000)[0]
ws = np.ones(len(rows))
for it in range(8):
    x = solve(ws)
    res = np.array([x[j] - x[i] - t for i, j, t, w in rows])
    ws = 1.0 / np.maximum(1.0, np.abs(res) / 0.5)   # Huber-like IRLS
Lr = {r: int(round(x[ix[r]])) for r in ids}
lv = np.full(exp.max() + 1, -9)
for r, v in Lr.items(): lv[r] = v
Lm = lv[exp]; np.save("levels.npy", Lm); json.dump(Lr, open("levels8.json", "w"))
bad = int(np.sum(np.abs(res) > 0.5)); print("max level", max(Lr.values()), "edges violated", bad, "/", len(rows))
for sp_ in SPOTS:
    r = int(exp[int(sp_["y"] * K), int(sp_["x"] * K)]); print(f"  spot {sp_['d']}: target L{sp_['level']} got {x[ix[r]]:.2f}")
cm = np.array([[255,255,255],[230,245,255],[200,225,250],[170,205,245],[140,185,235],[110,165,225],[90,145,210],[255,230,120],[255,200,60],[255,160,0],[255,110,0],[230,50,50],[170,0,110],[90,0,140],[0,0,0]], np.uint8)
img = cm[np.clip(Lm + 1, 0, 14)]; img[barrier] = 0; img[exp == OUT] = 255
im = Image.fromarray(img); dr = ImageDraw.Draw(im)
for r in ids:
    if r != OUT and G["sizes"].get(r, 0) > 4000:
        cy, cx = G["cent"][r]; dr.text((cx, cy), str(Lr[r]), fill=(200, 0, 0))
for sp_ in SPOTS: dr.ellipse((sp_["x"] * K - 6, sp_["y"] * K - 6, sp_["x"] * K + 6, sp_["y"] * K + 6), outline=(0, 150, 0), width=3)
im.resize((W * 2 // 3, H * 2 // 3)).save("step8_levels.png")
