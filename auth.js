"use strict";

/* ============================================================
   auth.js — session, role gating and the server-backed report.
   Opened from file:// there is no server: the console runs in
   offline mode and says so. Served by server.js it asks /api/me.
   ============================================================ */

(function () {
  const online = /^https?:$/.test(location.protocol);

  const AUTH = {
    online,
    current: null,
    public: false,
    caps: [],
    can(cap) { return !online || this.caps.includes(cap); },
    reason(cap) {
      if (!this.current) return 'sign in to use this';
      return 'your role (' + this.current.role + ') cannot ' + cap;
    }
  };
  window.AUTH = AUTH;

  const $ = id => document.getElementById(id);

  function chip() {
    const el = $('who');
    if (!el) return;
    if (!online) {
      el.textContent = 'offline';
      el.title = 'opened from the file system: no login, no server-side report';
      el.dataset.mode = 'offline';
      return;
    }
    if (AUTH.public && !AUTH.current) {
      el.textContent = 'public demo';
      el.title = 'shared link: the console and the report are open, account management is not';
      el.dataset.mode = 'public';
      return;
    }
    if (!AUTH.current) {
      el.textContent = 'sign in';
      el.dataset.mode = 'out';
      el.onclick = () => showLogin();
      return;
    }
    el.textContent = AUTH.current.username + ' \u00B7 ' + AUTH.current.role;
    el.title = 'capabilities: ' + AUTH.caps.join(', ');
    el.dataset.mode = AUTH.current.role;
    el.onclick = async () => {
      await fetch('/api/logout', { method: 'POST' });
      location.reload();
    };
  }

  function gate() {
    const map = { 'btn-report': 'report', 'btn-report-print': 'report', 'tb-export': 'export' };
    Object.entries(map).forEach(([id, cap]) => {
      const b = $(id);
      if (!b) return;
      const ok = AUTH.can(cap);
      b.disabled = !ok;
      b.setAttribute('aria-disabled', String(!ok));
      b.title = ok ? (online ? 'served by /api/' + (cap === 'export' ? 'export.csv' : 'report') + ' (audited)'
                            : 'generated in the browser')
                   : AUTH.reason(cap);
    });
  }

  function showLogin() {
    const w = $('loginwrap');
    if (!w) return;
    w.classList.add('on');
    const u = $('login-user');
    if (u) setTimeout(() => u.focus(), 50);
  }

  async function submit(e) {
    e.preventDefault();
    const err = $('login-err');
    err.textContent = '';
    const body = { username: $('login-user').value.trim(), password: $('login-pass').value };
    try {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      const j = await r.json();
      if (!r.ok) { err.textContent = j.error || 'login failed'; return; }
      location.reload();
    } catch (ex) { err.textContent = 'network error'; }
  }

  async function boot() {
    if (!online) { chip(); gate(); return; }
    try {
      const r = await fetch('/api/me', { headers: { accept: 'application/json' } });
      const j = await r.json();
      AUTH.current = j.user;
      AUTH.caps = j.caps || [];
      AUTH.public = !!j.public;
    } catch (e) {
      AUTH.online = false;
    }
    chip(); gate();
    if (online && !AUTH.current && !AUTH.public) showLogin();
    const f = $('loginform');
    if (f) f.addEventListener('submit', submit);
  }

  /* The report is always built in the browser: only the browser can rasterise the four
     charts into the document, and the numbers come from the same grid the map draws.
     When served, the server is still asked first — it enforces the role and writes the
     audit entry — and its refusal stops the download. */
  async function downloadReport() {
    if (online) {
      const r = await fetch('/api/report?audit=1');
      if (!r.ok) {
        let msg = 'HTTP ' + r.status;
        try { const j = await r.json(); if (j.error) msg = j.error; } catch (e) {}
        alert('report refused: ' + msg);
        return;
      }
    }
    if (window.REL) window.REL.downloadReport();
    else alert('the analysis module did not load');
  }

  document.addEventListener('DOMContentLoaded', boot);
  window.AUTH_DOWNLOAD_REPORT = downloadReport;
})();
