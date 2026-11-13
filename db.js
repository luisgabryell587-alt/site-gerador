const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'proxywire.sqlite');
const snapshotKey = 'proxywire/proxywire.sqlite';
const managedDbUrl = process.env.DATABASE_URL || process.env.DRIZZLE_DATABASE_URL || '';

// O container pode ser recriado durante uma publicação. Antes de abrir o SQLite,
// restaura o último snapshot do armazenamento durável quando ele existir.
function restoreSnapshot() {
  if (process.env.PROXYWIRE_DISABLE_PERSISTENCE === '1' || !managedDbUrl) return;
  const tempPath = `${dbPath}.restore-${process.pid}`;
  const script = `
    const fs = require('fs');
    const mysql = require('mysql2/promise');
    (async () => {
      const conn = await mysql.createConnection(process.env.PROXYWIRE_DATABASE_URL);
      await conn.execute('CREATE TABLE IF NOT EXISTS proxywire_snapshots (snapshot_key VARCHAR(191) PRIMARY KEY, snapshot_data LONGBLOB NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)');
      const [rows] = await conn.execute('SELECT snapshot_data FROM proxywire_snapshots WHERE snapshot_key=? LIMIT 1', [process.env.PROXYWIRE_SNAPSHOT_KEY]);
      if (rows.length && rows[0].snapshot_data && rows[0].snapshot_data.length > 100) fs.writeFileSync(process.env.PROXYWIRE_SNAPSHOT_TMP, rows[0].snapshot_data);
      await conn.end();
    })().catch(() => process.exit(0));
  `;
  try {
    spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, PROXYWIRE_DATABASE_URL: managedDbUrl, PROXYWIRE_SNAPSHOT_KEY: snapshotKey, PROXYWIRE_SNAPSHOT_TMP: tempPath },
      stdio: 'ignore',
      timeout: 30000,
    });
    if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 100) {
      fs.renameSync(tempPath, dbPath);
    }
  } catch (_) {
    try { fs.rmSync(tempPath, { force: true }); } catch (_) {}
  }
}

restoreSnapshot();

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      k TEXT PRIMARY KEY,
      v TEXT
    );

    CREATE TABLE IF NOT EXISTS panel_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      access_code TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'revendedor',
      prefix TEXT NOT NULL DEFAULT '',
      credits REAL NOT NULL DEFAULT 0,
      infinite_credits INTEGER NOT NULL DEFAULT 0,
      max_devices INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT,
      created_by INTEGER,
      created_at INTEGER NOT NULL,
      last_login INTEGER
    );

    CREATE TABLE IF NOT EXISTS panel_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS license_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      code_norm TEXT NOT NULL UNIQUE,
      validade_seconds INTEGER NOT NULL DEFAULT 0,
      max_devices INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT,
      owner_id INTEGER,
      created_at INTEGER NOT NULL,
      activated_at INTEGER,
      expires_at INTEGER,
      paused_at INTEGER,
      last_check INTEGER,
      last_ip TEXT,
      total_checks INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS key_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_id INTEGER NOT NULL,
      hwid TEXT NOT NULL,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      ip TEXT,
      UNIQUE(key_id, hwid)
    );

    CREATE TABLE IF NOT EXISTS key_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      seconds INTEGER NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS api_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_code TEXT,
      hwid TEXT,
      ip TEXT,
      result TEXT NOT NULL,
      key_id INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_hits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      ip TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  const priceCount = db.prepare('SELECT COUNT(*) as c FROM key_prices').get().c;
  if (priceCount === 0) {
    const ins = db.prepare('INSERT INTO key_prices (label, seconds, price, active, sort_order) VALUES (?,?,?,?,?)');
    const defaults = [
      ['1 Hora', 3600, 0.50, 1, 1],
      ['1 Dia', 86400, 1.00, 1, 2],
      ['3 Dias', 259200, 2.50, 1, 3],
      ['7 Dias', 604800, 4.00, 1, 4],
      ['15 Dias', 1296000, 6.00, 1, 5],
      ['30 Dias', 2592000, 8.00, 1, 6],
    ];
    for (const d of defaults) ins.run(...d);
  }

  const defaults = {
    site_name: 'PROXY WIRE',
    site_sub: 'RED',
    aviso_texto: 'Revendedores e clientes que querem ser avisados a cada UPDATE / BLACK / BAN / RISK. Entre no nosso WhatsApp oficial para ser prioridade!',
    aviso_whatsapp: 'https://wa.me/5511999999999',
    download_url: '',
    theme_color: '#8b5cf6',
    key_body_length: '8',
    rate_limit: '60',
  };
  const setIns = db.prepare('INSERT OR IGNORE INTO settings (k, v) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) setIns.run(k, v);
  // Migra a configuração antiga de 6 caracteres para o novo padrão numérico de 8.
  db.prepare("UPDATE settings SET v='8' WHERE k='key_body_length' AND v != '8'").run();

  const hasDono = db.prepare("SELECT COUNT(*) as c FROM panel_users WHERE role = 'dono'").get().c;
  if (hasDono === 0) {
    db.prepare(`INSERT INTO panel_users
      (access_code, role, prefix, credits, infinite_credits, max_devices, status, created_at)
      VALUES (?, 'dono', 'DONO', 0, 1, 1, 'active', ?)`)
      .run('250911', Math.floor(Date.now() / 1000));
    fs.writeFileSync(path.join(dataDir, 'dono_inicial.txt'), 'Código do Dono: 250911\nGuarde este código!\n');
  }
}

migrate();

let snapshotTimer = null;
let snapshotRunning = false;
let snapshotAgain = false;

function scheduleSnapshot() {
  if (process.env.PROXYWIRE_DISABLE_PERSISTENCE === '1' || !managedDbUrl) return;
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    persistSnapshot();
  }, 350);
  snapshotTimer.unref?.();
}

async function persistSnapshot() {
  if (snapshotRunning) {
    snapshotAgain = true;
    return;
  }
  snapshotRunning = true;
  try {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
    const bytes = fs.readFileSync(dbPath);
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection(managedDbUrl);
    await conn.execute('CREATE TABLE IF NOT EXISTS proxywire_snapshots (snapshot_key VARCHAR(191) PRIMARY KEY, snapshot_data LONGBLOB NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)');
    await conn.execute('INSERT INTO proxywire_snapshots (snapshot_key, snapshot_data) VALUES (?, ?) ON DUPLICATE KEY UPDATE snapshot_data=VALUES(snapshot_data), updated_at=CURRENT_TIMESTAMP', [snapshotKey, bytes]);
    await conn.end();
  } catch (_) {
    // A falha temporária de snapshot não interrompe a operação normal do painel.
  } finally {
    snapshotRunning = false;
    if (snapshotAgain) {
      snapshotAgain = false;
      scheduleSnapshot();
    }
  }
}

// Mantém a API síncrona existente do aplicativo e agenda um snapshot depois de cada escrita.
const nativePrepare = db.prepare.bind(db);
db.prepare = (sql) => {
  const statement = nativePrepare(sql);
  const nativeRun = statement.run.bind(statement);
  statement.run = (...args) => {
    const result = nativeRun(...args);
    scheduleSnapshot();
    return result;
  };
  return statement;
};

function setting(key, def = null) {
  const row = db.prepare('SELECT v FROM settings WHERE k = ?').get(key);
  return row ? row.v : def;
}

function settingSet(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)').run(key, String(value));
}

function randSegment(len = 8) {
  let out = '';
  for (let i = 0; i < len; i++) out += crypto.randomInt(0, 10);
  return out;
}

/** Formato padrão: PREFIXO + exatamente 8 números, sem hífen. */
function generateKeyCode(prefix = 'BIEL') {
  prefix = String(prefix || 'BIEL').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BIEL';
  return prefix + randSegment(8);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token + 'proxywire-red-salt').digest('hex');
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || '';
  if (xf) return xf.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || '0.0.0.0';
}

function keyStatus(k, now = Math.floor(Date.now() / 1000)) {
  if (k.status === 'paused') return 'paused';
  if (k.status === 'banned') return 'banned';
  if (!k.expires_at) return 'lifetime';
  if (k.expires_at - now <= 0) return 'expired';
  return 'active';
}

function humanLeft(seconds) {
  seconds = Math.max(0, seconds | 0);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

module.exports = {
  db, setting, settingSet, generateKeyCode, hashToken, clientIp, keyStatus, humanLeft, randSegment
};
