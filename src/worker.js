// Baby Care Log — Cloudflare Worker (static app + API + reminder cron).
// Many families share one deployment. Every row carries its family id, and every query filters on it.
// Phones sign in with their own device token (stored hashed); families add members with one-time invite links.
import { ASSETS } from './assets.js';
import { generateVapidKeys, sendPush, b64uEncode } from './webpush.js';

const HOUR = 36e5, DAY = 24 * HOUR;
const SCHEMA_VERSION = 2;

// Tables for schema version 2. Index names differ from version 1 so a migration can build them next to the old tables.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`, // app-wide: vapid, origin, schema, legacy_family
  `CREATE TABLE IF NOT EXISTS families (id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL, recovery_hash TEXT, consent INTEGER)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS families_recovery ON families(recovery_hash)`,
  `CREATE TABLE IF NOT EXISTS family_kv (family TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (family, k))`, // profile, rem, legacy_auth
  `CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, family TEXT NOT NULL, member TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS devices_family ON devices(family)`,
  `CREATE TABLE IF NOT EXISTS invites (code_hash TEXT PRIMARY KEY, family TEXT NOT NULL, created_by TEXT, expires INTEGER NOT NULL, used INTEGER)`,
  `CREATE INDEX IF NOT EXISTS invites_family ON invites(family)`,
  `CREATE TABLE IF NOT EXISTS events (family TEXT NOT NULL, id TEXT NOT NULL, type TEXT, t INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (family, id))`,
  `CREATE INDEX IF NOT EXISTS ev_family_updated ON events(family, updated)`,
  `CREATE INDEX IF NOT EXISTS ev_family_type_t ON events(family, type, t)`,
  `CREATE TABLE IF NOT EXISTS growth (family TEXT NOT NULL, id TEXT NOT NULL, t INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (family, id))`,
  `CREATE INDEX IF NOT EXISTS gr_family_updated ON growth(family, updated)`,
  `CREATE TABLE IF NOT EXISTS appts (family TEXT NOT NULL, id TEXT NOT NULL, t INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (family, id))`,
  `CREATE INDEX IF NOT EXISTS ap_family_updated ON appts(family, updated)`,
  `CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, family TEXT NOT NULL, device TEXT, data TEXT NOT NULL, member TEXT, created INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS subs_family ON subs(family)`,
  // Feed and pumping reminders: one row per family and kind, so the cron reads only what is due.
  `CREATE TABLE IF NOT EXISTS due (family TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER, notified INTEGER, PRIMARY KEY (family, kind))`,
  `CREATE INDEX IF NOT EXISTS due_at ON due(at)`,
  // Appointment reminders: one row per reminder time, rebuilt whenever the appointment changes.
  `CREATE TABLE IF NOT EXISTS alarms (family TEXT NOT NULL, appt TEXT NOT NULL, min INTEGER NOT NULL, fire INTEGER NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (family, appt, min))`,
  `CREATE INDEX IF NOT EXISTS alarms_fire ON alarms(fire)`,
  `CREATE TABLE IF NOT EXISTS sent (k TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rate (k TEXT PRIMARY KEY, n INTEGER NOT NULL, reset INTEGER NOT NULL)`,
];
const REM_DEFAULT = { feed: { auto: false, hours: 3 }, pump: { auto: false, hours: 3 }, due: { feed: null, pump: null }, tz: 'Europe/Amsterdam' };
const KL = { feed: 'feed', pump: 'pumping session' };
const INVITE_DAYS = 7;

// ---------- storage helpers ----------
async function kvGet(env, k) { const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return row ? JSON.parse(row.v) : null; }
async function kvSet(env, k, v) { await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, JSON.stringify(v)).run(); }
async function fkvGet(env, fam, k) { const row = await env.DB.prepare('SELECT v FROM family_kv WHERE family = ? AND k = ?').bind(fam, k).first(); return row ? JSON.parse(row.v) : null; }
const fkvSetStmt = (env, fam, k, v) => env.DB.prepare('INSERT INTO family_kv (family, k, v) VALUES (?, ?, ?) ON CONFLICT(family, k) DO UPDATE SET v = excluded.v').bind(fam, k, JSON.stringify(v));
async function fkvSet(env, fam, k, v) { await fkvSetStmt(env, fam, k, v).run(); }

function mergeRem(d) {
  d = d || {};
  return { feed: { ...REM_DEFAULT.feed, ...(d.feed || {}) }, pump: { ...REM_DEFAULT.pump, ...(d.pump || {}) }, due: { feed: null, pump: null, ...(d.due || {}) }, tz: d.tz || REM_DEFAULT.tz };
}
async function getRem(env, fam) { return mergeRem(await fkvGet(env, fam, 'rem')); }
// Saves reminder settings and mirrors the due times into the `due` table the cron reads.
const dueStmts = (env, fam, r) => ['feed', 'pump'].map((k) => env.DB.prepare('INSERT INTO due (family, kind, at) VALUES (?, ?, ?) ON CONFLICT(family, kind) DO UPDATE SET at = excluded.at').bind(fam, k, r.due[k] || null));
async function setRem(env, fam, r) { await env.DB.batch([fkvSetStmt(env, fam, 'rem', r), ...dueStmts(env, fam, r)]); }

// Rebuilds the reminder rows of one appointment. Sent reminders are remembered in `sent`, so rebuilding never repeats one.
function alarmStmts(env, fam, id, a, t, deleted) {
  const now = Date.now();
  const stmts = [env.DB.prepare('DELETE FROM alarms WHERE family = ? AND appt = ?').bind(fam, id)];
  if (!deleted && a && !a.planned) {
    const seen = new Set();
    for (const off of (Array.isArray(a.remind) ? a.remind : [])) {
      const min = Math.max(0, Math.min(10080, Math.round(Number(off) || 0)));
      const fire = t - min * 60000;
      if (seen.has(min) || fire < now - 2 * HOUR) continue;
      seen.add(min);
      stmts.push(env.DB.prepare('INSERT INTO alarms (family, appt, min, fire, t) VALUES (?, ?, ?, ?, ?)').bind(fam, id, min, fire, t));
    }
  }
  return stmts;
}

// ---------- schema and migration from the one-family version ----------
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  if (!env.DB) throw new Error('NO_DB');
  await env.DB.prepare(SCHEMA[0]).run();
  let ver = await kvGet(env, 'schema');
  if (ver !== SCHEMA_VERSION) {
    if (await isLegacy(env)) {
      try { await migrateV1(env); } catch (e) { if ((await kvGet(env, 'schema')) !== SCHEMA_VERSION) throw e; } // another request may have migrated first
    } else {
      await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
      await kvSet(env, 'schema', SCHEMA_VERSION);
    }
  }
  schemaReady = true;
}
// Version 1 had an events table without a family column.
async function isLegacy(env) {
  try { await env.DB.prepare('SELECT id FROM events LIMIT 1').first(); } catch (e) { return false; } // no events table: fresh database
  try { await env.DB.prepare('SELECT family FROM events LIMIT 1').first(); return false; } catch (e) { return true; }
}
async function migrateV1(env) {
  const DB = env.DB;
  const auth = await kvGet(env, 'auth');
  const fam = 'f' + randomId(8);
  const now = Date.now();
  const has = async (table) => { try { await DB.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first(); return true; } catch (e) { return false; } };
  const tables = [];
  for (const t of ['events', 'growth', 'appts', 'subs']) if (await has(t)) tables.push(t);
  const stmts = tables.map((t) => DB.prepare(`ALTER TABLE ${t} RENAME TO ${t}_v1`));
  stmts.push(...SCHEMA.map((s) => DB.prepare(s)));
  if (tables.includes('events')) stmts.push(DB.prepare('INSERT INTO events (family, id, type, t, data, updated, deleted) SELECT ?, id, type, t, data, updated, deleted FROM events_v1').bind(fam));
  if (tables.includes('growth')) stmts.push(DB.prepare('INSERT INTO growth (family, id, t, data, updated, deleted) SELECT ?, id, t, data, updated, deleted FROM growth_v1').bind(fam));
  if (tables.includes('appts')) stmts.push(DB.prepare('INSERT INTO appts (family, id, t, data, updated, deleted) SELECT ?, id, t, data, updated, deleted FROM appts_v1').bind(fam));
  if (tables.includes('subs')) stmts.push(DB.prepare('INSERT INTO subs (endpoint, family, device, data, member, created) SELECT endpoint, ?, NULL, data, member, created FROM subs_v1').bind(fam));
  if (await has('sent')) stmts.push(DB.prepare("UPDATE sent SET k = ? || ':' || k").bind(fam));
  stmts.push(DB.prepare('INSERT INTO families (id, name, created) VALUES (?, ?, ?)').bind(fam, (auth && auth.family) || 'Our family', now));
  const profile = await kvGet(env, 'profile');
  const rem = mergeRem(await kvGet(env, 'rem'));
  const notified = (await kvGet(env, 'notified')) || {};
  if (profile) stmts.push(fkvSetStmt(env, fam, 'profile', profile));
  stmts.push(fkvSetStmt(env, fam, 'rem', rem));
  for (const k of ['feed', 'pump']) stmts.push(DB.prepare('INSERT INTO due (family, kind, at, notified) VALUES (?, ?, ?, ?)').bind(fam, k, rem.due[k] || null, notified[k] || null));
  if (auth) { stmts.push(fkvSetStmt(env, fam, 'legacy_auth', auth)); stmts.push(DB.prepare("INSERT INTO kv (k, v) VALUES ('legacy_family', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(fam))); }
  for (const t of tables) stmts.push(DB.prepare(`DROP TABLE ${t}_v1`));
  stmts.push(DB.prepare("DELETE FROM kv WHERE k IN ('auth', 'profile', 'rem', 'notified')"));
  stmts.push(DB.prepare("INSERT INTO kv (k, v) VALUES ('schema', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(SCHEMA_VERSION)));
  await DB.batch(stmts); // one transaction: all or nothing
  // Reminder rows for upcoming appointments.
  const appts = (await DB.prepare('SELECT id, t, data FROM appts WHERE family = ? AND deleted = 0 AND t > ?').bind(fam, now - 2 * HOUR).all()).results;
  const al = []; for (const r of appts) al.push(...alarmStmts(env, fam, r.id, JSON.parse(r.data), r.t, false));
  for (let i = 0; i < al.length; i += 100) await DB.batch(al.slice(i, i + 100));
}

// ---------- crypto and request helpers ----------
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (status, error) => json({ error }, status);
async function sha256(text) { return b64uEncode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }
const randomToken = (bytes = 32) => b64uEncode(crypto.getRandomValues(new Uint8Array(bytes)));
const randomId = (bytes = 9) => b64uEncode(crypto.getRandomValues(new Uint8Array(bytes))).replace(/[-_]/g, 'x');
// Recovery code: 16 characters without look-alikes (0/O, 1/I/L), shown in groups of 4. About 80 bits.
const RC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function recoveryCode() { const b = crypto.getRandomValues(new Uint8Array(16)); let s = ''; for (const x of b) s += RC[x % RC.length]; return s.match(/.{4}/g).join('-'); }
const normRecovery = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const cleanName = (s, n = 40) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
const cleanKey = (k) => String(k || '').trim();
const hhmm = (v, d) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : d;
async function readBody(req) { try { return await req.json(); } catch { return {}; } }
const clientIp = (req) => req.headers.get('cf-connecting-ip') || 'local';
const slow = () => new Promise((r) => setTimeout(r, 400));

// Fixed-window rate limit. Returns true when the caller is over the limit.
async function limited(env, key, max, windowMs) {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT n, reset FROM rate WHERE k = ?').bind(key).first();
  if (!row || row.reset < now) { await env.DB.prepare('INSERT INTO rate (k, n, reset) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = 1, reset = excluded.reset').bind(key, now + windowMs).run(); return false; }
  if (row.n >= max) return true;
  await env.DB.prepare('UPDATE rate SET n = n + 1 WHERE k = ?').bind(key).run();
  return false;
}

// Optional bot check on "create family": active only when TURNSTILE_SITE_KEY and TURNSTILE_SECRET are set.
async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY) return true;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: String(token || ''), remoteip: ip }) });
    return !!(await r.json()).success;
  } catch (e) { return false; }
}

async function newDevice(env, fam, member) {
  const token = randomToken(); const id = randomId(); const now = Date.now();
  await env.DB.prepare('INSERT INTO devices (id, token_hash, family, member, created, last_seen) VALUES (?, ?, ?, ?, ?, ?)').bind(id, await sha256(token), fam, member, now, now).run();
  return { token, device: id };
}
async function familyInfo(env, fam) { return env.DB.prepare('SELECT id, name, created, recovery_hash IS NOT NULL AS has_recovery FROM families WHERE id = ?').bind(fam).first(); }

// Who is calling: a device token, or (for phones from before multi-family) the old family key of the migrated family.
async function authenticate(req, env) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(req.headers.get('authorization') || '');
  if (m) {
    const d = await env.DB.prepare('SELECT id, family, member, last_seen FROM devices WHERE token_hash = ?').bind(await sha256(m[1])).first();
    if (d) {
      if (Date.now() - d.last_seen > HOUR) await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').bind(Date.now(), d.id).run();
      return { family: d.family, device: d.id, member: d.member };
    }
  }
  const key = cleanKey(req.headers.get('x-family-key'));
  if (key) { const fam = await legacyFamilyFor(env, key); if (fam) return { family: fam, device: null, member: '' }; }
  return null;
}
async function legacyFamilyFor(env, key) {
  const fam = await kvGet(env, 'legacy_family'); if (!fam || !key) return null;
  const auth = await fkvGet(env, fam, 'legacy_auth');
  return auth && (await sha256(auth.salt + ':' + key)) === auth.hash ? fam : null;
}

// ---------- push ----------
async function vapidKeys(env) {
  let keys = await kvGet(env, 'vapid');
  if (!keys) { keys = await generateVapidKeys(); await kvSet(env, 'vapid', keys); }
  return keys;
}
async function pushFamily(env, fam, payload, origin, onlyEndpoint) {
  const keys = await vapidKeys(env);
  const rows = onlyEndpoint
    ? (await env.DB.prepare('SELECT endpoint, data FROM subs WHERE family = ? AND endpoint = ?').bind(fam, onlyEndpoint).all()).results
    : (await env.DB.prepare('SELECT endpoint, data FROM subs WHERE family = ?').bind(fam).all()).results;
  let sent = 0, gone = 0;
  for (const r of rows) {
    try {
      const status = await sendPush(JSON.parse(r.data), JSON.stringify(payload), keys, origin);
      if (status === 404 || status === 410) { gone++; await env.DB.prepare('DELETE FROM subs WHERE endpoint = ?').bind(r.endpoint).run(); }
      else if (status >= 200 && status < 300) sent++;
    } catch (e) { /* one bad subscription shouldn't stop the rest */ }
  }
  return { sent, gone, total: rows.length };
}

// ---------- reminders (cron, every minute) ----------
function fmtTime(ms, tz) {
  try { return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }); }
  catch { return new Date(ms).toISOString().slice(11, 16); }
}
function fmtAgo(ms) { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); if (m < 60) return m + ' min'; return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; }
function describe(e) {
  if (!e) return '';
  const FEED = { breast: 'Breast', bottle: 'Expressed milk', formula: 'Formula', solids: 'Solids' };
  const SIDE = { L: 'Left', R: 'Right', both: 'Both sides' };
  const p = [e.type === 'pump' ? 'Pumping' : FEED[e.kind] || 'Feed'];
  if (e.side && (e.type === 'pump' || e.kind === 'breast')) p.push(SIDE[e.side]);
  if (e.min) p.push(e.min + ' min');
  if (e.ml) p.push(e.ml + ' ml');
  return p.join(' · ');
}
async function latestOf(env, fam, type) {
  const row = await env.DB.prepare('SELECT data FROM events WHERE family = ? AND type = ? AND deleted = 0 ORDER BY t DESC LIMIT 1').bind(fam, type).first();
  return row ? JSON.parse(row.data) : null;
}

async function runReminders(env, origin) {
  await ensureSchema(env);
  const now = Date.now();
  const results = { feed: 0, appts: 0 };
  const due = (await env.DB.prepare('SELECT family, kind, at FROM due WHERE at IS NOT NULL AND at <= ? AND (notified IS NULL OR notified != at) LIMIT 500').bind(now).all()).results;
  for (const d of due) {
    await env.DB.prepare('UPDATE due SET notified = ? WHERE family = ? AND kind = ?').bind(d.at, d.family, d.kind).run();
    if (now - d.at > 2 * HOUR) continue; // too stale to be useful
    const rem = await getRem(env, d.family);
    const last = await latestOf(env, d.family, d.kind);
    const body = last
      ? `Last ${d.kind === 'feed' ? 'feed' : 'pumped'} ${fmtAgo(last.t)} ago at ${fmtTime(last.t, rem.tz)} (${describe(last)}).`
      : `Reminder set for ${fmtTime(d.at, rem.tz)}.`;
    await pushFamily(env, d.family, { title: `Time for the next ${KL[d.kind]}`, body, tag: 'rem-' + d.kind, kind: d.kind, url: '/?log=' + d.kind }, origin);
    results.feed++;
  }
  results.appts = await runApptReminders(env, origin);
  await env.DB.prepare('DELETE FROM rate WHERE reset < ?').bind(now).run();
  return results;
}

const APPT_KIND = { midwife: 'Midwife', cb: 'Consultatiebureau', vaccination: 'Vaccination', doctor: 'Doctor', other: 'Appointment' };
function leadText(min) {
  if (min <= 0) return 'Now';
  if (min < 60) return `In ${min} min`;
  if (min < 24 * 60) return `In ${Math.round(min / 60)} hour${Math.round(min / 60) === 1 ? '' : 's'}`;
  const d = Math.round(min / 1440);
  return d === 1 ? 'Tomorrow' : `In ${d} days`;
}
function fmtDayTime(ms, tz) {
  try { return new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }); }
  catch { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
}
async function runApptReminders(env, origin) {
  const now = Date.now();
  const rows = (await env.DB.prepare('SELECT a.family, a.appt, a.min, a.fire, a.t, p.data, p.deleted FROM alarms a LEFT JOIN appts p ON p.family = a.family AND p.id = a.appt WHERE a.fire <= ? LIMIT 500').bind(now).all()).results;
  let sent = 0; const tzs = {};
  for (const r of rows) {
    await env.DB.prepare('DELETE FROM alarms WHERE family = ? AND appt = ? AND min = ?').bind(r.family, r.appt, r.min).run();
    if (!r.data || r.deleted || now - r.fire > 2 * HOUR) continue;
    const a = JSON.parse(r.data);
    if (a.planned) continue; // expected dates don't notify until a real time is set
    const key = `${r.family}:${r.appt}:${r.t}:${r.min}`;
    const done = await env.DB.prepare('INSERT INTO sent (k, at) VALUES (?, ?) ON CONFLICT(k) DO NOTHING').bind(key, now).run();
    if (!done.meta || done.meta.changes === 0) continue;
    const tz = tzs[r.family] || (tzs[r.family] = (await getRem(env, r.family)).tz);
    const title = `${leadText(Math.round((r.t - now) / 60000) <= 1 ? 0 : r.min)}: ${a.title || APPT_KIND[a.kind] || 'Appointment'}`;
    const body = [fmtDayTime(r.t, tz), a.place, a.note].filter(Boolean).join(' · ').slice(0, 220);
    await pushFamily(env, r.family, { title, body, tag: `appt-${r.appt}-${r.min}`, url: '/?tab=calendar' }, origin);
    sent++;
  }
  await env.DB.prepare('DELETE FROM sent WHERE at < ?').bind(now - 30 * DAY).run();
  return sent;
}

// ---------- API ----------
function rowOut(r) { return r.deleted ? { id: r.id, deleted: true } : { ...JSON.parse(r.data), id: r.id }; }
const cleanId = (id) => String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

async function handleApi(req, env, url) {
  await ensureSchema(env);
  const path = url.pathname.slice(4); // strip "/api"
  const method = req.method;
  const ip = clientIp(req);

  // ----- public endpoints -----
  // Contact for the privacy statement comes from Worker settings (PRIVACY_CONTACT_NAME, PRIVACY_CONTACT_EMAIL), not from the code.
  if (path === '/status' && method === 'GET') return json({ ok: true, turnstile: env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY ? env.TURNSTILE_SITE_KEY : null, contact: { name: env.PRIVACY_CONTACT_NAME || null, email: env.PRIVACY_CONTACT_EMAIL || null } });

  if (path === '/families' && method === 'POST') {
    const b = await readBody(req);
    const member = cleanName(b.member), name = cleanName(b.family, 60) || 'Our family';
    if (!member) return fail(400, 'name_required');
    if (b.consent !== true) return fail(400, 'consent_required'); // explicit consent: the log holds health data about a child
    if (await limited(env, 'create:' + ip, 5, DAY)) return fail(429, 'too_many');
    if (!(await turnstileOk(env, b.turnstile, ip))) return fail(403, 'bot_check');
    const fam = 'f' + randomId(); const code = recoveryCode(); const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO families (id, name, created, recovery_hash, consent) VALUES (?, ?, ?, ?, ?)').bind(fam, name, now, await sha256(normRecovery(code)), b.consent ? now : null),
      fkvSetStmt(env, fam, 'rem', mergeRem({ tz: cleanName(b.tz, 60) || undefined })),
    ]);
    await vapidKeys(env);
    const d = await newDevice(env, fam, member);
    return json({ ok: true, ...d, family: name, recovery: code });
  }
  if (path === '/invite-info' && method === 'POST') {
    // Lets the join screen show which family the invite is for. Reveals only the family name.
    if (await limited(env, 'peek:' + ip, 30, HOUR)) return fail(429, 'too_many');
    const b = await readBody(req);
    const inv = await env.DB.prepare('SELECT i.expires, i.used, i.created_by, f.name FROM invites i JOIN families f ON f.id = i.family WHERE i.code_hash = ?').bind(await sha256(cleanKey(b.code))).first();
    if (!inv || inv.used || inv.expires < Date.now()) return fail(404, 'invite_invalid');
    return json({ family: inv.name, from: inv.created_by || '' });
  }
  if (path === '/join' && method === 'POST') {
    if (await limited(env, 'join:' + ip, 20, HOUR)) return fail(429, 'too_many');
    const b = await readBody(req);
    const member = cleanName(b.member); if (!member) return fail(400, 'name_required');
    const h = await sha256(cleanKey(b.code));
    // Mark used first; only the request that flips it gets in, so a link works once.
    const res = await env.DB.prepare('UPDATE invites SET used = ? WHERE code_hash = ? AND used IS NULL AND expires >= ?').bind(Date.now(), h, Date.now()).run();
    if (!res.meta || res.meta.changes !== 1) { await slow(); return fail(404, 'invite_invalid'); }
    const inv = await env.DB.prepare('SELECT family FROM invites WHERE code_hash = ?').bind(h).first();
    const f = await familyInfo(env, inv.family); if (!f) return fail(404, 'invite_invalid');
    const d = await newDevice(env, inv.family, member);
    return json({ ok: true, ...d, family: f.name });
  }
  if (path === '/recover' && method === 'POST') {
    if (await limited(env, 'recover:' + ip, 10, HOUR)) return fail(429, 'too_many');
    const b = await readBody(req);
    const member = cleanName(b.member); if (!member) return fail(400, 'name_required');
    const code = normRecovery(b.code);
    const f = code.length === 16 ? await env.DB.prepare('SELECT id, name FROM families WHERE recovery_hash = ?').bind(await sha256(code)).first() : null;
    if (!f) { await slow(); return fail(401, 'wrong_code'); }
    const d = await newDevice(env, f.id, member);
    return json({ ok: true, ...d, family: f.name });
  }
  // Phones from before multi-family: trade the old family key for a device token.
  if ((path === '/legacy-login' || path === '/login') && method === 'POST') {
    if (await limited(env, 'legacy:' + ip, 20, HOUR)) return fail(429, 'too_many');
    const b = await readBody(req);
    const fam = await legacyFamilyFor(env, cleanKey(b.key));
    if (!fam) { await slow(); return fail(401, 'wrong_key'); }
    const f = await familyInfo(env, fam);
    if (path === '/login') return json({ ok: true, family: f.name }); // old app version: keeps using the key
    const d = await newDevice(env, fam, cleanName(b.member) || 'Family member');
    return json({ ok: true, ...d, family: f.name });
  }

  // ----- signed-in endpoints -----
  const who = await authenticate(req, env);
  if (!who) return fail(401, 'unauthorized');
  const fam = who.family;

  if (path === '/sync' && method === 'GET') {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const from = since ? since - 2000 : 0; // small overlap; rows are idempotent
    const now = Date.now();
    const [ev, gr, ap] = await Promise.all(['events', 'growth', 'appts'].map((t) => env.DB.prepare(`SELECT id, data, deleted FROM ${t} WHERE family = ? AND updated > ? ORDER BY updated LIMIT 5000`).bind(fam, from).all()));
    const f = await familyInfo(env, fam);
    return json({
      now, full: !since,
      family: f ? { name: f.name, hasRecovery: !!f.has_recovery } : null,
      me: { device: who.device, member: who.member },
      profile: (await fkvGet(env, fam, 'profile')) || {},
      rem: await getRem(env, fam),
      events: ev.results.map(rowOut), growth: gr.results.map(rowOut), appts: ap.results.map(rowOut),
    });
  }

  let m = path.match(/^\/(events|growth|appts)\/([A-Za-z0-9_-]{1,64})$/);
  if (m) {
    const [, table, id] = m;
    const now = Date.now();
    if (method === 'DELETE') {
      // Keep only the marker that other phones need to sync the delete; the content is wiped.
      const stmts = [env.DB.prepare(`UPDATE ${table} SET deleted = 1, updated = ?, data = '{}' WHERE family = ? AND id = ?`).bind(now, fam, id)];
      if (table === 'appts') stmts.push(...alarmStmts(env, fam, id, null, 0, true));
      await env.DB.batch(stmts);
      return json({ ok: true });
    }
    if (method === 'PUT') {
      const data = await readBody(req);
      delete data.id;
      const t = Number(data.t);
      if (!isFinite(t)) return fail(400, 'bad_time');
      const str = JSON.stringify(data);
      if (str.length > 8000) return fail(400, 'too_large');
      let isNew = false;
      if (table === 'events') {
        isNew = !(await env.DB.prepare('SELECT id FROM events WHERE family = ? AND id = ?').bind(fam, id).first());
        await env.DB.prepare('INSERT INTO events (family, id, type, t, data, updated, deleted) VALUES (?, ?, ?, ?, ?, ?, 0) ON CONFLICT(family, id) DO UPDATE SET type = excluded.type, t = excluded.t, data = excluded.data, updated = excluded.updated, deleted = 0')
          .bind(fam, id, String(data.type || ''), t, str, now).run();
      } else {
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO ${table} (family, id, t, data, updated, deleted) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(family, id) DO UPDATE SET t = excluded.t, data = excluded.data, updated = excluded.updated, deleted = 0`).bind(fam, id, t, str, now),
          ...(table === 'appts' ? alarmStmts(env, fam, id, data, t, false) : []),
        ]);
      }
      // Automatic reminder: whoever logs, the next one is set from this start time.
      let rem = null;
      if (isNew && (data.type === 'feed' || data.type === 'pump')) {
        const r = await getRem(env, fam);
        const cfg = r[data.type];
        if (cfg.auto && t > now - 6 * HOUR) {
          const last = await latestOf(env, fam, data.type);
          if (!last || last.t <= t) { r.due[data.type] = t + cfg.hours * HOUR; await setRem(env, fam, r); rem = r; }
        }
      }
      return json({ ok: true, rem });
    }
  }

  if (path === '/profile' && method === 'PUT') {
    const b = await readBody(req);
    const mlPerKg = Number(b.mlPerKg);
    await fkvSet(env, fam, 'profile', { name: String(b.name || '').slice(0, 60), birth: String(b.birth || '').slice(0, 10), sex: b.sex === 'boy' ? 'boy' : 'girl', guideSrc: b.guideSrc === 'doctor' ? 'doctor' : 'nl', mlPerKg: mlPerKg >= 100 && mlPerKg <= 200 ? Math.round(mlPerKg) : 150, nightStart: hhmm(b.nightStart, '19:00'), nightEnd: hhmm(b.nightEnd, '07:00') });
    return json({ ok: true });
  }
  if (path === '/reminders' && method === 'PUT') {
    const r = mergeRem(await readBody(req));
    for (const k of ['feed', 'pump']) {
      r[k].hours = Math.min(24, Math.max(0.25, Number(r[k].hours) || 3));
      r[k].auto = !!r[k].auto;
      r.due[k] = r.due[k] ? Number(r.due[k]) : null;
    }
    await setRem(env, fam, r);
    return json({ ok: true, rem: r });
  }
  if (path === '/snooze' && method === 'POST') {
    const b = await readBody(req);
    const kind = b.kind === 'pump' ? 'pump' : 'feed';
    const r = await getRem(env, fam);
    r.due[kind] = Math.max(r.due[kind] || 0, Date.now()) + (Number(b.minutes) || 15) * 60000;
    await setRem(env, fam, r);
    return json({ ok: true, rem: r });
  }

  // ----- family members and devices -----
  if (path === '/invites' && method === 'POST') {
    if (await limited(env, 'invite:' + fam, 30, DAY)) return fail(429, 'too_many');
    const code = randomToken(18);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM invites WHERE family = ? AND (used IS NOT NULL OR expires < ?)').bind(fam, Date.now()),
      env.DB.prepare('INSERT INTO invites (code_hash, family, created_by, expires) VALUES (?, ?, ?, ?)').bind(await sha256(code), fam, who.member || null, Date.now() + INVITE_DAYS * DAY),
    ]);
    return json({ ok: true, code, url: url.origin + '/join#' + code, days: INVITE_DAYS });
  }
  if (path === '/devices' && method === 'GET') {
    const rows = (await env.DB.prepare('SELECT d.id, d.member, d.created, d.last_seen, (SELECT COUNT(*) FROM subs s WHERE s.device = d.id) AS push FROM devices d WHERE d.family = ? ORDER BY d.created').bind(fam).all()).results;
    const legacyPush = (await env.DB.prepare('SELECT COUNT(*) AS n FROM subs WHERE family = ?').bind(fam).first()).n;
    return json({ devices: rows.map((r) => ({ id: r.id, member: r.member, created: r.created, lastSeen: r.last_seen, push: r.push > 0, me: r.id === who.device })), pushPhones: legacyPush });
  }
  m = path.match(/^\/devices\/([A-Za-z0-9_-]{1,40}|me)$/);
  if (m && method === 'DELETE') {
    const id = m[1] === 'me' ? who.device : m[1];
    if (!id) return json({ ok: true });
    const d = await env.DB.prepare('SELECT id FROM devices WHERE id = ? AND family = ?').bind(id, fam).first();
    if (!d) return fail(404, 'not_found');
    await env.DB.batch([env.DB.prepare('DELETE FROM subs WHERE device = ?').bind(id), env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id)]);
    return json({ ok: true });
  }
  if (path === '/recovery-code' && method === 'POST') {
    // Makes a new recovery code; the old one stops working.
    const code = recoveryCode();
    await env.DB.prepare('UPDATE families SET recovery_hash = ? WHERE id = ?').bind(await sha256(normRecovery(code)), fam).run();
    return json({ ok: true, recovery: code });
  }
  if (path === '/family' && method === 'PUT') {
    const b = await readBody(req); const name = cleanName(b.name, 60);
    if (!name) return fail(400, 'name_required');
    await env.DB.prepare('UPDATE families SET name = ? WHERE id = ?').bind(name, fam).run();
    return json({ ok: true });
  }
  if (path === '/family' && method === 'DELETE') {
    // Deletes the family log and everything in it, for every member.
    const b = await readBody(req);
    if (b.confirm !== 'delete') return fail(400, 'confirm_required');
    await env.DB.batch(['events', 'growth', 'appts', 'family_kv', 'devices', 'invites', 'subs', 'due', 'alarms'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE family = ?`).bind(fam))
      .concat([env.DB.prepare('DELETE FROM families WHERE id = ?').bind(fam), env.DB.prepare("DELETE FROM sent WHERE k LIKE ? || ':%'").bind(fam)]));
    if ((await kvGet(env, 'legacy_family')) === fam) await env.DB.prepare("DELETE FROM kv WHERE k = 'legacy_family'").run();
    return json({ ok: true });
  }

  // ----- notifications -----
  if (path === '/vapid' && method === 'GET') return json({ publicKey: (await vapidKeys(env)).publicKey });
  if (path === '/subscribe' && method === 'POST') {
    const b = await readBody(req);
    const s = b.subscription;
    if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return fail(400, 'bad_subscription');
    if (!/^https?:\/\//.test(s.endpoint) || s.endpoint.length > 1000) return fail(400, 'bad_subscription');
    if ((await kvGet(env, 'origin')) !== url.origin) await kvSet(env, 'origin', url.origin);
    await env.DB.prepare('INSERT INTO subs (endpoint, family, device, data, member, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET family = excluded.family, device = excluded.device, data = excluded.data, member = excluded.member')
      .bind(s.endpoint, fam, who.device, JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }), cleanName(b.member || who.member), Date.now()).run();
    return json({ ok: true });
  }
  if (path === '/unsubscribe' && method === 'POST') {
    const b = await readBody(req);
    await env.DB.prepare('DELETE FROM subs WHERE endpoint = ? AND family = ?').bind(String(b.endpoint || ''), fam).run();
    return json({ ok: true });
  }
  if (path === '/test-push' && method === 'POST') {
    const b = await readBody(req);
    const res = await pushFamily(env, fam, { title: 'Notifications are on', body: 'Feed and pumping reminders will arrive on this device.', tag: 'test', url: '/' }, url.origin, b.endpoint || null);
    return json(res);
  }

  if (path === '/import' && method === 'POST') {
    const b = await readBody(req);
    const now = Date.now();
    const stmts = [];
    for (const e of (Array.isArray(b.events) ? b.events : []).slice(0, 20000)) {
      if (!e || !e.id || !isFinite(Number(e.t))) continue;
      const { id, ...d } = e;
      stmts.push(env.DB.prepare('INSERT INTO events (family, id, type, t, data, updated, deleted) VALUES (?, ?, ?, ?, ?, ?, 0) ON CONFLICT(family, id) DO UPDATE SET type = excluded.type, t = excluded.t, data = excluded.data, updated = excluded.updated, deleted = 0')
        .bind(fam, cleanId(id) || randomId(), String(d.type || ''), Number(d.t), JSON.stringify(d), now));
    }
    for (const g of (Array.isArray(b.growth) ? b.growth : []).slice(0, 5000)) {
      if (!g || !g.id || !isFinite(Number(g.t))) continue;
      const { id, ...d } = g;
      stmts.push(env.DB.prepare('INSERT INTO growth (family, id, t, data, updated, deleted) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(family, id) DO UPDATE SET t = excluded.t, data = excluded.data, updated = excluded.updated, deleted = 0')
        .bind(fam, cleanId(id) || randomId(), Number(d.t), JSON.stringify(d), now));
    }
    let n = stmts.length;
    for (const a of (Array.isArray(b.appts) ? b.appts : []).slice(0, 2000)) {
      if (!a || !a.id || !isFinite(Number(a.t))) continue;
      const { id, ...d } = a; const cid = cleanId(id) || randomId();
      stmts.push(env.DB.prepare('INSERT INTO appts (family, id, t, data, updated, deleted) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(family, id) DO UPDATE SET t = excluded.t, data = excluded.data, updated = excluded.updated, deleted = 0')
        .bind(fam, cid, Number(d.t), JSON.stringify(d), now));
      stmts.push(...alarmStmts(env, fam, cid, d, Number(d.t), false));
      n++;
    }
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    if (b.profile && typeof b.profile === 'object' && b.profile.name) await fkvSet(env, fam, 'profile', b.profile);
    return json({ ok: true, imported: n });
  }
  return fail(404, 'not_found');
}

// The staging copy shows a banner and has its own home-screen name, so it can't be mistaken for the real log.
function markStaging(path, asset, body) {
  if (asset === ASSETS['/']) return body
    .replace('<meta name="apple-mobile-web-app-title" content="Baby Log">', '<meta name="apple-mobile-web-app-title" content="Baby Log TEST">')
    .replace('<title>Baby Care Log</title>', '<title>Baby Care Log (staging)</title>')
    .replace('<div id="root"></div>', '<div style="position:sticky;top:0;z-index:50;background:#b3261e;color:#fff;font:600 13px system-ui,sans-serif;text-align:center;padding:calc(4px + env(safe-area-inset-top,0px)) 8px 4px">Staging copy for testing · not your real log</div><div id="root"></div>');
  if (path === '/manifest.webmanifest') return body.replace('"name": "Baby Care Log"', '"name": "Baby Care Log (staging)"').replace('"short_name": "Baby Log"', '"short_name": "Baby Log TEST"');
  return body;
}

function setupHelp(message) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baby Care Log · setup</title>
<body style="font-family:system-ui;max-width:520px;margin:40px auto;padding:0 16px;line-height:1.5"><h1>Almost there</h1><p>${message}</p>
<p>In the Cloudflare dashboard open this Worker → <b>Settings → Bindings → Add → D1 database</b>, set the variable name to <code>DB</code>, choose your database, then deploy again.</p></body>`, { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, env, url);
    } catch (e) {
      if (String(e && e.message) === 'NO_DB') return fail(500, 'no_database');
      console.error(e);
      return fail(500, 'server_error');
    }
    if (!env.DB) return setupHelp('The app is running, but it isn’t connected to its database yet.');
    const asset = ASSETS[url.pathname] || (req.method === 'GET' && !url.pathname.includes('.') ? ASSETS['/'] : null);
    if (!asset) return new Response('Not found', { status: 404 });
    let body = asset.b64 ? Uint8Array.from(atob(asset.body), (c) => c.charCodeAt(0)) : asset.body;
    if (env.APP_ENV === 'staging') body = markStaging(url.pathname, asset, body);
    return new Response(body, { headers: { 'content-type': asset.type, 'cache-control': asset.cache || 'no-cache' } });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await ensureSchema(env);
      const origin = (await kvGet(env, 'origin')) || 'mailto:babycarelog@users.noreply.github.com';
      await runReminders(env, origin);
    })().catch((e) => console.error(e)));
  },
};
