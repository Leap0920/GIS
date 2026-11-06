# SafeNet GIS — Data We Need From Quezon City LGU (one page)

Scope: whole Quezon City — 142 barangays, 6 districts, 161.11 km², 3.08M people (2024 census).
Full version with field-level detail: `qc-lgu-data-request.md`.

---

## What the system is

Four layers, every one computed from satellite rasters:

| Layer | What it is | Source |
|---|---|---|
| NDVI | vegetation index | Sentinel-2 B04 / B08, 10 m |
| LST | land surface temperature | Landsat 8/9 C2 L2 `ST_B10`, 100 m native |
| Heat residual | LST − f(NDVI) — what is hotter than its vegetation predicts | derived |
| Vegetation class | Low / Moderate / High | derived from NDVI |

The LGU is not the source of any of the four. The LGU supplies the **geography** and the
**ground truth** that make them city-wide and defensible.

---

## The one load-bearing ask

**Barangay boundaries, PSGC-coded, with land area in hectares.**

Whole QC is 16,111 Landsat thermal pixels at 100 m native. Average barangay is 1.135 km², about
113 thermal pixels. Any barangay under 0.6 km² falls below the 60-pixel reliability threshold the
Novaliches build already used to flag Capri. That flag — and the zonal statistics for 142 units —
cannot be computed on OSM's community-mapped polygons.

---

## Ask for these 7

1. **Barangay and district boundaries** — PSGC-coded polygons, land area in hectares, and the
   official city boundary.
2. **Population and heat vulnerability** — per barangay: total, households, density, under-5, 60+,
   PWD, informal settler families.
3. **Zoning and land use** — polygons with zone codes, the land use map, and the CLUP.
4. **Buildings or impervious surface** — building footprints with use and number of storeys, or any
   existing impervious-surface layer.
5. **Parks, open space and trees** — green-space polygons with area, tree counts, tree-planting
   records.
6. **Any heat study the city already has** — urban heat island maps, climate action plan data,
   green-city assessments, prior LST work.
7. **Heat-sensitive facilities** — schools, day care centres, senior centres, health centres and
   hospitals with coordinates.

## And these 2, if they exist

8. **Heat-related illness counts** — cases per barangay per month, anonymised. The only way to tie
   LST to actual health outcomes rather than to air temperature.
9. **City orthophoto or LiDAR DSM** — building heights and sky-view factor. Improves the residual
   and allows downscaling the 100 m thermal support.

---

## If they can only release five

1. Barangay boundaries with land area
2. Population and vulnerability per barangay
3. Zoning and land use
4. Building footprints or impervious surface
5. Parks and green space inventory

Enough to rebuild the console city-wide and defend it. Items 6–9 are validation and polish.

---

## We already have — free, no ask

Sentinel-2 L2A and Landsat 8/9 C2 L2 imagery, Copernicus DEM GLO-30, PSA census and PSGC codes,
OpenStreetMap as a fallback, and the city's own published CLUP and Zoning Ordinance. We only need
them to confirm our versions are right.

---

## Conditions to expect

- A **Data Sharing Agreement** with the university, under RA 10173 and QC Ordinance SP-3238 s.2023.
- **No raw records** in the thesis appendix, public demo or repository — aggregates and anonymised
  screenshots only.
- **University ethics clearance** filed before the request. Item 8 needs it regardless.

---

## How to ask

One letter per office, adviser-endorsed, on university letterhead. Start with **ITDD** — they run
the new Unified GIS and know which layers already exist digitally. Then CPDD (boundaries, zoning,
population), CCESD and PDAD (green space, heat studies), City Assessor and the Department of the
Building Official (buildings).

Ask for a 30-minute scoping meeting before filing. Offer their planning office a barangay-level
heat dashboard and a written findings report at the end, free.

**Format:** machine-readable only — GeoJSON, Shapefile, GeoPackage or CSV. A PDF or a scan is not a
delivery. Send 100 sample rows first. Every spatial file must state its CRS (WGS84 and PRS92), and
every barangay field must carry the PSGC code — name spelling alone will not join.
