// Today tab: last feed, today's totals, one-tap logging, suggestion, reminders, notes and today's entries.
import { fmtTime, fmtTemp, ago, dayKey, uid } from '../lib/util.js';
import { SIDE, DIAPER, TSITE } from '../lib/constants.js';
import { feeds, diapers, temps, nextSide, dayTotals, evTitle } from '../lib/calc.js';
import { S, go, openSheet, saveRow, removeRow, guarded, afterLog } from '../store.js';
import { Item, NoteItem } from './ui.jsx';
import { ComingUp } from './Calendar.jsx';
import SuggestCard from './SuggestCard.jsx';
import { RemCard } from './Reminders.jsx';

async function quickLog(q) {
  const id = uid();
  const data = q === 'breast' ? { type: 'feed', kind: 'breast', side: nextSide(S), t: Date.now(), note: '' } : { type: 'diaper', kind: q, t: Date.now(), note: '' };
  const ok = await guarded(() => saveRow('events', id, data), q === 'breast' ? `${SIDE[data.side]} breast feed logged` : `${DIAPER[q]} diaper logged`, () => guarded(() => removeRow('events', id), 'Removed'));
  if (ok && q === 'breast') afterLog('feed', data.t);
}

export default function Today() {
  const tk = dayKey(Date.now()); const today = S.events.filter((e) => dayKey(e.t) === tk); const t = dayTotals(today);
  const last = feeds(S)[0]; const ns = nextSide(S);
  const lastD = diapers(S)[0]; const lastP = S.events.find((e) => e.type === 'pump'); const lt = temps(S)[0];
  const notes = today.filter((e) => e.type === 'note'); const entries = today.filter((e) => e.type !== 'note');
  return <>
    {!S.profile.name && !S.loading && <section className="card setup"><h2>Start with her name and birth date</h2><p className="sub" style={{ margin: 0, color: 'var(--muted)' }}>Her age and the growth reference curves use these.</p><div><button className="btn" onClick={() => go('baby')}>Add details</button></div></section>}
    <section className="card">
      {last ? <div className="status"><p className="eyebrow">Last feed</p><div className="big num">{ago(last.t)}</div><div className="sub">{fmtTime(last.t)} · {evTitle(last)}</div>
        {feeds(S).some((f) => f.kind === 'breast') && <div><span className="pill">Next breast: {SIDE[ns]}</span></div>}</div>
        : <div className="status"><p className="eyebrow">Last feed</p><div className="big">No feeds yet</div><div className="sub">Tap <b>+ Feed</b> at the bottom after the next feed and it will show here.</div></div>}
      <div className="stats" style={{ marginTop: 14 }}>
        <div className="stat feed"><b className="num">{t.feeds}</b><span>feeds today</span></div>
        <div className="stat feed"><b className="num">{t.ml}</b><span>ml today</span></div>
        <div className="stat wet"><b className="num">{t.wet}</b><span>wet</span></div>
        <div className="stat dirty"><b className="num">{t.dirty}</b><span>dirty</span></div>
      </div>
      {lt && <p className="footnote">Last temperature {fmtTemp(lt.temp)} · {ago(lt.t)}{lt.tempSite && lt.tempSite !== 'rectal' ? ' · ' + TSITE[lt.tempSite].toLowerCase() : ''}</p>}
      {lastD && <p className="footnote">Last diaper {ago(lastD.t)} · {DIAPER[lastD.kind]}</p>}
      {lastP && <p className="footnote">Last pumped {ago(lastP.t)}{t.pumps ? ` · ${t.pumps} today, ${t.pumped} ml` : ''}</p>}
    </section>
    <section className="quick" aria-label="One-tap logging">
      <button className="chip" onClick={() => quickLog('wet')}><span className="dot c-wet"></span>Wet now</button>
      <button className="chip" onClick={() => quickLog('dirty')}><span className="dot c-dirty"></span>Dirty now</button>
      <button className="chip" onClick={() => quickLog('both')}><span className="dot c-both"></span>Both now</button>
      <button className="chip" onClick={() => quickLog('breast')}><span className="dot c-feed"></span>{SIDE[ns]} breast now</button>
    </section>
    <ComingUp />
    <SuggestCard />
    <RemCard />
    <section className="card"><div className="dayhead"><h2>Notes today</h2><button className="chip" onClick={() => openSheet('note')}>+ Add note</button></div>
      {notes.length ? notes.map((e) => <NoteItem key={e.id} e={e} />) : <p className="empty">How is {S.profile.name || 'the baby'} doing today? Add anything worth remembering: mood, sleep, a first smile, something to ask the consultatiebureau.</p>}
    </section>
    <section className="card"><div className="dayhead"><h2>Today</h2><span className="tot num">{entries.length} entries</span></div>
      <div className="list">{entries.length ? entries.map((e) => <Item key={e.id} e={e} />) : <p className="empty">{S.loading ? 'Loading the log…' : 'Nothing logged today yet.'}</p>}</div>
    </section>
  </>;
}
