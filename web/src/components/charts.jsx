// SVG charts: feeds and wet diapers per day, milk per day, and the growth chart with WHO bands.
import { DAY, dayKey, keyToMs, niceStep, fmtDate } from '../lib/util.js';
import { WHO } from '../lib/constants.js';
import { dayTotals, intake } from '../lib/calc.js';
import { S } from '../store.js';

const last14 = (fn) => { const days = []; for (let i = 13; i >= 0; i--) { const k = dayKey(Date.now() - i * DAY); days.push({ k, ...fn(S.events.filter((e) => dayKey(e.t) === k)) }); } return days; };
const dayLabel = (i, k) => i === 13 ? 'Today' : new Date(keyToMs(k)).getDate();

export function BarsChart() {
  const days = last14(dayTotals);
  const W = 340, H = 170, L = 26, R = 6, T = 10, B = 24; const max = Math.max(4, ...days.map((d) => Math.max(d.feeds, d.wet)));
  const step = max <= 8 ? 2 : max <= 16 ? 4 : 5; const top = Math.ceil(max / step) * step; const y = (v) => T + (H - T - B) * (1 - v / top);
  const gw = (W - L - R) / 14, bw = Math.max(3, gw * 0.34);
  const grid = []; for (let v = 0; v <= top; v += step) grid.push(v);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Feeds and wet diapers per day, last 14 days">
      {grid.map((v) => <g key={v}><line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} /><text x={L - 6} y={y(v) + 3} textAnchor="end">{v}</text></g>)}
      {days.map((d, i) => { const x = L + i * gw + gw / 2; return <g key={d.k}>
        {d.feeds > 0 && <rect x={x - bw - 1} y={y(d.feeds)} width={bw} height={y(0) - y(d.feeds)} rx="2" fill="var(--feed)"><title>{d.feeds} feeds</title></rect>}
        {d.wet > 0 && <rect x={x + 1} y={y(d.wet)} width={bw} height={y(0) - y(d.wet)} rx="2" fill="var(--wet)"><title>{d.wet} wet</title></rect>}
        {(i % 2 === 1 || i === 13) && <text x={x} y={H - 8} textAnchor="middle">{dayLabel(i, d.k)}</text>}
      </g>; })}
    </svg>
  );
}

export function intakeAvg() {
  const days = last14(intake); const full = days.slice(0, 13).filter((d) => d.ml);
  return full.length ? Math.round(full.reduce((a, d) => a + d.ml, 0) / full.length) : 0;
}
export function IntakeChart() {
  const days = last14(intake);
  const W = 340, H = 190, L = 34, R = 6, T = 16, B = 24; const mx = Math.max(100, ...days.map((d) => d.ml)); const st = niceStep(mx); const top = Math.ceil(mx / st) * st;
  const y = (v) => T + (H - T - B) * (1 - v / top); const gw = (W - L - R) / 14, bw = Math.max(4, gw * 0.62);
  const grid = []; for (let v = 0; v <= top + 1e-9; v += st) grid.push(v);
  const avg = intakeAvg();
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Milk per day in ml, last 14 days">
      {grid.map((v) => <g key={v}><line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} /><text x={L - 6} y={y(v) + 3} textAnchor="end">{Math.round(v)}</text></g>)}
      {days.map((d, i) => { const x = L + i * gw + (gw - bw) / 2; const lbl = i % 2 === 1 || i === 13; return <g key={d.k}>
        {d.exp > 0 && <rect x={x} y={y(d.exp)} width={bw} height={y(0) - y(d.exp)} fill="var(--feed)"><title>Expressed {d.exp} ml</title></rect>}
        {d.form > 0 && <rect x={x} y={y(d.ml)} width={bw} height={y(d.exp) - y(d.ml)} fill="var(--dirty)"><title>Formula {d.form} ml</title></rect>}
        {d.ml > 0 && lbl && <text x={x + bw / 2} y={y(d.ml) - 4} textAnchor="middle" style={{ fill: 'var(--ink)', fontSize: 9 }}>{d.ml}</text>}
        {lbl && <text x={x + bw / 2} y={H - 8} textAnchor="middle">{dayLabel(i, d.k)}</text>}
      </g>; })}
      {avg > 0 && <line x1={L} x2={W - R} y1={y(avg)} y2={y(avg)} stroke="var(--ink)" strokeWidth="1" strokeDasharray="4 3" opacity=".55" />}
    </svg>
  );
}

export function GrowthChart({ metric }) {
  const F = metric === 'kg' ? 1000 : 1;
  const pts = S.growth.filter((g) => g[metric] != null).map((g) => ({ t: g.t, v: Math.round(+g[metric] * F * 10) / 10 })).sort((a, b) => a.t - b.t);
  if (!pts.length) return <p className="empty">No {metric === 'kg' ? 'weight' : metric === 'cm' ? 'length' : 'head'} measurements yet. Add one after the next weigh-in at the consultatiebureau or at home.</p>;
  const birth = S.profile.birth ? keyToMs(S.profile.birth) : null; const base = birth ?? pts[0].t; const age = (t) => (t - base) / (30.4375 * DAY);
  const xs = pts.map((p) => age(p.t)); const xmax = Math.min(36, Math.max(birth ? 3 : 1, Math.ceil(Math.max(...xs) + 0.3)));
  const W0 = (metric === 'kg' && birth && WHO[S.profile.sex]) ? WHO[S.profile.sex] : null;
  const ref = W0 ? { p3: W0.p3.map((v) => v * F), p50: W0.p50.map((v) => v * F), p97: W0.p97.map((v) => v * F) } : null; const refMax = Math.min(12, Math.floor(xmax));
  const vals = pts.map((p) => p.v); if (ref) { for (let m = 0; m <= refMax; m++) vals.push(ref.p3[m], ref.p97[m]); }
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < F) { lo -= F / 2; hi += F / 2; }
  const st = niceStep(hi - lo); lo = Math.floor(lo / st) * st; hi = Math.ceil(hi / st) * st;
  const W = 340, H = 230, L = 38, R = 16, T = 14, B = 34; const X = (a) => L + (W - L - R) * a / xmax; const Y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const dec = st < 1 ? 1 : 0;
  const yGrid = []; for (let v = lo; v <= hi + 1e-9; v += st) yGrid.push(v);
  const xs2 = xmax <= 6 ? 1 : xmax <= 12 ? 2 : xmax <= 24 ? 3 : 6; const xTicks = []; for (let m = 0; m <= xmax; m += xs2) xTicks.push(m);
  const col = metric === 'kg' ? 'var(--feed)' : metric === 'cm' ? 'var(--wet)' : 'var(--dirty)';
  const lp = pts[pts.length - 1]; const lx = X(age(lp.t)), ly = Y(lp.v); const unit = metric === 'kg' ? ' g' : ' cm';
  let band = null;
  if (ref) { const top = [], bot = []; for (let m = 0; m <= refMax; m++) { top.push(`${X(m)},${Y(ref.p97[m])}`); bot.unshift(`${X(m)},${Y(ref.p3[m])}`); } band = top.concat(bot).join(' '); }
  return <>
    <div className="chart-wrap"><svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Growth chart">
      {yGrid.map((v) => <g key={v}><line className="grid" x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} /><text x={L - 6} y={Y(v) + 3} textAnchor="end">{v.toFixed(dec)}</text></g>)}
      {xTicks.map((m) => <text key={m} x={X(m)} y={H - B + 14} textAnchor="middle">{m}</text>)}
      <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle">{birth ? 'age in months' : 'months since first measurement'}</text>
      {ref && <>
        <polygon points={band} fill="var(--growth-soft)" stroke="none" />
        <polyline points={ref.p50.slice(0, refMax + 1).map((v, m) => `${X(m)},${Y(v)}`).join(' ')} fill="none" stroke="var(--growth)" strokeWidth="1.2" strokeDasharray="4 4" opacity=".8" />
      </>}
      {pts.length > 1 && <polyline points={pts.map((p) => `${X(age(p.t))},${Y(p.v)}`).join(' ')} fill="none" stroke={col} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />}
      {pts.map((p, i) => { const last = i === pts.length - 1; return <circle key={i} cx={X(age(p.t))} cy={Y(p.v)} r={last ? 5 : 3.2} fill={last ? col : 'var(--surface)'} stroke={col} strokeWidth="2"><title>{fmtDate(p.t)}: {p.v}{metric === 'kg' ? ' g' : ' cm'}</title></circle>; })}
      <text x={Math.min(lx, W - R - 2)} y={ly - 10} textAnchor={lx > W - 70 ? 'end' : 'middle'} style={{ fill: 'var(--ink)', fontWeight: 700, fontSize: 11 }}>{lp.v}{unit}</text>
    </svg></div>
    {ref ? <div className="legend"><span><i style={{ background: 'var(--growth-soft)', border: '1px solid var(--growth)' }}></i>WHO 3rd–97th percentile ({S.profile.sex === 'girl' ? 'girls' : 'boys'})</span><span><i style={{ background: 'var(--growth)', height: 2, verticalAlign: 3 }}></i>median</span></div>
      : metric === 'kg' ? <p className="footnote">{birth ? 'Reference curves cover the first 12 months.' : 'Add her birth date under Baby to compare against WHO reference curves.'}</p> : null}
  </>;
}
