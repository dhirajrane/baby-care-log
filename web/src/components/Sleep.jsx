// Sleep: the "is sleeping" card on Today, the last-24-hours card, and the History charts.
import { DAY, HOUR, dayKey, keyToMs, fmtTime, niceStep } from '../lib/util.js';
import { currentSleep, sleepPieces, sleepStats, awakeFor, fmtDurShort, nightLabel, pron, sleeps, inNight, SLEEP_WHERE } from '../lib/calc.js';
import { S, endSleep, startSleep, openSheet } from '../store.js';

const pct = (v) => (v * 100).toFixed(2) + '%';

// A horizontal strip from A to B with sleep pieces (night darker, naps lighter) and the night window shaded.
export function SleepStrip({ A, B, small }) {
  const span = B - A;
  const pieces = sleepPieces(S, A, B);
  // Shade night time: sample the window in 15-minute steps and merge.
  const shade = []; let cur = null;
  for (let t = A; t < B; t += 15 * 60000) { const n = inNight(S, t); if (n && !cur) cur = [t, t]; if (n) cur[1] = Math.min(B, t + 15 * 60000); if (!n && cur) { shade.push(cur); cur = null; } }
  if (cur) shade.push(cur);
  return (
    <div className={'strip' + (small ? ' small' : '')} role="img" aria-label={`Sleep from ${fmtTime(A)} to ${fmtTime(B)}`}>
      {shade.map(([a, b], i) => <span key={'s' + i} className="nightbg" style={{ left: pct((a - A) / span), width: pct((b - a) / span) }}></span>)}
      {pieces.map((p, i) => <i key={i} className={p.open ? 'open' : p.night ? 'n' : 'd'} style={{ left: pct((p.a - A) / span), width: pct(Math.max(p.b - p.a, span / 400) / span) }}></i>)}
    </div>
  );
}

export function SleepingNow() {
  const cur = currentSleep(S);
  if (!cur) return null;
  const { She } = pron(S);
  const todayNaps = sleeps(S).filter((e) => dayKey(e.t) === dayKey(Date.now()) && !inNight(S, e.t)).length;
  const night = inNight(S, cur.t);
  return (
    <section className="sleeping" aria-live="polite">
      <div className="sl-head"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>{S.profile.name || She} is sleeping</div>
      <div className="sl-row">
        <div><b className="num">{fmtDurShort(Date.now() - cur.t)}</b>
          <span>since {fmtTime(cur.t)} · {night ? 'night sleep' : `nap ${todayNaps} today`}{cur.where && cur.where !== 'crib' ? ' · ' + SLEEP_WHERE[cur.where].toLowerCase() : ''}</span></div>
        <button className="btn" onClick={() => endSleep()}>Woke up</button>
      </div>
      <button className="linkbtn sl-edit" onClick={() => openSheet('sleep', cur)}>Change the time or place</button>
    </section>
  );
}

export function Sleep24() {
  if (!sleeps(S).length) return null;
  const B = Date.now(), A = B - DAY;
  const st = sleepStats(S, A, B);
  const aw = awakeFor(S);
  const { her } = pron(S);
  const ticks = [0, 6, 12, 18, 24].map((h) => A + h * HOUR);
  return (
    <section className="card">
      <div className="dayhead"><h2>Sleep, last 24 hours</h2><span className="tot num">{fmtDurShort(st.total)}</span></div>
      <div className="ov">
        <div className="k-sleep"><b>{fmtDurShort(st.night)}</b><span>night · {nightLabel(S)}</span></div>
        <div className="k-sleep"><b>{fmtDurShort(st.day)}</b><span>{st.naps} nap{st.naps === 1 ? '' : 's'}</span></div>
        <div className="k-sleep"><b>{fmtDurShort(st.longest)}</b><span>longest sleep</span></div>
        <div className="k-sleep"><b>{st.wakings}</b><span>night waking{st.wakings === 1 ? '' : 's'}</span></div>
        <div className="k-sleep"><b>{st.awake != null ? fmtDurShort(st.awake) : '–'}</b><span>usual time awake</span></div>
        <div className="k-sleep"><b>{aw != null ? fmtDurShort(aw) : currentSleep(S) ? 'asleep' : '–'}</b><span>awake now</span></div>
      </div>
      <SleepStrip A={A} B={B} />
      <div className="strip-axis">{ticks.map((t, i) => <span key={i}>{i === 4 ? 'now' : fmtTime(t).replace(':00', '')}</span>)}</div>
      <div className="legend"><span><i style={{ background: 'var(--sleep)' }}></i>Night sleep</span><span><i style={{ background: 'var(--nap)' }}></i>Naps</span><span><i className="nightkey"></i>Night time</span></div>
      <p className="footnote">Every baby sleeps differently. If you're worried about {her} sleep, ask the consultatiebureau.{!currentSleep(S) && <> <button className="linkbtn" onClick={() => startSleep()}>Asleep now</button></>}</p>
    </section>
  );
}

// History: one row per day, midnight to midnight.
export function SleepPattern({ days = 7 }) {
  const rows = [];
  for (let i = 0; i < days; i++) { const k = dayKey(Date.now() - i * DAY); const A = keyToMs(k); rows.push({ k, A, B: A + DAY, st: sleepStats(S, A, A + DAY) }); }
  return (
    <section className="card"><p className="eyebrow">Last {days} days</p><h2>Sleep and wake pattern</h2>
      <div className="legend"><span><i style={{ background: 'var(--sleep)' }}></i>Night sleep</span><span><i style={{ background: 'var(--nap)' }}></i>Naps</span><span><i className="nightkey"></i>Night time</span></div>
      {rows.map((r, i) => (
        <div key={r.k} className="prow"><span>{i === 0 ? 'Today' : new Date(r.A).toLocaleDateString([], { weekday: 'short', day: 'numeric' })}</span><SleepStrip A={r.A} B={r.B} small /><b className="num">{r.st.total ? fmtDurShort(r.st.total) : '–'}</b></div>
      ))}
      <div className="prow"><span></span><div className="strip-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div><span></span></div>
    </section>
  );
}

// History: hours slept per calendar day, night and day stacked.
export function SleepBars() {
  const days = []; for (let i = 13; i >= 0; i--) { const k = dayKey(Date.now() - i * DAY); const A = keyToMs(k); days.push({ k, ...sleepStats(S, A, A + DAY) }); }
  const W = 340, H = 170, L = 30, R = 6, T = 10, Bm = 24; const mx = Math.max(4 * HOUR, ...days.map((d) => d.total));
  const st = Math.max(2, niceStep(mx / HOUR)); const top = Math.ceil(mx / HOUR / st) * st;
  const y = (h) => T + (H - T - Bm) * (1 - h / top); const gw = (W - L - R) / 14, bw = Math.max(4, gw * 0.6);
  const grid = []; for (let v = 0; v <= top + 1e-9; v += st) grid.push(v);
  const full = days.slice(0, 13).filter((d) => d.total); const avg = full.length ? full.reduce((a, d) => a + d.total, 0) / full.length : 0;
  return (
    <section className="card"><p className="eyebrow">Last 14 days</p><h2>Sleep per day (hours)</h2>
      <div className="legend"><span><i style={{ background: 'var(--sleep)' }}></i>Night</span><span><i style={{ background: 'var(--nap)' }}></i>Day</span>{avg > 0 && <span>Average {fmtDurShort(avg)} a day</span>}</div>
      <div className="chart-wrap"><svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Hours of sleep per day, last 14 days">
        {grid.map((v) => <g key={v}><line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} /><text x={L - 6} y={y(v) + 3} textAnchor="end">{v}h</text></g>)}
        {days.map((d, i) => { const x = L + i * gw + (gw - bw) / 2; const n = d.night / HOUR, t = d.total / HOUR; return <g key={d.k}>
          {n > 0 && <rect x={x} y={y(n)} width={bw} height={y(0) - y(n)} rx="2" fill="var(--sleep)"><title>Night {fmtDurShort(d.night)}</title></rect>}
          {t > n && <rect x={x} y={y(t)} width={bw} height={y(n) - y(t)} rx="2" fill="var(--nap)"><title>Day {fmtDurShort(d.day)}</title></rect>}
          {(i % 2 === 1 || i === 13) && <text x={x + bw / 2} y={H - 8} textAnchor="middle">{i === 13 ? 'Today' : new Date(keyToMs(d.k)).getDate()}</text>}
        </g>; })}
      </svg></div>
      <p className="footnote">Per calendar day, midnight to midnight. A sleep that crosses midnight is split over both days. The average leaves out today, because it isn't over yet.</p>
    </section>
  );
}
