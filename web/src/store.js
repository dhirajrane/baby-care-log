// App state, server sync (offline outbox + polling) and actions shared by the components.
// State lives in one mutable object `S`; call render() after changing it and every component
// using useApp() re-renders.
import { useSyncExternalStore } from 'react';
import { DAY, HOUR, dayKey, fmtTime, lsGet, lsSet, lsDel } from './lib/util.js';
import { KL } from './lib/constants.js';

const REM_DEFAULT = { feed: { auto: false, hours: 3 }, pump: { auto: false, hours: 3 }, due: { feed: null, pump: null } };
export const mergeRem = (d) => ({ feed: { ...REM_DEFAULT.feed, ...((d && d.feed) || {}) }, pump: { ...REM_DEFAULT.pump, ...((d && d.pump) || {}) }, due: { feed: null, pump: null, ...((d && d.due) || {}) }, tz: (d && d.tz) || undefined });

const LS = 'babycarelog.app.v1', LSK = 'babycarelog.key', LSM = 'babycarelog.member', LSF = 'babycarelog.family';

export const S = {
  feverSeen: new Set((() => { try { return JSON.parse(lsGet('babycarelog.feverSeen') || '[]'); } catch (e) { return []; } })()),
  openDays: new Set(), hFilter: 'all', rem: mergeRem(null), profile: {}, events: [], growth: [], appts: [],
  showPast: false, tab: 'today', prevTab: null, metric: 'kg', historyDays: 7, loading: true, online: true, devices: null,
  rep: null, sheet: null, toast: null, wake: null, outboxSize: 0,
};
export const AUTH = { key: lsGet(LSK), member: lsGet(LSM) || '', family: lsGet(LSF) || '', status: null, error: '' };
export const PUSH = { sub: null, busy: false };

// ---------- render subscription ----------
let version = 0;
const listeners = new Set();
export function render() { version++; listeners.forEach((f) => f()); }
const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };
export function useApp() { useSyncExternalStore(subscribe, () => version); return S; }

// ---------- local storage ----------
let outbox = [], since = 0, flushing = false;
const sortAll = () => { S.events.sort((a, b) => b.t - a.t); S.growth.sort((a, b) => b.t - a.t); S.appts.sort((a, b) => a.t - b.t); };
export function lsLoad() {
  try {
    const d = JSON.parse(lsGet(LS) || 'null');
    if (d) { S.profile = d.profile || {}; S.events = d.events || []; S.growth = d.growth || []; S.appts = d.appts || []; S.rem = mergeRem(d.rem); since = d.since || 0; outbox = d.outbox || []; S.outboxSize = outbox.length; sortAll(); if (S.events.length || S.growth.length) S.loading = false; }
  } catch (e) {}
}
function lsSave() { S.outboxSize = outbox.length; lsSet(LS, JSON.stringify({ profile: S.profile, events: S.events, growth: S.growth, appts: S.appts, rem: S.rem, since, outbox })); }
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return undefined; } };

// ---------- API ----------
export async function api(path, opts = {}) {
  let r;
  try { r = await fetch('/api' + path, { method: opts.method || 'GET', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-family-key': AUTH.key || '' }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }); }
  catch (e) { throw { code: 'offline' }; }
  let data = null; try { data = await r.json(); } catch (e) {}
  if (r.status === 401 && !opts.noAuth) { signOut('The family key was changed or is wrong. Enter it again.'); throw { code: 'auth' }; }
  if (!r.ok) throw { code: 'http', status: r.status, data };
  return data;
}
function enqueue(op) { outbox = outbox.filter((o) => o.path !== op.path); outbox.push(op); lsSave(); flush(); }
async function flush() {
  if (flushing || !AUTH.key) return;
  flushing = true; let changed = false;
  try {
    while (outbox.length) {
      const op = outbox[0];
      try { const res = await api(op.path, { method: op.method, body: op.body }); if (res && res.rem) { S.rem = mergeRem(res.rem); changed = true; } S.online = true; }
      catch (e) { if (e.code === 'http' && e.status >= 400 && e.status < 500) { /* rejected for good: drop it */ } else { S.online = false; changed = true; break; } }
      outbox.shift(); lsSave(); changed = true;
    }
  } finally { flushing = false; if (changed) render(); }
}
function mergeRows(coll, rows) { const map = new Map(S[coll].map((r) => [r.id, r])); rows.forEach((r) => { if (r.deleted) map.delete(r.id); else map.set(r.id, r); }); S[coll] = [...map.values()]; }
let pulling = false;
export async function pull() {
  if (!AUTH.key || pulling) return;
  pulling = true;
  try {
    await flush();
    if (outbox.length) { S.loading = false; render(); return; }
    const d = await api('/sync?since=' + since);
    if (d.full) { S.events = []; S.growth = []; S.appts = []; }
    mergeRows('events', d.events); mergeRows('growth', d.growth); mergeRows('appts', d.appts || []);
    S.profile = d.profile || {}; S.rem = mergeRem(d.rem); since = d.now; S.loading = false; S.online = true; sortAll(); lsSave(); checkDue(); render();
  } catch (e) { if (e.code !== 'auth') { S.online = false; S.loading = false; render(); } }
  finally { pulling = false; }
}
export function resync() { since = 0; return pull(); }

export async function saveRow(coll, id, data) {
  const arr = S[coll]; const i = arr.findIndex((x) => x.id === id);
  if (coll === 'events') data = { ...data, by: (i >= 0 && arr[i].by) || AUTH.member || '' };
  const row = { ...data, id }; if (i >= 0) arr[i] = row; else arr.push(row);
  sortAll(); lsSave(); render();
  enqueue({ method: 'PUT', path: `/${coll}/${id}`, body: data });
}
export async function removeRow(coll, id) { S[coll] = S[coll].filter((x) => x.id !== id); lsSave(); render(); enqueue({ method: 'DELETE', path: `/${coll}/${id}` }); }
export async function saveProfile(p) { S.profile = p; lsSave(); render(); enqueue({ method: 'PUT', path: '/profile', body: p }); }
export async function saveRem() { S.rem.tz = tz(); lsSave(); render(); enqueue({ method: 'PUT', path: '/reminders', body: S.rem }); }
export async function guarded(fn, okMsg, undo) {
  try { await fn(); if (okMsg) toast(okMsg, undo); return true; }
  catch (e) { toast("Couldn't save on this phone. Free up some storage and try again."); return false; }
}

// ---------- navigation, sheets, toast ----------
export function go(tab) { S.tab = tab; if (tab === 'baby') loadDevices(); render(); window.scrollTo(0, 0); }
export function openHelp(id) {
  S.prevTab = S.tab === 'help' ? S.prevTab : S.tab; S.tab = 'help'; render(); window.scrollTo(0, 0);
  if (id) setTimeout(() => { const el = document.getElementById('h-' + id); if (el) el.scrollIntoView({ block: 'start' }); }, 30);
}
export function openReport() { S.prevTab = S.tab; S.rep = null; S.tab = 'report'; render(); window.scrollTo(0, 0); }
export function openSheet(kind, row) { S.sheet = { kind, row: row || null, key: Date.now() }; render(); }
export function closeSheet() { if (S.sheet) { S.sheet = null; render(); } }
let toastTimer;
export function toast(msg, undo) {
  clearTimeout(toastTimer); S.toast = { msg, undo }; render();
  toastTimer = setTimeout(() => { S.toast = null; render(); }, undo ? 6000 : 3200);
}
export function hideToast() { clearTimeout(toastTimer); S.toast = null; render(); }

// ---------- sign-in ----------
async function rememberKey(key) {
  AUTH.key = key; lsSet(LSK, key); lsSet(LSM, AUTH.member); lsSet(LSF, AUTH.family);
  try { const c = await caches.open('babylog-key'); await c.put('/__key', new Response(key)); } catch (e) {}
}
export function signOut(msg) {
  AUTH.key = null; AUTH.error = msg || ''; S.events = []; S.growth = []; S.appts = []; S.profile = {}; S.rem = mergeRem(null); since = 0; outbox = []; S.outboxSize = 0; S.loading = true;
  lsDel(LSK); lsDel(LS);
  try { caches.delete('babylog-key'); } catch (e) {}
  if (PUSH.sub) { try { PUSH.sub.unsubscribe(); } catch (e) {} PUSH.sub = null; }
  loadStatus(); render();
}
export async function loadStatus() { try { AUTH.status = await api('/status', { noAuth: true }); } catch (e) { AUTH.status = { error: true }; } render(); }
// Returns an error message, or '' when signed in.
export async function submitLogin(setup, { key, member, family }) {
  try {
    if (setup) {
      if (key.length < 6) return 'Use at least 6 characters for the family key.';
      await api('/setup', { method: 'POST', noAuth: true, body: { key, family } });
      AUTH.family = family;
    } else {
      const r = await api('/login', { method: 'POST', noAuth: true, body: { key } }); AUTH.family = r.family || '';
    }
    AUTH.member = member; AUTH.error = ''; await rememberKey(key); S.loading = true; since = 0; render(); pull(); refreshPush();
    return '';
  } catch (e) {
    return e.code === 'offline' ? 'No connection. Check this phone is online.' : e.status === 401 ? 'That family key is not right.' : e.status === 409 ? 'This log is already set up. Reload and sign in instead.' : 'Something went wrong. Try again.';
  }
}
export const signedIn = () => !!AUTH.key;

// ---------- notifications ----------
function b64uToBytes(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
export function pushSupport() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return { ios, standalone, ok: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window };
}
export async function refreshPush() {
  try {
    if (!pushSupport().ok) return;
    const reg = await navigator.serviceWorker.ready; PUSH.sub = await reg.pushManager.getSubscription();
    if (PUSH.sub && signedIn()) api('/subscribe', { method: 'POST', body: { subscription: PUSH.sub.toJSON(), member: AUTH.member } }).catch(() => {});
  } catch (e) {}
  render();
}
export async function enablePush() {
  PUSH.busy = true; render();
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications are blocked. Allow them for Baby Care Log in your phone settings.'); return; }
    const reg = await navigator.serviceWorker.ready; const { publicKey } = await api('/vapid');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
    await api('/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), member: AUTH.member } });
    PUSH.sub = sub; await api('/test-push', { method: 'POST', body: { endpoint: sub.endpoint } });
    toast('Notifications are on. A test is on its way.'); loadDevices();
  } catch (e) { toast(e.code === 'offline' ? 'No connection. Try again when online.' : "Couldn't turn on notifications. Try again."); }
  finally { PUSH.busy = false; render(); }
}
export async function disablePush() {
  try { if (PUSH.sub) { await api('/unsubscribe', { method: 'POST', body: { endpoint: PUSH.sub.endpoint } }).catch(() => {}); await PUSH.sub.unsubscribe(); } } catch (e) {}
  PUSH.sub = null; toast('Notifications are off for this phone'); loadDevices(); render();
}
export async function testPush() {
  try { const r = await api('/test-push', { method: 'POST', body: { endpoint: PUSH.sub && PUSH.sub.endpoint } }); toast(r.sent ? 'Test sent. It should arrive in a few seconds.' : "The test didn't go through. Turn notifications off and on again."); }
  catch (e) { toast('No connection. Try again when online.'); }
}
export async function loadDevices() { try { const r = await api('/devices'); S.devices = r.devices.length; render(); } catch (e) {} }

// ---------- reminders ----------
export async function afterLog(kind, t) {
  if (t < Date.now() - 6 * HOUR) return;
  const latest = S.events.find((e) => e.type === kind); if (latest && latest.t > t) return;
  const cfg = S.rem[kind];
  if (cfg.auto) { S.rem.due[kind] = t + cfg.hours * HOUR; if (await guarded(saveRem)) toast(`Next ${KL[kind]} reminder at ${fmtTime(S.rem.due[kind])}`); render(); return; }
  if (S.rem.due[kind]) { S.rem.due[kind] = null; await guarded(saveRem); }
  openSheet('rem', { kind, base: t });
}
export async function setDue(kind, at, msg) { S.rem.due[kind] = at; await guarded(saveRem, msg); render(); }
export async function snooze(kind) { const d = S.rem.due[kind] || Date.now(); S.rem.due[kind] = Math.max(d, Date.now()) + 15 * 60e3; await guarded(saveRem, `Reminder moved to ${fmtTime(S.rem.due[kind])}`); render(); }

export async function toggleWake() {
  if (S.wake) { try { await S.wake.release(); } catch (e) {} S.wake = null; render(); return; }
  try { S.wake = await navigator.wakeLock.request('screen'); S.wake.addEventListener('release', () => { S.wake = null; render(); }); render(); }
  catch (e) { toast("This screen can't be kept awake here. Turn off auto-lock in your phone settings for the night."); }
}
let actx = null;
document.addEventListener('pointerdown', () => { try { if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); } if (actx && actx.state === 'suspended') actx.resume(); } catch (e) {} }, { capture: true });
function chime() {
  try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {}
  try {
    if (!actx) return; const n = actx.currentTime;
    [0, 0.4, 0.8].forEach((o, i) => { const os = actx.createOscillator(), g = actx.createGain(); os.type = 'sine'; os.frequency.value = [660, 784, 988][i]; g.gain.setValueAtTime(0.0001, n + o); g.gain.exponentialRampToValueAtTime(0.3, n + o + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, n + o + 0.35); os.connect(g).connect(actx.destination); os.start(n + o); os.stop(n + o + 0.4); });
  } catch (e) {}
}
const fired = new Set();
export function checkDue() {
  ['feed', 'pump'].forEach((k) => { const d = S.rem.due[k]; if (d && d <= Date.now() && !fired.has(k + d)) { fired.add(k + d); if (Date.now() - d < 15 * 60e3) chime(); } });
  render(); // also refreshes "x min ago" texts
}
export function seeFever(id) { S.feverSeen.add(id); lsSet('babycarelog.feverSeen', JSON.stringify([...S.feverSeen].slice(-20))); render(); }
export const todayKey = () => dayKey(Date.now());
export { DAY };
