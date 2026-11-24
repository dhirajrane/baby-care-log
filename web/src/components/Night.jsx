// Night view of Today: dim colours, big buttons, only what matters at 3 a.m.
import { fmtTime, ago, DAY } from '../lib/util.js';
import { SIDE } from '../lib/constants.js';
import { feeds, nextSide, currentSleep, sleepStats, fmtDurShort, nightWindow, pron } from '../lib/calc.js';
import { S, openSheet, startSleep, endSleep, showFullToday, setNightPref } from '../store.js';
import { TileIcon } from './Sheets.jsx';

// Start of the current (or last) night window.
function nightStartedAt() {
  const w = nightWindow(S); const d = new Date(); d.setHours(0, 0, 0, 0); d.setMinutes(w.start);
  if (d.getTime() > Date.now()) d.setTime(d.getTime() - DAY);
  return d.getTime();
}

export default function NightToday() {
  const last = feeds(S)[0]; const cur = currentSleep(S); const { She } = pron(S);
  const st = sleepStats(S, nightStartedAt(), Date.now());
  const pumps = S.events.some((e) => e.type === 'pump');
  return <>
    <section className="card night-last">
      <p className="eyebrow">Last feed</p>
      <div className="big num">{last ? ago(last.t) : 'No feeds yet'}</div>
      {last && <div className="sub">{fmtTime(last.t)}{last.ml ? ` · ${last.ml} ml` : ''}{feeds(S).some((f) => f.kind === 'breast') ? ` · next breast: ${SIDE[nextSide(S)].toLowerCase()}` : ''}</div>}
    </section>
    {cur && <section className="card night-last"><p className="eyebrow">{S.profile.name || She} is sleeping</p><div className="big num">{fmtDurShort(Date.now() - cur.t)}</div><div className="sub">since {fmtTime(cur.t)}</div></section>}
    <div className="night-grid">
      <button className="night-btn" onClick={() => openSheet('feed')}><TileIcon k="feed" />Feed</button>
      <button className="night-btn" onClick={() => openSheet('diaper')}><TileIcon k="diaper" />Diaper</button>
      {cur ? <button className="night-btn" onClick={() => endSleep()}><TileIcon k="sleep" />Woke up</button>
        : <button className="night-btn" onClick={() => startSleep()}><TileIcon k="sleep" />Asleep now</button>}
      {pumps ? <button className="night-btn" onClick={() => openSheet('pump')}><TileIcon k="pump" />Pump</button>
        : <button className="night-btn" onClick={() => openSheet('note')}><TileIcon k="note" />Note</button>}
    </div>
    {st.total >= 60000 && <section className="card"><p className="eyebrow">Slept tonight</p><div style={{ fontSize: 20, fontWeight: 800 }}>{fmtDurShort(st.total)}{st.wakings ? ` · woke up ${st.wakings === 1 ? 'once' : st.wakings + ' times'}` : ''}</div></section>}
    <div className="rem-btns" style={{ justifyContent: 'center' }}>
      <button className="chip" onClick={() => showFullToday(true)}>Show all of today</button>
      {S.nightPref !== 'off' && <button className="chip" onClick={() => setNightPref('off')}>Turn off night view</button>}
    </div>
    <p className="footnote" style={{ textAlign: 'center' }}>Night view turns on by itself between 22:00 and 06:00. Change it under Baby → Night view.</p>
  </>;
}
