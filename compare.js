"use strict";

/* ============================================================
   compare.js — two synced maps (vegetation beside temperature)
   plus a barangay A/B comparison panel.
   ============================================================ */

(function () {
  const B = window.SAFENET;
  const NAMES = B.names;
  const BOUNDS = [[B.grid.ext.s, B.grid.ext.w], [B.grid.ext.n, B.grid.ext.e]];
  const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/';

  const LAYERS = {
    ndvi:  { name: 'NDVI', unit: 'index', title: 'Vegetation index' },
    lst:   { name: 'LST', unit: '\u00B0C', title: 'Surface temperature' },
    resid: { name: 'Residual', unit: '\u00B0C', title: 'Heat residual' },
    klass: { name: 'Class', unit: 'bins', title: 'Vegetation class' }
  };

  let mapA = null, mapB = null, ready = false, syncing = false;
  const state = { a: 'ndvi', b: 'lst', sel: null, peer: null };
  const sides = {};

  function tileFor(which) { return 'tiles/' + (which === 'klass' ? 'class' : which) + '-dark.png'; }

  function makeMap(el) {
    const m = L.map(el, {
      zoomControl: false, attributionControl: false, minZoom: 10, maxZoom: 18,
      zoomSnap: 0.25, wheelPxPerZoomLevel: 110
    }).fitBounds(BOUNDS, { padding: [6, 6] });
    L.tileLayer(ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, attribution: 'Esri'
    }).addTo(m);
    return m;
  }

  function buildSide(which, map, overlayRef) {
    const ov = L.imageOverlay(tileFor(state[which]), BOUNDS, { opacity: 0.8, interactive: false }).addTo(map);
    const geo = L.geoJSON(B.geo, {
      style: f => {
        const i = NAMES.indexOf(f.properties.name);
        const on = state.sel === i;
        return {
          color: on ? '#e8a33d' : 'rgba(255,255,255,.55)',
          weight: on ? 2.4 : 0.8,
          fill: on, fillColor: '#e8a33d', fillOpacity: on ? 0.14 : 0
        };
      },
      onEachFeature: (f, lyr) => {
        const i = NAMES.indexOf(f.properties.name);
        lyr.on('click', () => select(i));
        lyr.on('mouseover', () => lyr.setStyle({ weight: 2, color: '#fff' }));
        lyr.on('mouseout', () => lyr.setStyle({ weight: state.sel === i ? 2.4 : 0.8,
          color: state.sel === i ? '#e8a33d' : 'rgba(255,255,255,.55)' }));
      }
    }).addTo(map);
    sides[which] = { map, ov, geo };
  }

  function sync(a, b) {
    a.on('move', () => {
      if (syncing) return;
      syncing = true;
      b.setView(a.getCenter(), a.getZoom(), { animate: false });
      syncing = false;
    });
  }

  function init() {
    if (ready) { mapA.invalidateSize(); mapB.invalidateSize(); return; }
    mapA = makeMap(document.getElementById('cmpA'));
    mapB = makeMap(document.getElementById('cmpB'));
    buildSide('a', mapA);
    buildSide('b', mapB);
    sync(mapA, mapB); sync(mapB, mapA);
    ready = true;
    select(state.sel ?? 0);
  }

  function select(i) {
    state.sel = i;
    if (state.peer === null || state.peer === i) state.peer = (i + 1) % NAMES.length;
    ['a', 'b'].forEach(k => {
      if (!sides[k]) return;
      sides[k].geo.eachLayer(l => {
        const j = NAMES.indexOf(l.feature.properties.name);
        l.setStyle({
          color: j === i ? '#e8a33d' : 'rgba(255,255,255,.55)',
          weight: j === i ? 2.4 : 0.8,
          fill: j === i, fillColor: '#e8a33d', fillOpacity: j === i ? 0.14 : 0
        });
      });
    });
    document.getElementById('cmp-a').value = String(i);
    document.getElementById('cmp-b').value = String(state.peer);
    render();
  }

  function stat(name) { return B.stats.find(s => s.n === name) || B.stats[0]; }
  function comp(name) {
    const a = window.REL && window.REL.analyze ? window.REL.analyze() : null;
    return a ? a.comp.find(c => c.name === name) : null;
  }

  function render() {
    const A = stat(NAMES[state.sel]), P = stat(NAMES[state.peer]);
    const ca = comp(A.n), cp = comp(P.n);
    const fmt = (v, d = 2) => v.toFixed(d);
    const d = (x, y, dec = 2) => (x - y >= 0 ? '+' : '') + (x - y).toFixed(dec);

    document.getElementById('cmp-head').textContent =
      A.n + ' vs ' + P.n;

    const rows = [
      ['Mean NDVI', fmt(A.ndvi, 3), fmt(P.ndvi, 3), d(A.ndvi, P.ndvi, 3)],
      ['Mean LST', fmt(A.lst) + ' \u00B0C', fmt(P.lst) + ' \u00B0C', d(A.lst, P.lst) + ' \u00B0C'],
      ['NDVI p10 \u2013 p90', fmt(A.ndvi_p10, 3) + ' \u2013 ' + fmt(A.ndvi_p90, 3),
       fmt(P.ndvi_p10, 3) + ' \u2013 ' + fmt(P.ndvi_p90, 3), ''],
      ['LST p10 \u2013 p90', fmt(A.lst_p10, 1) + ' \u2013 ' + fmt(A.lst_p90, 1),
       fmt(P.lst_p10, 1) + ' \u2013 ' + fmt(P.lst_p90, 1), ''],
      ['Cells', A.cells.toLocaleString(), P.cells.toLocaleString(), '']
    ];
    if (ca && cp) {
      ['Low', 'Moderate', 'High'].forEach((lab, k) => {
        rows.push([lab + ' vegetation',
          (ca.share[k] * 100).toFixed(1) + '%',
          (cp.share[k] * 100).toFixed(1) + '%',
          d(ca.share[k] * 100, cp.share[k] * 100, 1) + ' pp']);
      });
    }

    document.getElementById('cmp-body').innerHTML = rows.map(r =>
      '<tr><td>' + r[0] + '</td><td class="num">' + r[1] + '</td><td class="num">' + r[2] +
      '<td class="num delta">' + r[3] + '</td></tr>').join('');

    // a plain-language line under the table
    const gap = A.lst - P.lst;
    const veg = A.ndvi - P.ndvi;
    const agree = (gap < 0 && veg > 0) || (gap > 0 && veg < 0);
    document.getElementById('cmp-note').innerHTML =
      A.n + ' is ' + Math.abs(gap).toFixed(2) + ' \u00B0C ' + (gap < 0 ? 'cooler' : 'hotter') +
      ' than ' + P.n + ' and has ' + (Math.abs(veg) < 0.005 ? 'about the same' :
        Math.abs(veg).toFixed(3) + ' ' + (veg > 0 ? 'more' : 'less')) + ' mean NDVI. ' +
      (Math.abs(gap) < 0.05 || Math.abs(veg) < 0.005 ? '' :
        agree ? 'That is the direction the relationship predicts.'
              : 'That runs against the relationship \u2014 worth a look at the residual layer.');
  }

  function setLayer(which, key) {
    state[which] = key;
    if (!ready) return;
    sides[which].ov.setUrl(tileFor(key));
    document.querySelectorAll('[data-cmp="' + which + '"] button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.key === key)));
  }

  function renderSelects() {
    const opts = NAMES.map((n, i) => '<option value="' + i + '">' + n + '</option>').join('');
    const a = document.getElementById('cmp-a'), b = document.getElementById('cmp-b');
    a.innerHTML = opts; b.innerHTML = opts;
    a.addEventListener('change', () => { state.sel = +a.value; select(state.sel); });
    b.addEventListener('change', () => { state.peer = +b.value; render(); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderSelects();
    document.querySelectorAll('[data-cmp] button').forEach(btn => {
      btn.addEventListener('click', () => setLayer(btn.parentElement.dataset.cmp, btn.dataset.key));
    });
    // deep link (?tab=compare) fires before this file loads
    const v = document.getElementById('view-compare');
    if (v && v.classList.contains('is-active')) setTimeout(init, 0);
  });

  window.CMP = { init, select, render, state };
})();
