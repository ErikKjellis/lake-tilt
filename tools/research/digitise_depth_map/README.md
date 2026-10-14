# Digitising an NVE scanned depth map (Tunnsjøen, 696a.pdf)

NVE has no digital contours for Tunnsjøen, only a scanned 1946 map (`http://gis3.nve.no/dybdekart/696a.pdf`: sounded by Olaf Ångaby at ≈ 355 m, 20 m contours from 10 m, ~100 dpi). These scripts turn it into the `data/raw/tunnsjoen_{dybdepunkt,dybdekurve,omkrets_dybdemalt}.geojson` files that `tools/bathymetry.py` reads.

The process is semi-automatic. The hand-made inputs are `spots.json` (printed soundings used as anchors), `anchors.json` (region levels read off a clean transect), and two island seed points in `step6_graph.py`. All three use pixel coordinates of the 2× render shown at 2000 px wide; `K = 1.725` converts them to the 3× working raster.

Run the scripts in a scratch directory with the project venv. scikit-image and PyMuPDF go in a separate folder, passed as the first argument where needed.

| Step | Script | What it does |
|---|---|---|
| 1 | `step1_mask.py PYLIB 696a.pdf` | Renders the page at 3× (grey), thresholds the ink and floods the outside from the border, giving the lake mask. |
| 2 | `step3_link.py PYLIB 100` | Takes faint lines with a local-contrast threshold and skeletonises them. Every line end is bridged to the nearest line ahead of it (≤ 100 px, cos ≥ 0.6), so the broken contours close. This gives the regions between contours. |
| 3 | `step6_graph.py` | Builds the region adjacency graph. For each pair it records boundary length, ink thickness and how much of the boundary is a bridge line. |
| 4 | `step8_lsq.py` | Solves the contour level of every region by robust least squares. Thin-line boundaries mean +1 level away from the shore; bridge-line boundaries mean the same level. The anchors (`anchors.json`, `spots.json`) and the shore are fixed. Check the result with `transect.py`: levels must step down by one per contour to 0 at the shore. |
| 5 | `step9_georef.py ROOT` | Fits a 6-parameter affine transform from UTM to scan pixels by maximising the overlap with NVE's lake polygon. Litl-Tunnsjøen, which the map lacks, is masked out. Result: IoU 0.91, 7.0 m/px, −3.9° rotation. |
| 6 | `step10_export.py PYLIB ROOT` | Writes depth points along every resolved contour line (level difference exactly 1 across the line), plus the anchor soundings. The survey outline is the scan shoreline minus NVE's island outlines. |
| 7 | `qa_figure.py ROOT SCRATCH` | Writes `docs/tunnsjoen_digitisation_check.png`. |

## Result and checks

- Area 99.9 km² (map: 99.6) and maximum depth 222 m (map: 222).
- Volume 7.59 km³ against the map's printed 8.68 km³ (−12.5 %), so the mean depth is 76 m against 87.1. The steep shores, where up to ten contours merge into one smear, have no points; there the spline takes a straight slope from the shore to the first resolved contour. The 1946 planimetric volume may also be high.
- About 15 % of the region-graph edges disagree with the solved levels. These are mostly bridge lines and merge forks, which the robust weights down-weight.
- The georeferencing is good to roughly 50–100 m (one or two scan pixels at 3×, plus the 1946 drafting). The outlet therefore needs `"plug_radius_m"` in the scene config.

The shallow spot labels (34, 36, 104, 118 …) were too blurred to read reliably. They are not used as anchors.
