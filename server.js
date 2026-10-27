"use strict";
/* server.js — the console behind a login, with role-gated report generation.

   node server.js                 start on :8080
   node server.js init            create rbac/users.json with three demo accounts
   node server.js adduser <name> <role>
   node server.js passwd <name>
   node server.js role <name> <role>
   node server.js users
*/

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const R = require("./rbac.js");
const stats = require("./stats.js");

const ROOT = __dirname;
const PORT = +(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
/* public demo mode: anyone may read and generate the report, nobody may manage accounts */
const PUBLIC = process.env.SAFENET_PUBLIC === "1";
const PUBLIC_CAPS = ["view", "report", "export"];

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".geojson": "application/geo+json", ".csv": "text/csv; charset=utf-8",
  ".ico": "image/x-icon", ".woff2": "font/woff2"
};
const PRIVATE = /^\/(rbac|\.git|node_modules)(\/|$)|^\/\.|^\/(server|rbac|stats|test_rbac)\.js$|^\/package(-lock)?\.json$/;

/* ---------------- helpers ---------------- */
function send(res, code, body, type = "text/plain; charset=utf-8", extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(code, {
    "Content-Type": type,
    "Content-Length": buf.length,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "SAMEORIGIN",
    ...extra
  });
  res.end(buf);
}
function json(res, code, obj, extra) {
  send(res, code, JSON.stringify(obj, null, 1), "application/json; charset=utf-8", extra);
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function body(req) {
  return new Promise((resolve, reject) => {
    let s = "", n = 0;
    req.on("data", c => {
      n += c.length;
      if (n > 64 * 1024) { reject(new Error("body too large")); req.destroy(); return; }
      s += c;
    });
    req.on("end", () => {
      try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}
const pfmt = p => p < 0.001 ? "< 0.001" : p.toFixed(3);
const signed = (v, d = 2) => (v >= 0 ? "+" : "") + v.toFixed(d);

/* ---------------- report ---------------- */
function reportHTML(user) {
  const a = stats.analyze();
  const when = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const rows = a.stats.map(s =>
    `<tr><td>${s.label}</td><td>${s.k === 0 ? "< " + a.cuts[0].toFixed(2)
      : s.k === 1 ? a.cuts[0].toFixed(2) + "–" + a.cuts[1].toFixed(2)
      : "≥ " + a.cuts[1].toFixed(2)}</td><td class=n>${s.n.toLocaleString()}</td>
     <td class=n>${(s.share * 100).toFixed(1)}%</td><td class=n>${s.mean.toFixed(2)}</td>
     <td class=n>${s.lo.toFixed(2)} – ${s.hi.toFixed(2)}</td>
     <td class=n>${signed(s.mean - a.meanL)}</td></tr>`).join("");
  const pairs = a.pairs.map(p =>
    `<tr><td>${p.a} vs ${p.b}</td><td class=n>${signed(p.diff)} °C</td><td class=n>${p.t.toFixed(1)}</td>
     <td class=n>${pfmt(p.p)}</td><td class=n>${pfmt(p.padj)}</td>
     <td>${p.padj < 0.05 ? "yes" : "no"}</td></tr>`).join("");
  const brgy = a.comp.map(r =>
    `<tr><td>${r.name}</td><td class=n>${r.tot.toLocaleString()}</td>
     <td class=n>${(r.share[0] * 100).toFixed(1)}%</td>
     <td class=n>${(r.share[1] * 100).toFixed(1)}%</td>
     <td class=n>${(r.share[2] * 100).toFixed(1)}%</td></tr>`).join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Vegetation and surface temperature — Novaliches 2026</title><style>
 body{font:13px/1.6 Georgia,serif;color:#1b1b1b;max-width:900px;margin:44px auto;padding:0 26px}
 h1{font-size:23px;margin:0 0 4px} h2{font-size:13px;margin:30px 0 8px;text-transform:uppercase;
 letter-spacing:.1em;color:#555}
 .meta{font:11px/1.7 ui-monospace,monospace;color:#666;border-bottom:1px solid #ddd;padding-bottom:12px}
 .lede{font-size:15px;margin:18px 0;padding:14px 16px;border-left:3px solid #b4761f;background:#faf7f2}
 table{width:100%;border-collapse:collapse;margin:10px 0 18px;font-size:12px}
 th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#666;
    border-bottom:1px solid #bbb;padding:0 8px 5px 0}
 td{padding:5px 8px 5px 0;border-bottom:1px solid #eee} td.n{font-family:ui-monospace,monospace}
 footer{margin-top:34px;border-top:1px solid #ddd;padding-top:10px;font:11px/1.6 ui-monospace,monospace;color:#777}
</style></head><body>
<h1>Urban vegetation and land surface temperature</h1>
<div class="meta">Novaliches, Quezon City · 20 barangays · 2026 median composite<br>
Generated ${when} · requested by ${user.username} (${user.role}) · built ${a.asof.built} ·
newest scene ${a.asof.s2_last} (Sentinel-2), ${a.asof.ls_last} (Landsat)</div>
<div class="lede"><b>Result.</b> Cells in High vegetation are ${(a.stats[0].mean - a.stats[2].mean).toFixed(2)}
°C cooler than cells in Low vegetation (${a.stats[2].mean.toFixed(2)} °C vs ${a.stats[0].mean.toFixed(2)} °C).
Pearson r = ${a.r.toFixed(3)} (p ${pfmt(a.pR)}); one-way ANOVA F(${a.anova.d1}, ${a.anova.d2}) =
${Math.round(a.anova.F).toLocaleString()}, p ${pfmt(a.anova.p)}, η² = ${a.anova.eta2.toFixed(3)}.</div>
<h2>Method</h2>
<p>Sentinel-2 L2A surface reflectance and Landsat 8/9 Collection 2 Level 2 surface temperature, cloud
masked before compositing (SCL, QA_PIXEL), median composited per sensor, resampled to a 40 m grid.
NDVI is binned into Low, Moderate and High at ${a.cuts.join(" and ")}. Temperature is compared across
classes with Pearson correlation, ordinary least squares, one-way ANOVA, Kruskal–Wallis and pairwise
Welch tests with Bonferroni adjustment, on ${a.n.toLocaleString()} valid cells.</p>
<h2>Class summary</h2>
<table><thead><tr><th>Class</th><th>NDVI</th><th>Cells</th><th>Share</th><th>Mean LST °C</th>
<th>95% CI</th><th>vs area</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Statistical tests</h2>
<table><thead><tr><th>Test</th><th>Value</th><th>p</th></tr></thead><tbody>
<tr><td>Pearson correlation</td><td class=n>r = ${a.r.toFixed(3)}</td><td class=n>${pfmt(a.pR)}</td></tr>
<tr><td>Coefficient of determination</td><td class=n>R² = ${a.r2.toFixed(3)}</td><td class=n>—</td></tr>
<tr><td>OLS slope</td><td class=n>${(a.slope * 0.1).toFixed(2)} °C per 0.1 NDVI (95% CI ${((a.slope - 1.96 * a.seSlope) * 0.1).toFixed(2)} to ${((a.slope + 1.96 * a.seSlope) * 0.1).toFixed(2)})</td><td class=n>${pfmt(a.pSlope)}</td></tr>
<tr><td>One-way ANOVA</td><td class=n>F(${a.anova.d1}, ${a.anova.d2}) = ${Math.round(a.anova.F).toLocaleString()}, η² = ${a.anova.eta2.toFixed(3)}</td><td class=n>${pfmt(a.anova.p)}</td></tr>
<tr><td>Kruskal–Wallis</td><td class=n>H = ${Math.round(a.kw.H).toLocaleString()}</td><td class=n>${pfmt(a.kw.p)}</td></tr>
</tbody></table>
<h2>Pairwise comparison</h2>
<table><thead><tr><th>Comparison</th><th>Difference</th><th>Welch t</th><th>p</th><th>p adj.</th>
<th>Significant</th></tr></thead><tbody>${pairs}</tbody></table>
<h2>Per-barangay composition</h2>
<table><thead><tr><th>Barangay</th><th>Cells</th><th>Low</th><th>Moderate</th><th>High</th></tr></thead>
<tbody>${brgy}</tbody></table>
<h2>Limitations</h2>
<p>Single epoch: a cross-sectional comparison, not a change over time. LST is a surface radiometric
quantity at about 10:15 local, not air temperature; twelve of sixteen Landsat dates fall in the dry
season, and Landsat thermal is natively 100 m. A significant class difference is an association, not a
demonstrated causal cooling effect. NDVI explains ${Math.round(a.r2 * 100)}% of LST variance.</p>
<footer>Generated by the SafeNet analysis console · report endpoint /api/report ·
figures are in the interactive console · boundaries OpenStreetMap ODbL ·
imagery Copernicus Sentinel-2 and USGS Landsat.</footer></body></html>`;
}

/* ---------------- routes ---------------- */
async function api(req, res, url) {
  const p = url.pathname;
  const sid = cookies(req).sid;
  const s = R.session(sid);

  if (p === "/api/login" && req.method === "POST") {
    const b = await body(req);
    const out = R.login(String(b.username || ""), String(b.password || ""));
    if (!out) return json(res, 401, { error: "invalid credentials" });
    return json(res, 200, { user: out.user, caps: R.ROLES[out.user.role].caps }, {
      "Set-Cookie": `sid=${out.sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${8 * 3600}`
    });
  }

  if (p === "/api/logout" && req.method === "POST") {
    R.logout(sid);
    return json(res, 200, { ok: true }, { "Set-Cookie": "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
  }

  if (p === "/api/me") {
    if (!s && PUBLIC) return json(res, 200, { user: null, caps: PUBLIC_CAPS, public: true });
    if (!s) return json(res, 200, { user: null, caps: [] });
    return json(res, 200, { user: { username: s.username, role: s.role }, caps: R.ROLES[s.role].caps });
  }

  /* everything below needs a session, or public mode for the read/report capabilities */
  const eff = s || (PUBLIC ? { username: "public", role: "demo" } : null);
  if (!eff) {
    R.audit("denied.anonymous", { path: p, ip: req.socket.remoteAddress });
    return json(res, 401, { error: "authentication required" });
  }
  const caps = s ? R.ROLES[s.role].caps : PUBLIC_CAPS;

  const need = p === "/api/report" ? "report"
             : p === "/api/export.csv" ? "export"
             : p.startsWith("/api/users") ? "users"
             : p === "/api/audit" ? "audit" : null;

  if (need && !caps.includes(need)) {
    R.audit("denied.role", { actor: eff.username, role: eff.role, cap: need, path: p });
    return json(res, 403, { error: "role " + eff.role + " cannot " + need, role: eff.role, need });
  }

  if (p === "/api/report" && url.searchParams.get("audit") === "1") {
    R.audit("report.generate", { actor: eff.username, role: eff.role, format: "browser" });
    res.writeHead(204, { "cache-control": "no-store" });
    return res.end();
  }

  if (p === "/api/report" && req.method === "GET") {
    R.audit("report.generate", { actor: eff.username, role: eff.role, format: "html" });
    return send(res, 200, reportHTML(eff), "text/html; charset=utf-8", {
      "Content-Disposition": `attachment; filename="greenspace-lst-report-${stats.analyze().asof.built}.html"`
    });
  }

  if (p === "/api/export.csv" && req.method === "GET") {
    const a = stats.analyze();
    const head = "barangay,cells,low_pct,moderate_pct,high_pct\n";
    const rows = a.comp.map(r => [r.name, r.tot,
      (r.share[0] * 100).toFixed(1), (r.share[1] * 100).toFixed(1), (r.share[2] * 100).toFixed(1)].join(","));
    R.audit("export.csv", { actor: eff.username, role: eff.role, rows: rows.length });
    return send(res, 200, head + rows.join("\n") + "\n", MIME[".csv"], {
      "Content-Disposition": 'attachment; filename="barangay-class-composition.csv"'
    });
  }

  if (p === "/api/users" && req.method === "GET")
    return json(res, 200, { users: R.listUsers() });

  if (p === "/api/users" && req.method === "POST") {
    if (req.headers["x-requested-with"] !== "safenet") return json(res, 400, { error: "missing X-Requested-With" });
    const b = await body(req);
    try {
      const u = R.createUser(String(b.username || ""), String(b.password || ""), String(b.role || ""));
      R.audit("user.create", { actor: s.username, target: u.username, role: u.role });
      return json(res, 201, { user: { username: u.username, role: u.role } });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (p.startsWith("/api/users/") && req.method === "DELETE") {
    if (req.headers["x-requested-with"] !== "safenet") return json(res, 400, { error: "missing X-Requested-With" });
    const name = decodeURIComponent(p.slice("/api/users/".length));
    if (s && name === s.username) return json(res, 400, { error: "cannot delete the account you are using" });
    try {
      R.removeUser(name);
      R.audit("user.delete", { actor: s.username, target: name });
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 404, { error: e.message }); }
  }

  if (p === "/api/audit")
    return json(res, 200, { events: R.readAudit(200) });

  return json(res, 404, { error: "no such endpoint" });
}

function staticFile(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  if (PRIVATE.test(rel)) return send(res, 404, "not found");
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(ROOT)) return send(res, 403, "forbidden");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "not found");
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": st.size,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin"
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------- cli ---------------- */
function prompt(question, hidden) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      process.stdout.write(question);
      const onData = () => {};
      rl._writeToOutput = () => {};
      rl.question("", ans => { rl.close(); process.stdout.write("\n"); resolve(ans); });
    } else {
      rl.question(question, ans => { rl.close(); resolve(ans); });
    }
  });
}

async function cli(argv) {
  const cmd = argv[0];
  if (cmd === "init") {
    const roles = [["viewer", "viewer"], ["analyst", "analyst"], ["admin", "admin"]];
    const made = [];
    for (const [name, role] of roles) {
      if (R.findUser(name)) { made.push([name, role, "(exists, skipped)"]); continue; }
      const pw = crypto.randomBytes(12).toString("base64url");
      R.createUser(name, pw, role);
      made.push([name, role, pw]);
    }
    console.log("\nAccounts written to " + R.USERS + "\n");
    console.log("username  role     one-time password");
    made.forEach(([n, r, pw]) => console.log(n.padEnd(9), r.padEnd(8), pw));
    console.log("\nChange these with: node server.js passwd <name>\n");
    return;
  }
  if (cmd === "adduser") {
    const [name, role] = argv.slice(1);
    if (!name || !role) { console.log("usage: node server.js adduser <name> <viewer|analyst|admin>"); return; }
    const pw = await prompt("password for " + name + ": ", true);
    R.createUser(name, pw, role);
    console.log("created", name, role);
    return;
  }
  if (cmd === "passwd") {
    const name = argv[1];
    if (!name) { console.log("usage: node server.js passwd <name>"); return; }
    const pw = await prompt("new password for " + name + ": ", true);
    R.setPassword(name, pw);
    console.log("password updated for", name);
    return;
  }
  if (cmd === "role") {
    R.setRole(argv[1], argv[2]);
    console.log("role updated:", argv[1], "->", argv[2]);
    return;
  }
  if (cmd === "users") {
    console.table(R.listUsers());
    return;
  }
  console.log("usage: node server.js [init|adduser|passwd|role|users]");
}

/* ---------------- start ---------------- */
if (require.main === module) {
  if (process.argv[2]) {
    cli(process.argv.slice(2)).catch(e => { console.error("error:", e.message); process.exit(1); });
  } else {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
      if (url.pathname.startsWith("/api/")) {
        api(req, res, url).catch(e => json(res, 500, { error: e.message }));
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");
      staticFile(req, res, url);
    });
    server.listen(PORT, HOST, () => {
      console.log(`SafeNet console  http://${HOST}:${PORT}`);
      console.log(`users            ${R.USERS}`);
      console.log(`audit            ${R.AUDIT}`);
      console.log(PUBLIC ? "mode             PUBLIC DEMO (no login; report + export open, accounts closed)"
                         : "mode             private (login required)");
      if (!PUBLIC && !R.listUsers().length) console.log("no accounts yet — run: node server.js init");
    });
  }
}

module.exports = { reportHTML };
