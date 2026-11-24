// Multi-family checks: families can't see or change each other's data, invites work once and expire,
// recovery codes, removing a phone, reminders only reach the right family, deleting a family.
// Run while `npm run dev` is up; it creates its own families.
import http from 'node:http';
import crypto from 'node:crypto';
import ece from 'http_ece';
const B = 'http://localhost:8787';
const IP = '10.2.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250);
let ok = 0; const check = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else ok++; };
const j = async (p, o = {}) => {
  const h = { 'content-type': 'application/json', 'cf-connecting-ip': o.ip || IP };
  if (o.token) h.authorization = 'Bearer ' + o.token;
  const r = await fetch(B + p, { method: o.method || 'GET', headers: h, body: o.body ? JSON.stringify(o.body) : undefined });
  let d = null; try { d = await r.json(); } catch {} return { s: r.status, d };
};
const tick = async () => { await fetch(B + '/__scheduled?cron=*+*+*+*+*'); await new Promise((r) => setTimeout(r, 1500)); };
const now = Date.now();

// Two families
const A = (await j('/api/families', { method: 'POST', body: { family: 'Family A', member: 'Anna', consent: true } })).d;
const Bf = (await j('/api/families', { method: 'POST', body: { family: 'Family B', member: 'Bram', consent: true } })).d;
check(A.token && Bf.token && A.token !== Bf.token, 'two families created');

// Same entry id in both families: no clash, no overwrite
await j('/api/events/same-id', { method: 'PUT', token: A.token, body: { type: 'feed', kind: 'bottle', ml: 100, t: now - 60000 } });
await j('/api/events/same-id', { method: 'PUT', token: Bf.token, body: { type: 'feed', kind: 'bottle', ml: 50, t: now - 60000 } });
await j('/api/growth/g1', { method: 'PUT', token: A.token, body: { t: now, kg: 4.2 } });
await j('/api/appts/ap1', { method: 'PUT', token: A.token, body: { kind: 'cb', title: 'A only', t: now + 86400000, remind: [] } });
await j('/api/profile', { method: 'PUT', token: A.token, body: { name: 'Alma', birth: '2026-10-01', sex: 'girl' } });
let sa = (await j('/api/sync', { token: A.token })).d, sb = (await j('/api/sync', { token: Bf.token })).d;
check(sa.events.length === 1 && sa.events[0].ml === 100, 'A sees only its own feed');
check(sb.events.length === 1 && sb.events[0].ml === 50, 'B sees only its own feed');
check(sb.growth.length === 0 && sb.appts.length === 0 && !sb.profile.name, 'B sees no A growth, appointments or profile');
// B deleting A's id only touches B's row
await j('/api/events/same-id', { method: 'DELETE', token: Bf.token });
sa = (await j('/api/sync', { token: A.token })).d;
check(!sa.events[0].deleted && sa.events[0].ml === 100, "B's delete doesn't touch A's entry");
await j('/api/growth/g1', { method: 'DELETE', token: Bf.token });
check((await j('/api/sync', { token: A.token })).d.growth.length === 1, "B can't delete A's growth");

// Invites
const inv = (await j('/api/invites', { method: 'POST', token: A.token })).d;
check(inv.code && inv.url.endsWith('/join#' + inv.code), 'invite link');
check((await j('/api/invites', { method: 'POST' })).s === 401, 'invite needs sign-in');
const info = await j('/api/invite-info', { method: 'POST', body: { code: inv.code } });
check(info.d.family === 'Family A' && info.d.from === 'Anna', 'invite info shows family and inviter');
check((await j('/api/join', { method: 'POST', body: { code: inv.code } })).s === 400, 'join needs a name');
const joined = await j('/api/join', { method: 'POST', body: { code: inv.code, member: 'Opa', consent: true } });
check(joined.s === 200 && joined.d.family === 'Family A', 'joined with invite');
check((await j('/api/sync', { token: joined.d.token })).d.events.length === 1, 'new member sees the log');
check((await j('/api/join', { method: 'POST', body: { code: inv.code, member: 'Someone else', consent: true } })).s === 404, 'invite works only once');
check((await j('/api/invite-info', { method: 'POST', body: { code: inv.code } })).s === 404, 'used invite shows as invalid');
check((await j('/api/join', { method: 'POST', body: { code: 'made-up-code-123456789', member: 'X', consent: true } })).s === 404, 'unknown invite');
// Two people racing for one invite: exactly one gets in
const inv2 = (await j('/api/invites', { method: 'POST', token: A.token })).d;
const race = await Promise.all([1, 2, 3].map((i) => j('/api/join', { method: 'POST', body: { code: inv2.code, member: 'R' + i } })));
check(race.filter((r) => r.s === 200).length === 1, 'only one of three simultaneous joins succeeds');

// Devices
let dev = (await j('/api/devices', { token: A.token })).d.devices;
check(dev.length === 3 && dev.filter((d) => d.me).length === 1 && dev.find((d) => d.me).member === 'Anna', 'devices list with this phone marked');
const opa = dev.find((d) => d.member === 'Opa');
check((await j('/api/devices/' + opa.id, { method: 'DELETE', token: Bf.token })).s === 404, "B can't remove A's phone");
check((await j('/api/devices/' + opa.id, { method: 'DELETE', token: A.token })).s === 200, 'A removes a phone');
check((await j('/api/sync', { token: joined.d.token })).s === 401, 'removed phone is locked out');
// Sign out on this phone
const me2 = (await j('/api/families', { method: 'POST', body: { family: 'Solo', member: 'S', consent: true } })).d;
await j('/api/devices/me', { method: 'DELETE', token: me2.token });
check((await j('/api/sync', { token: me2.token })).s === 401, 'signed-out phone is locked out');

// Recovery
const rec = await j('/api/recover', { method: 'POST', body: { code: A.recovery.toLowerCase(), member: 'Anna again', consent: true } });
check(rec.s === 200 && rec.d.family === 'Family A', 'recovery code works, any case');
check((await j('/api/sync', { token: rec.d.token })).d.events.length === 1, 'recovered phone sees the log');
check((await j('/api/recover', { method: 'POST', body: { code: 'AAAA-BBBB-CCCC-DDDD', member: 'X', consent: true } })).s === 401, 'wrong recovery code');
const nr = (await j('/api/recovery-code', { method: 'POST', token: A.token })).d.recovery;
check(nr && nr !== A.recovery, 'new recovery code');
check((await j('/api/recover', { method: 'POST', body: { code: A.recovery, member: 'X', consent: true } })).s === 401, 'old recovery code stops working');
check((await j('/api/recover', { method: 'POST', body: { code: nr, member: 'X', consent: true } })).s === 200, 'new recovery code works');

// Rate limits (each IP bucket is separate)
const rip = '10.3.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250);
let codes = [];
for (let i = 0; i < 11; i++) codes.push((await j('/api/recover', { method: 'POST', ip: rip, body: { code: 'AAAA-BBBB-CCCC-DDD' + i, member: 'X', consent: true } })).s);
check(codes.slice(0, 10).every((c) => c === 401) && codes[10] === 429, 'recovery attempts are rate limited');
const cip = '10.4.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250);
codes = [];
for (let i = 0; i < 6; i++) codes.push((await j('/api/families', { method: 'POST', ip: cip, body: { family: 'F', member: 'M', consent: true } })).s);
check(codes.slice(0, 5).every((c) => c === 200) && codes[5] === 429, 'creating families is rate limited');

// Reminders reach only the right family
const got = { A: [], B: [] };
const mk = (port, k) => http.createServer((q, s) => { const c = []; q.on('data', (x) => c.push(x)); q.on('end', () => { got[k].push(Buffer.concat(c)); s.writeHead(201); s.end(); }); }).listen(port);
const sa1 = mk(9921, 'A'), sb1 = mk(9922, 'B');
const keys = () => { const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16); return { ua, auth }; };
const ka = keys(), kb = keys();
await j('/api/subscribe', { method: 'POST', token: A.token, body: { member: 'Anna', subscription: { endpoint: 'http://127.0.0.1:9921/a', keys: { p256dh: ka.ua.getPublicKey().toString('base64url'), auth: ka.auth.toString('base64url') } } } });
await j('/api/subscribe', { method: 'POST', token: Bf.token, body: { member: 'Bram', subscription: { endpoint: 'http://127.0.0.1:9922/b', keys: { p256dh: kb.ua.getPublicKey().toString('base64url'), auth: kb.auth.toString('base64url') } } } });
check((await j('/api/devices', { token: A.token })).d.devices.find((d) => d.me).push === true, 'device shows reminders on');
await j('/api/reminders', { method: 'PUT', token: A.token, body: { feed: { auto: false, hours: 3 }, pump: { auto: false, hours: 3 }, due: { feed: Date.now() - 1000, pump: null }, tz: 'Europe/Amsterdam' } });
await j('/api/appts/bx', { method: 'PUT', token: Bf.token, body: { kind: 'doctor', title: 'B doctor', t: Date.now() + 30 * 60000, remind: [60] } });
await tick(); await tick();
const dec = (buf, k) => JSON.parse(ece.decrypt(buf, { version: 'aes128gcm', privateKey: k.ua, authSecret: k.auth.toString('base64url') }).toString());
check(got.A.length === 1 && dec(got.A[0], ka).title === 'Time for the next feed', 'A gets its feed reminder once');
check(got.B.length === 1 && dec(got.B[0], kb).title.endsWith('B doctor'), 'B gets its appointment reminder once');
// test-push to someone else's endpoint does nothing
check((await j('/api/test-push', { method: 'POST', token: A.token, body: { endpoint: 'http://127.0.0.1:9922/b' } })).d.total === 0, "A can't push to B's phone");
// Moving the appointment re-arms it; deleting it stops it
await j('/api/appts/bx', { method: 'PUT', token: Bf.token, body: { kind: 'doctor', title: 'B doctor', t: Date.now() + 40 * 60000, remind: [60] } });
await tick();
check(got.B.length === 2, 'rescheduled appointment reminds again');
await j('/api/appts/by', { method: 'PUT', token: Bf.token, body: { kind: 'doctor', title: 'Deleted', t: Date.now() + 30 * 60000, remind: [60] } });
await j('/api/appts/by', { method: 'DELETE', token: Bf.token });
await tick();
check(got.B.length === 2, 'deleted appointment sends nothing');

// Share an idea: each family sees only its own messages; the owner reads all of them with ADMIN_KEY
check((await j('/api/feedback', { method: 'POST', token: A.token, body: { kind: 'idea', text: 'x' } })).s === 400, 'feedback needs text');
check((await j('/api/feedback', { method: 'POST', token: A.token, body: { kind: 'idea', text: 'Vitamin D reminder please' } })).s === 200, 'feedback sent');
await j('/api/feedback', { method: 'POST', token: Bf.token, body: { kind: 'problem', text: 'B family problem' } });
const fa = (await j('/api/feedback', { token: A.token })).d.feedback;
check(fa.length === 1 && fa[0].text === 'Vitamin D reminder please' && fa[0].member === 'Anna', 'A sees only its own feedback');
check((await j('/api/feedback', { method: 'POST', body: { text: 'anon' } })).s === 401, 'feedback needs sign-in');
const adm = async (key) => { const r = await fetch(B + '/api/admin/feedback', { headers: { 'x-admin-key': key } }); return { s: r.status, d: r.ok ? await r.json() : null }; };
check((await adm('wrong-key-wrong')).s === 401, 'admin needs the right key');
const ADMIN = process.env.ADMIN_KEY || 'local-admin-key-123';
const ad = await adm(ADMIN);
if (ad.s === 200) check(ad.d.feedback.some((f) => f.text === 'B family problem' && f.family === 'Family B'), 'admin sees all feedback with family name');
else console.log('  (admin check skipped: ADMIN_KEY not set for this server)');
// Night time is saved with the profile
await j('/api/profile', { method: 'PUT', token: A.token, body: { name: 'Alma', birth: '2026-10-01', sex: 'girl', nightStart: '20:30', nightEnd: '06:45' } });
const pf = (await j('/api/sync', { token: A.token })).d.profile;
check(pf.nightStart === '20:30' && pf.nightEnd === '06:45', 'night window saved');
await j('/api/profile', { method: 'PUT', token: A.token, body: { name: 'Alma', nightStart: '25:00', nightEnd: 'x' } });
const pf2 = (await j('/api/sync', { token: A.token })).d.profile;
check(pf2.nightStart === '19:00' && pf2.nightEnd === '07:00', 'invalid night window falls back to 19:00-07:00');

// Delete a family
check((await j('/api/family', { method: 'DELETE', token: Bf.token, body: {} })).s === 400, 'delete needs confirmation');
check((await j('/api/family', { method: 'DELETE', token: Bf.token, body: { confirm: 'delete' } })).s === 200, 'family deleted');
check((await j('/api/sync', { token: Bf.token })).s === 401, 'deleted family is signed out');
check((await j('/api/sync', { token: A.token })).d.events.length === 1, 'other family untouched');
if (ad.s === 200) check(!(await adm(ADMIN)).d.feedback.some((f) => f.text === 'B family problem'), "deleted family's feedback is gone");
await j('/api/family', { method: 'PUT', token: A.token, body: { name: 'Family A renamed' } });
check((await j('/api/sync', { token: A.token })).d.family.name === 'Family A renamed', 'family renamed');

sa1.close(); sb1.close();
console.log(ok, 'checks passed');
