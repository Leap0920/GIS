#!/usr/bin/env python3
"""Rebuild the GreenSpace-LST console data at whole-Quezon-City extent.

Reads the per-scene windows cached by SafeNet-data/scripts/run_qc_layers.py
(no network), composites them onto the console's 40 m grid, and writes:

    data.js              window.SAFENET  (grid, geo, stats, quantised arrays)
    tiles/*.png          8 raster overlays, 1 px per grid cell

The bundle contract is the one app.js already reads; nothing in the front end
needs to change except copy.

    grid   {nx, ny, cell_m, lw, lh, ext{w,e,n,s}}       ext in WGS84
    ndvi/lst/resid/bgy  base64 of nx*ny bytes, 0 = nodata,
                        value = min + (q-1)/254*(max-min)
    bgy    0-based index into names, 255 = outside every barangay
"""
import base64, fcntl, glob, json, math, os, sys

import numpy as np
from osgeo import gdal, ogr, osr

gdal.UseExceptions()

# One build at a time. Two concurrent runs interleave writes into data.js and
# tiles/ and the loser's numbers silently win, so a second run exits instead.
LOCK = "/mnt/c/codes/GIS/build/.build_qc.lock"
_lock = open(LOCK, "a")          # "a" so a losing process cannot truncate the holder's pid
try:
    fcntl.flock(_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    sys.exit("another build_qc.py holds %s — refusing to start" % LOCK)
_lock.seek(0)
_lock.truncate()
_lock.write(str(os.getpid()))
_lock.flush()

GIS = "/mnt/c/codes/GIS"
SAFE = "/mnt/c/codes/SafeNet-data"
CACHE = "/home/carlo/.hermes/cache/scratch/qc_cache"
CELL = 40.0
GOOD_SCL = {4, 5, 6, 7, 11}
NODATA = -9999.0

# ---------------------------------------------------------------- grid
ds_id = ogr.Open(f"{SAFE}/qc_bgy_id.geojson")
lyr = ds_id.GetLayer()
xmin = ymin = 1e18
xmax = ymax = -1e18
psgc_of = {}
for f in lyr:
    a, b, c, d = f.GetGeometryRef().GetEnvelope()
    xmin, xmax = min(xmin, a), max(xmax, b)
    ymin, ymax = min(ymin, c), max(ymax, d)
    psgc_of[int(f.GetField("bgy_id"))] = str(f.GetField("psgc_code"))

NX = int(math.ceil((xmax - xmin) / CELL))
NY = int(math.ceil((ymax - ymin) / CELL))
X0, Y0 = xmin, ymax
GT = (X0, CELL, 0.0, Y0, 0.0, -CELL)
PROJ = lyr.GetSpatialRef().ExportToWkt()
print(f"grid {NX} x {NY} = {NX*NY:,} cells at {CELL} m", flush=True)

# WGS84 extent for Leaflet
utm = osr.SpatialReference(); utm.ImportFromEPSG(32651)
utm.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326)
wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
t = osr.CoordinateTransformation(utm, wgs)
lon_w, lat_s, _ = t.TransformPoint(X0, Y0 - NY * CELL)
lon_e, lat_n, _ = t.TransformPoint(X0 + NX * CELL, Y0)
EXT = {"w": round(lon_w, 6), "e": round(lon_e, 6), "n": round(lat_n, 6), "s": round(lat_s, 6)}
print("ext WGS84:", EXT, flush=True)

# ---------------------------------------------------------------- helpers
def native(path):
    d = gdal.Open(path)
    return d.ReadAsArray().astype("float32"), d


def to_grid(arr, valid, ref):
    """Average-resample onto the console grid, exactly.

    GDAL Warp's nodata handling under `average` does not exclude the sentinel
    reliably (it leaks ~40% of -9999 into the mean), so nothing here is marked
    nodata: band 1 carries value*valid, band 2 carries valid, and the ratio of
    the two means is the mean over valid pixels only.
    """
    mem = gdal.GetDriverByName("MEM").Create("", ref.RasterXSize, ref.RasterYSize, 2, gdal.GDT_Float32)
    mem.SetGeoTransform(ref.GetGeoTransform())
    mem.SetProjection(ref.GetProjection())
    v = valid.astype("float32")
    mem.GetRasterBand(1).WriteArray(np.where(valid, arr, 0.0).astype("float32"))
    mem.GetRasterBand(2).WriteArray(v)
    dst = gdal.GetDriverByName("MEM").Create("", NX, NY, 2, gdal.GDT_Float32)
    dst.SetGeoTransform(GT)
    dst.SetProjection(PROJ)
    gdal.Warp(dst, mem, resampleAlg="average")
    num = dst.GetRasterBand(1).ReadAsArray()
    den = dst.GetRasterBand(2).ReadAsArray()
    with np.errstate(invalid="ignore", divide="ignore"):
        out = num / den
    return np.where(den > 0.2, out, np.nan)


def usable(csv_path):
    import csv as _csv
    return {r["scene_id"] for r in _csv.DictReader(open(csv_path, encoding="utf-8"))}


# ---------------------------------------------------------------- NDVI
sids = sorted(usable(f"{SAFE}/qc_ndvi_by_scene.csv"))
print(f"\nNDVI: {len(sids)} scenes", flush=True)
stack = []
for i, sid in enumerate(sids, 1):
    try:
        R, dr = native(f"{CACHE}/{sid}_red.tif")
        N, _ = native(f"{CACHE}/{sid}_nir.tif")
        S, _ = native(f"{CACHE}/{sid}_scl10.tif")
        good = np.isin(S.astype("int16"), list(GOOD_SCL))
        with np.errstate(invalid="ignore", divide="ignore"):
            nd = (N - R) / (N + R)
        ok = good & (R > 0) & (N > 0) & np.isfinite(nd) & (np.abs(nd) < 1)
        stack.append(to_grid(np.where(ok, nd, NODATA).astype("float32"), ok, dr))
        print(f"  [{i}/{len(sids)}] {sid}", flush=True)
    except Exception as e:
        print("  FAIL", sid, repr(e)[:160], flush=True)
with np.errstate(invalid="ignore"):
    NDVI = np.nanmedian(np.dstack(stack), axis=2)
print(f"NDVI cells valid: {np.isfinite(NDVI).sum():,}", flush=True)

# ---------------------------------------------------------------- LST
sids = sorted(usable(f"{SAFE}/qc_lst_by_scene.csv"))
print(f"\nLST: {len(sids)} scenes", flush=True)
stack = []
for i, sid in enumerate(sids, 1):
    try:
        L, dr = native(f"{CACHE}/{sid}_lwir.tif")
        Q, _ = native(f"{CACHE}/{sid}_qa.tif")
        lst = L * 0.00341802 + 149.0 - 273.15
        q = Q.astype("int32")
        bad = ((q & 1) != 0) | ((q >> 3 & 1) != 0) | ((q >> 4 & 1) != 0)
        ok = (~bad) & (L > 0) & np.isfinite(lst) & (lst > -20) & (lst < 70)
        stack.append(to_grid(np.where(ok, lst, NODATA).astype("float32"), ok, dr))
        print(f"  [{i}/{len(sids)}] {sid}", flush=True)
    except Exception as e:
        print("  FAIL", sid, repr(e)[:160], flush=True)
with np.errstate(invalid="ignore"):
    LST = np.nanmedian(np.dstack(stack), axis=2)
print(f"LST cells valid: {np.isfinite(LST).sum():,}", flush=True)

# ---------------------------------------------------------------- bgy
mask_tif = f"{CACHE}/qc_bgy_40m.tif"
drv = gdal.GetDriverByName("GTiff")
m = drv.Create(mask_tif, NX, NY, 1, gdal.GDT_Int16, options=["COMPRESS=LZW"])
m.SetGeoTransform(GT)
m.SetProjection(PROJ)
gdal.Rasterize(m, f"{SAFE}/qc_bgy_id.geojson",
               options=gdal.RasterizeOptions(attribute="bgy_id", allTouched=False))
m = None
BGY_ID = gdal.Open(mask_tif).ReadAsArray()
print(f"rasterised {len(np.unique(BGY_ID))-1} barangay ids", flush=True)

# ---------------------------------------------------------------- city footprint
# The grid is the bounding box of the 142 barangays, and that box is twice the
# city's area (15.8 x 20.8 km around a 162 km2 city), so an unmasked overlay
# paints Caloocan, Valenzuela, Marikina and San Jose del Monte in Quezon City
# colours. Burn the union of the same polygons to 1 and let the tiles go
# transparent outside it, so the map shows Quezon City, not its envelope.
city_tif = f"{CACHE}/qc_city_40m.tif"
cm = drv.Create(city_tif, NX, NY, 1, gdal.GDT_Byte, options=["COMPRESS=LZW"])
cm.SetGeoTransform(GT)
cm.SetProjection(PROJ)
gdal.Rasterize(cm, f"{SAFE}/qc_bgy_id.geojson",
               options=gdal.RasterizeOptions(burnValues=[1], allTouched=False))
cm = None
CITY = gdal.Open(city_tif).ReadAsArray().astype(bool)
print(f"city footprint: {int(CITY.sum()):,} of {NX*NY:,} cells "
      f"({100*CITY.sum()/(NX*NY):.1f}%)", flush=True)

# ---------------------------------------------------------------- fit
ok = np.isfinite(NDVI) & np.isfinite(LST)
n = int(ok.sum())
mx = float(NDVI[ok].mean()); my = float(LST[ok].mean())
sxx = float(((NDVI[ok] - mx) ** 2).sum())
sxy = float(((NDVI[ok] - mx) * (LST[ok] - my)).sum())
syy = float(((LST[ok] - my) ** 2).sum())
slope = sxy / sxx
intercept = my - slope * mx
r = sxy / math.sqrt(sxx * syy)
print(f"\nfit on {n:,} cells: lst = {intercept:.3f} + {slope:.3f}*ndvi  r={r:.4f} r2={r*r:.4f}", flush=True)

RESID = np.where(ok, LST - (intercept + slope * NDVI), np.nan)

# ---------------------------------------------------------------- scales
def pct(a, q):
    return float(np.nanpercentile(a, q))


SC = {
    "ndvi": {"min": round(math.floor(pct(NDVI[ok], 5) * 100) / 100, 2),
             "max": round(math.ceil(pct(NDVI[ok], 95) * 100) / 100, 2),
             "title": "NDVI", "unit": "index", "pct": "5\u201395th pct"},
    "lst": {"min": round(math.floor(pct(LST[ok], 5) * 10) / 10, 1),
            "max": round(math.ceil(pct(LST[ok], 95) * 10) / 10, 1),
            "title": "LST", "unit": "degrees Celsius", "pct": "5\u201395th pct"},
    "resid": {"min": -6.0, "max": 6.0, "title": "LST \u2212 f(NDVI)",
              "unit": "degrees Celsius", "pct": "5\u201395th pct",
              "ticks": ["-6.0", "-2.0", "2.0", "6.0"], "zeroAt": 0.5},
}
SC["ndvi"]["ticks"] = [f"{SC['ndvi']['min']:.2f}", f"{(SC['ndvi']['min']+SC['ndvi']['max'])/3:.2f}",
                       f"{2*(SC['ndvi']['min']+SC['ndvi']['max'])/3 - SC['ndvi']['min']:.2f}",
                       f"{SC['ndvi']['max']:.2f}"]
SC["lst"]["ticks"] = [f"{SC['lst']['min']:.1f}",
                      f"{SC['lst']['min']+(SC['lst']['max']-SC['lst']['min'])/3:.1f}",
                      f"{SC['lst']['min']+2*(SC['lst']['max']-SC['lst']['min'])/3:.1f}",
                      f"{SC['lst']['max']:.1f}"]
print("scales:", json.dumps(SC), flush=True)


# ---------------------------------------------------------------- quantise
def quant(a, lo, hi):
    q = np.zeros(a.shape, dtype=np.uint8)
    v = np.isfinite(a)
    t = (a[v] - lo) / (hi - lo) if hi > lo else np.zeros(v.sum())
    q[v] = np.clip(np.round(1 + np.clip(t, 0, 1) * 254), 1, 255).astype(np.uint8)
    return q


QN = quant(NDVI, SC["ndvi"]["min"], SC["ndvi"]["max"])
QL = quant(LST, SC["lst"]["min"], SC["lst"]["max"])
QR = quant(RESID, SC["resid"]["min"], SC["resid"]["max"])
QB = np.full(NX * NY, 255, dtype=np.uint8)
flat = BGY_ID.ravel()
has = flat > 0
QB[has] = (flat[has] - 1).astype(np.uint8)


def b64(a):
    return base64.b64encode(a.tobytes()).decode("ascii")


# ---------------------------------------------------------------- names/geo
geo_src = json.load(open(f"{SAFE}/qc_bgy.geojson", encoding="utf-8"))
names, stats, feats = [], [], []
for i, f in enumerate(geo_src["features"], 1):
    p = f["properties"]
    assert psgc_of[i] == p["psgc_code"], f"order mismatch at {i}: {p['name']}"
    names.append(p["name"])
    sel = (BGY_ID == i) & ok
    v_n, v_l = NDVI[sel], LST[sel]
    if v_n.size:
        stats.append({"n": p["name"], "cells": int(v_n.size),
                      "ndvi": round(float(np.median(v_n)), 4),
                      "lst": round(float(np.median(v_l)), 2),
                      "ndvi_p10": round(float(np.percentile(v_n, 10)), 4),
                      "ndvi_p90": round(float(np.percentile(v_n, 90)), 4),
                      "lst_p10": round(float(np.percentile(v_l, 10)), 2),
                      "lst_p90": round(float(np.percentile(v_l, 90)), 2)})
    else:
        stats.append({"n": p["name"], "cells": 0, "ndvi": None, "lst": None,
                      "ndvi_p10": None, "ndvi_p90": None, "lst_p10": None, "lst_p90": None})
    feats.append({"type": "Feature", "properties": {"name": p["name"], "psgc": p["psgc_code"],
                                                    "area_ha": p["area_ha"]},
                  "geometry": f["geometry"]})

# simplify + trim coordinate precision so data.js stays loadable
geo = {"type": "FeatureCollection", "features": []}
for f in feats:
    g = ogr.CreateGeometryFromJson(json.dumps(f["geometry"]))
    g = g.SimplifyPreserveTopology(0.00004)
    gj = json.loads(g.ExportToJson())

    def trim(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], 5), round(c[1], 5)]
        return [trim(x) for x in c]
    gj["coordinates"] = trim(gj["coordinates"])
    geo["features"].append({"type": "Feature", "properties": f["properties"], "geometry": gj})

# ---------------------------------------------------------------- asof
import csv as _csv
nd_rows = list(_csv.DictReader(open(f"{SAFE}/qc_ndvi_by_scene.csv", encoding="utf-8")))
ls_rows = list(_csv.DictReader(open(f"{SAFE}/qc_lst_by_scene.csv", encoding="utf-8")))
ASOF = {"s2_first": min(r["date"] for r in nd_rows), "s2_last": max(r["date"] for r in nd_rows),
        "s2_scenes": len({r["scene_id"] for r in nd_rows}),
        "ls_first": min(r["date"] for r in ls_rows), "ls_last": max(r["date"] for r in ls_rows),
        "ls_scenes": len({r["scene_id"] for r in ls_rows}),
        "built": "2026-10-31"}

BUNDLE = {
    "grid": {"nx": NX, "ny": NY, "cell_m": CELL,
             "lw": round(NX * CELL, 1), "lh": round(NY * CELL, 1), "ext": EXT},
    "geo": geo,
    "asof": ASOF,
    "counts": {"s2": ASOF["s2_scenes"], "landsat": ASOF["ls_scenes"]},
    "names": names,
    "stats": stats,
    "scales": SC,
    "classes": {"cuts": [0.1, 0.2], "labels": ["Low", "Moderate", "High"],
                "colors": [[150, 98, 74], [216, 200, 96], [64, 150, 92]]},
    "fit": {"slope": round(slope, 5), "intercept": round(intercept, 5)},
    "ndvi": b64(QN), "lst": b64(QL), "resid": b64(QR), "bgy": b64(QB),
}

# write-then-rename: a crash or a killed run leaves the previous data.js intact
_tmp = f"{GIS}/data.js.tmp"
with open(_tmp, "w", encoding="utf-8") as fh:
    fh.write("/* Measured 2026 composite, Quezon City. Generated by build/build_qc.py. */\n")
    fh.write("window.SAFENET = ")
    json.dump(BUNDLE, fh, ensure_ascii=False, separators=(",", ":"))
    fh.write(";\n")
os.replace(_tmp, f"{GIS}/data.js")
print(f"\nwrote data.js ({os.path.getsize(GIS+'/data.js')/1e6:.2f} MB)", flush=True)

# ---------------------------------------------------------------- tiles
def js_round(x):
    return math.floor(x + 0.5)


def ramp(stops):
    def fn(t):
        t = min(1.0, max(0.0, t))
        for i in range(len(stops) - 1):
            a, b = stops[i], stops[i + 1]
            if t <= b[0]:
                k = (t - a[0]) / ((b[0] - a[0]) or 1)
                return [js_round(a[1][j] + (b[1][j] - a[1][j]) * k) for j in range(3)]
        return stops[-1][1]
    return fn


RAMPS = {
    "ndvi": ramp([(0.00, [62, 58, 46]), (0.28, [88, 90, 54]), (0.52, [111, 158, 78]),
                  (0.76, [148, 201, 110]), (1.00, [204, 236, 168])]),
    "lst": ramp([(0.00, [15, 20, 30]), (0.22, [58, 34, 44]), (0.44, [124, 51, 30]),
                 (0.66, [196, 90, 30]), (0.84, [237, 165, 63]), (1.00, [250, 234, 190])]),
    "resid": ramp([(0.00, [26, 74, 92]), (0.30, [44, 104, 118]), (0.47, [58, 74, 78]),
                   (0.50, [46, 46, 50]), (0.53, [74, 60, 48]), (0.70, [160, 84, 34]),
                   (1.00, [244, 222, 168])]),
}
CLASS_RGB = [[150, 98, 74], [216, 200, 96], [64, 150, 92]]


def lift(c, amt):
    return [js_round(v + (255 - v) * amt) for v in c] if amt else c


def write_png(path, idx, palette):
    """8-bit palette PNG with per-entry alpha. GDAL's PNG driver here is
    read-only, so the file is encoded directly."""
    import struct, zlib
    h, w = idx.shape
    raw = bytearray()
    for row in idx:
        raw.append(0)                     # filter: none
        raw.extend(row.astype("uint8").tobytes())
    plte = bytearray()
    trns = bytearray()
    for r, g, b, a in palette:
        plte += bytes((r, g, b))
        trns.append(a)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 3, 0, 0, 0))
           + chunk(b"PLTE", bytes(plte))
           + chunk(b"tRNS", bytes(trns))
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(png)
    os.replace(tmp, path)


CLS = np.zeros((NY, NX), dtype=np.uint8)
c = np.isfinite(NDVI)
CLS[c] = np.where(NDVI[c] < 0.10, 1, np.where(NDVI[c] < 0.20, 2, 3)).astype(np.uint8)

def tile(idx):
    """Palette entry 0 is transparent everywhere: blank what is outside the city."""
    a = np.array(idx, dtype=np.uint8, copy=True)
    a[~CITY] = 0
    return a


for theme, amt in (("dark", 0.0), ("light", 0.14)):
    for which, Q in (("ndvi", QN), ("lst", QL), ("resid", QR)):
        pal = [(0, 0, 0, 0)]
        for i in range(1, 256):
            pal.append(tuple(lift(RAMPS[which]((i - 1) / 254), amt)) + (255,))
        write_png(f"{GIS}/tiles/{which}-{theme}.png", tile(Q.reshape(NY, NX)), pal)
    pal = [(0, 0, 0, 0)] + [tuple(lift(c, amt)) + (255,) for c in CLASS_RGB] + [(0, 0, 0, 0)] * 252
    write_png(f"{GIS}/tiles/class-{theme}.png", tile(CLS), pal)
    print(f"tiles written ({theme})", flush=True)

print("\nDONE", flush=True)
