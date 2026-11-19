// Growth tab: weight, length and head charts and the list of measurements.
import { fmtDate, grams } from '../lib/util.js';
import { S, render, openSheet, removeRow, guarded } from '../store.js';
import { ConfirmButton } from './ui.jsx';
import { GrowthChart } from './charts.jsx';

const LABEL = { kg: 'Weight', cm: 'Length', head: 'Head' };

export default function Growth() {
  const m = S.metric; const unit = m === 'kg' ? 'g' : 'cm'; const rows = S.growth;
  return <>
    <section className="card"><div className="row-between" style={{ marginBottom: 12 }}><h2>{LABEL[m]} ({unit})</h2><button className="btn green" onClick={() => openSheet('growth')}>Add measurement</button></div>
      <div className="seg-tabs" role="group" aria-label="Measurement">{['kg', 'cm', 'head'].map((k) => <button key={k} aria-pressed={k === m} onClick={() => { S.metric = k; render(); }}>{LABEL[k]}</button>)}</div>
      <div style={{ marginTop: 12 }}><GrowthChart metric={m} /></div></section>
    <section className="card"><p className="eyebrow">All measurements</p>
      {rows.length ? <div className="mlist">{rows.map((r, i) => {
        const prev = rows.slice(i + 1).find((p) => p.kg != null); const d = (r.kg != null && prev) ? Math.round((r.kg - prev.kg) * 1000) : null;
        const vals = [];
        if (r.kg != null) vals.push(<span key="kg"><b className="num">{grams(r.kg)} g</b>{d != null && <> <span className="delta">{d >= 0 ? '+' : ''}{d} g</span></>}</span>);
        if (r.cm != null) vals.push(<span key="cm" className="num">{r.cm} cm long</span>);
        if (r.head != null) vals.push(<span key="head" className="num">head {r.head} cm</span>);
        return (
          <div key={r.id} className="mrow"><div className="mbody"><div className="mdate">{fmtDate(r.t)}</div><div>{vals.flatMap((v, j) => j ? [' · ', v] : [v])}</div>{r.note && <div className="note">{r.note}</div>}</div>
            <div className="rem-btns"><button className="chip" onClick={() => openSheet('growth', r)}>Edit</button>
              <ConfirmButton className="chip" armedClass="danger-armed" label="Delete" armedLabel="Tap again to delete" resetAfter={4000} onConfirm={() => guarded(() => removeRow('growth', r.id), 'Measurement deleted')} /></div></div>
        );
      })}</div> : <p className="empty">{S.loading ? 'Loading…' : 'Measurements you add appear here, newest first.'}</p>}
    </section>
  </>;
}
