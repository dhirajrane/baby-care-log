// Migration from the one-family database (schema version 1) to multi-family.
// Self-contained: builds a version 1 database in a temporary folder, starts `wrangler dev` on port 8788 against it,
// and checks that data, settings, the old family key, push subscriptions and already-sent reminders carry over.
// Run after `npm run build`:  node test/migrate.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import ece from 'http_ece';

const PORT = 8788, B = 'http://localhost:' + PORT, KEY = 'sunshine-2026';
let ok = 0; const check = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else ok++; };
const dir = mkdtempSync(join(tmpdir(), 'bcl-migrate-'));
const b64u = (b) => Buffer.from(b).toString('base64url');
const q = (v) => v == null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const now = Date.now(), H = 36e5, M = 60000;

// ----- a version 1 database -----
const salt = b64u(crypto.randomBytes(16));
const auth = { salt, hash: b64u(crypto.createHash('sha256').update(salt + ':' + KEY).digest()), family: 'Rane family' };
const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const pauth = crypto.randomBytes(16);
const sub = { endpoint: 'http://127.0.0.1:9931/old', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: pauth.toString('base64url') } };
const appt = (id, t, remind, extra = {}) => ({ id, t, data: JSON.stringify({ kind: 'cb', title: 'Appt ' + id, t, remind, ...extra }) });
const appts = [
  appt('a-due', now + 50 * M, [60]),            // 1 h reminder is due now: should be sent once after migration
  appt('a-sent', now + 40 * M, [60]),           // 1 h reminder already sent by the old version: must not repeat
  appt('a-planned', now + 30 * M, [60], { planned: true }),
  appt('a-later', now + 3 * 24 * H, [1440]),
];
const sql = [
  `CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE events (id TEXT PRIMARY KEY, type TEXT, t INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX events_updated ON events(updated)`,
  `CREATE INDEX events_type_t ON events(type, t)`,
  `CREATE TABLE growth (id TEXT PRIMARY KEY, t INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX growth_updated ON growth(updated)`,
  `CREATE TABLE appts (id TEXT PRIMARY KEY, t INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX appts_updated ON appts(updated)`,
  `CREATE INDEX appts_t ON appts(t)`,
  `CREATE TABLE sent (k TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  `CREATE TABLE subs (endpoint TEXT PRIMARY KEY, data TEXT NOT NULL, member TEXT, created INTEGER NOT NULL)`,
  `INSERT INTO kv VALUES ('auth', ${q(JSON.stringify(auth))})`,
  `INSERT INTO kv VALUES ('profile', ${q(JSON.stringify({ name: 'Mira', birth: '2026-09-18', sex: 'girl', mlPerKg: 150 }))})`,
  // feed reminder already notified by the old version; pump reminder in the future
  `INSERT INTO kv VALUES ('rem', ${q(JSON.stringify({ feed: { auto: true, hours: 3 }, pump: { auto: false, hours: 3 }, due: { feed: now - 5 * M, pump: now + H }, tz: 'Europe/Amsterdam' }))})`,
  `INSERT INTO kv VALUES ('notified', ${q(JSON.stringify({ feed: now - 5 * M }))})`,
  ...Array.from({ length: 30 }, (_, i) => `INSERT INTO events VALUES ('e${i}', 'feed', ${now - i * 3 * H}, ${q(JSON.stringify({ type: 'feed', kind: 'bottle', ml: 90 + i, t: now - i * 3 * H, by: 'Dhiraj' }))}, ${now - i * H}, 0)`),
  `INSERT INTO events VALUES ('gone', 'diaper', ${now - H}, '{}', ${now}, 1)`,
  `INSERT INTO growth VALUES ('g1', ${now - 7 * 24 * H}, ${q(JSON.stringify({ t: now - 7 * 24 * H, kg: 4.5, cm: 55 }))}, ${now}, 0)`,
  ...appts.map((a) => `INSERT INTO appts VALUES (${q(a.id)}, ${a.t}, ${q(a.data)}, ${now}, 0)`),
  `INSERT INTO sent VALUES (${q(`a-sent:${appts[1].t}:60`)}, ${now - 20 * M})`,
  `INSERT INTO subs VALUES (${q(sub.endpoint)}, ${q(JSON.stringify(sub))}, 'Dhiraj', ${now - 24 * H})`,
].map((s) => s + ';').join('\n');
writeFileSync(join(dir, 'v1.sql'), sql);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'baby-care-log', '--local', '--persist-to', dir, '--file', join(dir, 'v1.sql')], { stdio: 'ignore' });

// ----- start the new worker on it -----
const wr = spawn('npx', ['wrangler', 'dev', '--local', '--test-scheduled', '--port', String(PORT), '--persist-to', dir], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-wr.pid); } catch (e) {} rmSync(dir, { recursive: true, force: true }); };
process.on('exit', stop);
for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/status')).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 1000)); }

const got = [];
const srv = http.createServer((qq, s) => { const c = []; qq.on('data', (x) => c.push(x)); qq.on('end', () => { got.push(Buffer.concat(c)); s.writeHead(201); s.end(); }); }).listen(9931);
const j = async (p, o = {}) => {
  const h = { 'content-type': 'application/json', ...(o.key ? { 'x-family-key': o.key } : {}), ...(o.token ? { authorization: 'Bearer ' + o.token } : {}) };
  const r = await fetch(B + p, { method: o.method || 'GET', headers: h, body: o.body ? JSON.stringify(o.body) : undefined });
  let d = null; try { d = await r.json(); } catch {} return { s: r.status, d };
};

// Old phones keep working with the family key
let s = await j('/api/sync', { key: KEY });
check(s.s === 200, 'old family key still works after migration');
check(s.d.events.filter((e) => !e.deleted).length === 30 && s.d.events.some((e) => e.id === 'gone' && e.deleted), 'all entries and tombstones carried over');
check(s.d.events.find((e) => e.id === 'e3').ml === 93, 'entry content intact');
check(s.d.growth.length === 1 && s.d.appts.length === 4, 'growth and appointments carried over');
check(s.d.profile.name === 'Mira' && s.d.rem.feed.auto === true && s.d.rem.due.pump > now, 'profile and reminder settings carried over');
check(s.d.family.name === 'Rane family' && s.d.family.hasRecovery === false, 'family name; no recovery code yet');
check((await j('/api/sync', { key: 'wrong-key' })).s === 401, 'wrong old key refused');
check((await j('/api/login', { method: 'POST', body: { key: KEY } })).d.family === 'Rane family', 'old app version can still sign in');

// Trading the old key for a device token
const up = await j('/api/legacy-login', { method: 'POST', body: { key: KEY, member: 'Dhiraj' } });
check(up.s === 200 && up.d.token, 'old key traded for a device token');
s = await j('/api/sync', { token: up.d.token });
check(s.d.events.filter((e) => !e.deleted).length === 30 && s.d.me.member === 'Dhiraj', 'token sees the same log');
const dv = (await j('/api/devices', { token: up.d.token })).d;
check(dv.devices.length === 1 && dv.pushPhones === 1, 'device listed; old push subscription kept');
check((await j('/api/legacy-login', { method: 'POST', body: { key: 'nope', member: 'x' } })).s === 401, 'wrong key not traded');

// Reminders after migration: the due appointment reminder is sent once; already-sent ones are not repeated
await fetch(B + '/__scheduled?cron=*+*+*+*+*'); await new Promise((r) => setTimeout(r, 2000));
await fetch(B + '/__scheduled?cron=*+*+*+*+*'); await new Promise((r) => setTimeout(r, 2000));
const msgs = got.map((g) => JSON.parse(ece.decrypt(g, { version: 'aes128gcm', privateKey: ua, authSecret: pauth.toString('base64url') }).toString()));
check(msgs.length === 1 && msgs[0].title === 'In 1 hour: Appt a-due', 'exactly one push after migration: ' + JSON.stringify(msgs.map((m) => m.title)));

// A recovery code can be made for the migrated family
const rc = (await j('/api/recovery-code', { method: 'POST', token: up.d.token })).d.recovery;
check(rc && (await j('/api/recover', { method: 'POST', body: { code: rc, member: 'Anna' } })).s === 200, 'recovery code for the migrated family');
// New families live next to it without seeing its data
const other = (await j('/api/families', { method: 'POST', body: { family: 'Other', member: 'O' } })).d;
check((await j('/api/sync', { token: other.token })).d.events.length === 0, 'new family sees nothing of the migrated one');

srv.close();
console.log(ok, 'checks passed');
process.exit();
