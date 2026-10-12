"""Render PDF pages to PNG with PyMuPDF. Usage: python -I tools/render_pdf.py PDF OUTDIR DPI [pages e.g. 1-3]"""
import sys, os
import fitz
pdf, outdir, dpi = sys.argv[1], sys.argv[2], int(sys.argv[3])
os.makedirs(outdir, exist_ok=True)
doc = fitz.open(pdf)
rng = range(doc.page_count)
if len(sys.argv) > 4:
    a, b = sys.argv[4].split("-") if "-" in sys.argv[4] else (sys.argv[4], sys.argv[4])
    rng = range(int(a) - 1, min(int(b), doc.page_count))
base = os.path.splitext(os.path.basename(pdf))[0]
for i in rng:
    pg = doc[i]
    pix = pg.get_pixmap(dpi=dpi)
    fn = os.path.join(outdir, f"{base}_p{i+1}_{dpi}.png")
    pix.save(fn)
    print(fn, pix.width, pix.height, "page size pt", pg.rect)
