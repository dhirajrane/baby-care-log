// Today tab: sleeping now, last feed / diaper / sleep, today's totals, appointments, next feed, reminders, sleep,
// notes and today's entries. Logging itself is behind the + button (Sheets.jsx, LogMenu).
import { fmtTime, fmtTemp, ago, dayKey, keyToMs, DAY } from '../lib/util.js';
import { SIDE, DIAPER, TSITE, FEED } from '../lib/constants.js';
import { feeds, diapers, temps, nextSide, dayTotals, evTitle, sleepStats, fmtDurShort, currentSleep, awakeFor } from '../lib/calc.js';
import { S, go, openSheet } from '../store.js';
import { Item, NoteItem } from './ui.jsx';
import { ComingUp } from './Calendar.jsx';
import SuggestCard from './SuggestCard.jsx';
import { RemCard } from './Reminders.jsx';
import { SleepingNow, Sleep24 } from './Sleep.jsx';

const short = (ms) => ago(ms).replace(' ago', '');

export default function Today() {
  const tk = dayKey(Date.now()); const today = S.events.filter((e) => dayKey(e.t) === tk); const t = dayTotals(today);
  const last = feeds(S)[0]; const ns = nextSide(S);
  const lastD = diapers(S)[0]; const lastP = S.events.find((e) => e.type === 'pump'); const lt = temps(S)[0];
  const notes = today.filter((e) => e.type === 'note'); const entries = today.filter((e) => e.type !== 'note');
  const sl = sleepStats(S, keyToMs(tk), keyToMs(tk) + DAY); const aw = awakeFor(S);
  return <>
    {!S.profile.name && !S.loading && <section className="card setup"><h2>Start with your baby's name and birth date</h2><p className="sub" style={{ margin: 0, color: 'var(--muted)' }}>The age and the growth reference curves use these.</p><div><button className="btn" onClick={() => go('baby')}>Add details</button></div></section>}
    <SleepingNow />
    <div className="tiles3">
      <button className="tile feed" onClick={() => last ? openSheet('feed', last) : openSheet('feed')}>
        <div className="tl">Last feed</div><b className="num">{last ? short(last.t) : '–'}</b><span>{last ? last.ml ? `${last.ml} ml ${last.kind === 'formula' ? 'formula' : 'bottle'}` : (FEED[last.kind] || 'feed').toLowerCase() : 'tap + to log'}</span></button>
      <button className="tile diaper" onClick={() => lastD ? openSheet('diaper', lastD) : openSheet('diaper')}>
        <div className="tl">Last diaper</div><b className="num">{lastD ? short(lastD.t) : '–'}</b><span>{lastD ? DIAPER[lastD.kind].toLowerCase() : 'none yet'}</span></button>
      <button className="tile sleep" onClick={() => go('history')}>
        <div className="tl">Sleep today</div><b className="num">{sl.total ? fmtDurShort(sl.total) : '–'}</b><span>{currentSleep(S) ? 'asleep now' : aw != null ? `awake ${fmtDurShort(aw)}` : `${sl.naps} nap${sl.naps === 1 ? '' : 's'}`}</span></button>
    </div>
    <section className="card">
      <div className="dayhead"><h2>Today so far</h2>{last && feeds(S).some((f) => f.kind === 'breast') && <span className="pill">Next breast: {SIDE[ns]}</span>}</div>
      <div className="stats" style={{ marginTop: 10 }}>
        <div className="stat feed"><b className="num">{t.feeds}</b><span>feeds</span></div>
        <div className="stat feed"><b className="num">{t.ml}</b><span>ml</span></div>
        <div className="stat wet"><b className="num">{t.wet}</b><span>wet</span></div>
        <div className="stat dirty"><b className="num">{t.dirty}</b><span>dirty</span></div>
      </div>
      {last && <p className="footnote">Last feed {fmtTime(last.t)} · {evTitle(last)}</p>}
      {lt && <p className="footnote">Last temperature {fmtTemp(lt.temp)} · {ago(lt.t)}{lt.tempSite && lt.tempSite !== 'rectal' ? ' · ' + TSITE[lt.tempSite].toLowerCase() : ''}</p>}
      {lastP && <p className="footnote">Last pumped {ago(lastP.t)}{t.pumps ? ` · ${t.pumps} today, ${t.pumped} ml` : ''}</p>}
      {!last && !S.loading && <p className="footnote">Tap the <b>+</b> button at the bottom after the next feed and it will show here.</p>}
    </section>
    <ComingUp />
    <SuggestCard />
    <RemCard />
    <Sleep24 />
    <section className="card"><div className="dayhead"><h2>Notes today</h2><button className="chip" onClick={() => openSheet('note')}>+ Add note</button></div>
      {notes.length ? notes.map((e) => <NoteItem key={e.id} e={e} />) : <p className="empty">How is {S.profile.name || 'the baby'} doing today? Add anything worth remembering: mood, sleep, a first smile, something to ask the consultatiebureau.</p>}
    </section>
    <section className="card"><div className="dayhead"><h2>Today</h2><span className="tot num">{entries.length} entries</span></div>
      <div className="list">{entries.length ? entries.map((e) => <Item key={e.id} e={e} />) : <p className="empty">{S.loading ? 'Loading the log…' : 'Nothing logged today yet.'}</p>}</div>
    </section>
  </>;
}
