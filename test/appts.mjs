// Appointment reminder checks (run while `npm run dev` is up with a fresh local database).
import http from 'node:http';
import crypto from 'node:crypto';
import ece from 'http_ece';
const B = 'http://localhost:8787', KEY = 'sunshine-2026';
let ok = 0; const check = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else ok++; };
const j = async (p, o = {}) => { const r = await fetch(B + p, { method: o.method || 'GET', headers: { 'content-type': 'application/json', 'x-family-key': KEY }, body: o.body ? JSON.stringify(o.body) : undefined }); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d }; };
const got = [];
const srv = http.createServer((q, s) => { const c = []; q.on('data', (x) => c.push(x)); q.on('end', () => { got.push(Buffer.concat(c)); s.writeHead(201); s.end(); }); }).listen(9912);
const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16);
const sub = { endpoint: 'http://127.0.0.1:9912/p', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
const tick = async () => { await fetch(B + '/__scheduled?cron=*+*+*+*+*'); await new Promise((r) => setTimeout(r, 1500)); };

await j('/api/setup', { method: 'POST', body: { key: KEY, family: 'T' } });
await j('/api/subscribe', { method: 'POST', body: { subscription: sub, member: 'Dad' } });
const now = Date.now(), M = 60000;
await j('/api/appts/a1', { method: 'PUT', body: { kind: 'cb', title: '8-week check-up', t: now + 59 * M, place: 'CB Centrum', remind: [1440, 60] } }); // 1 h reminder due; 1 day one is >2 h old, skipped
await j('/api/appts/a2', { method: 'PUT', body: { kind: 'vaccination', title: 'Vaccination: rotavirus', t: now + 30 * M, remind: [60], planned: true } }); // expected date: silent
await j('/api/appts/a3', { method: 'PUT', body: { kind: 'doctor', title: 'Deleted one', t: now + 10 * M, remind: [60] } });
await j('/api/appts/a3', { method: 'DELETE' });
await j('/api/appts/a4', { method: 'PUT', body: { kind: 'midwife', title: 'Midwife visit', t: now + 3 * 1440 * M, remind: [1440] } }); // not due yet

const sync = await j('/api/sync');
check(sync.d.appts.filter((a) => !a.deleted).length === 3, 'sync returns 3 live appointments');
check(sync.d.appts.some((a) => a.id === 'a3' && a.deleted), 'deleted appointment comes back as a tombstone');

await tick(); await tick();
check(got.length === 1, 'exactly one appointment push, got ' + got.length);
if (got[0]) {
  const m = JSON.parse(ece.decrypt(got[0], { version: 'aes128gcm', privateKey: ua, authSecret: auth.toString('base64url') }).toString());
  console.log('  push:', JSON.stringify(m));
  check(m.title === 'In 1 hour: 8-week check-up', 'title');
  check(m.body.includes('CB Centrum'), 'place in body');
  check(m.url === '/?tab=calendar', 'opens the calendar');
}
// Moving the appointment re-arms its reminders.
await j('/api/appts/a1', { method: 'PUT', body: { kind: 'cb', title: '8-week check-up', t: now + 50 * M, place: 'CB Centrum', remind: [60] } });
await tick();
check(got.length === 2, 'rescheduled appointment notifies again');
srv.close();
console.log(ok, 'checks passed');
