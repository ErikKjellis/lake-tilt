# Altevatnet — a tilting lake

An interactive 3D web visualisation of how **Altevatnet** (Álddesjávri, Bardu, Troms) has tilted since the last deglaciation. The cause is post-glacial (glacio-isostatic) rebound. The terrain is today's landscape with the hydropower reservoir removed. The lake is restored to its **natural** level of 475.8 m (local datum), about 475.95 m NN2000.

**Live version:** <https://erikkjellis.github.io/lake-tilt/>

## Run it

The site is static, but the browser has to load binary data files, so it must be served over HTTP:

```
start.bat
```

Or run it manually:

```
python tools/serve.py 8765
```

Then open <http://localhost:8765>. Everything, including three.js, is vendored in `web/`, so it works offline. Only the optional aerial-photo basemap needs internet.

URL options:
- `?lang=no` — Norwegian
- `?q=low` — 80 m mesh for weak GPUs
- `?q=high` — force the 40 m mesh

## Getting around

On the first visit a short guide, *How to use the map*, explains the controls step by step. Tick *Don't show this again* to skip it next time. The **?** button next to the language switch (or the `?` key) opens a help panel with the gestures, the keyboard shortcuts and a button to show the guide again. `?guide=1` in the URL always shows the guide; `?guide=0` never does.

| | Mouse | Touch |
|---|---|---|
| Turn and tilt the view | Left-drag | One finger |
| Move | Right-drag, or Shift + left-drag | Two fingers |
| Zoom (towards the pointer) | Scroll wheel | Pinch |

**3D / Map (from above)** at the top of the View panel switches between the 3D view and a north-up map seen from straight above (drag to move, scroll to zoom; it cannot be rotated). **⌂** flies back to the starting view.

## What you see

| Control | Meaning |
|---|---|
| Time slider / ▶ | From deglaciation (≈ 10 300 cal BP) to 3000 CE. Event ticks mark outlet switches, merging lakes, the dam and so on. |
| *Land fixed · water tilts* | Today's terrain. The palaeo-water surface is drawn tilted, as it would appear against today's landscape. |
| *Water flat · land tilts* | The water is level, as it was at the time, and the land is deformed back in time. |
| Palaeo-shorelines | Where the water surface stood every 1000 yr, drawn on today's terrain. They crowd together at the outlet and fan out towards the SE. |
| Overlay | Uplift since the chosen time relative to the outlet, or today's NKG2016LU uplift rate. |
| Model parameters | Relaxation time τ, a scale on the uplift gradient, and the deglaciation age. Use these to explore the uncertainty. |
| Long profile | A section from the dam, past the outlet and Straumen, along Altevatnet and Leinavatnet to the SE col. Hover it to place a pin in 3D. |
| Guided tour | Eight steps written for a presentation. Captions take their numbers from the model, so they follow the parameter sliders. |
| Save image | Exports a PNG of the 3D view with the date and credits, for slides. |

### Cultural heritage sites (kulturminner)

The **Cultural heritage sites** checkbox shows Riksantikvaren's registered sites (558 in the area; 13 marked as removed are left out) as markers draped on the terrain. Hover a marker for its ID, name and dating; click it for a popup with the type, monuments, protection status, description and a link to Kulturminnesøk (the popup stays until you close it, click the map or press Esc). When zoomed in (view distance under about 8 km), the site outlines (*lokalitet*, solid line with a translucent fill) and safety zones (*sikringssone*, dashed) are drawn as well, and clicking inside an outline opens its popup.

Each site is classified from the site and its individual monuments (`tools/fetch_kulturminner.py`):

| Category | Marker | Rule | Sites |
|---|---|---|---|
| Sami | red circle | protected as Sami heritage (KML §4 second paragraph, 1917 or older), dated *Samisk jernalder*, or, when not Stone Age / Early Metal Age dated, a monument type diagnostic of Sami culture (árran, gamme, offering site/sieidi, reindeer fence, meat cache, bow-hunting stand) | 408 |
| Stone Age & Early Metal Age | orange triangle | Stone Age, *sein steinbrukende tid*, *tidlig metalltid*, Bronze Age and the ranges *steinalder – bronsealder*, *bronsealder – jernalder* | 56 |
| Iron Age & Middle Ages | teal hexagon | Iron Age (incl. Viking Age), Middle Ages and *jernalder – middelalder* | 15 |
| Modern | violet square | all datings after the Reformation (1537 or later) | 15 |
| Other / undated | grey diamond (off by default) | *eldre enn 100 år*, *uviss tid*, *førreformatorisk tid* or undated (mostly pitfall traps and hearths) | 64 |

The shapes differ as well as the colours, so the categories stay distinct in black-and-white print. Data: Riksantikvaren, *Kulturminner – Lokaliteter, Enkeltminner og Sikringssoner* (open data, WFS `wfs.geonorge.no/skwms1/wfs.kulturminner`). Update with `python tools/fetch_kulturminner.py`.

### Poster export (water-level overlays)

**Poster export** in the title card exports separate, exactly registered images for printing or for stacking as analogue overlays (for example on transparent film):

- **View:** *3D view* uses the current camera; mountains in front hide the water, as on screen. *Map (top-down)* switches to an orthographic, north-up view (UTM 33 grid north), so you can pan and zoom to frame the poster.
- **Format and size:** A-series landscape or portrait, square, 16:9 or the whole screen, and 3000–10000 px on the long side. The panel shows the print size at 300 dpi, and a dashed frame shows what will be exported.
- **Layers:** past water levels (cal BP, comma-separated), plus today's natural level and today's reservoir at its lowest (LRV 472.8 m) and highest (HRV 489.0 m) levels. Each layer is a transparent PNG with its own colour, fill opacity and shoreline outline. Leinavatnet can be included or left out.
- **Cultural heritage sites:** one transparent PNG per selected category (marker size in pixels; optionally with the site outlines and safety zones under the markers), plus `kulturminner.geojson` (points), `kulturminner_lokaliteter.geojson` (outlines) and `kulturminner_sikringssoner.geojson` (safety zones), all EPSG:25833.
- **Background:** today's aerial photo from Norge i bilder (online). Areas without coverage (Sweden) are filled with the natural-relief map. Alternatively the relief or the topographic map.
- **Output:** one ZIP with `00_background_*.jpg`, `01_water_*.png` …, `preview_all_layers.jpg`, `legend.svg` and `info.txt`. The info file lists the layers, model parameters, credits and a *view code* that restores the exact viewpoint. In map mode every image also gets a world file (`.pgw`/`.jgw`) and `.prj` (EPSG:25833), so it opens georeferenced in QGIS or ArcGIS.

All images share the same camera, crop and pixel size, so they line up exactly when stacked. Past water levels are model results; the aerial photo is © Norge i bilder (check its terms before printing).

### Keyboard

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | Step time 100 yr (Shift: 1000 yr) |
| M | 3D view / map from above |
| R | Back to the starting view |
| ? (or H) | Help |
| 1–8 | Jump to a tour step |
| PageDown / PageUp / Enter (during the tour) | Next / previous step; this works with presentation clickers |
| P | Presentation mode: larger type, fewer controls |
| L | Switch language (remembered between visits) |
| F | Full screen |
| Esc | Close the help, dialog, guide or popup, or end the tour |

Shortcuts are ignored while you type in a text field or a drop-down menu has the focus, and while the *About the model* dialog is open.

## The model in brief

- **Uplift.** Uplift from time *t* to today is `U(x,y,t) = r(x,y)·F(t)`.
  - `r` is today's land uplift relative to the geoid: NKG2016LU_lev, fitted with a quadratic surface (max residual 0.006 mm/yr).
  - `F(t) = k·τ·(e^{(t−t₀)/τ} − e^{(t_now−t₀)/τ})` with τ = 5000 yr and t₀ = 2000 CE, the NKG2016LU epoch, so that F(today) = 0. This was calibrated on the tilted Torneträsk ice-lake shorelines (Ploeg & Stroeven 2025) and the Målselv marine limit.
- **Tilt.** Only differential uplift tilts the lake. The SE end rises about 0.57 mm/yr faster than the outlet today.
- **Natural DEM.** Built from the Kartverket 10 m DTM (NN2000), NVE's 1959 echo soundings (taken at 477.0 m local), interpolated land under the reservoir, and a carved natural outlet channel. Leinavatnet has no depth data and is given 1 m.
- **Palaeo-lakes.** For each value of F, the topography is deformed and the basin filled until it spills over the lowest col, using a 40 m grid and bisection with connected components. This gives the lake level, area and spill point for Altevatnet's main basin, its western basin and Leinavatnet. It also gives each grid cell's wet interval in F. Since everything depends on t only through F, the viewer can change τ, k and the deglaciation age without recomputing.
- **Result.** With the calibrated values the model predicts that until about 9 290 cal BP the lake drained **south-east**, over a col at about 500 m to the Torneträsk basin and the Baltic. From about 9 510 cal BP it merged with Leinavatnet, and Leinavatnet separated again at about 9 170 cal BP. Only then did the present NW outlet, Barduelva to the Atlantic, take over. This is a model result. Ice may still have blocked the SE route early on, and the col and sill heights carry a few metres of uncertainty.

## Project layout

```
web/                  the site (index.html, css/, js/, vendor/three r185.1, data/altevatn/)
tools/                Python processing pipeline (tools/research: calibration and checks)
  scene_config.json   all lake-specific parameters (levels, outlet, channel, places, lakes to track)
  bathymetry.py       NVE depth contours -> tension-spline bathymetry
  natural_dem.py      DTM + bathymetry + reconstructed flooded land + outlet channel
  paleolakes.py       spill-level / flood model as a function of F
  bake_basemap.py     Kartverket WMTS (utm33n) -> texture
  export_web.py       everything the viewer needs -> web/data/<lake>/
data/raw/             downloaded source data (NVE, Kartverket, NKG, papers)
data/processed/       intermediate products
```

### Rebuilding the data

The raw source data are not in the repository, because they are large and some are not redistributable. Fetch them first, using the project virtual environment (numpy, scipy, shapely, pyproj, tifffile, pillow, matplotlib):

```
python tools/fetch_nve.py 2396 altevatn
python tools/fetch_dtm_wcs.py data/raw/dtm_ext/tiles_10m 640000 7580000 720000 7640000 10 2000 2000 bilinear
python tools/mosaic_dtm.py data/raw/dtm_ext/tiles_10m data/raw/dtm_ext/dtm10_ext
```

`data/processed/uplift_rate_grid.json` (NKG2016LU sampled over the area) is included. To recreate it, download the NKG2016LU grids from Lantmäteriet into `data/raw/` and run `tools/uplift_rates.py`. Then:

```
python tools/natural_dem.py
python tools/paleolakes.py      (about 2.5 min)
python tools/bake_basemap.py topo 11 web/data/altevatn/basemap_topo.jpg
python tools/export_web.py
```

`tools/research/` holds the scripts used while researching the model: calibration of τ, checks of NKG2016LU, deglaciation ages and the regulation history.

### Adding another lake

1. Download the lake's NVE data, using its `vatnLnr` from NVE's Innsjødatabase: depth contours, depth points, survey outline and lake polygon. Get them from `https://kart.nve.no/enterprise/rest/services/Innsjodatabase2/MapServer` (layers 1–5, `where=vatnlnr=<id>`, `outSR=25833`, `f=geojson`). Save them as `data/raw/<lake>_*.geojson`.
2. Get a DTM covering the lake and all candidate spill points with `tools/fetch_dtm_wcs.py`, then `tools/mosaic_dtm.py`.
3. Copy `tools/scene_config.json` and set the following:
   - the natural level (from NVE regulation documents for regulated lakes)
   - the survey level and datum shift
   - the outlet point and channel
   - the lakes to track
   - the render box and places
4. Run the pipeline above and point `DATA` in `web/js/main.js` at the new folder.

## Data and credits

- Terrain: © Kartverket, DTM via Geonorge WCS (CC BY 4.0).
- Bathymetry, lakes, dams: NVE. The depth maps are for non-commercial use only and must not be used for navigation.
- Land uplift: NKG2016LU (Vestøl et al. 2019, J. Geodesy 93:1759), from Lantmäteriet / NKG.
- Cultural heritage sites: Riksantikvaren (open data, NLOD).
- Regulation history: Devik (1959, NVE); the OED 2022 concession revision; Statkraft (2009).
- Quaternary geology: Bargel (1984), NGU Skrifter 52; Andersen (1968), NGU 256.
- Maps: © Kartverket. Aerial photos: Norge i bilder (online view only).
- 3D: three.js (MIT).
