// "Suggested next feed" card on Today.
import { DAY, fmtTime, fmtIn, fmtDur, fmtDate, grams } from '../lib/util.js';
import { nextFeedPlan } from '../lib/calc.js';
import { S, openHelp, setDue } from '../store.js';

export default function SuggestCard() {
  const p = nextFeedPlan(S);
  if (!p) return null;
  const due = p.next <= Date.now();
  const L = p.last;
  const lastTxt = L.ml > 0 ? `${L.ml} ml${L.unm ? ' plus breast' : ''} at ${fmtTime(L.t)}${L.n > 1 ? ' (with top-up)' : ''}` : `breast feed at ${fmtTime(L.t)}`;
  const rateTxt = p.rate ? `about ${Math.round(p.rate)} ml per hour` : '';
  const srcTxt = { her: `learned from her last ${p.pairs} measured feeds`, blend: `her last ${p.pairs} measured feeds combined with the weight guide`, guide: 'from the weight guide until more bottle feeds are logged' }[p.rateSrc] || '';
  const why = [];
  if (p.gapSrc === 'amount') why.push(['Last feed', `${lastTxt}. She drinks ${rateTxt} (${srcTxt}), so this lasts about ${fmtDur(p.gap)}.`]);
  else why.push(['Last feed', `${lastTxt}. ${L.ml > 0 ? 'Part of it was not measured' : 'Breast feeds are not measured'}, so ${p.gapSrc === 'usual' ? 'her usual gap' : 'the usual gap for her age'} of ${fmtDur(p.gap)} is used.`]);
  if (p.ml) {
    why.push(['Per feed', `~${p.perFeed} ml typical${p.recentAvg ? ` (weight guide ${p.guidePer} ml, her recent bottles ${p.recentAvg} ml)` : ''}. About ${p.left} feed${p.left > 1 ? 's' : ''} left ${p.newDay ? 'in that day' : 'today'}.`]);
    why.push(['Daily guide', `${p.target} ml (${grams(p.weight.kg)} g × ${p.perKg} ml per kg). It's a guide, not a limit.`]);
    if (p.newDay) why.push(['New day', 'This feed starts a new day, so the daily total begins again.']);
    else if (p.reached) why.push(['Note', "She has reached today's guide. Offer the next bottle if she shows hunger, and let her stop when she's full."]);
  }
  const pct = p.ml ? Math.min(100, Math.round(p.counted / p.target * 100)) : 0;
  const stale = p.weight && Date.now() - p.weight.t > 21 * DAY;
  const remind = () => { const at = Math.max(Math.round(p.next), Date.now() + 15 * 60e3); setDue('feed', at, `Feed reminder set for ${fmtTime(at)}`); };
  return (
    <section className="card suggest"><p className="eyebrow">Suggested next feed</p>
      <div className="sg-top">
        <div><span className="lbl">Time</span><b className="num">{fmtTime(p.next)}</b><span className="sub">{due ? <span className="pill">Due now</span> : <span>{fmtIn(p.next)}</span>}</span></div>
        <div><span className="lbl">Amount</span><b className="num" style={{ color: 'var(--feed)' }}>{p.ml ? '~' + p.ml + ' ml' : '–'}</b><span className="sub">{!p.ml ? 'add her weight' : p.newDay ? 'new day' : p.reached ? 'guide reached' : p.remaining + ' ml left today'}</span></div>
      </div>
      {p.ml && !p.newDay ? <>
        <div className="prog-row"><span className="num">{p.counted} / {p.target} ml today</span><span className="num">{pct}%</span></div>
        <div className="prog" role="img" aria-label={`${p.counted} of ${p.target} ml today`}><i style={{ width: pct + '%' }}></i></div>
      </> : null}
      <dl className="why">{why.map(([k, v]) => [<dt key={k + 't'}>{k}</dt>, <dd key={k + 'd'}>{v}</dd>])}</dl>
      {!p.weight ? <p className="footnote">Add her weight under <b>Growth</b> to get an amount and a daily guide.</p>
        : stale ? <p className="footnote">Her last weight is from {fmtDate(p.weight.t)}. Add a newer one in Growth for a better estimate.</p> : null}
      <div className="rem-btns" style={{ marginTop: 10 }}><button className="chip" onClick={remind}>{due ? 'Remind me in 15 min' : 'Remind me at ' + fmtTime(p.next)}</button></div>
      <p className="footnote"><button className="linkbtn" onClick={() => openHelp('feed')}>How is this worked out?</button> An estimate from Dutch guidance and her own pattern, not a rule. Feed when she shows hunger and stop when she's full. If you're unsure she's drinking enough, ask the consultatiebureau.</p>
    </section>
  );
}
