// Small date, number and formatting helpers shared by every screen.
export const pad = (n) => String(n).padStart(2, '0');
export const DAY = 864e5;
export const HOUR = 36e5;
export const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dayKey = (ms) => toLocalInput(ms).slice(0, 10);
export const keyToMs = (k) => { const [Y, M, D] = k.split('-').map(Number); return new Date(Y, M - 1, D).getTime(); };
export const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const fmtDay = (k) => {
  if (k === dayKey(Date.now())) return 'Today';
  if (k === dayKey(Date.now() - DAY)) return 'Yesterday';
  return new Date(keyToMs(k)).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
};
export const fmtDate = (ms) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
export const ago = (ms) => {
  const m = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 48) return h + 'h ' + pad(m % 60) + 'm ago';
  return Math.floor(h / 24) + ' days ago';
};
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const numOrNull = (v) => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
export const fmtDur = (ms) => { const m = Math.round(Math.abs(ms) / 60000); if (m < 60) return m + ' min'; return Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm'; };
export const fmtIn = (due) => { const d = due - Date.now(); return d > 0 ? 'in ' + fmtDur(d) : fmtDur(d) + ' overdue'; };
export const grams = (kg) => Math.round(kg * 1000).toLocaleString();
export const fmtTemp = (v) => (+v).toFixed(1) + ' °C';
export const startOfToday = () => keyToMs(dayKey(Date.now()));
export const median = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
export const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export function niceStep(r) { const raw = r / 4; const p = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
export const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
export const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) {} };
export function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
