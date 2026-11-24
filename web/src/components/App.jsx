// App shell: header, notices, the current screen, bottom log bar and tabs, sheets and toast.
import { ageText } from '../lib/calc.js';
import { S, useApp, signedIn, go, openSheet, hideToast, nightActive } from '../store.js';
import { Notices } from './Reminders.jsx';
import Login, { RecoveryScreen } from './Login.jsx';
import Today from './Today.jsx';
import History from './History.jsx';
import Growth from './Growth.jsx';
import Calendar from './Calendar.jsx';
import Baby from './Baby.jsx';
import Help from './Help.jsx';
import Report from './Report.jsx';
import SheetHost from './Sheets.jsx';
import Privacy from './Privacy.jsx';
import Feedback, { Admin } from './Feedback.jsx';

const SCREENS = { today: Today, history: History, growth: Growth, calendar: Calendar, baby: Baby, report: Report, feedback: Feedback };
const ICON = {
  today: <><path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /></>,
  history: <path d="M5 19V10M12 19V5M19 19v-6" />,
  growth: <path d="M4 17c4-1 6-4 8-8s4-5 8-5" />,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
};
const TABS = [['today', 'Today'], ['history', 'History'], null, ['growth', 'Growth'], ['calendar', 'Calendar']];
const hello = () => { const h = new Date().getHours(); return h < 6 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

function Toast() {
  const t = S.toast; if (!t) return null;
  return <div className="toast" role="status"><span>{t.msg}</span>{t.undo && <button onClick={() => { hideToast(); t.undo(); }}>{t.label}</button>}</div>;
}

export default function App() {
  useApp();
  const inApp = signedIn();
  let title = 'Baby Care Log', age = '', view;
  if (S.tab === 'help') { title = 'How it works'; view = <Help />; }
  else if (S.tab === 'privacy') { title = 'Privacy'; view = <Privacy />; }
  else if (S.tab === 'admin') { title = 'Admin'; view = <Admin />; }
  else if (!inApp) view = <Login />;
  else if (S.recovery) view = <RecoveryScreen />;
  else { title = S.profile.name || 'Baby Care Log'; age = ageText(S); const Screen = SCREENS[S.tab] || Today; view = <Screen />; }
  // Night view: the whole app uses the dark night colours.
  const night = inApp && nightActive();
  if (night) document.documentElement.dataset.theme = 'dark'; else if (document.documentElement.dataset.theme === 'dark') delete document.documentElement.dataset.theme;
  const babyHeader = inApp && !S.recovery && S.tab !== 'help' && S.tab !== 'privacy' && S.tab !== 'admin';
  const name = S.profile.name || 'Baby Care Log';
  return <>
    <div className="app">
      {babyHeader
        ? <header className="top"><div style={{ minWidth: 0 }}><p className="hello">{hello()}</p><h1>{name}{age && <span className="age"> · {age}</span>}</h1></div>
          <button className="avatar" aria-label={`About ${S.profile.name || 'the baby'}, family and settings`} aria-current={S.tab === 'baby' ? 'page' : 'false'} onClick={() => go('baby')}>{(S.profile.name || 'B').trim().charAt(0).toUpperCase()}</button></header>
        : <header className="top"><h1>{title}</h1><span className="age">{age}</span></header>}
      {babyHeader ? <Notices /> : <div id="notice"></div>}
      <main id="view">{view}</main>
    </div>
    <nav className="tabs" aria-label="Sections" hidden={!inApp || !!S.recovery || S.tab === 'admin'}>
      <div className="in">
        {TABS.map((t) => t
          ? <button key={t[0]} aria-current={S.tab === t[0] ? 'page' : 'false'} onClick={() => go(t[0])}><svg viewBox="0 0 24 24" aria-hidden="true">{ICON[t[0]]}</svg>{t[1]}</button>
          : <button key="log" className="fab" aria-label="Log something" onClick={() => openSheet('logmenu')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>)}
      </div>
    </nav>
    <div id="sheet-root"><SheetHost /></div>
    <div id="toast-root"><Toast /></div>
  </>;
}
