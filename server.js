const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const {
  db, setting, settingSet, generateKeyCode, hashToken, clientIp, keyStatus, humanLeft
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/assets', express.static(path.join(__dirname, 'public')));
app.get('/manus-routes.json', (req, res) => {
  res.type('application/json').sendFile(path.join(__dirname, 'manus-routes.json'));
});
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Auth helpers ----------
function panelUser(req) {
  const token = req.cookies?.proxywire_sess || '';
  if (!token) return null;
  const hash = hashToken(token);
  const row = db.prepare(`
    SELECT u.* FROM panel_sessions s
    JOIN panel_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'
  `).get(hash, Math.floor(Date.now() / 1000));
  return row || null;
}

function panelLogin(accessCode) {
  const code = String(accessCode).trim().toUpperCase();
  const user = db.prepare("SELECT * FROM panel_users WHERE access_code = ? AND status = 'active'").get(code);
  if (!user) return null;

  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(token);
  const exp = Math.floor(Date.now() / 1000) + 30 * 86400;

  db.prepare('INSERT INTO panel_sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(hash, user.id, Math.floor(Date.now() / 1000), exp);
  db.prepare('UPDATE panel_users SET last_login = ? WHERE id = ?')
    .run(Math.floor(Date.now() / 1000), user.id);

  return { user, token, exp };
}

function panelLogout(req, res) {
  const token = req.cookies?.proxywire_sess || '';
  if (token) {
    db.prepare('DELETE FROM panel_sessions WHERE token_hash = ?').run(hashToken(token));
  }
  res.clearCookie('proxywire_sess');
}

function setSessionCookie(res, token, exp) {
  res.cookie('proxywire_sess', token, {
    httpOnly: true,
    maxAge: 30 * 86400 * 1000,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

function themeStyle() {
  let c = setting('theme_color', '#8b5cf6');
  if (!/^#[0-9A-Fa-f]{6}$/.test(c)) c = '#8b5cf6';
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  const dark = `#${Math.max(0, r - 30).toString(16).padStart(2, '0')}${Math.max(0, g - 30).toString(16).padStart(2, '0')}${Math.max(0, b - 30).toString(16).padStart(2, '0')}`;
  return `<style>:root{--accent:${c};--accent-dark:${dark};--accent-glow:${c}66;--red:${c};--red-dark:${dark};--red-glow:${c}66;}</style>`;
}

// ---------- Layout helpers ----------
function getInlineCss() {
  return `:root {
  --bg: #07060c;
  --card: #0e0c16;
  --card2: #13111c;
  --border: #221e32;
  --accent: #8b5cf6;
  --accent-dark: #6d28d9;
  --accent-glow: rgba(139, 92, 246, 0.4);
  --text: #f8fafc;
  --muted: #9ca3af;
  --green: #22c55e;
  --yellow: #eab308;
  --red: #ef4444;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { min-height: 100%; }

body {
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background:
    radial-gradient(ellipse 90% 55% at 50% -15%, rgba(139,92,246,0.18) 0%, transparent 55%),
    radial-gradient(ellipse 70% 40% at 50% 110%, rgba(60,20,100,0.22) 0%, transparent 50%),
    #07060c;
  color: var(--text);
  line-height: 1.45;
}

a { color: var(--accent); text-decoration: none; }
a:hover { opacity: 0.9; }

/* ========== PÚBLICO / LOGIN ========== */
.wrap {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px 16px 40px;
}

.card {
  width: 100%;
  max-width: 380px;
  background: linear-gradient(165deg, #151222 0%, #0c0a14 100%);
  border: 1px solid rgba(139,92,246,0.18);
  border-radius: 22px;
  padding: 36px 28px 28px;
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.02) inset,
    0 25px 50px rgba(0,0,0,0.55),
    0 0 80px rgba(139,92,246,0.1);
}

.logo {
  width: 54px;
  height: 54px;
  margin: 0 auto 18px;
  border-radius: 14px;
  background: #0a0912;
  border: 1px solid var(--accent);
  box-shadow: 0 0 22px var(--accent-glow);
  display: flex;
  align-items: center;
  justify-content: center;
}
.logo svg { width: 26px; height: 26px; stroke: var(--accent); }

.brand {
  text-align: center;
  font-size: 1.7rem;
  font-weight: 800;
  letter-spacing: 0.5px;
  line-height: 1.15;
}
.brand span { color: var(--accent); }

.tagline {
  text-align: center;
  margin: 8px 0 18px;
  font-size: 0.7rem;
  letter-spacing: 0.35em;
  color: var(--muted);
  text-transform: uppercase;
  font-weight: 500;
}

.status-pill {
  display: flex;
  justify-content: center;
  margin-bottom: 22px;
}
.status-pill span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--green);
  background: rgba(34,197,94,0.1);
  border: 1px solid rgba(34,197,94,0.28);
  letter-spacing: 0.04em;
}
.status-pill i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 8px var(--green);
}

.field-label {
  display: block;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--muted);
  margin-bottom: 8px;
  text-transform: uppercase;
}

.input {
  width: 100%;
  background: #0a0912;
  border: 1px solid #2a2640;
  border-radius: 12px;
  color: var(--text);
  font-size: 1rem;
  padding: 15px 16px;
  outline: none;
  text-align: center;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.input::placeholder { color: #4a4560; letter-spacing: 0.2em; }

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  border: none;
  border-radius: 999px;
  padding: 15px 18px;
  font-size: 0.88rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: 0.15s ease;
}
.btn-main {
  margin-top: 14px;
  color: #fff;
  background: linear-gradient(135deg, #8b5cf6, #6d28d9);
  box-shadow: 0 8px 28px var(--accent-glow);
}
.btn-main:hover { filter: brightness(1.08); transform: translateY(-1px); }

.btn-wa {
  margin-top: 4px;
  color: #fff;
  background: linear-gradient(135deg, #25d366, #128c7e);
  box-shadow: 0 6px 20px rgba(37,211,102,0.3);
}
.btn-discord {
  margin-top: 4px;
  color: #fff;
  background: linear-gradient(135deg, #5865F2, #4752c4);
  box-shadow: 0 6px 20px rgba(88,101,242,0.35);
}

.notice {
  width: 100%;
  max-width: 380px;
  margin-top: 16px;
  background: linear-gradient(165deg, #151222 0%, #0e0c16 100%);
  border: 1px solid rgba(139,92,246,0.14);
  border-radius: 18px;
  padding: 20px 20px 18px;
  box-shadow: 0 12px 30px rgba(0,0,0,0.35);
}
.notice h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
  font-weight: 800;
  margin-bottom: 10px;
}
.notice p {
  color: var(--muted);
  font-size: 0.84rem;
  line-height: 1.55;
  margin-bottom: 14px;
}

.foot {
  margin-top: 18px;
  text-align: center;
  color: #6b7280;
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.foot a { color: #6b7280; }
.back-link {
  margin-top: 10px;
  text-align: center;
  font-size: 0.8rem;
  color: #6b7280;
}
.back-link a { color: #9ca3af; }

/* ========== PAINEL ========== */
.panel {
  max-width: 980px;
  margin: 0 auto;
  padding: 18px 14px 50px;
}
.crumb {
  color: #6b7280;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.panel-head h1 {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.35rem;
  font-weight: 800;
}
.panel-head h1::before {
  content: "";
  width: 4px;
  height: 22px;
  border-radius: 2px;
  background: var(--accent);
  box-shadow: 0 0 12px var(--accent-glow);
}

.btn-sm {
  width: auto;
  padding: 8px 12px;
  font-size: 0.72rem;
  border-radius: 999px;
  letter-spacing: 0.04em;
}
.btn-ghost {
  background: #161322;
  color: var(--text);
  border: 1px solid #2a2640;
}
.btn-ghost:hover { background: #1c1830; }

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(135px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}
.stat {
  position: relative;
  background: #0e0c16;
  border: 1px solid #1c1830;
  border-radius: 14px;
  padding: 14px 12px 12px 16px;
  overflow: hidden;
}
.stat::before {
  content: "";
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--accent);
}
.stat .v {
  font-size: 1.35rem;
  font-weight: 800;
  color: var(--accent);
  line-height: 1.1;
}
.stat .l {
  margin-top: 4px;
  font-size: 0.64rem;
  color: var(--muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 600;
}

.box {
  background: #0e0c16;
  border: 1px solid #1c1830;
  border-radius: 16px;
  padding: 18px;
  margin-bottom: 14px;
}
.box-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.box-title h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  font-weight: 800;
}
.box-title h2::before {
  content: "";
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--accent);
}
.box-title .hint {
  font-size: 0.72rem;
  color: var(--muted);
}

.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pills span {
  border: 1px solid #2a2640;
  background: #13111c;
  color: var(--muted);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 0.72rem;
  font-weight: 700;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 640px) {
  .grid2 { grid-template-columns: 1fr; }
}

label.small {
  display: block;
  margin-bottom: 6px;
  font-size: 0.68rem;
  color: var(--muted);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 700;
}
select, .input-left {
  width: 100%;
  background: #0a0912;
  border: 1px solid #2a2640;
  border-radius: 11px;
  color: var(--text);
  font-size: 0.95rem;
  padding: 13px 14px;
  outline: none;
  text-align: left;
  letter-spacing: normal;
  text-transform: none;
}
select:focus, .input-left:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.search-row {
  display: flex;
  gap: 10px;
}
.search-row .input-left { flex: 1; }
.search-row .btn { width: auto; white-space: nowrap; }

.table-wrap { overflow-x: auto; }
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
}
th, td {
  padding: 11px 10px;
  border-bottom: 1px solid #1a1628;
  text-align: left;
}
th {
  color: var(--muted);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 700;
}
tr:hover td { background: rgba(139,92,246,0.04); }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--accent);
  font-size: 0.84rem;
}

.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.mass {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 12px;
}
.mass .tag {
  font-size: 0.68rem;
  color: var(--muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 700;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 800;
}
.badge-green { background: rgba(34,197,94,0.12); color: var(--green); border: 1px solid rgba(34,197,94,0.25); }
.badge-red { background: rgba(239,68,68,0.12); color: var(--red); border: 1px solid rgba(239,68,68,0.25); }
.badge-yellow { background: rgba(234,179,8,0.12); color: var(--yellow); border: 1px solid rgba(234,179,8,0.25); }
.badge-purple { background: rgba(139,92,246,0.12); color: var(--accent); border: 1px solid rgba(139,92,246,0.25); }
.key-chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 7px 13px;
  border-radius: 999px;
  background: rgba(139,92,246,0.12);
  border: 1px solid rgba(139,92,246,0.35);
  color: var(--accent);
  font: 800 0.78rem/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.04em;
  cursor: pointer;
  white-space: nowrap;
}
.key-chip:hover { background: rgba(139,92,246,0.22); }

.toast {
  position: fixed;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  background: #161322;
  border: 1px solid var(--accent);
  color: #fff;
  padding: 12px 20px;
  border-radius: 12px;
  font-size: 0.88rem;
  z-index: 50;
  display: none;
  box-shadow: 0 10px 30px rgba(0,0,0,0.45);
}
.toast.show { display: block; }
.result-box { margin-top: 16px; text-align: center; }

/* ========== TELA DOWNLOAD (verde, igual foto) ========== */
.download-card {
  background: linear-gradient(165deg, #0a1410 0%, #07100c 100%);
  border: 1px solid rgba(34,197,94,0.2);
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.02) inset,
    0 25px 50px rgba(0,0,0,0.55),
    0 0 80px rgba(34,197,94,0.1);
}

#screen-download {
  background:
    radial-gradient(ellipse 90% 55% at 50% -15%, rgba(34,197,94,0.16) 0%, transparent 55%),
    radial-gradient(ellipse 70% 40% at 50% 110%, rgba(0,40,20,0.3) 0%, transparent 50%),
    #050508;
  min-height: 100vh;
  width: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.dl-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
}
.dl-brand {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
}
.dl-brand .sec { color: #fff; }
.dl-brand .pan { color: #22c55e; }

.dl-auth {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 800;
  color: #22c55e;
  background: rgba(34,197,94,0.1);
  border: 1px solid rgba(34,197,94,0.35);
  letter-spacing: 0.04em;
}
.dl-auth i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 8px #22c55e;
}

.dl-icon {
  width: 72px;
  height: 72px;
  margin: 0 auto 18px;
  border-radius: 20px;
  background: #0a1210;
  border: 1px solid rgba(34,197,94,0.35);
  box-shadow: 0 0 28px rgba(34,197,94,0.25);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dl-title {
  text-align: center;
  font-size: 1.35rem;
  font-weight: 800;
  margin-bottom: 8px;
}
.dl-sub {
  text-align: center;
  color: var(--muted);
  font-size: 0.88rem;
  line-height: 1.45;
  margin-bottom: 22px;
}

.btn-download {
  color: #fff;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  box-shadow: 0 8px 28px rgba(34,197,94,0.35);
  margin-bottom: 16px;
  text-decoration: none;
}
.btn-download:hover { filter: brightness(1.08); transform: translateY(-1px); }

.dl-session {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #0a100e;
  border: 1px solid #1a2a22;
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.dl-sess-label {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: var(--muted);
}
.dl-sess-key {
  display: inline-flex;
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 0.78rem;
  font-weight: 800;
  color: #ef4444;
  background: rgba(239,68,68,0.12);
  border: 1px solid rgba(239,68,68,0.35);
  letter-spacing: 0.04em;
}

.btn-exit {
  color: #fca5a5;
  background: rgba(127,29,29,0.35);
  border: 1px solid rgba(239,68,68,0.35);
  box-shadow: none;
}
.btn-exit:hover { background: rgba(127,29,29,0.5); }

/* aliases usados no HTML */
.panel-container { max-width: 980px; margin: 0 auto; padding: 18px 14px 50px; }
.container { max-width: 420px; margin: 0 auto; padding: 32px 16px 48px; }
.header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:18px; flex-wrap:wrap; }
.header h2 { display:flex; align-items:center; gap:10px; font-size:1.35rem; font-weight:800; }
.header h2::before { content:""; width:4px; height:22px; border-radius:2px; background:var(--accent); box-shadow:0 0 12px var(--accent-glow); }
.section { background:#0e0c16; border:1px solid #1c1830; border-radius:16px; padding:18px; margin-bottom:14px; }
.section h3 { display:flex; align-items:center; gap:8px; font-size:0.9rem; font-weight:800; margin-bottom:12px; }
.section h3::before { content:""; width:3px; height:14px; border-radius:2px; background:var(--accent); }
.label { display:block; margin-bottom:6px; font-size:0.68rem; color:var(--muted); letter-spacing:0.1em; text-transform:uppercase; font-weight:700; }
.btn-primary { color:#fff; background:linear-gradient(135deg,#8b5cf6,#6d28d9); box-shadow:0 8px 28px var(--accent-glow); }
.btn-secondary { background:#161322; color:var(--text); border:1px solid #2a2640; }
.grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
@media (max-width:640px){ .grid-2{ grid-template-columns:1fr; } }
.footer { text-align:center; color:#6b7280; font-size:0.68rem; letter-spacing:0.16em; text-transform:uppercase; margin-top:18px; }
.aviso { width:100%; max-width:380px; margin-top:16px; background:linear-gradient(165deg,#151222 0%,#0e0c16 100%); border:1px solid rgba(139,92,246,0.14); border-radius:18px; padding:20px; }
.subtitle { text-align:center; margin:8px 0 18px; font-size:0.7rem; letter-spacing:0.35em; color:var(--muted); text-transform:uppercase; }

/* Inputs escuros no mobile (teclado / autofill / focus) */
input, select, textarea {
  background: #0a0912 !important;
  color: #f8fafc !important;
  border: 1px solid #2a2640 !important;
  -webkit-text-fill-color: #f8fafc !important;
  caret-color: #8b5cf6 !important;
}
input::placeholder, textarea::placeholder {
  color: #6b7280 !important;
  -webkit-text-fill-color: #6b7280 !important;
  opacity: 1 !important;
}
input:focus, select:focus, textarea:focus {
  background: #0a0912 !important;
  color: #f8fafc !important;
  border-color: #8b5cf6 !important;
  -webkit-text-fill-color: #f8fafc !important;
}
/* iOS / Chrome autofill branco */
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus,
input:-webkit-autofill:active {
  -webkit-box-shadow: 0 0 0 1000px #0a0912 inset !important;
  -webkit-text-fill-color: #f8fafc !important;
  caret-color: #8b5cf6 !important;
  transition: background-color 9999s ease-in-out 0s;
}
select option {
  background: #0a0912;
  color: #f8fafc;
}
`;
}

function layout(title, body, opts = {}) {
  const siteName = setting('site_name', 'PROXY WIRE');
  const css = getInlineCss();
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — ${esc(siteName)}</title>
  <style>${css}</style>
  ${themeStyle()}
</head>
<body>
${body}
<div class="toast" id="toast"></div>
<script>
function showToast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800);}
async function post(url,data){const body=new URLSearchParams();for(const[k,v]of Object.entries(data))body.append(k,v ?? '');const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body});return r.json();}
</script>
${opts.extraScript || ''}
</body>
</html>`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function loginForm(panelTitle, actionUrl, error = '') {
  const aviso = setting('aviso_texto', '');
  const whatsapp = setting('aviso_whatsapp', '');
  return `
  <div class="wrap">
    <div class="card">
      <div class="logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" width="26" height="26">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <div class="brand">PAINEL <span>${esc(panelTitle)}</span></div>
      <div class="tagline">ÁREA DO ${esc(panelTitle)}</div>
      ${error ? `<div style="background:rgba(239,68,68,0.12);border:1px solid #ef4444;border-radius:12px;padding:12px;margin-bottom:14px;text-align:center;color:#ef4444;font-size:0.88rem;">${esc(error)}</div>` : ''}
      <form method="post" action="${actionUrl}">
        <label class="field-label">CÓDIGO DE ACESSO</label>
        <input class="input" type="text" name="access_code" placeholder="DIGITE O CÓDIGO" autocomplete="off" required>
        <button type="submit" class="btn btn-main">ENTRAR NO PAINEL</button>
      </form>
    </div>
    ${aviso ? `
    <div class="notice">
      <h3>📢 AVISOS E ATUALIZAÇÕES</h3>
      <p>${esc(aviso).replace(/\n/g,'<br>')}</p>
      ${whatsapp ? `<a href="${esc(whatsapp)}" target="_blank" class="btn btn-wa">📱 ENTRAR NO WHATSAPP</a>` : ''}
    </div>` : ''}
    <div class="back-link"><a href="/">← Voltar ao site principal</a></div>
    <div class="foot">SECURE PANEL V5.0</div>
  </div>`;
}

// ============================================================
//  PÚBLICO — /  (ativar key + download)
// ============================================================
app.get('/', (req, res) => {
  const siteName = setting('site_name', 'PROXY WIRE');
  const siteSub = setting('site_sub', 'RED');
  const aviso = setting('aviso_texto', '');
  const whatsapp = setting('aviso_whatsapp', '');
  const download = setting('download_url', '');

  const body = `
  <div class="wrap" id="screen-login">
    <div class="card">
      <div class="logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <div class="brand">${esc(siteName)} <span>${esc(siteSub)}</span></div>
      <div class="tagline">K W A I &nbsp; L I T E</div>
      <div class="status-pill"><span><i></i> SYSTEM UNDETECTED</span></div>
      <form id="activateForm">
        <label class="field-label">ACCESS KEY</label>
        <input class="input" type="text" id="keyInput" placeholder="XXXX-XXXX-XXXX" autocomplete="off" required>
        <button type="submit" class="btn btn-main">AUTHORIZE</button>
      </form>
      <div id="result" class="result-box" style="display:none;"></div>
    </div>
    ${aviso ? `
    <div class="notice">
      <h3>📢 AVISOS E ATUALIZAÇÕES</h3>
      <p>${esc(aviso).replace(/\n/g,'<br>')}</p>
      ${whatsapp ? `<a href="${esc(whatsapp)}" target="_blank" class="btn btn-wa">📱 ENTRAR NO WHATSAPP</a>` : ''}
    </div>` : ''}
    <div class="foot">SECURE CONNECTION · DO NOT SHARE</div>
  </div>

  <div class="wrap" id="screen-download" style="display:none;">
    <div class="card download-card">
      <div class="dl-top">
        <div class="dl-brand"><span class="sec">SECURE</span> <span class="pan">PANEL</span></div>
        <span class="dl-auth"><i></i> AUTORIZADO</span>
      </div>
      <div class="dl-icon">
        <svg viewBox="0 0 48 48" width="42" height="42">
          <rect x="14" y="6" width="20" height="36" rx="4" fill="#111" stroke="#333" stroke-width="1.5"/>
          <rect x="17" y="11" width="14" height="22" rx="1.5" fill="#1a1a2e"/>
          <circle cx="20" cy="15" r="1.3" fill="#ef4444"/>
          <circle cx="24" cy="15" r="1.3" fill="#22c55e"/>
          <circle cx="28" cy="15" r="1.3" fill="#3b82f6"/>
          <rect x="18" y="19" width="4" height="4" rx="0.8" fill="#f59e0b"/>
          <rect x="23" y="19" width="4" height="4" rx="0.8" fill="#8b5cf6"/>
          <rect x="28" y="19" width="3" height="4" rx="0.8" fill="#06b6d4"/>
          <rect x="18" y="25" width="4" height="4" rx="0.8" fill="#ec4899"/>
          <rect x="23" y="25" width="4" height="4" rx="0.8" fill="#14b8a6"/>
          <rect x="28" y="25" width="3" height="4" rx="0.8" fill="#a3e635"/>
        </svg>
      </div>
      <h2 class="dl-title">Baixar Aplicativo</h2>
      <p class="dl-sub">Toque no botão abaixo para<br>iniciar o download do APK</p>
      <a id="btnDownload" href="#" class="btn btn-download">⬇ ABAIXAR APK</a>
      <div class="dl-session">
        <span class="dl-sess-label">SESSÃO</span>
        <span class="dl-sess-key" id="sessionKey">—</span>
      </div>
      <button type="button" class="btn btn-exit" onclick="trocarKey()">▣ SAIR / TROCAR KEY</button>
      <div class="foot" style="margin-top:18px;">SECURE PANEL V5.0</div>
    </div>
  </div>

  <script>
    const downloadUrl = ${JSON.stringify(download)};

    function showDownload(key) {
      document.getElementById('screen-login').style.display = 'none';
      document.getElementById('screen-download').style.display = 'flex';
      document.getElementById('sessionKey').textContent = key;
      const btn = document.getElementById('btnDownload');
      if (downloadUrl) {
        btn.href = downloadUrl;
        btn.removeAttribute('onclick');
      } else {
        btn.href = '#';
        btn.onclick = (e) => { e.preventDefault(); showToast('Link de download ainda não configurado'); };
      }
      try { sessionStorage.setItem('pw_key', key); } catch(_) {}
    }

    function trocarKey() {
      try { sessionStorage.removeItem('pw_key'); } catch(_) {}
      document.getElementById('screen-download').style.display = 'none';
      document.getElementById('screen-login').style.display = 'flex';
      document.getElementById('keyInput').value = '';
      document.getElementById('result').style.display = 'none';
    }

    // Se já tinha sessão válida no navegador, mostra download
    try {
      const saved = sessionStorage.getItem('pw_key');
      if (saved) showDownload(saved);
    } catch(_) {}

    document.getElementById('activateForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = document.getElementById('keyInput').value.trim().toUpperCase();
      if (!key) return;
      const btn = e.target.querySelector('button');
      btn.disabled = true; btn.textContent = 'VERIFICANDO...';
      try {
        const res = await fetch('/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check', key, hwid: '' })
        });
        const data = await res.json();
        if (data.success && data.valid) {
          showDownload(key);
        } else {
          const box = document.getElementById('result');
          box.style.display = 'block';
          box.innerHTML = '<div class="badge badge-red">✕ ' + (data.error || 'Key inválida') + '</div>';
        }
      } catch (err) { showToast('Erro de conexão'); }
      btn.disabled = false; btn.textContent = 'AUTHORIZE';
    });
  </script>`;

  res.send(layout(siteName, body));
});

// ============================================================
//  API — /api
// ============================================================
// Health / teste da API
app.get('/api', (req, res) => {
  res.json({
    ok: true,
    status: 'online',
    message: 'API funcionando',
    time: new Date().toISOString(),
    version: '5.0'
  });
});

app.get('/api/health', (req, res) => {
  try {
    const keys = db.prepare('SELECT COUNT(*) as c FROM license_keys').get().c;
    const users = db.prepare('SELECT COUNT(*) as c FROM panel_users').get().c;
    res.json({
      ok: true,
      status: 'online',
      message: 'API funcionando',
      database: 'ok',
      keys,
      users,
      time: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ ok: false, status: 'error', message: String(e.message || e) });
  }
});

function validateKey(req, res) {
  const now = Math.floor(Date.now() / 1000);
  const ip = clientIp(req);
  const action = String(req.body.action || 'login').toLowerCase();
  const keyCode = String(req.body.key || req.body.code || '').trim().toUpperCase();
  const hwid = String(req.body.hwid || '').trim();

  // Rate limit
  const rl = parseInt(setting('rate_limit', '60'), 10) || 60;
  if (rl > 0) {
    const cut = now - 60;
    db.prepare("DELETE FROM rate_hits WHERE created_at < ?").run(cut);
    const cnt = db.prepare("SELECT COUNT(*) as c FROM rate_hits WHERE scope='api' AND ip=? AND created_at>?").get(ip, cut).c;
    if (cnt >= rl) {
      return res.json({ success: false, valid: false, error: 'RATE_LIMITED', code: 'RATE_LIMITED' });
    }
    db.prepare("INSERT INTO rate_hits (scope, ip, created_at) VALUES ('api',?,?)").run(ip, now);
  }

  if (!keyCode) {
    return res.json({ success: false, valid: false, error: 'Key obrigatória', code: 'MISSING_KEY' });
  }

  const key = db.prepare('SELECT * FROM license_keys WHERE code_norm = ?').get(keyCode);
  if (!key) {
    logApi(keyCode, hwid, ip, 'not_found');
    return res.json({ success: false, valid: false, error: 'Key inválida', code: 'INVALID_KEY' });
  }

  const status = keyStatus(key, now);
  if (status === 'banned') {
    logApi(keyCode, hwid, ip, 'banned', key.id);
    return res.json({ success: false, valid: false, error: 'Key banida', code: 'BANNED' });
  }
  if (status === 'paused') {
    logApi(keyCode, hwid, ip, 'paused', key.id);
    return res.json({ success: false, valid: false, error: 'Key pausada', code: 'PAUSED' });
  }
  if (status === 'expired') {
    logApi(keyCode, hwid, ip, 'expired', key.id);
    return res.json({ success: false, valid: false, error: 'Key expirada', code: 'EXPIRED' });
  }

  const maxDev = Math.max(1, key.max_devices | 0);
  const devCount = db.prepare('SELECT COUNT(*) as c FROM key_devices WHERE key_id = ?').get(key.id).c;
  let hwidExists = false;
  if (hwid) {
    hwidExists = !!db.prepare('SELECT id FROM key_devices WHERE key_id = ? AND hwid = ?').get(key.id, hwid);
  }

  if ((action === 'login' || action === 'check') && hwid && !hwidExists && devCount >= maxDev) {
    logApi(keyCode, hwid, ip, 'max_devices', key.id);
    return res.json({
      success: false, valid: false,
      error: 'Esta key está sendo usada em outro dispositivo',
      code: 'MAX_DEVICES',
      message: 'Esta key está sendo usada em outro dispositivo'
    });
  }

  if (action === 'login' && hwid && !hwidExists) {
    db.prepare('INSERT INTO key_devices (key_id, hwid, first_seen, last_seen, ip) VALUES (?,?,?,?,?)')
      .run(key.id, hwid, now, now, ip);
  } else if (hwid && hwidExists) {
    db.prepare('UPDATE key_devices SET last_seen=?, ip=? WHERE key_id=? AND hwid=?')
      .run(now, ip, key.id, hwid);
  }

  if (!key.activated_at) {
    const duration = key.validade_seconds | 0;
    const expires = duration > 0 ? now + duration : null;
    db.prepare('UPDATE license_keys SET activated_at=?, expires_at=?, last_check=?, last_ip=?, total_checks=total_checks+1 WHERE id=?')
      .run(now, expires, now, ip, key.id);
    key.activated_at = now;
    key.expires_at = expires;
  } else {
    db.prepare('UPDATE license_keys SET last_check=?, last_ip=?, total_checks=total_checks+1 WHERE id=?')
      .run(now, ip, key.id);
  }

  const remaining = key.expires_at ? Math.max(0, key.expires_at - now) : 0;
  logApi(keyCode, hwid, ip, 'ok', key.id);

  res.json({
    success: true, valid: true,
    data: {
      key: key.code,
      status: keyStatus(key, now),
      activated_at: key.activated_at,
      expires_at: key.expires_at,
      remaining,
      remaining_human: humanLeft(remaining),
      max_devices: maxDev,
      devices: devCount + (hwid && !hwidExists ? 1 : 0),
    }
  });
}

app.post('/api', validateKey);
app.post('/api/proxy/q/validate-key', validateKey);
app.get('/api/license/validate', (req, res) => {
  req.body = {
    action: String(req.query.action || 'check'),
    key: String(req.query.key || req.query.code || ''),
    hwid: String(req.query.hwid || '')
  };
  validateKey(req, res);
});

// Compatibilidade com o protocolo usado pelo APK Proxy-Android-External.
// O APK envia {op, key, hwid, nonce} e espera {nonce, ok, expiresAt}.
function validateBrevent(req, res) {
  const now = Math.floor(Date.now() / 1000);
  const nonce = String(req.body?.nonce || '');
  const keyCode = String(req.body?.key || '').trim().toUpperCase();
  const hwid = String(req.body?.hwid || '').trim();
  const reply = (ok, reason, expiresAt = 0) => res.json({
    nonce,
    ok,
    reason,
    expiresAt,
  });

  if (!keyCode || keyCode.length > 100) return reply(false, 'invalid');
  const key = db.prepare('SELECT * FROM license_keys WHERE code_norm=?').get(keyCode);
  if (!key) {
    logApi(keyCode, hwid, clientIp(req), 'not_found');
    return reply(false, 'invalid');
  }

  const status = keyStatus(key, now);
  if (status === 'expired') return reply(false, 'expired');
  if (status === 'paused') return reply(false, 'paused');
  if (status === 'banned') return reply(false, 'banned');

  const maxDev = Math.max(1, key.max_devices | 0);
  const existing = hwid ? db.prepare('SELECT id FROM key_devices WHERE key_id=? AND hwid=?').get(key.id, hwid) : null;
  const deviceCount = db.prepare('SELECT COUNT(*) as c FROM key_devices WHERE key_id=?').get(key.id).c;
  if (hwid && !existing && deviceCount >= maxDev) {
    logApi(keyCode, hwid, clientIp(req), 'invalid_hwid', key.id);
    return reply(false, 'invalid_hwid');
  }

  const ip = clientIp(req);
  if (hwid && !existing) {
    db.prepare('INSERT INTO key_devices (key_id, hwid, first_seen, last_seen, ip) VALUES (?,?,?,?,?)')
      .run(key.id, hwid, now, now, ip);
  } else if (existing) {
    db.prepare('UPDATE key_devices SET last_seen=?, ip=? WHERE key_id=? AND hwid=?')
      .run(now, ip, key.id, hwid);
  }

  let expiresAt = key.expires_at;
  if (!key.activated_at) {
    const duration = key.validade_seconds | 0;
    expiresAt = duration > 0 ? now + duration : now + (10 * 365 * 86400);
    db.prepare('UPDATE license_keys SET activated_at=?, expires_at=?, last_check=?, last_ip=?, total_checks=total_checks+1 WHERE id=?')
      .run(now, expiresAt, now, ip, key.id);
  } else {
    db.prepare('UPDATE license_keys SET last_check=?, last_ip=?, total_checks=total_checks+1 WHERE id=?')
      .run(now, ip, key.id);
  }

  logApi(keyCode, hwid, ip, 'ok', key.id);
  return reply(true, 'valid', expiresAt * 1000);
}

app.post('/brevent/validate.php', validateBrevent);

function logApi(keyCode, hwid, ip, result, keyId = null) {
  try {
    db.prepare('INSERT INTO api_logs (key_code, hwid, ip, result, key_id, created_at) VALUES (?,?,?,?,?,?)')
      .run(keyCode?.slice(0, 100), hwid?.slice(0, 191) || null, ip?.slice(0, 64), result, keyId, Math.floor(Date.now() / 1000));
  } catch (_) {}
}

// ============================================================
//  /revendedor
// ============================================================
app.get('/revendedor', (req, res) => {
  if (req.query.logout) {
    panelLogout(req, res);
    return res.redirect('/revendedor');
  }
  const user = panelUser(req);
  if (!user || !['revendedor', 'adm', 'dono'].includes(user.role)) {
    return res.send(layout('Revendedor', loginForm('REVENDEDOR', '/revendedor')));
  }
  res.send(layout('Revendedor', renderRevendedor(user)));
});

app.post('/revendedor', (req, res) => {
  // Login
  if (req.body.access_code) {
    const result = panelLogin(req.body.access_code);
    if (!result) {
      return res.send(layout('Revendedor', loginForm('REVENDEDOR', '/revendedor', 'Código inválido ou conta desativada')));
    }
    setSessionCookie(res, result.token, result.exp);
    if (result.user.role === 'dono') return res.redirect('/dono');
    if (result.user.role === 'adm') return res.redirect('/admin');
    return res.redirect('/revendedor');
  }

  const user = panelUser(req);
  if (!user || !['revendedor', 'adm', 'dono'].includes(user.role)) {
    return res.status(401).json({ ok: false, error: 'Não autorizado' });
  }

  const action = req.body.action;
  const now = Math.floor(Date.now() / 1000);

  if (action === 'generate') {
    const seconds = Math.max(0, parseInt(String(req.body.seconds || '0'), 10) || 0);
    const qty = Math.max(1, Math.min(50, parseInt(String(req.body.qty || '1'), 10) || 1));
    if (seconds <= 0) {
      return res.json({ ok: false, error: 'Selecione uma duração válida (a key não pode ser lifetime por engano)' });
    }
    const priceRow = db.prepare('SELECT price FROM key_prices WHERE seconds=? AND active=1').get(seconds);
    const unitPrice = priceRow ? Number(priceRow.price) : 0;
    const totalCost = unitPrice * qty;

    if (!user.infinite_credits && Number(user.credits) < totalCost) {
      return res.json({ ok: false, error: 'Créditos insuficientes' });
    }

    const prefix = user.prefix || 'KEY';
    // max dispositivos: do request (se mandar) senão do usuário, padrão 1
    let maxDev = parseInt(String(req.body.max_devices || ''), 10);
    if (!maxDev || maxDev < 1) maxDev = parseInt(String(user.max_devices || '1'), 10) || 1;
    maxDev = Math.max(1, Math.min(5, maxDev));

    const generated = [];
    const insert = db.prepare('INSERT INTO license_keys (code, code_norm, validade_seconds, max_devices, status, owner_id, created_at) VALUES (?,?,?,?,?,?,?)');

    const tx = db.transaction(() => {
      for (let i = 0; i < qty; i++) {
        let code = generateKeyCode(prefix);
        for (let tries = 0; tries < 10; tries++) {
          if (!db.prepare('SELECT id FROM license_keys WHERE code_norm=?').get(code.toUpperCase())) break;
          code = generateKeyCode(prefix);
        }
        insert.run(code, code.toUpperCase(), seconds, maxDev, 'active', user.id, now);
        generated.push(code);
      }
      if (!user.infinite_credits) {
        db.prepare('UPDATE panel_users SET credits = credits - ? WHERE id = ?').run(totalCost, user.id);
      }
    });
    tx();
    const fresh = db.prepare('SELECT credits, infinite_credits FROM panel_users WHERE id=?').get(user.id);
    return res.json({
      ok: true,
      keys: generated,
      credits: fresh.infinite_credits ? 999999 : fresh.credits,
      seconds,
      max_devices: maxDev
    });
  }

  if (action === 'toggle_pause') {
    const id = parseInt(req.body.id, 10);
    const k = db.prepare('SELECT * FROM license_keys WHERE id=? AND owner_id=?').get(id, user.id);
    if (!k) return res.json({ ok: false, error: 'Key não encontrada' });
    const neu = k.status === 'paused' ? 'active' : 'paused';
    db.prepare('UPDATE license_keys SET status=?, paused_at=? WHERE id=?').run(neu, neu === 'paused' ? now : null, id);
    return res.json({ ok: true, status: neu });
  }

  if (action === 'reset_devices') {
    const id = parseInt(req.body.id, 10);
    const k = db.prepare('SELECT id FROM license_keys WHERE id=? AND owner_id=?').get(id, user.id);
    if (!k) return res.json({ ok: false, error: 'Key não encontrada' });
    db.prepare('DELETE FROM key_devices WHERE key_id=?').run(id);
    return res.json({ ok: true });
  }

  if (action === 'delete') {
    const id = parseInt(req.body.id, 10);
    const k = db.prepare('SELECT id FROM license_keys WHERE id=? AND owner_id=?').get(id, user.id);
    if (!k) return res.json({ ok: false, error: 'Key não encontrada' });
    db.prepare('DELETE FROM key_devices WHERE key_id=?').run(id);
    db.prepare('DELETE FROM license_keys WHERE id=?').run(id);
    return res.json({ ok: true });
  }

  if (action === 'pause_all' || action === 'unpause_all') {
    const neu = action === 'pause_all' ? 'paused' : 'active';
    db.prepare("UPDATE license_keys SET status=?, paused_at=? WHERE owner_id=? AND status IN ('active','paused')")
      .run(neu, neu === 'paused' ? now : null, user.id);
    return res.json({ ok: true });
  }

  res.json({ ok: false, error: 'Ação desconhecida' });
});

function renderRevendedor(user) {
  const keys = db.prepare('SELECT * FROM license_keys WHERE owner_id=? ORDER BY id DESC').all(user.id);
  const prices = db.prepare('SELECT * FROM key_prices WHERE active=1 ORDER BY sort_order').all();
  const now = Math.floor(Date.now() / 1000);
  let ativas = 0, pausadas = 0, expiradas = 0, emUso = 0, semDisp = 0;
  for (const k of keys) {
    const s = keyStatus(k, now);
    if (s === 'active' || s === 'lifetime') ativas++;
    if (s === 'paused') pausadas++;
    if (s === 'expired') expiradas++;
    const dc = db.prepare('SELECT COUNT(*) as c FROM key_devices WHERE key_id=?').get(k.id).c;
    if (dc > 0) emUso++; else semDisp++;
  }
  const creditsDisplay = user.infinite_credits ? '∞' : Number(user.credits).toFixed(2).replace('.', ',');

  const rows = keys.map(k => {
    const stt = keyStatus(k, now);
    const badge = (stt === 'active' || stt === 'lifetime') ? 'badge-green' : stt === 'paused' ? 'badge-yellow' : 'badge-red';
    const dc = db.prepare('SELECT COUNT(*) as c FROM key_devices WHERE key_id=?').get(k.id).c;
    const dur = k.validade_seconds > 0 ? humanLeft(k.validade_seconds) : 'Vitalícia';
    return `<tr data-id="${k.id}">
      <td><code style="color:var(--red);font-size:0.85rem;">${esc(k.code)}</code></td>
      <td>${dur}</td>
      <td><span class="badge ${badge}">${stt.toUpperCase()}</span></td>
      <td>${dc}/${k.max_devices}</td>
      <td class="actions">
        <button class="btn btn-secondary btn-sm" onclick="togglePause(${k.id})">${stt === 'paused' ? 'Despausar' : 'Pausar'}</button>
        <button class="btn btn-secondary btn-sm" onclick="resetDev(${k.id})">Reset IP</button>
        <button class="btn btn-secondary btn-sm" style="color:var(--red)" onclick="delKey(${k.id})">Apagar</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px;">Nenhuma key gerada ainda</td></tr>';

  const priceOpts = prices.map(p =>
    `<option value="${p.seconds}" data-price="${p.price}">${esc(p.label)} — R$ ${Number(p.price).toFixed(2).replace('.', ',')}</option>`
  ).join('');

  const planPills = prices.map(p =>
    `<span>${esc(p.label)}</span>`
  ).join('');

  const disponiveis = keys.filter(k => {
    const s = keyStatus(k, now);
    const dc = db.prepare('SELECT COUNT(*) as c FROM key_devices WHERE key_id=?').get(k.id).c;
    return (s === 'active' || s === 'lifetime') && dc === 0;
  }).length;

  return `
  <div class="panel-container">
    <div class="header-top">PAINEL / REVENDEDOR</div>
    <div class="header">
      <h2>${esc(user.prefix || 'CLASH')}</h2>
      <div style="display:flex;gap:10px;align-items:center;">
        <span class="badge badge-red">${esc(user.role)}</span>
        <a href="?logout=1" class="btn btn-secondary btn-sm">← Sair</a>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="value" id="creditos">${creditsDisplay}</div><div class="label">CRÉDITOS · Saldo atual</div></div>
      <div class="stat"><div class="value">${esc(user.prefix || '—')}</div><div class="label">PREFIXO · Suas keys</div></div>
      <div class="stat"><div class="value">${keys.length}</div><div class="label">TOTAL · Keys geradas</div></div>
      <div class="stat"><div class="value">${emUso}</div><div class="label">EM USO · Keys ativas</div></div>
      <div class="stat"><div class="value">${semDisp}</div><div class="label">SEM DISPOSITIVO · Ativas sem HWID</div></div>
      <div class="stat"><div class="value">${ativas}</div><div class="label">ATIVAS · Rodando agora</div></div>
      <div class="stat"><div class="value">${disponiveis}</div><div class="label">DISPONÍVEIS · Prontas p/ vender</div></div>
      <div class="stat"><div class="value" style="color:var(--yellow)">${pausadas}</div><div class="label">PAUSADAS · Bloqueadas</div></div>
      <div class="stat"><div class="value" style="color:var(--muted)">${expiradas}</div><div class="label">EXPIRADAS · Fora do prazo</div></div>
    </div>

    <div class="section">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
        <h3 style="margin:0;">Seus Planos de Venda</h3>
        <span style="font-size:0.72rem;color:var(--muted);">Definidos pelo dono</span>
      </div>
      <div class="plan-pills">${planPills}</div>
    </div>

    <div class="section">
      <h3>Gerar Nova Key</h3>
      <p style="font-size:0.75rem;color:var(--muted);margin:-8px 0 12px;">Escolha duração e quantidade</p>
      <div class="grid-2">
        <div><label class="label">DURAÇÃO</label><select id="duration">${priceOpts}</select></div>
        <div><label class="label">QUANTIDADE</label><input type="number" id="qty" value="1" min="1" max="50"></div>
      </div>
      <button class="btn btn-primary" style="margin-top:14px;width:auto;padding:12px 28px;" onclick="gerarKeys()">GERAR KEYS</button>
      <div id="generatedBox" style="display:none;margin-top:16px;"></div>
    </div>

    <div class="section">
      <h3>Pesquisar Key</h3>
      <p style="font-size:0.75rem;color:var(--muted);margin:-8px 0 12px;">Busque por prefixo/nome da key</p>
      <div class="search-row">
        <input type="text" id="searchKey" placeholder="Digite o prefixo ou nome da key (ex: JOAO, ABC1)" oninput="filtrarKeys()">
        <button class="btn btn-primary btn-sm" style="padding:12px 18px;" onclick="filtrarKeys()">BUSCAR</button>
      </div>
    </div>

    <div class="section">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
        <h3 style="margin:0;">Suas Keys</h3>
        <button class="btn btn-secondary btn-sm" onclick="copiarTodas()">📋 COPIAR TODAS (${keys.length})</button>
      </div>
      <div class="mass-actions">
        <span class="tag">AÇÕES EM MASSA</span>
        <button class="btn btn-secondary btn-sm" onclick="bulk('pause_all')">PAUSAR TODAS</button>
        <button class="btn btn-secondary btn-sm" onclick="bulk('unpause_all')">DESPAUSAR TODAS (${pausadas})</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>CHAVE</th><th>DURAÇÃO</th><th>STATUS</th><th>HWID</th><th>AÇÕES</th></tr></thead>
          <tbody id="keysBody">${rows}</tbody>
        </table>
      </div>
    </div>
    <p class="footer">SECURE PANEL V5.0</p>
  </div>
  <script>
    async function gerarKeys(){
      const res=await post('/revendedor',{action:'generate',seconds:document.getElementById('duration').value,qty:document.getElementById('qty').value});
      if(!res.ok)return showToast(res.error||'Erro');
      document.getElementById('creditos').textContent=res.credits===999999?'∞':Number(res.credits).toFixed(2).replace('.',',');
      const box=document.getElementById('generatedBox');
      box.style.display='block';
      box.innerHTML='<p style="color:var(--green);margin-bottom:8px;">✓ '+res.keys.length+' key(s) gerada(s):</p>'+
        res.keys.map(k=>'<code style="display:block;background:#0d0d14;padding:8px 12px;border-radius:8px;margin:4px 0;color:var(--red);cursor:pointer;">'+k+'</code>').join('');
      box.querySelectorAll('code').forEach(el=>el.addEventListener('click',()=>navigator.clipboard.writeText(el.textContent)));
      showToast('Keys geradas!');
      setTimeout(()=>location.reload(),1500);
    }
    async function togglePause(id){const res=await post('/revendedor',{action:'toggle_pause',id});if(res.ok)location.reload();else showToast(res.error);}
    async function resetDev(id){if(!confirm('Resetar dispositivos?'))return;const res=await post('/revendedor',{action:'reset_devices',id});if(res.ok){showToast('Resetado');location.reload();}else showToast(res.error);}
    async function delKey(id){if(!confirm('Apagar esta key?'))return;const res=await post('/revendedor',{action:'delete',id});if(res.ok)location.reload();else showToast(res.error);}
    async function bulk(action){if(!confirm('Confirmar?'))return;const res=await post('/revendedor',{action});if(res.ok)location.reload();else showToast(res.error);}
    function copiarTodas(){const codes=[...document.querySelectorAll('#keysBody code')].map(c=>c.textContent).join('\\n');navigator.clipboard.writeText(codes);showToast('Copiado!');}
    function filtrarKeys(){
      const q=(document.getElementById('searchKey').value||'').toUpperCase().trim();
      document.querySelectorAll('#keysBody tr').forEach(tr=>{
        const code=(tr.querySelector('code')||{}).textContent||'';
        tr.style.display=!q||code.toUpperCase().includes(q)?'':'none';
      });
    }
  </script>`;
}

// ============================================================
//  /admin  e  /dono  (simplificado — estrutura completa)
// ============================================================
function handlePanelLogin(req, res, allowedRoles, panelPath, panelTitle) {
  if (req.body.access_code) {
    const result = panelLogin(req.body.access_code);
    if (!result) {
      res.send(layout(panelTitle, loginForm(panelTitle, panelPath, 'Código inválido ou conta desativada')));
      return null;
    }
    setSessionCookie(res, result.token, result.exp);
    if (result.user.role === 'dono') { res.redirect('/dono'); return null; }
    if (result.user.role === 'adm') { res.redirect('/admin'); return null; }
    res.redirect('/revendedor');
    return null;
  }
  const user = panelUser(req);
  if (!user || !allowedRoles.includes(user.role)) {
    res.send(layout(panelTitle, loginForm(panelTitle, panelPath)));
    return null;
  }
  return user;
}

// ---- ADMIN ----
app.get('/admin', (req, res) => {
  if (req.query.logout) { panelLogout(req, res); return res.redirect('/admin'); }
  const user = panelUser(req);
  if (!user || !['adm', 'dono'].includes(user.role)) {
    return res.send(layout('ADM', loginForm('ADM', '/admin')));
  }
  res.send(layout('ADM', renderAdmin(user)));
});

app.post('/admin', (req, res) => {
  const user = handlePanelLogin(req, res, ['adm', 'dono'], '/admin', 'ADM');
  if (!user) return;

  const action = req.body.action;
  if (action === 'create_user') {
    const prefix = String(req.body.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const credits = parseFloat(req.body.credits) || 0;
    const maxDev = Math.max(1, Math.min(5, parseInt(req.body.max_devices, 10) || 1));
    const note = String(req.body.note || '').slice(0, 190);
    if (!prefix) return res.json({ ok: false, error: 'Prefixo obrigatório' });

    let code = prefix + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    for (let i = 0; i < 5; i++) {
      if (!db.prepare('SELECT id FROM panel_users WHERE access_code=?').get(code)) break;
      code = prefix + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    }
    db.prepare(`INSERT INTO panel_users (access_code, role, prefix, credits, infinite_credits, max_devices, status, note, created_by, created_at)
      VALUES (?, 'revendedor', ?, ?, 0, ?, 'active', ?, ?, ?)`)
      .run(code, prefix, credits, maxDev, note || null, user.id, Math.floor(Date.now() / 1000));
    return res.json({ ok: true, code });
  }

  if (action === 'add_credits') {
    const uid = parseInt(req.body.user_id, 10);
    const amount = parseFloat(req.body.amount) || 0;
    const target = db.prepare("SELECT * FROM panel_users WHERE id=? AND role='revendedor'").get(uid);
    if (!target) return res.json({ ok: false, error: 'Usuário não encontrado' });
    db.prepare('UPDATE panel_users SET credits = credits + ? WHERE id = ?').run(amount, uid);
    return res.json({ ok: true });
  }

  if (action === 'toggle_user') {
    const uid = parseInt(req.body.user_id, 10);
    const target = db.prepare("SELECT * FROM panel_users WHERE id=? AND role='revendedor'").get(uid);
    if (!target) return res.json({ ok: false, error: 'Usuário não encontrado' });
    const neu = target.status === 'active' ? 'paused' : 'active';
    db.prepare('UPDATE panel_users SET status=? WHERE id=?').run(neu, uid);
    return res.json({ ok: true, status: neu });
  }

  if (action === 'ban_user') {
    const uid = parseInt(req.body.user_id, 10);
    db.prepare("UPDATE panel_users SET status='banned' WHERE id=? AND role='revendedor'").run(uid);
    return res.json({ ok: true });
  }

  // ADM pode alterar prefixo de revendedores (e o próprio)
  if (action === 'change_prefix') {
    const uid = parseInt(req.body.user_id, 10);
    const prefix = String(req.body.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!prefix) return res.json({ ok: false, error: 'Prefixo inválido' });
    const target = db.prepare('SELECT * FROM panel_users WHERE id=?').get(uid);
    if (!target) return res.json({ ok: false, error: 'Usuário não encontrado' });
    // ADM só altera revendedor ou a si mesmo
    if (target.role !== 'revendedor' && target.id !== user.id) {
      return res.json({ ok: false, error: 'Sem permissão para este usuário' });
    }
    db.prepare('UPDATE panel_users SET prefix=? WHERE id=?').run(prefix, uid);
    return res.json({ ok: true, prefix });
  }

  if (action === 'toggle_key') {
    const id = parseInt(req.body.id, 10);
    const k = db.prepare('SELECT * FROM license_keys WHERE id=?').get(id);
    if (!k) return res.json({ ok: false, error: 'Key não encontrada' });
    const status = k.status === 'paused' ? 'active' : 'paused';
    db.prepare('UPDATE license_keys SET status=?, paused_at=? WHERE id=?')
      .run(status, status === 'paused' ? now : null, id);
    return res.json({ ok: true, status });
  }

  if (action === 'delete_key') {
    const id = parseInt(req.body.id, 10);
    const k = db.prepare('SELECT id FROM license_keys WHERE id=?').get(id);
    if (!k) return res.json({ ok: false, error: 'Key não encontrada' });
    db.prepare('DELETE FROM key_devices WHERE key_id=?').run(id);
    db.prepare('DELETE FROM license_keys WHERE id=?').run(id);
    return res.json({ ok: true });
  }

  if (action === 'pause_all_resellers') {
    db.prepare("UPDATE panel_users SET status='paused' WHERE role='revendedor' AND status='active'").run();
    return res.json({ ok: true });
  }

  res.json({ ok: false, error: 'Ação desconhecida' });
});

function renderAdmin(user) {
  const resellers = db.prepare("SELECT * FROM panel_users WHERE role='revendedor' ORDER BY id DESC").all();
  const rows = resellers.map(r => {
    const b = r.status === 'active' ? 'badge-green' : r.status === 'paused' ? 'badge-yellow' : 'badge-red';
    return `<tr>
      <td><code style="color:var(--red);">${esc(r.access_code)}</code></td>
      <td>${esc(r.prefix)}</td>
      <td>${Number(r.credits).toFixed(2).replace('.', ',')}</td>
      <td><span class="badge ${b}">${r.status.toUpperCase()}</span></td>
      <td class="actions">
        <button class="btn btn-secondary btn-sm" onclick="addCred(${r.id})">+ Crédito</button>
        <button class="btn btn-secondary btn-sm" onclick="changePrefix(${r.id}, '${esc(r.prefix)}')">Prefixo</button>
        <button class="btn btn-secondary btn-sm" onclick="toggleUser(${r.id})">${r.status === 'active' ? 'Pausar' : 'Ativar'}</button>
        <button class="btn btn-secondary btn-sm" style="color:var(--red)" onclick="banUser(${r.id})">Banir</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px;">Nenhum revendedor ainda</td></tr>';

  return `
  <div class="panel-container">
    <div class="header">
      <h2>PAINEL ADM</h2>
      <div style="display:flex;gap:10px;align-items:center;">
        <span class="badge badge-red">${esc(user.role)}</span>
        <a href="/revendedor" class="btn btn-secondary btn-sm">Meu Painel</a>
        <a href="?logout=1" class="btn btn-secondary btn-sm">← Sair</a>
      </div>
    </div>
    <div class="section">
      <h3>Gerar Novo Revendedor</h3>
      <div class="grid-2">
        <div><label class="label">PREFIXO (ex: BIEL)</label><input type="text" id="prefix" placeholder="BIEL" maxlength="12" style="text-transform:uppercase;"></div>
        <div><label class="label">CRÉDITOS INICIAIS</label><input type="number" id="credits" value="0" step="0.5" min="0"></div>
        <div><label class="label">MÁX. DISPOSITIVOS POR KEY</label><input type="number" id="max_devices" value="1" min="1" max="5"></div>
        <div><label class="label">NOTA (opcional)</label><input type="text" id="note" placeholder="Nome do revendedor"></div>
      </div>
      <button class="btn btn-primary" style="margin-top:14px;" onclick="criarUser()">GERAR REVENDEDOR</button>
      <div id="newUserBox" style="display:none;margin-top:16px;"></div>
    </div>
    <div class="section">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
        <h3 style="margin:0;">Revendedores (${resellers.length})</h3>
        <button class="btn btn-secondary btn-sm" onclick="pauseAll()">Pausar Todos</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>CÓDIGO</th><th>PREFIXO</th><th>CRÉDITOS</th><th>STATUS</th><th>AÇÕES</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    <p class="footer">PROXY WIRE RED · ADM PANEL</p>
  </div>
  <script>
    async function criarUser(){
      const res=await post('/admin',{action:'create_user',prefix:document.getElementById('prefix').value.trim(),credits:document.getElementById('credits').value,max_devices:document.getElementById('max_devices').value,note:document.getElementById('note').value});
      if(!res.ok)return showToast(res.error);
      const box=document.getElementById('newUserBox');
      box.style.display='block';
      box.innerHTML='<p style="color:var(--green);">✓ Revendedor criado!</p><code style="display:block;background:#0d0d14;padding:12px;border-radius:8px;color:var(--red);font-size:1.1rem;margin-top:8px;cursor:pointer;" onclick="navigator.clipboard.writeText(\\''+res.code+'\\');showToast(\\'Copiado!\\')">'+res.code+'</code>';
      showToast('Criado!');
    }
    async function addCred(id){const amount=prompt('Valor a adicionar (negativo remove):');if(amount===null||amount==='')return;const res=await post('/admin',{action:'add_credits',user_id:id,amount});if(res.ok){showToast('Atualizado');location.reload();}else showToast(res.error);}
    async function toggleUser(id){const res=await post('/admin',{action:'toggle_user',user_id:id});if(res.ok)location.reload();else showToast(res.error);}
    async function banUser(id){if(!confirm('Banir?'))return;const res=await post('/admin',{action:'ban_user',user_id:id});if(res.ok)location.reload();else showToast(res.error);}
    async function pauseAll(){if(!confirm('Pausar TODOS os revendedores?'))return;const res=await post('/admin',{action:'pause_all_resellers'});if(res.ok)location.reload();else showToast(res.error);}
    async function changePrefix(id, atual){
      const prefix=prompt('Novo prefixo (só letras e números):', atual||'');
      if(prefix===null||prefix.trim()==='')return;
      const res=await post('/admin',{action:'change_prefix',user_id:id,prefix:prefix.trim()});
      if(res.ok){showToast('Prefixo atualizado: '+res.prefix);location.reload();}else showToast(res.error);
    }
  </script>`;
}

// ---- DONO ----
app.get('/dono', (req, res) => {
  if (req.query.logout) { panelLogout(req, res); return res.redirect('/dono'); }
  const user = panelUser(req);
  if (!user || user.role !== 'dono') {
    return res.send(layout('DONO', loginForm('DONO', '/dono')));
  }
  res.send(layout('DONO', renderDono(user)));
});

app.post('/dono', (req, res) => {
  const user = handlePanelLogin(req, res, ['dono'], '/dono', 'DONO');
  if (!user) return;

  const action = req.body.action;
  const now = Math.floor(Date.now() / 1000);

  if (action === 'create_user') {
    let role = req.body.role || 'revendedor';
    if (!['revendedor', 'adm', 'dono'].includes(role)) role = 'revendedor';
    const prefix = String(req.body.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const credits = parseFloat(req.body.credits) || 0;
    const infinite = req.body.infinite === '1' || req.body.infinite === 1 ? 1 : 0;
    const maxDev = Math.max(1, Math.min(5, parseInt(req.body.max_devices, 10) || 1));
    const note = String(req.body.note || '').slice(0, 190);
    if (!prefix && role === 'revendedor') return res.json({ ok: false, error: 'Prefixo obrigatório para revendedor' });

    let code;
    for (let i = 0; i < 20; i++) {
      code = String(crypto.randomInt(100000, 1000000));
      if (!db.prepare('SELECT id FROM panel_users WHERE access_code=?').get(code)) break;
    }
    db.prepare(`INSERT INTO panel_users (access_code, role, prefix, credits, infinite_credits, max_devices, status, note, created_by, created_at)
      VALUES (?,?,?,?,?,?, 'active', ?, ?, ?)`)
      .run(code, role, prefix, credits, infinite, maxDev, note || null, user.id, Math.floor(Date.now() / 1000));
    return res.json({ ok: true, code, role });
  }

  if (action === 'add_credits') {
    const uid = parseInt(req.body.user_id, 10);
    const amount = parseFloat(req.body.amount) || 0;
    if (!db.prepare('SELECT id FROM panel_users WHERE id=?').get(uid)) return res.json({ ok: false, error: 'Usuário não encontrado' });
    db.prepare('UPDATE panel_users SET credits = credits + ? WHERE id = ?').run(amount, uid);
    return res.json({ ok: true });
  }

  if (action === 'toggle_user') {
    const uid = parseInt(req.body.user_id, 10);
    if (uid === user.id) return res.json({ ok: false, error: 'Não pode pausar a si mesmo' });
    const target = db.prepare('SELECT * FROM panel_users WHERE id=?').get(uid);
    if (!target) return res.json({ ok: false, error: 'Usuário não encontrado' });
    const neu = target.status === 'active' ? 'paused' : 'active';
    db.prepare('UPDATE panel_users SET status=? WHERE id=?').run(neu, uid);
    return res.json({ ok: true });
  }

  if (action === 'ban_user') {
    const uid = parseInt(req.body.user_id, 10);
    if (uid === user.id) return res.json({ ok: false, error: 'Não pode banir a si mesmo' });
    db.prepare("UPDATE panel_users SET status='banned' WHERE id=?").run(uid);
    return res.json({ ok: true });
  }

  if (action === 'delete_user') {
    const uid = parseInt(req.body.user_id, 10);
    if (uid === user.id) return res.json({ ok: false, error: 'Não pode excluir a si mesmo' });
    db.prepare('DELETE FROM panel_sessions WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM panel_users WHERE id=?').run(uid);
    return res.json({ ok: true });
  }

  // Dono pode alterar prefixo de qualquer um (incluindo o próprio)
  if (action === 'change_prefix') {
    const uid = parseInt(req.body.user_id, 10);
    const prefix = String(req.body.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!prefix) return res.json({ ok: false, error: 'Prefixo inválido' });
    const target = db.prepare('SELECT * FROM panel_users WHERE id=?').get(uid);
    if (!target) return res.json({ ok: false, error: 'Usuário não encontrado' });
    db.prepare('UPDATE panel_users SET prefix=? WHERE id=?').run(prefix, uid);
    return res.json({ ok: true, prefix });
  }

  if (action === 'update_price') {
    const id = parseInt(req.body.id, 10);
    const price = parseFloat(req.body.price) || 0;
    db.prepare('UPDATE key_prices SET price=? WHERE id=?').run(price, id);
    return res.json({ ok: true });
  }

  if (action === 'save_settings') {
    settingSet('site_name', req.body.site_name || 'PROXY WIRE');
    settingSet('site_sub', req.body.site_sub || 'RED');
    settingSet('aviso_texto', req.body.aviso_texto || '');
    settingSet('aviso_whatsapp', req.body.aviso_whatsapp || '');
    settingSet('download_url', req.body.download_url || '');
    let color = String(req.body.theme_color || '#8b5cf6').trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) color = '#ef4444';
    settingSet('theme_color', color);
    return res.json({ ok: true });
  }

  if (action === 'generate') {
    const seconds = Math.max(0, parseInt(String(req.body.seconds || '0'), 10) || 0);
    const qty = Math.max(1, Math.min(50, parseInt(String(req.body.qty || '1'), 10) || 1));
    if (seconds <= 0) return res.json({ ok: false, error: 'Selecione uma duração válida' });
    let maxDev = parseInt(String(req.body.max_devices || '1'), 10) || 1;
    maxDev = Math.max(1, Math.min(5, maxDev));
    const prefix = user.prefix || 'DONO';
    const generated = [];
    const insert = db.prepare('INSERT INTO license_keys (code, code_norm, validade_seconds, max_devices, status, owner_id, created_at) VALUES (?,?,?,?,?,?,?)');
    const nowTs = Math.floor(Date.now() / 1000);
    const tx = db.transaction(() => {
      for (let i = 0; i < qty; i++) {
        let code = generateKeyCode(prefix);
        for (let tries = 0; tries < 10; tries++) {
          if (!db.prepare('SELECT id FROM license_keys WHERE code_norm=?').get(code.toUpperCase())) break;
          code = generateKeyCode(prefix);
        }
        insert.run(code, code.toUpperCase(), seconds, maxDev, 'active', user.id, nowTs);
        generated.push(code);
      }
    });
    tx();
    return res.json({ ok: true, keys: generated, seconds, max_devices: maxDev });
  }

  if (action === 'toggle_key') {
    const id = parseInt(req.body.id, 10);
    const k = db.prepare('SELECT * FROM license_keys WHERE id=?').get(id);
    if (!k) return res.json({ ok: false, error: 'Key não encontrada' });
    const status = k.status === 'paused' ? 'active' : 'paused';
    db.prepare('UPDATE license_keys SET status=?, paused_at=? WHERE id=?')
      .run(status, status === 'paused' ? now : null, id);
    return res.json({ ok: true, status });
  }

  if (action === 'delete_key') {
    const id = parseInt(req.body.id, 10);
    const k = db.prepare('SELECT id FROM license_keys WHERE id=?').get(id);
    if (!k) return res.json({ ok: false, error: 'Key não encontrada' });
    db.prepare('DELETE FROM key_devices WHERE key_id=?').run(id);
    db.prepare('DELETE FROM license_keys WHERE id=?').run(id);
    return res.json({ ok: true });
  }

  if (action === 'pause_all_resellers') {
    db.prepare("UPDATE panel_users SET status='paused' WHERE role='revendedor' AND status='active'").run();
    return res.json({ ok: true });
  }

  res.json({ ok: false, error: 'Ação desconhecida' });
});

function renderDono(user) {
  const allUsers = db.prepare('SELECT * FROM panel_users ORDER BY role, id DESC').all();
  const prices = db.prepare('SELECT * FROM key_prices ORDER BY sort_order').all();
  const allKeys = db.prepare(`SELECT k.*, u.access_code AS owner_code
    FROM license_keys k LEFT JOIN panel_users u ON u.id=k.owner_id
    ORDER BY k.id DESC LIMIT 200`).all();
  const totalKeys = db.prepare('SELECT COUNT(*) as c FROM license_keys').get().c;
  const now = Math.floor(Date.now() / 1000);

  const rows = allUsers.map(r => {
    const b = r.status === 'active' ? 'badge-green' : r.status === 'paused' ? 'badge-yellow' : 'badge-red';
    const isMe = r.id === user.id;
    return `<tr>
      <td><code style="color:var(--red);font-size:0.8rem;">${esc(r.access_code)}</code></td>
      <td>${r.role.toUpperCase()}</td>
      <td>${esc(r.prefix || '—')}</td>
      <td>${r.infinite_credits ? '∞' : Number(r.credits).toFixed(2).replace('.', ',')}</td>
      <td><span class="badge ${b}">${r.status.toUpperCase()}</span></td>
      <td class="actions">
        <button class="btn btn-secondary btn-sm" onclick="changePrefix(${r.id}, '${esc(r.prefix)}')">Prefixo</button>
        ${isMe ? '<span style="color:var(--muted);font-size:0.8rem;margin-left:6px;">Você</span>' : `
        <button class="btn btn-secondary btn-sm" onclick="addCred(${r.id})">+ Crédito</button>
        <button class="btn btn-secondary btn-sm" onclick="toggleUser(${r.id})">${r.status === 'active' ? 'Pausar' : 'Ativar'}</button>
        <button class="btn btn-secondary btn-sm" style="color:var(--red)" onclick="banUser(${r.id})">Banir</button>
        <button class="btn btn-secondary btn-sm" style="color:var(--red)" onclick="delUser(${r.id})">Excluir</button>`}
      </td>
    </tr>`;
  }).join('');

  const keyRows = allKeys.map(k => {
    const state = keyStatus(k, now);
    const badge = (state === 'active' || state === 'lifetime') ? 'badge-green' : state === 'paused' ? 'badge-yellow' : 'badge-red';
    const remaining = k.expires_at ? Math.max(0, k.expires_at - now) : 0;
    const duration = k.validade_seconds > 0 ? humanLeft(remaining || k.validade_seconds) : 'Vitalícia';
    const devices = db.prepare('SELECT COUNT(*) as c FROM key_devices WHERE key_id=?').get(k.id).c;
    return `<tr>
      <td><span class="key-chip" title="Clique para copiar" onclick="navigator.clipboard.writeText('${esc(k.code)}');showToast('Key copiada!')">${esc(k.code)}</span></td>
      <td>${esc(k.owner_code || '—')}</td>
      <td>${esc(duration)}</td>
      <td>${devices}/${k.max_devices}</td>
      <td><span class="badge ${badge}">${esc(state.toUpperCase())}</span></td>
      <td class="actions">
        <button class="btn btn-secondary btn-sm" onclick="toggleDonoKey(${k.id})">${state === 'paused' ? 'Ativar' : 'Pausar'}</button>
        <button class="btn btn-secondary btn-sm" style="color:var(--red)" onclick="deleteDonoKey(${k.id})">Excluir</button>
      </td>
    </tr>`;
  }).join('');

  const priceRows = prices.map(p => `
    <tr>
      <td>${esc(p.label)}</td>
      <td><input type="number" id="price_${p.id}" value="${p.price}" step="0.1" min="0" style="width:100px;padding:8px;"></td>
      <td><button class="btn btn-secondary btn-sm" onclick="savePrice(${p.id})">Salvar</button></td>
    </tr>`).join('');

  const themeColor = setting('theme_color', '#8b5cf6');

  return `
  <div class="panel-container">
    <div class="header">
      <h2>PAINEL DONO</h2>
      <div style="display:flex;gap:10px;align-items:center;">
        <span class="badge badge-purple">DONO</span>
        <a href="?logout=1" class="btn btn-secondary btn-sm">← Sair</a>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="value">${allUsers.length}</div><div class="label">USUÁRIOS</div></div>
      <div class="stat"><div class="value">${totalKeys}</div><div class="label">KEYS TOTAIS</div></div>
    </div>
    <div class="section">
      <h3>Gerar Novo Usuário</h3>
      <div class="grid-2">
        <div><label class="label">TIPO</label>
          <select id="role"><option value="revendedor">Revendedor</option><option value="adm">Administrador</option><option value="dono">Dono</option></select>
        </div>
        <div><label class="label">PREFIXO DAS KEYS</label><input type="text" id="prefix" placeholder="BIEL" maxlength="12" style="text-transform:uppercase;"></div>
        <div><label class="label">CRÉDITOS</label><input type="number" id="credits" value="0" step="0.5" min="0"></div>
        <div><label class="label">CRÉDITOS INFINITOS</label>
          <select id="infinite"><option value="0">Não</option><option value="1">Sim</option></select>
        </div>
        <div><label class="label">MÁX. DISPOSITIVOS</label><input type="number" id="max_devices" value="1" min="1" max="5"></div>
        <div><label class="label">NOTA</label><input type="text" id="note" placeholder="Opcional"></div>
      </div>
      <button class="btn btn-primary" style="margin-top:14px;" onclick="criarUser()">GERAR USUÁRIO</button>
      <div id="newUserBox" style="display:none;margin-top:16px;"></div>
    </div>

    <div class="section">
      <h3>Gerar Nova Key</h3>
      <p style="font-size:0.75rem;color:var(--muted);margin:-8px 0 12px;">Keys geradas com o seu prefixo de dono</p>
      <div class="grid-2">
        <div><label class="label">DURAÇÃO</label>
          <select id="dono_duration">
            ${prices.filter(p=>p.active).map(p => `<option value="${p.seconds}">${esc(p.label)} — R$ ${Number(p.price).toFixed(2).replace('.', ',')}</option>`).join('')}
          </select>
        </div>
        <div><label class="label">QUANTIDADE</label><input type="number" id="dono_qty" value="1" min="1" max="50"></div>
        <div><label class="label">MÁX. DISPOSITIVOS</label><input type="number" id="dono_maxdev" value="1" min="1" max="5"></div>
      </div>
      <button class="btn btn-primary" style="margin-top:14px;" onclick="gerarKeysDono()">GERAR KEYS</button>
      <div id="donoGeneratedBox" style="display:none;margin-top:16px;"></div>
    </div>

    <div class="section">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
        <h3 style="margin:0;">Todos os Usuários</h3>
        <button class="btn btn-secondary btn-sm" onclick="pauseAll()">Pausar Todos Revendedores</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>CÓDIGO</th><th>ROLE</th><th>PREFIXO</th><th>CRÉDITOS</th><th>STATUS</th><th>AÇÕES</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    <div class="section">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
        <h3 style="margin:0;">Keys Salvas (${totalKeys})</h3>
        <span style="font-size:0.72rem;color:var(--muted);">As keys ficam registradas no banco</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>KEY</th><th>DONO</th><th>DURAÇÃO</th><th>DISPOSITIVOS</th><th>STATUS</th><th>AÇÕES</th></tr></thead>
          <tbody>${keyRows || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">Nenhuma key gerada ainda.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="section">
      <h3>Preços das Keys</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>DURAÇÃO</th><th>PREÇO (R$)</th><th>AÇÃO</th></tr></thead>
          <tbody>${priceRows}</tbody>
        </table>
      </div>
    </div>
    <div class="section">
      <h3>Configurações do Site</h3>
      <div class="grid-2">
        <div><label class="label">NOME DO SITE</label><input type="text" id="site_name" value="${esc(setting('site_name'))}"></div>
        <div><label class="label">SUBTÍTULO</label><input type="text" id="site_sub" value="${esc(setting('site_sub'))}"></div>
      </div>
      <div style="margin-top:12px;">
        <label class="label">COR PRINCIPAL DO SITE</label>
        <div style="display:flex;gap:12px;align-items:center;">
          <input type="color" id="theme_color" value="${esc(themeColor)}" style="width:56px;height:42px;border:none;border-radius:8px;cursor:pointer;background:transparent;">
          <input type="text" id="theme_color_hex" value="${esc(themeColor)}" maxlength="7" style="flex:1;text-transform:uppercase;">
        </div>
      </div>
      <div style="margin-top:12px;"><label class="label">TEXTO DO AVISO</label><input type="text" id="aviso_texto" value="${esc(setting('aviso_texto'))}"></div>
      <div style="margin-top:12px;"><label class="label">LINK WHATSAPP</label><input type="text" id="aviso_whatsapp" value="${esc(setting('aviso_whatsapp'))}" placeholder="https://wa.me/55..."></div>
      <div style="margin-top:12px;"><label class="label">URL DE DOWNLOAD DO APP</label><input type="text" id="download_url" value="${esc(setting('download_url'))}" placeholder="https://..."></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
        <button class="btn btn-primary" style="width:auto;padding:12px 20px;" onclick="saveSettings()">SALVAR CONFIGURAÇÕES</button>
        <button class="btn btn-ghost" style="width:auto;padding:12px 20px;" onclick="testarApi()">TESTAR API</button>
      </div>
      <div id="apiTestResult" style="display:none;margin-top:12px;padding:12px;border-radius:10px;font-size:0.85rem;"></div>
    </div>
    <p class="footer">PROXY WIRE RED · DONO PANEL</p>
  </div>
  <script>
    async function criarUser(){
      const res=await post('/dono',{action:'create_user',role:document.getElementById('role').value,prefix:document.getElementById('prefix').value.trim(),credits:document.getElementById('credits').value,infinite:document.getElementById('infinite').value,max_devices:document.getElementById('max_devices').value,note:document.getElementById('note').value});
      if(!res.ok)return showToast(res.error);
      const box=document.getElementById('newUserBox');
      box.style.display='block';
      box.innerHTML='<p style="color:var(--green);">✓ Usuário <b>'+res.role+'</b> criado!</p><code style="display:block;background:#0d0d14;padding:12px;border-radius:8px;color:var(--red);font-size:1.1rem;margin-top:8px;cursor:pointer;" onclick="navigator.clipboard.writeText(\\''+res.code+'\\');showToast(\\'Copiado!\\')">'+res.code+'</code>';
      showToast('Criado!');
    }
    async function addCred(id){const amount=prompt('Valor a adicionar (negativo remove):');if(amount===null||amount==='')return;const res=await post('/dono',{action:'add_credits',user_id:id,amount});if(res.ok){showToast('Atualizado');location.reload();}else showToast(res.error);}
    async function toggleUser(id){const res=await post('/dono',{action:'toggle_user',user_id:id});if(res.ok)location.reload();else showToast(res.error);}
    async function banUser(id){if(!confirm('Banir?'))return;const res=await post('/dono',{action:'ban_user',user_id:id});if(res.ok)location.reload();else showToast(res.error);}
    async function delUser(id){if(!confirm('EXCLUIR permanentemente?'))return;const res=await post('/dono',{action:'delete_user',user_id:id});if(res.ok)location.reload();else showToast(res.error);}
    async function pauseAll(){if(!confirm('Pausar todos os revendedores?'))return;const res=await post('/dono',{action:'pause_all_resellers'});if(res.ok)location.reload();else showToast(res.error);}
    async function changePrefix(id, atual){
      const prefix=prompt('Novo prefixo (só letras e números):', atual||'');
      if(prefix===null||prefix.trim()==='')return;
      const res=await post('/dono',{action:'change_prefix',user_id:id,prefix:prefix.trim()});
      if(res.ok){showToast('Prefixo atualizado: '+res.prefix);location.reload();}else showToast(res.error);
    }
    async function gerarKeysDono(){
      const seconds=document.getElementById('dono_duration').value;
      const qty=document.getElementById('dono_qty').value;
      const max_devices=document.getElementById('dono_maxdev').value;
      const res=await post('/dono',{action:'generate',seconds,qty,max_devices});
      if(!res.ok)return showToast(res.error||'Erro');
      const box=document.getElementById('donoGeneratedBox');
      box.style.display='block';
      box.innerHTML='<p style="color:var(--green);margin-bottom:8px;">✓ '+res.keys.length+' key(s) · '+res.seconds+'s · '+res.max_devices+' device(s)</p>'+
        res.keys.map(k=>'<span class="key-chip" style="margin:4px;">'+k+'</span>').join('');
      box.querySelectorAll('.key-chip').forEach(el=>el.addEventListener('click',()=>{navigator.clipboard.writeText(el.textContent);showToast('Key copiada!');}));
      showToast('Keys geradas!');
    }
    async function toggleDonoKey(id){const res=await post('/dono',{action:'toggle_key',id});if(res.ok)location.reload();else showToast(res.error);}
    async function deleteDonoKey(id){if(!confirm('Excluir esta key permanentemente?'))return;const res=await post('/dono',{action:'delete_key',id});if(res.ok)location.reload();else showToast(res.error);}
    async function savePrice(id){const res=await post('/dono',{action:'update_price',id,price:document.getElementById('price_'+id).value});if(res.ok)showToast('Preço salvo');else showToast(res.error);}
    async function saveSettings(){
      const res=await post('/dono',{action:'save_settings',site_name:document.getElementById('site_name').value,site_sub:document.getElementById('site_sub').value,theme_color:document.getElementById('theme_color').value,aviso_texto:document.getElementById('aviso_texto').value,aviso_whatsapp:document.getElementById('aviso_whatsapp').value,download_url:document.getElementById('download_url').value});
      if(res.ok){showToast('Configurações salvas!');const c=document.getElementById('theme_color').value;document.documentElement.style.setProperty('--accent',c);document.documentElement.style.setProperty('--accent-dark',c);document.documentElement.style.setProperty('--accent-glow',c+'66');document.documentElement.style.setProperty('--red',c);}
      else showToast(res.error);
    }
    async function testarApi(){
      const box=document.getElementById('apiTestResult');
      box.style.display='block';
      box.style.background='rgba(139,92,246,0.08)';
      box.style.border='1px solid rgba(139,92,246,0.3)';
      box.innerHTML='Testando API...';
      try{
        const r=await fetch('/api/health');
        const data=await r.json();
        if(data.ok){
          box.style.background='rgba(34,197,94,0.1)';
          box.style.border='1px solid rgba(34,197,94,0.35)';
          box.innerHTML='<b style="color:var(--green)">✓ API ONLINE</b><br>Status: '+data.status+'<br>Banco: '+data.database+'<br>Keys: '+data.keys+' · Usuários: '+data.users+'<br><span style="color:var(--muted);font-size:0.75rem;">'+data.time+'</span>';
          showToast('API funcionando');
        }else{
          box.style.background='rgba(239,68,68,0.1)';
          box.style.border='1px solid rgba(239,68,68,0.35)';
          box.innerHTML='<b style="color:var(--red)">✕ API COM ERRO</b><br>'+(data.message||'Falha');
          showToast('API com erro');
        }
      }catch(e){
        box.style.background='rgba(239,68,68,0.1)';
        box.style.border='1px solid rgba(239,68,68,0.35)';
        box.innerHTML='<b style="color:var(--red)">✕ FALHA DE CONEXÃO</b><br>'+e.message;
        showToast('Falha ao testar API');
      }
    }
    const colorPicker=document.getElementById('theme_color');
    const colorHex=document.getElementById('theme_color_hex');
    colorPicker.addEventListener('input',()=>{colorHex.value=colorPicker.value.toUpperCase();document.documentElement.style.setProperty('--accent',colorPicker.value);document.documentElement.style.setProperty('--red',colorPicker.value);});
    colorHex.addEventListener('input',()=>{let v=colorHex.value.trim();if(!v.startsWith('#'))v='#'+v;if(/^#[0-9A-Fa-f]{6}$/.test(v)){colorPicker.value=v;document.documentElement.style.setProperty('--accent',v);document.documentElement.style.setProperty('--red',v);}});
  </script>`;
}

// Start
app.listen(PORT, () => {
  console.log(`PROXY WIRE RED rodando em http://localhost:${PORT}`);
  console.log(`Código do Dono: 250911`);
  console.log(`Rotas: /  /revendedor  /admin  /dono  /api`);
});
