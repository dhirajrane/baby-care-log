// Sign-in screen: create the family log, or sign in with the family key.
import { useState } from 'react';
import { AUTH, loadStatus, openHelp, submitLogin, render } from '../store.js';

export default function Login() {
  const st = AUTH.status;
  const [err, setErr] = useState(AUTH.error);
  const [busy, setBusy] = useState(false);
  if (!st) return <section className="card"><p className="empty">Connecting…</p></section>;
  if (st.error) return (
    <section className="card setup"><h2>Can't reach Baby Care Log</h2><p style={{ margin: 0, color: 'var(--muted)' }}>Check that this phone is online, then try again.</p>
      <div><button className="btn" onClick={() => { AUTH.status = null; render(); loadStatus(); }}>Try again</button></div></section>
  );
  const setup = !st.setup;
  const submit = async (ev) => {
    ev.preventDefault(); const fd = new FormData(ev.currentTarget);
    setBusy(true);
    const e = await submitLogin(setup, { key: String(fd.get('key') || '').trim(), member: String(fd.get('member') || '').trim(), family: String(fd.get('family') || '').trim() });
    setBusy(false); setErr(e);
  };
  const help = <p className="help-link"><button className="chip" onClick={() => openHelp()}>How does the app work?</button></p>;
  if (setup) return <>
    <section className="card"><form className="setup" onSubmit={submit}>
      <h2>Set up your family's log</h2>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>Pick a family key. Everyone who should see and add entries signs in with it, so share it only with family.</p>
      <label className="field">Family name<input name="family" placeholder="e.g. Our family" autoComplete="off" /></label>
      <label className="field">Family key<input name="key" type="password" minLength={6} required autoComplete="new-password" placeholder="At least 6 characters" /></label>
      <label className="field">Your name<input name="member" required placeholder="Shown on entries you log" autoComplete="given-name" /></label>
      <p className="login-err">{err}</p>
      <div><button className="btn" type="submit" disabled={busy}>Create family log</button></div></form></section>
    {help}
  </>;
  return <>
    <section className="card"><form className="setup" onSubmit={submit}>
      <h2>{st.family ? 'Join ' + st.family : 'Sign in'}</h2>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>Enter the family key you were given.</p>
      <label className="field">Family key<input name="key" type="password" required autoComplete="current-password" /></label>
      <label className="field">Your name<input name="member" required placeholder="Shown on entries you log" defaultValue={AUTH.member} autoComplete="given-name" /></label>
      <p className="login-err">{err}</p>
      <div><button className="btn" type="submit" disabled={busy}>Sign in</button></div></form></section>
    {help}
  </>;
}
