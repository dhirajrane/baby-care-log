// "Share an idea": families send ideas, problems or praise to the app owner. Only the message, the member's name
// and when it was sent are stored, never the log. The owner reads them on /admin (Admin below).
import { useEffect, useState } from 'react';
import { fmtDate, fmtTime } from '../lib/util.js';
import { S, AUTH, api, render, toast } from '../store.js';

const KINDS = [['idea', 'An idea'], ['problem', 'Something is wrong'], ['praise', 'Something I like']];
const KLABEL = Object.fromEntries(KINDS);
function back() { S.tab = 'baby'; render(); window.scrollTo(0, 0); }

export default function Feedback() {
  const [kind, setKind] = useState('idea');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [mine, setMine] = useState(null);
  const load = () => api('/feedback').then((r) => setMine(r.feedback)).catch(() => setMine([]));
  useEffect(() => { load(); }, []);
  const send = async (ev) => {
    ev.preventDefault();
    if (text.trim().length < 3) { toast('Write a few words first.'); return; }
    setBusy(true);
    try { await api('/feedback', { method: 'POST', body: { kind, text: text.trim(), member: AUTH.member } }); setSent(true); setText(''); load(); }
    catch (e) { toast(e.code === 'offline' ? 'No connection. Try again when online.' : e.status === 429 ? 'That’s a lot of messages for today. Try again tomorrow.' : "Couldn't send it. Try again."); }
    finally { setBusy(false); }
  };
  return <>
    <div className="help-top"><button className="chip" onClick={back}>← Back</button></div>
    {sent ? <section className="card setup" style={{ alignItems: 'center', textAlign: 'center' }}>
      <div className="done-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
      <h2>Thank you!</h2>
      <p style={{ margin: 0, color: 'var(--muted)' }}>Your message has been sent. You'll find it below.</p>
      <button className="chip" onClick={() => setSent(false)}>Share another idea</button>
    </section>
      : <section className="card"><form className="setup" onSubmit={send}>
        <h2>Share an idea</h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>Missing something, or found a bug? Tell us. Every message is read, and the best ideas end up in the app.</p>
        <div className="field">What is it about?<div className="radios" role="radiogroup">{KINDS.map(([v, l]) =>
          <label key={v}><input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} /><span>{l}</span></label>)}</div></div>
        <label className="field">Your message<textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} style={{ minHeight: 150 }} placeholder="e.g. Could the app remind me when it's time for vitamin D?" /></label>
        <p className="footnote" style={{ margin: 0 }}>Only your message and your name are sent, never your baby's log.</p>
        <div><button className="btn" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button></div>
      </form></section>}
    {mine && mine.length > 0 && <section className="card"><p className="eyebrow">Your family's messages</p>
      {mine.map((m) => <div key={m.id} className="mrow"><div className="mbody"><div className="mdate">{fmtDate(m.created)} · {KLABEL[m.kind] || m.kind}{m.member ? ' · ' + m.member : ''}{m.done ? ' · picked up' : ''}</div><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.text}</div></div></div>)}
    </section>}
  </>;
}

// /admin: the app owner reads every message. The key is the ADMIN_KEY secret set in Cloudflare; it stays in this tab only.
export function Admin() {
  const [key, setKey] = useState(() => { try { return sessionStorage.getItem('bcl.admin') || ''; } catch (e) { return ''; } });
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const call = async (path, method = 'GET', body) => {
    const r = await fetch('/api' + path, { method, cache: 'no-store', headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw r.status; return r.json();
  };
  const load = async () => {
    try { setData(await call('/admin/feedback')); setErr(''); try { sessionStorage.setItem('bcl.admin', key); } catch (e) {} }
    catch (s) { setData(null); setErr(s === 401 ? 'That key is not right, or ADMIN_KEY is not set on this Worker.' : 'Could not load. Try again.'); }
  };
  useEffect(() => { if (key) load(); }, []);
  const mark = async (m) => { await call('/admin/feedback/' + m.id, 'PUT', { done: !m.done }); load(); };
  return <>
    <section className="card"><form className="setup" onSubmit={(e) => { e.preventDefault(); load(); }}>
      <h2>Messages from families</h2>
      <label className="field">Admin key<input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" /></label>
      {err && <p className="login-err">{err}</p>}
      <div><button className="btn" type="submit">Show messages</button></div>
    </form></section>
    {data && <section className="card"><p className="eyebrow">{data.feedback.length} messages · {data.families} families</p>
      {data.feedback.length ? data.feedback.map((m) => <div key={m.id} className="mrow"><div className="mbody">
        <div className="mdate">{fmtDate(m.created)} {fmtTime(m.created)} · {KLABEL[m.kind] || m.kind} · {m.member || 'someone'}{m.family ? ' · ' + m.family : ''}</div>
        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', opacity: m.done ? 0.6 : 1 }}>{m.text}</div></div>
        <div className="rem-btns"><button className="chip" onClick={() => mark(m)}>{m.done ? 'Mark as new' : 'Picked up'}</button></div></div>)
        : <p className="empty">No messages yet.</p>}
    </section>}
  </>;
}
