// Screens for phones that aren't signed in: start, create a family log, join with an invite link, use a recovery code.
// Also the recovery code screen shown once after creating a family or making a new code.
import { useEffect, useRef, useState } from 'react';
import { AUTH, S, loadStatus, openHelp, render, createFamily, inviteInfo, joinFamily, recoverFamily, doneRecovery, pushSupport } from '../store.js';

const Help = () => <p className="help-link"><button className="chip" onClick={() => openHelp()}>How does the app work?</button></p>;
const Lead = ({ children }) => <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>{children}</p>;
const Back = ({ to }) => <button type="button" className="linkbtn" onClick={to}>← Back</button>;
// Accepts a whole invite link (…/join#CODE) or just the code.
const codeFrom = (v) => { const s = String(v || '').trim(); const i = s.indexOf('#'); return (i >= 0 ? s.slice(i + 1) : s).replace(/[^A-Za-z0-9_-]/g, ''); };

function useSubmit(fn) {
  const [err, setErr] = useState(AUTH.error);
  const [busy, setBusy] = useState(false);
  const submit = async (ev) => {
    ev.preventDefault(); const fd = new FormData(ev.currentTarget);
    setBusy(true); const e = await fn(fd); setBusy(false); setErr(e || '');
  };
  return { err, busy, submit, setErr };
}

// Cloudflare Turnstile bot check, shown only when the server has it configured.
function Turnstile({ siteKey, onToken }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!siteKey) return;
    const draw = () => { if (window.turnstile && ref.current && !ref.current.dataset.done) { ref.current.dataset.done = '1'; window.turnstile.render(ref.current, { sitekey: siteKey, callback: onToken }); } };
    if (window.turnstile) draw();
    else { const sc = document.createElement('script'); sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; sc.async = true; sc.onload = draw; document.head.appendChild(sc); }
  }, [siteKey]);
  return siteKey ? <div ref={ref}></div> : null;
}

function Create({ back }) {
  const [tt, setTt] = useState('');
  const siteKey = AUTH.status && AUTH.status.turnstile;
  const { err, busy, submit } = useSubmit((fd) => {
    if (siteKey && !tt) return 'Wait for the check below to finish, then try again.';
    return createFamily({ family: String(fd.get('family') || '').trim(), member: String(fd.get('member') || '').trim(), turnstile: tt });
  });
  return <section className="card"><form className="setup" onSubmit={submit}>
    <Back to={back} />
    <h2>Create your family log</h2>
    <Lead>You'll get a link to invite your partner and anyone else who helps. Only people you invite can see the log.</Lead>
    <label className="field">Family name<input name="family" placeholder="e.g. The Jansen family" autoComplete="off" maxLength={60} /></label>
    <label className="field">Your name<input name="member" required placeholder="Shown on entries you log" autoComplete="given-name" maxLength={40} /></label>
    <Turnstile siteKey={siteKey} onToken={setTt} />
    <p className="login-err">{err}</p>
    <div><button className="btn" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create family log'}</button></div>
  </form></section>;
}

function Join({ code, back }) {
  const [info, setInfo] = useState(null);
  useEffect(() => { let on = true; inviteInfo(code).then((r) => { if (on) setInfo(r); }); return () => { on = false; }; }, [code]);
  const { err, busy, submit } = useSubmit((fd) => joinFamily(code, String(fd.get('member') || '').trim()));
  const ps = pushSupport();
  if (!info) return <section className="card"><p className="empty">Checking the invite…</p></section>;
  if (info.error) return <section className="card setup"><h2>{info.error === 'offline' ? "Can't check the invite" : 'This invite link no longer works'}</h2>
    <Lead>{info.error === 'offline' ? 'Check that this phone is online, then open the link again.' : 'Invite links work once and expire after 7 days. Ask a family member to send you a new one from Baby → Family.'}</Lead>
    <div><button className="btn ghost" onClick={back}>Back</button></div></section>;
  return <section className="card"><form className="setup" onSubmit={submit}>
    <h2>Join {info.family}</h2>
    <Lead>{info.from ? `${info.from} invited you to their family log.` : 'You were invited to this family log.'} You'll see and add the same entries, and get the same reminders.</Lead>
    {ps.ios && !ps.standalone && <p className="notice" style={{ margin: 0 }}>On iPhone, add the app to your Home Screen first: tap <b>Share</b>, then <b>Add to Home Screen</b>. Open it from the new icon and paste this invite link there. Otherwise you'd have to join twice.</p>}
    <label className="field">Your name<input name="member" required placeholder="Shown on entries you log" defaultValue={AUTH.member} autoComplete="given-name" maxLength={40} /></label>
    <p className="login-err">{err}</p>
    <div><button className="btn" type="submit" disabled={busy}>{busy ? 'Joining…' : 'Join family log'}</button></div>
  </form></section>;
}

function PasteInvite({ back, onCode }) {
  const [err, setErr] = useState('');
  const submit = (ev) => { ev.preventDefault(); const c = codeFrom(new FormData(ev.currentTarget).get('link')); if (c.length < 16) { setErr('Paste the whole invite link you were sent.'); return; } onCode(c); };
  return <section className="card"><form className="setup" onSubmit={submit}>
    <Back to={back} />
    <h2>Join with an invite link</h2>
    <Lead>Ask a family member to send you an invite from <b>Baby → Family</b> in their app. Open the link, or paste it here.</Lead>
    <label className="field">Invite link<input name="link" required placeholder="https://…/join#…" autoComplete="off" autoCapitalize="off" /></label>
    <p className="login-err">{err}</p>
    <div><button className="btn" type="submit">Continue</button></div>
  </form></section>;
}

function Recover({ back }) {
  const { err, busy, submit } = useSubmit((fd) => recoverFamily(String(fd.get('code') || ''), String(fd.get('member') || '').trim()));
  return <section className="card"><form className="setup" onSubmit={submit}>
    <Back to={back} />
    <h2>Use your recovery code</h2>
    <Lead>The recovery code was shown when the family log was made. It looks like ABCD-EFGH-JKMN-PQRS.</Lead>
    <label className="field">Recovery code<input name="code" required autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX" /></label>
    <label className="field">Your name<input name="member" required defaultValue={AUTH.member} placeholder="Shown on entries you log" autoComplete="given-name" maxLength={40} /></label>
    <p className="login-err">{err}</p>
    <div><button className="btn" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></div>
  </form></section>;
}

export default function Login() {
  const st = AUTH.status;
  const [mode, setMode] = useState(AUTH.joinCode ? 'join' : 'start');
  const [code, setCode] = useState(AUTH.joinCode);
  const back = () => { AUTH.error = ''; AUTH.joinCode = null; setMode('start'); };
  if (AUTH.legacyKey) return <section className="card"><p className="empty">Signing in…</p></section>;
  if (mode === 'join' && code) return <><Join code={code} back={back} /><Help /></>;
  if (!st) return <section className="card"><p className="empty">Connecting…</p></section>;
  if (st.error) return (
    <section className="card setup"><h2>Can't reach Baby Care Log</h2><Lead>Check that this phone is online, then try again.</Lead>
      <div><button className="btn" onClick={() => { AUTH.status = null; render(); loadStatus(); }}>Try again</button></div></section>
  );
  if (mode === 'create') return <><Create back={back} /><Help /></>;
  if (mode === 'paste') return <><PasteInvite back={back} onCode={(c) => { setCode(c); setMode('join'); }} /><Help /></>;
  if (mode === 'recover') return <><Recover back={back} /><Help /></>;
  return <>
    <section className="card setup">
      <h2>A shared baby log for your family</h2>
      <Lead>Log feeds, diapers, pumping, growth and appointments together, and get reminders on every family phone. Made for parents in the Netherlands.</Lead>
      {AUTH.error && <p className="login-err">{AUTH.error}</p>}
      <div className="setup" style={{ gap: 8 }}>
        <button className="btn" onClick={() => setMode('create')}>Create a family log</button>
        <button className="btn ghost" onClick={() => setMode('paste')}>Join with an invite link</button>
      </div>
      <p className="footnote" style={{ margin: 0 }}>Lost access on every phone? <button className="linkbtn" onClick={() => setMode('recover')}>Use your recovery code</button></p>
    </section>
    <Help />
  </>;
}

// Shown once, right after the code is made. The code is never shown again.
export function RecoveryScreen() {
  const r = S.recovery;
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(r.code); setCopied(true); } catch (e) {} };
  return <section className="card setup">
    <p className="eyebrow" style={{ margin: 0 }}>{r.first ? 'Your family log is ready' : 'New recovery code'}</p>
    <h2>Save your recovery code</h2>
    <p className="rcode num" aria-label="Recovery code">{r.code}</p>
    <p style={{ margin: 0 }}>If every phone in the family signs out or gets lost, this code is the only way back into your log. Keep it somewhere safe, like a password manager or a note at home.</p>
    <p className="footnote" style={{ margin: 0 }}>Anyone with this code can open your log, so don't share it.{r.first ? '' : ' The old code no longer works.'}</p>
    <div className="rem-btns"><button className="chip" onClick={copy}>{copied ? 'Copied' : 'Copy code'}</button></div>
    <label className="check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I've saved the recovery code</label>
    <div><button className="btn" disabled={!saved} onClick={doneRecovery}>{r.first ? 'Start using the log' : 'Done'}</button></div>
  </section>;
}
