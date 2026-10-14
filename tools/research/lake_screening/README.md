# Lake screening: which other Norwegian lakes tilt?

These scripts produced `docs/lake_screening_ranking.csv` and `docs/candidate_lakes.md`. Run them in order with the project venv and `-I -X utf8`:

```
python -I -X utf8 1_fetch_nve.py OUTDIR          # NVE lakes >= 2 km2 (layer 5) + depth-map catalogue (layer 4)
python -I -X utf8 2_uplift_across_lakes.py data/raw/nkg2016lu_lm/extracted OUTDIR
curl "https://geo.ngu.no/api/features/maringrense/collections/maringrensepkt/items?f=json&limit=10000" -o OUTDIR/mgpkt.json
python -I -X utf8 3_marine_limit_isolation.py OUTDIR
```

Step 2 samples NKG2016LU_lev over each lake polygon and reports the spread `dr = max - min` (mm/yr), the plane-fit gradient direction, the lake's principal axis and how well the two align. Step 3 interpolates NGU's marine-limit points (IDW, 6 nearest) to decide whether the lake was once sea. For those lakes it estimates an isolation age by scaling the Altevatnet time function to the local marine limit, using Passe & Daniels (2015) eustasy. `tilt_hist_m` is the differential uplift across the lake since deglaciation (10.3 ka) or since isolation. It is a screening index, not a reconstruction.
