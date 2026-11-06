"use strict";

/* ============================================================
   analysis.js — vegetation classes, hypothesis tests and the
   relationship view. Depends only on window.SAFENET (data.js)
   and a few helpers exposed by app.js on window.UI.
   ============================================================ */

(function () {
  const B = window.SAFENET;
  const UI = window.UI || {};
  const themeVar = UI.themeVar || (n => getComputedStyle(document.documentElement).getPropertyValue(n).trim());
  const fitCanvas = UI.fitCanvas;

  const GW = B.grid.nx, GH = B.grid.ny;
  const NAMES = B.names;
  const CUTS = B.classes.cuts;            // [0.10, 0.20]
  const LABELS = B.classes.labels;        // Low, Moderate, High
  const COLORS = B.classes.colors;

  /* ---------------- distributions (no scipy in the browser either) ---------------- */
  function betacf(a, b, x) {
    const MAXIT = 300, EPS = 3e-16, FPMIN = 1e-300;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lbt = Math.log(Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b)));
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }
  // Lanczos log-gamma
  const LANCZOS = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  function lgamma(z) {
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1;
    let x = 0.99999999999980993;
    for (let i = 0; i < LANCZOS.length; i++) x += LANCZOS[i] / (z + i + 1);
    const t = z + LANCZOS.length - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  const tSF2 = (t, df) => df <= 0 ? NaN : betai(df / 2, 0.5, df / (df + t * t));
  const fSF = (F, d1, d2) => F <= 0 ? 1 : betai(d2 / 2, d1 / 2, d2 / (d2 + d1 * F));

  function gammaincc(a, x) {
    if (x < 0 || a <= 0) return NaN;
    if (x === 0) return 1;
    const gln = lgamma(a);
    if (x < a + 1) {
      let ap = a, sum = 1 / a, del = sum;
      for (let i = 0; i < 500; i++) {
        ap += 1; del *= x / ap; sum += del;
        if (Math.abs(del) < Math.abs(sum) * 3e-16) break;
      }
      return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
    }
    let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - a);
      b += 2; d = an * d + b;
      if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c;
      if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < 3e-16) break;
    }
    return Math.exp(-x + a * Math.log(x) - gln) * h;
  }
  const chi2SF = (x, df) => gammaincc(df / 2, x / 2);

  /* ---------------- decode the grid once ---------------- */
  function u8(s) { const bin = atob(s), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  const deq = (q, s) => s.min + (q - 1) / 254 * (s.max - s.min);

  const QN = u8(B.ndvi), QL = u8(B.lst), QB = u8(B.bgy);
  const NDVI = new Float32Array(GW * GH), LST = new Float32Array(GW * GH);
  const CLS = new Int8Array(GW * GH).fill(-1), SITE = new Int16Array(GW * GH);
  const VALID = new Uint8Array(GW * GH);

  for (let i = 0; i < GW * GH; i++) {
    const s = QB[i];
    SITE[i] = s < 255 ? s : -1;
    if (QN[i] > 0 && QL[i] > 0 && s < 255) {
      NDVI[i] = deq(QN[i], B.scales.ndvi);
      LST[i] = deq(QL[i], B.scales.lst);
      VALID[i] = 1;
      CLS[i] = NDVI[i] < CUTS[0] ? 0 : NDVI[i] < CUTS[1] ? 1 : 2;
    } else { NDVI[i] = NaN; LST[i] = NaN; }
  }

  /* ---------------- the analysis ---------------- */
  let A = null;

  function analyze() {
    if (A) return A;
    const n = VALID.reduce((a, b) => a + b, 0);

    // Pearson / OLS in one pass
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < GW * GH; i++) {
      if (!VALID[i]) continue;
      sx += NDVI[i]; sy += LST[i];
      sxx += NDVI[i] * NDVI[i]; syy += LST[i] * LST[i]; sxy += NDVI[i] * LST[i];
    }
    const mx = sx / n, my = sy / n;
    const cxx = sxx - n * mx * mx, cyy = syy - n * my * my, cxy = sxy - n * mx * my;
    const r = cxy / Math.sqrt(cxx * cyy);
    const slope = cxy / cxx, intercept = my - slope * mx;
    const tR = r * Math.sqrt((n - 2) / (1 - r * r));
    const pR = tSF2(Math.abs(tR), n - 2);

    // residual variance and slope CI
    let ssr = 0;
    for (let i = 0; i < GW * GH; i++) {
      if (!VALID[i]) continue;
      const e = LST[i] - (intercept + slope * NDVI[i]);
      ssr += e * e;
    }
    const seSlope = Math.sqrt((ssr / (n - 2)) / cxx);
    const slopeLo = slope - 1.96 * seSlope, slopeHi = slope + 1.96 * seSlope;
    const pSlope = tSF2(Math.abs(slope / seSlope), n - 2);

    // classes
    const groups = [[], [], []];
    for (let i = 0; i < GW * GH; i++) if (VALID[i]) groups[CLS[i]].push(LST[i]);

    const stats = groups.map((g, k) => {
      const m = g.reduce((a, b) => a + b, 0) / g.length;
      const v = g.reduce((a, b) => a + (b - m) * (b - m), 0) / (g.length - 1);
      const se = Math.sqrt(v / g.length);
      const sorted = Float64Array.from(g).sort();
      const q = p => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
      return {
        k, label: LABELS[k], n: g.length, share: g.length / n,
        mean: m, sd: Math.sqrt(v), se, lo: m - 1.96 * se, hi: m + 1.96 * se,
        min: sorted[0], p10: q(0.10), q1: q(0.25), median: q(0.50), q3: q(0.75),
        p90: q(0.90), max: sorted[sorted.length - 1],
        range: k === 0 ? '< ' + CUTS[0].toFixed(2)
             : k === 1 ? CUTS[0].toFixed(2) + '\u2013' + CUTS[1].toFixed(2)
             : '\u2265 ' + CUTS[1].toFixed(2)
      };
    });

    // one-way ANOVA
    let ssb = 0, ssw = 0;
    stats.forEach(s => {
      ssb += s.n * (s.mean - my) * (s.mean - my);
      ssw += (s.n - 1) * s.sd * s.sd;
    });
    const d1 = 2, d2 = n - 3;
    const F = (ssb / d1) / (ssw / d2);
    const pF = fSF(F, d1, d2);
    const eta2 = ssb / (ssb + ssw);

    // Kruskal-Wallis on the same cells
    const order = [];
    for (let i = 0; i < GW * GH; i++) if (VALID[i]) order.push(i);
    order.sort((a, b) => LST[a] - LST[b]);
    const rank = new Float64Array(GW * GH);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && LST[order[j + 1]] === LST[order[i]]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) rank[order[k]] = avg;
      i = j + 1;
    }
    const rsum = [0, 0, 0];
    for (let i = 0; i < GW * GH; i++) if (VALID[i]) rsum[CLS[i]] += rank[i];
    let H = 0;
    for (let k = 0; k < 3; k++) H += rsum[k] * rsum[k] / stats[k].n;
    H = 12 / (n * (n + 1)) * H - 3 * (n + 1);
    const pKW = chi2SF(H, 2);

    // pairwise Welch with Bonferroni
    const pairs = [];
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      const A1 = stats[a], B1 = stats[b];
      const va = A1.sd * A1.sd / A1.n, vb = B1.sd * B1.sd / B1.n;
      const se = Math.sqrt(va + vb);
      const t = (A1.mean - B1.mean) / se;
      const df = (va + vb) ** 2 / (va * va / (A1.n - 1) + vb * vb / (B1.n - 1));
      const p = tSF2(Math.abs(t), df);
      pairs.push({ a: A1.label, b: B1.label, diff: A1.mean - B1.mean, t, df, p, padj: Math.min(1, p * 3) });
    }

    // sensitivity: tercile cuts instead of fixed thresholds
    const sortedN = Float64Array.from(NDVI).filter((v, i) => VALID[i]).sort();
    const c1 = sortedN[Math.floor(n / 3)], c2 = sortedN[Math.floor(2 * n / 3)];
    const terc = [[], [], []];
    for (let i = 0; i < GW * GH; i++) {
      if (!VALID[i]) continue;
      terc[NDVI[i] < c1 ? 0 : NDVI[i] < c2 ? 1 : 2].push(LST[i]);
    }
    const tercMeans = terc.map(g => g.reduce((a, b) => a + b, 0) / g.length);

    // per-barangay class composition
    const comp = NAMES.map((name, i) => {
      const c = [0, 0, 0];
      let tot = 0;
      for (let j = 0; j < GW * GH; j++) if (VALID[j] && SITE[j] === i) { c[CLS[j]]++; tot++; }
      return { name, c, tot, share: c.map(v => tot ? v / tot : 0) };
    });

    A = {
      n, r, r2: r * r, pR, tR, slope, intercept, seSlope, slopeLo, slopeHi, pSlope,
      meanN: mx, meanL: my, stats, anova: { F, d1, d2, p: pF, eta2 },
      kw: { H, p: pKW }, pairs, terc: { c1, c2, means: tercMeans },
      comp, ssr
    };
    return A;
  }

  /* ---------------- formatting ---------------- */
  const pfmt = p => p < 0.001 ? '< 0.001' : p.toFixed(3);
  const num = (v, d = 2) => v.toFixed(d);
  const signed = (v, d = 2) => (v >= 0 ? '+' : '') + v.toFixed(d);

  /* ---------------- charts ---------------- */
  function drawScatter(cv) {
    const a = analyze();
    const { c, w, h } = fitCanvas(cv, 300);
    const pad = { l: 40, r: 10, t: 10, b: 40 };
    const xmin = 0, xmax = B.scales.ndvi.max, ymin = B.scales.lst.min, ymax = B.scales.lst.max;
    const X = v => pad.l + (v - xmin) / (xmax - xmin) * (w - pad.l - pad.r);
    const Y = v => h - pad.b - (v - ymin) / (ymax - ymin) * (h - pad.t - pad.b);

    c.clearRect(0, 0, w, h);
    c.strokeStyle = themeVar('--line'); c.lineWidth = 1;
    c.fillStyle = themeVar('--text-3');
    c.font = '10px "Geist Mono", monospace';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + i * (h - pad.t - pad.b) / 4;
      c.beginPath(); c.moveTo(pad.l, y + .5); c.lineTo(w - pad.r, y + .5); c.stroke();
      c.textAlign = 'right';
      c.fillText((ymax - i * (ymax - ymin) / 4).toFixed(1), pad.l - 5, y + 3);
    }
    c.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const v = xmin + i * (xmax - xmin) / 4;
      c.fillText(v.toFixed(2), X(v), h - 22);
    }
    c.textAlign = 'left';
    c.fillText('LST \u00B0C', pad.l, pad.t + 2);
    c.textAlign = 'center';
    c.fillText('NDVI', (pad.l + w - pad.r) / 2, h - 5);

    const light = document.documentElement.getAttribute('data-theme') === 'light';
    for (let i = 0; i < GW * GH; i += 2) {
      if (!VALID[i]) continue;
      const col = COLORS[CLS[i]];
      c.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${light ? .55 : .5})`;
      c.fillRect(X(NDVI[i]), Y(LST[i]), 1.7, 1.7);
    }

    // regression line
    c.strokeStyle = themeVar('--accent'); c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(X(xmin), Y(Math.min(ymax, Math.max(ymin, a.intercept + a.slope * xmin))));
    c.lineTo(X(xmax), Y(Math.min(ymax, Math.max(ymin, a.intercept + a.slope * xmax))));
    c.stroke();

    // class means
    a.stats.forEach(s => {
      const cx = s.k === 0 ? CUTS[0] / 2 : s.k === 1 ? (CUTS[0] + CUTS[1]) / 2 : (CUTS[1] + xmax) / 2;
      const col = COLORS[s.k];
      c.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      c.strokeStyle = themeVar('--text'); c.lineWidth = 1.4;
      c.beginPath(); c.arc(X(cx), Y(s.mean), 4.5, 0, 7); c.fill(); c.stroke();
    });

  }

  function drawBars(cv) {
    const a = analyze();
    const { c, w, h } = fitCanvas(cv, 300);
    const pad = { l: 46, r: 12, t: 16, b: 30 };
    const vals = a.stats.map(s => s.mean);
    const lo = Math.min(...a.stats.map(s => s.lo)) - 0.4;
    const hi = Math.max(...a.stats.map(s => s.hi)) + 0.4;
    const Y = v => h - pad.b - (v - lo) / (hi - lo) * (h - pad.t - pad.b);

    c.clearRect(0, 0, w, h);
    c.strokeStyle = themeVar('--line'); c.fillStyle = themeVar('--text-3');
    c.font = '10px "Geist Mono", monospace';
    for (let i = 0; i <= 4; i++) {
      const v = lo + i * (hi - lo) / 4;
      const y = Y(v);
      c.beginPath(); c.moveTo(pad.l, y + .5); c.lineTo(w - pad.r, y + .5); c.stroke();
      c.textAlign = 'right'; c.fillText(v.toFixed(1), pad.l - 5, y + 3);
    }
    c.textAlign = 'left'; c.fillText('LST \u00B0C', pad.l, pad.t - 4);

    const bw = (w - pad.l - pad.r) / 3;
    a.stats.forEach((s, i) => {
      const cx = pad.l + bw * (i + 0.5);
      const col = COLORS[i];
      const top = Y(s.hi), bot = Y(s.lo);
      c.strokeStyle = themeVar('--text-2'); c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(cx, top); c.lineTo(cx, bot); c.stroke();
      c.beginPath(); c.moveTo(cx - 7, top); c.lineTo(cx + 7, top);
      c.moveTo(cx - 7, bot); c.lineTo(cx + 7, bot); c.stroke();

      const barW = bw * 0.46;
      c.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      c.fillRect(cx - barW / 2, Y(s.mean), barW, h - pad.b - Y(s.mean));
      c.fillStyle = themeVar('--text');
      c.textAlign = 'center'; c.font = '10px "Geist Mono", monospace';
      c.fillText(s.mean.toFixed(2), cx, Y(s.mean) - 6);
      c.font = '10px "Geist Mono", monospace'; c.fillStyle = themeVar('--text-3');
      c.fillText(s.label, cx, h - 12);
      c.fillText('n=' + s.n.toLocaleString(), cx, h - 2);
    });
  }

  function drawBox(cv) {
    const a = analyze();
    const { c, w, h } = fitCanvas(cv, 300);
    const pad = { l: 46, r: 12, t: 14, b: 30 };
    const lo = Math.min(...a.stats.map(s => s.p10)) - 0.3;
    const hi = Math.max(...a.stats.map(s => s.p90)) + 0.3;
    const Y = v => h - pad.b - (v - lo) / (hi - lo) * (h - pad.t - pad.b);

    c.clearRect(0, 0, w, h);
    c.strokeStyle = themeVar('--line'); c.fillStyle = themeVar('--text-3');
    c.font = '10px "Geist Mono", monospace';
    for (let i = 0; i <= 4; i++) {
      const v = lo + i * (hi - lo) / 4, y = Y(v);
      c.beginPath(); c.moveTo(pad.l, y + .5); c.lineTo(w - pad.r, y + .5); c.stroke();
      c.textAlign = 'right'; c.fillText(v.toFixed(1), pad.l - 5, y + 3);
    }
    c.textAlign = 'left'; c.fillText('LST \u00B0C', pad.l, pad.t - 3);

    const bw = (w - pad.l - pad.r) / 3;
    a.stats.forEach((s, i) => {
      const cx = pad.l + bw * (i + 0.5), boxW = bw * 0.42;
      const col = COLORS[i];
      c.strokeStyle = themeVar('--text-2'); c.lineWidth = 1;
      // whiskers to p10/p90
      c.beginPath(); c.moveTo(cx, Y(s.p90)); c.lineTo(cx, Y(s.q3)); c.stroke();
      c.beginPath(); c.moveTo(cx, Y(s.q1)); c.lineTo(cx, Y(s.p10)); c.stroke();
      c.beginPath(); c.moveTo(cx - 6, Y(s.p90)); c.lineTo(cx + 6, Y(s.p90));
      c.moveTo(cx - 6, Y(s.p10)); c.lineTo(cx + 6, Y(s.p10)); c.stroke();
      // box
      c.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},.55)`;
      c.fillRect(cx - boxW / 2, Y(s.q3), boxW, Y(s.q1) - Y(s.q3));
      c.strokeStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      c.strokeRect(cx - boxW / 2, Y(s.q3), boxW, Y(s.q1) - Y(s.q3));
      // median
      c.strokeStyle = themeVar('--text'); c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(cx - boxW / 2, Y(s.median)); c.lineTo(cx + boxW / 2, Y(s.median)); c.stroke();
      // mean
      c.fillStyle = themeVar('--accent');
      c.beginPath(); c.arc(cx, Y(s.mean), 2.6, 0, 7); c.fill();
      c.fillStyle = themeVar('--text-2');
      c.beginPath(); c.arc(cx, Y(s.p90), 2.1, 0, 7); c.fill();
      c.beginPath(); c.arc(cx, Y(s.p10), 2.1, 0, 7); c.fill();
      c.fillStyle = themeVar('--text-3');
      c.font = '10px "Geist Mono", monospace'; c.textAlign = 'center';
      c.fillText(s.label, cx, h - 12);
    });
  }

  function drawStack(cv) {
    const a = analyze();
    const { c, w, h } = fitCanvas(cv, 300);
    const rows = a.comp.filter(r => r.tot > 0).sort((x, y) => x.share[0] - y.share[0]);
    const pad = { l: 96, r: 40, t: 14, b: 14 };
    const rowH = (h - pad.t - pad.b) / rows.length;
    c.clearRect(0, 0, w, h);
    c.font = '10px "Geist Mono", monospace';
    c.fillStyle = themeVar('--text-3'); c.textAlign = 'left';
    c.fillText('% High', w - pad.r + 6, pad.t + 2);
    const barW0 = w - pad.l - pad.r;
    c.strokeStyle = themeVar('--line'); c.lineWidth = 1;
    c.beginPath(); c.moveTo(pad.l, h - 4.5); c.lineTo(pad.l + barW0, h - 4.5); c.stroke();
    c.textAlign = 'center';
    [0, 0.5, 1].forEach(f => c.fillText(Math.round(f * 100) + '%', pad.l + f * barW0, h - 8));
    rows.forEach((r, i) => {
      const y = pad.t + i * rowH;
      let x = pad.l;
      const barW = w - pad.l - pad.r;
      for (let k = 0; k < 3; k++) {
        const seg = r.share[k] * barW;
        const col = COLORS[k];
        c.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        c.fillRect(x, y + rowH * 0.14, Math.max(0, seg - 0.6), rowH * 0.72);
        x += seg;
      }
      c.fillStyle = themeVar('--text-2'); c.textAlign = 'right';
      c.fillText(r.name.length > 15 ? r.name.slice(0, 14) + '\u2026' : r.name, pad.l - 6, y + rowH * 0.62);
      c.fillStyle = themeVar('--text-3'); c.textAlign = 'left';
      c.fillText(Math.round(r.share[2] * 100) + '%', w - pad.r + 6, y + rowH * 0.62);
    });
  }

  /* ---------------- the view ---------------- */
  function render() {
    const a = analyze();

    document.getElementById('verdict-text').textContent =
      'Cells in High vegetation are ' + (a.stats[0].mean - a.stats[2].mean).toFixed(2) +
      ' \u00B0C cooler than cells in Low vegetation (' + a.stats[2].mean.toFixed(2) + ' \u00B0C vs ' +
      a.stats[0].mean.toFixed(2) + ' \u00B0C). Higher vegetation goes with lower surface temperature.';

    document.getElementById('verdict-sub').textContent =
      'r = ' + a.r.toFixed(3) + ' (p ' + pfmt(a.pR) + '), slope ' + (a.slope * 0.1).toFixed(2) +
      ' \u00B0C per 0.1 NDVI, one-way ANOVA F(' + a.anova.d1 + ', ' + a.anova.d2 + ') = ' +
      Math.round(a.anova.F).toLocaleString() + ', p ' + pfmt(a.anova.p) +
      ', \u03B7\u00B2 = ' + a.anova.eta2.toFixed(3) + ' \u2014 ' +
      Math.round(a.anova.eta2 * 100) + '% of the LST variation is between classes, the rest is within them.';

    document.getElementById('rel-n').textContent = 'n = ' + a.n.toLocaleString() + ' cells';

    document.getElementById('rel-classes').innerHTML = a.stats.map(s =>
      '<tr><td><span class="swatch" style="background:rgb(' + COLORS[s.k].join(',') + ')"></span>' + s.label + '</td>' +
      '<td class="num">' + s.range + '</td>' +
      '<td class="num">' + s.n.toLocaleString() + '</td>' +
      '<td class="num">' + (s.share * 100).toFixed(1) + '%</td>' +
      '<td class="num">' + s.mean.toFixed(2) + ' \u00B0C</td>' +
      '<td class="num">' + s.lo.toFixed(2) + ' \u2013 ' + s.hi.toFixed(2) + '</td>' +
      '<td class="num">' + signed(s.mean - a.meanL) + ' \u00B0C</td></tr>'
    ).join('');

    const dir = a.r < 0 ? 'negative' : 'positive';
    document.getElementById('rel-tests').innerHTML =
      '<tr><td>Pearson correlation</td><td class="num">r = ' + a.r.toFixed(3) + '</td>' +
      '<td class="num">' + pfmt(a.pR) + '</td><td>' + dir.charAt(0).toUpperCase() + dir.slice(1) +
      ' association between NDVI and LST</td></tr>' +
      '<tr><td>OLS regression</td><td class="num">' + (a.slope * 0.1).toFixed(2) +
      ' \u00B0C / 0.1 NDVI<br><span style="color:var(--text-3)">95% CI ' +
      (a.slopeLo * 0.1).toFixed(2) + ' to ' + (a.slopeHi * 0.1).toFixed(2) + '</span></td>' +
      '<td class="num">' + pfmt(a.pSlope) + '</td><td>Slope is the cooling per 0.1 NDVI</td></tr>' +
      '<tr><td>Coefficient of determination</td><td class="num">R\u00B2 = ' + a.r2.toFixed(3) + '</td>' +
      '<td class="num">\u2014</td><td>NDVI explains ' + Math.round(a.r2 * 100) +
      '% of LST variance</td></tr>' +
      '<tr><td>One-way ANOVA</td><td class="num">F = ' + Math.round(a.anova.F).toLocaleString() + '</td>' +
      '<td class="num">' + pfmt(a.anova.p) + '</td><td>Class means differ; \u03B7\u00B2 = ' +
      a.anova.eta2.toFixed(3) + '</td></tr>' +
      '<tr><td>Kruskal&ndash;Wallis</td><td class="num">H = ' + Math.round(a.kw.H).toLocaleString() + '</td>' +
      '<td class="num">' + pfmt(a.kw.p) + '</td><td>Same conclusion without assuming normality</td></tr>';

    document.getElementById('rel-pairs').innerHTML = a.pairs.map(p =>
      '<tr><td>' + p.a + ' vs ' + p.b + '</td>' +
      '<td class="num">' + signed(p.diff) + ' \u00B0C</td>' +
      '<td class="num">' + p.t.toFixed(1) + '</td>' +
      '<td class="num">' + pfmt(p.p) + '</td>' +
      '<td class="num">' + pfmt(p.padj) + '</td>' +
      '<td>' + (p.padj < 0.05 ? '<span class="sig">yes</span>' : '<span class="ns">no</span>') + '</td></tr>'
    ).join('');

    document.getElementById('rel-sens').innerHTML =
      '<b>Sensitivity to the class cuts.</b> The thresholds above (0.10 / 0.20) are fixed, not fitted ' +
      'to this dataset. Splitting the same cells into equal thirds instead ' +
      '(cut points ' + a.terc.c1.toFixed(3) + ' and ' + a.terc.c2.toFixed(3) + ') gives class means of ' +
      a.terc.means.map(v => v.toFixed(2)).join(', ') + ' \u00B0C \u2014 the same ordering and nearly the ' +
      'same gap, so the conclusion does not depend on where the lines were drawn.';

    document.getElementById('rel-built').textContent =
      'built ' + B.asof.built + ' \u00B7 newest scene ' + B.asof.s2_last;

    const leg = a.stats.map(s =>
      '<span><i style="background:rgb(' + COLORS[s.k].join(',') + ')"></i>' + s.label + '</span>').join('');
    document.getElementById('cleg-scatter').innerHTML = leg +
      '<span><i style="background:var(--accent);height:2px;border-radius:0"></i>OLS fit</span>';
    document.getElementById('cleg-stack').innerHTML = leg;

    drawScatter(document.getElementById('c-rel-scatter'));
    drawBars(document.getElementById('c-rel-bar'));
    drawBox(document.getElementById('c-rel-box'));
    drawStack(document.getElementById('c-rel-stack'));
  }

  /* ---------------- report ---------------- */
  function reportHTML() {
    const a = analyze();
    const img = id => {
      const cv = document.getElementById(id);
      return cv ? cv.toDataURL('image/png') : '';
    };
    const when = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    const role = (window.AUTH && window.AUTH.current && window.AUTH.current.role) || 'viewer';

    const rows = a.stats.map(s =>
      `<tr><td>${s.label}</td><td>${s.range}</td><td class="n">${s.n.toLocaleString()}</td>
       <td class="n">${(s.share * 100).toFixed(1)}%</td><td class="n">${s.mean.toFixed(2)}</td>
       <td class="n">${s.lo.toFixed(2)} – ${s.hi.toFixed(2)}</td>
       <td class="n">${signed(s.mean - a.meanL)}</td></tr>`).join('');

    const pairs = a.pairs.map(p =>
      `<tr><td>${p.a} vs ${p.b}</td><td class="n">${signed(p.diff)} °C</td>
       <td class="n">${p.t.toFixed(1)}</td><td class="n">${pfmt(p.p)}</td>
       <td class="n">${pfmt(p.padj)}</td><td>${p.padj < 0.05 ? 'yes' : 'no'}</td></tr>`).join('');

    const brgy = a.comp.map(r =>
      `<tr><td>${r.name}</td><td class="n">${r.tot.toLocaleString()}</td>
       <td class="n">${(r.share[0] * 100).toFixed(1)}%</td>
       <td class="n">${(r.share[1] * 100).toFixed(1)}%</td>
       <td class="n">${(r.share[2] * 100).toFixed(1)}%</td></tr>`).join('');

    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Vegetation and surface temperature — Quezon City 2026</title>
<style>
 body{font:13px/1.6 Georgia,serif;color:#1b1b1b;max-width:900px;margin:44px auto;padding:0 26px}
 h1{font-size:23px;margin:0 0 4px;letter-spacing:-.01em}
 h2{font-size:14px;margin:30px 0 8px;text-transform:uppercase;letter-spacing:.1em;color:#555}
 .meta{font:11px/1.7 ui-monospace,monospace;color:#666;border-bottom:1px solid #ddd;padding-bottom:12px}
 .lede{font-size:15px;margin:18px 0;padding:14px 16px;border-left:3px solid #b4761f;background:#faf7f2}
 table{width:100%;border-collapse:collapse;margin:10px 0 18px;font-size:12px}
 th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#666;
    border-bottom:1px solid #bbb;padding:0 8px 5px 0}
 td{padding:5px 8px 5px 0;border-bottom:1px solid #eee}
 td.n{font-family:ui-monospace,monospace}
 figure{margin:14px 0 20px}img{width:100%;border:1px solid #ddd}
 figcaption{font-size:11px;color:#666;margin-top:5px}
 footer{margin-top:34px;border-top:1px solid #ddd;padding-top:10px;font:11px/1.6 ui-monospace,monospace;color:#777}
</style></head><body>
<h1>Urban vegetation and land surface temperature</h1>
<div class="meta">Quezon City · 142 barangays · 2026 median composite<br>
Generated ${when} · role ${role} · built ${B.asof.built} · newest scene ${B.asof.s2_last} (Sentinel-2), ${B.asof.ls_last} (Landsat)</div>

<div class="lede"><b>Result.</b> Cells in High vegetation are
${(a.stats[0].mean - a.stats[2].mean).toFixed(2)} °C cooler than cells in Low vegetation
(${a.stats[2].mean.toFixed(2)} °C vs ${a.stats[0].mean.toFixed(2)} °C). Pearson r = ${a.r.toFixed(3)}
(p ${pfmt(a.pR)}); one-way ANOVA F(${a.anova.d1}, ${a.anova.d2}) = ${Math.round(a.anova.F).toLocaleString()},
p ${pfmt(a.anova.p)}, η² = ${a.anova.eta2.toFixed(3)}.</div>

<h2>Method</h2>
<p>Sentinel-2 L2A surface reflectance (16 scenes, 2026) and Landsat 8/9 Collection 2 Level 2 surface
temperature (16 scenes, 2026), cloud masked before compositing with SCL and QA_PIXEL, median composited
per sensor, resampled to a 40 m analysis grid. NDVI is binned into Low (&lt; 0.10), Moderate (0.10–0.20)
and High (≥ 0.20). Surface temperature is compared across classes with Pearson correlation, ordinary
least squares, one-way ANOVA, Kruskal–Wallis and pairwise Welch tests (Bonferroni-adjusted). All
statistics are computed on ${a.n.toLocaleString()} valid cells where both sensors report a value.</p>

<h2>Class summary</h2>
<table><thead><tr><th>Class</th><th>NDVI</th><th>Cells</th><th>Share</th><th>Mean LST °C</th>
<th>95% CI</th><th>vs area</th></tr></thead><tbody>${rows}</tbody></table>

<h2>Statistical tests</h2>
<table><thead><tr><th>Test</th><th>Value</th><th>p</th></tr></thead><tbody>
<tr><td>Pearson correlation</td><td class="n">r = ${a.r.toFixed(3)}</td><td class="n">${pfmt(a.pR)}</td></tr>
<tr><td>Coefficient of determination</td><td class="n">R² = ${a.r2.toFixed(3)}</td><td class="n">—</td></tr>
<tr><td>OLS slope</td><td class="n">${(a.slope * 0.1).toFixed(2)} °C per 0.1 NDVI (95% CI ${(a.slopeLo * 0.1).toFixed(2)} to ${(a.slopeHi * 0.1).toFixed(2)})</td><td class="n">${pfmt(a.pSlope)}</td></tr>
<tr><td>One-way ANOVA</td><td class="n">F(${a.anova.d1}, ${a.anova.d2}) = ${Math.round(a.anova.F).toLocaleString()}, η² = ${a.anova.eta2.toFixed(3)}</td><td class="n">${pfmt(a.anova.p)}</td></tr>
<tr><td>Kruskal–Wallis</td><td class="n">H = ${Math.round(a.kw.H).toLocaleString()}</td><td class="n">${pfmt(a.kw.p)}</td></tr>
</tbody></table>

<h2>Pairwise comparison</h2>
<table><thead><tr><th>Comparison</th><th>Difference</th><th>Welch t</th><th>p</th><th>p adj.</th><th>Significant</th></tr></thead>
<tbody>${pairs}</tbody></table>

<h2>Figures</h2>
<figure><img src="${img('c-rel-scatter')}" alt="scatter"><figcaption>NDVI against LST, coloured by vegetation class, with the least-squares fit.</figcaption></figure>
<figure><img src="${img('c-rel-bar')}" alt="bars"><figcaption>Mean LST per class with 95% confidence intervals.</figcaption></figure>
<figure><img src="${img('c-rel-box')}" alt="box"><figcaption>Distribution of LST within each class.</figcaption></figure>
<figure><img src="${img('c-rel-stack')}" alt="composition"><figcaption>Vegetation-class composition per barangay.</figcaption></figure>

<h2>Per-barangay composition</h2>
<table><thead><tr><th>Barangay</th><th>Cells</th><th>Low</th><th>Moderate</th><th>High</th></tr></thead>
<tbody>${brgy}</tbody></table>

<h2>Limitations</h2>
<p>Single epoch: this is a cross-sectional comparison, not a change over time. LST is a surface
radiometric quantity measured at about 10:15 local, not air temperature, and twelve of sixteen Landsat
dates fall in the dry season. Landsat thermal is natively 100 m, so per-barangay thermal means inherit
that support. A significant class difference is an association, not a demonstrated causal cooling effect.
NDVI explains ${Math.round(a.r2 * 100)}% of LST variance; albedo, imperviousness and building density
carry the remainder.</p>

<footer>GreenSpace–LST · Quezon City 2026 · report generated from the measured composite.
Boundaries: OpenStreetMap admin_level=10, ODbL. Imagery: Copernicus Sentinel-2, USGS Landsat.</footer>
</body></html>`;
  }

  function downloadReport() {
    const html = reportHTML();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'greenspace-lst-report-' + B.asof.built + '.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function printReport() {
    const w = window.open('', '_blank');
    if (!w) { downloadReport(); return; }
    w.document.open();
    w.document.write(reportHTML());
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 400);
  }

  /* deep link (?tab=relationship) runs before this file loads: catch up */
  const rv = document.getElementById('view-relationship');
  if (rv && rv.classList.contains('is-active')) { try { render(); } catch (e) { console.error(e); } }

  window.REL = { analyze, render, reportHTML, downloadReport, printReport, NDVI, LST, CLS, VALID, SITE, CUTS, LABELS, COLORS };
})();
