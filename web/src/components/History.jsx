// History tab: filters, 14-day charts, and the log grouped by day.
import { dayKey, fmtDay, fmtDur, fmtTemp, keyToMs, DAY } from '../lib/util.js';
import { HF } from '../lib/constants.js';
import { dayTotals, intake, feedGap, sleepStats, fmtDurShort, sleeps } from '../lib/calc.js';
import { S, render, openReport } from '../store.js';
import { Item, NoteItem } from './ui.jsx';
import { BarsChart, IntakeChart, intakeAvg } from './charts.jsx';
import { SleepPattern, SleepBars } from './Sleep.jsx';

function DayOverview({ list, f, k }) {
  const t = dayTotals(list); const r = intake(list); const g = feedGap(list);
  const breast = list.filter((e) => e.type === 'feed' && e.kind === 'breast'); const bmin = breast.reduce((a, e) => a + (+e.min || 0), 0);
  const tiles = [];
  const tile = (cls, big, label) => tiles.push(<div key={tiles.length} className={cls}><b>{big}</b><span>{label}</span></div>);
  if (f === 'all' || f === 'feed') {
    tile('k-feed', t.feeds, t.feeds === 1 ? 'feed' : 'feeds');
    tile('k-feed', r.ml + ' ml', r.bottles ? `milk · ${r.bottles} bottle${r.bottles > 1 ? 's' : ''}` : 'milk from bottles');
    tile('k-feed', breast.length, `breast${bmin ? ' · ' + bmin + ' min' : ''}`);
    if (f === 'feed') {
      if (r.exp || r.form) tile('k-feed', r.exp + ' ml', `expressed${r.form ? ' · formula ' + r.form + ' ml' : ''}`);
      tile('k-feed', g ? fmtDur(g) : '–', 'between feeds (avg)');
    }
  }
  if (f === 'all' || f === 'diaper') { tile('k-wet', t.wet, 'wet'); tile('k-dirty', t.dirty, 'dirty'); }
  if (f === 'diaper') {
    const d = list.filter((e) => e.type === 'diaper'); tile('k-wet', d.length, 'changes');
    if (t.dry) tile('k-dry', t.dry, 'dry');
    const tv = d.filter((e) => e.temp != null).map((e) => +e.temp);
    if (tv.length) tile(Math.max(...tv) >= 38 ? 'k-hot' : 'k-wet', fmtTemp(Math.max(...tv)), `highest temp · ${tv.length} reading${tv.length > 1 ? 's' : ''}`);
  }
  if (f === 'all' || f === 'sleep') {
    const A = keyToMs(k); const st = sleepStats(S, A, A + DAY);
    if (f === 'sleep' || st.total) {
      tile('k-sleep', st.total ? fmtDurShort(st.total) : '–', 'sleep');
      if (f === 'sleep') { tile('k-sleep', fmtDurShort(st.night), 'night'); tile('k-sleep', fmtDurShort(st.day), `${st.naps} nap${st.naps === 1 ? '' : 's'}`); tile('k-sleep', fmtDurShort(st.longest), 'longest stretch'); tile('k-sleep', st.awake != null ? fmtDurShort(st.awake) : '–', 'usual time awake'); tile('k-sleep', st.wakings, `night waking${st.wakings === 1 ? '' : 's'}`); }
    }
  }
  if (f === 'all' || f === 'pump') {
    if (f === 'pump' || t.pumps) tile('k-pump', t.pumped + ' ml', `pumped · ${t.pumps} session${t.pumps === 1 ? '' : 's'}`);
    if (f === 'pump') {
      const pm = list.filter((e) => e.type === 'pump').reduce((a, e) => a + (+e.min || 0), 0);
      tile('k-pump', pm ? pm + ' min' : '–', 'pumping time'); tile('k-pump', t.pumps ? Math.round(t.pumped / t.pumps) + ' ml' : '–', 'per session');
    }
  }
  return <div className="ov">{tiles}</div>;
}

function toggleDay(k, ev) {
  const was = S.openDays.has(k); if (was) S.openDays.delete(k); else S.openDays.add(k); render();
  if (was) { const c = ev.currentTarget.closest('.day'); if (c && c.getBoundingClientRect().top < 0) c.scrollIntoView({ block: 'start' }); }
}

export default function History() {
  const f = S.hFilter; const match = (e) => f === 'all' || e.type === f;
  const keys = []; const all = {}; S.events.forEach((e) => { const k = dayKey(e.t); if (!all[k]) { all[k] = []; keys.push(k); } all[k].push(e); });
  const fkeys = keys.filter((k) => all[k].some(match)); const shown = fkeys.slice(0, S.historyDays);
  const avg = intakeAvg();
  const milk = <section className="card" key="milk"><p className="eyebrow">Last 14 days</p><h2>Milk per day (ml)</h2>
    <div className="legend"><span><i style={{ background: 'var(--feed)' }}></i>Expressed milk</span><span><i style={{ background: 'var(--dirty)' }}></i>Formula</span>{avg > 0 && <span><i style={{ background: 'none', borderTop: '2px dashed var(--muted)', height: 0, borderRadius: 0 }}></i>Average {avg} ml/day</span>}</div>
    <div className="chart-wrap"><IntakeChart /></div><p className="footnote">Counts bottle feeds with an amount in ml, per calendar day. The average leaves out today because it isn't over yet. Breast feeds aren't measured in ml.</p></section>;
  const bars = <section className="card" key="bars"><p className="eyebrow">Last 14 days</p><h2>Feeds and wet diapers per day</h2>
    <div className="legend"><span><i style={{ background: 'var(--feed)' }}></i>Feeds</span><span><i style={{ background: 'var(--wet)' }}></i>Wet diapers</span></div>
    <div className="chart-wrap"><BarsChart /></div></section>;
  const hasSleep = sleeps(S).length > 0;
  const charts = f === 'all' ? [milk, bars, hasSleep && <SleepPattern key="sp" />] : f === 'feed' ? milk : f === 'diaper' ? bars : f === 'sleep' ? [<SleepPattern key="sp" />, <SleepBars key="sb" />] : null;
  const dnotes = (k) => { const ns = all[k].filter((e) => e.type === 'note'); return ns.length ? <div className="dnotes">{ns.map((e) => <NoteItem key={e.id} e={e} />)}</div> : null; };
  const empty = S.loading ? 'Loading the log…' : f === 'all' ? 'No entries yet. Logged feeds, diapers, pumping sessions and notes appear here, grouped by day.' : f === 'note' ? 'No notes yet. Tap + Note at the bottom to write how the baby is doing.' : `No ${HF[f].toLowerCase()} logged yet.`;
  return <>
    <div className="rep-entry"><button className="chip" onClick={openReport}>Visit report for the doctor</button></div>
    <div className="filters" role="group" aria-label="Show">{Object.entries(HF).map(([k, l]) => <button key={k} className="chip" aria-pressed={k === f} onClick={() => { S.hFilter = k; S.historyDays = 7; render(); }}>{l}</button>)}</div>
    {charts}
    {shown.length ? shown.map((k) => {
      if (f === 'note') { const c = all[k].filter((e) => e.type === 'note').length; return <section key={k} className="card day"><div className="dayhead"><h2>{fmtDay(k)}</h2><span className="tot num">{c} note{c === 1 ? '' : 's'}</span></div>{dnotes(k)}</section>; }
      const items = all[k].filter((e) => e.type !== 'note' && match(e)); const open = S.openDays.has(k); const n = `${items.length} ${items.length === 1 ? 'entry' : 'entries'}`;
      return (
        <section key={k} className={'card day ' + (open ? 'open' : '')}>
          <button className="dayhead dtoggle" aria-expanded={open} onClick={(ev) => toggleDay(k, ev)}><h2>{fmtDay(k)}</h2><span className="tot num">{n}<svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></span></button>
          {(items.length > 0 || k === dayKey(Date.now())) && <DayOverview list={all[k]} f={f} k={k} />}
          {f === 'all' && dnotes(k)}
          {open && items.length > 0 && <div className="list">{items.map((e) => <Item key={e.id} e={e} />)}</div>}
          {items.length > 0 && <button className="daymore" aria-expanded={open} onClick={(ev) => toggleDay(k, ev)}>{open ? 'Hide log' : 'Show ' + n}</button>}
        </section>
      );
    }) : <section className="card"><p className="empty">{empty}</p></section>}
    {fkeys.length > S.historyDays && <button className="btn ghost more" onClick={() => { S.historyDays += 14; render(); }}>Show earlier days</button>}
  </>;
}
