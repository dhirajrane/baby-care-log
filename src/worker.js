// Baby Care Log — Cloudflare Worker (static app + API + reminder cron)
import { ASSETS } from './assets.js';
import { generateVapidKeys, sendPush, b64uEncode } from './webpush.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, type TEXT, t INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS events_updated ON events(updated)`,
  `CREATE INDEX IF NOT EXISTS events_type_t ON events(type, t)`,
  `CREATE TABLE IF NOT EXISTS growth (id TEXT PRIMARY KEY, t INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS growth_updated ON growth(updated)`,
  `CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, data TEXT NOT NULL, member TEXT, created INTEGER NOT NULL)`,
];
const REM_DEFAULT = { feed: { auto: false, hours: 3 }, pump: { auto: false, hours: 3 }, due: { feed: null, pump: null }, tz: 'Europe/Amsterdam' };
const KL = { feed: 'feed', pump: 'pumping session' };
const HOUR = 36e5;

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  if (!env.DB) throw new Error('NO_DB');
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  schemaReady = true;
}
async function kvGet(env, k) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first();
  return row ? JSON.parse(row.v) : null;
}
async function kvSet(env, k, v) {
  await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, JSON.stringify(v)).run();
}
function mergeRem(d) {
  d = d || {};
  return {
    feed: { ...REM_DEFAULT.feed, ...(d.feed || {}) },
    pump: { ...REM_DEFAULT.pump, ...(d.pump || {}) },
    due: { feed: null, pump: null, ...(d.due || {}) },
    tz: d.tz || REM_DEFAULT.tz,
  };
}
async function getRem(env) { return mergeRem(await kvGet(env, 'rem')); }

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (status, error) => json({ error }, status);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return b64uEncode(buf);
}
async function checkKey(env, key) {
  const auth = await kvGet(env, 'auth');
  if (!auth || !key) return false;
  return (await sha256(auth.salt + ':' + key)) === auth.hash;
}
const cleanKey = (k) => String(k || '').trim();

function fmtTime(ms, tz) {
  try { return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }); }
  catch { return new Date(ms).toISOString().slice(11, 16); }
}
function fmtAgo(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}
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

async function latestOf(env, type) {
  const row = await env.DB.prepare('SELECT data FROM events WHERE type = ? AND deleted = 0 ORDER BY t DESC LIMIT 1').bind(type).first();
  return row ? JSON.parse(row.data) : null;
}

// ---------- push ----------
async function vapidKeys(env) {
  let keys = await kvGet(env, 'vapid');
  if (!keys) { keys = await generateVapidKeys(); await kvSet(env, 'vapid', keys); }
  return keys;
}
async function pushAll(env, payload, origin, onlyEndpoint) {
  const keys = await vapidKeys(env);
  const rows = onlyEndpoint
    ? (await env.DB.prepare('SELECT endpoint, data FROM subs WHERE endpoint = ?').bind(onlyEndpoint).all()).results
    : (await env.DB.prepare('SELECT endpoint, data FROM subs').all()).results;
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

async function runReminders(env, origin) {
  await ensureSchema(env);
  const rem = await getRem(env);
  const notified = (await kvGet(env, 'notified')) || {};
  const now = Date.now();
  let changed = false;
  const results = {};
  for (const kind of ['feed', 'pump']) {
    const due = rem.due[kind];
    if (!due || due > now || notified[kind] === due) continue;
    notified[kind] = due; changed = true;
    if (now - due > 2 * HOUR) continue; // too stale to be useful
    const last = await latestOf(env, kind);
    const body = last
      ? `Last ${kind === 'feed' ? 'feed' : 'pumped'} ${fmtAgo(last.t)} ago at ${fmtTime(last.t, rem.tz)} (${describe(last)}).`
      : `Reminder set for ${fmtTime(due, rem.tz)}.`;
    results[kind] = await pushAll(env, { title: `Time for the next ${KL[kind]}`, body, tag: 'rem-' + kind, kind, url: '/?log=' + kind }, origin);
  }
  if (changed) await kvSet(env, 'notified', notified);
  return results;
}

// ---------- API ----------
async function readBody(req) { try { return await req.json(); } catch { return {}; } }

function rowOut(r) { return r.deleted ? { id: r.id, deleted: true } : { ...JSON.parse(r.data), id: r.id }; }

async function handleApi(req, env, url, ctx) {
  await ensureSchema(env);
  const path = url.pathname.slice(4); // strip "/api"
  const method = req.method;

  if (path === '/status' && method === 'GET') {
    const auth = await kvGet(env, 'auth');
    return json({ setup: !!auth, family: auth ? auth.family || '' : '' });
  }
  if (path === '/setup' && method === 'POST') {
    if (await kvGet(env, 'auth')) return fail(409, 'already_setup');
    const b = await readBody(req);
    const key = cleanKey(b.key);
    if (key.length < 6) return fail(400, 'key_too_short');
    const salt = b64uEncode(crypto.getRandomValues(new Uint8Array(16)));
    await kvSet(env, 'auth', { salt, hash: await sha256(salt + ':' + key), family: String(b.family || '').slice(0, 60) });
    await vapidKeys(env);
    return json({ ok: true });
  }
  if (path === '/login' && method === 'POST') {
    const b = await readBody(req);
    if (!(await checkKey(env, cleanKey(b.key)))) { await new Promise((r) => setTimeout(r, 600)); return fail(401, 'wrong_key'); }
    const auth = await kvGet(env, 'auth');
    return json({ ok: true, family: auth.family || '' });
  }

  if (!(await checkKey(env, cleanKey(req.headers.get('x-family-key'))))) return fail(401, 'unauthorized');

  if (path === '/sync' && method === 'GET') {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const from = since ? since - 2000 : 0; // small overlap; rows are idempotent
    const now = Date.now();
    const [ev, gr] = await Promise.all([
      env.DB.prepare('SELECT * FROM events WHERE updated > ? ORDER BY updated LIMIT 5000').bind(from).all(),
      env.DB.prepare('SELECT * FROM growth WHERE updated > ? ORDER BY updated LIMIT 5000').bind(from).all(),
    ]);
    return json({
      now,
      full: !since,
      profile: (await kvGet(env, 'profile')) || {},
      rem: await getRem(env),
      events: ev.results.map(rowOut),
      growth: gr.results.map(rowOut),
    });
  }

  let m = path.match(/^\/(events|growth)\/([A-Za-z0-9_-]{1,64})$/);
  if (m) {
    const [, table, id] = m;
    const now = Date.now();
    if (method === 'DELETE') {
      await env.DB.prepare(`UPDATE ${table} SET deleted = 1, updated = ? WHERE id = ?`).bind(now, id).run();
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
        const existing = await env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(id).first();
        isNew = !existing;
        await env.DB.prepare('INSERT INTO events (id, type, t, data, updated, deleted) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET type = excluded.type, t = excluded.t, data = excluded.data, updated = excluded.updated, deleted = 0')
          .bind(id, String(data.type || ''), t, str, now).run();
      } else {
        await env.DB.prepare('INSERT INTO growth (id, t, data, updated, deleted) VALUES (?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET t = excluded.t, data = excluded.data, updated = excluded.updated, deleted = 0')
          .bind(id, t, str, now).run();
      }
      // Automatic reminder: whoever logs, the next one is set from this start time.
      let rem = null;
      if (isNew && (data.type === 'feed' || data.type === 'pump')) {
        const r = await getRem(env);
        const cfg = r[data.type];
        if (cfg.auto && t > now - 6 * HOUR) {
          const last = await latestOf(env, data.type);
          if (!last || last.t <= t) { r.due[data.type] = t + cfg.hours * HOUR; await kvSet(env, 'rem', r); rem = r; }
        }
      }
      return json({ ok: true, rem });
    }
  }

  if (path === '/profile' && method === 'PUT') {
    const b = await readBody(req);
    await kvSet(env, 'profile', { name: String(b.name || '').slice(0, 60), birth: String(b.birth || '').slice(0, 10), sex: b.sex === 'boy' ? 'boy' : 'girl' });
    return json({ ok: true });
  }
  if (path === '/reminders' && method === 'PUT') {
    const r = mergeRem(await readBody(req));
    for (const k of ['feed', 'pump']) {
      r[k].hours = Math.min(24, Math.max(0.25, Number(r[k].hours) || 3));
      r[k].auto = !!r[k].auto;
      r.due[k] = r.due[k] ? Number(r.due[k]) : null;
    }
    await kvSet(env, 'rem', r);
    return json({ ok: true, rem: r });
  }
  if (path === '/snooze' && method === 'POST') {
    const b = await readBody(req);
    const kind = b.kind === 'pump' ? 'pump' : 'feed';
    const r = await getRem(env);
    r.due[kind] = Math.max(r.due[kind] || 0, Date.now()) + (Number(b.minutes) || 15) * 60000;
    await kvSet(env, 'rem', r);
    return json({ ok: true, rem: r });
  }

  if (path === '/vapid' && method === 'GET') return json({ publicKey: (await vapidKeys(env)).publicKey });
  if (path === '/subscribe' && method === 'POST') {
    const b = await readBody(req);
    const s = b.subscription;
    if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return fail(400, 'bad_subscription');
    if (!/^https?:\/\//.test(s.endpoint)) return fail(400, 'bad_subscription');
    if ((await kvGet(env, 'origin')) !== url.origin) await kvSet(env, 'origin', url.origin);
    await env.DB.prepare('INSERT INTO subs (endpoint, data, member, created) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET data = excluded.data, member = excluded.member')
      .bind(s.endpoint, JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }), String(b.member || '').slice(0, 40), Date.now()).run();
    return json({ ok: true });
  }
  if (path === '/unsubscribe' && method === 'POST') {
    const b = await readBody(req);
    await env.DB.prepare('DELETE FROM subs WHERE endpoint = ?').bind(String(b.endpoint || '')).run();
    return json({ ok: true });
  }
  if (path === '/devices' && method === 'GET') {
    const rows = (await env.DB.prepare('SELECT member, created FROM subs ORDER BY created').all()).results;
    return json({ devices: rows });
  }
  if (path === '/test-push' && method === 'POST') {
    const b = await readBody(req);
    const res = await pushAll(env, { title: 'Notifications are on', body: 'Feed and pumping reminders will arrive on this device.', tag: 'test', url: '/' }, url.origin, b.endpoint || null);
    return json(res);
  }
  if (path === '/import' && method === 'POST') {
    const b = await readBody(req);
    const now = Date.now();
    const stmts = [];
    for (const e of (Array.isArray(b.events) ? b.events : []).slice(0, 20000)) {
      if (!e || !e.id || !isFinite(Number(e.t))) continue;
      const { id, ...d } = e;
      stmts.push(env.DB.prepare('INSERT INTO events (id, type, t, data, updated, deleted) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET type = excluded.type, t = excluded.t, data = excluded.data, updated = excluded.updated, deleted = 0')
        .bind(String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || crypto.randomUUID(), String(d.type || ''), Number(d.t), JSON.stringify(d), now));
    }
    for (const g of (Array.isArray(b.growth) ? b.growth : []).slice(0, 5000)) {
      if (!g || !g.id || !isFinite(Number(g.t))) continue;
      const { id, ...d } = g;
      stmts.push(env.DB.prepare('INSERT INTO growth (id, t, data, updated, deleted) VALUES (?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET t = excluded.t, data = excluded.data, updated = excluded.updated, deleted = 0')
        .bind(String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || crypto.randomUUID(), Number(d.t), JSON.stringify(d), now));
    }
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    if (b.profile && typeof b.profile === 'object' && b.profile.name) await kvSet(env, 'profile', b.profile);
    return json({ ok: true, imported: stmts.length });
  }
  return fail(404, 'not_found');
}

function setupHelp(message) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baby Care Log · setup</title>
<body style="font-family:system-ui;max-width:520px;margin:40px auto;padding:0 16px;line-height:1.5"><h1>Almost there</h1><p>${message}</p>
<p>In the Cloudflare dashboard open this Worker → <b>Settings → Bindings → Add → D1 database</b>, set the variable name to <code>DB</code>, choose your database, then deploy again.</p></body>`, { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, env, url, ctx);
    } catch (e) {
      if (String(e && e.message) === 'NO_DB') return fail(500, 'no_database');
      return fail(500, 'server_error');
    }
    if (!env.DB) return setupHelp('The app is running, but it isn’t connected to its database yet.');
    const asset = ASSETS[url.pathname] || (req.method === 'GET' && !url.pathname.includes('.') ? ASSETS['/'] : null);
    if (!asset) return new Response('Not found', { status: 404 });
    const body = asset.b64 ? Uint8Array.from(atob(asset.body), (c) => c.charCodeAt(0)) : asset.body;
    return new Response(body, { headers: { 'content-type': asset.type, 'cache-control': asset.cache || 'no-cache' } });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await ensureSchema(env);
      const origin = (await kvGet(env, 'origin')) || 'mailto:babycarelog@users.noreply.github.com';
      await runReminders(env, origin);
    })().catch(() => {}));
  },
};
