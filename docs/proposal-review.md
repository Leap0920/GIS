# Proposal Review — GIS-Based NDVI/LST Web System (Quezon City)

Status: proposal ACCEPTED. Review written 2026-10-13.
Purpose: this is not a rewrite. It is the list of things a panel, an adviser,
or a future examiner will attack, ordered by how much damage they do.

---

## VERDICT

The proposal is coherent, achievable, and appropriately scoped for a
CS/IT capstone or thesis. The domain is real, the data is free and open,
and the deliverable (an interactive web GIS) is buildable in 10 months.

Two things will get you grilled:

1. Your "Similarity of Previous Studies" section cites ZERO studies.
2. The exact study area (Quezon City), the exact variables (NDVI + LST),
   and the exact platform (Google Earth Engine + Landsat) have ALREADY
   been published, by UP Diliman, more than once. You must state what
   your contribution is relative to those, explicitly.

Neither is fatal. Both are fixable before Chapter 2 is written.

---

## 1. THE BIGGEST PROBLEM: PRIOR WORK IN YOUR OWN STUDY AREA

You claim similarity to prior studies but name none. Meanwhile these exist:

- Alcantara, Escoto, Blanco, Baloloy, Santos, Sta. Ana (2019).
  "Geospatial Assessment and Modeling of Urban Heat Islands in Quezon City,
  Philippines using OLS and Geographically Weighted Regression."
  ISPRS Archives XLII-4/W16, 85-98.
  -> Quezon City. Landsat 8 LST. NDVI AND NDBI. Google Earth Engine.
     Land use stratified LST (commercial/industrial/residential ~33.5 C,
     parks ~30.5 C, agriculture and water ~26 C). UTFVI. OLS + GWR.

- Landicho & Blanco (2019). "Intra-Urban Heat Island Detection and Trend
  Characterization in Metro Manila using Surface Temperatures Derived from
  Multi-Temporal Landsat Data." ISPRS Archives XLII-4/W19, 275-282.
  -> Barangay-level analysis. LST 1997-2019. Emissivity estimation.
     Local Moran's I for hotspot/coldspot clusters. Trend: ~+0.18 C/year.

- Almadrones-Reyes & Dagamac (2023). "Land-use/land cover change and land
  surface temperature in Metropolitan Manila, Philippines using Landsat
  imagery." GeoJournal 88, 1415-1431.
  -> Landsat 7 ETM+, NDVI + NDBI + LULC, 2001 vs 2019. Mean LST +4.02 C.

Consequence: "we will correlate NDVI with LST in Quezon City using Landsat
and GEE" is NOT a novel environmental-science claim. It is a replication.
A panel that knows the local literature will say so in the first five minutes.

What actually saves you — and you should write this into the proposal:

  Your novelty is the SYSTEM, not the correlation. Prior work produced
  papers, static maps, and ArcGIS/GeoDa/SAGA workflows that require
  desktop GIS expertise and licensed software. Nobody shipped an open,
  browser-based, zero-install platform where a barangay planner or a
  student can query the same relationship themselves. That is a genuine
  and defensible CS/IT contribution — but only if you say it in those
  words and position it against those papers by name.

Also: because those studies exist, you have a free validation target.
If your pipeline reproduces a comparable NDVI-LST direction and rough
magnitude in QC, your system is demonstrably credible. Use them as
ground truth, not just as related work. That converts your biggest
weakness into a strength.

ACTION: Chapter 2 needs 15-25 real citations. Start with the three above.
ACTION: Add a "Contribution" paragraph to 1.5 that names the desktop-GIS
        gap explicitly.

---

## 2. TECHNICAL GAPS THAT WILL BITE DURING IMPLEMENTATION

### 2.1 Cloud cover is your real project risk, not coding

The Philippines is persistently cloudy, and Landsat revisits every 16 days.
You will NOT get clean scenes on demand. This must be a stated methodology
decision, not an afterthought:

- Restrict acquisition to the dry season (roughly January-April) and use
  multi-scene median composites rather than single dates.
- Mask with QA_PIXEL (cloud, cloud shadow, cirrus, dilated cloud) before
  compositing, never after.
- State a minimum clear-pixel coverage threshold per study period.
- Plan for the possibility that a chosen year has too few usable scenes
  and that you must shift the year window.

A 10-month plan that assumes "download Landsat, get data" will slip.

### 2.2 Do not hand-roll LST. Use the Collection 2 Level 2 product.

Landsat Collection 2 Level 2 ships ST_B10 (surface temperature, Kelvin,
scale 0.00341802, offset 149). In GEE that is LANDSAT/LC08/C02/T1_L2,
LC09/C02/T1_L2, LC05/C02/T1_L2, LE07/C02/T1_L2.

Important caveat you should cite and address: the USGS ST product derives
emissivity from the ASTER Global Emissivity Dataset, which has MISSING
values over regions of persistent cloud cover. Over the Philippines that
produces permanent data gaps that are consistent through time. The fix in
the literature is NDVI-threshold-based emissivity with a statistical
mono-window (SMW, Ermida et al. 2020) or radiative transfer equation
approach, which outperforms the stock ST product on mixed and vegetated
surfaces.

Decision to make and write down: stock ST_B10 (simple, citable, has gaps)
vs NDVI-based emissivity + SMW (more work, fewer gaps, better accuracy in
tropical mixed surfaces). Either is defensible. Drifting between them
mid-project is not.

### 2.3 Your effective thermal resolution is 100 m, not 30 m

Landsat 8/9 TIRS band 10 is natively 100 m and is DELIVERED resampled to
30 m. You are not getting 30 m thermal information; you are getting 100 m
information on a 30 m grid. One 100 m pixel is one hectare.

Quezon City has small barangays. Some will contain only a few dozen
independent thermal pixels. Any per-barangay statistic from those is
statistically thin. Address this head-on:

- Report pixel counts per barangay and exclude or flag barangays below a
  minimum threshold.
- Do NOT claim barangay-level thermal precision you do not have.
- If you need finer thermal detail, say so as a limitation and point to
  disaggregation methods (Cruz et al. 2020, ISPRS XLIII-B5, downscaled
  Landsat LST using PlanetScope derivatives) as future work.

If you also pull Sentinel-2 NDVI at 10 m for a sharper vegetation layer,
you create a 10 m vs 100 m scale mismatch. That is fine, but it must be an
explicit, justified decision (aggregate NDVI to the thermal support, do
not upsample LST and pretend it is 10 m).

### 2.4 "Appropriate statistical methods" is not a method

Name them now:

- Pearson r and Spearman rho for the NDVI-LST association (Spearman as a
  robustness check, since the relationship is nonlinear and often concave).
- OLS linear regression, reported with R-squared and p-value.
- STRATIFY by land cover. NDVI alone typically explains only a moderate
  share of LST variance (r roughly -0.4 to -0.7 in the literature). The
  residual is albedo, imperviousness, building density, water, elevation.
  Add NDBI (built-up) and MNDWI (water) as covariates — this is exactly
  what Alcantara et al. did, and it materially strengthens your result.
- SPATIAL AUTOCORRELATION. Adjacent pixels are not independent. Plain OLS
  on raster data violates the independence assumption and inflates
  significance. Use Local Moran's I to show clustering (Landicho & Blanco
  did exactly this) and consider GWR for spatially varying coefficients.
  A panel member who knows spatial statistics will ask about this.

Also decide the analysis unit up front: per-pixel, per-barangay, or both.
Both is best — per-pixel for the regression, per-barangay for the dashboard.

### 2.5 Leaflet cannot serve a GeoTIFF. Plan the raster pipeline now.

This is the most common place this class of project dies late. Leaflet +
OpenStreetMap gives you a basemap, not your data layer. You need one of:

- GEE tile URLs (getMapId / MapID -> XYZ template). Fastest to prototype,
  no server, but every map load depends on a live GEE session and an
  authenticated project. Fragile in a defense room with bad wifi.
- Pre-rendered XYZ tiles from your exported rasters, generated with
  gdal2tiles or served as Cloud-Optimized GeoTIFFs through titiler.
  More work up front, works offline, reproducible, archivable.

Recommendation: prototype with GEE tiles, but ship pre-rendered static
tiles. You will be defending this in a room; do not let a Google session
expire mid-presentation. It also makes the software deliverable (a
required submission item) self-contained.

Supporting decisions to lock down:
- Statistics precomputed offline and served as static JSON. Do not compute
  correlations in the browser.
- Charts: Chart.js or Plotly.
- Backend: only if you need spatial queries. PostGIS if you do. If the
  dashboard is read-only over precomputed tiles + JSON, you may not need
  a database at all — say so deliberately.
- OSM tile usage policy and attribution. OpenStreetMap data is ODbL and
  REQUIRES visible attribution in the UI. Geoportal Philippines data has
  its own terms — check and cite them.

---

## 3. OBJECTIVES: TOO MANY, AND TWO ARE DUPLICATES

You list nine specific objectives. Objectives 1 and 7 both describe the
interactive map / Leaflet layer. Objective 5 ("data-processing module
that can organize, process, and visualize") overlaps 6 and 7 and is the
vaguest of the set.

Consolidate to 5-6 measurable objectives, each with an implied acceptance
test. Example shape:

1. Build and document a reproducible pipeline that produces cloud-masked
   NDVI and LST layers for the study area for at least two time periods.
2. Deliver an interactive web map presenting NDVI and LST as switchable
   geographic layers over an OSM basemap.
3. Quantify the NDVI-LST relationship statistically, including
   stratification by land cover and a spatial clustering analysis.
4. Present results through a dashboard of maps, charts, and summary
   indicators at both pixel and barangay level.
5. Validate the pipeline output against published Quezon City /
   Metro Manila findings.

Note how each is testable. "Develop a data-processing module" is not.

Also: objective 9 ("historical or time-based comparisons ... when suitable
satellite datasets are available") is hedged into meaninglessness. Pin the
years. Suggested: a dry-season composite for three epochs spanning the
Landsat 8/9 era (e.g. 2015, 2020, 2024), plus optionally one Landsat 5/7
epoch for a longer baseline if the composite quality permits. Vague
hedging invites the question "so, will you or won't you?"

---

## 4. STUDY AREA NEEDS JUSTIFICATION, NOT JUST NAMING

"Selected barangays in Quezon City" raises an immediate question: which
ones, and by what criterion? State a deliberate selection logic, e.g. a
vegetation-to-built gradient:

- a vegetation-rich / low-density barangay,
- a mixed transitional barangay,
- a fully built-up high-density barangay.

That gives you contrast by design instead of by convenience, makes the
NDVI-LST relationship testable across a range, and pre-empts the
"why these barangays" question. Publish the list and the criteria.

---

## 5. VALIDATION AND LIMITATIONS — SAY IT BEFORE THEY ASK

- LST is not air temperature. Comparing LST against PAGASA station air
  temperature is indicative only. If you do it, frame it as a sanity
  check, not a validation, and cite why the two differ (surface vs
  screen-level, radiative vs conductive/convective coupling).
- Your strongest validation is agreement in direction and rough magnitude
  with the published QC and Metro Manila studies listed in section 1.
- Declare the single-scene vs composite tradeoff, the 100 m thermal
  support, the cloud-masking threshold, and the LST retrieval choice as
  explicit limitations.

---

## 6. GANTT CHART

The pasted chart lost its bars, so I can only judge the activity list and
the span: August 2026 to May 2027, ten months.

Problems:

- No slack anywhere. Ten months with "Submission of Hardbound and Software"
  as the final bar leaves zero buffer. Cloud-cover hunting, GEE export
  quotas, and tile generation will each eat time you have not allocated.
- Data gathering and processing are under-represented. There is a line for
  "Data Gathering Techniques and Instrument" but that is a Chapter 3
  writing task, not the actual acquisition and processing effort. Add
  explicit bars for imagery acquisition, cloud masking and compositing,
  LST/NDVI generation, statistical analysis, and tile/export generation.
- Front-load the risky part. Get one clean NDVI + LST pair over QC in the
  first month or two, even roughly. If the data does not cooperate, you
  want to know in September, not in February.
- Re-check the defense placement. If the topic proposal is already
  approved, confirm whether there is a separate proposal defense or only
  the final oral defense, and make sure the chart reflects the program's
  actual milestone sequence.
- Add a contingency bar. Panels notice when there is none.

---

## 7. SMALLER ITEMS

- Objectives say "Landsat data from USGS EarthExplorer AND Landsat
  Collection 2 ... with Google Earth Engine supporting data processing."
  Pick the operational path: acquire and process in GEE, export GeoTIFFs,
  do local statistics in Python (rasterio/GDAL), serve tiles to the web
  app. EarthExplorer is a catalog/browse tool here, not a pipeline step.
  Write the pipeline as a numbered flow so nobody has to guess.
- Significance section is fine but generic. Add the LGU as a beneficiary
  (Quezon City LGU and barangay councils as actual decision-makers) and
  connect to existing local greening and climate programs if applicable.
- Pin the exact Landsat WRS-2 path/row and the GEE collection IDs you
  will use. Concrete identifiers make the methodology reproducible.
- Add a data licensing / attribution subsection (USGS public domain, OSM
  ODbL, Geoportal Philippines terms). It is a small section that makes
  the whole proposal look more professional.
- The rationale says the datasets "can be difficult to view and analyze
  together." That is a good hook — quantify it or give one concrete
  example of the friction (raw HDF/GeoTIFF, projection handling, emissivity
  correction, desktop GIS licensing) so the problem statement lands harder.

---

## WHAT I WOULD DO FIRST

1. Rewrite 1.5 with the three citations above and an explicit contribution
   paragraph. This is the highest-value hour of work available to you.
2. Lock the LST retrieval decision (stock ST_B10 vs NDVI-emissivity + SMW).
3. Lock the compositing strategy and the three epochs.
4. Prove the pipeline on ONE scene over QC before writing more prose.
   A single working NDVI + LST map de-risks the entire project.
