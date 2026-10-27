"use strict";
/* test_rbac.js — proves the role gate actually refuses, over HTTP.
   Uses a throwaway data dir and random passwords that never get printed. */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "safenet-rbac-"));
process.env.SAFENET_DATA = DATA;

const R = require("./rbac.js");
const PORT = 8900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;

const pw = {};
let pass = 0, fail = 0;
function check(name, ok, extra = "") {
  (ok ? pass++ : fail++);
  console.log((ok ? "PASS  " : "FAIL  ") + name + (extra ? "   " + extra : ""));
}

async function login(user) {
  const r = await fetch(BASE + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: user, password: pw[user] })
  });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  return { status: r.status, cookie, body: await r.json().catch(() => ({})) };
}
const get = (p, cookie) => fetch(BASE + p, { headers: cookie ? { cookie } : {} });

(async () => {
  ["viewer", "analyst", "admin"].forEach(role => {
    pw[role] = crypto.randomBytes(18).toString("base64url");
    R.createUser(role, pw[role], role);
  });

  const srv = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: String(PORT), SAFENET_DATA: DATA },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let ready = false;
  srv.stdout.on("data", d => { if (String(d).includes("http://")) ready = true; });
  for (let i = 0; i < 100 && !ready; i++) await new Promise(r => setTimeout(r, 100));

  try {
    check("server starts", ready, BASE);

    // anonymous
    let r = await get("/api/report");
    check("anonymous /api/report -> 401", r.status === 401, "got " + r.status);
    r = await get("/api/me");
    const me = await r.json();
    check("anonymous /api/me has no user", me.user === null);

    // bad password
    const bad = await fetch(BASE + "/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "viewer", password: "not-the-password" })
    });
    check("wrong password -> 401", bad.status === 401, "got " + bad.status);

    // viewer
    const v = await login("viewer");
    check("viewer login", v.status === 200 && v.body.user.role === "viewer");
    check("viewer caps are view only", JSON.stringify(v.body.caps) === '["view"]', JSON.stringify(v.body.caps));
    r = await get("/api/report", v.cookie);
    check("viewer /api/report -> 403", r.status === 403, "got " + r.status);
    r = await get("/api/export.csv", v.cookie);
    check("viewer /api/export.csv -> 403", r.status === 403, "got " + r.status);
    r = await get("/api/users", v.cookie);
    check("viewer /api/users -> 403", r.status === 403, "got " + r.status);
    r = await get("/api/audit", v.cookie);
    check("viewer /api/audit -> 403", r.status === 403, "got " + r.status);
    r = await get("/index.html", v.cookie);
    check("viewer can load the console", r.status === 200, "got " + r.status);

    // analyst
    const a = await login("analyst");
    check("analyst login", a.status === 200 && a.body.user.role === "analyst");
    r = await get("/api/report", a.cookie);
    const html = await r.text();
    check("analyst /api/report -> 200", r.status === 200, "got " + r.status);
    check("report is html", (r.headers.get("content-type") || "").includes("text/html"));
    check("report carries the finding", html.includes("cooler than cells in Low vegetation"));
    check("report names the requester", html.includes("(analyst)"));
    check("report states n", html.includes("27,418"));
    r = await get("/api/export.csv", a.cookie);
    const csv = await r.text();
    check("analyst /api/export.csv -> 200", r.status === 200 && csv.split("\n").length === 22,
      csv.split("\n").length + " lines");
    r = await get("/api/users", a.cookie);
    check("analyst /api/users -> 403", r.status === 403, "got " + r.status);

    // admin
    const ad = await login("admin");
    check("admin login", ad.status === 200 && ad.body.user.role === "admin");
    r = await get("/api/users", ad.cookie);
    const users = await r.json();
    check("admin lists users", r.status === 200 && users.users.length === 3, users.users.length + " users");
    check("password hashes never leave the server",
      !JSON.stringify(users).includes(pw.viewer) && !JSON.stringify(users).includes("hash"));
    r = await get("/api/audit", ad.cookie);
    const audit = await r.json();
    const ev = audit.events.map(e => e.event);
    check("audit records the denials", ev.includes("denied.role"), ev.slice(0, 6).join(","));
    check("audit records the report", ev.includes("report.generate"));
    check("audit records the logins", ev.filter(e => e === "login.ok").length >= 3);

    // role change takes effect on the next request
    R.setRole("viewer", "analyst");
    const v2 = await login("viewer");
    r = await get("/api/report", v2.cookie);
    check("promoted viewer can now generate the report", r.status === 200, "got " + r.status);
    R.setRole("viewer", "viewer");
    const v3 = await login("viewer");
    r = await get("/api/report", v3.cookie);
    check("demoted viewer is refused again", r.status === 403, "got " + r.status);

    // session hygiene
    await fetch(BASE + "/api/logout", { method: "POST", headers: { cookie: v3.cookie } });
    r = await get("/api/me", v3.cookie);
    check("logged-out cookie no longer resolves", (await r.json()).user === null);

    // static guard
    r = await get("/rbac/users.json");
    check("user store is not downloadable", r.status === 404, "got " + r.status);
    r = await get("/server.js");
    check("server source is not downloadable", r.status === 404, "got " + r.status);
    r = await get("/%2e%2e/server.js");
    check("encoded traversal is refused", r.status === 404 || r.status === 403, "got " + r.status);
    r = await get("/stats.js");
    check("analysis source is not downloadable", r.status === 404, "got " + r.status);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("harness error:", e); process.exit(2); });
