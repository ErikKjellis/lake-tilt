# Candidate lakes for the lake-tilt tool

Screened 2026-10-14. All 1 069 NVE lakes of 2 km² or more were screened against NKG2016LU_lev (present-day uplift relative to the geoid) and NGU's national marine-limit points. Full table: [lake_screening_ranking.csv](lake_screening_ranking.csv). Method: [tools/research/lake_screening](../tools/research/lake_screening/README.md).

## How to read the numbers

- **dr**: today's spread in uplift rate across the lake (mm/yr). This is the criterion "uneven land rise across the lake". Altevatnet has 0.61 over its whole polygon (0.57 outlet to SE end).
- **Align**: |cos| of the angle between the lake's long axis and the uplift gradient. 1 means the lake lies along the tilt; 0 means the tilt runs across its width.
- **Tilt hist.**: the integrated differential uplift since deglaciation (10.3 ka), or since isolation for lakes below the marine limit. It uses the Altevatnet time function (τ = 5000 yr). This is a ranking index. In southern Norway it is probably an underestimate, because the ice left earlier and early gradients were steeper.
- **Outlet side**: whether the natural outlet sits on the low-uplift or high-uplift end.
  - **Low side**, like Altevatnet: the far end rises out of the water, shorelines fan out, and an early outlet at the far end is possible.
  - **High side**: the lake is continuously transgressed towards its low end (Passe's rule). Old shorelines and Stone Age sites drown, and the lake can eventually spill over a new col at the low end (cf. Pielinen, Finland).
- **Bathy**: NVE depth map (survey year, contour interval). **digital** = the depth contours are in NVE's Innsjødatabase layers and work directly with `tools/bathymetry.py`. **scan only** = only a scanned PDF depth map exists, so the contours would have to be digitised first. Only 526 Norwegian lakes have digital contours (column `digital_contours` in the CSV).

## Shortlist (ranked)

| # | Lake (vatnLnr) | h (m) | Area km² | dr mm/yr | Align | Tilt hist. | Marine? | Outlet side | Bathy (NVE) | Regulated |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Limingen** (1131) | 418 | 93 | 0.46 | 0.83 | ~16 m | no | **high (E, to Sweden/Ångermanälven)** | scan only: 1946, 20 m, max 192 m | yes (drawdown; natural = HRV 417.7) |
| 2 | **Selbusjøen** (892) | 158 | 58 | 0.57 | 0.99 | ~23 m* | yes, ML ≈188 m, iso. ≈9.5 ka | low (W, Nidelva) | **digital** (18 contours): 1960 echo, 30 m, max 206 m | yes |
| 3 | **Røssvatnet** (501) | 383 | 218 | 0.55 | 0.22 (branched) | ~19 m | no | low (NW, Røssåga) | scan only: 1954, 10 m, max 231 m | yes (natural 374 m) |
| 4 | **Tunnsjøen** (696) | 358 | 100 | 0.44 | 0.90 | ~15 m | no | low (W, Tunnsjøelva) | scan only: 1946, max 222 m | yes (drawdown; natural = HRV 357.64) |
| 5 | **Gjende** (147) | 985 | 16 | 0.25 | 0.90 | ~9 m | no | **high (E, Sjoa)** | **digital** (52): 1968, 10 m, max 149 m | **no** |
| 6 | **Bygdin** (146) | 1058 | 40 | 0.39 | 0.99 | ~13 m | no | **high (E, Vinstra)** | scan only: 1965, max 200 m | yes |
| 7 | **Aursunden** (114) | 691 | 46 | 0.36 | 0.99 | ~12 m | no | low (W, Glomma) | **digital** (106): 1964, max 60 m | yes |
| 8 | **Gjevillvatnet** (2101) | 661 | 21 | 0.31 | 0.99 | ~11 m | no | to verify | scan only: 1952, 10 m, max 105 m | yes |
| 9 | **Vågåvatnet** (149) | 362 | 14 | 0.26 | 0.98 | ~9 m | no | **high (E, Otta)** | scan only: 1968, max 82 m | **no** |
| 10 | **Namsvatnet** (698) | 454 | 40 | 0.27 | 0.67 | ~9 m | no | to verify | **digital** (102): 1964 echo, 10 m, max 84 m | yes |
| 11 | **Mjøsa** (118) | 123 | 369 | 0.42 | 0.28 | ~11 m* | yes, ML ≈190–200 m | low (S, Vorma) | **digital** (91), but 1900 hand-sounding, 20 m | yes |
| 12 | **Snåsavatnet** (930) | 22 | 122 | **0.70** | 0.71 | ~3 m* | yes, ML ≈169 m, isolated late | low (SW, Byaelva) | **digital** (100): 1970, 10 m, max 121 m | yes |

\* Below the marine limit, so the tilt history starts at isolation from the sea. The isolation ages are model estimates and should be checked against regional sea-level curves.

### Why these, briefly

1. **Limingen + Tunnsjøen**: Limingen's natural outlet (Linvasselv → Kvarnbergsvattnet → Ångermanälven) is on the *high-uplift* Swedish side, so the lake has transgressed NW throughout the Holocene. The model run (below) shows that the real outlet switch is at **Tunnsjøen**: it drained east to the Baltic over a low mire col until late in the Holocene. Both lakes have only scanned depth maps. Kvarnbergsvattnet (0.47 mm/yr) is downstream on the Swedish side.
2. **Selbusjøen** has the best-aligned tilt in Norway (0.99, gradient almost exactly along the E–W axis) and is deep. It was a fjord arm until roughly 9.5 ka, so the tool needs a marine phase, or the timeline should start at isolation. Its weak point is the 30 m contour interval in the depth map.
3. **Røssvatnet**: the tilt is large but the lake is branched, so the eastern arms tilt differently from the main basin. That is visually interesting. Same type as Altevatnet (outlet on the low side).
4. **Tunnsjøen** works on its own or combined with Limingen (see 1).
5–6, 9. **Gjende, Bygdin, Vågåvatnet** are the clean "transgressing lake" examples. All drain east, towards the rising side. Gjende and Vågåvatnet are unregulated, so there is no need to reconstruct a natural level. The high-mountain lakes were deglaciated late, which shortens their history.
7. **Aursunden**'s east end is close to the Swedish water divide. Check whether an early eastward outlet was possible, as at Altevatnet.
11. **Mjøsa** has a large dr, but the tilt runs mostly *across* the lake, and the depth map is from 1900.
12. **Snåsavatnet** has the highest present-day dr of any lake in the screening, but it was isolated from the sea late, so the integrated tilt is small. It is good for the "future" end of the timeline.

### Strong but mostly in Sweden

Sijdasjávrre/Sitasjaure (0.63), Umbukta/Överuman (0.63), Store Le/Stora Le (0.58) and Kvarnbergsvattnet (0.47) score as high as Altevatnet. The Kartverket DTM and NVE bathymetry cover only the Norwegian part, so these lakes would need Lantmäteriet's elevation model and Swedish depth data.

### Ruled out or weak

- **Femunden**: dr 0.22, but the tilt runs across the lake (align 0.08).
- **Randsfjorden, Tinnsjå, Krøderen**: dr ≤ 0.15 and the tilt runs across the lake.
- **Lesjaskogsvatnet**: its bifurcation is artificial (1660s ironworks dam).
- **Western Norway** (Hornindalsvatnet, Jølstravatnet, Suldalsvatnet and others): deep and well surveyed, but dr ≈ 0.2 or less, and most lie close to the marine limit.

## Model run: Limingen + Tunnsjøen (2026-10-14)

One scene, 65 × 65 km (x 395–460 km, y 7150–7215 km, UTM33), with the Kartverket NHM DTM at 20 m. The DTM covers the Swedish side too. `tools/paleolakes.py` was run unchanged, at a 20 m mesh, F from −4 000 to 60 000. Setup: [simple_natural_dem.py](../tools/research/lake_screening/simple_natural_dem.py), config [limingen_tunnsjoen_20m.json](../tools/research/lake_screening/limingen_tunnsjoen_20m.json), summary [summarise_paleolakes.py](../tools/research/lake_screening/summarise_paleolakes.py), map [limingen_tunnsjoen_paleolakes.png](limingen_tunnsjoen_paleolakes.png).

Simplifications:
- Neither lake has digital bathymetry, so each lake is a placeholder bowl below its natural level. This is enough for the spill levels, not for areas and volumes.
- Natural level = HRV, because both regulations are drawdowns.
- Each outlet dam is replaced by a sill plug at the natural level. Check: at F = 0 both lakes spill at their real outlets, at their natural levels.

**Limingen** drained SE through Linvasselva to Kvarnbergsvattnet, Faxälven and the Baltic for the whole Holocene. Its next-lowest escape is about 48 m higher, which would need F ≈ 47 000 (> 11.7 ka). Its outlet is on the high-uplift side, so the lake has transgressed NW all the time: modelled area ≈ 79 km² at 10 ka against 93 km² today. Limingen is a pure transgression story with no outlet switch, and it never merges with Tunnsjøen.

**Tunnsjøen switches outlet.** South of Litl-Tunnsjøen, the Tunnsjøfloan mire holds a natural col at about 359.2 m (DTM, near 436 230 / 7 171 970). That is only about 1.6 m above today's natural level. The col drains SE through Tunnsjøbekken to Kvarnbergsvattnet, the same Baltic route as Limingen. The col rises 0.42 mm/yr faster than today's outlet (Tunnsjøelva, to Namsen and the Atlantic). The modelled sequence:

| Period (cal BP, τ = 5000) | Tunnsjøen outlet |
|---|---|
| deglaciation → ≈ 6 900 | E, to the Baltic. Spill at the Litl-Tunnsjøen narrows (435 020 / 7 174 030), then over the Tunnsjøfloan col |
| ≈ 6 900 → ≈ 2 900 | E, to the Baltic, over the Tunnsjøfloan col; Litl-Tunnsjøen is part of the lake |
| ≈ 2 900 → today | W, Tunnsjøelva → Namsen (Atlantic) |

The switch age is very sensitive to the col height, because the col is so close to today's lake level:
- ±0.7 m on the col moves it to about 1.8–3.8 ka.
- Local versus NN2000 datum adds about ±0.5 m.
- Peat growth on the mire has probably raised the col since it was abandoned, and τ is uncertain as well.

The robust conclusion is that Tunnsjøen very likely drained to the **Baltic** for most of the Holocene and turned west to the Atlantic late, possibly within the last 2–4 kyr. This is the same Atlantic-versus-Baltic story as Altevatnet, but much later. It is testable: look for an abandoned outlet channel in the Tunnsjøfloan mire, and date the basal peat or the channel infill.

The coarser 40 m mesh blurred the narrow mire channel and placed the col about 6 m too high, which gave a switch at about 7.7 ka. Use a 20 m mesh for this scene.

### Update: Tunnsjøen digitised and in the viewer (`?lake=tunnsjoen`)

NVE's scanned 1946 depth map of Tunnsjø has been digitised ([method](../tools/research/digitise_depth_map/README.md), [check figure](tunnsjoen_digitisation_check.png)). The result matches the map: area 99.9 km² (map: 99.6) and maximum depth 222 m. The volume is 12 % low (7.6 against 8.7 km³).

The full scene (Tunnsjøen, Litl-Tunnsjøen and a schematic Limingen) was run on a 20 m grid. The Tunnsjøfloan col was checked on the 2, 10 and 20 m DTMs; it lies at 359.2–359.6 m everywhere. The scene confirms the screening result: the lake drains east to the Baltic until **≈ 2 700–2 800 cal BP**, then west through Tunnsjøelva. Two things had to be fixed to get this right:
- **Narrow straits:** Litl-Tunnsjøen's southern channel is only a few tens of metres wide and closes on a 20 m grid. The scene therefore treats the whole regulated polygon as lake (the HRV is the natural level).
- **Outlet:** the dam site needed a sill plug at the natural level.

## Caveats

- NKG2016LU is a present-day rate. The tool's separable model, r(x,y)·F(t), assumes the *pattern* has stayed fixed. That is reasonable in the north, where it was calibrated. Near the former ice divide (Trøndelag and the border lakes) early-Holocene gradients were probably steeper, so the tilt may be larger than shown.
- "Outlet side" comes from river geography, not from DTM analysis. Before committing to a lake, run the tool's spill-point model (`paleolakes.py`) on a coarse DTM to see whether the outlet actually switches.
- NVE depth maps are often from the 1940s–60s, and most of these lakes are regulated. The survey level and the natural level must be taken from the NVE concession documents, as was done for Altevatnet.
