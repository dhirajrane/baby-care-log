// Calculations on the log: totals, the next-feed suggestion, vaccinations and the visit report.
// Every function takes the app state `s` ({profile, events, growth, appts}) so it stays pure.
import { DAY, HOUR, dayKey, keyToMs, median, clampN, startOfToday, fmtTemp } from './util.js';
import { FEED, SIDE, DIAPER, TSITE, NOTE_TAGS, WHO, REP_KINDS, AK_TITLE } from './constants.js';

// Pronouns for the baby, from the profile (girl until set otherwise, like the profile form).
export const pron = (s) => s.profile.sex === 'boy' ? { she: 'he', her: 'his', herO: 'him', She: 'He', Her: 'His' } : { she: 'she', her: 'her', herO: 'her', She: 'She', Her: 'Her' };

export const feeds = (s) => s.events.filter((e) => e.type === 'feed');
export const diapers = (s) => s.events.filter((e) => e.type === 'diaper');
export const temps = (s) => s.events.filter((e) => e.temp != null);

export function nextSide(s) {
  const last = feeds(s).find((f) => f.kind === 'breast' && (f.side === 'L' || f.side === 'R'));
  return last ? (last.side === 'L' ? 'R' : 'L') : 'L';
}

export function ageText(s, at) {
  at = at || Date.now();
  if (!s.profile.birth) return '';
  const b = keyToMs(s.profile.birth);
  const days = Math.floor((keyToMs(dayKey(at)) - b) / DAY);
  if (days < 0) return '';
  if (days < 14) return days === 1 ? '1 day old' : days + ' days old';
  if (days < 70) { const w = Math.floor(days / 7), d = days % 7; return w + ' weeks' + (d ? ' ' + d + (d === 1 ? ' day' : ' days') : ''); }
  const bd = new Date(b), n = new Date(at);
  let m = (n.getFullYear() - bd.getFullYear()) * 12 + n.getMonth() - bd.getMonth();
  if (n.getDate() < bd.getDate()) m--;
  const anchor = new Date(bd.getFullYear(), bd.getMonth() + m, bd.getDate());
  const w = Math.floor((n - anchor) / DAY / 7);
  return m + (m === 1 ? ' month' : ' months') + (w ? ' ' + w + (w === 1 ? ' week' : ' weeks') : '');
}
export function ageMonths(s) {
  if (!s.profile.birth) return null;
  const d = (Date.now() - keyToMs(s.profile.birth)) / (30.4375 * DAY);
  return d >= 0 ? d : null;
}

export function tempFlag(v) {
  if (v == null) return null;
  if (v >= 38) return { cls: 'hot', txt: 'Fever range: 38 °C or higher' };
  if (v < 35.8) return { cls: 'low', txt: 'Below the normal range (35.8–37.5 °C)' };
  return null;
}

export function evTitle(e) {
  if (e.type === 'note') return (e.tags || []).map((t) => NOTE_TAGS[t] || t).join(' · ') || 'Note';
  if (e.type === 'sleep') return sleepTitle(e);
  if (e.type === 'feed') { const p = [FEED[e.kind] || 'Feed']; if (e.kind === 'breast' && e.side) p.push(SIDE[e.side]); if (e.min) p.push(e.min + ' min'); if (e.ml) p.push(e.ml + ' ml'); return p.join(' · '); }
  if (e.type === 'pump') { const p = ['Pumping']; if (e.side) p.push(SIDE[e.side]); if (e.min) p.push(e.min + ' min'); if (e.ml) p.push(e.ml + ' ml'); return p.join(' · '); }
  const p = [DIAPER[e.kind] || 'Diaper'];
  if ((e.kind === 'dirty' || e.kind === 'both') && e.color) p.push(e.color);
  if (e.temp != null) p.push(fmtTemp(e.temp) + (e.tempSite && e.tempSite !== 'rectal' ? ' (' + TSITE[e.tempSite].toLowerCase() + ')' : ''));
  return p.join(' · ');
}
export const evDot = (e) => e.type === 'sleep' ? 'c-sleep' : e.type === 'note' ? 'c-note' : e.type === 'pump' ? 'c-pump' : e.type === 'feed' ? 'c-feed' : e.kind === 'wet' ? 'c-wet' : e.kind === 'dirty' ? 'c-dirty' : 'c-both';

export function dayTotals(list) {
  const f = list.filter((e) => e.type === 'feed');
  const ml = f.reduce((a, e) => a + (+e.ml || 0), 0);
  const wet = list.filter((e) => e.type === 'diaper' && (e.kind === 'wet' || e.kind === 'both')).length;
  const dirty = list.filter((e) => e.type === 'diaper' && (e.kind === 'dirty' || e.kind === 'both')).length;
  const pumps = list.filter((e) => e.type === 'pump');
  const pumped = pumps.reduce((a, e) => a + (+e.ml || 0), 0);
  return { feeds: f.length, ml, wet, dirty, pumps: pumps.length, pumped };
}
export function intake(list) {
  const f = list.filter((e) => e.type === 'feed');
  const exp = f.filter((e) => e.kind === 'bottle').reduce((a, e) => a + (+e.ml || 0), 0);
  const form = f.filter((e) => e.kind === 'formula').reduce((a, e) => a + (+e.ml || 0), 0);
  return { ml: exp + form, exp, form, bottles: f.filter((e) => (e.kind === 'bottle' || e.kind === 'formula') && e.ml).length, breast: f.filter((e) => e.kind === 'breast').length };
}
export function feedGap(list) {
  const ts = list.filter((e) => e.type === 'feed').map((e) => e.t).sort((a, b) => a - b);
  if (ts.length < 2) return null;
  return (ts[ts.length - 1] - ts[0]) / (ts.length - 1);
}

// ---------- next feed suggestion ----------
// Based only on the baby's own logged feeds. No weight-based target: it's a suggestion, not an amount to reach.
export function latestWeight(s) { const g = s.growth.find((x) => x.kg != null); return g ? { kg: +g.kg, t: g.t } : null; }

// Feeds that start within 30 min of the previous one (bottle + top-up) count as one feed.
export function feedSessions(list) {
  const out = [];
  for (const e of [...list].sort((a, b) => a.t - b.t)) {
    const ml = (e.kind === 'bottle' || e.kind === 'formula') && e.ml ? +e.ml : 0;
    const unm = !ml;
    const cur = out[out.length - 1];
    if (cur && e.t - cur.end <= 30 * 60e3 && e.t - cur.t <= 45 * 60e3) { cur.ml += ml; cur.unm = cur.unm || unm; cur.end = e.t; cur.n++; }
    else out.push({ t: e.t, end: e.t, ml, unm, n: 1 });
  }
  return out;
}

export const MIN_GAPS = 4; // gaps between feeds needed in the last 2 days (about 5 feeds)
export const MIN_BOTTLES = 3; // measured bottles needed in the last 3 days for "her usual bottle"
export const MIN_PAIRS = 5; // measured bottles followed by another feed, to adjust the time to the bottle size
export const GUIDE_SRC = { nl: 'Dutch guidance from the Voedingscentrum', doctor: "your doctor's or consultatiebureau's advice" };

// Typical feeds per 24 hours by age: about 10 as a newborn, falling to about 6 at 6 months (Voedingscentrum/GGD).
export function ageFeedsPerDay(s) { const am = ageMonths(s); return am == null ? 8 : clampN(10 - am / 6 * 4, 6, 10); }
// A number set before the choice existed (anything other than 150) counts as the doctor's advice.
export const guideFromDoctor = (p) => (p.guideSrc === 'doctor' || (!p.guideSrc && +p.mlPerKg && +p.mlPerKg !== 150)) && +p.mlPerKg >= 100;
// Daily milk guide: latest weight × ml per kg (Dutch guidance 150, or the number the family's doctor gave).
export function dailyGuide(s) {
  const w = latestWeight(s); if (!w) return null;
  const doctor = guideFromDoctor(s.profile);
  const perKg = doctor ? +s.profile.mlPerKg : 150;
  return { ml: Math.round(w.kg * perKg / 10) * 10, perKg, src: doctor ? 'doctor' : 'nl', weight: w };
}

// Suggests around when the next feed may be. With enough of her own feeds it follows her rhythm ('pattern');
// before that it uses the usual interval for her age ('age'), for new parents. Never a target to reach.
export function nextFeedPlan(s) {
  const fs = feeds(s).filter((e) => e.kind !== 'solids');
  if (!fs.length) return null;
  const now = Date.now(); const H = HOUR;
  const ses = feedSessions(fs.filter((e) => e.t > now - 4 * DAY));
  const last = ses.length ? ses[ses.length - 1] : feedSessions([fs[0]])[0];
  const gaps = [];
  for (let i = 1; i < ses.length; i++) { if (ses[i].t < now - 2 * DAY) continue; const g = ses[i].t - ses[i - 1].t; if (g >= 45 * 60e3 && g <= 8 * H) gaps.push(g); }
  const bottles = ses.filter((x) => x.t > now - 3 * DAY && x.ml > 0 && !x.unm).map((x) => x.ml);
  const ageFeeds = ageFeedsPerDay(s); const ageGap = 24 * H / ageFeeds;
  const plan = { last, gapCount: gaps.length, bottleCount: bottles.length, ageFeeds, ageGap, hasBirth: !!s.profile.birth };
  if (gaps.length >= MIN_GAPS) {
    const usualGap = median(gaps);
    // How long a bottle lasts her: ml per hour until the next feed, from her own measured bottles.
    const pairs = [];
    for (let i = 0; i < ses.length - 1; i++) { const x = ses[i]; if (x.ml > 0 && !x.unm) { const g = (ses[i + 1].t - x.t) / H; if (g >= 0.75 && g <= 8) pairs.push(x.ml / g); } }
    const rate = pairs.length >= MIN_PAIRS ? median(pairs) : null;
    let gap = usualGap, gapSrc = 'usual';
    if (rate && last.ml > 0 && !last.unm) { gap = clampN(last.ml / rate * H, Math.max(1.5 * H, usualGap * 0.6), usualGap * 1.5); gapSrc = 'amount'; }
    Object.assign(plan, { mode: 'pattern', next: last.t + gap, gap, gapSrc, usualGap, rate, pairs: pairs.length, feedsPerDay: 24 * H / usualGap });
  } else {
    Object.assign(plan, { mode: 'age', next: last.t + ageGap, gap: ageGap, gapSrc: 'age', feedsPerDay: ageFeeds });
  }
  if (bottles.length >= MIN_BOTTLES) Object.assign(plan, { ml: Math.max(10, Math.round(median(bottles) / 10) * 10), mlMin: Math.min(...bottles), mlMax: Math.max(...bottles) });
  const guide = dailyGuide(s);
  if (guide) {
    const today = dayKey(now);
    const soFar = s.events.filter((e) => e.type === 'feed' && (e.kind === 'bottle' || e.kind === 'formula') && e.ml && dayKey(e.t) === today).reduce((a, e) => a + (+e.ml || 0), 0);
    Object.assign(plan, { guide, guidePerFeed: Math.max(10, Math.round(guide.ml / plan.feedsPerDay / 10) * 10), soFar });
  }
  return plan;
}

// ---------- appointments ----------
export const remindLabel = (m) => m >= 10080 ? '1 week' : m >= 1440 ? (m / 1440) + ' day' + (m > 1440 ? 's' : '') : m >= 60 ? (m / 60) + ' h' : m > 0 ? m + ' min' : 'at the time';
export function apptWhen(t) {
  const d = Math.round((keyToMs(dayKey(t)) - startOfToday()) / DAY);
  if (d < 0) return { txt: 'Past', soon: false };
  if (d === 0) return { txt: t < Date.now() ? 'Earlier today' : 'Today', soon: true };
  if (d === 1) return { txt: 'Tomorrow', soon: true };
  if (d < 7) return { txt: 'In ' + d + ' days', soon: false };
  if (d < 14) return { txt: 'Next week', soon: false };
  if (d < 60) return { txt: 'In ' + Math.round(d / 7) + ' weeks', soon: false };
  if (d < 700) return { txt: 'In ' + Math.round(d / 30.4) + ' months', soon: false };
  return { txt: 'In ' + Math.round(d / 365) + ' years', soon: false };
}
export function vaxPlan(s) {
  if (!s.profile.birth) return [];
  const b = new Date(keyToMs(s.profile.birth));
  const at = (months, weeks = 0) => { const d = new Date(b); d.setMonth(d.getMonth() + months); d.setDate(d.getDate() + weeks * 7); d.setHours(9, 0, 0, 0); return d.getTime(); };
  const items = [
    { t: at(0, 6), end: at(0, 9), title: 'Vaccination: rotavirus', note: 'Age 6–9 weeks. Also DKTP-Hib-HepB if the mother was not vaccinated against whooping cough during pregnancy.' },
    { t: at(3), title: 'Vaccination: rotavirus, DKTP-Hib-HepB, pneumococcal', note: 'Age 3 months.' },
    { t: at(5), title: 'Vaccination: DKTP-Hib-HepB, pneumococcal', note: 'Age 5 months.' },
    { t: at(12), title: 'Vaccination: DKTP-Hib-HepB, pneumococcal', note: 'Age 12 months.' },
    { t: at(14), title: 'Vaccination: BMR (MMR), MenACWY', note: 'Age 14 months.' },
    { t: at(36), title: 'Vaccination: BMR (MMR)', note: 'Age 3 years.' },
  ];
  const today = startOfToday();
  return items.filter((i) => (i.end || i.t) >= today).map((i) => ({ ...i, t: Math.max(i.t, today + DAY + 9 * HOUR) }));
}
export function icsFor(a) {
  const z = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const e = (x) => String(x || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Baby Care Log//EN', 'BEGIN:VEVENT', 'UID:' + a.id + '@babycarelog', 'DTSTAMP:' + z(Date.now()), 'DTSTART:' + z(a.t), 'DTEND:' + z(a.t + HOUR), 'SUMMARY:' + e(a.title || AK_TITLE[a.kind] || 'Appointment')];
  if (a.place) L.push('LOCATION:' + e(a.place));
  if (a.note) L.push('DESCRIPTION:' + e(a.note));
  (a.remind || []).forEach((m) => L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + e(a.title || 'Appointment'), 'TRIGGER:-PT' + m + 'M', 'END:VALARM'));
  L.push('END:VEVENT', 'END:VCALENDAR');
  return L.join('\r\n');
}

// ---------- visit report ----------
export function lastVisit(s) { const now = Date.now(); return s.appts.filter((a) => !a.planned && a.t < now && REP_KINDS.includes(a.kind)).sort((a, b) => b.t - a.t)[0] || null; }
export function repRange(s, preset) {
  const to = dayKey(Date.now()); const back = (n) => dayKey(Date.now() - (n - 1) * DAY);
  if (preset === 'visit') { const lv = lastVisit(s); if (lv) return { from: dayKey(lv.t), to, preset }; }
  const n = { 7: 7, 14: 14, 30: 30 }[preset] || 14;
  return { from: back(n), to, preset: String(n) };
}
export function whoBand(s, kg, ms) {
  const ref = WHO[s.profile.sex || 'girl'];
  if (!s.profile.birth || !ref) return null;
  const m = (ms - keyToMs(s.profile.birth)) / (30.4375 * DAY);
  if (m < 0 || m > 12) return null;
  const at = (arr) => { const i = Math.min(11, Math.floor(m)), f = m - i; return arr[i] + (arr[i + 1] - arr[i]) * f; };
  const p3 = at(ref.p3), p50 = at(ref.p50), p97 = at(ref.p97);
  return kg < p3 ? 'below the 3rd percentile' : kg < p50 ? 'between the 3rd and 50th percentile' : kg <= p97 ? 'between the 50th and 97th percentile' : 'above the 97th percentile';
}
export function buildReport(s, from, to) {
  const A = keyToMs(from), B = keyToMs(to) + DAY, todayK = dayKey(Date.now());
  const inR = (e) => e.t >= A && e.t < B; const ev = s.events.filter(inR);
  const ses = feedSessions(s.events.filter((e) => e.type === 'feed' && e.kind !== 'solids' && e.t >= A - DAY && e.t < B));
  const days = [];
  for (const d = new Date(A); d.getTime() < B && days.length < 93; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d.getTime()); const L = ev.filter((e) => dayKey(e.t) === k);
    const t = dayTotals(L), r = intake(L); const ds = ses.filter((x) => dayKey(x.t) === k);
    let longest = 0; ses.forEach((x, i) => { if (i && dayKey(x.t) === k) longest = Math.max(longest, x.t - ses[i - 1].t); });
    const tv = L.filter((e) => e.temp != null).map((e) => +e.temp);
    days.push({ k, complete: k < todayK, feeds: ds.length, ml: r.ml, exp: r.exp, form: r.form, bottles: r.bottles, breast: r.breast, wet: t.wet, dirty: t.dirty, pumps: t.pumps, pumped: t.pumped, maxTemp: tv.length ? Math.max(...tv) : null, longest, any: L.length > 0, sleep: sleepStats(s, keyToMs(k), keyToMs(k) + DAY) });
  }
  const avg = (arr, f) => { const v = arr.map(f); return v.length ? { avg: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v), n: v.length } : null; };
  const full = days.filter((d) => d.complete);
  const feedDays = full.filter((d) => d.feeds > 0), diaperDays = full.filter((d) => d.wet + d.dirty > 0), bottleDays = full.filter((d) => d.ml > 0), pumpDays = full.filter((d) => d.pumps > 0);
  const bottlesAll = ses.filter((x) => x.t >= A && x.t < B && x.ml > 0 && !x.unm).map((x) => x.ml);
  const g = s.growth.filter((m) => m.kg != null || m.cm != null || m.head != null).sort((a, b) => a.t - b.t);
  const gIn = g.filter(inR); const before = [...g].filter((m) => m.t < A && m.kg != null).pop() || null;
  const withKg = [...(before ? [before] : []), ...gIn.filter((m) => m.kg != null)];
  let gain = null;
  if (withKg.length >= 2) { const f = withKg[0], l = withKg[withKg.length - 1]; const dd = (l.t - f.t) / DAY; if (dd >= 3) gain = { g: Math.round((l.kg - f.kg) * 1000), perWeek: Math.round((l.kg - f.kg) * 1000 / dd * 7), from: f, to: l }; }
  const colors = {}; ev.filter((e) => e.type === 'diaper' && e.color).forEach((e) => { colors[e.color] = (colors[e.color] || 0) + 1; });
  const latestW = [...g].filter((m) => m.kg != null && m.t < B).pop() || null;
  return {
    from, to, A, B, days, full,
    feeds: avg(feedDays, (d) => d.feeds), ml: avg(bottleDays, (d) => d.ml), breast: avg(feedDays, (d) => d.breast), longest: avg(feedDays.filter((d) => d.longest), (d) => d.longest),
    bottle: bottlesAll.length ? { avg: bottlesAll.reduce((a, b) => a + b, 0) / bottlesAll.length, min: Math.min(...bottlesAll), max: Math.max(...bottlesAll), n: bottlesAll.length } : null,
    expShare: (() => { const e = full.reduce((a, d) => a + d.exp, 0), f = full.reduce((a, d) => a + d.form, 0); return e + f ? { exp: Math.round(e / (e + f) * 100), form: Math.round(f / (e + f) * 100) } : null; })(),
    wet: avg(diaperDays, (d) => d.wet), dirty: avg(diaperDays, (d) => d.dirty), colors, pumped: avg(pumpDays, (d) => d.pumped), pumps: avg(pumpDays, (d) => d.pumps),
    temps: ev.filter((e) => e.temp != null).sort((a, b) => a.t - b.t), notes: ev.filter((e) => e.type === 'note').sort((a, b) => a.t - b.t),
    appts: s.appts.filter((a) => !a.planned && inR(a)), growth: gIn, before, gain, latestW,
    hasPump: days.some((d) => d.pumps), hasTemp: days.some((d) => d.maxTemp != null),
    hasSleep: days.some((d) => d.sleep.count > 0),
    sleep: (() => { const sd = full.filter((d) => d.sleep.count > 0); return { total: avg(sd, (d) => d.sleep.total), night: avg(sd, (d) => d.sleep.night), day: avg(sd, (d) => d.sleep.day), naps: avg(sd, (d) => d.sleep.naps), longest: avg(sd, (d) => d.sleep.longest), wakings: avg(sd, (d) => d.sleep.wakings) }; })(),
  };
}

// ---------- sleep ----------
// A sleep is an event {type: 'sleep', t: start, end: ms or null while still asleep, where, note}.
export const SLEEP_WHERE = { crib: 'Crib / bed', pram: 'Pram', arms: 'In arms', car: 'Car seat', other: 'Other' };
export const sleeps = (s) => s.events.filter((e) => e.type === 'sleep');
export const currentSleep = (s) => sleeps(s).find((e) => e.end == null) || null;
const hm = (v, d) => { const m = /^(\d{1,2}):(\d{2})$/.exec(v || ''); return m ? (+m[1]) * 60 + (+m[2]) : d; };
// Night window from the profile (default 19:00–07:00), in minutes after midnight.
export function nightWindow(s) { return { start: hm(s.profile.nightStart, 19 * 60), end: hm(s.profile.nightEnd, 7 * 60) }; }
export const nightLabel = (s) => { const w = nightWindow(s); const f = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); return `${f(w.start)}–${f(w.end)}`; };
// The night periods that touch [A, B), as [start, end] pairs (local time, so daylight saving is handled by Date).
function nights(s, A, B) {
  const w = nightWindow(s); const len = ((w.end - w.start + 1440) % 1440) || 1440;
  const out = []; const d = new Date(A - 2 * DAY); d.setHours(0, 0, 0, 0);
  for (; d.getTime() < B; d.setDate(d.getDate() + 1)) {
    const a = new Date(d); a.setMinutes(w.start); const b = new Date(a); b.setMinutes(b.getMinutes() + len);
    if (b.getTime() > A && a.getTime() < B) out.push([a.getTime(), b.getTime()]);
  }
  return out;
}
const overlap = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));
export const inNight = (s, t) => nights(s, t - 1, t + 1).some(([a, b]) => t >= a && t < b);
// Sleep periods clipped to [A, B), oldest first; a sleep still going counts up to now.
export function sleepSpans(s, A, B) {
  const now = Date.now();
  return sleeps(s).map((e) => ({ e, a: Math.max(e.t, A), b: Math.min(e.end == null ? now : e.end, B) })).filter((x) => x.b > x.a).sort((x, y) => x.a - y.a);
}
// Splits each span into night and day pieces, for charts.
export function sleepPieces(s, A, B) {
  const ns = nights(s, A, B); const out = [];
  for (const x of sleepSpans(s, A, B)) {
    let cuts = [x.a, x.b];
    for (const [a, b] of ns) { if (a > x.a && a < x.b) cuts.push(a); if (b > x.a && b < x.b) cuts.push(b); }
    cuts = [...new Set(cuts)].sort((p, q) => p - q);
    for (let i = 0; i < cuts.length - 1; i++) { const m = (cuts[i] + cuts[i + 1]) / 2; out.push({ a: cuts[i], b: cuts[i + 1], night: ns.some(([a, b]) => m >= a && m < b), open: x.e.end == null && cuts[i + 1] === x.b }); }
  }
  return out;
}
// Totals for a period: total, night, day, naps, longest single sleep, night wakings, time awake between sleeps.
export function sleepStats(s, A, B) {
  const spans = sleepSpans(s, A, B); const ns = nights(s, A, B);
  let total = 0, night = 0, longest = 0, naps = 0, wakings = 0; const gaps = [];
  spans.forEach((x, i) => {
    const len = x.b - x.a; total += len; longest = Math.max(longest, len);
    const nm = ns.reduce((acc, [a, b]) => acc + overlap(x.a, x.b, a, b), 0); night += nm;
    if (!inNight(s, x.e.t)) naps++;
    const nx = spans[i + 1];
    if (nx) { const gap = nx.e.t - (x.e.end ?? nx.e.t); if (gap > 0) { gaps.push(gap); if (inNight(s, x.e.end) && inNight(s, nx.e.t) && gap < 4 * HOUR) wakings++; } }
  });
  return { total, night, day: total - night, naps, longest, wakings, count: spans.length, awake: gaps.length ? median(gaps) : null };
}
// How long she has been awake since the last sleep ended (null while asleep or without sleeps).
export function awakeFor(s) { if (currentSleep(s)) return null; const l = sleeps(s).find((e) => e.end != null); return l ? Date.now() - l.end : null; }
export function sleepTitle(e) {
  const p = ['Sleep'];
  if (e.end == null) p.push('still sleeping'); else p.push(fmtDurShort(e.end - e.t));
  if (e.where && SLEEP_WHERE[e.where]) p.push(SLEEP_WHERE[e.where].toLowerCase());
  return p.join(' · ');
}
export const fmtDurShort = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); if (m < 60) return m + ' min'; return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
