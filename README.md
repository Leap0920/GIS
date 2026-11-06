# GreenSpace–LST — urban vegetation and surface temperature, Quezon City 2026

An offline-capable analysis console over a measured Sentinel-2 / Landsat composite of
all 142 barangays of Quezon City (162.48 km²). It maps vegetation and surface temperature,
classifies vegetation into three levels, tests whether higher vegetation goes with a
cooler surface, compares barangays side by side, generates a report, and — when served
over HTTP — puts the whole thing behind a role-based login.

All numbers on screen are computed from the rasters in this folder. Nothing is typed in.

## Open it

**Offline (no login, no server):** double-click `index.html`. Everything works except the
server-side report, which falls back to a browser-generated copy of the same document.
The page runs from `file://` with no CDN — Leaflet and all assets are local.

**With accounts and role-based access:**

```bash
node server.js init          # creates rbac/users.json with three accounts, prints passwords once
node server.js               # http://127.0.0.1:8080
```

Other commands: `node server.js adduser <name> <role>`, `passwd <name>`, `role <name> <role>`,
`users`. Passwords are PBKDF2-SHA512, 210 000 iterations, per-user salt; only the hash is stored.

**Share it with someone who is not on this machine:**

```bash
SAFENET_PUBLIC=1 HOST=0.0.0.0 node server.js     # public demo mode
```

In public mode there is no login: `view`, `report` and `export` are open to anyone with the link,
`users` and `audit` stay closed, and every report generation is still written to the audit log.
The identity chip reads `public demo`. Combine it with a tunnel:

```bash
cloudflared tunnel --url http://127.0.0.1:8080    # prints an https://…trycloudflare.com URL
```

The quick-tunnel URL is unguessable but temporary — it dies when `cloudflared` stops. For a
permanent link, host the folder on any static host (the offline set is plain files, no build step)
and keep `server.js`/`rbac/` out of it.

## Roles

| Role | Can do |
|---|---|
| `viewer` | open the console, maps, Compare, Relationship, Barangays, Method |
| `analyst` | viewer + generate the report (`/api/report`), export CSV (`/api/export.csv`) |
| `admin` | analyst + manage accounts, read the audit trail (`/api/audit`) |

The browser disables what a role cannot do and says why in the tooltip; the server enforces
it independently and returns `401` / `403`. Every login, report, export and refusal is
appended to `rbac/audit.jsonl`.

```bash
node test_rbac.js            # 32 checks over HTTP: anonymous, wrong password, each role, promotion, demotion
```

## What the analysis says

On 27 418 valid 40 m cells:

- High-vegetation cells are **2.14 °C cooler** than low-vegetation cells (48.12 vs 50.27 °C).
- Pearson **r = −0.425** (p < 0.001), OLS slope **−0.92 °C per 0.1 NDVI** (95% CI −0.95 to −0.90).
- One-way ANOVA **F(2, 27415) = 2 123**, p < 0.001, **η² = 0.134** — the classes explain about
  13 % of the temperature variation; the rest is within classes.
- Kruskal–Wallis **H = 3 520**, p < 0.001 — same conclusion without assuming normality.
- All three pairwise differences survive Bonferroni correction.
- Equal-thirds cuts instead of fixed thresholds give the same ordering (50.27 / 49.72 / 48.19 °C),
  so the result does not depend on where the class lines were drawn.

This is one epoch: a cross-sectional association, not a demonstrated causal cooling effect.

## Views

- **Console** — the map, layer stack, selection, hover readout, ranking, histogram, table.
- **Compare** — two synced maps (vegetation beside temperature) and a barangay A/B panel
  with mean NDVI, mean LST, percentile spread and class composition.
- **Relationship** — the class summary, the statistical tests, four charts and the report buttons.
- **Barangays** — the sortable, searchable table with CSV export.
- **Method** — pipeline, provenance, scale honesty, access model and the freshness argument.

## Files

| File | What it is |
|---|---|
| `index.html` | markup for the five views |
| `styles.css` | themes, layout, Leaflet overrides, mobile rules |
| `data.js` | `window.SAFENET`: four quantised base64 grids, grid metadata, scales, class cuts, 142 names, 142 polygons, per-barangay stats, `asof` |
| `app.js` | the map, basemaps, layers, selection, readout, console charts, table, CSV export, deep links, self-test |
| `analysis.js` | vegetation classes, hypothesis tests, the Relationship view, the browser report |
| `compare.js` | two synced maps plus the barangay A/B panel |
| `auth.js` | session lookup, role gating, server-backed report download |
| `stats.js` | the same analysis in Node, for the server-side report |
| `rbac.js` | users, roles, sessions, audit trail (`node:crypto` only) |
| `server.js` | static server + `/api/*`, plus the account CLI |
| `test_rbac.js` | end-to-end role tests over HTTP |
| `tiles/*.png` | palette rasters: `{ndvi,lst,resid}-{dark,light}.png` and `class-{dark,light}.png` |
| `vendor/` | Leaflet 1.9.4 (js, css, marker images), vendored so nothing is fetched from a CDN |
| `build/build_qc.py` | rebuilds `data.js` + `tiles/*.png` for all of Quezon City from the cached scene windows in `C:\codes\SafeNet-data` (no network) |
| `build/bundle.json` | the superseded Novaliches bundle, kept for reference only |
| `index.mockup.html` | the original synthetic sample, kept for reference only |
| `build/` | verification screenshots (`r*`, `c*`, `a*`, `cdp-*`) |
| `preview.png` | screenshot of the console |
| `docs/proposal-review.md` | prior work in the study area, technical gaps, decisions to lock |

`build/build_qc.py` is the current builder. It warps the per-scene median windows onto the
40 m EPSG:32651 grid with an exact weighted average (no nodata sentinel, no GDAL `average`
resampling), writes the quantised base64 grids into `data.js`, and encodes the eight palette
overlays with a hand-rolled PNG writer because GDAL's PNG driver is read-only in this build.
The older `build_bundle.py` / `build_assets.py` lived in the Hermes scratch directory; their
Novaliches outputs are still committed so the page runs as-is.

## Data

Sentinel-2 L2A (tile T51PTS, 10 m, 16 usable scenes of 2026, SCL-masked) for NDVI; Landsat 8/9
Collection 2 Level 2 (path/row 116/050, `ST_B10`, 15 usable scenes of 2026, `QA_PIXEL`-masked)
for land surface temperature. Both are pixel-wise median composites, resampled to a 40 m grid.
Newest scene: Sentinel-2 **2026-10-15**, Landsat **2026-10-06**; the composite was built
**2026-10-31**. Source CSVs and the pipeline live in `../SafeNet-data`.

NDVI is computed per scene from `B08` and `B04`, then aggregated to the 40 m grid. LST is
`ST_B10` × 0.00341802 + 149 − 273.15, delivered resampled. The heat residual is LST minus the
value predicted by a least-squares fit of LST on NDVI across the study area — positive means
hotter than the vegetation cover predicts.

Boundaries: PSA `Adm4` (sub-municipality) shapefile, 2026 release — 142 QC polygons, each carrying its 10-digit `adm4_psgc` join key.

The analysis grid is the bounding box of those 142 polygons, and that box is 15.8 x 20.8 km around
a 162 km² city — 49.5 % of it lies outside Quezon City. The palette tiles are therefore masked to
the barangay union at build time, so the overlay on the map is the city's own footprint rather than
a rectangle that paints Caloocan, Valenzuela, Marikina and San Jose del Monte in QC colours. The
quantised grids in `data.js` are untouched; per-cell statistics were always restricted to cells
inside a barangay.

## Interface behaviour

- **Map**: real tiles underneath (Esri dark/light grey, OpenStreetMap streets, Esri satellite
  with place labels), drag to pan, wheel to zoom, click a barangay to isolate it, hover for the
  cell value at the cursor.
- **Layers**: NDVI, LST, heat residual and the categorical vegetation class, each with its own
  palette PNG and a legend that states its percentile stretch or its thresholds.
- **Selection**: click the map, a table row, a bar or an extremes row. The selected polygon is
  outlined and tinted, the chip appears at the top of the map, and the right rail opens with that
  barangay's cells, native thermal pixel count, means and anomaly against the study area.
- **Keyboard**: arrows pan, `+`/`-` zoom, `0` fits the study area, `Esc` clears the selection,
  `?` lists the bindings.
- **Deep links**: `?tab=`, `?layer=`, `?select=`, `?theme=`, `?basemap=`, and `?selftest=1` for a
  headless assertion block.

## Known limits

- **Not live.** The layer is a fixed 2026 composite and the UI says "as of 15 Oct 2026".
  Sentinel-2 revisits every ~3.9 days but only ~9 % of scenes are under 20 % cloud; Landsat
  thermal arrives every ~10 days. A true daily thermal layer only exists at 1 km (MODIS).
- **LST is a surface radiometric quantity** at about 10:15 local, not air temperature; 12 of
  15 Landsat dates fall in the dry season.
- **Landsat thermal is natively 100 m**, so per-barangay thermal statistics inherit that support.
  Barangays under 60 native thermal pixels are flagged rather than reported as reliable.
- **One epoch.** There is no trend and no change layer, and none is drawn.
- **Colour ramps** are stretched to the 5th–95th percentile and say so; the tails saturate.
- **Offline mode has no security boundary** — opened from `file://` there is no server, so the
  role gating is inactive and the console says "offline" in the top bar.

## Design language

Reading this as: a GIS environmental analytics console for researchers and LGU planners, with a
tactical-technical cartographic language, leaning toward Geist + Geist Mono on a deep charcoal
substrate with a single amber accent and data-semantic colormaps.

Dials: `VARIANCE 4 / MOTION 3 / DENSITY 8`. Density above 7 means every numeral is monospace.
Banned and avoided: Inter and other default UI fonts, AI-purple and neon gradients, pure black,
thick-stroked icon libraries, decorative gradients, emoji. The only gradients in the file are
data colormaps.
