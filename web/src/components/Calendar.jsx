// Calendar tab: appointments, expected vaccination dates, and the "Coming up" card on Today.
import { DAY, fmtTime, startOfToday, uid } from '../lib/util.js';
import { AK, AK_TITLE } from '../lib/constants.js';
import { apptWhen, remindLabel, vaxPlan } from '../lib/calc.js';
import { S, render, go, openSheet, openReport, saveRow, toast } from '../store.js';

export function ApptRow({ a, compact }) {
  const d = new Date(a.t); const w = apptWhen(a.t);
  const meta = [a.planned ? d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + fmtTime(a.t), a.place].filter(Boolean).join(' · ');
  const rem = (a.remind || []).length ? 'Reminders: ' + [...a.remind].sort((x, y) => y - x).map(remindLabel).join(', ') + (a.remind.some((m) => m > 0) ? ' before' : '') : 'No reminders';
  return (
    <button className="appt" onClick={() => openSheet('appt', a)}>
      <div className="date"><span>{d.toLocaleDateString([], { month: 'short' })}</span><b className="num">{d.getDate()}</b></div>
      <div className="body"><span className={'kind k-' + (a.kind || 'other')}>{AK[a.kind] || 'Other'}</span>
        <div className="ttl">{a.title || AK_TITLE[a.kind] || 'Appointment'}</div><div className="meta">{meta}</div>
        {a.planned ? <div className="planned">{compact ? 'Expected date' : 'Expected date. Update it when the invitation arrives.'}</div> : <div className="meta">{rem}</div>}
        {a.note && !compact && <div className="meta">{a.note}</div>}
      </div>
      <span className={'when ' + (w.soon ? 'soon' : '')}>{w.txt}</span>
    </button>
  );
}

export function ComingUp() {
  const now = Date.now(); const soon = S.appts.filter((a) => a.t >= startOfToday() && a.t <= now + 7 * DAY);
  if (!soon.length) return null;
  return (
    <section className="card"><div className="dayhead"><p className="eyebrow" style={{ margin: 0 }}>Coming up</p><button className="chip" style={{ padding: '5px 11px', fontSize: 12.5 }} onClick={() => go('calendar')}>Calendar</button></div>
      <div className="list">{soon.slice(0, 2).map((a) => <ApptRow key={a.id} a={a} compact />)}</div></section>
  );
}

async function addVaxPlan() {
  const plan = vaxPlan(S);
  for (const i of plan) await saveRow('appts', uid(), { kind: 'vaccination', title: i.title, t: i.t, place: '', note: i.note, remind: [1440, 60], planned: true });
  toast(`Added ${plan.length} expected vaccination dates`);
}

export default function Calendar() {
  const t0 = startOfToday(); const up = S.appts.filter((a) => a.t >= t0); const past = S.appts.filter((a) => a.t < t0).reverse();
  const months = {}; up.forEach((a) => { const k = new Date(a.t).toLocaleDateString([], { month: 'long', year: 'numeric' }); (months[k] = months[k] || []).push(a); });
  const hasVax = S.appts.some((a) => a.kind === 'vaccination'); const plan = vaxPlan(S);
  return <>
    <section className="card"><div className="row-between"><h2>Appointments</h2><button className="btn" onClick={() => openSheet('appt', null)}>Add appointment</button></div>
      <p style={{ margin: '8px 0 0' }}><button className="linkbtn" onClick={openReport}>Prepare a visit report</button> <span className="footnote">to show the doctor how things have gone since the last visit.</span></p>
      {up.length ? Object.entries(months).map(([m, list]) => <div key={m}><p className="eyebrow" style={{ margin: '16px 0 0' }}>{m}</p><div className="list">{list.map((a) => <ApptRow key={a.id} a={a} />)}</div></div>)
        : <p className="empty" style={{ marginTop: 10 }}>{S.loading ? 'Loading…' : 'No upcoming appointments. Add midwife visits, consultatiebureau check-ups and vaccinations here, and every family phone gets the reminders.'}</p>}
    </section>
    {!hasVax && <section className="card"><p className="eyebrow">Dutch vaccination schedule</p>
      {S.profile.birth ? <>
        <p style={{ margin: 0 }}>Add the expected dates from the Rijksvaccinatieprogramma, worked out from her birth date. They're marked as expected until you set the date from the GGD invitation, and reminders start once you do.</p>
        <div style={{ marginTop: 10 }}><button className="btn" disabled={!plan.length} onClick={addVaxPlan}>Add {plan.length} expected vaccination{plan.length === 1 ? '' : 's'}</button></div>
        <p className="footnote">RSV immunisation depends on the month she was born, and the GGD contacts you about it. Check the dates in your invitation or at rijksvaccinatieprogramma.nl.</p>
      </> : <p style={{ margin: 0 }}>Add her birth date under <b>Baby</b> to see the expected vaccination dates.</p>}
    </section>}
    {past.length > 0 && <section className="card"><button className="chip" onClick={() => { S.showPast = !S.showPast; render(); }}>{S.showPast ? 'Hide' : 'Show'} past appointments ({past.length})</button>
      {S.showPast && <div className="list" style={{ marginTop: 8 }}>{past.map((a) => <ApptRow key={a.id} a={a} />)}</div>}</section>}
  </>;
}
