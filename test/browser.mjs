// Browser checks in a phone-sized window (390×844): logging, editing, reminders, appointments, growth, history,
// the visit report, offline saving, and the family screens (create, recovery code, invite, join, remove, recover,
// sign out, rename, delete). Run while `npm run dev` is up; it creates its own families.
//   node test/browser.mjs            (screenshots go to /tmp/bcl-shots)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }
const { chromium } = pw;
const B = 'http://localhost:8787';
const shots = process.env.SHOTS || '/tmp/bcl-shots'; mkdirSync(shots, { recursive: true });
let ok = 0, fail = 0; const check = (c, m) => { if (c) ok++; else { fail++; console.error('FAIL', m); } };
const ip = () => '10.9.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250);
const b = await chromium.launch(); const errs = [];
const newPhone = async (scheme = 'light') => { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, permissions: ['clipboard-read', 'clipboard-write'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error' && !/401|404|429|Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push(m.text()); }); return { ctx, p }; };
const shot = (p, n) => p.screenshot({ path: `${shots}/${n}.png`, fullPage: true });

// ---------- part 1: logging, with a seeded family ----------
const api = async (path, token, method = 'GET', body) => (await fetch(B + '/api' + path, { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip(), ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const fam = await api('/families', null, 'POST', { family: 'Log test', member: 'Seeder' });
const T = fam.token, now = Date.now(), H = 36e5, D = 864e5;
await api('/profile', T, 'PUT', { name: 'Mira', birth: new Date(now - 60 * D).toISOString().slice(0, 10), sex: 'girl', mlPerKg: 150 });
for (let i = 0; i < 12; i++) await api('/events/s' + i, T, 'PUT', { type: 'feed', kind: 'bottle', ml: 100, t: now - (i + 1) * 3 * H, by: 'Seeder' });
await api('/events/p0', T, 'PUT', { type: 'pump', side: 'both', ml: 100, t: now - 2 * D, by: 'Seeder' });
await api('/growth/g0', T, 'PUT', { t: now - 3 * D, kg: 4.6 });
await api('/appts/a0', T, 'PUT', { kind: 'cb', title: '8-week check-up', t: now - 5 * D, remind: [] });
await api('/reminders', T, 'PUT', { feed: { auto: true, hours: 3 }, pump: { auto: false, hours: 3 }, due: { feed: null, pump: null }, tz: 'Europe/Amsterdam' });
const ctx = (await newPhone()); const p = ctx.p;
await p.goto(B + '/help'); await p.evaluate((t) => { localStorage.setItem('babycarelog.token', t); localStorage.setItem('babycarelog.member', 'Tester'); }, T);
await p.goto(B + '/'); await p.waitForTimeout(1200);
const hdrs = { authorization: 'Bearer ' + T };
const sync = async () => (await (await fetch(B + '/api/sync', { headers: hdrs })).json());
await shot(p, 'today');
const before=(await sync()).events.filter(e=>!e.deleted).length;
// Log a bottle feed through the sheet
await p.locator('nav .lb.feed').click();
await p.locator('.sheet label:has-text("Expressed milk")').click();
check(await p.locator('.sheet input[name=ml]').isVisible(),'ml field shows for bottle');
check(!(await p.locator('.sheet .field:has-text("Side")').isVisible()),'side hidden for bottle');
await p.fill('.sheet input[name=ml]','125');await p.fill('.sheet textarea[name=note]','UI test feed');
await p.locator('.sheet button[type=submit]').click();await p.waitForTimeout(800);
check(await p.locator('.toast').count()>0 || await p.locator('.sheet').count()>0,'toast or reminder sheet after feed');
// auto reminder is on in seed -> toast "Next feed reminder at"
const toastTxt=await p.locator('.toast').textContent().catch(()=>'');
check(/reminder/i.test(toastTxt||''),'auto reminder toast: '+toastTxt);
await p.waitForTimeout(1500);
let s=await sync();check(s.events.some(e=>e.note==='UI test feed'&&e.ml===125&&e.by==='Tester'),'feed saved on server');
// Quick log + undo
await p.locator('.quick button:has-text("Wet now")').click();await p.waitForTimeout(300);
await p.locator('.toast button:has-text("Undo")').click();await p.waitForTimeout(1500);
s=await sync();check(s.events.filter(e=>!e.deleted).length===before+1,'quick log undone');
// Edit the feed: open from Today list, change amount, save
await p.locator('.item:has-text("125 ml")').first().click();
await p.fill('.sheet input[name=ml]','130');await p.locator('.sheet button[type=submit]').click();await p.waitForTimeout(1500);
s=await sync();check(s.events.some(e=>e.note==='UI test feed'&&e.ml===130),'feed edited');
// Delete it (two taps)
await p.locator('.item:has-text("130 ml")').first().click();
await p.locator('.sheet button:has-text("Delete")').click();await p.locator('.sheet button:has-text("Tap again")').click();await p.waitForTimeout(1500);
s=await sync();check(!s.events.some(e=>e.note==='UI test feed'),'feed deleted');
// Diaper with fever temperature shows banner
await p.locator('nav .lb.diaper').click();await p.fill('.sheet input[name=temp]','38.4');await p.locator('.sheet button[type=submit]').click();await p.waitForTimeout(800);
check(await p.locator('.alert.hot').count()===1,'fever banner shown');
check(/straight away/.test(await p.locator('.alert.hot').textContent()),'under-3-months wording');
await p.locator('.alert.hot button:has-text("OK")').click();check(await p.locator('.alert.hot').count()===0,'fever banner dismissed');
// Temperature validation
await p.locator('nav .lb.diaper').click();await p.fill('.sheet input[name=temp]','100.4');await p.locator('.sheet button[type=submit]').click();await p.waitForTimeout(300);
check(/between 30 and 45/.test(await p.locator('.toast').textContent()),'fahrenheit rejected');await p.keyboard.press('Escape');
check(await p.locator('.sheet').count()===0,'escape closes sheet');
// Pump without auto -> reminder sheet opens
await p.locator('nav .lb.pump').click();await p.fill('.sheet input[name=ml]','80');await p.locator('.sheet button[type=submit]').click();await p.waitForTimeout(600);
check(await p.locator('.sheet h2:has-text("Remind me about the next pumping session")').count()===1,'reminder sheet after pumping');
await p.locator('.sheet label:has-text("At a time")').click();
check(await p.locator('.sheet input[type=time]').isVisible(),'time field shows');
await p.locator('.sheet label:has-text("2½ h")').click();
check(/Reminder at/.test(await p.locator('.sheet .footnote').textContent()),'preview updates');
await p.locator('.sheet button[type=submit]').click();await p.waitForTimeout(1500);
s=await sync();check(s.rem.due.pump>Date.now(),'pump reminder saved');
// Note
await p.locator('nav .lb.note').click();await p.locator('.sheet .checks label:has-text("Calm")').click();const nt='UI note '+Date.now();await p.fill('.sheet textarea',nt);await p.locator('.sheet button[type=submit]').click();await p.waitForTimeout(1200);
check(await p.locator('.nitem:has-text("'+nt+'")').count()===1,'note on Today');
// Growth
await p.locator('nav .in button:has-text("Growth")').click();await p.locator('button:has-text("Add measurement")').click();
await p.fill('.sheet input[name=kg]','4.95');await p.locator('.sheet button[type=submit]').click();await p.waitForTimeout(800);
check(await p.locator('.mrow:has-text("4,950 g")').count()===1,'growth added in grams');
await p.locator('.mrow:has-text("4,950 g") button:has-text("Delete")').click();await p.locator('.mrow:has-text("4,950 g") button:has-text("Tap again")').click();await p.waitForTimeout(600);
check(await p.locator('.mrow:has-text("4,950 g")').count()===0,'growth deleted');
await p.locator('.seg-tabs button:has-text("Length")').click();check(/Length \(cm\)/.test(await p.locator('main h2').first().textContent()),'metric switch');
// Calendar
await p.locator('nav .in button:has-text("Calendar")').click();await p.locator('button:has-text("Add appointment")').click();
await p.locator('.sheet label:has-text("Doctor")').click();
check(await p.inputValue('.sheet input[name=title]')==='Doctor appointment','title follows type');
const d=new Date(Date.now()+5*864e5);const ds=d.toISOString().slice(0,10);
await p.fill('.sheet input[name=date]',ds);await p.fill('.sheet input[name=place]','Huisarts');await p.locator('.sheet button[type=submit]').click();await p.waitForTimeout(1200);
check(await p.locator('.appt:has-text("Doctor appointment")').count()===1,'appointment added');
await p.locator('.appt:has-text("Doctor appointment")').click();
check(await p.locator('.sheet button:has-text("Add to phone calendar")').count()===1,'ics button');
await p.locator('.sheet button:has-text("Delete")').click();await p.locator('.sheet button:has-text("Tap again")').click();await p.waitForTimeout(800);
check(await p.locator('.appt:has-text("Doctor appointment")').count()===0,'appointment deleted');
await p.locator('button:has-text("Show past appointments")').click();check(await p.locator('.appt:has-text("8-week")').count()===1,'past appointments');
// History
await p.locator('nav .in button:has-text("History")').click();
await p.locator('.filters button:has-text("Pumping")').click();check(await p.locator('.ov .k-pump').count()>0,'pump filter');
await p.locator('.filters button:has-text("All")').click();
await p.locator('.daymore').first().click();check(await p.locator('.day.open .item').count()>0,'day expands');
// Report
await p.locator('button:has-text("Visit report for the doctor")').click();
await p.locator('.rep-ctl button:has-text("Last 7 days")').click();check(/7 days/.test(await p.locator('.rep-per span').textContent()),'report 7 days');
await p.fill('#view textarea','Is this OK?');check(await p.locator('.rq-print:has-text("Is this OK?")').count()===1,'questions in report');
await p.locator('button:has-text("← Back")').click();
// Baby: profile save
await p.locator('nav .in button:has-text("Baby")').click();
await p.fill('input[name=name]','Mira Test');await p.locator('button:has-text("Save details")').click();await p.waitForTimeout(1500);
s=await sync();check(s.profile.name==='Mira Test','profile saved');
await p.fill('input[name=name]','Mira');await p.locator('button:has-text("Save details")').click();await p.waitForTimeout(1200);
check(await p.locator('header h1').textContent()==='Mira','header name');
// Help from Baby and back
await p.locator('button:has-text("Read how it works")').click();check(await p.locator('#h-feed').count()===1,'help page');
await p.locator('button:has-text("← Back")').click();check(await p.locator('button:has-text("Save details")').count()===1,'back to baby');
// Offline outbox
await ctx.ctx.setOffline(true);await p.locator('nav .in button:has-text("Today")').click();
await p.locator('.quick button:has-text("Dirty now")').click();await p.waitForTimeout(500);
await p.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await p.waitForTimeout(800);
check(/Offline/.test(await p.locator('#notice').textContent()),'offline notice');
await ctx.ctx.setOffline(false);await p.evaluate(()=>window.dispatchEvent(new Event('online')));await p.waitForTimeout(2000);
s=await sync();check(s.events.filter(e=>e.kind==='dirty'&&Date.now()-e.t<60000).length===1,'offline entry synced');

await ctx.ctx.close();

// ---------- part 2: family screens ----------
// 2. New family from scratch
const {ctx:c1,p:p1}=await newPhone();
await p1.route('**/api/**',r=>r.continue({headers:{...r.request().headers(),'cf-connecting-ip':ip()}}));
await p1.goto(B+'/');await p1.waitForTimeout(800);await shot(p1,'start');
await p1.locator('button:has-text("Create a family log")').click();await shot(p1,'create');
await p1.fill('input[name=family]','The Jansen family');await p1.fill('input[name=member]','Eva');
await p1.locator('button:has-text("Create family log")').click();await p1.waitForTimeout(1200);
check(await p1.locator('.rcode').count()===1,'recovery code shown after creating');
const code=(await p1.locator('.rcode').textContent()).trim();check(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(code),'code format '+code);
check(await p1.locator('nav.tabs').isHidden(),'tabs hidden until code saved');
check(await p1.locator('button:has-text("Start using the log")').isDisabled(),'continue disabled until confirmed');
await shot(p1,'recovery');
await p1.locator('label:has-text("I\'ve saved the recovery code")').click();await p1.locator('button:has-text("Start using the log")').click();await p1.waitForTimeout(800);
check(await p1.locator('nav.tabs').isVisible(),'in the app');
check(/Start with her name/.test(await p1.locator('main').textContent()),'empty-family prompt');
// log a feed so the joiner has something to see
await p1.locator('.quick button:has-text("Wet now")').click();await p1.waitForTimeout(1200);
// invite
await p1.locator('nav .in button:has-text("Baby")').click();await p1.waitForTimeout(800);
await p1.locator('button:has-text("Invite a family member")').click();await p1.waitForTimeout(800);
const link=(await p1.locator('.invite-link').textContent()).trim();check(/\/join#[A-Za-z0-9_-]{20,}$/.test(link),'invite link shown');
await p1.locator('section:has(.eyebrow:text-is("Family"))').screenshot({path:`${shots}/family-card.png`});

// 3. Second phone joins with the link (dark mode)
const {ctx:c2,p:p2}=await newPhone('dark');
await p2.goto(link);await p2.waitForTimeout(1200);
check(/Join The Jansen family/.test(await p2.locator('main h2').textContent()),'join screen names the family');
check(/Eva invited you/.test(await p2.locator('main').textContent()),'join screen names the inviter');
check(!(await p2.evaluate(()=>location.href)).includes('#'),'code removed from the address bar');
await shot(p2,'join-dark');
await p2.fill('input[name=member]','Daan');await p2.locator('button:has-text("Join family log")').click();await p2.waitForTimeout(1500);
check(await p2.locator('.item:has-text("Wet")').count()===1,'joiner sees the family entries');
await p2.locator('nav .in button:has-text("Baby")').click();await p2.waitForTimeout(800);
check(await p2.locator('.dev').count()===2,'two phones listed');
await shot(p2,'baby-dark');
// same link again in a third phone: used
const {ctx:c3,p:p3}=await newPhone();await p3.goto(link);await p3.waitForTimeout(1200);
check(/no longer works/.test(await p3.locator('main').textContent()),'used invite explained');await shot(p3,'invite-used');
// paste flow from the start screen
await p3.locator('button:has-text("Back")').click();await p3.locator('button:has-text("Join with an invite link")').click();
await p3.fill('input[name=link]','nonsense');await p3.locator('button:has-text("Continue")').click();
check(/whole invite link/.test(await p3.locator('.login-err').textContent()),'paste validation');
await c3.close();
// 4. Eva removes Daan's phone -> Daan is signed out on next sync
await p1.reload();await p1.waitForTimeout(1000);await p1.locator('nav .in button:has-text("Baby")').click();await p1.waitForTimeout(800);
await p1.locator('.dev:has-text("Daan") button:has-text("Remove")').click();await p1.locator('.dev:has-text("Daan") button:has-text("Tap again")').click();await p1.waitForTimeout(800);
check(await p1.locator('.dev').count()===1,'phone removed from list');
await p2.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p2.waitForTimeout(1500);
check(/was signed out/.test(await p2.locator('main').textContent()),'removed phone sees why it was signed out');
await shot(p2,'removed-dark');
// 5. Recovery on Daan's phone
await p2.locator('button:has-text("Use your recovery code")').click();
await p2.fill('input[name=code]',code.toLowerCase().replace(/-/g,' '));await p2.fill('input[name=member]','Daan');
await p2.locator('main button:has-text("Sign in")').click();await p2.waitForTimeout(1500);
check(await p2.locator('.item:has-text("Wet")').count()===1,'recovered with the code');
// 6. Sign out on this phone
await p2.locator('nav .in button:has-text("Baby")').click();await p2.waitForTimeout(500);
await p2.locator('button:has-text("Sign out on this phone")').click();await p2.locator('button:has-text("Tap again to sign out")').click();await p2.waitForTimeout(1200);
check(await p2.locator('button:has-text("Create a family log")').count()===1,'signed out to start screen');
await c2.close();
// 7. Rename and delete family
await p1.locator('.linkbtn:has-text("Rename")').click();await p1.fill('input[name=familyName]','Jansens');await p1.locator('section:has(.eyebrow:text-is("Family")) button[type=submit]').click();await p1.waitForTimeout(800);
check(/Jansens/.test(await p1.locator('section:has(.eyebrow:text-is("Family"))').textContent()),'family renamed');
await p1.locator('button:has-text("Delete family log")').click();
check(await p1.locator('.sheet button:has-text("Delete everything")').isDisabled(),'delete needs typing');
await p1.fill('.sheet input','delete');await shot(p1,'delete');
await p1.locator('.sheet button:has-text("Delete everything")').click();await p1.waitForTimeout(1500);
check(/was deleted/.test(await p1.locator('main').textContent()),'deleted and signed out');
await c1.close(); await b.close();
console.log(ok, 'passed', fail, 'failed', 'errors:', JSON.stringify(errs));
process.exit(fail || errs.length ? 1 : 0);
