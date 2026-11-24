// Entry point: load the saved log, start syncing, and mount the React app.
import { createRoot } from 'react-dom/client';
import App from './components/App.jsx';
import { S, AUTH, lsLoad, pull, loadStatus, refreshPush, checkDue, signedIn, openSheet, render, toast, upgradeLegacyKey } from './store.js';

lsLoad();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(() => refreshPush()).catch(() => {});

// Deep links: /help (readable without signing in), ?tab=calendar from notifications, ?log=feed from "Log feed".
const params = new URLSearchParams(location.search);
// Invite links look like /join#CODE. The code stays in memory only.
if (location.pathname.replace(/\/+$/, '') === '/join') {
  const code = location.hash.slice(1).replace(/[^A-Za-z0-9_-]/g, '');
  history.replaceState(null, '', '/');
  if (signedIn()) setTimeout(() => toast(`This phone is already in ${AUTH.family || 'a family log'}. Sign out under Baby first to join another one.`), 300);
  else if (code) AUTH.joinCode = code;
}
if (location.pathname.replace(/\/+$/, '') === '/help' || params.get('tab') === 'help') S.tab = 'help';
if (location.pathname.replace(/\/+$/, '') === '/privacy') S.tab = 'privacy';
if (location.pathname.replace(/\/+$/, '') === '/admin') S.tab = 'admin';
const tq = params.get('tab');
if (tq && signedIn() && ['today', 'history', 'growth', 'calendar', 'baby'].includes(tq)) { history.replaceState(null, '', '/'); S.tab = tq; }
const lq = params.get('log');
if (lq && signedIn() && (lq === 'feed' || lq === 'pump')) { history.replaceState(null, '', '/'); setTimeout(() => openSheet(lq), 250); }

createRoot(document.getElementById('root')).render(<App />);
if (S.tab === 'help' && location.hash) setTimeout(() => { const el = document.querySelector(location.hash); if (el) el.scrollIntoView(); }, 50);

if (signedIn()) pull(); else if (AUTH.legacyKey) upgradeLegacyKey(); else loadStatus();
setInterval(checkDue, 20000); // reminder chime and "x min ago" texts
setInterval(() => { if (!document.hidden) pull(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkDue(); pull(); } });
window.addEventListener('online', () => pull());
render();
