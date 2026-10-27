"use strict";
/* rbac.js — users, roles, sessions and the audit trail.
   No dependencies: node:crypto only. */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA = process.env.SAFENET_DATA || path.join(__dirname, "rbac");
const USERS = path.join(DATA, "users.json");
const AUDIT = path.join(DATA, "audit.jsonl");

const ROLES = {
  viewer:  { rank: 1, caps: ["view"] },
  analyst: { rank: 2, caps: ["view", "report", "export"] },
  admin:   { rank: 3, caps: ["view", "report", "export", "users", "audit"] }
};
const ITER = 210000, KEYLEN = 64, DIGEST = "sha512";
const SESSION_MS = 8 * 60 * 60 * 1000;

function ensureDir() { fs.mkdirSync(DATA, { recursive: true }); }

/* ---------------- password hashing ---------------- */
function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(pw, salt, ITER, KEYLEN, DIGEST).toString("hex");
  return { salt, hash, iter: ITER, alg: DIGEST };
}
function verifyPassword(pw, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const h = crypto.pbkdf2Sync(pw, rec.salt, rec.iter || ITER, KEYLEN, rec.alg || DIGEST);
  const want = Buffer.from(rec.hash, "hex");
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}

/* ---------------- user store ---------------- */
function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS, "utf8")); }
  catch (e) { return { users: [] }; }
}
function writeUsers(db) {
  ensureDir();
  const tmp = USERS + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, USERS);
}
function listUsers() {
  return readUsers().users.map(u => ({
    id: u.id, username: u.username, role: u.role, created: u.created, disabled: !!u.disabled
  }));
}
function findUser(username) {
  return readUsers().users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
}
function createUser(username, password, role) {
  if (!/^[a-z0-9._-]{3,32}$/i.test(username)) throw new Error("invalid username");
  if (!ROLES[role]) throw new Error("invalid role");
  if (String(password).length < 10) throw new Error("password must be at least 10 characters");
  const db = readUsers();
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase()))
    throw new Error("user already exists");
  const h = hashPassword(password);
  const rec = { id: crypto.randomUUID(), username, role, ...h,
                created: new Date().toISOString(), disabled: false };
  db.users.push(rec);
  writeUsers(db);
  audit("user.create", { actor: "cli", target: username, role });
  return rec;
}
function setRole(username, role) {
  if (!ROLES[role]) throw new Error("invalid role");
  const db = readUsers();
  const u = db.users.find(x => x.username.toLowerCase() === String(username).toLowerCase());
  if (!u) throw new Error("no such user");
  u.role = role;
  writeUsers(db);
  audit("user.role", { actor: "cli", target: username, role });
  return u;
}
function removeUser(username) {
  const db = readUsers();
  const before = db.users.length;
  db.users = db.users.filter(u => u.username.toLowerCase() !== String(username).toLowerCase());
  if (db.users.length === before) throw new Error("no such user");
  writeUsers(db);
  audit("user.delete", { actor: "cli", target: username });
}
function setPassword(username, password) {
  if (String(password).length < 10) throw new Error("password must be at least 10 characters");
  const db = readUsers();
  const u = db.users.find(x => x.username.toLowerCase() === String(username).toLowerCase());
  if (!u) throw new Error("no such user");
  Object.assign(u, hashPassword(password));
  writeUsers(db);
  audit("user.password", { actor: "cli", target: username });
}

/* ---------------- sessions ---------------- */
const sessions = new Map();

function login(username, password) {
  const u = findUser(username);
  const ok = !!u && !u.disabled && verifyPassword(password, u);
  if (!ok) { audit("login.fail", { target: String(username).slice(0, 40) }); return null; }
  const sid = crypto.randomBytes(32).toString("hex");
  sessions.set(sid, { username: u.username, role: u.role, exp: Date.now() + SESSION_MS });
  audit("login.ok", { actor: u.username, role: u.role });
  return { sid, user: { username: u.username, role: u.role } };
}
function session(sid) {
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(sid); return null; }
  return s;
}
function logout(sid) {
  const s = sessions.get(sid);
  if (s) audit("logout", { actor: s.username });
  sessions.delete(sid);
}
function can(role, cap) {
  const r = ROLES[role];
  return !!r && r.caps.includes(cap);
}
function sweep() {
  const now = Date.now();
  for (const [k, v] of sessions) if (v.exp < now) sessions.delete(k);
}
setInterval(sweep, 10 * 60 * 1000).unref();

/* ---------------- audit ---------------- */
function audit(event, data = {}) {
  ensureDir();
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data });
  try { fs.appendFileSync(AUDIT, line + "\n"); } catch (e) { /* never break a request on the log */ }
}
function readAudit(limit = 200) {
  try {
    const lines = fs.readFileSync(AUDIT, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l)).reverse();
  } catch (e) { return []; }
}

module.exports = { ROLES, DATA, USERS, AUDIT, hashPassword, verifyPassword, listUsers, findUser,
  createUser, setRole, removeUser, setPassword, login, session, logout, can, audit, readAudit };
