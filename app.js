"use strict";

/* ============================================================
   GreenSpace–LST Console · Novaliches 2026
   Measured data from window.SAFENET (data.js). Map is Leaflet,
   basemap tiles at runtime, raster overlay from tiles/*.png.
   ============================================================ */

const B = window.SAFENET;
const GW = B.grid.nx, GH = B.grid.ny;
const EXT = B.grid.ext;                       // {w,e,n,s}
const CELL_M = B.grid.cell_m;
const NAMES = B.names;
const NRANGE = B.scales.ndvi, LRANGE = B.scales.lst;
const SCALES = B.scales;
/* the class layer is categorical, but every reader of SCALES[...] expects the same shape */
SCALES.class = { min: 0, max: 2, title: 'Vegetation class', unit: 'NDVI bins',
                 pct: 'Low / Moderate / High', ticks: ['Low', 'Moderate', 'High'] };
const N_SITES = NAMES.length;

function b64u8(s){
  const bin = atob(s), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
const QN = b64u8(B.ndvi), QL = b64u8(B.lst), QR = b64u8(B.resid), QB = b64u8(B.bgy);

const NDVI = new Float32Array(GW*GH), LST = new Float32Array(GW*GH);
const RESID = new Float32Array(GW*GH), SITE = new Int16Array(GW*GH);
const VALID = new Uint8Array(GW*GH);

// 0 is nodata; real values are 1..255 across the ramp. Scales are
// {min,max,...} objects, not [lo,hi] pairs.
function deq(q, s){ return s.min + (q - 1)/254*(s.max - s.min); }

for (let i = 0; i < GW*GH; i++){
  const s = QB[i];
  SITE[i] = s < 255 ? s : -1;
  if (QN[i] > 0 && QL[i] > 0 && s < 255){
    NDVI[i] = deq(QN[i], NRANGE);
    LST[i]  = deq(QL[i], LRANGE);
    RESID[i] = deq(QR[i], SCALES.resid);
    VALID[i] = 1;
  } else {
    NDVI[i] = NaN; LST[i] = NaN; RESID[i] = NaN;
  }
}

/* ------------------------------------------------------------
   Colormaps (legend only — the map uses the pre-rendered PNGs,
   generated from the same stops by build/build_assets.py)
   ------------------------------------------------------------ */
function ramp(stops){
  return function(t){
    t = Math.min(1, Math.max(0, t));
    for (let i = 0; i < stops.length - 1; i++){
      const a = stops[i], b = stops[i+1];
      if (t <= b.p){
        const k = (t - a.p) / (b.p - a.p || 1);
        return [Math.round(a.c[0]+(b.c[0]-a.c[0])*k),
                Math.round(a.c[1]+(b.c[1]-a.c[1])*k),
                Math.round(a.c[2]+(b.c[2]-a.c[2])*k)];
      }
    }
    return stops[stops.length-1].c;
  };
}
const RAMPS = {
  ndvi: ramp([{p:0.00,c:[62,58,46]},{p:0.28,c:[88,90,54]},{p:0.52,c:[111,158,78]},
              {p:0.76,c:[148,201,110]},{p:1.00,c:[204,236,168]}]),
  lst:  ramp([{p:0.00,c:[15,20,30]},{p:0.22,c:[58,34,44]},{p:0.44,c:[124,51,30]},
              {p:0.66,c:[196,90,30]},{p:0.84,c:[237,165,63]},{p:1.00,c:[250,234,190]}]),
  resid:ramp([{p:0.00,c:[26,74,92]},{p:0.30,c:[44,104,118]},{p:0.47,c:[58,74,78]},
              {p:0.50,c:[46,46,50]},{p:0.53,c:[74,60,48]},{p:0.70,c:[160,84,34]},
              {p:1.00,c:[244,222,168]}])
};
function themeVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function themeLift(){ return document.documentElement.getAttribute('data-theme') === 'light' ? 0.14 : 0; }
function liftRGB(c, amt){
  return amt ? c.map(v => Math.round(v + (255 - v) * amt)) : c;
}
function cssRamp(which){
  const amt = themeLift(), parts = [];
  for (let i = 0; i <= 10; i++){
    const c = liftRGB(RAMPS[which](i/10), amt);
    parts.push(`rgb(${c[0]},${c[1]},${c[2]}) ${(i*10).toFixed(0)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(',')})`;
}

/* ------------------------------------------------------------
   State
   ------------------------------------------------------------ */
const state = {
  layer: 'ndvi', overlay: 0.78, basemap: 'dark', theme: 'dark',
  bounds: true, labels: true,
  sel: null, hover: null,
  sortKey: 'lst', sortDir: -1, query: ''
};

/* ------------------------------------------------------------
   Map
   ------------------------------------------------------------ */
const BOUNDS = [[EXT.s, EXT.w], [EXT.n, EXT.e]];
const map = L.map('map', {
  zoomControl: false,
  attributionControl: true,
  minZoom: 10,
  maxZoom: 18,
  zoomSnap: 0.25,
  wheelPxPerZoomLevel: 110,
  preferCanvas: false
});
map.fitBounds(BOUNDS, { padding: [10, 10] });

const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/';
const ESRI_ATTR = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, OpenStreetMap contributors';

const BASEMAPS = {
  dark: {
    url: ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    opts: { maxZoom: 16 }, attr: ESRI_ATTR
  },
  light: {
    url: ESRI + 'Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    opts: { maxZoom: 16 }, attr: ESRI_ATTR
  },
  streets: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: { maxZoom: 19 },
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  },
  satellite: {
    url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}',
    labelUrl: ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    opts: { maxZoom: 17 }, attr: ESRI_ATTR
  }
};

let baseLayer = null, labelLayer = null;
function setBasemap(key){
  state.basemap = key;
  if (baseLayer) map.removeLayer(baseLayer);
  if (labelLayer){ map.removeLayer(labelLayer); labelLayer = null; }
  const bm = BASEMAPS[key];
  baseLayer = L.tileLayer(bm.url, Object.assign({ attribution: bm.attr }, bm.opts)).addTo(map);
  baseLayer.bringToBack();
  if (bm.labelUrl){
    labelLayer = L.tileLayer(bm.labelUrl, { maxZoom: bm.opts.maxZoom, opacity: 0.9 }).addTo(map);
  }
  document.querySelectorAll('[data-basemap]').forEach(x =>
    x.setAttribute('aria-pressed', String(x.dataset.basemap === key)));
}
setBasemap('dark');

L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 130 }).addTo(map);

/* raster overlays: one image per layer and theme, built on demand */
const overlayCache = {};
let raster = null;
function rasterPath(which, theme){ return `tiles/${which}-${theme === 'light' ? 'light' : 'dark'}.png`; }
function setRaster(){
  if (raster) map.removeLayer(raster);
  const key = state.layer + '-' + state.theme;
  if (!overlayCache[key]){
    overlayCache[key] = L.imageOverlay(rasterPath(state.layer, state.theme), BOUNDS, {
      opacity: state.overlay, interactive: false, className: 'raster-overlay'
    });
  }
  raster = overlayCache[key];
  raster.setOpacity(state.overlay);
  raster.addTo(map);
  if (baseLayer) baseLayer.bringToBack();
  if (labelLayer) labelLayer.bringToFront();
  if (geo) geo.bringToFront();
}

/* barangay geometry */
let geo = null;
let selectedLayer = null;
const layerById = {};

function polyStyle(i){
  const on = state.sel && state.sel.id === i;
  return {
    color: on ? themeVar('--accent') : themeVar('--map-edge'),
    weight: on ? 2.6 : 1,
    opacity: on ? 1 : 0.85,
    fill: on,
    fillColor: themeVar('--accent'),
    fillOpacity: on ? 0.16 : 0
  };
}

/* geometry ships inside data.js: file:// pages cannot fetch a sibling file */
geo = L.geoJSON(B.geo, {
  style: f => polyStyle(NAMES.indexOf(f.properties.name)),
  onEachFeature: (f, lyr) => {
    const i = NAMES.indexOf(f.properties.name);
    layerById[i] = lyr;
    lyr.bindTooltip(f.properties.name, {
      permanent: true, direction: 'center', className: 'bgy-tip',
      opacity: 1, interactive: false
    });
    lyr.on('click', e => { L.DomEvent.stop(e); select(i); });
    lyr.on('mouseover', () => { if (!state.sel) lyr.setStyle({ weight: 1.6, opacity: 1 }); });
    lyr.on('mouseout', () => { if (!state.sel) lyr.setStyle(polyStyle(i)); });
  }
}).addTo(map);
if (!state.labels) geo.eachLayer(l => l.closeTooltip());
setRaster();
paintSelection();

/* ------------------------------------------------------------
   Geometry helpers
   ------------------------------------------------------------ */
function cellFromLatLng(ll){
  const gx = Math.floor((ll.lng - EXT.w) / (EXT.e - EXT.w) * GW);
  const gy = Math.floor((EXT.n - ll.lat) / (EXT.n - EXT.s) * GH);
  if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return -1;
  return gy*GW + gx;
}

/* ------------------------------------------------------------
   Statistics
   ------------------------------------------------------------ */
function pearson(xs, ys){
  const n = xs.length;
  let sx=0, sy=0, sxx=0, syy=0, sxy=0;
  for (let i = 0; i < n; i++){
    sx += xs[i]; sy += ys[i];
    sxx += xs[i]*xs[i]; syy += ys[i]*ys[i]; sxy += xs[i]*ys[i];
  }
  const den = Math.sqrt((n*sxx - sx*sx) * (n*syy - sy*sy));
  return den === 0 ? 0 : (n*sxy - sx*sy)/den;
}
function linreg(xs, ys){
  const n = xs.length;
  let sx=0, sy=0, sxx=0, sxy=0;
  for (let i = 0; i < n; i++){ sx+=xs[i]; sy+=ys[i]; sxx+=xs[i]*xs[i]; sxy+=xs[i]*ys[i]; }
  const slope = (n*sxy - sx*sy) / (n*sxx - sx*sx || 1);
  return { slope, intercept: (sy - slope*sx)/n };
}
function samplePairs(step){
  const xs = [], ys = [];
  for (let i = 0; i < GW*GH; i += step){
    if (!VALID[i]) continue;
    xs.push(NDVI[i]); ys.push(LST[i]);
  }
  return { xs, ys };
}
const nativePixels = cells => Math.round(cells * Math.pow(CELL_M/100, 2));
const COVER_THRESHOLD = 60;

function zonal(){
  const n = N_SITES;
  const aN = new Float64Array(n), aL = new Float64Array(n), aR = new Float64Array(n), cnt = new Int32Array(n);
  for (let i = 0; i < GW*GH; i++){
    const s = SITE[i];
    if (s < 0 || !VALID[i]) continue;
    aN[s] += NDVI[i]; aL[s] += LST[i]; aR[s] += RESID[i]; cnt[s]++;
  }
  return NAMES.map((name, i) => ({
    i, name,
    cells: cnt[i],
    ndvi: cnt[i] ? aN[i]/cnt[i] : NaN,
    lst:  cnt[i] ? aL[i]/cnt[i] : NaN,
    resid: cnt[i] ? aR[i]/cnt[i] : NaN,
    npx: nativePixels(cnt[i])
  }));
}
function meanAll(which){
  const arr = which === 'ndvi' ? NDVI : which === 'lst' ? LST : RESID;
  let s = 0, n = 0;
  for (let i = 0; i < GW*GH; i++) if (VALID[i]){ s += arr[i]; n++; }
  return n ? s/n : 0;
}

/* ------------------------------------------------------------
   Panels
   ------------------------------------------------------------ */
function fitCanvas(cv, h){
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.parentElement.clientWidth;
  cv.width = Math.floor(w*dpr); cv.height = Math.floor(h*dpr);
  cv.style.height = h + 'px';
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, w, h };
}

function renderStats(){
  const { xs, ys } = samplePairs(1);   // all valid cells: must match the Relationship tab
  const r = pearson(xs, ys), { slope } = linreg(xs, ys);
  document.getElementById('s-r').textContent = r.toFixed(3);
  document.getElementById('s-r2').textContent = (r*r).toFixed(3);
  document.getElementById('s-slope').innerHTML = (slope*0.1).toFixed(2) + '<small>&deg;C/0.1</small>';
  document.getElementById('s-n').textContent = xs.length.toLocaleString();
  document.getElementById('cap-scatter').textContent = 'n = ' + xs.length.toLocaleString();
  document.getElementById('sb-cells').textContent = xs.length.toLocaleString();
}

const LEGEND_NOTE = {
  ndvi: 'brighter \u2192 more vegetation',
  lst: 'brighter \u2192 hotter',
  resid: 'blue cooler \u00B7 orange hotter'
};

function renderLegend(){
  const S = SCALES[state.layer];
  document.getElementById('lg-title').textContent = S.title;
  if (state.layer === 'class'){
    const C = B.classes.colors, L = B.classes.labels, cut = B.classes.cuts;
    document.getElementById('lg-bar').style.background =
      `linear-gradient(90deg, rgb(${C[0]}) 0 33.3%, rgb(${C[1]}) 33.3% 66.6%, rgb(${C[2]}) 66.6% 100%)`;
    document.getElementById('lg-ticks').innerHTML = L.map(l => `<span>${l}</span>`).join('');
    document.getElementById('lg-unit').textContent = 'NDVI thresholds ' + cut.join(' / ');
    document.getElementById('lg-note').textContent = 'categorical \u00B7 not a gradient';
    document.getElementById('lg-zero').style.display = 'none';
    return;
  }
  document.getElementById('lg-bar').style.background = cssRamp(state.layer);
  document.getElementById('lg-ticks').innerHTML = S.ticks.map(t => `<span>${t}</span>`).join('');
  document.getElementById('lg-unit').textContent = S.unit + ' \u00B7 ' + S.pct;
  document.getElementById('lg-note').textContent = LEGEND_NOTE[state.layer];
  const z = document.getElementById('lg-zero');
  if (S.zeroAt !== undefined){
    z.style.display = 'block'; z.style.left = (S.zeroAt*100).toFixed(1) + '%';
  } else z.style.display = 'none';
}

function renderScatter(){
  const cv = document.getElementById('c-scatter');
  const { c, w, h } = fitCanvas(cv, 188);
  const pad = { l: 34, r: 8, t: 8, b: 22 };
  const { xs, ys } = samplePairs(3);
  const S = SCALES.lst;
  const xmin = SCALES.ndvi.min, xmax = SCALES.ndvi.max;
  const ymin = S.min, ymax = S.max;
  const X = v => pad.l + (v - xmin)/(xmax - xmin) * (w - pad.l - pad.r);
  const Y = v => h - pad.b - (v - ymin)/(ymax - ymin) * (h - pad.t - pad.b);

  c.clearRect(0, 0, w, h);
  c.strokeStyle = themeVar('--line');
  c.lineWidth = 1;
  for (let i = 0; i <= 4; i++){
    const y = pad.t + i*(h - pad.t - pad.b)/4;
    c.beginPath(); c.moveTo(pad.l, y + .5); c.lineTo(w - pad.r, y + .5); c.stroke();
  }
  c.fillStyle = themeVar('--text-3');
  c.font = '9px "Geist Mono", monospace';
  c.textAlign = 'right';
  for (let i = 0; i <= 4; i++){
    const v = ymax - i*(ymax - ymin)/4;
    c.fillText(v.toFixed(1), pad.l - 5, pad.t + i*(h - pad.t - pad.b)/4 + 3);
  }
  c.textAlign = 'center';
  for (let i = 0; i <= 4; i++){
    const v = xmin + i*(xmax - xmin)/4;
    c.fillText(v.toFixed(2), X(v), h - 7);
  }
  c.textAlign = 'right';
  c.fillText('LST \u00B0C', w - pad.r, pad.t + 8);

  const col = RAMPS.lst;
  c.globalAlpha = 0.5;
  for (let i = 0; i < xs.length; i++){
    const rgb = col((ys[i] - ymin)/(ymax - ymin));
    c.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    c.fillRect(X(xs[i]), Y(ys[i]), 1.6, 1.6);
  }
  c.globalAlpha = 1;

  const { slope, intercept } = linreg(xs, ys);
  c.strokeStyle = themeVar('--accent');
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(X(xmin), Y(Math.min(ymax, Math.max(ymin, intercept + slope*xmin))));
  c.lineTo(X(xmax), Y(Math.min(ymax, Math.max(ymin, intercept + slope*xmax))));
  c.stroke();
}

function renderBar(){
  const cv = document.getElementById('c-bar');
  const { c, w, h } = fitCanvas(cv, 212);
  const rows = zonal().filter(r => r.cells > 0).sort((a,b) => b.lst - a.lst).slice(0, 12);
  const pad = { l: 92, r: 34, t: 6, b: 6 };
  const S = SCALES.lst;
  const lo = Math.min(...rows.map(r => r.lst)), hi = Math.max(...rows.map(r => r.lst));
  const rowH = (h - pad.t - pad.b) / rows.length;

  c.clearRect(0, 0, w, h);
  c.font = '9.5px "Geist Mono", monospace';
  rows.forEach((r, i) => {
    const y = pad.t + i*rowH;
    const on = state.sel && state.sel.id === r.i;
    const t = (r.lst - lo)/((hi - lo) || 1);
    const bw = Math.max(2, (w - pad.l - pad.r) * (0.35 + 0.65*t));
    const rgb = RAMPS.lst((r.lst - S.min)/((S.max - S.min) || 1));
    c.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    c.globalAlpha = state.sel && !on ? 0.32 : 1;
    c.fillRect(pad.l, y + rowH*0.18, bw, rowH*0.64);
    c.globalAlpha = 1;
    c.fillStyle = on ? themeVar('--accent') : themeVar('--text-2');
    c.textAlign = 'right';
    c.fillText(r.name.length > 17 ? r.name.slice(0, 16) + '\u2026' : r.name, pad.l - 6, y + rowH*0.62);
    c.fillStyle = themeVar('--text-3');
    c.textAlign = 'left';
    c.fillText(r.lst.toFixed(1), pad.l + bw + 5, y + rowH*0.62);
  });
  cv._rows = rows;
  cv._geom = { pad, rowH };
}

function renderHist(){
  const cv = document.getElementById('c-hist');
  const { c, w, h } = fitCanvas(cv, 132);
  const pad = { l: 6, r: 6, t: 8, b: 18 };
  const lo = Math.floor(SCALES.lst.min), hi = Math.ceil(SCALES.lst.max);
  const nb = Math.max(4, hi - lo);
  const bins = new Float64Array(nb);
  let nValid = 0;
  for (let i = 0; i < GW*GH; i++){
    if (!VALID[i]) continue;
    nValid++;
    const b = Math.floor(LST[i] - lo);
    if (b >= 0 && b < nb) bins[b]++;
  }
  const top = Math.max(...bins) || 1;
  c.clearRect(0, 0, w, h);
  const bw = (w - pad.l - pad.r) / nb;
  for (let i = 0; i < nb; i++){
    const bh = (bins[i]/top) * (h - pad.t - pad.b);
    const rgb = RAMPS.lst(((lo + i + 0.5) - SCALES.lst.min)/((SCALES.lst.max - SCALES.lst.min) || 1));
    c.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    c.fillRect(pad.l + i*bw, h - pad.b - bh, Math.max(1, bw - 0.6), bh);
  }
  c.fillStyle = themeVar('--text-3');
  c.font = '9px "Geist Mono", monospace';
  c.textAlign = 'left';
  c.fillText(lo + '\u00B0C', pad.l, h - 5);
  c.textAlign = 'right';
  c.fillText(hi + '\u00B0C', w - pad.r, h - 5);
  c.textAlign = 'left';
  c.fillText(top.toLocaleString(), pad.l, pad.t + 7);
  document.getElementById('cap-hist').textContent = '\u00B0C \u00B7 n = ' + nValid.toLocaleString();
}

function renderRanks(){
  const z = zonal().filter(r => r.cells > 0 && r.npx >= COVER_THRESHOLD);
  const hot = [...z].sort((a,b) => b.lst - a.lst).slice(0, 4);
  const cool = [...z].sort((a,b) => a.lst - b.lst).slice(0, 4);
  const put = (rows, el, cls) => {
    const lo = rows[rows.length-1].lst, hi = rows[0].lst;
    document.getElementById(el).innerHTML = rows.map(r => {
      const t = hi === lo ? 1 : (cls === 'hot' ? (r.lst - lo)/(hi - lo) : (hi - r.lst)/(hi - lo));
      const on = state.sel && state.sel.id === r.i;
      return `<button class="rankrow" data-site="${r.i}" aria-pressed="${on}">` +
             `<span class="nm">${r.name}</span>` +
             `<span class="bar"><i class="${cls === 'cool' ? 'cool' : ''}" style="width:${(t*100).toFixed(0)}%"></i></span>` +
             `<span class="v">${r.lst.toFixed(1)}</span></button>`;
    }).join('');
  };
  put(hot, 'rank-hot', 'hot');
  put(cool, 'rank-cool', 'cool');
}

function renderSelection(){
  const body = document.getElementById('sel-body');
  const empty = document.getElementById('sel-empty');
  const clearBtn = document.getElementById('sel-clear');
  const chip = document.getElementById('selchip');
  const card = document.getElementById('selcard');
  if (card) card.classList.toggle('on', !!state.sel);
  const selRow = document.getElementById('tb-selrow');

  if (!state.sel){
    body.style.display = 'none'; empty.style.display = 'block';
    document.getElementById('sel-name').textContent = '';
    clearBtn.style.display = 'none'; chip.classList.remove('on');
    selRow.style.display = 'none';
    return;
  }
  body.style.display = 'block'; empty.style.display = 'none';
  clearBtn.style.display = 'inline-block';
  chip.classList.add('on');
  selRow.style.display = 'flex';
  document.getElementById('tb-selname').textContent = state.sel.label;
  document.getElementById('sel-name').textContent = state.sel.label;

  const row = zonal()[state.sel.id];
  const area = meanAll('lst');
  const dT = row.lst - area;
  const txt = row.lst.toFixed(2) + ' \u00B0C  \u00B7  ' + (dT >= 0 ? '+' : '') + dT.toFixed(2) + ' vs area';
  document.getElementById('selchip-n').textContent = state.sel.label;
  document.getElementById('selchip-v').textContent = txt;
  document.getElementById('tb-selval').textContent = txt;

  const kv = [
    ['Cells', row.cells.toLocaleString()],
    ['Native thermal px', row.npx.toLocaleString()],
    ['Mean NDVI', row.ndvi.toFixed(3)],
    ['Mean LST', row.lst.toFixed(2) + ' \u00B0C'],
    ['Heat residual', (row.resid >= 0 ? '+' : '') + row.resid.toFixed(2) + ' \u00B0C'],
    ['Anomaly vs area', (dT >= 0 ? '+' : '') + dT.toFixed(2) + ' \u00B0C']
  ];
  let html = kv.map(r => `<div class="kv2"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('');
  if (row.npx < COVER_THRESHOLD){
    html += `<div class="note" style="margin-top:11px;font-size:11px">Only ${row.npx} native thermal
      pixels. Treat this mean as indicative.</div>`;
  }
  body.innerHTML = html;
}

function currentRows(){
  let rows = zonal().filter(r => r.cells > 0);
  const q = state.query.trim().toLowerCase();
  if (q) rows = rows.filter(r => r.name.toLowerCase().indexOf(q) >= 0);
  const key = state.sortKey, dir = state.sortDir;
  rows.sort((a, b) => {
    const va = a[key], vb = b[key];
    if (typeof va === 'string') return va.localeCompare(vb) * dir;
    return (va - vb) * dir;
  });
  return rows;
}

function renderTable(){
  const rows = currentRows();
  document.getElementById('tb-body').innerHTML = rows.map(r => {
    const thin = r.npx < COVER_THRESHOLD;
    const on = state.sel && state.sel.id === r.i;
    return `<tr data-site="${r.i}" aria-selected="${on}">
      <td class="bn">${r.name}</td>
      <td class="n">${r.ndvi.toFixed(3)}</td>
      <td class="n">${r.lst.toFixed(2)} &deg;C</td>
      <td class="n">${(r.resid >= 0 ? '+' : '')}${r.resid.toFixed(2)}</td>
      <td class="n">${r.npx}</td>
      <td><span class="flag ${thin ? 'thin' : 'ok'}" title="${thin
        ? 'Below ' + COVER_THRESHOLD + ' native 100 m thermal pixels'
        : 'Sufficient thermal coverage'}">${thin ? 'below threshold' : 'sufficient'}</span></td>
    </tr>`;
  }).join('');
  document.getElementById('tb-none').style.display = rows.length ? 'none' : 'block';
  document.getElementById('tb-count').textContent = rows.length + ' of ' + N_SITES + ' shown';
  document.querySelectorAll('thead th button').forEach(b => {
    b.querySelector('.ar').textContent =
      b.dataset.sort === state.sortKey ? (state.sortDir > 0 ? '\u25B2' : '\u25BC') : '';
  });
}

/* ------------------------------------------------------------
   Readout and selection
   ------------------------------------------------------------ */
function setReadout(ll){
  const ro = id => document.getElementById(id);
  if (!ll){
    const n = Array.from(VALID).reduce((a, b) => a + b, 0);
    ro('ro-title').textContent = 'Study area \u00B7 mean of ' + n.toLocaleString() + ' cells';
    ro('ro-brgy').textContent = '20 barangays';
    ro('ro-ndvi').textContent = meanAll('ndvi').toFixed(3);
    ro('ro-lst').textContent = meanAll('lst').toFixed(2) + ' \u00B0C';
    ro('ro-res').textContent = (meanAll('resid') >= 0 ? '+' : '') + meanAll('resid').toFixed(2) + ' \u00B0C';
    ro('ro-llk').textContent = 'Cursor';
    ro('ro-ll').textContent = 'move over the map';
    return;
  }
  const i = cellFromLatLng(ll);
  ro('ro-llk').textContent = 'Cursor';
  ro('ro-ll').textContent = ll.lat.toFixed(4) + '\u00B0N ' + ll.lng.toFixed(4) + '\u00B0E';
  if (i < 0 || !VALID[i]){
    ro('ro-title').textContent = 'Outside the raster';
    ro('ro-brgy').textContent = '\u2014';
    ro('ro-ndvi').textContent = '\u2014';
    ro('ro-lst').textContent = '\u2014';
    ro('ro-res').textContent = '\u2014';
    return;
  }
  ro('ro-title').textContent = 'Cell ' + (i % GW) + ',' + Math.floor(i / GW);
  ro('ro-brgy').textContent = SITE[i] >= 0 ? NAMES[SITE[i]] : 'outside barangay';
  ro('ro-ndvi').textContent = NDVI[i].toFixed(3);
  ro('ro-lst').textContent = LST[i].toFixed(2) + ' \u00B0C';
  ro('ro-res').textContent = (RESID[i] >= 0 ? '+' : '') + RESID[i].toFixed(2) + ' \u00B0C';
}

map.on('mousemove', e => { state.hover = e.latlng; setReadout(e.latlng); });
map.on('mouseout', () => { state.hover = null; setReadout(null); });
map.on('zoomend', () => {
  document.getElementById('z-level').textContent = 'z' + map.getZoom().toFixed(1);
  document.getElementById('sb-zoom').textContent = 'z' + map.getZoom().toFixed(1);
});

function paintSelection(){
  if (!geo) return;
  Object.keys(layerById).forEach(k => {
    const i = +k;
    layerById[i].setStyle(polyStyle(i));
    if (state.sel && state.sel.id === i) layerById[i].bringToFront();
  });
}

function select(id){
  state.sel = id === null ? null : { id, label: NAMES[id] };
  paintSelection();
  renderSelection(); renderTable(); renderRanks(); renderBar();
}
function clearSelection(){ select(null); }

/* ------------------------------------------------------------
   Wiring
   ------------------------------------------------------------ */
function refreshAll(){
  renderStats(); renderLegend(); renderScatter(); renderBar(); renderHist();
  renderRanks(); renderSelection(); renderTable(); setReadout(null);
}

/* tabs */
document.querySelectorAll('nav.tabs .tab').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs .tab').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + b.dataset.view));
    if (b.dataset.view === 'console'){ map.invalidateSize(); }
    if (b.dataset.view === 'barangays'){ renderTable(); }
    if (b.dataset.view === 'relationship' && window.REL){ window.REL.render(); }
    if (b.dataset.view === 'compare' && window.CMP){ window.CMP.init(); }
  });
});

/* report */
document.getElementById('btn-report').addEventListener('click', () => {
  if (window.AUTH_DOWNLOAD_REPORT) window.AUTH_DOWNLOAD_REPORT();
  else if (window.REL) window.REL.downloadReport();
});
document.getElementById('btn-report-print').addEventListener('click', () => window.REL && window.REL.printReport());

/* theme */
document.querySelectorAll('[data-theme-set]').forEach(b => {
  b.addEventListener('click', () => {
    state.theme = b.dataset.themeSet;
    document.documentElement.setAttribute('data-theme', state.theme);
    // a grey basemap should follow the theme; streets and satellite are explicit choices
    if (state.basemap === 'dark' || state.basemap === 'light') setBasemap(state.theme);
    document.querySelectorAll('[data-theme-set]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    setRaster();
    paintSelection();
    refreshAll();
  });
});

/* basemap */
document.querySelectorAll('[data-basemap]').forEach(b => {
  b.addEventListener('click', () => setBasemap(b.dataset.basemap));
});

/* layers */
document.querySelectorAll('.layer').forEach(b => {
  b.addEventListener('click', () => {
    state.layer = b.dataset.layer;
    document.querySelectorAll('.layer').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    document.getElementById('layer-active').textContent = SCALES[state.layer].title;
    document.getElementById('sb-layer').textContent = SCALES[state.layer].title;
    setRaster();
    renderLegend();
  });
});

/* display */
const op = document.getElementById('op');
op.addEventListener('input', () => {
  state.overlay = op.value/100;
  document.getElementById('op-out').textContent = op.value;
  if (raster) raster.setOpacity(state.overlay);
});
document.getElementById('t-bounds').addEventListener('click', e => {
  state.bounds = !state.bounds;
  e.currentTarget.setAttribute('aria-pressed', String(state.bounds));
  if (geo){ state.bounds ? geo.addTo(map) : map.removeLayer(geo); }
});
document.getElementById('t-labels').addEventListener('click', e => {
  state.labels = !state.labels;
  e.currentTarget.setAttribute('aria-pressed', String(state.labels));
  if (!geo) return;
  geo.eachLayer(l => { state.labels ? l.openTooltip() : l.closeTooltip(); });
});

/* map controls */
document.getElementById('z-in').addEventListener('click', () => map.zoomIn(0.75));
document.getElementById('z-out').addEventListener('click', () => map.zoomOut(0.75));
document.getElementById('z-fit').addEventListener('click', () => map.fitBounds(BOUNDS, { padding: [10, 10] }));
document.getElementById('z-help').addEventListener('click', () => document.getElementById('shortcuts').classList.toggle('on'));
document.getElementById('selchip-x').addEventListener('click', clearSelection);
document.getElementById('sel-clear').addEventListener('click', clearSelection);
document.getElementById('tb-selclear').addEventListener('click', clearSelection);

/* ranking rows and table */
document.getElementById('rank-hot').addEventListener('click', e => {
  const b = e.target.closest('[data-site]'); if (b) select(+b.dataset.site);
});
document.getElementById('rank-cool').addEventListener('click', e => {
  const b = e.target.closest('[data-site]'); if (b) select(+b.dataset.site);
});
document.getElementById('tb-body').addEventListener('click', e => {
  const tr = e.target.closest('tr'); if (tr) select(+tr.dataset.site);
});
document.querySelectorAll('thead th button').forEach(b => {
  b.addEventListener('click', () => {
    const key = b.dataset.sort;
    if (state.sortKey === key) state.sortDir *= -1;
    else { state.sortKey = key; state.sortDir = key === 'name' ? 1 : -1; }
    renderTable();
  });
});
document.getElementById('tb-search').addEventListener('input', e => {
  state.query = e.target.value; renderTable();
});
document.getElementById('tb-export').addEventListener('click', () => {
  const rows = currentRows();
  const head = 'barangay,cells,native_thermal_px,ndvi_mean,lst_mean_c,resid_mean_c\n';
  const body = rows.map(r => [r.name, r.cells, r.npx,
    r.ndvi.toFixed(4), r.lst.toFixed(2), r.resid.toFixed(3)].join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([head + body], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'novaliches_barangay_stats_2026.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

/* bar chart hit test */
const barCv = document.getElementById('c-bar');
const barTip = document.getElementById('tip-bar');
barCv.addEventListener('mousemove', e => {
  const rows = barCv._rows, g = barCv._geom;
  if (!rows || !g) return;
  const r = barCv.getBoundingClientRect();
  const y = e.clientY - r.top;
  const idx = Math.floor((y - g.pad.t) / g.rowH);
  if (idx < 0 || idx >= rows.length){ barTip.classList.remove('on'); return; }
  const row = rows[idx];
  barTip.innerHTML = `<b>${row.name}</b><br>${row.lst.toFixed(2)} &deg;C &middot; NDVI ${row.ndvi.toFixed(3)}`;
  barTip.style.left = (e.clientX - r.left + 12) + 'px';
  barTip.style.top = (e.clientY - r.top + 10) + 'px';
  barTip.classList.add('on');
});
barCv.addEventListener('mouseleave', () => barTip.classList.remove('on'));
barCv.addEventListener('click', e => {
  const rows = barCv._rows, g = barCv._geom;
  if (!rows || !g) return;
  const r = barCv.getBoundingClientRect();
  const idx = Math.floor((e.clientY - r.top - g.pad.t) / g.rowH);
  if (idx >= 0 && idx < rows.length) select(rows[idx].i);
});

/* keyboard: Leaflet handles arrows and +/-, we add fit and clear */
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'Escape'){ clearSelection(); }
  else if (e.key === '0'){ map.fitBounds(BOUNDS, { padding: [10, 10] }); }
  else if (e.key === '?'){ document.getElementById('shortcuts').classList.toggle('on'); }
});

let _rz = null;
window.addEventListener('resize', () => {
  map.invalidateSize();
  clearTimeout(_rz);
  _rz = setTimeout(() => {
    const v = document.querySelector('.view.is-active');
    if (!v) return;
    if (v.id === 'view-console'){ refreshAll(); }
    if (v.id === 'view-relationship' && window.REL){ window.REL.render(); }
    if (v.id === 'view-compare' && window.CMP){ window.CMP.init(); }
  }, 220);
});

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   Self-test: ?selftest=1 writes a JSON block headless runs assert on
   ------------------------------------------------------------ */
if (new URLSearchParams(location.search).has('selftest')){
  setTimeout(() => {
    // exercise the relationship view and the report before dumping state
    const relTab = document.querySelector('nav.tabs .tab[data-view="relationship"]');
    if (relTab) relTab.click();
    const A2 = window.REL ? window.REL.analyze() : null;
    const rep = window.REL ? window.REL.reportHTML() : '';
    const { xs, ys } = samplePairs(1);
    const r = pearson(xs, ys);
    const z = zonal();
    const pre = document.createElement('pre');
    pre.id = 'selftest';
    pre.style.cssText = 'position:fixed;left:-99999px;top:0;white-space:pre';
    pre.textContent = JSON.stringify({
      grid: [GW, GH],
      sites: N_SITES,
      polygons: geo ? geo.getLayers().length : 0,
      validCells: Array.from(VALID).reduce((a, b) => a + b, 0),
      overlay: !!raster,
      overlaySrc: raster ? raster._url : null,
      basemap: state.basemap,
      zoom: map.getZoom(),
      center: [ +map.getCenter().lat.toFixed(4), +map.getCenter().lng.toFixed(4) ],
      tiles: document.querySelectorAll('.leaflet-tile').length,
      labels: document.querySelectorAll('.bgy-tip').length,
      rows: currentRows().length,
      r: +r.toFixed(4),
      r2: +(r*r).toFixed(4),
      n: xs.length,
      lstMean: +(z.reduce((a, s) => a + s.lst, 0) / z.length).toFixed(3),
      asof: B.asof,
      rel: A2 ? {
        r: +A2.r.toFixed(4), slopePer01: +(A2.slope * 0.1).toFixed(3),
        F: Math.round(A2.anova.F), eta2: +A2.anova.eta2.toFixed(4),
        kwH: Math.round(A2.kw.H), classMeans: A2.stats.map(v => +v.mean.toFixed(2)),
        classN: A2.stats.map(v => v.n),
        pairs: A2.pairs.map(v => [+v.diff.toFixed(2), +v.padj.toFixed(6)]),
        tercMeans: A2.terc.means.map(v => +v.toFixed(2))
      } : null,
      report: { chars: rep.length, images: (rep.match(/data:image\/png/g) || []).length,
                hasVerdict: rep.indexOf('High vegetation') > -1 },
      classLayer: { tiles: [rasterPath('class', 'dark'), rasterPath('class', 'light')],
                    legend: document.getElementById('lg-ticks').textContent },
      legend: document.getElementById('lg-ticks').textContent,
      hist: document.getElementById('cap-hist').textContent
    }, null, 1);
    document.body.appendChild(pre);
  }, 2500);
}

document.getElementById('grid-label').textContent = GW + ' \u00D7 ' + GH;
document.getElementById('cell-label').textContent = Math.round(CELL_M) + ' m';
document.getElementById('sb-grid').textContent = GW + ' \u00D7 ' + GH;
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(iso){
  const [y, m, d] = iso.split('-');
  return (+d) + ' ' + MON[+m - 1] + ' ' + y;
}
const A = B.asof;
document.getElementById('win-s2').textContent = B.counts.s2 + ' \u00B7 to ' + fmtDate(A.s2_last).slice(0, 6);
document.getElementById('win-ls').textContent = B.counts.landsat + ' \u00B7 to ' + fmtDate(A.ls_last).slice(0, 6);
document.getElementById('badge-asof').textContent = 'as of ' + fmtDate(A.s2_last);
document.getElementById('badge').title =
  'Newest scene in this composite: Sentinel-2 ' + fmtDate(A.s2_last) +
  ', Landsat ' + fmtDate(A.ls_last) + '. Built ' + fmtDate(A.built) +
  '. A median composite is retrospective \u2014 it is not a live feed.';
document.getElementById('card-scenes').textContent =
  B.counts.s2 + ' Sentinel-2 L2A scenes (tile T51PTS) and ' + B.counts.landsat +
  ' Landsat 8/9 Collection 2 scenes (116/050), 2026. Pixel-wise median after cloud masking.';
document.getElementById('kv-ext').textContent =
  EXT.w.toFixed(3) + '\u00B0E \u2013 ' + EXT.e.toFixed(3) + '\u00B0E \u00B7 ' +
  EXT.s.toFixed(3) + '\u00B0N \u2013 ' + EXT.n.toFixed(3) + '\u00B0N';
document.getElementById('kv-grid').textContent =
  GW + ' \u00D7 ' + GH + ' cells \u00B7 ' + CELL_M.toFixed(1) + ' m nominal cell';
document.getElementById('kv-comp').textContent =
  '2026 median composite \u00B7 single epoch \u00B7 newest scene ' + A.s2_last +
  ' (Sentinel-2), ' + A.ls_last + ' (Landsat) \u00B7 built ' + A.built;
document.getElementById('z-level').textContent = 'z' + map.getZoom().toFixed(1);
document.getElementById('sb-zoom').textContent = 'z' + map.getZoom().toFixed(1);

refreshAll();

/* ------------------------------------------------------------
   Deep links: ?tab= ?layer= ?select= ?theme= ?basemap=
   ------------------------------------------------------------ */
(function applyParams(){
  const P = new URLSearchParams(location.search);
  const click = sel => { const el = document.querySelector(sel); if (el) el.click(); };
  if (P.has('theme')) click(`[data-theme-set="${P.get('theme')}"]`);
  if (P.has('basemap')) click(`[data-basemap="${P.get('basemap')}"]`);
  if (P.has('layer')) click(`.layer[data-layer="${P.get('layer')}"]`);
  if (P.has('tab')) click(`nav.tabs .tab[data-view="${P.get('tab')}"]`);
  if (P.has('select')){
    const i = NAMES.findIndex(n => n.toLowerCase() === P.get('select').toLowerCase());
    if (i >= 0) select(i);
  }
})();

/* shared with analysis.js */
window.UI = { themeVar, fitCanvas };
