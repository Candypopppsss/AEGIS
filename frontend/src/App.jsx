import React, { useEffect, useRef, useState } from 'react';
import Auth from './Auth.jsx';
import Landing from './Landing.jsx';
import ZoneDialog from './ZoneDialog.jsx';
import { request } from './api.js';

const eventTypes = {
  NOTIFICATION: { label: 'Notification', weight: 1 },
  APP_SWITCH: { label: 'App switch', weight: 2 },
  MESSAGE_REPLY: { label: 'Message reply', weight: 3 },
  FORM_INPUT: { label: 'Form input', weight: 4 },
};
const pages = ['Overview', 'Protect zones', 'Daily summary'];
const preparationTime = 15 * 60 * 1000;

function time(value, timezone) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: timezone });
}

function date(value, timezone) {
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: timezone });
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('jf-token'));
  const [data, setData] = useState(null);
  const [page, setPage] = useState('Overview');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showZoneDialog, setShowZoneDialog] = useState(false);
  const [sessionMessage, setSessionMessage] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const requestVersion = useRef(0);
  const saving = useRef(false);

  function logout(message = '') {
    setShowAuth(true);
    requestVersion.current++;
    saving.current = false;
    setBusy(false);
    setSessionMessage(typeof message === 'string' ? message : '');
    sessionStorage.removeItem('jf-token');
    setToken(null);
    setData(null);
    setError('');
    setShowZoneDialog(false);
    setPage('Overview');
  }

  function login(token) {
    setSessionMessage('');
    sessionStorage.setItem('jf-token', token);
    setToken(token);
  }

  useEffect(() => {
    if (!token) return;
    let active = true;
    async function refresh() {
      if (saving.current) return;
      const version = ++requestVersion.current;
      try {
        const result = await request('/dashboard', token);
        if (active && version === requestVersion.current) {
          setData(result);
          setError('');
        }
      } catch (error) {
        if (!active || version !== requestVersion.current) return;
        if (error.status === 401) logout('Your session expired. Please sign in again.');
        else setError(error.message);
      }
    }
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [token]);

  async function save(path, body, method) {
    if (saving.current) return { ok: false, error: 'Please wait for the current request.' };
    const version = ++requestVersion.current;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await request(path, token, body, method);
      if (version !== requestVersion.current) return { ok: false, error: 'This session has ended.' };
      setData(result);
      return { ok: true };
    } catch (error) {
      if (version !== requestVersion.current) return { ok: false, error: 'This session has ended.' };
      if (error.status === 401) logout('Your session expired. Please sign in again.');
      else setError(error.message);
      return { ok: false, error: error.message };
    } finally {
      if (version === requestVersion.current) {
        saving.current = false;
        setBusy(false);
      }
    }
  }

  if (!token) return showAuth
    ? <Auth onLogin={login} message={sessionMessage} onBack={() => setShowAuth(false)} />
    : <Landing onSignIn={() => { window.scrollTo(0, 0); setShowAuth(true); }} />;
  if (!data) return (
    <main className="loading">
      <p role="status">{error || 'Loading dashboard...'}</p>
      <button onClick={logout}>Back to sign in</button>
    </main>
  );

  const now = Date.now();
  const timezone = data.user.timezone;
  const activeZone = data.zones.find(zone =>
    now >= Date.parse(zone.startsAt) - preparationTime && now < Date.parse(zone.endsAt));
  const upcomingZones = data.zones.filter(zone => Date.parse(zone.endsAt) > now);
  const zones = page === 'Overview' ? upcomingZones : data.zones;
  const totalCost = Object.values(data.summary).reduce((sum, cost) => sum + cost, 0);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">AEGIS</div>
        <nav aria-label="Main navigation">
          {pages.map(item => (
            <button key={item} aria-current={page === item ? 'page' : undefined}
              onClick={() => setPage(item)}>{item}</button>
          ))}
        </nav>
        <button onClick={logout}>Sign out</button>
      </header>
      <main className="content">
        <div className="page-heading">
          <div>
            <h1>{page}</h1>
            <div className="page-details">
              <span>{data.user.fullName}</span>
              <span>Date: {data.date}</span>
              <span>Timezone: {timezone}</span>
            </div>
          </div>
          <button className="primary" onClick={() => setShowZoneDialog(true)}>Add protect zone</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}

        {page === 'Overview' && (
          <div className="overview">
            <section className="battery">
              <h2>Decision battery</h2>
              <strong>{data.capacity}%</strong>
              <progress max="100" value={data.capacity} aria-label="Decision battery" />
              <p>Estimated capacity based on logged events. Resets daily.</p>
            </section>
            <section className="panel">
              <h2>Protection status</h2>
              <strong className="status">{activeZone ? activeZone.title : 'No active zone'}</strong>
              <p>{activeZone
                ? `Notification events are held until ${time(activeZone.endsAt, timezone)}.`
                : 'Schedule a zone to hold notification events during important work.'}</p>
              <p>Queued notification events: {data.heldCount}</p>
            </section>
          </div>
        )}

        {page !== 'Daily summary' && (
          <div className={page === 'Overview' ? 'columns' : ''}>
            <section className="panel">
              <h2>Protect zones</h2>
              {zones.length === 0 ? <p>No zones scheduled.</p> : (
                <ul className="records">
                  {zones.map(zone => {
                    const started = now >= Date.parse(zone.startsAt) - preparationTime;
                    const ended = now >= Date.parse(zone.endsAt);
                    return (
                      <li key={zone.id}>
                        <div><strong>{zone.title}</strong>
                          <p>{date(zone.startsAt, timezone)}, {time(zone.startsAt, timezone)} to {date(zone.endsAt, timezone)}, {time(zone.endsAt, timezone)}</p>
                        </div>
                        {started ? <span className="tag">{ended ? 'Completed' : 'Active'}</span> : (
                          <button disabled={busy} aria-label={`Remove ${zone.title}`}
                            onClick={() => save(`/zones/${zone.id}`, null, 'DELETE')}>Remove</button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <small>Protection starts 15 minutes before each zone.</small>
            </section>
            {page === 'Overview' && (
              <section className="panel">
                <h2>Today's events</h2>
                {data.events.length === 0 ? <p>No events logged.</p> : (
                  <ul className="records event-feed">
                    {data.events.map(event => (
                      <li key={event.id}>
                        <div><strong>{eventTypes[event.eventType].label}</strong>
                          <p>{time(event.occurredAt, timezone)} - {event.status === 'HELD' ? 'Queued' : event.status === 'RELEASED' ? 'Released in a batch' : 'Applied'}</p>
                        </div>
                        <span className="tag">{event.status === 'HELD' ? 'Held' : `${event.chargedWeight} ${event.chargedWeight === 1 ? 'point' : 'points'}`}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}

        {page === 'Daily summary' && (
          <section className="panel">
            <div className="section-heading"><h2>Cost by event type</h2><span>{totalCost} points used</span></div>
            <table>
              <thead><tr><th>Event type</th><th>Applied cost</th></tr></thead>
              <tbody>{Object.entries(eventTypes).map(([type, event]) => (
                <tr key={type}><td>{event.label}</td><td>{data.summary[type]} {data.summary[type] === 1 ? 'point' : 'points'}</td></tr>
              ))}</tbody>
            </table>
            <p>Includes batches released today. The battery is an estimate, not a measure of cognitive ability.</p>
          </section>
        )}

        <section className="panel log-events">
          <h2>Log an event</h2>
          <p>Record an event manually. Message content is not collected.</p>
          <div className="event-actions">{Object.entries(eventTypes).map(([type, event]) => (
            <button key={type} disabled={busy} onClick={() => save('/events', { eventType: type })}>
              {event.label} <span>{event.weight} {event.weight === 1 ? 'point' : 'points'}</span>
            </button>
          ))}</div>
        </section>
      </main>
      {showZoneDialog && (
        <ZoneDialog busy={busy} onClose={() => setShowZoneDialog(false)}
          onSave={body => save('/zones', body)} />
      )}
    </div>
  );
}
