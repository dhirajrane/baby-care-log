// Visit report for the doctor: pick a period, then a printable one-page summary.
import { useState } from 'react';
import { dayKey, keyToMs, fmtDate, fmtTime, fmtDur, fmtTemp, grams, lsGet, lsSet } from '../lib/util.js';
import { AK_TITLE, TSITE, NOTE_TAGS } from '../lib/constants.js';
import { buildReport, lastVisit, repRange, whoBand, ageText, fmtDurShort, nightLabel } from '../lib/calc.js';
import { S, render, toast } from '../store.js';

const n1 = (v) => v == null ? '–' : (Math.round(v * 10) / 10).toLocaleString();
const ml10 = (v) => Math.round(v / 10) * 10;
const Rng = ({ a }) => a && a.n > 1 && a.min !== a.max ? <> <span className="rg">({n1(a.min)}–{n1(a.max)})</span></> : null;
const RngMl = ({ a }) => a && a.n > 1 && a.min !== a.max ? <> <span className="rg">({ml10(a.min)}–{ml10(a.max)})</span></> : null;
const Stat = ({ label, children, sub }) => <div className="rs"><span>{label}</span><b className="num">{children}</b>{sub ? <em>{sub}</em> : null}</div>;
const fd = (d) => new Date(keyToMs(d)).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

function back() { S.tab = S.prevTab && S.prevTab !== 'report' ? S.prevTab : 'history'; render(); window.scrollTo(0, 0); }
function print() { try { window.print(); } catch (e) { toast("This browser can't print. Take screenshots of the report instead."); } }

export default function Report() {
  const [rq, setRq] = useState(() => lsGet('babycarelog.questions') || '');
  if (!S.rep) S.rep = { ...repRange(S, lastVisit(S) ? 'visit' : '14'), notes: true };
  const q = S.rep; let from = q.from, to = q.to; if (from > to) [from, to] = [to, from];
  const r = buildReport(S, from, to);
  const lv = lastVisit(S); const nd = r.days.length; const P = S.profile; const today = dayKey(Date.now());
  const wb = r.latestW ? whoBand(S, +r.latestW.kg, r.latestW.t) : null;
  const growthRows = [...(r.before ? [r.before] : []), ...r.growth];
  const setDate = (which) => (ev) => { if (ev.target.value) { S.rep[which] = ev.target.value; S.rep.preset = 'custom'; ev.target.blur(); render(); } };
  return <>
    <div className="no-print rep-ctl">
      <div className="help-top"><button className="chip" onClick={back}>← Back</button><button className="btn" onClick={print}>Save as PDF / print</button></div>
      <section className="card"><h2>Visit report</h2><p className="footnote" style={{ margin: '4px 0 10px' }}>Pick the period to show the doctor. The report updates straight away.</p>
        <div className="filters" style={{ position: 'static', padding: 0 }}>{[['visit', lv ? 'Since last visit' : null], ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days']].filter((x) => x[1]).map(([k, l]) =>
          <button key={k} className="chip" aria-pressed={q.preset === k} onClick={() => { S.rep = { ...S.rep, ...repRange(S, k) }; render(); }}>{l}</button>)}</div>
        <div className="row2" style={{ marginTop: 10 }}>
          <label className="field">From<input type="date" key={'f' + from} defaultValue={from} max={today} onChange={setDate('from')} /></label>
          <label className="field">To<input type="date" key={'t' + to} defaultValue={to} max={today} onChange={setDate('to')} /></label></div>
        {lv ? <p className="footnote">Last visit: {lv.title || AK_TITLE[lv.kind]}, {fmtDate(lv.t)}.</p> : <p className="footnote">Add consultatiebureau or doctor visits in Calendar to get a "Since last visit" option.</p>}
        <label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={q.notes} onChange={(ev) => { S.rep.notes = ev.target.checked; render(); }} />Include day notes</label>
        <label className="field" style={{ marginTop: 10 }}>Questions for the doctor<textarea value={rq} placeholder="e.g. Is 4h between feeds at night OK? Spit-up after most bottles." onChange={(ev) => { setRq(ev.target.value); lsSet('babycarelog.questions', ev.target.value); }} /></label>
      </section></div>

    <article className="rep">
      <header className="rep-h"><div><h1>{P.name || 'Baby'} · visit report</h1><p>{P.birth ? `Born ${fmtDate(keyToMs(P.birth))} · ${ageText(S, r.B - 1)} at the end of this period` : ''}{P.sex ? ` · ${P.sex === 'boy' ? 'boy' : 'girl'}` : ''}</p></div>
        <div className="rep-per"><b>{fd(from)} – {fd(to)}</b><span>{nd} day{nd > 1 ? 's' : ''}{to === today ? ' · today so far' : ''}</span></div></header>

      <section className="rsec"><h2>Growth</h2>
        {growthRows.length ? <div className="tbl"><table><thead><tr><th>Date</th><th>Weight</th><th>Length</th><th>Head</th></tr></thead><tbody>
          {growthRows.map((m) => <tr key={m.id} className={m === r.before ? 'pre' : undefined}><td>{fmtDate(m.t)}{m === r.before && <> <em>(before period)</em></>}</td><td>{m.kg != null ? grams(m.kg) + ' g' : '–'}</td><td>{m.cm != null ? m.cm + ' cm' : '–'}</td><td>{m.head != null ? m.head + ' cm' : '–'}</td></tr>)}
        </tbody></table></div> : <p className="muted">No measurements logged.</p>}
        {r.gain && <p><b>{r.gain.g >= 0 ? '+' : ''}{r.gain.g.toLocaleString()} g</b> from {fmtDate(r.gain.from.t)} to {fmtDate(r.gain.to.t)}, about <b>{r.gain.perWeek >= 0 ? '+' : ''}{r.gain.perWeek} g per week</b>.</p>}
        {wb && <p>Latest weight is {wb} for {P.sex === 'boy' ? 'boys' : 'girls'} of this age (WHO weight-for-age).</p>}
      </section>

      <section className="rsec"><h2>Feeding</h2><div className="rstats">
        <Stat label="Feeds per day">{n1(r.feeds && r.feeds.avg)}<Rng a={r.feeds} /></Stat>
        <Stat label="Milk from bottles per day" sub={r.expShare ? `${r.expShare.exp}% expressed · ${r.expShare.form}% formula` : ''}>{r.ml ? <>{ml10(r.ml.avg)} ml<RngMl a={r.ml} /></> : '–'}</Stat>
        <Stat label="Average bottle" sub={r.bottle && r.bottle.n > 1 ? `${r.bottle.min}–${r.bottle.max} ml · ${r.bottle.n} bottles` : ''}>{r.bottle ? Math.round(r.bottle.avg) + ' ml' : '–'}</Stat>
        <Stat label="Breast feeds per day">{n1(r.breast && r.breast.avg)}</Stat>
        <Stat label="Longest stretch between feeds" sub={r.longest && r.longest.n > 1 ? `average per day · longest ${fmtDur(r.longest.max)}` : 'average per day'}>{r.longest ? fmtDur(r.longest.avg) : '–'}</Stat>
      </div></section>

      <section className="rsec"><h2>Diapers</h2><div className="rstats">
        <Stat label="Wet per day">{n1(r.wet && r.wet.avg)}<Rng a={r.wet} /></Stat>
        <Stat label="Dirty per day">{n1(r.dirty && r.dirty.avg)}<Rng a={r.dirty} /></Stat>
        {r.hasDry && <Stat label="Dry per day">{n1(r.dry && r.dry.avg)}<Rng a={r.dry} /></Stat>}
        <Stat label="Stool colours">{Object.keys(r.colors).length ? Object.entries(r.colors).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}×`).join(', ') : '–'}</Stat>
      </div></section>

      {r.hasSleep && <section className="rsec"><h2>Sleep</h2><div className="rstats">
        <Stat label="Sleep per day" sub={r.sleep.total && r.sleep.total.n > 1 ? `${fmtDurShort(r.sleep.total.min)}–${fmtDurShort(r.sleep.total.max)}` : ''}>{r.sleep.total ? fmtDurShort(r.sleep.total.avg) : '–'}</Stat>
        <Stat label={`Night sleep (${nightLabel(S)})`}>{r.sleep.night ? fmtDurShort(r.sleep.night.avg) : '–'}</Stat>
        <Stat label="Naps per day" sub={r.sleep.day ? `${fmtDurShort(r.sleep.day.avg)} in total` : ''}>{n1(r.sleep.naps && r.sleep.naps.avg)}</Stat>
        <Stat label="Longest sleep" sub="average per day">{r.sleep.longest ? fmtDurShort(r.sleep.longest.avg) : '–'}</Stat>
        <Stat label="Night wakings">{n1(r.sleep.wakings && r.sleep.wakings.avg)}</Stat>
      </div></section>}

      {r.hasTemp && <section className="rsec"><h2>Temperature</h2>
        <div className="tbl"><table><thead><tr><th>When</th><th>Temperature</th><th>Measured</th></tr></thead><tbody>
          {r.temps.map((e) => <tr key={e.id} className={e.temp >= 38 ? 'hot' : undefined}><td>{fmtDate(e.t)} {fmtTime(e.t)}</td><td>{fmtTemp(e.temp)}{e.temp >= 38 ? ' · fever range' : e.temp < 35.8 ? ' · low' : ''}</td><td>{TSITE[e.tempSite || 'rectal'] || ''}</td></tr>)}
        </tbody></table></div></section>}

      {r.hasPump && <section className="rsec"><h2>Pumping</h2><div className="rstats">
        <Stat label="Pumped per day">{r.pumped ? <>{ml10(r.pumped.avg)} ml<RngMl a={r.pumped} /></> : '–'}</Stat>
        <Stat label="Sessions per day">{n1(r.pumps && r.pumps.avg)}</Stat></div></section>}

      <section className="rsec"><h2>Day by day</h2><div className="tbl"><table className="days"><thead><tr><th>Day</th><th>Feeds</th><th>Bottles ml</th><th>Breast</th><th>Wet</th><th>Dirty</th>{r.hasSleep && <th>Sleep</th>}{r.hasTemp && <th>Max °C</th>}{r.hasPump && <th>Pumped ml</th>}</tr></thead><tbody>
        {[...r.days].reverse().map((d) => <tr key={d.k} className={d.complete ? undefined : 'pre'}>
          <td>{new Date(keyToMs(d.k)).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}{!d.complete && <> <em>so far</em></>}</td>
          <td>{d.any ? d.feeds : '–'}</td><td>{d.any ? d.ml : '–'}</td><td>{d.any ? d.breast : '–'}</td><td>{d.any ? d.wet : '–'}</td><td>{d.any ? d.dirty : '–'}</td>{r.hasSleep && <td>{d.sleep.count ? fmtDurShort(d.sleep.total) : '–'}</td>}
          {r.hasTemp && <td className={d.maxTemp >= 38 ? 'hotc' : undefined}>{d.maxTemp != null ? d.maxTemp.toFixed(1) : '–'}</td>}
          {r.hasPump && <td>{d.pumped || '–'}</td>}
        </tr>)}
      </tbody></table></div></section>

      {r.appts.length > 0 && <section className="rsec"><h2>Appointments in this period</h2><ul>{r.appts.map((a) => <li key={a.id}>{fmtDate(a.t)}: {a.title || AK_TITLE[a.kind]}{a.place ? ' · ' + a.place : ''}</li>)}</ul></section>}

      {q.notes && r.notes.length > 0 && <section className="rsec"><h2>Day notes</h2><ul className="rnotes">{r.notes.map((e) => <li key={e.id}><b>{new Date(e.t).toLocaleDateString([], { day: 'numeric', month: 'short' })} {fmtTime(e.t)}</b>{(e.tags || []).length ? ' · ' + e.tags.map((t) => NOTE_TAGS[t] || t).join(', ') : ''}{e.note && <><br />{e.note}</>}</li>)}</ul></section>}

      {rq.trim() && <section className="rsec rq-print"><h2>Questions for the doctor</h2><p className="rq-text">{rq}</p></section>}

      <p className="rep-foot">Made with Baby Care Log from entries logged by the parents. Daily averages use complete days that have entries for that item{to === today ? '; today is not included in averages because it isn’t over yet' : ''}. Breast feeds are counted but not measured in ml.</p>
    </article>
  </>;
}
