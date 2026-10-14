import sys; sys.path.insert(0, sys.argv[1])
import numpy as np, pymupdf
from PIL import Image
from scipy import ndimage as ndi
d = pymupdf.open(sys.argv[2]); p = d[0]
Z = 3
pix = p.get_pixmap(matrix=pymupdf.Matrix(Z, Z), colorspace=pymupdf.csGRAY)
a = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w).astype(float)
a = ndi.gaussian_filter(a, 0.8)
ink = a < 170
np.save("ink.npy", ink); np.save("gray.npy", a.astype(np.uint8))
# close small gaps, then flood the background from the border
closed = ndi.binary_closing(ink, iterations=3) | ink
bg = ~closed
lab, n = ndi.label(bg)
border = np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])
outside = np.isin(lab, border[border > 0])
sizes = ndi.sum(bg, lab, range(1, n + 1))
big = np.argsort(sizes)[::-1][:8] + 1
print(pix.w, pix.h, "regions", n, "largest:", [(int(b), int(sizes[b - 1]), bool(np.isin(b, border))) for b in big])
img = np.stack([a] * 3, -1).astype(np.uint8)
img[outside] = (img[outside] * 0.5 + np.array([255, 160, 160]) * 0.5).astype(np.uint8)
Image.fromarray(img).resize((pix.w // 2, pix.h // 2)).save("step1_outside.png")
np.save("lab.npy", lab)
