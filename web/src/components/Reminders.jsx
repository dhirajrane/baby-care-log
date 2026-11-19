// Reminders card on Today, and the overdue alerts and fever banner above every screen.
import { HOUR, fmtTime, fmtIn, fmtTemp } from '../lib/util.js';
import { KL } from '../lib/constants.js';
import { temps, ageMonths } from '../lib/calc.js';
import { S, openSheet, snooze, setDue, toggleWake, seeFever } from '../store.js';

function openRem(kind) {
  const last = S.events.find((e) => e.type === kind);
  openSheet('rem', { kind, base: last && last.t > Date.now() - 12 * HOUR ? last.t : Date.now() });
}

function RemRow({ kind }) {
  const due = S.rem.due[kind]; const label = kind === 'feed' ? 'Next feed' : 'Next pumping';
  if (!due) return (
    <div className="rem"><div><b>{label}</b><div className="sub">{S.rem[kind].auto ? `Set automatically, every ${S.rem[kind].hours} h` : 'No reminder set'}</div></div>
      <div className="rem-btns"><button className="chip" onClick={() => openRem(kind)}>Set reminder</button></div></div>
  );
  const over = due <= Date.now();
  return (
    <div className={'rem ' + (over ? 'over' : '')}><div><b>{label} · {fmtTime(due)}</b><div className="sub">{fmtIn(due)}</div></div>
      <div className="rem-btns"><button className="chip" onClick={() => snooze(kind)}>+15 min</button><button className="chip" onClick={() => openRem(kind)}>Change</button><button className="chip" onClick={() => setDue(kind, null, 'Reminder cleared')}>Clear</button></div></div>
  );
}

export function RemCard() {
  const showPump = S.rem.pump.auto || S.rem.due.pump || S.events.some((e) => e.type === 'pump');
  return (
    <section className="card"><p className="eyebrow">Reminders</p><RemRow kind="feed" />{showPump && <RemRow kind="pump" />}
      <p className="footnote">Reminders notify every family phone that has notifications on (Baby tab). The app also chimes while it is open.
        {'wakeLock' in navigator && <> <button className="chip" style={{ marginTop: 6 }} onClick={toggleWake}>{S.wake ? 'Screen kept awake · turn off' : 'Keep screen awake'}</button></>}</p>
    </section>
  );
}

export function Notices() {
  const overdue = ['feed', 'pump'].filter((k) => S.rem.due[k] && S.rem.due[k] <= Date.now());
  const lt = temps(S)[0];
  let fever = null;
  if (lt && lt.temp >= 38 && Date.now() - lt.t < 12 * HOUR && !S.feverSeen.has(lt.id)) {
    const am = ageMonths(S);
    fever = (
      <div className="alert hot" role="alert"><div><b>{fmtTemp(lt.temp)} at {fmtTime(lt.t)}</b>
        <div className="sub">{am != null && am < 3 ? 'For a baby younger than 3 months, 38 °C or higher means a doctor should see her straight away. Call your huisarts, or the huisartsenpost outside office hours.' : '38 °C or higher counts as fever. Call your huisarts if you are worried, or the huisartsenpost outside office hours.'}</div></div>
        <div className="rem-btns"><button className="chip" onClick={() => seeFever(lt.id)}>OK</button></div></div>
    );
  }
  return (
    <div id="notice">
      {fever}
      {overdue.map((k) => (
        <div key={k} className={'alert ' + k} role="alert"><div><b>Time for the next {KL[k]}</b><div className="sub">Reminder was set for {fmtTime(S.rem.due[k])}</div></div>
          <div className="rem-btns"><button className="chip" onClick={() => openSheet(k)}>Log {k === 'feed' ? 'feed' : 'pumping'}</button><button className="chip" onClick={() => snooze(k)}>+15 min</button><button className="chip" onClick={() => setDue(k, null, 'Reminder cleared')}>Dismiss</button></div></div>
      ))}
      {!S.online && <div className="notice">Offline. New entries are kept on this phone{S.outboxSize ? ` (${S.outboxSize} waiting)` : ''} and sync when you're back online.</div>}
    </div>
  );
}
