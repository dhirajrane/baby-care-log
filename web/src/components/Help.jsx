// "How it works" page: every calculation in plain language, with sources. Readable without signing in at /help.
import { HELP_SRC } from '../lib/constants.js';
import { S, render, toast, openPrivacy } from '../store.js';

const Src = ({ k }) => <a href={HELP_SRC[k][1]} target="_blank" rel="noopener">{HELP_SRC[k][0]}</a>;
const Sec = ({ id, title, children }) => <section className="card help" id={'h-' + id}><h2>{title}</h2>{children}</section>;
const TOC = [['feed', 'Next feed suggestion'], ['milk', 'Milk totals'], ['rem', 'Reminders'], ['cal', 'Appointments and vaccinations'], ['sleep', 'Sleep'], ['growth', 'Growth charts'], ['temp', 'Temperature'], ['notes', 'Day notes'], ['report', 'Visit report'], ['data', 'Your data'], ['src', 'Sources']];

function back() { S.tab = S.prevTab || 'today'; if (location.pathname !== '/') history.replaceState(null, '', '/'); render(); window.scrollTo(0, 0); }
async function copy() { const u = location.origin + '/help'; try { await navigator.clipboard.writeText(u); toast('Link copied: ' + u); } catch (e) { toast(u); } }
function jump(ev, id) {
  ev.preventDefault(); const el = document.getElementById(id);
  if (el) el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

export default function Help() {
  return <>
    <div className="help-top"><button className="chip" onClick={back}>← Back</button><button className="chip" onClick={copy}>Copy link to this page</button></div>
    <section className="card help"><h2>How the app works</h2>
      <p>Baby Care Log keeps a shared record of feeds, diapers, pumping, growth, temperature and appointments for a family. This page explains how each number and suggestion is worked out, so you know what to trust it for.</p>
      <p className="warn">The app is a diary with helpful estimates. It is not medical advice. Follow your baby's hunger and fullness cues, and ask the consultatiebureau, huisarts or midwife if you're unsure.</p>
      <nav className="toc" aria-label="On this page">{TOC.map(([id, t]) => <a key={id} href={'#h-' + id} onClick={(ev) => jump(ev, 'h-' + id)}>{t}</a>)}</nav></section>

    <Sec id="feed" title="Next feed suggestion">
      <p>The card on Today suggests around when the next feed might be, what the baby's bottles usually are, and a daily milk guide.</p>
      <p className="warn"><b>It's just a suggestion.</b> Feed when the baby shows hunger, and let them stop when they're full. Babies drink more on some days than others, for example during a growth spurt. Ask the consultatiebureau or your huisarts what daily amount is right for your baby.</p>
      <h3>1. Around when: the usual interval for the baby's age (new babies)</h3>
      <p>Until about 5 feeds are logged, the app uses the usual interval for the baby's age. Babies feed about 10 times a day as newborns, falling to about 6 times a day by 6 months.</p>
      <p className="formula">next feed ≈ start of last feed + 24 hours ÷ usual feeds per day for the baby's age</p>
      <p>For example, a 1-month-old feeds about 9 times a day, so about every 2 h 40 min. Without a birth date the app assumes 8 feeds a day.</p>
      <h3>2. Around when: the baby's own rhythm</h3>
      <p>Once there are about 5 feeds from the last 2 days, the app follows the baby's own rhythm instead.</p>
      <p className="formula">next feed ≈ start of last feed + the baby's usual gap</p>
      <ul>
        <li><b>Usual gap:</b> the middle value (median) of the times between the baby's feeds over the last 2 days.</li>
        <li><b>Bottle size:</b> when at least 5 of the baby's measured bottles were followed by another feed, the app learns how long a bottle usually lasts the baby (ml per hour). A bigger bottle then moves the suggestion a little later and a smaller one a little earlier, within 0.6 to 1.5 times the baby's usual gap and never less than 1.5 hours.</li>
        <li>After a breast feed, or a feed without an amount, the usual gap is used.</li>
        <li>Feeds that start within 30 minutes of each other, such as a bottle and a top-up, count as one feed (up to 45 minutes from the first).</li>
      </ul>
      <h3>3. The baby's usual bottle</h3>
      <p className="formula">usual bottle = middle value of the baby's measured bottles in the last 3 days</p>
      <p>Rounded to 10 ml and shown with the smallest and largest bottle. It needs 3 bottles with an amount. It describes what the baby has been drinking.</p>
      <h3>4. Daily milk guide</h3>
      <p className="formula">daily guide = latest weight × ml per kg</p>
      <ul>
        <li><b>Dutch guidance:</b> about 150 ml per kg of body weight per day for bottle feeding (Voedingscentrum). For example, 4,800 g × 150 = 720 ml a day.</li>
        <li><b>Your doctor's advice:</b> if your consultatiebureau or huisarts gives you a different number, choose it under <b>Baby → Daily milk guide</b>.</li>
        <li><b>Guide per feed</b> = daily guide ÷ feeds per day (the baby's own rhythm, or the usual number for their age). It's shown as the amount until the baby has 3 measured bottles.</li>
        <li>"Today so far" adds up today's bottles with an amount in ml, from midnight. The bar shows how far along the day's guide that is; it isn't a target, and the baby doesn't have to reach it.</li>
        <li>The guide uses the latest weight in Growth. If it's more than 3 weeks old, the card asks for a newer one.</li>
      </ul>
      <p className="note">"Remind me at …" sets a reminder for the suggested time, for every family phone with notifications on.</p>
    </Sec>

    <Sec id="milk" title="Milk totals">
      <ul>
        <li><b>Per calendar day</b>, from midnight to midnight.</li>
        <li>Only <b>bottle feeds with an amount</b> count in ml: expressed milk and formula. Breast feeds can't be measured, so they're counted separately as a number of feeds (with minutes, if logged).</li>
        <li>In History, the 14-day milk chart shows expressed milk and formula stacked per day. The dashed average leaves out today, because the day isn't over yet.</li>
        <li>"Between feeds (avg)" in History is the time from the first to the last feed of the day divided by the number of gaps.</li>
      </ul>
    </Sec>

    <Sec id="rem" title="Reminders">
      <ul>
        <li><b>Automatic:</b> when turned on in Baby, logging a feed or pumping session sets the next reminder that many hours after the <b>start time</b> of what you logged. Whoever logs it, the reminder is shared by the whole family.</li>
        <li><b>One-off:</b> after a feed or pumping session you can pick 2, 2½, 3 or 4 hours, a custom number of hours, or an exact clock time. A time that has already passed today is set for tomorrow.</li>
        <li><b>Suggested time:</b> "Remind me at …" on the Next feed card sets a reminder for that time.</li>
        <li>The server checks every minute and sends a notification to every phone that has notifications turned on, even when the app is closed. A reminder more than 2 hours late is skipped rather than sent.</li>
        <li><b>Snooze</b> moves a reminder 15 minutes later.</li>
      </ul>
    </Sec>

    <Sec id="cal" title="Appointments and vaccinations">
      <ul>
        <li>Each appointment can remind the family 1 week, 1 day, 3 hours or 1 hour before, or at the time. Each reminder is sent once. If you move the appointment, its reminders are set again for the new time.</li>
        <li><b>Expected vaccination dates</b> are worked out from the birth date using the ages in the Dutch Rijksvaccinatieprogramma: 6–9 weeks, 3, 5, 12 and 14 months, and 3 years. They're marked "Expected date" and send no reminders until you change the date to the one in the GGD invitation.</li>
        <li>RSV immunisation depends on the month of birth, so it isn't added. The GGD contacts you about it.</li>
        <li>"Add to phone calendar" saves the appointment with the same alerts in your phone's own calendar.</li>
      </ul>
    </Sec>

    <Sec id="sleep" title="Sleep">
      <ul>
        <li><b>Logging:</b> tap <b>+</b> → <b>Asleep now</b> when the baby falls asleep, and <b>Woke up</b> on Today when they wake. Every family phone sees that the baby is asleep. You can also log a sleep afterwards with its start and end time, and change any sleep by tapping it.</li>
        <li><b>Night and naps:</b> sleep that starts inside the night window (19:00–07:00 unless you change it under <b>Baby → Night time</b>) is night sleep; the rest are naps. Totals split a sleep that crosses into or out of the night window by the minute.</li>
        <li><b>Sleep per day</b> runs from midnight to midnight, so a night sleep that crosses midnight is split over both days. "Last 24 hours" on Today counts back from now.</li>
        <li><b>Longest sleep</b> is the longest single sleep. <b>Night wakings</b> counts the times the baby woke at night and fell asleep again within 4 hours. <b>Usual time awake</b> is the middle value (median) of the time between sleeps.</li>
        <li>If you log a feed while the baby is marked as asleep, the app asks whether they woke up for it. A sleep still running after 12 hours gets a reminder to set the wake-up time.</li>
        <li>The app shows the baby's own sleep, without comparing it to a norm: every baby sleeps differently. If you're worried about sleep, ask the consultatiebureau.</li>
      </ul>
    </Sec>

    <Sec id="growth" title="Growth charts">
      <ul>
        <li>Weight is entered in grams. Length and head circumference are in cm.</li>
        <li>The weight chart shows the <b>WHO weight-for-age</b> reference for girls or boys: a shaded band from the 3rd to the 97th percentile and a dashed median line, for the first 12 months. It needs the birth date.</li>
        <li>The change in grams next to each weight is the difference from the previous weigh-in.</li>
        <li>Age is shown in days for the first 2 weeks, in weeks up to 10 weeks, and in months after that.</li>
      </ul>
    </Sec>

    <Sec id="temp" title="Temperature">
      <ul>
        <li>Temperature is optional when logging a diaper. Rectal measuring is the default because it's the most reliable for young children.</li>
        <li><b>38.0 °C or higher</b> is marked as fever range. For a baby younger than 3 months, the app shows a banner saying a doctor should see the baby straight away (huisarts, or the huisartsenpost outside office hours). For older babies it suggests calling the huisarts if you're worried.</li>
        <li><b>Below 35.8 °C</b> is marked as below the normal range (35.8–37.5 °C).</li>
        <li>Readings outside 30–45 °C are rejected, so a Fahrenheit value like 100.4 isn't saved as Celsius by mistake.</li>
      </ul>
    </Sec>

    <Sec id="notes" title="Day notes">
      <ul>
        <li>Tap <b>+ Note</b> to write how the baby is doing: mood, sleep, behaviour, a milestone, or a question for the consultatiebureau. Quick tags (Happy, Calm, Fussy, Sleepy, Unwell, Milestone) are optional.</li>
        <li>Notes show on Today and above each day's summary in History, and the <b>Notes</b> filter lists all of them by day. Each note shows who wrote it.</li>
        <li>Notes don't change any totals or suggestions.</li>
      </ul>
    </Sec>

    <Sec id="report" title="Visit report">
      <ul>
        <li>History → <b>Visit report for the doctor</b> (or Calendar → Prepare a visit report) builds a one-page summary for a chosen period. By default it covers the time since the last consultatiebureau, doctor or midwife appointment in Calendar.</li>
        <li><b>Averages per day</b> use complete days that have entries for that item, so a day you didn't log doesn't pull the average down. Today isn't counted in averages because it isn't over yet. The range in brackets is the lowest and highest day.</li>
        <li><b>Weight gain per week</b> runs from the last weight before the period (if there is one) to the latest weight in it. The percentile line compares the latest weight with the WHO weight-for-age reference.</li>
        <li><b>Sleep</b> shows the average per day of total sleep, night sleep, naps, the longest sleep and night wakings, over days that have sleep logged.</li>
        <li><b>Longest stretch</b> is the longest gap between feeds that ended on that day, averaged over the days. Top-ups within 30 minutes count as one feed.</li>
        <li>Use <b>Save as PDF / print</b> to keep or send a copy. Questions you type for the doctor are saved on this phone only.</li>
      </ul>
    </Sec>

    <Sec id="data" title="Your data">
      <ul>
        <li>Each family log is private. Only phones that joined with an invite link, or with the family's recovery code, can see and add entries. Baby → Family lists every phone with access, and you can remove one at any time.</li>
        <li>An invite link works for one person and expires after 7 days.</li>
        <li>The recovery code is shown once, when it's made. If every phone signs out or gets lost, it's the only way back in. You can make a new one under Baby → Family; the old one then stops working.</li>
        <li>Entries logged without internet are kept on the phone and sent when it's back online.</li>
        <li>Baby → Export data downloads everything as a file you can keep as a backup or import again.</li>
        <li>Baby → Delete family log removes the log and everything in it for every member.</li>
        <li>The <a href="/privacy" onClick={(ev) => { ev.preventDefault(); openPrivacy(); }}>privacy statement</a> explains what's stored, why, and your rights.</li>
      </ul>
    </Sec>

    <Sec id="src" title="Sources"><ul className="srcs">{Object.keys(HELP_SRC).map((k) => <li key={k}><Src k={k} /></li>)}</ul></Sec>
  </>;
}
