// "Next feed" suggestion on Today. Follows the baby's own rhythm once there are enough logged feeds;
// before that, the usual interval for her age. Shows the daily milk guide as an indication only.
import { DAY, fmtTime, fmtIn, fmtDur, fmtDate, grams } from '../lib/util.js';
import { nextFeedPlan, GUIDE_SRC, MIN_GAPS } from '../lib/calc.js';
import { S, go, openHelp, setDue } from '../store.js';

export default function SuggestCard() {
  const p = nextFeedPlan(S);
  if (!p) return null;
  // Pronouns follow the profile (girl by default).
  const boy = S.profile.sex === 'boy';
  const she = boy ? 'he' : 'she', her = boy ? 'his' : 'her', herO = boy ? 'him' : 'her', Her = boy ? 'His' : 'Her';
  const due = p.next <= Date.now();
  const L = p.last;
  const lastTxt = L.ml > 0 ? `${L.ml} ml${L.unm ? ' plus breast' : ''} at ${fmtTime(L.t)}${L.n > 1 ? ' (with top-up)' : ''}` : `breast feed at ${fmtTime(L.t)}`;
  const g = p.guide;

  const why = [];
  if (p.mode === 'pattern') {
    why.push(['Rhythm', `Over the last 2 days ${she} fed about every ${fmtDur(p.usualGap)}.`]);
    why.push(['Last feed', p.gapSrc === 'amount' ? `${lastTxt}. ${Her} bottles usually last about ${Math.round(p.rate)} ml per hour, so this one may last about ${fmtDur(p.gap)}.` : `${lastTxt}.`]);
  } else {
    why.push(['Interval', `Babies ${p.hasBirth ? her + ' age' : 'in the first months'} usually feed about ${Math.round(p.ageFeeds)} times a day, so about every ${fmtDur(p.ageGap)}. After about ${MIN_GAPS + 1} logged feeds, the app follows ${her} own rhythm instead.`]);
    why.push(['Last feed', `${lastTxt}.`]);
  }
  if (p.ml) why.push(['Bottles', `${Her} last ${p.bottleCount} bottles were ${p.mlMin === p.mlMax ? p.mlMin + ' ml' : `${p.mlMin}–${p.mlMax} ml`}.`]);
  if (g) why.push(['Daily guide', `About ${g.ml} ml a day (${grams(g.weight.kg)} g × ${g.perKg} ml per kg, ${GUIDE_SRC[g.src]}). Spread over about ${Math.round(p.feedsPerDay)} feeds, that's about ${p.guidePerFeed} ml per feed. An indication of what's typical, not an amount ${she} has to reach.`]);

  // Second box: her own usual bottle when known, otherwise the guide per feed (new parents).
  const amount = p.ml ? { lbl: `${Her} usual bottle`, val: '~' + p.ml + ' ml', sub: `middle of ${her} recent bottles` }
    : g ? { lbl: 'Guide per feed', val: '~' + p.guidePerFeed + ' ml', sub: 'from the daily guide' }
      : { lbl: 'Amount', val: '–', sub: `add ${her} weight` };
  const pct = g ? Math.min(100, Math.round(p.soFar / g.ml * 100)) : 0;
  const stale = g && Date.now() - g.weight.t > 21 * DAY;
  const remind = () => { const at = Math.max(Math.round(p.next), Date.now() + 15 * 60e3); setDue('feed', at, `Feed reminder set for ${fmtTime(at)}`); };

  return (
    <section className="card suggest"><p className="eyebrow">{p.mode === 'pattern' ? `Next feed, based on ${her} pattern` : `Next feed, based on ${her} age`}</p>
      <div className="sg-top">
        <div><span className="lbl">Around</span><b className="num">{fmtTime(p.next)}</b><span className="sub">{due ? <span className="pill">Could be now</span> : <span>{fmtIn(p.next)}</span>}</span></div>
        <div><span className="lbl">{amount.lbl}</span><b className="num" style={{ color: 'var(--feed)' }}>{amount.val}</b><span className="sub">{amount.sub}</span></div>
      </div>
      {g && <>
        <div className="prog-row"><span className="num">Today so far {p.soFar} ml</span><span className="num">daily guide ~{g.ml} ml</span></div>
        <div className="prog" role="img" aria-label={`${p.soFar} ml today, daily guide about ${g.ml} ml`}><i style={{ width: pct + '%' }}></i></div>
      </>}
      <p className="sg-note"><b>Just a suggestion.</b> Feed when {she} shows hunger, and let {herO} stop when {she}'s full; some days {she}'ll drink more or less. Ask the consultatiebureau or your huisarts what daily amount is right for {herO}.</p>
      <dl className="why">{why.map(([k, v]) => [<dt key={k + 't'}>{k}</dt>, <dd key={k + 'd'}>{v}</dd>])}</dl>
      {!g ? <p className="footnote">Add {her} weight under <button className="linkbtn" onClick={() => go('growth')}>Growth</button> to see a daily guide.</p>
        : stale ? <p className="footnote">{Her} last weight is from {fmtDate(g.weight.t)}. Add a newer one in Growth to keep the guide up to date.</p> : null}
      {p.mode === 'age' && !p.hasBirth && <p className="footnote">Add {her} birth date under <button className="linkbtn" onClick={() => go('baby')}>Baby</button> for intervals that fit her age.</p>}
      <div className="rem-btns" style={{ marginTop: 10 }}><button className="chip" onClick={remind}>{due ? 'Remind me in 15 min' : 'Remind me at ' + fmtTime(p.next)}</button></div>
      <p className="footnote"><button className="linkbtn" onClick={() => openHelp('feed')}>How is this worked out?</button></p>
    </section>
  );
}
