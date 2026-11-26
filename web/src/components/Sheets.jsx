// Bottom sheets: log or edit an entry, set a reminder, add or edit an appointment.
import { useEffect, useState } from 'react';
import { HOUR, toLocalInput, dayKey, keyToMs, fmtTime, numOrNull, uid, download } from '../lib/util.js';
import { FEED, SIDE, DIAPER, COLORS, TSITE, NOTE_TAGS, KL, AK, AK_TITLE, REMIND_OPTS } from '../lib/constants.js';
import { nextSide, icsFor, currentSleep, SLEEP_WHERE, sleeps, fmtDurShort, pron } from '../lib/calc.js';
import { S, AUTH, closeSheet, saveRow, removeRow, guarded, toast, afterLog, saveRem, render, deleteFamily, openSheet, quickLog, startSleep, endSleep, wokeForFeed } from '../store.js';
import { Radios, Checks, ConfirmButton } from './ui.jsx';

const Close = () => <button type="button" className="x" aria-label="Close" onClick={closeSheet}>×</button>;
const Head = ({ children }) => <div className="hd"><h2>{children}</h2><Close /></div>;
const timeOf = (fd) => new Date(fd.get('t')).getTime() || Date.now();

// ---------- feed / note / pump / diaper / growth ----------
function EntrySheet({ kind, row }) {
  const editing = !!row;
  const defaults = {
    feed: { kind: 'breast', side: nextSide(S), t: Date.now() },
    note: { t: Date.now(), tags: [] },
    pump: { side: 'both', t: Date.now() },
    diaper: { kind: 'wet', t: Date.now() },
    growth: { t: Date.now() },
  };
  const r = row || defaults[kind];
  const [sub, setSub] = useState(r.kind); // feed type or diaper type: decides which fields show
  const show = (list) => list.split(' ').includes(sub);

  const submit = async (ev) => {
    ev.preventDefault(); const fd = new FormData(ev.currentTarget); const id = row ? row.id : uid();
    let coll = 'events', data;
    if (kind === 'feed') {
      const k = fd.get('kind'); data = { type: 'feed', kind: k, t: timeOf(fd), note: (fd.get('note') || '').trim() };
      if (k === 'breast') data.side = fd.get('side') || 'L';
      if (k === 'breast' || k === 'bottle' || k === 'formula') { const mn = numOrNull(fd.get('min')); if (mn != null) data.min = Math.round(mn); }
      if (k === 'bottle' || k === 'formula') { const ml = numOrNull(fd.get('ml')); if (ml != null) data.ml = Math.round(ml); }
    } else if (kind === 'note') {
      const text = String(fd.get('note') || '').trim(); const tags = fd.getAll('tags');
      if (!text && !tags.length) { toast('Write a note or pick how the baby is doing.'); return; }
      data = { type: 'note', tags, note: text, t: timeOf(fd) };
    } else if (kind === 'pump') {
      data = { type: 'pump', side: fd.get('side') || 'both', t: timeOf(fd), note: (fd.get('note') || '').trim() };
      const mn = numOrNull(fd.get('min')); if (mn != null) data.min = Math.round(mn);
      const ml = numOrNull(fd.get('ml')); if (ml != null) data.ml = Math.round(ml);
    } else if (kind === 'diaper') {
      const k = fd.get('kind'); data = { type: 'diaper', kind: k, t: timeOf(fd), note: (fd.get('note') || '').trim() };
      if (k !== 'wet' && fd.get('color')) data.color = fd.get('color');
      const tv = numOrNull(fd.get('temp'));
      if (tv != null) { if (tv < 30 || tv > 45) { toast('Enter the temperature in °C, between 30 and 45.'); return; } data.temp = Math.round(tv * 10) / 10; data.tempSite = fd.get('tempSite') || 'rectal'; }
    } else {
      coll = 'growth';
      const gIn = numOrNull(String(fd.get('kg') || '').replace(/[\s.](?=\d{3}\b)/g, ''));
      const kgv = gIn == null ? null : Math.round((gIn < 30 ? gIn * 1000 : gIn)) / 1000;
      data = { t: keyToMs(fd.get('date')), kg: kgv, cm: numOrNull(fd.get('cm')), head: numOrNull(fd.get('head')), note: (fd.get('note') || '').trim() };
      if (data.kg == null && data.cm == null && data.head == null) { toast('Enter at least one measurement.'); return; }
    }
    closeSheet();
    const msg = editing ? 'Saved' : { growth: 'Measurement saved', feed: 'Feed logged', pump: 'Pumping session logged', note: 'Note saved', diaper: 'Diaper logged' }[kind];
    const ok = await guarded(() => saveRow(coll, id, data), msg);
    if (ok && !editing && (kind === 'feed' || kind === 'pump')) await afterLog(kind, data.t);
    if (ok && !editing && kind === 'feed') wokeForFeed(data.t);
  };
  const del = () => { closeSheet(); guarded(() => removeRow(kind === 'growth' ? 'growth' : 'events', row.id), 'Deleted'); };
  const actions = (label, style, cls = 'btn') => (
    <div className="form-actions">{editing && <ConfirmButton className="btn danger" label="Delete" armedLabel="Tap again to delete" onConfirm={del} />}
      <button className={cls} type="submit" style={style}>{editing ? 'Save changes' : label}</button></div>
  );
  const timeField = (label = 'Time') => <label className="field">{label}<input name="t" type="datetime-local" defaultValue={toLocalInput(r.t)} required /></label>;
  const noteField = (ph, extra) => <label className="field">{extra ? 'Note' : 'Description'}<textarea name="note" placeholder={ph} defaultValue={r.note || ''} {...(extra || {})} /></label>;

  if (kind === 'feed') return (
    <form onSubmit={submit}><Head>{editing ? 'Edit feed' : 'Log a feed'}</Head>
      <div className="field">Type<Radios name="kind" opts={FEED} value={r.kind} onChange={setSub} /></div>
      <div className="field" hidden={!show('breast')}>Side<Radios name="side" opts={SIDE} value={r.side || 'L'} /></div>
      <div className="row2">
        <label className="field" hidden={!show('breast bottle formula')}>Duration (min)<input name="min" type="number" inputMode="numeric" min="0" max="240" defaultValue={r.min ?? ''} placeholder="15" /></label>
        <label className="field" hidden={!show('bottle formula')}>Amount (ml)<input name="ml" type="number" inputMode="numeric" min="0" max="500" defaultValue={r.ml ?? ''} placeholder="90" /></label>
        {timeField()}</div>
      {noteField('How did it go? e.g. latched well, sleepy at the end, small spit-up')}
      {actions('Save feed', { background: 'var(--feed)' })}
    </form>
  );
  if (kind === 'note') return (
    <form onSubmit={submit}><Head>{editing ? 'Edit note' : 'Add a note'}</Head>
      <div className="field">How is {S.profile.name || 'the baby'} doing? (optional)<Checks name="tags" opts={Object.entries(NOTE_TAGS)} values={r.tags} /></div>
      {noteField('e.g. Very alert after the bath, first real smile at 10:00. Fussy in the evening, settled after a walk.', { style: { minHeight: 120 }, maxLength: 2000 })}
      {timeField()}
      {actions('Save note', { background: 'var(--growth)' })}
    </form>
  );
  if (kind === 'pump') return (
    <form onSubmit={submit}><Head>{editing ? 'Edit pumping session' : 'Log a pumping session'}</Head>
      <div className="field">Side<Radios name="side" opts={SIDE} value={r.side || 'both'} /></div>
      <div className="row2">
        <label className="field">Duration (min)<input name="min" type="number" inputMode="numeric" min="0" max="240" defaultValue={r.min ?? ''} placeholder="15" /></label>
        <label className="field">Amount (ml)<input name="ml" type="number" inputMode="numeric" min="0" max="1000" defaultValue={r.ml ?? ''} placeholder="120" /></label>
        {timeField('Start time')}</div>
      {noteField('e.g. 70 ml left, 50 ml right, stored in the fridge')}
      {actions('Save session', { background: 'var(--pump)' })}
    </form>
  );
  if (kind === 'diaper') return (
    <form onSubmit={submit}><Head>{editing ? 'Edit diaper' : 'Log a diaper'}</Head>
      <div className="field">Type<Radios name="kind" opts={DIAPER} value={r.kind} onChange={setSub} /></div>
      <div className="field" hidden={!show('dirty both')}>Stool colour<Radios name="color" opts={COLORS.map((c) => [c, c])} value={r.color || ''} /></div>
      <div className="row2">
        <label className="field">Temperature (°C, optional)<input name="temp" type="text" inputMode="decimal" defaultValue={r.temp != null ? (+r.temp).toFixed(1) : ''} placeholder="37.0" /></label>
        {timeField()}</div>
      <div className="field">Measured<Radios name="tempSite" opts={TSITE} value={r.tempSite || 'rectal'} /></div>
      {noteField('e.g. very full, seedy texture, slight redness')}
      {actions('Save diaper', { background: 'var(--wet)' })}
    </form>
  );
  return (
    <form onSubmit={submit}><Head>{editing ? 'Edit measurement' : 'Add measurement'}</Head>
      <label className="field">Date<input name="date" type="date" defaultValue={dayKey(r.t)} required /></label>
      <div className="row2">
        <label className="field">Weight (g)<input name="kg" type="text" inputMode="numeric" defaultValue={r.kg != null ? Math.round(r.kg * 1000) : ''} placeholder="4250" /></label>
        <label className="field">Length (cm)<input name="cm" type="text" inputMode="decimal" defaultValue={r.cm ?? ''} placeholder="55.5" /></label>
        <label className="field">Head (cm)<input name="head" type="text" inputMode="decimal" defaultValue={r.head ?? ''} placeholder="38" /></label></div>
      {noteField('e.g. weighed at the consultatiebureau, after a feed', {})}
      {actions('Save measurement', undefined, 'btn green')}
    </form>
  );
}

// ---------- reminder after a feed or pumping session ----------
const REM_OPTS = [['2', '2 h'], ['2.5', '2½ h'], ['3', '3 h'], ['4', '4 h'], ['custom', 'Custom'], ['time', 'At a time']];
function RemSheet({ kind, base }) {
  base = base || Date.now(); const h = S.rem[kind].hours;
  const [choice, setChoice] = useState(REM_OPTS.some((o) => o[0] === String(h)) ? String(h) : 'custom');
  const [custom, setCustom] = useState(String(h));
  const [at, setAt] = useState(toLocalInput(Math.max(base + h * HOUR, Date.now() + 5 * 60e3)).slice(11, 16));
  const [auto, setAuto] = useState(S.rem[kind].auto);
  const atMs = () => { if (!/^\d{2}:\d{2}$/.test(at)) return null; const [H, M] = at.split(':').map(Number); const d = new Date(); d.setHours(H, M, 0, 0); if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); return d.getTime(); };
  const hours = () => { const n = choice === 'custom' ? numOrNull(custom) : parseFloat(choice); return (n != null && n >= 0.25 && n <= 24) ? n : null; };
  let preview;
  if (choice === 'time') { const a = atMs(); preview = a ? `Reminder ${dayKey(a) === dayKey(Date.now()) ? 'today' : 'tomorrow'} at ${fmtTime(a)}` : 'Pick a time.'; }
  else { const hrs = hours(); preview = hrs ? `Reminder at ${fmtTime(base + hrs * HOUR)}` : 'Enter between 0.25 and 24 hours.'; }
  const submit = async (ev) => {
    ev.preventDefault();
    if (choice === 'time') {
      const a = atMs(); if (!a) { toast('Pick a time for the reminder.'); return; }
      S.rem.due[kind] = a; closeSheet(); await guarded(saveRem, `Reminder set for ${dayKey(a) === dayKey(Date.now()) ? '' : 'tomorrow '}${fmtTime(a)}`); render(); return;
    }
    const hrs = hours(); if (!hrs) { toast('Enter between 0.25 and 24 hours.'); return; }
    S.rem[kind].hours = hrs; S.rem[kind].auto = auto; S.rem.due[kind] = base + hrs * HOUR; closeSheet();
    await guarded(saveRem, `Reminder set for ${fmtTime(S.rem.due[kind])}`); render();
  };
  return (
    <form onSubmit={submit}><Head>Remind me about the next {KL[kind]}?</Head>
      <div className="field">Counting from {fmtTime(base)}<Radios name="hrs" opts={REM_OPTS} value={choice} onChange={setChoice} /></div>
      <label className="field" hidden={choice !== 'custom'}>Hours from start (e.g. 3.5)<input type="text" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} /></label>
      <label className="field" hidden={choice !== 'time'}>Remind me at<input type="time" value={at} onChange={(e) => setAt(e.target.value)} /></label>
      <label className="check" hidden={choice === 'time'}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />Set this automatically after every {KL[kind]}</label>
      <p className="footnote" style={{ margin: 0 }}>{preview}</p>
      <div className="form-actions"><button type="button" className="btn ghost" onClick={closeSheet}>No reminder</button><button className="btn" type="submit" style={{ background: `var(--${kind === 'feed' ? 'feed' : 'pump'})` }}>Set reminder</button></div>
    </form>
  );
}

// ---------- appointment ----------
function apptFromForm(f) {
  const fd = new FormData(f); const t = new Date(fd.get('date') + 'T' + (fd.get('time') || '09:00')).getTime();
  return { kind: fd.get('kind') || 'other', title: String(fd.get('title') || '').trim(), t, place: String(fd.get('place') || '').trim(), note: String(fd.get('note') || '').trim(), remind: fd.getAll('remind').map(Number).sort((a, b) => b - a) };
}
function ApptSheet({ row }) {
  const editing = !!(row && row.id); const r = row || { kind: 'cb', remind: [1440, 60] };
  const d = r.t ? toLocalInput(r.t) : ''; const date = d.slice(0, 10), time = d ? d.slice(11, 16) : '09:00';
  const [title, setTitle] = useState(r.title || AK_TITLE[r.kind || 'cb']);
  const [kind, setKind] = useState(r.kind || 'cb');
  const changeKind = (k) => { if (!title || title === AK_TITLE[kind]) setTitle(AK_TITLE[k]); setKind(k); };
  const submit = async (ev) => {
    ev.preventDefault(); const a = apptFromForm(ev.currentTarget);
    if (!isFinite(a.t)) { toast('Pick a date and time.'); return; }
    if (!a.title) a.title = AK_TITLE[a.kind] || 'Appointment';
    if (r.planned && a.t === r.t) a.planned = true;
    const id = editing ? r.id : uid(); closeSheet();
    await guarded(() => saveRow('appts', id, a), editing ? 'Appointment saved' : `Added for ${new Date(a.t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(a.t)}`);
  };
  const ics = (ev) => { const a = { ...apptFromForm(ev.currentTarget.form), id: r.id }; download((a.title || 'appointment').replace(/[^\w -]/g, '').slice(0, 40) + '.ics', icsFor(a), 'text/calendar'); };
  return (
    <form onSubmit={submit}><Head>{editing ? 'Edit appointment' : 'Add appointment'}</Head>
      {r.planned && <p className="notice" style={{ margin: 0 }}>This is an expected date from the vaccination schedule. Change the date and time to match the GGD invitation, and reminders will start.</p>}
      <div className="field">Type<Radios name="kind" opts={AK} value={kind} onChange={changeKind} /></div>
      <label className="field">Title<input name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 8-week check-up" required maxLength={80} /></label>
      <div className="row2"><label className="field">Date<input name="date" type="date" defaultValue={date} required /></label>
        <label className="field">Time<input name="time" type="time" defaultValue={time} required /></label></div>
      <label className="field">Place<input name="place" defaultValue={r.place || ''} placeholder="e.g. Consultatiebureau Centrum" maxLength={100} /></label>
      <label className="field">Notes<textarea name="note" placeholder="Questions to ask, things to bring" defaultValue={r.note || ''} /></label>
      <div className="field">Remind the family<Checks name="remind" opts={REMIND_OPTS} values={r.remind} /></div>
      <div className="form-actions">{editing && <>
        <ConfirmButton className="btn danger" label="Delete" armedLabel="Tap again to delete" onConfirm={() => { closeSheet(); guarded(() => removeRow('appts', r.id), 'Appointment deleted'); }} />
        <button type="button" className="btn ghost" onClick={ics}>Add to phone calendar</button></>}
        <button className="btn" type="submit">{editing ? 'Save changes' : 'Save appointment'}</button></div>
    </form>
  );
}

// ---------- delete the whole family log ----------
function DeleteFamilySheet() {
  const [txt, setTxt] = useState(''); const [busy, setBusy] = useState(false);
  const ok = txt.trim().toLowerCase() === 'delete';
  return (
    <form onSubmit={async (ev) => { ev.preventDefault(); if (!ok) return; setBusy(true); await deleteFamily(); setBusy(false); }}><Head>Delete the family log?</Head>
      <p style={{ margin: 0 }}>This deletes <b>{AUTH.family || 'your family log'}</b> and everything in it for everyone: all entries, measurements, appointments and reminders. Every phone is signed out. It can't be undone.</p>
      <p className="footnote" style={{ margin: 0 }}>Want a copy first? Close this and use <b>Export data</b>.</p>
      <label className="field">Type delete to confirm<input value={txt} onChange={(e) => setTxt(e.target.value)} autoComplete="off" autoCapitalize="off" /></label>
      <div className="form-actions"><button type="button" className="btn ghost" onClick={closeSheet}>Keep the log</button><button className="btn" type="submit" disabled={!ok || busy} style={{ background: 'var(--danger)' }}>{busy ? 'Deleting…' : 'Delete everything'}</button></div>
    </form>
  );
}

// ---------- sleep ----------
function SleepSheet({ row }) {
  const editing = !!row;
  const r = row || { t: Date.now(), end: null, where: 'crib' };
  const [still, setStill] = useState(r.end == null);
  const { she } = pron(S);
  const submit = async (ev) => {
    ev.preventDefault(); const fd = new FormData(ev.currentTarget);
    const t = new Date(fd.get('t')).getTime();
    const end = still ? null : new Date(fd.get('end')).getTime();
    if (!isFinite(t)) { toast(`Pick when ${she} fell asleep.`); return; }
    if (!still && !isFinite(end)) { toast(`Pick when ${she} woke up, or switch on "still sleeping".`); return; }
    if (!still && end <= t) { toast('Waking up has to be after falling asleep.'); return; }
    if (!still && end - t > 24 * HOUR) { toast('A sleep can be at most 24 hours. Check the dates.'); return; }
    if (t > Date.now() + 5 * 60000) { toast("That's in the future. Check the time."); return; }
    const id = editing ? r.id : uid(); const stop = still ? Date.now() : end;
    const clash = sleeps(S).find((e) => e.id !== id && e.t < stop && (e.end == null ? Date.now() : e.end) > t);
    if (clash) { toast(`This overlaps another sleep (${fmtTime(clash.t)}${clash.end ? '–' + fmtTime(clash.end) : ', still running'}). Change the times or that sleep.`); return; }
    if (still && currentSleep(S) && currentSleep(S).id !== id) { toast(`${she === 'he' ? 'He' : 'She'} is already marked as asleep.`); return; }
    const data = { type: 'sleep', t, end, where: fd.get('where') || 'crib', note: String(fd.get('note') || '').trim() };
    closeSheet();
    await guarded(() => saveRow('events', id, data), editing ? 'Saved' : still ? `Asleep since ${fmtTime(t)}` : `Sleep of ${fmtDurShort(end - t)} logged`);
  };
  const del = () => { closeSheet(); guarded(() => removeRow('events', r.id), 'Deleted'); };
  return (
    <form onSubmit={submit}><Head>{editing ? 'Edit sleep' : 'Log sleep'}</Head>
      <div className="row2">
        <label className="field">Fell asleep<input name="t" type="datetime-local" defaultValue={toLocalInput(r.t)} required /></label>
        {still ? <div className="field">Woke up<span className="still">Still sleeping</span></div>
          : <label className="field">Woke up<input name="end" type="datetime-local" defaultValue={toLocalInput(r.end || Date.now())} required /></label>}
      </div>
      <label className="check"><input type="checkbox" checked={still} onChange={(e) => setStill(e.target.checked)} />{she === 'he' ? 'He' : 'She'}'s still sleeping</label>
      <div className="field">Where<Radios name="where" opts={SLEEP_WHERE} value={r.where || 'crib'} /></div>
      <label className="field">Note (optional)<textarea name="note" placeholder="e.g. fell asleep after the feed" defaultValue={r.note || ''} /></label>
      <div className="form-actions">{editing && <ConfirmButton className="btn danger" label="Delete" armedLabel="Tap again to delete" onConfirm={del} />}
        <button className="btn" type="submit" style={{ background: 'var(--sleep)' }}>{editing ? 'Save changes' : 'Save sleep'}</button></div>
    </form>
  );
}

// ---------- the + button: what do you want to log? ----------
const TILE_ICON = {
  feed: <path d="M9 3h6M10 3v3l-2 3v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V9l-2-3V3M8 12h8" />,
  diaper: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  sleep: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  pump: <><circle cx="12" cy="13" r="6" /><path d="M12 7V3M9 3h6" /></>,
  note: <><path d="M5 4h10l4 4v12H5z" /><path d="M9 12h6M9 16h4" /></>,
  growth: <path d="M4 17c4-1 6-4 8-8s4-5 8-5" />,
};
export const TileIcon = ({ k }) => <svg viewBox="0 0 24 24" aria-hidden="true">{TILE_ICON[k]}</svg>;
function LogMenu() {
  const asleep = currentSleep(S);
  const pick = (k) => { if (k === 'sleep' && !asleep) { openSheet('sleep'); return; } if (k === 'sleep') { openSheet('sleep', asleep); return; } openSheet(k); };
  const now = (fn) => { closeSheet(); fn(); };
  return (
    <div className="logmenu-wrap">
      <Head>What do you want to log?</Head>
      <div className="logmenu" style={{ marginTop: 14 }}>
        {[['feed', 'Feed'], ['diaper', 'Diaper'], ['sleep', 'Sleep'], ['pump', 'Pump'], ['note', 'Note'], ['growth', 'Growth']].map(([k, l]) =>
          <button key={k} type="button" className={'logtile ' + k} onClick={() => pick(k)}><TileIcon k={k} />{l}</button>)}
      </div>
      <p className="sub-label" style={{ marginTop: 18 }}>One tap, right now</p>
      <div className="quick">
        {asleep ? <button className="chip sleepchip" onClick={() => now(() => endSleep())}><span className="dot c-sleep"></span>Woke up now</button>
          : <button className="chip sleepchip" onClick={() => now(() => startSleep())}><span className="dot c-sleep"></span>Asleep now</button>}
        <button className="chip" onClick={() => now(() => quickLog('wet'))}><span className="dot c-wet"></span>Wet diaper</button>
        <button className="chip" onClick={() => now(() => quickLog('dirty'))}><span className="dot c-dirty"></span>Dirty diaper</button>
        <button className="chip" onClick={() => now(() => quickLog('both'))}><span className="dot c-both"></span>Wet + dirty</button>
        <button className="chip" onClick={() => now(() => quickLog('dry'))}><span className="dot c-dry"></span>Dry diaper</button>
        <button className="chip" onClick={() => now(() => quickLog('breast'))}><span className="dot c-feed"></span>{SIDE[nextSide(S)]} breast</button>
      </div>
    </div>
  );
}

export default function SheetHost() {
  const sh = S.sheet;
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') closeSheet(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, []);
  if (!sh) return null;
  const body = sh.kind === 'rem' ? <RemSheet kind={sh.row.kind} base={sh.row.base} /> : sh.kind === 'appt' ? <ApptSheet row={sh.row} /> : sh.kind === 'deleteFamily' ? <DeleteFamilySheet /> : sh.kind === 'logmenu' ? <LogMenu /> : sh.kind === 'sleep' ? <SleepSheet row={sh.row} /> : <EntrySheet kind={sh.kind} row={sh.row} />;
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) closeSheet(); }}>
      <div className="sheet" role="dialog" aria-modal="true" key={sh.key}>{body}</div>
    </div>
  );
}
