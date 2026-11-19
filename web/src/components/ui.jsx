// Small building blocks used across screens.
import { useState } from 'react';
import { fmtTime, ago } from '../lib/util.js';
import { NOTE_TAGS } from '../lib/constants.js';
import { evDot, evTitle, tempFlag } from '../lib/calc.js';
import { openSheet, S } from '../store.js';

// Radio pills. `opts` is an object {value: label} or an array of [value, label].
export function Radios({ name, opts, value, onChange }) {
  const list = Array.isArray(opts) ? opts : Object.entries(opts);
  return (
    <div className="radios" role="radiogroup">
      {list.map(([v, l]) => (
        <label key={v}><input type="radio" name={name} value={v} defaultChecked={v === value} onChange={onChange ? () => onChange(v) : undefined} /><span>{l}</span></label>
      ))}
    </div>
  );
}

// Checkbox pills.
export function Checks({ name, opts, values }) {
  return (
    <div className="checks">
      {opts.map(([v, l]) => (
        <label key={v}><input type="checkbox" name={name} value={v} defaultChecked={(values || []).includes(v)} /><span>{l}</span></label>
      ))}
    </div>
  );
}

// A button that needs a second tap to confirm (delete, sign out).
export function ConfirmButton({ className, label, armedLabel, onConfirm, resetAfter, armedClass }) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className={className + (armed && armedClass ? ' ' + armedClass : '')} onClick={() => {
      if (!armed) { setArmed(true); if (resetAfter) setTimeout(() => setArmed(false), resetAfter); return; }
      onConfirm();
    }}>{armed ? armedLabel : label}</button>
  );
}

export const Ago = ({ t }) => <span>{ago(t)}</span>;

export function Item({ e }) {
  const tf = tempFlag(e.temp);
  return (
    <button className="item" onClick={() => openSheet(e.type, e)}>
      <time>{fmtTime(e.t)}</time><span className={'dot ' + evDot(e)}></span>
      <span className="body"><span className="ttl">{evTitle(e)}</span>
        {tf && <div className={'tflag ' + tf.cls}>{tf.txt}</div>}
        {e.note && <div className="note">{e.note}</div>}
        {e.by && <div className="by">{e.by}</div>}
      </span>
    </button>
  );
}

export function NoteItem({ e }) {
  return (
    <button className="nitem" onClick={() => openSheet('note', e)}>
      <div className="nmeta"><time className="num">{fmtTime(e.t)}</time>
        {(e.tags || []).map((t) => <span key={t} className={'tag t-' + t}>{NOTE_TAGS[t] || t}</span>)}
        {e.by && <span className="nby">{e.by}</span>}
      </div>
      {e.note && <div className="ntext">{e.note}</div>}
    </button>
  );
}

export const babyName = () => S.profile.name || 'the baby';
