// Baby tab: profile, automatic reminders, notifications on this phone, and family/account settings.
import { HOUR, numOrNull, dayKey, download } from '../lib/util.js';
import { useState } from 'react';
import { S, AUTH, PUSH, render, openHelp, saveProfile, saveRem, guarded, toast, api, resync, signOut, pushSupport, enablePush, disablePush, testPush, makeInvite, removeDevice, newRecoveryCode, renameFamily, openSheet, openPrivacy } from '../store.js';
import { Radios, ConfirmButton } from './ui.jsx';
import { guideFromDoctor, pron } from '../lib/calc.js';

function ProfileCard() {
  const p = S.profile; const { she, her, herO } = pron(S);
  const [src, setSrc] = useState(guideFromDoctor(p) ? 'doctor' : 'nl');
  const submit = (ev) => {
    ev.preventDefault(); const fd = new FormData(ev.currentTarget);
    let perKg = 150;
    if (src === 'doctor') {
      perKg = numOrNull(fd.get('mlPerKg'));
      if (!(perKg >= 100 && perKg <= 200)) { toast('Enter the ml per kg your doctor gave, between 100 and 200.'); return; }
    }
    guarded(() => saveProfile({ ...S.profile, name: (fd.get('name') || '').trim(), birth: fd.get('birth') || '', sex: fd.get('sex') || 'girl', guideSrc: src, mlPerKg: Math.round(perKg) }), 'Details saved');
  };
  // key: refill the form when the profile arrives from the server
  return (
    <section className="card"><form className="setup" onSubmit={submit} key={JSON.stringify(p)}>
      <h2>About {herO}</h2>
      <label className="field">Name<input name="name" defaultValue={p.name || ''} placeholder="Baby's name" autoComplete="off" /></label>
      <label className="field">Birth date<input name="birth" type="date" defaultValue={p.birth || ''} /></label>
      <div className="field">Reference curves<Radios name="sex" opts={[['girl', 'Girl'], ['boy', 'Boy']]} value={p.sex || 'girl'} /></div>
      <div className="field">Daily milk guide<Radios name="guideSrc" opts={[['nl', 'Dutch guidance: 150 ml per kg'], ['doctor', "Our doctor's advice"]]} value={src} onChange={setSrc} /></div>
      {src === 'doctor' && <label className="field">ml per kg body weight per day<input name="mlPerKg" type="number" inputMode="numeric" min="100" max="200" step="5" defaultValue={guideFromDoctor(p) ? p.mlPerKg : ''} placeholder="e.g. 160" /></label>}
      <p className="footnote" style={{ margin: '-6px 0 0' }}>Shown on Today as an indication of what's typical: {her} weight × ml per kg. It's not an amount {she} has to reach. Ask your consultatiebureau or huisarts what's right for {herO}, and enter their number here if they give you one.</p>
      <div><button className="btn" type="submit">Save details</button></div>
    </form></section>
  );
}

function NightCard() {
  const p = S.profile; const { her } = pron(S);
  const submit = (ev) => {
    ev.preventDefault(); const fd = new FormData(ev.currentTarget);
    const a = fd.get('nightStart'), b = fd.get('nightEnd');
    if (!/^\d{2}:\d{2}$/.test(a) || !/^\d{2}:\d{2}$/.test(b) || a === b) { toast('Pick when night starts and ends.'); return; }
    guarded(() => saveProfile({ ...S.profile, nightStart: a, nightEnd: b }), 'Night time saved');
  };
  return (
    <section className="card"><form className="setup" onSubmit={submit} key={(p.nightStart || '') + (p.nightEnd || '')}>
      <h2>Night time</h2>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>Sleep that starts in this window counts as night sleep; the rest are naps. Pick what fits {her} evening and morning routine.</p>
      <div className="row2"><label className="field">Night starts<input name="nightStart" type="time" defaultValue={p.nightStart || '19:00'} /></label>
        <label className="field">Night ends<input name="nightEnd" type="time" defaultValue={p.nightEnd || '07:00'} /></label></div>
      <div><button className="btn" type="submit">Save night time</button></div>
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
      <p className="footnote">Each family member turns this on once on their own phone.{S.pushPhones != null ? ` ${S.pushPhones} phone${S.pushPhones === 1 ? ' is' : 's are'} getting reminders.` : ''}</p></section>
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
const seen = (ms) => { const d = Math.floor((Date.now() - ms) / 864e5); return d < 1 ? 'active today' : d === 1 ? 'active yesterday' : `active ${d} days ago`; };

async function shareInvite() {
  const inv = S.invite || await makeInvite(); if (!inv) return;
  const text = `Join ${AUTH.family || 'our family'} on Baby Care Log: ${inv.url}`;
  if (navigator.share) { try { await navigator.share({ title: 'Baby Care Log invite', text, url: inv.url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(inv.url); toast('Invite link copied. Send it to the person you want to invite.'); } catch (e) {}
}
async function copyInvite() { try { await navigator.clipboard.writeText(S.invite.url); toast('Invite link copied'); } catch (e) { toast(S.invite.url); } }

function FamilyCard() {
  const fam = S.family; const list = S.devicesList;
  const [editing, setEditing] = useState(false);
  return (
    <section className="card"><p className="eyebrow">Family</p>
      {editing ? <form className="setup" onSubmit={(ev) => { ev.preventDefault(); const n = String(new FormData(ev.currentTarget).get('familyName') || '').trim(); if (n) { renameFamily(n); setEditing(false); } }}>
        <label className="field">Family name<input name="familyName" defaultValue={AUTH.family} maxLength={60} required autoFocus /></label>
        <div className="rem-btns"><button className="chip" type="submit">Save</button><button className="chip" type="button" onClick={() => setEditing(false)}>Cancel</button></div></form>
        : <p style={{ margin: 0 }}><b>{AUTH.family || 'Your family'}</b> <button className="linkbtn" style={{ fontSize: 13 }} onClick={() => setEditing(true)}>Rename</button><br />Signed in on this phone as <b>{AUTH.member || 'family member'}</b>.</p>}

      <h3 className="sub-h">Invite someone</h3>
      <p style={{ margin: 0, fontSize: 14 }}>Send an invite link to your partner, a grandparent or a babysitter. They'll see and add the same entries and get the same reminders.</p>
      <div className="rem-btns" style={{ marginTop: 10 }}><button className="btn" onClick={shareInvite}>{S.invite ? 'Share the invite link' : 'Invite a family member'}</button></div>
      {S.invite && <><p className="invite-link">{S.invite.url}</p>
        <div className="rem-btns" style={{ marginTop: 6 }}><button className="chip" onClick={copyInvite}>Copy link</button><button className="chip" onClick={async () => { S.invite = null; await makeInvite(); }}>New link</button></div>
        <p className="footnote">The link works for one person and expires in {S.invite.days} days. Make a new link for each person.</p></>}

      <h3 className="sub-h">Phones with access</h3>
      {list == null ? <p className="empty">Loading…</p> : list.map((d) => (
        <div key={d.id} className="dev"><div><b>{d.member}</b>{d.me ? ' · this phone' : ''}<div className="sub">{seen(d.lastSeen)}{d.push ? ' · reminders on' : ''}</div></div>
          {!d.me && <ConfirmButton className="chip" armedClass="danger-armed" label="Remove" armedLabel="Tap again to remove" resetAfter={4000} onConfirm={() => removeDevice(d.id)} />}</div>
      ))}
      {list && list.length > 0 && <p className="footnote">Remove a phone that's lost or that shouldn't see the log anymore.</p>}

      <h3 className="sub-h">Recovery code</h3>
      {fam && !fam.hasRecovery ? <div className="alert" style={{ margin: 0 }}><div><b>Make a recovery code</b><div className="sub">If every phone signs out or gets lost, the recovery code is the only way back into your log.</div></div>
        <div className="rem-btns"><button className="chip" onClick={newRecoveryCode}>Make code</button></div></div>
        : <><p style={{ margin: 0, fontSize: 14 }}>Gets your family back into the log if every phone signs out or gets lost. It was shown once when it was made.</p>
          <div className="rem-btns" style={{ marginTop: 8 }}><ConfirmButton className="chip" label="Make a new recovery code" armedLabel="Tap again: the old code stops working" onConfirm={newRecoveryCode} /></div></>}

      <h3 className="sub-h">Your data</h3>
      <p style={{ margin: '0 0 8px', fontSize: 14 }}>What the app stores and your rights: <button className="linkbtn" onClick={openPrivacy}>privacy statement</button>.</p>
      <div className="rem-btns"><button className="chip" onClick={exportData}>Export data</button>
        <label className="chip" htmlFor="imp" style={{ cursor: 'pointer' }}>Import data</label><input type="file" id="imp" accept=".json,application/json" hidden onChange={importData} /></div>
      <div className="rem-btns" style={{ marginTop: 8 }}><ConfirmButton className="chip" label="Sign out on this phone" armedLabel="Tap again to sign out" onConfirm={() => signOut('', true)} />
        <button className="chip" onClick={() => openSheet('deleteFamily')}>Delete family log</button></div>
      <p className="footnote">{S.events.length} feed, diaper and pumping entries · {S.growth.length} measurements</p></section>
  );
}

export default function Baby() {
  return <>
    <ProfileCard />
    <AutoRemCard />
    <NightCard />
    <section className="card"><p className="eyebrow">How it works</p><p style={{ margin: 0 }}>How the suggestions, totals, reminders and charts are calculated, with sources. You can share the page with friends.</p><div style={{ marginTop: 10 }}><button className="btn ghost" onClick={() => openHelp()}>Read how it works</button></div></section>
    <NotifyCard />
    <FamilyCard />
  </>;
}
