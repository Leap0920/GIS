# SafeNet GIS — Data Requirements for Quezon City-Wide Deployment

Status: draft request schedule, 2026-10-31.
Scope: whole Quezon City — 142 barangays, 6 congressional districts, 161.11 km²,
population 3,084,270 (2024 Census of Population, PSA).
Supersedes: the Novaliches-only extent (20 barangays, ~8.75 × 8.98 km) in `C:\codes\SafeNet-data`
and the console in `C:\codes\GIS`.
One-page version: `qc-lgu-data-request-simple.md`.

---

## 0. What the system computes, and what each layer needs

The console produces four layers. All four are derived from satellite rasters; none is supplied
by the LGU. What the LGU supplies is the geography those rasters are aggregated onto, and the
ground truth that makes the numbers mean something.

| Layer | Definition | Native support | What it consumes |
|---|---|---|---|
| NDVI | (NIR − RED) / (NIR + RED) | Sentinel-2 B04/B08, 10 m | imagery + SCL cloud mask |
| LST | surface temperature, °C | Landsat `ST_B10`, 100 m native | imagery + QA_PIXEL mask |
| Heat residual | LST − f(NDVI), f = OLS fit | 100 m, shown on 40 m grid | LST, NDVI, **plus covariates**: elevation, building/impervious density, water |
| Vegetation class | Low / Moderate / High | 40 m grid | NDVI + **thresholds that should vary by land use** |

Two consequences drive the whole request:

1. **The residual is only as good as its covariates.** LST − f(NDVI) currently absorbs elevation,
   imperviousness and water into one unexplained number. Buildings and zoning are what let the
   residual be attributed rather than merely displayed.
2. **Fixed class cuts do not survive a 7× area increase.** 0.10 / 0.20 were fitted to 20 Novaliches
   barangays. Applied to 142 barangays spanning cemeteries, subdivisions, industrial estates and
   the Diliman campus, one global cut will mislabel whole districts. Land use is what makes
   stratified cuts defensible.

Scale arithmetic:

| Quantity | Whole QC | Consequence |
|---|---|---|
| Area | 161.11 km² | — |
| Landsat thermal pixels, 100 m native | 16,111 | the real thermal support |
| 40 m analysis cells (current console grid) | 100,694 | ~3.7× the Novaliches build |
| Sentinel-2 pixels at 10 m | 1,611,100 | NDVI resolution is not the constraint |
| Average barangay | 1.135 km² ≈ 113 thermal px | — |
| Barangay under 0.6 km² | under 60 thermal px | must be flagged, not reported as reliable |
| Population density | 19,144 /km² | exposure, not heat alone, is the risk term |

The Novaliches build flagged one barangay (Capri, 18 px) against the 60-pixel threshold. Across
142 barangays expect a long tail of small urban-core barangays to fall under it. That flag cannot
be computed without authoritative boundaries and barangay area.

---

## 1. How to read this list

- **Tier A — LGU-held.** Only the city government has it. This is the actual request.
- **Tier B — public.** Free, already sourced by us. Listed so the LGU can see we have done the
  free work, and so they can validate our version rather than supply theirs.
- **Tier C — conditional.** High value, but sensitive or only partly held.

---

## 2. Tier A — data only the LGU can provide

### A1. Authoritative barangay boundaries — the load-bearing item

The only dataset the project cannot proceed without at city scale.

| Field | Note |
|---|---|
| `psgc_code` | 10-digit PSGC, the join key |
| `bgy_name` | official spelling |
| `district_no` | 1–6 |
| `geom` | polygon / multipolygon |
| `area_ha` | the city's own computed land area |
| `purok` / `sitio` | optional, but many barangay reports are given at this level |

Also: the official **city boundary** polygon, and district boundaries.

Granularity: 142 polygons. Two copies — PRS92 (EPSG:3123) and WGS84 (EPSG:4326).

Holding office: **City Planning and Development Department (CPDD)**; **ITDD** is the likely
custodian inside the new Unified GIS.

Serves: zonal statistics for all four layers, the 60-thermal-pixel reliability flag, every
per-barangay table and chart in the console.

If refused: fall back to PSA/PSGC shapefiles or OSM `admin_level=10`. Both are indicative, with
edge differences of tens of metres — which is material for barangays under 0.6 km². The thesis
must then state that the reliability flag is approximate, and the LGU-facing deliverable loses
the one thing an LGU will check first.

### A2. Population and heat vulnerability

| Field | Note |
|---|---|
| `psgc_code`, `bgy_name` | join key |
| `population_total`, `households` | — |
| `density_per_km2` | derived, but ask for their figure |
| `age_0_4`, `age_60plus` | heat-sensitive cohorts |
| `pwd_count` | — |
| `pregnant_women` | if held |
| `informal_settler_families` | heat exposure concentrates here |
| `year_of_estimate`, `source` | PSA census vs projection — must be stated |

Granularity: per barangay, annual. Purok level if available.

Holding office: CPDD (projections), **Barangay and Community Relations Department (BCRD)**
(barangay profiles), PSA for the census base.

Serves: turning a temperature map into an exposure map — the difference between "this barangay is
52 °C" and "38,000 people including 4,100 children under five live in it". This is the layer that
justifies the LGU partnership at all.

If refused: PSA 2024 census gives totals for all 142 barangays, so the console still works — but
loses age structure, PWD and informal-settler counts, and every vulnerability weighting.

### A3. Zoning and land use

| Field | Note |
|---|---|
| `zone_code`, `zone_class` | use their codes verbatim — R-1…R-3, C-1…C-3, I-1/I-2, institutional, parks/open space, utilities |
| `geom` | polygon |
| `ordinance_ref`, `effectivity_date` | which ordinance established the zone |

Plus: the current land use map, the CLUP, and the Comprehensive Development Plan 2026–2031.

Granularity: polygons.

Holding office: CPDD.

Serves: stratifying the NDVI–LST relationship by land cover (the published QC and Metro Manila
work finds NDVI alone explains only a moderate share of LST variance); setting vegetation-class
thresholds per zone instead of one global cut; attributing the heat residual.

If refused: OSM `landuse` polygons exist but are sparse and inconsistent in QC. The relationship
stays pooled across the whole city, class cuts stay global, and the residual remains unattributed.
This is the dataset whose absence most weakens Chapter 4.

### A4. Buildings or impervious surface

| Field | Note |
|---|---|
| `building_id` | — |
| `geom` | footprint polygon |
| `use` | residential / commercial / industrial / institutional / mixed |
| `storeys`, `floor_area` | the height term drives sky-view factor |
| `construction_type`, `year_built` | optional |

Or, if footprints are not releasable, an **impervious-surface fraction raster** at any resolution
≤ 30 m.

Explicitly **not** needed: owner names, tax declaration numbers, assessed values. Non-personal
attributes only — this keeps the request in a far easier legal category.

Holding office: **Office of the City Assessor** (RPT records), **Department of the Building
Official** (permits, occupancy), **City Architect Department**.

Serves: the dominant non-vegetation term in the heat residual; a building-density covariate for
the OLS fit; occupancy context for exposure.

If refused: derive NDBI from Sentinel-2 B11/B12 at 20 m — free, and a defensible substitute for
built-up fraction, but noisier, no storeys, and it cannot separate a warehouse from a school.

### A5. Parks, open space and trees

| Field | Note |
|---|---|
| `park_id`, `name`, `geom`, `area_ha` | — |
| `park_class` | playground / pocket park / botanical / memorial / institutional grounds |
| `tree_count`, `species` | where recorded |
| planting records | date, species, count, location |

Holding office: **Parks Development and Administration Department (PDAD)**,
**Climate Change and Environmental Sustainability Department (CCESD)**.

Serves: ground-truth validation of NDVI in the highest-vegetation cells — the one place where a
measured tree count can be compared against a satellite index. Also the actionable layer: a
planner cannot plant an NDVI value, but can plant a park.

If refused: NDVI stands alone and unvalidated against any measured canopy. The console can still
say high-vegetation cells run 2 °C cooler, but cannot say what a given park contributes.

### A6. Any heat, climate or green-city study the city already holds

Whatever exists: urban heat island maps, LST rasters, climate action plan data, GHG inventory,
green-city assessments, prior thermal comfort surveys.

Holding office: CCESD.

Serves: a local validation target and a prior-work comparison. The proposal review already noted
that UP Diliman has published QC LST work more than once; the city's own material is the closest
comparison available and the strongest defence against "this has been done".

If refused: validate against the published literature (Alcantara et al. 2019; Landicho & Blanco
2019) and PAGASA station air temperature. Survivable, but weaker.

### A7. Heat-sensitive facilities

| Field | Note |
|---|---|
| `facility_id`, `name`, `type` | school / day care / senior centre / health centre / hospital |
| `geom` | point or footprint |
| `capacity` or `enrolment` | — |

Holding office: **Quezon City Health Department**, DepEd QC, CPDD.

Serves: converting the LST layer into an exposure product — "these 40 facilities sit in the
top-decile heat cells" is a sentence an LGU can act on; "the 95th percentile is 54 °C" is not.

If refused: OSM POIs cover schools and hospitals reasonably, but day care and senior centres —
the two most heat-vulnerable facility types — are patchy.

### A8. Heat-related illness counts (conditional)

| Field | Note |
|---|---|
| `psgc_code`, `month` | — |
| `icd10_group` | heat exhaustion / heat stroke / dehydration |
| `count`, `age_band` | **counts only** |

Holding office: QC Health Department, Epidemiology and Surveillance Unit.

Serves: the only empirical link between the LST layer and an actual health outcome. Without it the
system demonstrates a physical relationship; with it, it demonstrates a consequence.

If refused: validate LST against PAGASA's Science Garden (Diliman) air-temperature record —
indicative only, since LST is a surface radiometric quantity at ~10:15 local, not screen-level air
temperature — and against the literature.

Legal note: this is sensitive personal data under RA 10173. Request aggregate counts only, and
apply small-cell suppression (suppress cells under 10 cases) so no individual is re-identifiable.

### A9. Orthophoto or LiDAR DSM (conditional)

DSM/DTM raster, orthophoto, acquisition date, resolution. PhilLiDAR coverage via DOST if the city
does not hold it.

Serves: building height and sky-view factor, downscaling the 100 m thermal support, 3D context.

If refused: Copernicus DEM GLO-30 gives terrain only, no buildings — so the residual keeps its
built-environment error.

---

## 3. Tier B — public data we already source (do not ask the LGU)

| Dataset | Source | Support / cadence |
|---|---|---|
| Sentinel-2 L2A — B04, B08, B11, B12, SCL | Element 84 Earth Search STAC | 10 m / 20 m, ~5 days |
| Landsat 8/9 C2 L2 — `ST_B10`, `QA_PIXEL` | Microsoft Planetary Computer STAC | 100 m native thermal |
| MODIS MOD11A2 / VIIRS VNP21A1D | NASA LP DAAC, Earth Engine | 1 km daily — the only daily thermal |
| ECOSTRESS `L2T_LSTE_V2` | Earth Engine | 70 m, irregular overpass |
| Copernicus DEM GLO-30 | Earth Search | 30 m |
| OSM roads, landuse, POIs, barangays | Overpass API, ODbL | continuous, fallback only |
| PSA 2024 census, PSGC codes | PSA | 2024 |
| Barangay boundaries (fallback) | PSA/PSGC shapefiles, OCHA COD-AB | 2023 |
| Air temperature, sanity check | PAGASA Science Garden, Diliman | daily |
| CLUP, Zoning Ordinance, CDP, DRRM Plan | quezoncity.gov.ph | published PDFs |

Asking for these wastes the LGU's time and weakens the request. Instead ask them to **validate**
our version: "we already hold these; please confirm or correct against your records."

---

## 4. Traceability — which layer needs which dataset

| Layer / view | Datasets |
|---|---|
| NDVI | imagery, A1, A5 |
| LST | imagery, A1 |
| Heat residual | imagery, A1, **A3, A4, A9**, DEM |
| Vegetation class | imagery, A1, **A3** |
| Exposure / vulnerability view | A1, **A2, A7, A8** |
| Validation | **A5, A6, A8**, PAGASA |

Note the shape: **A1 appears in all six rows.** A3 and A4 appear wherever the residual or the
classification does — which is the analytical core of the thesis. If the LGU releases only three
things, they are A1, A3 and A4.

---

## 5. Delivery standards to demand in writing

Most data requests fail on format, not permission.

- Machine-readable only: GeoJSON, Shapefile, GeoPackage, File Geodatabase, CSV or XLSX. A PDF, a
  scan or a screenshot is not a delivery. If only PDFs exist, ask for the underlying table export.
- One header row, one record per row, no merged cells, no subtotals inside the data.
- Rasters as GeoTIFF with stated CRS and nodata value, LZW or deflate compressed, not paletted-only
  exports.
- Every spatial file in **two** CRSs: PRS92 (EPSG:3123) and WGS84 (EPSG:4326). Do not reproject
  blind — QC material is commonly PRS92 and a silent 100 m shift is invisible until it matters.
- **PSGC 10-digit code as the join key on every barangay field.** Name spelling is the single most
  common join failure — "Sta. Lucia", "Santa Lucia" and "Sta Lucia" are three different strings.
- A data dictionary per layer: field name, type, allowed values, meaning of null.
- Enumerations for zone class, park class and facility type, with code-to-label mapping.
- A 100-row / 10-polygon sample before the full extract.
- Every file stamped with extraction date, "as of" period, and producing office.
- A named focal person per office and a receiving log both sides sign.

---

## 6. Conditions the LGU will impose — prepare before filing

Quezon City has already legislated its position. **Ordinance SP-3238, S-2023** operationalises
RA 10173 (Data Privacy Act) for the city. Their own 2026 procurement for the new **Unified
Geographic Information System (UGIS, ArcGIS Enterprise, ITDD)** contains the clause they will
reuse almost verbatim:

> City data geodatabases, portal content and project-generated documentation remain the property
> of the Quezon City Government. The provider shall not disclose, copy, retain, or use City data
> outside authorized project activities without written approval and shall comply with RA 10173.

Expect the same terms:

- A **Data Sharing Agreement** drafted per NPC Circular No. 2020-03, between the **university**
  (not the student personally) and the City Government, naming their Data Protection Officer and
  the purpose. Read NPC Advisory No. 2025-01 for the current interpretation.
- **Data minimisation** — request only fields used. No owner names, no tax identifiers, no patient
  records; health data as aggregate counts with small-cell suppression.
- **No raw records outside the study** — not in the thesis appendix, not in the public demo, not in
  the GitHub repository. Aggregates, rates and anonymised screenshots only.
- **Storage** — encrypted at rest, access limited to named researchers, no upload of LGU extracts
  to third-party cloud services.
- **Retention and destruction** — a stated destruction date at the end of the study, and a
  certificate of destruction.
- **Attribution** — "Data provided by the Quezon City Government under a Data Sharing Agreement
  dated ___" on every output, plus courtesy review of any publication.
- **Ethics clearance** from the university before the request is filed. The LGU will not process a
  student request without it.

Ask in tiers and let them choose — this is what determines whether a public body says yes:

1. **Aggregate only** — per-barangay area, population and counts. Non-personal, quick to approve,
   already enough to rebuild the console at city scale.
2. **Full vector layers** — boundaries, zoning, buildings, parks. The working target.
3. **Case-level health data** — do not ask for it, and say plainly in the document that you are not.

---

## 7. Request mechanics

- **One letter per office**, not one letter to "Quezon City". A letter addressed to the institution
  dies in routing.
- **Adviser-endorsed**, on university letterhead, cc the City Administrator's Office and ITDD.
- **Start with ITDD.** They are standing up the UGIS and will know which layers already exist as
  digital data and which are only paper. One conversation there can replace five letters.
- Suggested sequence:
  1. ITDD + City Administrator — scoping meeting; ask what already exists digitally.
  2. CPDD — boundaries, land area, zoning, land use, population, CLUP.
  3. CCESD + PDAD — heat and climate studies, parks, tree inventory.
  4. City Assessor + Department of the Building Official — footprints, occupancy.
  5. QC Health Department — facilities, and heat-illness counts if available.
  6. BCRD — barangay profiles and vulnerability counts.
- Ask for a 30-minute scoping meeting **before** filing. It converts a two-month paper trail into a
  one-week conversation.
- **Offer something back.** Commit to delivering a barangay-level heat dashboard for their planning
  office, a written findings report, and the source code, free, at the end of the study. That is
  the difference between a request that is ignored and one that is signed.

---

## 8. What breaks if each dataset is refused

| Refused | Consequence |
|---|---|
| A1 boundaries | Falls back to indicative polygons; reliability flag approximate; LGU deliverable weakened |
| A2 population | Console still works on PSA totals; loses age, PWD and informal-settler weighting |
| A3 zoning | NDVI–LST pooled city-wide; class cuts global and mislabel whole districts; residual unattributed |
| A4 buildings | NDBI substitute only; residual keeps its built-environment error |
| A5 parks/trees | NDVI unvalidated against measured canopy; no park-level claim |
| A6 heat study | Validation against literature and PAGASA only |
| A7 facilities | OSM POIs; day care and senior centres patchy |
| A8 health counts | LST linked to air temperature and literature, not to outcomes |
| A9 LiDAR | Copernicus DEM only; no building heights, no downscaling |

---

## 9. Minimum viable request

If they will only release five:

1. **Barangay boundaries with land area**
2. **Zoning and land use**
3. **Building footprints or impervious surface**
4. **Population and vulnerability per barangay**
5. **Parks and green space inventory**

That set rebuilds the console at city scale, stratifies the analysis, attributes the residual, and
gives the LGU something actionable. Items 6–9 are validation and polish.

If they release only one: **boundaries with land area.** Everything else has a weaker substitute.

---

## 10. What proceeds without the LGU, starting now

- Re-run the NDVI/LST pipeline at full QC extent for 142 units, and rebuild the 40 m grid and tiles.
  Fully unblocked.
- Derive NDBI and MNDWI from the same Sentinel-2 scenes as free covariates, so the residual has two
  terms instead of none.
- Measure how much of QC's road and landuse network OSM actually carries — that measurement is
  itself a finding and the strongest argument for A3.
- Compute the thermal-pixel count per barangay from any provisional boundary set, to quantify how
  many barangays will need the reliability flag. That number is the argument for A1.
- Draft the Data Sharing Agreement and the ethics clearance now; both take longer than the data
  extraction does.
