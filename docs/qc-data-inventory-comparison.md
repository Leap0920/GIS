# Quezon City Data Inventory — Ours vs. Theirs

Purpose: one complete list of every input the console needs, what we are running on today as a
provisional stand-in, and what to ask the LGU for — so the two can be compared item by item.

Scope: whole Quezon City, 142 barangays, 6 districts, 161.11 km², 3.08M people (2024 census).
Companion docs: `qc-lgu-data-request-simple.md` (the ask), `qc-lgu-data-request.md` (field detail).

---

## Status codes

| Code | Meaning |
|---|---|
| **KEEP** | ours is fine, no LGU version needed |
| **VALIDATE** | ours exists — ask them to confirm or correct it |
| **REPLACE** | theirs is authoritative; ours is a provisional stand-in |
| **ADD** | we have nothing; theirs is the only source |

---

## Why the provisional build cannot just be scaled

| | Novaliches now | Whole QC | Change |
|---|---|---|---|
| Area | 78.58 km² | 161.11 km² | 2.05× |
| Barangays | 20 | 142 | 7.1× |
| Average barangay | 3.93 km² ≈ 393 thermal px | 1.135 km² ≈ 113 thermal px | **3.5× less support** |
| 40 m cells | 27,418 valid | ~56,000 expected | ~2× |
| Thermal pixels, 100 m native | 7,858 | 16,111 | 2.05× |

Same area growth, seven times the reporting units. Every per-barangay thermal statistic gets
roughly a third of the support it had. That single fact is why boundaries, land area and zoning
move from "nice to have" to load-bearing.

---

## A. Imagery and derived rasters

| # | Data | Feeds | Ours now | Ask LGU for | Status |
|---|---|---|---|---|---|
| A1 | Sentinel-2 L2A — B04, B08, SCL | NDVI | Tile T51PTS, 10 m, 16 scenes 2026, SCL-masked, <25% cloud | nothing — confirm our dates match their imagery programme | VALIDATE |
| A2 | Landsat 8/9 C2 L2 — ST_B10, QA_PIXEL | LST | Path/row 116/050, 16 scenes 2026, QA_PIXEL-masked | nothing | VALIDATE |
| A3 | Sentinel-2 B11, B12 | NDBI covariate for residual | not yet used | nothing | KEEP |
| A4 | Sentinel-2 B03, B11 | MNDWI water covariate | not yet used | nothing | KEEP |
| A5 | Copernicus DEM GLO-30 | elevation covariate | not yet used | their LiDAR DSM if held (A9 in request doc) | VALIDATE |
| A6 | MODIS MOD11A2 / VIIRS VNP21A1D | daily thermal context | not used | nothing | KEEP |
| A7 | ECOSTRESS L2T_LSTE_V2 | 70 m thermal, optional | not used | nothing | KEEP |
| A8 | NDVI raster | layer 1 | derived, 40 m grid, 0.00–0.45 stretch | — | KEEP |
| A9 | LST raster | layer 2 | derived, 40 m grid, 44–54 °C stretch | — | KEEP |
| A10 | Heat residual = LST − f(NDVI) | layer 3 | derived, OLS fit, ±6 °C | covariates from B5, B6, A5 | KEEP |
| A11 | Vegetation class Low/Mod/High | layer 4 | cuts at 0.10 / 0.20, global | **zone-specific cuts from B4** | REPLACE |

---

## B. Geography and boundaries

| # | Data | Feeds | Ours now | Ask LGU for | Status |
|---|---|---|---|---|---|
| B1 | Barangay boundaries | all four layers, every per-barangay statistic | OSM `admin_level=10`, 20 polygons, ODbL, indicative | PSGC-coded polygons, 142, WGS84 + PRS92 | **REPLACE** |
| B2 | Barangay land area (ha) | 60-thermal-pixel reliability flag | computed from OSM geometry | the city's own computed area per barangay | **ADD** |
| B3 | District boundaries | grouping, reporting | none | 6 polygons | **ADD** |
| B4 | Zoning and land use | stratification, class cuts, residual | none; OSM `landuse` sparse | zone polygons + zone codes + CLUP | **ADD** |
| B5 | Building footprints | residual, building density | none | footprints with use + storeys | **ADD** |
| B6 | Impervious surface | residual | none | fraction raster, or derive from B5 | **ADD** |
| B7 | Parks / green space | NDVI ground truth, greening | none | polygons, area, tree counts, planting records | **ADD** |
| B8 | City boundary | extent, clipping | bounding box only | official polygon | **ADD** |
| B9 | Purok / sitio boundaries | finer reporting | none | if held | **ADD** |
| B10 | Water bodies / drainage | MNDWI cross-check | derived from B03/B11 | if held as vectors | VALIDATE |
| B11 | Roads | basemap, context | OSM tiles + Esri basemaps | not needed for this system | KEEP |

---

## C. Population, exposure and validation

| # | Data | Feeds | Ours now | Ask LGU for | Status |
|---|---|---|---|---|---|
| C1 | Population per barangay | exposure view | none | totals per barangay, year + source | **ADD** |
| C2 | Households, density | exposure view | none | per barangay | **ADD** |
| C3 | Age structure (0–4, 60+) | heat vulnerability | none | per barangay | **ADD** |
| C4 | PWD, informal settler families | heat vulnerability | none | per barangay | **ADD** |
| C5 | Heat-sensitive facilities | exposure map | none | schools, day care, senior centres, health centres, hospitals | **ADD** |
| C6 | Heat-related illness counts | empirical validation | none | monthly counts per barangay, anonymised | **ADD** |
| C7 | City heat / UHI study | validation, prior work | none | whatever exists | **ADD** |
| C8 | PAGASA air temperature | sanity check only | none | request from PAGASA, not the LGU — Science Garden, Diliman | **ADD** |
| C9 | Published QC LST literature | validation | Alcantara 2019, Landicho & Blanco 2019 identified | — | KEEP |

---

## D. Reference and technical conventions

| # | Data | Feeds | Ours now | Ask LGU for | Status |
|---|---|---|---|---|---|
| D1 | PSGC code list | join key | PSA 2024 | their authoritative barangay list with codes | **REPLACE** |
| D2 | Analysis grid / CRS | every raster and statistic | UTM 51N (EPSG:32651), 40 m | what their Unified GIS uses (PRS92 likely) | **VALIDATE** |
| D3 | Barangay name gazetteer | joins, labels | OSM names | official spelling + aliases | **REPLACE** |
| D4 | CLUP, Zoning Ordinance, CDP | zoning context | public PDFs | current versions if superseded | VALIDATE |
| D5 | Licence and attribution terms | publication, demo | ODbL for OSM, USGS/ESA for imagery | DSA terms, credit line, review requirement | **ADD** |

---

## The comparison protocol — how to check ours against theirs

Run these seven checks the day their data lands. Each one either confirms the provisional build or
tells you exactly where it breaks.

1. **Area sum.** Total polygon area of their 142 barangays must equal 161.11 km² (±0.5%). If it does
   not, the boundary set is a different vintage or a different projection — stop and ask.
2. **Join rate.** How many of their 142 PSGC codes match a name in our current set. Anything under
   142/142 means name-based joins will silently drop barangays.
3. **Centroid offset.** Distance between each OSM barangay centroid and the official one. Report the
   median and the 95th percentile in metres. Anything over ~150 m on a barangay under 0.6 km² means
   our current zonal statistics for that barangay are wrong.
4. **Thermal support recount.** Recompute thermal pixels per barangay on their boundaries. Count how
   many fall under 60. That number replaces "expect a long tail" with a hard figure for Chapter 3.
5. **Statistic delta.** Recompute mean NDVI and mean LST per barangay on their boundaries and
   correlate against ours. r above ~0.98 means the boundary swap is cosmetic; below that, every
   number in the console has to be regenerated and the old screenshots retired.
6. **Zoning strata.** Fit the NDVI–LST slope separately per zone class. If the slopes differ
   materially, the global 0.10 / 0.20 class cuts are indefensible and must become zone-specific —
   which is the strongest argument for B4.
7. **Park validation.** Compare NDVI inside their park polygons against the city median. Parks should
   sit clearly above it. If they do not, either the park polygons or the NDVI layer is wrong.

---

## Fill-in sheet

Print this and complete it as each office responds.

| Dataset | Office | Requested | Received | Format | Rows / polygons | Notes |
|---|---|---|---|---|---|---|
| B1 Barangay boundaries | CPDD / ITDD | | | | | |
| B2 Land area | CPDD | | | | | |
| B3 District boundaries | CPDD | | | | | |
| B4 Zoning + land use | CPDD | | | | | |
| B5 Building footprints | Assessor / DBO | | | | | |
| B6 Impervious surface | CPDD / Assessor | | | | | |
| B7 Parks + trees | PDAD / CCESD | | | | | |
| B8 City boundary | CPDD | | | | | |
| B9 Purok / sitio | CPDD / BCRD | | | | | |
| C1 Population | CPDD | | | | | |
| C2 Households, density | CPDD | | | | | |
| C3 Age structure | CPDD / BCRD | | | | | |
| C4 PWD, informal settlers | BCRD | | | | | |
| C5 Heat-sensitive facilities | Health / DepEd | | | | | |
| C6 Heat illness counts | Health Dept | | | | | |
| C7 City heat study | CCESD | | | | | |
| D1 PSGC list | CPDD | | | | | |
| D2 Grid / CRS convention | ITDD | | | | | |
| D3 Name gazetteer | CPDD | | | | | |
| D5 DSA + attribution | City Legal | | | | | |

---

## Priority if they cannot supply everything

**Tier 1 — required.** B1, B2. Without these the console cannot be rebuilt at city scale at all.

**Tier 2 — required for the analysis to hold up.** B4, B5 (or B6), A11. Without these the residual
stays unattributed and the vegetation classes stay globally cut.

**Tier 3 — required for the LGU to care.** C1, C3, C5. Without these it is a temperature map, not an
exposure product.

**Tier 4 — validation and polish.** B7, C6, C7, A5, B9. Each one converts a claim into a measurement.
