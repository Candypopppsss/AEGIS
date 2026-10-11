import React, { useEffect, useRef, useState } from 'react';

export default function ZoneDialog({ onClose, onSave, busy }) {
  const dialog = useRef(null);
  const [error, setError] = useState('');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    dialog.current.showModal();
  }, []);

  function close() {
    dialog.current.close();
    onClose();
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const start = new Date(form.get('start'));
    const end = new Date(form.get('end'));
    if (end <= start || end <= new Date()) {
      setError('The end must be after the start and in the future.');
      return;
    }
    const result = await onSave({
      title: form.get('title'),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    });
    if (result.ok) close();
    else setError(result.error);
  }

  return (
    <dialog ref={dialog} aria-labelledby="zone-title"
      onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
      <div className="section-heading">
        <h2 id="zone-title">Add protect zone</h2>
        <button type="button" disabled={busy} onClick={close}>Close</button>
      </div>
      <p>Notification events are held from 15 minutes before the zone until it ends.</p>
      <form onSubmit={submit}>
        <label>Title
          <input autoFocus name="title" required maxLength={120} placeholder="Internship interview" />
        </label>
        <label>Start date and time<input name="start" type="datetime-local" required /></label>
        <label>End date and time<input name="end" type="datetime-local" required /></label>
        <small>Times are in {timezone}.</small>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save zone'}</button>
      </form>
    </dialog>
  );
}
