// Privacy statement: readable without signing in at /privacy. Keep it in sync with what the app stores (src/worker.js).
import { useEffect, useState } from 'react';
import { S, render, toast, api } from '../store.js';

export const PRIVACY_UPDATED = '20 November 2026';
const Sec = ({ title, children }) => <section className="card help"><h2>{title}</h2>{children}</section>;

function back() { S.tab = S.prevTab || 'today'; if (location.pathname !== '/') history.replaceState(null, '', '/'); render(); window.scrollTo(0, 0); }
async function copy() { const u = location.origin + '/privacy'; try { await navigator.clipboard.writeText(u); toast('Link copied: ' + u); } catch (e) { toast(u); } }

export default function Privacy() {
  const [contact, setContact] = useState(null);
  useEffect(() => { api('/status', { noAuth: true }).then((r) => setContact({ ...(r.contact || {}), turnstile: !!r.turnstile })).catch(() => setContact({})); }, []);
  const who = contact && contact.name ? contact.name : null;
  const email = contact && contact.email ? contact.email : null;
  const bot = contact && contact.turnstile;
  return <>
    <div className="help-top"><button className="chip" onClick={back}>← Back</button><button className="chip" onClick={copy}>Copy link to this page</button></div>

    <section className="card help"><h2>Privacy statement</h2>
      <p>Baby Care Log is a shared diary for a baby's feeds, diapers, growth and appointments. It holds health information about your child, so here is plainly what it stores, why, and what you can do about it.</p>
      <p className="note">Last updated {PRIVACY_UPDATED}.</p>
    </section>

    <Sec title="Who is responsible">
      {contact == null ? <p>Loading…</p>
        : who || email ? <p>Baby Care Log is run by {who || 'the app owner'}{email ? <>. For questions or requests about your data, email <a href={'mailto:' + email}>{email}</a>.</> : '.'}</p>
          : <p className="warn">The contact details for this copy of the app haven't been set yet. Ask the person who shared the app with you.</p>}
    </Sec>

    <Sec title="What the app stores">
      <ul>
        <li><b>About your family:</b> the family name, the name each person types when they join, and for each phone when it joined and when it was last active.</li>
        <li><b>About your baby:</b> name, birth date and sex, and everything you log: feeds, diapers, pumping, temperature, weight and length, day notes and appointments. This is health information about your child.</li>
        <li><b>For reminders:</b> the notification address of each phone that turns notifications on.</li>
        <li><b>To stop misuse:</b> when someone creates a family, joins or uses a recovery code, the app counts attempts per internet (IP) address. The count is deleted within a day.</li>
        <li><b>On your phone:</b> a copy of the log, so the app works offline. Questions you type for the doctor in the visit report stay on your phone only.</li>
      </ul>
      <p>The app does <b>not</b> ask for an email address, phone number or password. It has no advertising, no analytics and no tracking, and it doesn't load anything from other websites{bot ? ", except Cloudflare's check that you're not a robot on the Create a family log screen" : ''}.</p>
    </Sec>

    <Sec title="Why, and on what basis">
      <p>The app uses this information only to show your family's log to the people in your family and to send the reminders you set.</p>
      <p>Because the log holds health information about a child, a parent gives explicit consent when creating the family log (AVG/GDPR article 9(2)(a)). You can withdraw it at any time by deleting the family log.</p>
    </Sec>

    <Sec title="Who can see it">
      <ul>
        <li>Only phones that joined your family with an invite link or the recovery code. <b>Baby → Family</b> lists them, and you can remove any of them.</li>
        <li>Your log isn't sold or shared, and isn't used for anything other than running the app for your family.</li>
      </ul>
    </Sec>

    <Sec title="Services the app uses">
      <ul>
        <li><b>Cloudflare</b> hosts the app and its database, under Cloudflare's data processing terms.</li>
        <li><b>Apple, Google or Mozilla</b>, depending on your phone, deliver reminder notifications. The content is encrypted, so these services can't read it.</li>
      </ul>
    </Sec>

    <Sec title="How long it's kept">
      <ul>
        <li>As long as your family log exists.</li>
        <li>When you delete an entry, its content is removed straight away.</li>
        <li>When you remove a phone, its access and notification address are removed.</li>
        <li><b>Baby → Family → Delete family log</b> removes the log and everything in it for everyone, straight away. Cloudflare's database history can keep a copy for up to 30 days before it's gone for good.</li>
      </ul>
    </Sec>

    <Sec title="Your rights">
      <ul>
        <li><b>See and take your data:</b> Baby → Family → Export data downloads everything as a file.</li>
        <li><b>Correct it:</b> tap any entry to change it.</li>
        <li><b>Delete it:</b> delete entries, remove phones, or delete the whole family log.</li>
        <li><b>Withdraw consent:</b> delete the family log.</li>
        <li><b>Questions or other requests:</b> {email ? <a href={'mailto:' + email}>{email}</a> : 'contact the person responsible (above)'}.</li>
        <li><b>Complaints:</b> you can complain to the Dutch data protection authority, the <a href="https://autoriteitpersoonsgegevens.nl" target="_blank" rel="noopener">Autoriteit Persoonsgegevens</a>.</li>
      </ul>
    </Sec>

    <Sec title="Security">
      <ul>
        <li>All traffic is encrypted (HTTPS).</li>
        <li>Each phone has its own sign-in key. The app stores only a scrambled (hashed) version of it, and of invite links and the recovery code.</li>
        <li>Invite links work for one person and expire after 7 days.</li>
      </ul>
    </Sec>

    <Sec title="Changes">
      <p>If this statement changes in an important way, the app will tell you.</p>
    </Sec>
  </>;
}
