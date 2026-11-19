// Calculations on the log: totals, the next-feed suggestion, vaccinations and the visit report.
// Every function takes the app state `s` ({profile, events, growth, appts}) so it stays pure.
import { DAY, HOUR, dayKey, keyToMs, median, clampN, startOfToday, fmtTemp } from './util.js';
import { FEED, SIDE, DIAPER, TSITE, NOTE_TAGS, WHO, REP_KINDS, AK_TITLE } from './constants.js';

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
  if (e.type === 'feed') { const p = [FEED[e.kind] || 'Feed']; if (e.kind === 'breast' && e.side) p.push(SIDE[e.side]); if (e.min) p.push(e.min + ' min'); if (e.ml) p.push(e.ml + ' ml'); return p.join(' · '); }
  if (e.type === 'pump') { const p = ['Pumping']; if (e.side) p.push(SIDE[e.side]); if (e.min) p.push(e.min + ' min'); if (e.ml) p.push(e.ml + ' ml'); return p.join(' · '); }
  const p = [DIAPER[e.kind] || 'Diaper'];
  if ((e.kind === 'dirty' || e.kind === 'both') && e.color) p.push(e.color);
  if (e.temp != null) p.push(fmtTemp(e.temp) + (e.tempSite && e.tempSite !== 'rectal' ? ' (' + TSITE[e.tempSite].toLowerCase() + ')' : ''));
  return p.join(' · ');
}
export const evDot = (e) => e.type === 'note' ? 'c-note' : e.type === 'pump' ? 'c-pump' : e.type === 'feed' ? 'c-feed' : e.kind === 'wet' ? 'c-wet' : e.kind === 'dirty' ? 'c-dirty' : 'c-both';

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
// Guide: about 150 ml per kg body weight per day (Voedingscentrum/GGD); ~10 feeds per 24 h as a newborn, ~6 around 6 months.
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

export function nextFeedPlan(s) {
  const fs = feeds(s).filter((e) => e.kind !== 'solids');
  if (!fs.length) return null;
  const now = Date.now(); const am = ageMonths(s); const H = HOUR;
  const ageFeeds = am == null ? 8 : clampN(10 - am / 6 * 4, 6, 10); const ageGap = 24 * H / ageFeeds;
  const minGap = 1.5 * H, maxGap = ageGap * 1.5;
  const ses = feedSessions(fs.filter((e) => e.t > now - 4 * DAY));
  // Her usual gap between feeds over the last 2 days.
  const gaps = [];
  for (let i = 1; i < ses.length; i++) { if (ses[i].t < now - 2 * DAY) continue; const g = ses[i].t - ses[i - 1].t; if (g >= 45 * 60e3 && g <= 8 * H) gaps.push(g); }
  const usualGap = gaps.length >= 4 ? clampN(median(gaps), ageGap * 0.6, maxGap) : ageGap;
  // How many ml she drinks per hour of gap, learned from fully measured feeds followed by another feed.
  const pairs = [];
  for (let i = 0; i < ses.length - 1; i++) { const x = ses[i]; if (x.ml > 0 && !x.unm) { const g = (ses[i + 1].t - x.t) / H; if (g >= 0.75 && g <= 8) pairs.push(x.ml / g); } }
  const learnedRate = pairs.length >= 5 ? median(pairs) : null;
  const w = latestWeight(s); const perKg = +s.profile.mlPerKg || 150; const target = w ? Math.round(w.kg * perKg) : null;
  const guideRate = target ? target / 24 : null;
  // Combine her own pattern with the weight guide: the more measured feeds, the more her pattern counts.
  const k = Math.min(1, pairs.length / 10); let rate = null, rateSrc = null;
  if (learnedRate && guideRate) { rate = k * learnedRate + (1 - k) * guideRate; rateSrc = k >= 1 ? 'her' : 'blend'; }
  else if (learnedRate) { rate = learnedRate; rateSrc = 'her'; } else if (guideRate) { rate = guideRate; rateSrc = 'guide'; }
  const last = ses[ses.length - 1]; let gap, gapSrc;
  if (rate && last.ml > 0 && !last.unm) { gap = clampN(last.ml / rate * H, minGap, maxGap); gapSrc = 'amount'; }
  else { gap = usualGap; gapSrc = gaps.length >= 4 ? 'usual' : 'age'; }
  const next = last.t + gap;
  const plan = { next, gap, gapSrc, last, rate, rateSrc, pairs: pairs.length, usualGap };
  if (!target) return plan;
  // Typical amount per feed: weight guide spread over her feeds per day, blended with her recent bottles.
  const guidePer = target / (24 * H / usualGap);
  const measuredRecent = ses.filter((x) => x.t > now - 3 * DAY && x.ml > 0 && !x.unm).map((x) => x.ml);
  const avg = measuredRecent.length >= 3 ? measuredRecent.reduce((a, b) => a + b, 0) / measuredRecent.length : null;
  const perFeed = avg ? (avg + guidePer) / 2 : guidePer;
  // What's left of the day's guide, spread over the feeds that fit before midnight.
  const at = Math.max(next, now); const tk = dayKey(at); const newDay = tk !== dayKey(now);
  const day = ses.filter((x) => dayKey(x.t) === tk);
  const measured = day.reduce((a, x) => a + x.ml, 0); const unmOnly = day.filter((x) => x.ml === 0).length;
  const counted = Math.round(measured + unmOnly * perFeed);
  const remaining = target - counted; const reached = remaining <= 0;
  const stepGap = clampN(perFeed / rate * H, minGap, maxGap);
  const left = Math.max(1, Math.floor((keyToMs(tk) + DAY - at) / stepGap) + 1);
  // Behind on the guide: up to 20% more. Ahead of it: at most 10% less, because the guide is not a limit.
  const ml = Math.max(10, Math.round(clampN(reached ? perFeed * 0.9 : remaining / left, perFeed * 0.9, perFeed * 1.2) / 10) * 10);
  Object.assign(plan, { ml, target, perKg, weight: w, perFeed: Math.round(perFeed / 5) * 5, guidePer: Math.round(guidePer / 5) * 5, recentAvg: avg ? Math.round(avg) : null, counted, measured, unmOnly, remaining: Math.max(0, remaining), left, reached, newDay });
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
    days.push({ k, complete: k < todayK, feeds: ds.length, ml: r.ml, exp: r.exp, form: r.form, bottles: r.bottles, breast: r.breast, wet: t.wet, dirty: t.dirty, pumps: t.pumps, pumped: t.pumped, maxTemp: tv.length ? Math.max(...tv) : null, longest, any: L.length > 0 });
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
  };
}
