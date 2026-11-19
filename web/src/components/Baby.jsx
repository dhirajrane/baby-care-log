// Baby tab: profile, automatic reminders, notifications on this phone, and family/account settings.
import { HOUR, numOrNull, dayKey, download } from '../lib/util.js';
import { S, AUTH, PUSH, render, openHelp, saveProfile, saveRem, guarded, toast, api, resync, signOut, pushSupport, enablePush, disablePush, testPush } from '../store.js';
import { Radios, ConfirmButton } from './ui.jsx';

function ProfileCard() {
  const p = S.profile;
  const submit = (ev) => {
    ev.preventDefault(); const fd = new FormData(ev.currentTarget);
    guarded(() => saveProfile({ name: (fd.get('name') || '').trim(), birth: fd.get('birth') || '', sex: fd.get('sex') || 'girl', mlPerKg: Math.min(200, Math.max(100, numOrNull(fd.get('mlPerKg')) || 150)) }), 'Details saved');
  };
  // key: refill the form when the profile arrives from the server
  return (
    <section className="card"><form className="setup" onSubmit={submit} key={JSON.stringify(p)}>
      <h2>About her</h2>
      <label className="field">Name<input name="name" defaultValue={p.name || ''} placeholder="Baby's name" autoComplete="off" /></label>
      <label className="field">Birth date<input name="birth" type="date" defaultValue={p.birth || ''} /></label>
      <label className="field">Daily milk guide (ml per kg body weight)<input name="mlPerKg" type="number" inputMode="numeric" min="100" max="200" step="5" defaultValue={p.mlPerKg || 150} /></label>
      <p className="footnote" style={{ margin: '-6px 0 0' }}>Used for the next-feed amount. Dutch guidance is about 150. Change it only if your consultatiebureau advised a different amount.</p>
      <div className="field">Reference curves<Radios name="sex" opts={[['girl', 'Girl'], ['boy', 'Boy']]} value={p.sex || 'girl'} /></div>
      <div><button className="btn" type="submit">Save details</button></div>
    </form></section>
  );
}

function AutoRemCard() {
  const submit = async (ev) => {
    ev.preventDefault(); const f = ev.currentTarget; const fd = new FormData(f);
    const fh = numOrNull(fd.get('feedH')), ph = numOrNull(fd.get('pumpH'));
    if (!(fh >= 0.25 && fh <= 24) || !(ph >= 0.25 && ph <= 24)) { toast('Hours must be between 0.25 and 24.'); return; }
    const was = { feed: S.rem.feed.auto, pump: S.rem.pump.auto };
    S.rem.feed = { auto: !!fd.get('feedAuto'), hours: fh }; S.rem.pump = { auto: !!fd.get('pumpAuto'), hours: ph };
    ['feed', 'pump'].forEach((k) => { if (S.rem[k].auto && !was[k] && !S.rem.due[k]) { const last = S.events.find((e) => e.type === k); if (last && last.t + S.rem[k].hours * HOUR > Date.now()) S.rem.due[k] = last.t + S.rem[k].hours * HOUR; } });
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    await guarded(saveRem, 'Reminders saved'); render();
  };
  const r = S.rem;
  return (
    <section className="card"><form className="setup" onSubmit={submit} key={JSON.stringify([r.feed, r.pump])}>
      <h2>Automatic reminders</h2>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>After each logged feed or pumping session, a reminder for the next one is set from its start time.</p>
      <div className="auto-row"><label className="check"><input type="checkbox" name="feedAuto" defaultChecked={r.feed.auto} />After every feed</label>
        <label className="field">Every (hours)<input name="feedH" type="text" inputMode="decimal" defaultValue={r.feed.hours} /></label></div>
      <div className="auto-row"><label className="check"><input type="checkbox" name="pumpAuto" defaultChecked={r.pump.auto} />After every pumping session</label>
        <label className="field">Every (hours)<input name="pumpH" type="text" inputMode="decimal" defaultValue={r.pump.hours} /></label></div>
      <div><button className="btn" type="submit">Save reminders</button></div>
    </form></section>
  );
}

function NotifyCard() {
  const s = pushSupport(); let body;
  if (s.ios && !s.standalone) body = <p style={{ margin: 0 }}>On iPhone, notifications only work from the home-screen app. In Safari tap <b>Share</b>, then <b>Add to Home Screen</b>. Open Baby Care Log from the new icon and come back here.</p>;
  else if (!s.ok) body = <p style={{ margin: 0 }}>This browser can't receive notifications. Use Chrome on Android, or Safari on iPhone with the app added to the home screen.</p>;
  else if (PUSH.sub) body = <><p style={{ margin: 0 }}>On for this phone. Feed and pumping reminders arrive even when the app is closed.</p><div className="rem-btns" style={{ marginTop: 10 }}><button className="chip" onClick={testPush}>Send a test</button><button className="chip" onClick={disablePush}>Turn off</button></div></>;
  else body = <><p style={{ margin: 0 }}>Get a notification on this phone when a feed or pumping reminder is due, even with the app closed.</p><div style={{ marginTop: 10 }}><button className="btn" disabled={PUSH.busy} onClick={enablePush}>{PUSH.busy ? 'Turning on…' : 'Turn on notifications'}</button></div></>;
  return (
    <section className="card"><p className="eyebrow">Notifications on this phone</p>{body}
      <p className="footnote">Each family member turns this on once on their own phone.{S.devices != null ? ` ${S.devices} phone${S.devices === 1 ? ' is' : 's are'} getting reminders.` : ''}</p></section>
  );
}

function exportData() {
  download('baby-care-log-' + dayKey(Date.now()) + '.json', JSON.stringify({ exported: new Date().toISOString(), profile: S.profile, events: S.events, growth: S.growth, appts: S.appts }, null, 1), 'application/json');
}
async function importData(ev) {
  const file = ev.target.files[0]; if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.events) && !Array.isArray(d.growth) && !Array.isArray(d.appts)) throw 0;
    const r = await api('/import', { method: 'POST', body: { events: d.events || [], growth: d.growth || [], appts: d.appts || [], profile: d.profile && d.profile.name && !S.profile.name ? d.profile : null } });
    await resync(); toast(`Imported ${r.imported} entries`);
  } catch (e) { toast(e && e.code === 'offline' ? 'No connection. Try again when online.' : "That file isn't a Baby Care Log export."); }
  ev.target.value = '';
}
async function copyLink() { const u = location.origin + '/'; try { await navigator.clipboard.writeText(u); toast('Link copied. Send it with the family key.'); } catch (e) { toast(u); } }

function FamilyCard() {
  return (
    <section className="card"><p className="eyebrow">Family</p>
      <p style={{ margin: 0 }}>Signed in as <b>{AUTH.member || 'family member'}</b>{AUTH.family ? ` · ${AUTH.family}` : ''}. Family members join by opening this app's web address and entering the family key.</p>
      <div className="rem-btns" style={{ marginTop: 10 }}><button className="chip" onClick={copyLink}>Copy app link</button><button className="chip" onClick={exportData}>Export data</button>
        <label className="chip" htmlFor="imp" style={{ cursor: 'pointer' }}>Import data</label><input type="file" id="imp" accept=".json,application/json" hidden onChange={importData} /></div>
      <div className="rem-btns" style={{ marginTop: 8 }}><ConfirmButton className="chip" label="Sign out on this phone" armedLabel="Tap again to sign out" onConfirm={() => signOut('')} /></div>
      <p className="footnote">{S.events.length} feed, diaper and pumping entries · {S.growth.length} measurements</p></section>
  );
}

export default function Baby() {
  return <>
    <ProfileCard />
    <AutoRemCard />
    <section className="card"><p className="eyebrow">How it works</p><p style={{ margin: 0 }}>How the suggestions, totals, reminders and charts are calculated, with sources. You can share the page with friends.</p><div style={{ marginTop: 10 }}><button className="btn ghost" onClick={() => openHelp()}>Read how it works</button></div></section>
    <NotifyCard />
    <FamilyCard />
  </>;
}
