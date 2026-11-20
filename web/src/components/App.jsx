// App shell: header, notices, the current screen, bottom log bar and tabs, sheets and toast.
import { ageText } from '../lib/calc.js';
import { S, useApp, signedIn, go, openSheet, hideToast } from '../store.js';
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

const SCREENS = { today: Today, history: History, growth: Growth, calendar: Calendar, baby: Baby, report: Report };
const TABS = [
  ['today', 'Today', <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>],
  ['history', 'History', <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />],
  ['growth', 'Growth', <><path d="M3 18c4-1 6-4 8-8s5-6 10-6" /><circle cx="21" cy="4" r="1.2" /></>],
  ['calendar', 'Calendar', <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>],
  ['baby', 'Baby', <><circle cx="12" cy="9" r="4.5" /><path d="M4.5 21c1.2-3.6 4-5.2 7.5-5.2s6.3 1.6 7.5 5.2" /></>],
];
const LOG = [['feed', 'Feed'], ['diaper', 'Diaper'], ['pump', 'Pump'], ['note', 'Note']];

function Toast() {
  const t = S.toast; if (!t) return null;
  return <div className="toast" role="status"><span>{t.msg}</span>{t.undo && <button onClick={() => { hideToast(); t.undo(); }}>Undo</button>}</div>;
}

export default function App() {
  useApp();
  const inApp = signedIn();
  let title = 'Baby Care Log', age = '', view;
  if (S.tab === 'help') { title = 'How it works'; view = <Help />; }
  else if (S.tab === 'privacy') { title = 'Privacy'; view = <Privacy />; }
  else if (!inApp) view = <Login />;
  else if (S.recovery) view = <RecoveryScreen />;
  else { title = S.profile.name || 'Baby Care Log'; age = ageText(S); const Screen = SCREENS[S.tab] || Today; view = <Screen />; }
  return <>
    <div className="app">
      <header className="top"><h1>{title}</h1><span className="age">{age}</span></header>
      {inApp && S.tab !== 'help' && S.tab !== 'privacy' ? <Notices /> : <div id="notice"></div>}
      <main id="view">{view}</main>
    </div>
    <nav className="tabs" aria-label="Sections" hidden={!inApp || !!S.recovery}>
      <div className="logbar" role="group" aria-label="Log">
        {LOG.map(([k, l]) => <button key={k} className={'lb ' + (k === 'diaper' ? 'diaper' : k)} onClick={() => openSheet(k)}><span>+</span>{l}</button>)}
      </div>
      <div className="in">
        {TABS.map(([k, l, icon]) => <button key={k} aria-current={S.tab === k ? 'page' : 'false'} onClick={() => go(k)}><svg viewBox="0 0 24 24">{icon}</svg>{l}</button>)}
      </div>
    </nav>
    <div id="sheet-root"><SheetHost /></div>
    <div id="toast-root"><Toast /></div>
  </>;
}
