import React, { useState } from 'react';
import { request } from './api.js';

export default function Auth({ onLogin, message, onBack }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const body = { email: form.get('email'), password: form.get('password') };
    if (register) {
      body.fullName = form.get('fullName');
      body.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }

    try {
      const result = await request(register ? '/auth/register' : '/auth/login', null, body);
      onLogin(result.token);
    } catch (error) {
      setError(error.status === 401 ? 'Email or password is incorrect.' : error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      {onBack && <button className="auth-back" onClick={onBack}>Back to AEGIS</button>}
      <section className="auth-card">
        <div className="brand">AEGIS</div>
        <h1>{register ? 'Create an account' : 'Sign in'}</h1>
        <p>Track your decision load and schedule protected time.</p>
        {message && <p role="status">{message}</p>}
        <form onSubmit={submit}>
          {register && (
            <label>Full name
              <input name="fullName" required maxLength={100} autoComplete="name" />
            </label>
          )}
          <label>Work or institution email
            <input name="email" type="email" required maxLength={254} autoComplete="email" />
          </label>
          <label>Password
            <input name="password" type="password" required minLength={register ? 10 : 1}
              maxLength={72} autoComplete={register ? 'new-password' : 'current-password'} />
            {register && <small>Use at least 10 characters.</small>}
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" disabled={busy}>
            {busy ? 'Please wait...' : register ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <button className="text-button" disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>
          {register ? 'Already registered? Sign in' : 'Create an account'}
        </button>
      </section>
    </main>
  );
}
