"use strict";
/* stats.js — the analysis, in Node. Same maths as analysis.js and
   the Python reference (scratch/stats_ref.py); no DOM, no browser. */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

function load() {
  const src = fs.readFileSync(path.join(ROOT, "data.js"), "utf8");
  const m = src.match(/window\.SAFENET\s*=\s*(\{[\s\S]*\});\s*$/);
  if (!m) throw new Error("data.js does not contain a window.SAFENET payload");
  const B = JSON.parse(m[1]);
  const dec = s => Buffer.from(s, "base64");
  const q = {
    ndvi: dec(B.ndvi), lst: dec(B.lst), bgy: dec(B.bgy)
  };
  return { B, q };
}

/* ---- distributions ---- */
function lgamma(z) {
  const L = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < L.length; i++) x += L[i] / (z + i + 1);
  const t = z + L.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
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
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
  return 1 - bt * betacf(b, a, 1 - x) / b;
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

let CACHE = null;

function analyze() {
  if (CACHE) return CACHE;
  const { B, q } = load();
  const G = B.grid, N = G.nx * G.ny;
  const S = B.scales, CUTS = B.classes.cuts, LABELS = B.classes.labels;
  const deq = (v, s) => s.min + (v - 1) / 254 * (s.max - s.min);

  const ndvi = new Float64Array(N), lst = new Float64Array(N);
  const cls = new Int8Array(N).fill(-1), site = new Int16Array(N).fill(-1);
  let n = 0;
  for (let i = 0; i < N; i++) {
    const b = q.bgy[i];
    site[i] = b < 255 ? b : -1;
    if (q.ndvi[i] > 0 && q.lst[i] > 0 && b < 255) {
      ndvi[i] = deq(q.ndvi[i], S.ndvi);
      lst[i] = deq(q.lst[i], S.lst);
      cls[i] = ndvi[i] < CUTS[0] ? 0 : ndvi[i] < CUTS[1] ? 1 : 2;
      n++;
    }
  }

  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < N; i++) {
    if (cls[i] < 0) continue;
    sx += ndvi[i]; sy += lst[i];
    sxx += ndvi[i] * ndvi[i]; syy += lst[i] * lst[i]; sxy += ndvi[i] * lst[i];
  }
  const mx = sx / n, my = sy / n;
  const cxx = sxx - n * mx * mx, cyy = syy - n * my * my, cxy = sxy - n * mx * my;
  const r = cxy / Math.sqrt(cxx * cyy);
  const slope = cxy / cxx, intercept = my - slope * mx;
  const tR = r * Math.sqrt((n - 2) / (1 - r * r));
  const pR = tSF2(Math.abs(tR), n - 2);
  let ssr = 0;
  for (let i = 0; i < N; i++) {
    if (cls[i] < 0) continue;
    const e = lst[i] - (intercept + slope * ndvi[i]);
    ssr += e * e;
  }
  const seSlope = Math.sqrt((ssr / (n - 2)) / cxx);
  const pSlope = tSF2(Math.abs(slope / seSlope), n - 2);

  const groups = [[], [], []];
  for (let i = 0; i < N; i++) if (cls[i] >= 0) groups[cls[i]].push(lst[i]);
  const stats = groups.map((g, k) => {
    const m = g.reduce((a, b) => a + b, 0) / g.length;
    const v = g.reduce((a, b) => a + (b - m) * (b - m), 0) / (g.length - 1);
    const se = Math.sqrt(v / g.length);
    return { k, label: LABELS[k], n: g.length, share: g.length / n, mean: m,
             sd: Math.sqrt(v), se, lo: m - 1.96 * se, hi: m + 1.96 * se };
  });

  let ssb = 0, ssw = 0;
  stats.forEach(s => { ssb += s.n * (s.mean - my) ** 2; ssw += (s.n - 1) * s.sd * s.sd; });
  const d1 = 2, d2 = n - 3, F = (ssb / d1) / (ssw / d2), pF = fSF(F, d1, d2);
  const eta2 = ssb / (ssb + ssw);

  const idx = [];
  for (let i = 0; i < N; i++) if (cls[i] >= 0) idx.push(i);
  idx.sort((a, b) => lst[a] - lst[b]);
  const rank = new Float64Array(N);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && lst[idx[j + 1]] === lst[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) rank[idx[k]] = avg;
    i = j + 1;
  }
  const rsum = [0, 0, 0];
  for (let i = 0; i < N; i++) if (cls[i] >= 0) rsum[cls[i]] += rank[i];
  let H = 0;
  for (let k = 0; k < 3; k++) H += rsum[k] * rsum[k] / stats[k].n;
  H = 12 / (n * (n + 1)) * H - 3 * (n + 1);

  const pairs = [];
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
    const A = stats[a], P = stats[b];
    const va = A.sd * A.sd / A.n, vb = P.sd * P.sd / P.n, se = Math.sqrt(va + vb);
    const t = (A.mean - P.mean) / se;
    const df = (va + vb) ** 2 / (va * va / (A.n - 1) + vb * vb / (P.n - 1));
    const p = tSF2(Math.abs(t), df);
    pairs.push({ a: A.label, b: P.label, diff: A.mean - P.mean, t, df, p, padj: Math.min(1, p * 3) });
  }

  const comp = B.names.map((name, i) => {
    const c = [0, 0, 0];
    let tot = 0;
    for (let j = 0; j < N; j++) if (site[j] === i && cls[j] >= 0) { c[cls[j]]++; tot++; }
    return { name, c, tot, share: c.map(v => tot ? v / tot : 0) };
  });

  CACHE = { n, r, r2: r * r, pR, slope, intercept, seSlope, pSlope, meanN: mx, meanL: my,
            stats, anova: { F, d1, d2, p: pF, eta2 }, kw: { H, p: chi2SF(H, 2) },
            pairs, comp, asof: B.asof, names: B.names, cuts: CUTS, labels: LABELS };
  return CACHE;
}

module.exports = { analyze };
