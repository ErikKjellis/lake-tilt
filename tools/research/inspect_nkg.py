import sys, tifffile, numpy as np
p = sys.argv[1]
with tifffile.TiffFile(p) as t:
    for i, page in enumerate(t.pages):
        print("PAGE", i, page.shape, page.dtype)
        for tag in page.tags.values():
            v = tag.value
            s = str(v)
            if len(s) > 3000: s = s[:3000] + '...'
            print(" ", tag.name, tag.code, s)
        if i > 2: break
    a = t.pages[0].asarray()
    print(a.shape, a.dtype)
    for b in range(a.shape[-1] if a.ndim==3 else 1):
        x = a[..., b] if a.ndim==3 else a
        print('band', b, np.nanmin(x), np.nanmax(x))
